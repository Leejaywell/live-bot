pub mod runtime;
pub mod tool;
pub mod tools;

pub use runtime::{AgentRuntime, AiHttpClient};
pub use tools::{GetSessionStatsTool, SendDanmuTool};

// re-exported for external tooling
#[allow(unused_imports)]
pub use tool::{FunctionCallInfo, ToolCall};

use crate::bot::memory::SessionMemory;
use crate::config::{AiBot, AppConfig};
#[allow(unused_imports)]
use crate::live_platform::bilibili::api::BiliApi;
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
pub async fn call_ai<H: AiHttpClient + ?Sized>(
    http: &H,
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

/// AI 流式调用入口：支持在生成过程中通过 channel 回传文本块（用于尽早启动 TTS）
#[allow(dead_code)]
pub async fn call_ai_streaming<H: AiHttpClient + ?Sized>(
    http: &H,
    config: &AppConfig,
    bot_id: &str,
    prompt: &str,
    uid: i64,
    uname: &str,
    memory: &Arc<std::sync::Mutex<SessionMemory>>,
    chunk_tx: tokio::sync::mpsc::UnboundedSender<String>,
) -> String {
    let Some(bot) = config.ai_bots.iter().find(|b| b.id == bot_id) else {
        return String::new();
    };
    let Some(provider) = config.ai_providers.iter().find(|p| p.id == bot.provider_id) else {
        return String::new();
    };

    let (history, sys) = {
        let mut mem = memory.lock().unwrap_or_else(|e| e.into_inner());
        let _ = mem.note_speaker(uid, uname);
        let sys = bot.system_prompt.replace("{{name}}", &bot.nickname);
        (mem.history_pairs(bot_id), sys)
    };

    let mut messages = vec![serde_json::json!({"role": "system", "content": sys})];
    for (role, content) in &history {
        messages.push(serde_json::json!({"role": role, "content": content}));
    }
    messages.push(serde_json::json!({"role": "user", "content": prompt}));

    let mut stream = match http
        .chat_completions_stream_with_opts(provider, &messages, None)
        .await
    {
        Ok(stream) => stream,
        Err(e) => {
            eprintln!("[AI stream] 调用失败: {e}");
            return String::new();
        }
    };

    let mut reply = String::new();
    let mut speak_buf = String::new();
    while let Some(item) = stream.recv().await {
        let delta = match item {
            Ok(delta) => delta,
            Err(_) => break,
        };
        reply.push_str(&delta);
        speak_buf.push_str(&delta);

        // 如果检测到句子边界，尝试推送给 TTS
        if should_flush_voice_chunk(&speak_buf, reply.chars().count()) {
            let chunk = prepare_voice_tts_chunk(&mut speak_buf, false);
            let _ = chunk_tx.send(chunk);
        }
    }

    if !speak_buf.trim().is_empty() {
        let chunk = prepare_voice_tts_chunk(&mut speak_buf, true);
        let _ = chunk_tx.send(chunk);
    }

    {
        let mut mem = memory.lock().unwrap_or_else(|e| e.into_inner());
        mem.push_turn(bot_id, prompt.to_string(), reply.clone());
    }

    reply
}

/// 语音模式 AI 调用：使用 voice_system_prompt 替换 {{gender}}，而非 bot 的人设提示词。
#[allow(dead_code)]
pub async fn call_ai_voice<H: AiHttpClient + ?Sized>(
    http: &H,
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
    let temperature = if config.voice_temperature > 0.0 {
        Some(config.voice_temperature)
    } else {
        None
    };
    let reply = agent
        .run_with_provider_opts(
            http,
            provider,
            &sys,
            &history,
            &enriched_prompt,
            temperature,
        )
        .await
        .unwrap_or_else(|e| {
            eprintln!("[AI] 调用失败: {e}");
            String::new()
        });
    let reply = if config.voice_reply_max_chars > 0 {
        reply
            .chars()
            .take(config.voice_reply_max_chars as usize)
            .collect::<String>()
    } else {
        reply
    };
    {
        let mut mem = memory.lock().unwrap_or_else(|e| e.into_inner());
        mem.push_turn(bot_id, prompt.to_string(), reply.clone());
    }
    reply
}

pub async fn call_ai_voice_streaming<H: AiHttpClient + ?Sized>(
    http: &H,
    config: &AppConfig,
    bot_id: &str,
    prompt: &str,
    memory: &Arc<std::sync::Mutex<SessionMemory>>,
    chunk_tx: tokio::sync::mpsc::UnboundedSender<String>,
) -> String {
    call_ai_voice_streaming_inner(http, config, bot_id, prompt, memory, Some(chunk_tx), true).await
}

pub async fn call_ai_voice_draft<H: AiHttpClient + ?Sized>(
    http: &H,
    config: &AppConfig,
    bot_id: &str,
    prompt: &str,
    memory: &Arc<std::sync::Mutex<SessionMemory>>,
) -> String {
    call_ai_voice_streaming_inner(http, config, bot_id, prompt, memory, None, false).await
}

pub fn remember_ai_voice_reply(
    bot_id: &str,
    prompt: &str,
    reply: &str,
    memory: &Arc<std::sync::Mutex<SessionMemory>>,
) {
    let mut mem = memory.lock().unwrap_or_else(|e| e.into_inner());
    mem.push_turn(bot_id, prompt.to_string(), reply.to_string());
}

async fn call_ai_voice_streaming_inner<H: AiHttpClient + ?Sized>(
    http: &H,
    config: &AppConfig,
    bot_id: &str,
    prompt: &str,
    memory: &Arc<std::sync::Mutex<SessionMemory>>,
    chunk_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    remember: bool,
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
    let history = {
        let mem = memory.lock().unwrap_or_else(|e| e.into_inner());
        mem.history_pairs(bot_id)
    };
    let temperature = if config.voice_temperature > 0.0 {
        Some(config.voice_temperature)
    } else {
        None
    };
    let mut messages = vec![serde_json::json!({"role": "system", "content": sys})];
    for (role, content) in &history {
        messages.push(serde_json::json!({"role": role, "content": content}));
    }
    messages.push(serde_json::json!({"role": "user", "content": prompt}));

    let mut stream = match http
        .chat_completions_stream_with_opts(provider, &messages, temperature)
        .await
    {
        Ok(stream) => stream,
        Err(err) => {
            eprintln!("[AI voice stream] 调用失败: {err}");
            let reply = http
                .chat_completions_raw_with_opts(provider, &messages, None, temperature)
                .await
                .ok()
                .and_then(|response| {
                    response["choices"][0]["message"]["content"]
                        .as_str()
                        .map(str::to_string)
                })
                .unwrap_or_default();
            if !reply.is_empty() {
                if let Some(tx) = chunk_tx.as_ref() {
                    let _ = tx.send(reply.clone());
                }
                if remember {
                    remember_ai_voice_reply(bot_id, prompt, &reply, memory);
                }
            }
            return reply;
        }
    };

    let mut reply = String::new();
    let mut speak_buf = String::new();
    while let Some(item) = stream.recv().await {
        let delta = match item {
            Ok(delta) => delta,
            Err(err) => {
                eprintln!("[AI voice stream] 读取失败: {err}");
                break;
            }
        };
        reply.push_str(&delta);
        speak_buf.push_str(&delta);
        if should_flush_voice_chunk(&speak_buf, reply.chars().count()) {
            let chunk = prepare_voice_tts_chunk(&mut speak_buf, false);
            if let Some(tx) = chunk_tx.as_ref() {
                let _ = tx.send(chunk);
            }
        }
        if config.voice_reply_max_chars > 0
            && reply.chars().count() >= config.voice_reply_max_chars as usize
        {
            break;
        }
    }

    if !speak_buf.trim().is_empty() {
        let chunk = prepare_voice_tts_chunk(&mut speak_buf, true);
        if let Some(tx) = chunk_tx.as_ref() {
            let _ = tx.send(chunk);
        }
    }

    let reply = if config.voice_reply_max_chars > 0 {
        reply
            .chars()
            .take(config.voice_reply_max_chars as usize)
            .collect::<String>()
    } else {
        reply
    };
    if remember {
        remember_ai_voice_reply(bot_id, prompt, &reply, memory);
    }
    reply
}

fn should_flush_voice_chunk(text: &str, total_chars: usize) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    let char_count = trimmed.chars().count();
    let ends_with_sentence = trimmed
        .chars()
        .last()
        .is_some_and(is_voice_sentence_boundary);
    if ends_with_sentence && char_count >= 6 {
        return true;
    }

    let soft_boundary = trimmed.chars().last().is_some_and(is_voice_soft_boundary);
    let threshold = if total_chars <= 28 { 14 } else { 24 };
    char_count >= threshold && (soft_boundary || char_count >= threshold + 6)
}

fn prepare_voice_tts_chunk(buf: &mut String, is_final: bool) -> String {
    let mut chunk = std::mem::take(buf).trim().to_string();
    if chunk.is_empty() {
        return chunk;
    }
    if !chunk
        .chars()
        .last()
        .is_some_and(|ch| is_voice_sentence_boundary(ch) || is_voice_soft_boundary(ch))
    {
        chunk.push(if is_final { '。' } else { '，' });
    }
    chunk
}

fn is_voice_sentence_boundary(ch: char) -> bool {
    matches!(ch, '。' | '！' | '？' | '…' | '.' | '!' | '?' | '\n')
}

fn is_voice_soft_boundary(ch: char) -> bool {
    matches!(ch, '，' | '、' | '；' | ';' | ',' | ':' | '：')
}
