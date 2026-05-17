//! FrameProcessor trait 和 ProcessorChain

use async_trait::async_trait;
use tokio::sync::mpsc;

use super::frame::Frame;

/// 帧处理器 — pipeline 中的一个节点
///
/// 每个处理器从上游 channel 读帧、处理后写入下游 channel。
/// 单向数据流，无共享状态，天然 actor 化。
#[async_trait]
pub trait FrameProcessor: Send + 'static {
    /// 处理一帧，返回 0..N 个输出帧
    async fn process(&mut self, frame: Frame) -> Vec<Frame>;

    /// 处理器名称（用于日志）
    fn name(&self) -> &'static str;
}

/// 将一组处理器串联成线性 pipeline
///
/// 运行后每个处理器占用一个 tokio task，帧通过 mpsc channel 传递。
pub struct ProcessorChain {
    processors: Vec<Box<dyn FrameProcessor>>,
    channel_size: usize,
}

impl ProcessorChain {
    pub fn new() -> Self {
        Self {
            processors: Vec::new(),
            channel_size: 64,
        }
    }

    pub fn with_channel_size(mut self, size: usize) -> Self {
        self.channel_size = size;
        self
    }

    pub fn add<P: FrameProcessor>(mut self, processor: P) -> Self {
        self.processors.push(Box::new(processor));
        self
    }

    /// 启动 pipeline，返回 (输入端, 输出端)
    ///
    /// 外部往 input_tx 发帧，从 output_rx 读结果。
    pub fn spawn(self) -> (mpsc::Sender<Frame>, mpsc::Receiver<Frame>) {
        let (input_tx, rx) = mpsc::channel::<Frame>(self.channel_size);
        let (final_tx, output_rx) = mpsc::channel::<Frame>(self.channel_size);

        let cap = self.channel_size;
        tokio::spawn(async move {
            let _current_rx = rx;

            // 为每个处理器建立 input→output channel
            let mut channels: Vec<(mpsc::Sender<Frame>, mpsc::Receiver<Frame>)> = self
                .processors
                .iter()
                .map(|_| mpsc::channel::<Frame>(cap))
                .collect();

            // 启动每个处理器 task
            for (i, mut processor) in self.processors.into_iter().enumerate() {
                let (_, mut proc_rx) = channels.remove(0);
                let next_tx = if i < channels.len() {
                    channels[i].0.clone()
                } else {
                    final_tx.clone()
                };

                tokio::spawn(async move {
                    while let Some(frame) = proc_rx.recv().await {
                        let outputs = processor.process(frame).await;
                        for out in outputs {
                            if next_tx.send(out).await.is_err() {
                                break;
                            }
                        }
                    }
                });
            }
        });

        (input_tx, output_rx)
    }
}

impl Default for ProcessorChain {
    fn default() -> Self {
        Self::new()
    }
}
