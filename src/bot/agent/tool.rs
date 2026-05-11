//! Tool 抽象：定义接口、OpenAI function spec、调用结构体

use std::future::Future;
use std::pin::Pin;

use anyhow::Result;
use serde::{Deserialize, Serialize};

pub type ToolOutput = String;
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// OpenAI tools 列表项（type = "function"）
#[derive(Debug, Clone, Serialize)]
pub struct ToolDefinition {
    pub r#type: &'static str,
    pub function: FunctionSpec,
}

/// 函数声明（name + description + JSON Schema parameters）
#[derive(Debug, Clone, Serialize)]
pub struct FunctionSpec {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// AI 回复中的 tool_calls 条目
#[derive(Debug, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[allow(dead_code)]
    pub r#type: String,
    pub function: FunctionCallInfo,
}

#[derive(Debug, Deserialize)]
pub struct FunctionCallInfo {
    pub name: String,
    pub arguments: String,
}

/// 可被 AgentRuntime 调用的工具接口
pub trait Tool: Send + Sync {
    fn spec(&self) -> FunctionSpec;
    fn execute<'a>(&'a self, args: serde_json::Value) -> BoxFuture<'a, Result<ToolOutput>>;
}

impl ToolDefinition {
    pub fn from(tool: &dyn Tool) -> Self {
        Self { r#type: "function", function: tool.spec() }
    }
}
