//! 内置工具实现
//!
//! - SendDanmuTool：让 AI 向直播间发送弹幕
//! - GetSessionStatsTool：AI 查询本场直播统计

use std::sync::{Arc, Mutex};

use anyhow::Result;
use serde_json::{Value, json};
use tokio::sync::mpsc;

use super::tool::{BoxFuture, FunctionSpec, Tool, ToolOutput};
use crate::storage::Storage;

/// 向直播间发送弹幕
pub struct SendDanmuTool {
    pub tx: mpsc::Sender<String>,
}

impl Tool for SendDanmuTool {
    fn spec(&self) -> FunctionSpec {
        FunctionSpec {
            name: "send_danmu".to_string(),
            description: "向直播间发送一条弹幕消息（不超过20字）".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "弹幕内容"
                    }
                },
                "required": ["text"]
            }),
        }
    }

    fn execute<'a>(&'a self, args: Value) -> BoxFuture<'a, Result<ToolOutput>> {
        let text = args["text"].as_str().unwrap_or("").to_string();
        let tx = self.tx.clone();
        Box::pin(async move {
            if text.is_empty() {
                return Ok("错误：弹幕内容为空".to_string());
            }
            tx.send(text.clone())
                .await
                .map_err(|_| anyhow::anyhow!("弹幕队列已关闭"))?;
            Ok(format!("已发送弹幕：{text}"))
        })
    }
}

/// 查询本场直播互动统计
pub struct GetSessionStatsTool {
    pub storage: Arc<Storage>,
    pub session_id: Arc<Mutex<Option<String>>>,
}

impl Tool for GetSessionStatsTool {
    fn spec(&self) -> FunctionSpec {
        FunctionSpec {
            name: "get_session_stats".to_string(),
            description: "查询本场直播的互动统计（弹幕数、礼物价值、关注数、人气等）".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {},
                "required": []
            }),
        }
    }

    fn execute<'a>(&'a self, _args: Value) -> BoxFuture<'a, Result<ToolOutput>> {
        let storage = Arc::clone(&self.storage);
        let session_id = Arc::clone(&self.session_id);
        Box::pin(async move {
            let id = session_id.lock().unwrap_or_else(|e| e.into_inner()).clone();
            let Some(id) = id else {
                return Ok("当前没有进行中的直播场次".to_string());
            };
            match storage.live_session_summary(&id) {
                Ok(s) => Ok(format!(
                    "本场直播：弹幕 {} 条，互动 {} 次，礼物价值 {} 电池，新增关注 {} 人，舰长购买 {} 次，峰值人气 {}",
                    s.danmu_count,
                    s.interact_count,
                    s.gift_value,
                    s.follow_count,
                    s.guard_buy_count,
                    s.peak_popularity,
                )),
                Err(e) => Ok(format!("查询失败：{e}")),
            }
        })
    }
}
