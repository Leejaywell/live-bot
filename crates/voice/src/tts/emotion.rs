//! 情绪控制器
//!
//! 对文本做轻量情绪分类（规则 + 关键词），
//! 映射到 Edge TTS EdgeTtsConfig 的 rate/pitch/volume 参数。
//!
//! 设计原则：
//! - 无外部模型依赖，纯规则，低延迟
//! - 结果用于修改 SpeakRequest 的 prosody 参数

/// 检测到的情绪类别
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Emotion {
    Neutral,
    Positive,   // 正向、开心、鼓励
    Excited,    // 激动、高能、惊喜
    Gentle,     // 温柔、安慰、轻松
    Negative,   // 负向、失落、抱歉
}

/// 情绪对应的 prosody 参数
#[derive(Debug, Clone)]
pub struct ProsodyParams {
    /// 语速调整（如 "+10%", "-15%"）
    pub rate: Option<String>,
    /// 音高调整（如 "+5Hz", "-3Hz"）
    pub pitch: Option<String>,
    /// 音量调整（如 "+20%"）
    pub volume: Option<String>,
}

impl Default for ProsodyParams {
    fn default() -> Self {
        Self { rate: None, pitch: None, volume: None }
    }
}

/// 对文本进行情绪分类，返回 prosody 参数
pub fn detect_prosody(text: &str) -> ProsodyParams {
    let emotion = classify(text);
    map_to_prosody(emotion)
}

fn classify(text: &str) -> Emotion {
    let text_lower = text.to_lowercase();

    // 激动：感叹号密集、emoji、特定关键词
    let exclamation_count = text.chars().filter(|&c| c == '!' || c == '！').count();
    let has_excited_words = contains_any(
        &text_lower,
        &["哇", "牛", "666", "厉害", "太棒", "绝了", "炸了", "爆了", "冲", "太强", "好爽", "yeah", "wow"],
    );
    if exclamation_count >= 2 || has_excited_words {
        return Emotion::Excited;
    }

    // 正向：感谢、鼓励、问好
    let has_positive_words = contains_any(
        &text_lower,
        &[
            "谢谢", "感谢", "棒", "好的", "好的呀", "欢迎", "加油", "开心", "高兴", "喜欢",
            "太好了", "不错", "赞", "妙", "nice", "good", "great",
        ],
    );
    if has_positive_words {
        return Emotion::Positive;
    }

    // 温柔：安慰、轻松、低调语气
    let has_gentle_words = contains_any(
        &text_lower,
        &["没关系", "慢慢来", "放松", "别担心", "轻松", "小声", "悄悄", "温柔", "嗯嗯", "好好"],
    );
    if has_gentle_words {
        return Emotion::Gentle;
    }

    // 负向：道歉、失落、遗憾
    let has_negative_words = contains_any(
        &text_lower,
        &["抱歉", "对不起", "不好意思", "遗憾", "可惜", "失败", "错了", "糟糕", "难过", "sad"],
    );
    if has_negative_words {
        return Emotion::Negative;
    }

    Emotion::Neutral
}

fn map_to_prosody(emotion: Emotion) -> ProsodyParams {
    match emotion {
        Emotion::Neutral => ProsodyParams::default(),
        Emotion::Positive => ProsodyParams {
            rate: Some("+8%".to_string()),
            pitch: Some("+2Hz".to_string()),
            volume: None,
        },
        Emotion::Excited => ProsodyParams {
            rate: Some("+15%".to_string()),
            pitch: Some("+5Hz".to_string()),
            volume: Some("+10%".to_string()),
        },
        Emotion::Gentle => ProsodyParams {
            rate: Some("-10%".to_string()),
            pitch: Some("-3Hz".to_string()),
            volume: Some("-15%".to_string()),
        },
        Emotion::Negative => ProsodyParams {
            rate: Some("-8%".to_string()),
            pitch: Some("-4Hz".to_string()),
            volume: None,
        },
    }
}

fn contains_any(text: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|kw| text.contains(kw))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excited_text_gets_faster_higher() {
        let p = detect_prosody("哇！太棒了！！");
        assert!(p.rate.as_deref().unwrap_or("").starts_with('+'));
        assert!(p.pitch.as_deref().unwrap_or("").starts_with('+'));
    }

    #[test]
    fn gentle_text_gets_slower_quieter() {
        let p = detect_prosody("没关系，慢慢来就好");
        let rate = p.rate.as_deref().unwrap_or("");
        assert!(rate.starts_with('-'));
    }

    #[test]
    fn neutral_text_has_no_modification() {
        let p = detect_prosody("今天直播间来了很多人");
        assert!(p.rate.is_none());
        assert!(p.pitch.is_none());
    }
}
