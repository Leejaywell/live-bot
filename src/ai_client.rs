use anyhow::Result;
use futures_util::StreamExt as _;

use crate::config::AiProvider;

fn chat_completions_url(provider: &AiProvider) -> String {
    if provider.api_url.ends_with("/chat/completions") {
        provider.api_url.clone()
    } else {
        format!(
            "{}/chat/completions",
            provider.api_url.trim_end_matches('/')
        )
    }
}

/// Low-level OpenAI-compatible chat completions call.
#[allow(dead_code)]
pub async fn chat_completions_raw(
    client: &reqwest::Client,
    provider: &AiProvider,
    messages: &[serde_json::Value],
    tools: Option<&[serde_json::Value]>,
) -> Result<serde_json::Value> {
    chat_completions_raw_with_opts(client, provider, messages, tools, None).await
}

pub async fn chat_completions_raw_with_opts(
    client: &reqwest::Client,
    provider: &AiProvider,
    messages: &[serde_json::Value],
    tools: Option<&[serde_json::Value]>,
    temperature: Option<f32>,
) -> Result<serde_json::Value> {
    let url = chat_completions_url(provider);
    let mut body = serde_json::json!({
        "model": provider.model,
        "messages": messages,
    });
    if let Some(t) = temperature {
        body["temperature"] = serde_json::json!(t);
    }
    if let Some(tools) = tools {
        body["tools"] = serde_json::json!(tools);
        body["tool_choice"] = serde_json::json!("auto");
    }
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", provider.api_key))
        .json(&body)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(response)
}

pub async fn chat_completions_stream_with_opts(
    client: &reqwest::Client,
    provider: &AiProvider,
    messages: &[serde_json::Value],
    temperature: Option<f32>,
) -> Result<tokio::sync::mpsc::UnboundedReceiver<Result<String, String>>> {
    let url = chat_completions_url(provider);
    let mut body = serde_json::json!({
        "model": provider.model,
        "messages": messages,
        "stream": true,
    });
    if let Some(t) = temperature {
        body["temperature"] = serde_json::json!(t);
    }

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", provider.api_key))
        .json(&body)
        .send()
        .await?
        .error_for_status()?;

    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(async move {
        let mut stream = response.bytes_stream();
        let mut pending = String::new();

        while let Some(item) = stream.next().await {
            let bytes = match item {
                Ok(bytes) => bytes,
                Err(err) => {
                    let _ = tx.send(Err(err.to_string()));
                    return;
                }
            };
            pending.push_str(&String::from_utf8_lossy(&bytes));

            while let Some(newline) = pending.find('\n') {
                let line = pending[..newline].trim().to_string();
                pending.drain(..=newline);
                if line.is_empty() || !line.starts_with("data:") {
                    continue;
                }
                let data = line.trim_start_matches("data:").trim();
                if data == "[DONE]" {
                    return;
                }
                let parsed: serde_json::Value = match serde_json::from_str(data) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                let delta = parsed["choices"][0]["delta"]["content"]
                    .as_str()
                    .or_else(|| parsed["choices"][0]["message"]["content"].as_str())
                    .unwrap_or("");
                if !delta.is_empty() {
                    let _ = tx.send(Ok(delta.to_string()));
                }
            }
        }
    });

    Ok(rx)
}
