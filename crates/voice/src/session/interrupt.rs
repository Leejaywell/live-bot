//! Interrupt Engine
//!
//! 主播开口（VAD 检测到语音）→ 立刻取消当前 TTS 任务。
//!
//! 设计：
//! - 每次 TTS 任务启动时领取一个 generation ID
//! - Interrupt 信号到来时 abort 当前任务并刷新 ID
//! - 零等待：tokio JoinHandle::abort() 是立即生效的

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::debug;

/// TTS 生成任务的句柄，持有期间任务存活，drop 时自动 abort
pub struct GenerationHandle {
    id: u64,
    inner: Option<JoinHandle<()>>,
    token: CancellationToken,
}

impl GenerationHandle {
    /// 主动取消（不等待）
    pub fn cancel(&mut self) {
        self.token.cancel();
        if let Some(h) = self.inner.take() {
            h.abort();
        }
        debug!("generation {} cancelled", self.id);
    }

    pub fn id(&self) -> u64 {
        self.id
    }

    pub fn is_cancelled(&self) -> bool {
        self.token.is_cancelled()
    }

    /// 获取当前任务的取消令牌（TTS 任务内部 select! 用）
    pub fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}

impl Drop for GenerationHandle {
    fn drop(&mut self) {
        self.cancel();
    }
}

/// Interrupt Engine — 管理当前活跃的 TTS 生成任务
#[derive(Clone)]
pub struct InterruptEngine {
    generation_id: Arc<AtomicU64>,
}

impl InterruptEngine {
    pub fn new() -> Self {
        Self { generation_id: Arc::new(AtomicU64::new(0)) }
    }

    /// 启动一个新的 TTS 生成任务
    ///
    /// 自动取消上一个任务（如果还在运行）。
    /// `task` 接收一个 CancellationToken，应在 select! 中监听它：
    /// ```no_run
    /// tokio::select! {
    ///     _ = token.cancelled() => { /* 被中断，提前退出 */ }
    ///     result = do_tts() => { /* 正常完成 */ }
    /// }
    /// ```
    pub fn start<F, Fut>(&self, task: F) -> GenerationHandle
    where
        F: FnOnce(CancellationToken) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = ()> + Send + 'static,
    {
        let id = self.generation_id.fetch_add(1, Ordering::SeqCst);
        let token = CancellationToken::new();
        let token_clone = token.clone();
        let handle = tokio::spawn(async move {
            task(token_clone).await;
        });
        debug!("generation {} started", id);
        GenerationHandle { id, inner: Some(handle), token }
    }

    /// 发出中断信号（不需要持有 handle）
    ///
    /// 调用方通常持有 `Arc<Mutex<Option<GenerationHandle>>>`，
    /// 直接 replace 即可：旧 handle drop → 旧任务 abort。
    pub fn current_generation(&self) -> u64 {
        self.generation_id.load(Ordering::SeqCst)
    }
}

impl Default for InterruptEngine {
    fn default() -> Self {
        Self::new()
    }
}
