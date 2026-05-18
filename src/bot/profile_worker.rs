//! 粉丝档案 LLM 分析后台 worker
//!
//! - 单消费者：避免 LLM API 并发与速率问题
//! - in_flight 去重：同一 uid 入队中或正在分析则跳过
//! - 调度：record_and_handle_event 在满足阈值时 enqueue(uid)
//! - 失败：仅记录日志，不影响主线程

use std::collections::HashSet;
use std::sync::{Arc, Mutex, OnceLock};

use anyhow::{Context, Result, anyhow};
use serde::Deserialize;
use tokio::sync::mpsc;

use crate::api::BiliApi;
use crate::config::{AiProvider, AppConfig};
use crate::storage::{Storage, UserProfile};

/// 全局唯一的 worker handle。main 启动时 install，record_and_handle_event 调 try_enqueue。
static GLOBAL_WORKER: OnceLock<ProfileWorker> = OnceLock::new();

pub fn install(worker: ProfileWorker) {
    let _ = GLOBAL_WORKER.set(worker);
}

pub fn try_enqueue(uid: i64) {
    if let Some(w) = GLOBAL_WORKER.get() {
        w.enqueue(uid);
    }
}

/// 提示词版本号；调整 prompt 时手动 +1，迫使下次重算时覆盖旧记录
pub const PROMPT_VERSION: i64 = 1;

const MAX_DANMU_FOR_PROMPT: i64 = 50;

#[derive(Clone)]
pub struct ProfileWorker {
    tx: mpsc::UnboundedSender<i64>,
    in_flight: Arc<Mutex<HashSet<i64>>>,
}

impl ProfileWorker {
    /// 请求分析某个 uid。已在队列或处理中则忽略。
    pub fn enqueue(&self, uid: i64) {
        if uid <= 0 {
            return;
        }
        {
            let mut s = self.in_flight.lock().expect("in_flight poisoned");
            if !s.insert(uid) {
                return;
            }
        }
        let _ = self.tx.send(uid);
    }
}

/// 在已有的 tokio runtime 里启动 worker task，返回 handle（可 clone 给多处）。
pub fn spawn(storage: Arc<Storage>, http: BiliApi, rt: &tokio::runtime::Runtime) -> ProfileWorker {
    let (tx, mut rx) = mpsc::unbounded_channel::<i64>();
    let in_flight = Arc::new(Mutex::new(HashSet::new()));
    let in_flight_task = in_flight.clone();
    rt.spawn(async move {
        while let Some(uid) = rx.recv().await {
            if let Err(e) = analyze_user(&storage, &http, uid).await {
                eprintln!("[profile_worker] uid={uid} 分析失败: {e}");
            }
            let mut s = in_flight_task.lock().expect("in_flight poisoned");
            s.remove(&uid);
        }
    });
    ProfileWorker { tx, in_flight }
}

#[derive(Deserialize, Default)]
struct LlmOutput {
    #[serde(default)]
    summary: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    topics: Vec<String>,
}

async fn analyze_user(storage: &Storage, http: &BiliApi, uid: i64) -> Result<()> {
    let Some(profile) = storage.get_user_profile(uid)? else {
        return Ok(());
    };
    let danmu = storage.recent_danmu_for_uid(uid, MAX_DANMU_FOR_PROMPT)?;
    if danmu.is_empty() {
        return Ok(());
    }

    let provider = active_llm_provider()?;
    let prompt = build_prompt(&profile, &danmu);
    let messages = vec![
        serde_json::json!({
            "role": "system",
            "content": "你是观众画像分析师。严格输出 JSON，不要 markdown 围栏，不要解释。"
        }),
        serde_json::json!({"role": "user", "content": prompt}),
    ];

    let resp = http
        .chat_completions_raw_with_opts(&provider, &messages, None, Some(0.3))
        .await
        .context("LLM 调用失败")?;
    let content = resp
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("LLM 响应缺少 content"))?;

    // 容错：剥掉常见 markdown 代码围栏
    let trimmed = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let parsed: LlmOutput =
        serde_json::from_str(trimmed).with_context(|| format!("LLM 返回非 JSON: {trimmed}"))?;
    if parsed.summary.is_empty() {
        return Err(anyhow!("LLM summary 为空"));
    }

    let tags_json = serde_json::to_string(&parsed.tags)?;
    let topics_json = serde_json::to_string(&parsed.topics)?;
    storage.update_profile_ai_fields(
        uid,
        &parsed.summary,
        &tags_json,
        &topics_json,
        PROMPT_VERSION,
    )?;
    Ok(())
}

fn active_llm_provider() -> Result<AiProvider> {
    let cfg = AppConfig::load_or_default()?;
    cfg.ai_providers
        .iter()
        .find(|p| p.id == cfg.active_provider_id && p.provider_type == "llm")
        .cloned()
        .or_else(|| {
            cfg.ai_providers
                .iter()
                .find(|p| p.provider_type == "llm" && p.enabled)
                .cloned()
        })
        .ok_or_else(|| anyhow!("没有可用的 LLM provider"))
}

fn build_prompt(profile: &UserProfile, danmu: &[String]) -> String {
    let active_hours = if profile.active_hours.is_empty() {
        "(无)".to_string()
    } else {
        profile.active_hours.clone()
    };
    let mut s = String::with_capacity(1024);
    s.push_str("基于以下信息，给该直播间观众生成画像。\n\n");
    s.push_str("【统计】\n");
    s.push_str(&format!("- 累计弹幕条数: {}\n", profile.total_danmu_count));
    s.push_str(&format!(
        "- 累计礼物价值（瓜子）: {}\n",
        profile.total_gift_value
    ));
    s.push_str(&format!("- 累计 SC 价值: {}\n", profile.total_sc_value));
    s.push_str(&format!("- 进场次数: {}\n", profile.enter_count));
    s.push_str(&format!("- 牌子等级: {}\n", profile.fan_level));
    s.push_str(&format!(
        "- 是否舰长: {}\n",
        if profile.is_guard == 1 { "是" } else { "否" }
    ));
    s.push_str(&format!("- 24h 活跃直方图: {}\n", active_hours));
    s.push_str(&format!("- 首次见到: {}\n", profile.first_seen_at));
    s.push_str(&format!("- 最近见到: {}\n", profile.last_seen_at));
    s.push_str("\n【最近弹幕（最新在前）】\n");
    for (i, d) in danmu.iter().enumerate() {
        s.push_str(&format!("{}. {}\n", i + 1, d));
    }
    s.push_str(
        "\n请输出 JSON：\n{\n  \"summary\": \"一句话画像（30 字内）\",\n  \"tags\": [\"3-6 个标签，例如：二次元/互动型/深夜活跃/慷慨打赏/新粉\"],\n  \"topics\": [\"3-5 个该用户最关心的话题关键词\"]\n}\n",
    );
    s
}
