mod api;
mod bot;
mod config;
mod storage;
mod token;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyhow::Result;
use bilibili_live_protocol::ConnectConfig;
use bot::engine::BotEngine;
use config::AppConfig;
use cron::Schedule;
use slint::{ComponentHandle, SharedString};
use std::str::FromStr;
use tokio::runtime::Runtime;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::{Duration, sleep};
use tokio_util::sync::CancellationToken;

slint::include_modules!();

#[derive(Clone)]
struct SharedState {
    runtime: Arc<Runtime>,
    http: api::BiliApi,
    monitor: Arc<Mutex<Option<MonitorHandle>>>,
}

struct MonitorHandle {
    cancel: CancellationToken,
    task: JoinHandle<()>,
}

fn main() -> Result<()> {
    ensure_dirs()?;

    let app = MainWindow::new()?;
    let state = SharedState {
        runtime: Arc::new(Runtime::new()?),
        http: api::BiliApi::new()?,
        monitor: Arc::new(Mutex::new(None)),
    };

    hydrate_ui(&app, &AppConfig::load_or_default()?)?;
    append_log(&app, "应用已启动");
    if token::has_token() {
        app.set_user_info("已发现本地 token，可直接检测登录".into());
    }

    wire_callbacks(&app, state);
    app.run()?;
    Ok(())
}

