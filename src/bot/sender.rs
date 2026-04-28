use tokio::sync::mpsc;
use tokio::time::{Duration, sleep};

pub fn chunk_message(message: &str, limit: i32) -> Vec<String> {
    let limit = limit.max(1) as usize;
    let chars: Vec<char> = message.chars().collect();
    if chars.is_empty() {
        return Vec::new();
    }

    chars
        .chunks(limit)
        .map(|chunk| chunk.iter().collect::<String>())
        .collect()
}

pub async fn run_send_queue<F, Fut>(
    mut rx: mpsc::Receiver<String>,
    danmu_len: i32,
    mut send: F,
    mut on_log: impl FnMut(String) + Send + 'static,
) where
    F: FnMut(String) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = anyhow::Result<()>> + Send,
{
    while let Some(message) = rx.recv().await {
        for chunk in chunk_message(&message, danmu_len) {
            match send(chunk.clone()).await {
                Ok(()) => on_log(format!("自动弹幕已发送: {chunk}")),
                Err(err) => on_log(format!("自动弹幕发送失败: {err}")),
            }
            sleep(Duration::from_secs(1)).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::chunk_message;

    #[test]
    fn chunks_ascii_text() {
        assert_eq!(chunk_message("abcdef", 2), vec!["ab", "cd", "ef"]);
    }

    #[test]
    fn chunks_chinese_text_by_chars() {
        assert_eq!(
            chunk_message("欢迎来到直播间", 3),
            vec!["欢迎来", "到直播", "间"]
        );
    }

    #[test]
    fn empty_message_has_no_chunks() {
        assert!(chunk_message("", 20).is_empty());
    }
}
