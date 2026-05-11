pub mod frame;
pub mod processor;

pub use frame::{AudioFrame, ControlFrame, Frame, TextFrame, TranscriptFrame};
pub use processor::{FrameProcessor, ProcessorChain};