fn wire_callbacks(app: &MainWindow, state: SharedState) {
    let weak = app.as_weak();
    app.on_load_config(move || match AppConfig::load_or_default() {
        Ok(config) => {
            if let Some(app) = weak.upgrade() {
                if let Err(err) = hydrate_ui(&app, &config) {
                    append_log(&app, &format!("配置应用失败: {err}"));
                } else {
                    append_log(&app, "配置已读取");
                }
            }
        }
        Err(err) => update_ui(&weak, move |app| {
            append_log(app, &format!("读取配置失败: {err}"))
        }),
    });

    let weak = app.as_weak();
    app.on_save_config(
        move |room_id,
              danmu_len,
              entry_msg,
              goodbye_info,
              pk_notice,
              welcome_enabled,
              entry_effect,
              thanks_gift,
              thanks_focus,
              thanks_share,
              cron_danmu,
              keyword_reply,
              draw_by_lot,
              sign_in_enable,
              robot_name,
              talk_robot_cmd,
              robot_mode_index,
              chatgpt_token,
              chatgpt_api_url,
              chatgpt_prompt,
              welcome_list_text,
              focus_list_text,
              blacklist_wide_text,
              blacklist_exact_text,
              keyword_reply_text,
              cron_danmu_text,
              draw_list_text| {
            let result = config_from_ui(
                room_id,
                danmu_len,
                entry_msg,
                goodbye_info,
                pk_notice,
                welcome_enabled,
                entry_effect,
                thanks_gift,
                thanks_focus,
                thanks_share,
                cron_danmu,
                keyword_reply,
                draw_by_lot,
                sign_in_enable,
                robot_name,
                talk_robot_cmd,
                robot_mode_index,
                chatgpt_token,
                chatgpt_api_url,
                chatgpt_prompt,
                welcome_list_text,
                focus_list_text,
                blacklist_wide_text,
                blacklist_exact_text,
                keyword_reply_text,
                cron_danmu_text,
                draw_list_text,
            )
            .and_then(|config| config.save());

            update_ui(&weak, move |app| match result {
                Ok(()) => append_log(app, "配置已保存到 etc/bilidanmaku-api.yaml"),
                Err(err) => append_log(app, &format!("保存配置失败: {err}")),
            });
        },
    );

    let weak = app.as_weak();
    let state_for_login = state.clone();
    app.on_start_login(move || {
        update_ui(&weak, |app| {
            app.set_user_info("正在生成登录链接".into());
            append_log(app, "请求 Bilibili 扫码登录链接");
        });
        let weak = weak.clone();
        let state = state_for_login.clone();
        state.runtime.spawn(async move {
            match state.http.login_url().await {
                Ok(login) => {
                    let url = login.url.clone();
                    let key = login.qrcode_key.clone();
                    update_ui(&weak, move |app| {
                        app.set_login_url(url.into());
                        app.set_user_info("请打开登录链接并用 Bilibili App 扫码".into());
                        append_log(app, "登录链接已生成，开始自动轮询");
                    });
                    poll_login_loop(weak, state.http.clone(), key).await;
                }
                Err(err) => update_ui(&weak, move |app| {
                    app.set_user_info("登录链接生成失败".into());
                    append_log(app, &format!("登录失败: {err}"));
                }),
            }
        });
    });

    let weak = app.as_weak();
    let state_for_check = state.clone();
    app.on_check_login(move || {
        let weak = weak.clone();
        let state = state_for_check.clone();
        state.runtime.spawn(async move {
            let result = match token::read_cookie_string() {
                Ok(cookie) => async_user_info(&state.http, cookie).await,
                Err(err) => Err(err),
            };
            match result {
                Ok(name) => update_ui(&weak, move |app| {
                    app.set_user_info(format!("已登录: {name}").into());
                    append_log(app, "登录状态有效");
                }),
                Err(err) => update_ui(&weak, move |app| {
                    app.set_user_info("未登录或 token 已失效".into());
                    append_log(app, &format!("登录检查失败: {err}"));
                }),
            }
        });
    });

    let weak = app.as_weak();
    let state_for_room = state.clone();
    app.on_check_room(move || {
        let room_id = app_room_id(&weak);
        let weak = weak.clone();
        let state = state_for_room.clone();
        state.runtime.spawn(async move {
            match state.http.room_init(room_id).await {
                Ok(room) => {
                    let status = if room.live_status == 1 {
                        "直播中"
                    } else {
                        "未开播"
                    };
                    update_ui(&weak, move |app| {
                        app.set_room_status(
                            format!("{room_id} / 主播 UID {} / {status}", room.uid).into(),
                        );
                        append_log(app, "房间状态检测完成");
                    });
                }
                Err(err) => update_ui(&weak, move |app| {
                    app.set_room_status("检测失败".into());
                    append_log(app, &format!("房间检测失败: {err}"));
                }),
            }
        });
    });

    let weak = app.as_weak();
    let state_for_monitor = state.clone();
    app.on_start_monitor(move || {
        let room_id = app_room_id(&weak);
        let mut guard = state_for_monitor
            .monitor
            .lock()
            .expect("monitor mutex poisoned");
        if guard.is_some() {
            update_ui(&weak, |app| append_log(app, "监听已经在运行"));
            return;
        }

        let weak_for_task = weak.clone();
        let state = state_for_monitor.clone();
        let cancel = CancellationToken::new();
        let task_cancel = cancel.clone();
        let task = state_for_monitor.runtime.spawn(async move {
            update_ui(&weak_for_task, |app| {
                app.set_run_status("运行中".into());
                append_log(app, "直播间监听已启动");
            });

            let config = match AppConfig::load_or_default() {
                Ok(config) => config,
                Err(err) => {
                    update_ui(&weak_for_task, move |app| {
                        append_log(app, &format!("启动失败，配置读取错误: {err}"))
                    });
                    return;
                }
            };
            let storage_path = format!("{}/{}", config.db_path.trim_end_matches('/'), config.db_name);
            let storage = match storage::Storage::open(&storage_path) {
                Ok(storage) => Arc::new(storage),
                Err(err) => {
                    update_ui(&weak_for_task, move |app| {
                        append_log(app, &format!("启动失败，SQLite 初始化错误: {err}"))
                    });
                    return;
                }
            };
            let engine = Arc::new(BotEngine::new(config.clone()));
            let bot_config = Arc::new(config.clone());
            let sender_danmu_len = config.danmu_len;
            let cron_enabled = config.cron_danmu;
            let cron_entries = config.cron_danmu_list.clone();

            let (send_tx, send_rx) = mpsc::channel::<String>(1000);
            let (gift_tx, gift_rx) = mpsc::channel::<bilibili_live_protocol::LiveEvent>(1000);
            let current_session_id = Arc::new(Mutex::new(None::<String>));
            let send_cookie = token::read_cookie_string().ok();
            let sender_http = state.http.clone();
            let sender_weak = weak_for_task.clone();
            let sender_cancel = task_cancel.clone();
            let send_task = tokio::spawn(async move {
                let Some(cookie) = send_cookie else {
                    update_ui(&sender_weak, |app| append_log(app, "未找到 token，自动弹幕发送队列未启动"));
                    return;
                };
                tokio::select! {
                    _ = sender_cancel.cancelled() => {}
                    _ = bot::sender::run_send_queue(
                        send_rx,
                        sender_danmu_len,
                        move |message| {
                            let http = sender_http.clone();
                            let cookie = cookie.clone();
                            async move { http.send_danmu(room_id, &message, &cookie).await }
                        },
                        move |line| {
                            update_ui(&sender_weak, move |app| append_log(app, &line));
                        },
                    ) => {}
                }
            });

            let gift_task = tokio::spawn(bot::thanks::run_gift_aggregator(
                gift_rx,
                send_tx.clone(),
                task_cancel.clone(),
                config.clone(),
                storage.clone(),
            ));

            let timed_cancel = task_cancel.clone();
            let timed_weak = weak_for_task.clone();
            let timed_tx = send_tx.clone();
            let timed_task = tokio::spawn(async move {
                if !cron_enabled {
                    return;
                }
                for entry in cron_entries {
                    let Some(expression) = bot::timed::normalize_cron(&entry.cron) else {
                        update_ui(&timed_weak, move |app| {
                            append_log(app, &format!("定时弹幕表达式无效: {}", entry.cron))
                        });
                        continue;
                    };
                    let Ok(schedule) = Schedule::from_str(&expression) else {
                        update_ui(&timed_weak, move |app| {
                            append_log(app, &format!("定时弹幕表达式解析失败: {expression}"))
                        });
                        continue;
                    };
                    let tx = timed_tx.clone();
                    let weak = timed_weak.clone();
                    let cancel = timed_cancel.clone();
                    tokio::spawn(async move {
                        let mut upcoming = schedule.upcoming(chrono::Local);
                        let mut index = 0;
                        loop {
                            let Some(next) = upcoming.next() else {
                                return;
                            };
                            let now = chrono::Local::now();
                            let delay = (next - now)
                                .to_std()
                                .unwrap_or_else(|_| Duration::from_secs(0));
                            tokio::select! {
                                _ = cancel.cancelled() => return,
                                _ = sleep(delay) => {
                                    if let Some(message) = bot::timed::select_timed_message(&entry, &mut index) {
                                        if tx.send(message).await.is_err() {
                                            update_ui(&weak, |app| append_log(app, "定时弹幕发送队列已关闭"));
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

            let poll_http = state.http.clone();
            let poll_weak = weak_for_task.clone();
            let poll_cancel = task_cancel.clone();
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
                                            let mut session = poll_session
                                                .lock()
                                                .expect("session mutex poisoned");
                                            bot::update_observed_session_for_room_status(
                                                &poll_storage,
                                                &mut session,
                                                room_id,
                                                room.live_status,
                                                chrono::Local::now(),
                                            )
                                        };
                                        update_ui(&poll_weak, move |app| {
                                            app.set_room_status(format!("{room_id} / {status}").into());
                                            append_log(app, &format!("直播状态变更: {status}"));
                                            match session_change {
                                                Ok(bot::SessionStatusChange::Started(session_id)) => {
                                                    append_log(app, &format!("直播场次已开始: {session_id}"));
                                                }
                                                Ok(bot::SessionStatusChange::Ended(session_id)) => {
                                                    append_log(app, &format!("直播场次已结束: {session_id}"));
                                                }
                                                Ok(bot::SessionStatusChange::Unchanged) => {}
                                                Err(err) => {
                                                    append_log(app, &format!("直播场次状态更新失败: {err}"));
                                                }
                                            }
                                        });
                                    }
                                }
                                Err(err) => update_ui(&poll_weak, move |app| {
                                    append_log(app, &format!("监听轮询失败: {err}"));
                                }),
                            }
                        }
                    }
                }
            });

            let ws_http = state.http.clone();
            let ws_weak = weak_for_task.clone();
            let ws_cancel = task_cancel.clone();
            let ws_session = current_session_id.clone();
            let ws_task = tokio::spawn(async move {
                let cookie = match token::read_cookie_string() {
                    Ok(cookie) => cookie,
                    Err(_) => {
                        update_ui(&ws_weak, |app| append_log(app, "未找到 token，仅启动直播状态轮询"));
                        return;
                    }
                };

                loop {
                    let result = async {
                        let room = ws_http.room_init(room_id).await?;
                        let session_id = {
                            let mut session = ws_session.lock().expect("session mutex poisoned");
                            if session.is_none() {
                                let session_id = storage
                                    .start_observed_live_session(room_id, chrono::Local::now())?;
                                *session = Some(session_id);
                            }
                            session.clone().expect("session just initialized")
                        };
                        let danmu = ws_http.danmu_info(room.room_id, &cookie).await?;
                        let connect_config = ConnectConfig {
                            room_id: room.room_id,
                            token: danmu.token,
                            hosts: danmu.hosts,
                        };
                        let url = connect_config.first_ws_url();
                        update_ui(&ws_weak, move |app| append_log(app, &format!("连接弹幕流: {url}")));

                        let event_weak = ws_weak.clone();
                        let event_tx = send_tx.clone();
                        let event_gift_tx = gift_tx.clone();
                        let event_engine = engine.clone();
                        let event_storage = storage.clone();
                        let ai_http = ws_http.clone();
                        let ai_config = bot_config.clone();
                        bilibili_live_protocol::run_parsed_client(connect_config, move |parsed| {
                            let event = &parsed.event;
                            let line = event.to_string();
                            if matches!(event, bilibili_live_protocol::LiveEvent::Gift { .. }) {
                                let _ = event_gift_tx.try_send(event.clone());
                            }
                            let replies = match bot::record_and_handle_event(
                                &event_storage,
                                &session_id,
                                room_id,
                                &parsed,
                                &event_engine,
                            ) {
                                Ok(replies) => replies,
                                Err(err) => {
                                    update_ui(&event_weak, move |app| {
                                        append_log(app, &format!("事件记录失败: {err}"))
                                    });
                                    event_engine.handle_event(event, Some(&event_storage))
                                }
                            };
                            for message in replies {
                                let _ = event_tx.try_send(message);
                            }
                            if let Some(prompt) = event_engine.ai_prompt(event) {
                                let ai_http = ai_http.clone();
                                let ai_config = ai_config.clone();
                                let ai_tx = event_tx.clone();
                                tokio::spawn(async move {
                                    let reply = ai_http
                                        .robot_reply(&ai_config, &prompt)
                                        .await
                                        .unwrap_or_else(|_| "不好意思，机器人坏掉了...".to_string());
                                    let _ = ai_tx.send(reply).await;
                                });
                            }
                            update_ui(&event_weak, move |app| append_log(app, &line));
                        })
                        .await
                    }
                    .await;

                    if let Err(err) = result {
                        update_ui(&ws_weak, move |app| append_log(app, &format!("弹幕流连接结束: {err}")));
                    }

                    tokio::select! {
                        _ = ws_cancel.cancelled() => return,
                        _ = sleep(Duration::from_secs(5)) => {}
                    }
                }
            });

            task_cancel.cancelled().await;
            send_task.abort();
            gift_task.abort();
            timed_task.abort();
            poll_task.abort();
            ws_task.abort();
        });
        *guard = Some(MonitorHandle { cancel, task });
    });

    let weak = app.as_weak();
    let state_for_stop = state.clone();
    app.on_stop_monitor(move || {
        if let Some(monitor) = state_for_stop
            .monitor
            .lock()
            .expect("monitor mutex poisoned")
            .take()
        {
            monitor.cancel.cancel();
            monitor.task.abort();
        }
        update_ui(&weak, |app| {
            app.set_run_status("已停止".into());
            append_log(app, "监听已停止");
        });
    });

    let weak = app.as_weak();
    let state_for_send = state.clone();
    app.on_send_danmu(move |msg| {
        let room_id = app_room_id(&weak);
        let msg = msg.to_string();
        let weak = weak.clone();
        let state = state_for_send.clone();
        state.runtime.spawn(async move {
            let result = async {
                let cookie = token::read_cookie_string()?;
                state.http.send_danmu(room_id, &msg, &cookie).await
            }
            .await;

            update_ui(&weak, move |app| match result {
                Ok(()) => append_log(app, &format!("弹幕已发送: {msg}")),
                Err(err) => append_log(app, &format!("弹幕发送失败: {err}")),
            });
        });
    });

    let weak = app.as_weak();
    let state_for_update = state.clone();
    app.on_check_update(move || {
        let weak = weak.clone();
        let state = state_for_update.clone();
        state.runtime.spawn(async move {
            let current_version = env!("CARGO_PKG_VERSION");
            match state.http.check_update(current_version).await {
                Ok(Some(update)) => update_ui(&weak, move |app| {
                    app.set_update_link(update.link.clone().into());
                    append_log(
                        app,
                        &format!(
                            "发现新版本 {}: {}\n下载地址: {}",
                            update.version, update.change_log, update.link
                        ),
                    );
                }),
                Ok(None) => update_ui(&weak, |app| append_log(app, "当前已是最新版本")),
                Err(err) => update_ui(&weak, move |app| {
                    append_log(app, &format!("检查更新失败: {err}"))
                }),
            }
        });
    });

    let weak = app.as_weak();
    let state_for_download = state;
    app.on_download_update(move |link| {
        let weak = weak.clone();
        let state = state_for_download.clone();
        state.runtime.spawn(async move {
            let link = link.to_string();
            let destination = update_download_path(&link);
            let result = async {
                state.http.download_update_upgrader(&destination).await?;
                launch_upgrader(&destination)?;
                Ok::<(), anyhow::Error>(())
            }
            .await;
            update_ui(&weak, move |app| match result {
                Ok(()) => append_log(app, &format!("更新器已准备完成: {}", destination.display())),
                Err(err) => append_log(app, &format!("下载更新失败: {err}")),
            });
        });
    });
}

fn update_download_path(_link: &str) -> PathBuf {
    PathBuf::from("downloads").join("upgrader.exe")
}

fn launch_upgrader(path: &PathBuf) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd.exe")
            .arg("/C")
            .arg("start")
            .arg(path)
            .spawn()?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
    }
    Ok(())
}

