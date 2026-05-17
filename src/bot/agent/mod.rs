pub mod runtime;
pub mod tool;
pub mod tools;

pub use runtime::AgentRuntime;
pub use tools::{GetSessionStatsTool, SendDanmuTool};

// re-exported for external tooling
#[allow(unused_imports)]
pub use tool::{FunctionCallInfo, ToolCall};

use crate::api::BiliApi;
use crate::bot::memory::SessionMemory;
use crate::config::{AiBot, AppConfig};
use std::sync::Arc;

/// 弹幕触发机器人解析结果
pub struct BotResolveResult<'a> {
    pub bot: &'a AiBot,
    pub prompt: String,
}

/// 解析弹幕，确定触发哪个机器人以及对应的提示词
pub fn resolve_bot_danmu<'a>(config: &'a AppConfig, text: &str) -> Option<BotResolveResult<'a>> {
    // 1. @昵称 触发（遍历 ai_bots，已启用的机器人）
    for bot in &config.ai_bots {
        if !bot.enabled {
            continue;
        }
        let trigger = format!("@{}", bot.nickname);
        if text.starts_with(&trigger) {
            let prompt = text[trigger.len()..].trim().to_string();
            if !prompt.is_empty() {
                return Some(BotResolveResult { bot, prompt });
            }
            return None; // 只有 @昵称 没有后续内容不触发
        }
    }

    // 2. 昵称模糊匹配（消息中包含昵称；未启用则静默）
    for bot in &config.ai_bots {
        if !bot.enabled || bot.nickname.is_empty() {
            continue;
        }
        if text.contains(&bot.nickname) {
            return Some(BotResolveResult {
                bot,
                prompt: text.to_string(),
            });
        }
    }

    // 3. 旧版命令触发 -> 第一个启用的机器人
    if !config.talk_robot_cmd.is_empty() {
        let trigger = &config.talk_robot_cmd;
        if (config.fuzzy_match_cmd && text.contains(trigger)) || text.starts_with(trigger) {
            let prompt = if text.starts_with(trigger) {
                text[trigger.len()..].trim().to_string()
            } else {
                text.to_string()
            };
            if !prompt.is_empty() {
                if let Some(bot) = config.ai_bots.iter().find(|b| b.enabled) {
                    return Some(BotResolveResult { bot, prompt });
                }
            }
        }
    }

    None
}

/// AI 调用入口：通过 bot_id 隔离记忆，通过 bot.provider_id 找模型
pub async fn call_ai(
    http: &BiliApi,
    config: &AppConfig,
    bot_id: &str,
    prompt: &str,
    uid: i64,
    uname: &str,
    memory: &Arc<std::sync::Mutex<SessionMemory>>,
    agent: &AgentRuntime,
) -> String {
    // 找 bot（人设信息）
    let Some(bot) = config.ai_bots.iter().find(|b| b.id == bot_id) else {
        eprintln!("[AI] bot {bot_id} not found");
        return String::new();
    };
    let Some(provider) = config.ai_providers.iter().find(|p| p.id == bot.provider_id) else {
        eprintln!("[AI] provider not found for bot {bot_id}");
        return String::new();
    };

    let (history, system_prompt, enriched_prompt) = {
        let mut mem = memory.lock().unwrap_or_else(|e| e.into_inner());
        let count = mem.note_speaker(uid, uname);
        let hint = if count > 1 {
            format!("（{}第{}次与你对话）", uname, count)
        } else {
            format!("（{}首次与你对话）", uname)
        };
        // system_prompt 从 bot 读，{{name}} 替换为机器人昵称
        let sys = bot.system_prompt.replace("{{name}}", &bot.nickname);
        // memory key = bot_id（与 provider_id 无关，确保多机器人隔离）
        let pairs = mem.history_pairs(bot_id);
        (pairs, sys, format!("{} {}", prompt, hint))
    };

    let reply = agent
        .run_with_provider(http, provider, &system_prompt, &history, &enriched_prompt)
        .await
        .unwrap_or_else(|e| {
            eprintln!("[AI] 调用失败: {e}");
            String::new()
        });

    {
        let mut mem = memory.lock().unwrap_or_else(|e| e.into_inner());
        mem.push_turn(bot_id, prompt.to_string(), reply.clone());
    }

    reply
}

/// 语音模式 AI 调用：使用 voice_system_prompt 替换 {{gender}}，而非 bot 的人设提示词。
pub async fn call_ai_voice(
    http: &BiliApi,
    config: &AppConfig,
    bot_id: &str,
    prompt: &str,
    memory: &Arc<std::sync::Mutex<SessionMemory>>,
    agent: &AgentRuntime,
) -> String {
    let Some(bot) = config.ai_bots.iter().find(|b| b.id == bot_id) else {
        eprintln!("[AI voice] bot {bot_id} not found");
        return String::new();
    };
    let Some(provider) = config.ai_providers.iter().find(|p| p.id == bot.provider_id) else {
        eprintln!("[AI voice] provider not found for bot {bot_id}");
        return String::new();
    };
    let sys = config
        .voice_system_prompt
        .replace("{{gender}}", &config.voice_gender);
    let (history, enriched_prompt) = {
        let mem = memory.lock().unwrap_or_else(|e| e.into_inner());
        (mem.history_pairs(bot_id), prompt.to_string())
    };
    let reply = agent
        .run_with_provider(http, provider, &sys, &history, &enriched_prompt)
        .await
        .unwrap_or_else(|e| {
            eprintln!("[AI] 调用失败: {e}");
            String::new()
        });
    {
        let mut mem = memory.lock().unwrap_or_else(|e| e.into_inner());
        mem.push_turn(bot_id, prompt.to_string(), reply.clone());
    }
    reply
}
