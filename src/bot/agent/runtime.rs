//! Agent 运行时：tool-calling 循环
//!
//! 流程：
//!   1. 用工具列表 + messages 调用 AI
//!   2. AI 返回 tool_calls → 执行工具 → 追加结果 → 继续
//!   3. AI 返回文本 → 结束，返回最终回复
//!
//! 最多执行 MAX_TOOL_ROUNDS 轮工具调用，防止无限循环。

use std::sync::Arc;

use anyhow::Result;
use serde_json::{Value, json};

use super::tool::{Tool, ToolCall, ToolDefinition};
use crate::api::BiliApi;
use crate::config::AiProvider;

const MAX_TOOL_ROUNDS: usize = 3;

pub struct AgentRuntime {
    tools: Vec<Arc<dyn Tool>>,
}

impl Default for AgentRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentRuntime {
    pub fn new() -> Self {
        Self { tools: Vec::new() }
    }

    pub fn register(mut self, tool: impl Tool + 'static) -> Self {
        self.tools.push(Arc::new(tool));
        self
    }

    /// 直接传入 provider 引用（新接口，用于 bot 路由）
    pub async fn run_with_provider(
        &self,
        http: &BiliApi,
        provider: &AiProvider,
        system_prompt: &str,
        history: &[(String, String)],
        user_prompt: &str,
    ) -> Result<String> {
        self.run_with_provider_opts(http, provider, system_prompt, history, user_prompt, None).await
    }

    pub async fn run_with_provider_opts(
        &self,
        http: &BiliApi,
        provider: &AiProvider,
        system_prompt: &str,
        history: &[(String, String)],
        user_prompt: &str,
        temperature: Option<f32>,
    ) -> Result<String> {
        let tool_defs: Vec<Value> = self
            .tools
            .iter()
            .map(|t| serde_json::to_value(ToolDefinition::from(t.as_ref())).unwrap_or_default())
            .collect();

        let mut messages: Vec<Value> = vec![json!({"role": "system", "content": system_prompt})];
        for (role, content) in history {
            messages.push(json!({"role": role, "content": content}));
        }
        messages.push(json!({"role": "user", "content": user_prompt}));

        let tools_opt = if tool_defs.is_empty() {
            None
        } else {
            Some(tool_defs.as_slice())
        };

        for _ in 0..MAX_TOOL_ROUNDS {
            let response = http
                .chat_completions_raw_with_opts(provider, &messages, tools_opt, temperature)
                .await?;
            let msg = &response["choices"][0]["message"];

            let calls_raw = msg.get("tool_calls").and_then(|v| v.as_array()).cloned();

            if let Some(calls_raw) = calls_raw {
                messages.push(msg.clone());
                for call_val in &calls_raw {
                    let call: ToolCall = match serde_json::from_value(call_val.clone()) {
                        Ok(c) => c,
                        Err(e) => {
                            eprintln!("[agent] tool call 解析失败: {e}");
                            continue;
                        }
                    };
                    let tool = self
                        .tools
                        .iter()
                        .find(|t| t.spec().name == call.function.name);
                    let result = if let Some(tool) = tool {
                        let args: Value =
                            serde_json::from_str(&call.function.arguments).unwrap_or(json!({}));
                        tool.execute(args)
                            .await
                            .unwrap_or_else(|e| format!("工具错误: {e}"))
                    } else {
                        format!("未知工具: {}", call.function.name)
                    };
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": result
                    }));
                }
            } else {
                return Ok(msg["content"].as_str().unwrap_or("").to_string());
            }
        }

        Ok("（Agent 工具调用轮次已达上限）".to_string())
    }
}