async fn poll_login_loop(weak: slint::Weak<MainWindow>, http: api::BiliApi, key: String) {
    for _ in 0..180 {
        match http.poll_login(&key).await {
            Ok(api::LoginPoll::Pending(message)) => update_ui(&weak, move |app| {
                app.set_user_info(message.into());
            }),
            Ok(api::LoginPoll::Success(cookie)) => {
                let save_result = token::write_cookie(&cookie);
                update_ui(&weak, move |app| match save_result {
                    Ok(()) => {
                        app.set_user_info("登录成功".into());
                        append_log(app, "token 已保存");
                    }
                    Err(err) => append_log(app, &format!("token 保存失败: {err}")),
                });
                return;
            }
            Ok(api::LoginPoll::Expired(message)) => {
                update_ui(&weak, move |app| {
                    app.set_user_info(message.into());
                    append_log(app, "登录二维码已过期");
                });
                return;
            }
            Err(err) => update_ui(&weak, move |app| {
                append_log(app, &format!("登录轮询失败: {err}"))
            }),
        }
        sleep(Duration::from_secs(2)).await;
    }
    update_ui(&weak, |app| append_log(app, "登录轮询超时"));
}

async fn async_user_info(http: &api::BiliApi, cookie: String) -> Result<String> {
    let user = http.user_info(&cookie).await?;
    Ok(user.uname)
}

