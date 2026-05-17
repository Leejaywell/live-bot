//! Session 记忆：对话历史窗口 + 发言者档案
//!
//! - 每个 AI provider 独立维护滑动窗口（最近 MEMORY_WINDOW 轮）
//! - 每个发言者（uid）记录本场累计互动次数，用于个性化 prompt
//! - SessionMemory 以 Arc<Mutex<>> 在任务间共享，每场直播一个实例

use std::collections::{HashMap, VecDeque};

pub const MEMORY_WINDOW: usize = 10;

#[derive(Debug, Default)]
struct ProviderMemory {
    turns: VecDeque<(String, String)>, // (user, assistant)
}

impl ProviderMemory {
    fn push(&mut self, user: String, assistant: String) {
        if self.turns.len() >= MEMORY_WINDOW {
            self.turns.pop_front();
        }
        self.turns.push_back((user, assistant));
    }

    /// 展开为 OpenAI messages 的 (role, content) 对列表（不含当前 user turn）
    fn as_pairs(&self) -> Vec<(String, String)> {
        let mut out = Vec::with_capacity(self.turns.len() * 2);
        for (u, a) in &self.turns {
            out.push(("user".to_string(), u.clone()));
            out.push(("assistant".to_string(), a.clone()));
        }
        out
    }
}

/// 本场直播单个发言者的档案
#[derive(Debug, Clone)]
pub struct SpeakerProfile {
    /// 与 AI 的互动次数（当场累计）
    pub turn_count: u32,
}

/// 整场直播的 Session 记忆（多 provider 对话历史 + 发言者档案）
#[derive(Debug, Default)]
pub struct SessionMemory {
    providers: HashMap<String, ProviderMemory>,
    speakers: HashMap<i64, SpeakerProfile>,
}

impl SessionMemory {
    pub fn new() -> Self {
        Self::default()
    }

    /// 记录一轮对话（调用 AI 之后）
    pub fn push_turn(&mut self, provider_id: &str, user: String, assistant: String) {
        self.providers
            .entry(provider_id.to_string())
            .or_default()
            .push(user, assistant);
    }

    /// 获取 provider 的历史消息对（用于注入 OpenAI messages）
    pub fn history_pairs(&self, provider_id: &str) -> Vec<(String, String)> {
        self.providers
            .get(provider_id)
            .map(|p| p.as_pairs())
            .unwrap_or_default()
    }

    /// 记录发言者互动（AI 回复前调用，返回最新次数用于 prompt）
    pub fn note_speaker(&mut self, uid: i64, _uname: &str) -> u32 {
        let p = self
            .speakers
            .entry(uid)
            .or_insert_with(|| SpeakerProfile { turn_count: 0 });
        p.turn_count += 1;
        p.turn_count
    }
}
