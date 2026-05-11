//! 帧类型定义
//!
//! Pipeline 中流动的最小数据单元。所有帧都是 Clone + Send，
//! 音频载荷用 bytes::Bytes 做零拷贝传递。

use bytes::Bytes;

/// Pipeline 中流通的帧
#[derive(Debug, Clone)]
pub enum Frame {
    /// 原始 PCM s16le 音频（16kHz 单声道）
    AudioInput(AudioFrame),
    /// TTS 合成后的 PCM 音频（用于输出）
    AudioOutput(AudioFrame),
    /// ASR 转写文本（可能是中间结果）
    Transcript(TranscriptFrame),
    /// 发往 LLM 的用户输入（经 VAD+ASR 确认完整）
    UserUtterance(TextFrame),
    /// LLM 流式 token
    LlmToken(TextFrame),
    /// 完整 LLM 回复句子（分句后发给 TTS）
    LlmSentence(TextFrame),
    /// 控制信号
    Control(ControlFrame),
}

#[derive(Debug, Clone)]
pub struct AudioFrame {
    /// 零拷贝音频数据
    pub data: Bytes,
    /// 采样率（Hz）
    pub sample_rate: u32,
    /// 声道数
    pub channels: u8,
    /// 单个样本字节数（2 = s16le）
    pub bytes_per_sample: u8,
}

impl AudioFrame {
    pub fn new_pcm16(data: Bytes, sample_rate: u32) -> Self {
        Self { data, sample_rate, channels: 1, bytes_per_sample: 2 }
    }

    /// 样本数
    pub fn sample_count(&self) -> usize {
        self.data.len() / self.bytes_per_sample as usize
    }

    /// 时长（毫秒）
    pub fn duration_ms(&self) -> f32 {
        self.sample_count() as f32 / self.sample_rate as f32 * 1000.0
    }
}

#[derive(Debug, Clone)]
pub struct TextFrame {
    pub text: String,
    /// 是否为最终结果（false = 中间流式结果）
    pub is_final: bool,
}

impl TextFrame {
    pub fn new(text: impl Into<String>) -> Self {
        Self { text: text.into(), is_final: true }
    }
    pub fn partial(text: impl Into<String>) -> Self {
        Self { text: text.into(), is_final: false }
    }
}

#[derive(Debug, Clone)]
pub struct TranscriptFrame {
    pub text: String,
    pub is_final: bool,
    /// 语言代码（如 "zh"）
    pub language: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ControlFrame {
    /// 请求中断当前 TTS 输出
    Interrupt,
    /// Session 关闭
    Shutdown,
    /// 静音开始（VAD 检测）
    SilenceStart,
    /// 语音开始（VAD 检测）
    SpeechStart,
    /// 用户说话完成（语义 turn detection）
    TurnEnd,
}

impl Frame {
    pub fn is_control(&self) -> bool {
        matches!(self, Frame::Control(_))
    }

    pub fn is_interrupt(&self) -> bool {
        matches!(self, Frame::Control(ControlFrame::Interrupt))
    }
}
