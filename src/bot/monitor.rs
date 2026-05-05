use std::sync::{Arc, Mutex};
use std::str::FromStr;
use tokio::sync::mpsc;
use tokio::time::{Duration, sleep};
use tokio_util::sync::CancellationToken;
use anyhow::Result;
use cron::Schedule;
use serde_json::json;

use crate::api::BiliApi;
use crate::config::AppConfig;
use crate::storage::Storage;
use crate::bot::engine::BotEngine;
use crate::token;
use crate::bot;
use crate::bot::EventEmitter;

pub async fn run_monitor_loop<E: EventEmitter>(
    app: E,
    http: BiliApi,
    room_id: i64,
    cancel: CancellationToken,
    current_session_id: Arc<Mutex<Option<String>>>,
) -> Result<()> {
    let _ = app.emit("monitor-status", json!("运行中"));
    let _ = app.emit("monitor-log", json!("直播间监听已启动"));

    let config = AppConfig::load_or_default()?;
    let storage_path = format!("{}/{}", config.db_path.trim_end_matches('/'), config.db_name);
    let storage = Arc::new(Storage::open(&storage_path)?);
    
    let engine = Arc::new(BotEngine::new(config.clone()));
    let bot_config = Arc::new(config.clone());
    let sender_danmu_len = config.danmu_len;
    let cron_enabled = config.cron_danmu;
    let cron_entries = config.cron_danmu_list.clone();

    let (send_tx, send_rx) = mpsc::channel::<String>(1000);
    let (gift_tx, gift_rx) = mpsc::channel::<bilibili_live_protocol::LiveEvent>(1000);
    let send_cookie = token::read_cookie_string().ok();
    
    // Sender Task
    let sender_http = http.clone();
    let sender_app = Arc::new(app);
    let sender_cancel = cancel.clone();
    let sender_app_c = sender_app.clone();
    let send_task = tokio::spawn(async move {
        let Some(cookie) = send_cookie else {
            let _ = sender_app_c.emit("monitor-log", json!("未找到 token，自动弹幕发送队列未启动"));
            return;
        };
        tokio::select! {
            _ = sender_cancel.cancelled() => {}
            _ = crate::bot::sender::run_send_queue(
                send_rx,
                sender_danmu_len,
                move |message| {
                    let http = sender_http.clone();
                    let cookie = cookie.clone();
                    async move { http.send_danmu(room_id, &message, &cookie).await }
                },
                move |line| {
                    let _ = sender_app_c.emit("monitor-log", json!(line));
                },
            ) => {}
        }
    });

    // Gift Aggregator
    let gift_task = tokio::spawn(crate::bot::thanks::run_gift_aggregator(
        gift_rx,
        send_tx.clone(),
        cancel.clone(),
        config.clone(),
        storage.clone(),
    ));

    // Timed Danmu Task
    let timed_cancel = cancel.clone();
    let timed_app = sender_app.clone();
    let timed_tx = send_tx.clone();
    let timed_task = tokio::spawn(async move {
        if !cron_enabled {
            return;
        }
        for entry in cron_entries {
            let Some(expression) = crate::bot::timed::normalize_cron(&entry.cron) else {
                let _ = timed_app.emit("monitor-log", json!(format!("定时弹幕表达式无效: {}", entry.cron)));
                continue;
            };
            let Ok(schedule) = Schedule::from_str(&expression) else {
                let _ = timed_app.emit("monitor-log", json!(format!("定时弹幕表达式解析失败: {expression}")));
                continue;
            };
            let tx = timed_tx.clone();
            let app_inner = timed_app.clone();
            let cancel_inner = timed_cancel.clone();
            tokio::spawn(async move {
                let mut upcoming = schedule.upcoming(chrono::Local);
                let mut index = 0;
                loop {
                    let Some(next) = upcoming.next() else { return; };
                    let now = chrono::Local::now();
                    let delay = (next - now).to_std().unwrap_or_else(|_| Duration::from_secs(0));
                    tokio::select! {
                        _ = cancel_inner.cancelled() => return,
                        _ = sleep(delay) => {
                            if let Some(message) = crate::bot::timed::select_timed_message(&entry, &mut index) {
                                if tx.send(message).await.is_err() {
                                    let _ = app_inner.emit("monitor-log", json!("定时弹幕发送队列已关闭"));
                                    return;
                                }
                            }
                        }
                    }
                }
            });
        }
        timed_cancel.cancelled().await;
    });

    // Room Status Polling Task
    let poll_http = http.clone();
    let poll_app = sender_app.clone();
    let poll_cancel = cancel.clone();
    let poll_storage = storage.clone();
    let poll_session = current_session_id.clone();
    let poll_task = tokio::spawn(async move {
        let mut last_status = -1;
        loop {
            tokio::select! {
                _ = poll_cancel.cancelled() => return,
                _ = sleep(Duration::from_secs(10)) => {
                    match poll_http.room_init(room_id).await {
                        Ok(room) => {
                            if room.live_status != last_status {
                                last_status = room.live_status;
                                let status = if room.live_status == 1 { "直播中" } else { "未开播" };
                                let session_change = {
                                    let mut session = poll_session.lock().expect("session mutex poisoned");
                                    crate::bot::update_observed_session_for_room_status(
                                        &poll_storage,
                                        &mut session,
                                        room_id,
                                        room.live_status,
                                        chrono::Local::now(),
                                    )
                                };
                                let _ = poll_app.emit("room-status", json!(format!("{room_id} / {status}")));
                                let _ = poll_app.emit("monitor-log", json!(format!("直播状态变更: {status}")));
                                if let Ok(change) = session_change {
                                    match change {
                                        bot::SessionStatusChange::Started(id) => { let _ = poll_app.emit("monitor-log", json!(format!("直播场次已开始: {id}"))); }
                                        bot::SessionStatusChange::Ended(id) => { let _ = poll_app.emit("monitor-log", json!(format!("直播场次已结束: {id}"))); }
                                        bot::SessionStatusChange::Unchanged => {}
                                    }
                                }
                            }
                        }
                        Err(err) => { let _ = poll_app.emit("monitor-log", json!(format!("监听轮询失败: {err}"))); }
                    }
                }
            }
        }
    });

    // WebSocket Client Task
    let ws_http = http.clone();
    let ws_app = sender_app.clone();
    let ws_cancel = cancel.clone();
    let ws_session = current_session_id.clone();
    let ws_task = tokio::spawn(async move {
        let cookie = match token::read_cookie_string() {
            Ok(cookie) => cookie,
            Err(_) => {
                let _ = ws_app.emit("monitor-log", json!("未找到 token，仅启动直播状态轮询"));
                return;
            }
        };

        loop {
            let result = async {
                let room = ws_http.room_init(room_id).await?;
                let session_id = {
                    let mut session = ws_session.lock().expect("session mutex poisoned");
                    if session.is_none() {
                        let id = storage.start_observed_live_session(room_id, chrono::Local::now())?;
                        *session = Some(id);
                    }
                    session.clone().expect("session just initialized")
                };
                let danmu = ws_http.danmu_info(room.room_id, &cookie).await?;
                let connect_config = bilibili_live_protocol::ConnectConfig {
                    room_id: room.room_id,
                    token: danmu.token,
                    hosts: danmu.hosts,
                };
                let url = connect_config.first_ws_url();
                let _ = ws_app.emit("monitor-log", json!(format!("连接弹幕流: {url}")));

                let event_app = ws_app.clone();
                let event_tx = send_tx.clone();
                let event_gift_tx = gift_tx.clone();
                let event_engine = engine.clone();
                let event_storage = storage.clone();
                let ai_http = ws_http.clone();
                let ai_config = bot_config.clone();
                let session_id_inner = session_id.clone();
                
                bilibili_live_protocol::run_parsed_client(connect_config, move |parsed| {
                    let event = &parsed.event;
                    let line = event.to_string();
                    if matches!(event, bilibili_live_protocol::LiveEvent::Gift { .. }) {
                        let _ = event_gift_tx.try_send(event.clone());
                    }
                    let replies = match bot::record_and_handle_event(
                        &event_storage,
                        &session_id_inner,
                        room_id,
                        &parsed,
                        &event_engine,
                    ) {
                        Ok(replies) => replies,
                        Err(err) => {
                            let _ = event_app.emit("monitor-log", json!(format!("事件记录失败: {err}")));
                            event_engine.handle_event(event, Some(&event_storage))
                        }
                    };
                    
                    // Stats Update
                    if let Ok(summary) = event_storage.live_session_summary(&session_id_inner) {
                        let _ = event_app.emit("session-summary", json!(summary));
                    }
                    
                    for message in replies {
                        let _ = event_tx.try_send(message);
                    }
                    if let Some(prompt) = event_engine.ai_prompt(event) {
                        let ai_http = ai_http.clone();
                        let ai_config = ai_config.clone();
                        let ai_tx = event_tx.clone();
                        tokio::spawn(async move {
                            let reply = ai_http.robot_reply(&ai_config, &prompt).await.unwrap_or_else(|_| "不好意思，机器人坏掉了...".to_string());
                            let _ = ai_tx.send(reply).await;
                        });
                    }
                    let _ = event_app.emit("monitor-log", json!(line));
                    let _ = event_app.emit("live-event", json!(parsed));
                })
                .await
            }
            .await;

            if let Err(err) = result {
                let _ = ws_app.emit("monitor-log", json!(format!("弹幕流连接结束: {err}")));
            }

            tokio::select! {
                _ = ws_cancel.cancelled() => return,
                _ = sleep(Duration::from_secs(5)) => {}
            }
        }
    });

    cancel.cancelled().await;
    send_task.abort();
    gift_task.abort();
    timed_task.abort();
    poll_task.abort();
    ws_task.abort();
    
    let _ = sender_app.emit("monitor-status", json!("已停止"));
    let _ = sender_app.emit("monitor-log", json!("监听已停止"));
    Ok(())
}