fn hydrate_ui(app: &MainWindow, config: &AppConfig) -> Result<()> {
    app.set_room_id(config.room_id.to_string().into());
    app.set_danmu_len(config.danmu_len);
    app.set_entry_msg(config.entry_msg.clone().into());
    app.set_goodbye_info(config.goodbye_info.clone().into());
    app.set_pk_notice(config.pk_notice);
    app.set_welcome_enabled(config.interact_word);
    app.set_entry_effect(config.entry_effect);
    app.set_thanks_gift(config.thanks_gift);
    app.set_thanks_focus(config.thanks_focus);
    app.set_thanks_share(config.thanks_share);
    app.set_cron_danmu(config.cron_danmu);
    app.set_keyword_reply(config.keyword_reply);
    app.set_draw_by_lot(config.draw_by_lot);
    app.set_sign_in_enable(config.sign_in_enable);
    app.set_robot_name(config.robot_name.clone().into());
    app.set_talk_robot_cmd(config.talk_robot_cmd.clone().into());
    app.set_robot_mode_index(if config.robot_mode == "ChatGPT" { 1 } else { 0 });
    app.set_chatgpt_token(config.chatgpt.api_token.clone().into());
    app.set_chatgpt_api_url(config.chatgpt.api_url.clone().into());
    app.set_chatgpt_prompt(config.chatgpt.prompt.clone().into());
    app.set_welcome_list_text(join_lines(&config.welcome_danmu).into());
    app.set_focus_list_text(join_lines(&config.focus_danmu).into());
    app.set_blacklist_wide_text(join_lines(&config.welcome_blacklist_wide).into());
    app.set_blacklist_exact_text(join_lines(&config.welcome_blacklist).into());
    app.set_keyword_reply_text(format_keyword_reply(&config.keyword_reply_list).into());
    app.set_cron_danmu_text(format_cron_danmu(&config.cron_danmu_list).into());
    app.set_draw_list_text(join_lines(&config.draw_lots_list).into());
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn config_from_ui(
    room_id: SharedString,
    danmu_len: i32,
    entry_msg: SharedString,
    goodbye_info: SharedString,
    pk_notice: bool,
    welcome_enabled: bool,
    entry_effect: bool,
    thanks_gift: bool,
    thanks_focus: bool,
    thanks_share: bool,
    cron_danmu: bool,
    keyword_reply: bool,
    draw_by_lot: bool,
    sign_in_enable: bool,
    robot_name: SharedString,
    talk_robot_cmd: SharedString,
    robot_mode_index: i32,
    chatgpt_token: SharedString,
    chatgpt_api_url: SharedString,
    chatgpt_prompt: SharedString,
    welcome_list_text: SharedString,
    focus_list_text: SharedString,
    blacklist_wide_text: SharedString,
    blacklist_exact_text: SharedString,
    keyword_reply_text: SharedString,
    cron_danmu_text: SharedString,
    draw_list_text: SharedString,
) -> Result<AppConfig> {
    let mut config = AppConfig::load_or_default()?;
    config.room_id = room_id.trim().parse()?;
    config.danmu_len = danmu_len;
    config.entry_msg = entry_msg.to_string();
    config.goodbye_info = goodbye_info.to_string();
    config.pk_notice = pk_notice;
    config.interact_word = welcome_enabled;
    config.entry_effect = entry_effect;
    config.thanks_gift = thanks_gift;
    config.thanks_focus = thanks_focus;
    config.thanks_share = thanks_share;
    config.cron_danmu = cron_danmu;
    config.keyword_reply = keyword_reply;
    config.draw_by_lot = draw_by_lot;
    config.sign_in_enable = sign_in_enable;
    config.robot_name = robot_name.to_string();
    config.talk_robot_cmd = talk_robot_cmd.to_string();
    config.robot_mode = if robot_mode_index == 1 {
        "ChatGPT"
    } else {
        "QingYunKe"
    }
    .to_string();
    config.chatgpt.api_token = chatgpt_token.to_string();
    config.chatgpt.api_url = chatgpt_api_url.to_string();
    config.chatgpt.prompt = chatgpt_prompt.to_string();
    config.welcome_danmu = parse_lines(&welcome_list_text);
    config.focus_danmu = parse_lines(&focus_list_text);
    config.welcome_blacklist_wide = parse_lines(&blacklist_wide_text);
    config.welcome_blacklist = parse_lines(&blacklist_exact_text);
    config.keyword_reply_list = parse_keyword_reply(&keyword_reply_text);
    config.cron_danmu_list = parse_cron_danmu(&cron_danmu_text);
    config.draw_lots_list = parse_lines(&draw_list_text);
    Ok(config)
}

fn join_lines(items: &[String]) -> String {
    items.join("\n")
}

fn parse_lines(value: &str) -> Vec<String> {
    value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

fn format_keyword_reply(items: &std::collections::BTreeMap<String, String>) -> String {
    items
        .iter()
        .map(|(keyword, reply)| format!("{keyword}={reply}"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse_keyword_reply(value: &str) -> std::collections::BTreeMap<String, String> {
    value
        .lines()
        .filter_map(|line| {
            let (keyword, reply) = line.split_once('=')?;
            let keyword = keyword.trim();
            let reply = reply.trim();
            (!keyword.is_empty() && !reply.is_empty())
                .then(|| (keyword.to_string(), reply.to_string()))
        })
        .collect()
}

fn format_cron_danmu(items: &[config::CronDanmu]) -> String {
    items
        .iter()
        .map(|item| format!("{}|{}|{}", item.cron, item.random, item.danmu.join(";")))
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse_cron_danmu(value: &str) -> Vec<config::CronDanmu> {
    value
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '|');
            let cron = parts.next()?.trim();
            let random = parts.next()?.trim().parse::<bool>().unwrap_or(false);
            let danmu = parts
                .next()
                .map(|items| {
                    items
                        .split(';')
                        .map(str::trim)
                        .filter(|item| !item.is_empty())
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            (!cron.is_empty() && !danmu.is_empty()).then(|| config::CronDanmu {
                cron: cron.to_string(),
                random,
                danmu,
            })
        })
        .collect()
}

fn append_log(app: &MainWindow, line: &str) {
    let now = chrono::Local::now().format("%H:%M:%S");
    let current = app.get_log_text();
    let next = if current.is_empty() {
        format!("[{now}] {line}")
    } else {
        format!("{current}\n[{now}] {line}")
    };
    app.set_log_text(next.into());
}

fn update_ui<F>(weak: &slint::Weak<MainWindow>, f: F)
where
    F: FnOnce(&MainWindow) + Send + 'static,
{
    let weak = weak.clone();
    let _ = slint::invoke_from_event_loop(move || {
        if let Some(app) = weak.upgrade() {
            f(&app);
        }
    });
}

fn app_room_id(weak: &slint::Weak<MainWindow>) -> i64 {
    weak.upgrade()
        .and_then(|app| app.get_room_id().parse::<i64>().ok())
        .unwrap_or(3)
}

fn ensure_dirs() -> Result<()> {
    std::fs::create_dir_all("etc")?;
    std::fs::create_dir_all("token")?;
    std::fs::create_dir_all("logs")?;
    Ok(())
}
