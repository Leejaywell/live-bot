//! 自适应延迟监控
//!
//! 跟踪音频缓冲区填充率和 TTS 合成 RTT，动态调整目标缓冲量。
//!
//! 原理：
//! - fill_ratio = 当前缓冲样本数 / 最大缓冲样本数
//! - fill_ratio < LOW_WATER  → Underrun 风险，扩大缓冲上限
//! - fill_ratio > HIGH_WATER → 延迟积累，收缩缓冲上限
//! - 最终收敛到 NOMINAL_WATER 附近
//!
//! LatencyMonitor 是 Send + Sync，可在 cpal 回调和接收线程间共享。

use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;

/// 缓冲健康状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BufferHealth {
    /// 缓冲不足（< LOW_WATER），可能有爆音
    Underrun,
    /// 正常范围
    Nominal,
    /// 积压（> HIGH_WATER），延迟累积
    Backlogged,
}

const LOW_WATER: f32 = 0.15;    // 低水位
const NOMINAL_WATER: f32 = 0.35; // 目标水位
const HIGH_WATER: f32 = 0.65;   // 高水位
const MIN_BUFFER: usize = 48000 / 5;  // 最少 200ms @ 48kHz
const MAX_BUFFER: usize = 48000 * 4;  // 最多 4s @ 48kHz

/// 延迟监控器（可 Arc 共享）
pub struct LatencyMonitor {
    /// 当前缓冲样本数（由 push 侧写入，fill 回调读取）
    pub fill: Arc<AtomicUsize>,
    /// 当前目标最大缓冲量（自适应调整）
    pub target_max: Arc<AtomicUsize>,
    /// 最近一次 TTS 合成耗时（ms）
    pub last_synthesis_ms: Arc<AtomicU32>,
    /// 累计 underrun 次数
    pub underrun_count: Arc<AtomicUsize>,
    /// 累计 backlog 次数
    pub backlog_count: Arc<AtomicUsize>,
}

impl Default for LatencyMonitor {
    fn default() -> Self {
        Self::new(48000 * 2) // 默认 2s
    }
}

impl LatencyMonitor {
    pub fn new(initial_max: usize) -> Self {
        Self {
            fill: Arc::new(AtomicUsize::new(0)),
            target_max: Arc::new(AtomicUsize::new(initial_max)),
            last_synthesis_ms: Arc::new(AtomicU32::new(0)),
            underrun_count: Arc::new(AtomicUsize::new(0)),
            backlog_count: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// 当前缓冲填充率（0.0 – 1.0）
    pub fn fill_ratio(&self) -> f32 {
        let f = self.fill.load(Ordering::Relaxed);
        let m = self.target_max.load(Ordering::Relaxed).max(1);
        (f as f32 / m as f32).min(1.0)
    }

    /// 当前缓冲健康状态
    pub fn health(&self) -> BufferHealth {
        let r = self.fill_ratio();
        if r < LOW_WATER {
            BufferHealth::Underrun
        } else if r > HIGH_WATER {
            BufferHealth::Backlogged
        } else {
            BufferHealth::Nominal
        }
    }

    /// 当前目标延迟（ms，按 48kHz 单声道估算）
    pub fn target_latency_ms(&self) -> u32 {
        let samples = self.target_max.load(Ordering::Relaxed);
        (samples as u64 * 1000 / 48000) as u32
    }

    /// 记录一次 TTS 合成完成（push 侧调用）
    pub fn record_synthesis(&self, ms: u32) {
        self.last_synthesis_ms.store(ms, Ordering::Relaxed);
    }

    /// 收到新样本后更新填充量（push 侧）
    pub fn on_push(&self, added: usize) {
        self.fill.fetch_add(added, Ordering::Relaxed);
        self.adapt();
    }

    /// cpal 回调消耗样本后更新（drain 侧）
    pub fn on_drain(&self, drained: usize) {
        self.fill.fetch_saturating_sub(drained, Ordering::Relaxed);
    }

    /// 根据当前填充率自适应调整缓冲上限
    fn adapt(&self) {
        let ratio = self.fill_ratio();
        let current = self.target_max.load(Ordering::Relaxed);

        if ratio < LOW_WATER {
            // 缓冲偏低 → 扩容 10%
            self.underrun_count.fetch_add(1, Ordering::Relaxed);
            let next = (current + current / 10).min(MAX_BUFFER);
            self.target_max.store(next, Ordering::Relaxed);
        } else if ratio > HIGH_WATER {
            // 积压 → 缩容 5%，快速消化
            self.backlog_count.fetch_add(1, Ordering::Relaxed);
            let next = (current - current / 20).max(MIN_BUFFER);
            self.target_max.store(next, Ordering::Relaxed);
        } else if ratio < NOMINAL_WATER && current > MIN_BUFFER {
            // 偏空但安全 → 缓慢收缩（减少延迟）
            let next = (current - current / 50).max(MIN_BUFFER);
            self.target_max.store(next, Ordering::Relaxed);
        }
    }

    /// 摘要字符串（用于日志/UI）
    pub fn summary(&self) -> String {
        format!(
            "buf={:.0}% target={}ms rtt={}ms under={} backlog={}",
            self.fill_ratio() * 100.0,
            self.target_latency_ms(),
            self.last_synthesis_ms.load(Ordering::Relaxed),
            self.underrun_count.load(Ordering::Relaxed),
            self.backlog_count.load(Ordering::Relaxed),
        )
    }
}

// AtomicUsize 没有 fetch_saturating_sub，自己实现
trait FetchSaturatingSub {
    fn fetch_saturating_sub(&self, val: usize, order: Ordering) -> usize;
}

impl FetchSaturatingSub for AtomicUsize {
    fn fetch_saturating_sub(&self, val: usize, order: Ordering) -> usize {
        loop {
            let current = self.load(Ordering::Relaxed);
            let next = current.saturating_sub(val);
            if self.compare_exchange(current, next, order, Ordering::Relaxed).is_ok() {
                return current;
            }
        }
    }
}
