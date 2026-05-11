//! SIMD 友好的音频混音器
//!
//! 使用 4 样本块展开的向量化代码，LLVM 在 AArch64（Apple Silicon NEON）
//! 和 x86-64（SSE/AVX2）上均可自动向量化为 SIMD 指令。
//!
//! 公共 API：
//!   - `mix_add(dst, src, gain)` — 将 src * gain 加入 dst（就地混音）
//!   - `normalize(samples, peak)` — 归一化防止削波
//!   - `i16_to_f32_bulk(bytes)` — 批量将 PCM s16le 转换为 f32

/// 将 src * gain 就地叠加到 dst（多路混音核心）
///
/// 内层循环步长 4，LLVM 可自动向量化为 NEON/SSE 指令。
pub fn mix_add(dst: &mut [f32], src: &[f32], gain: f32) {
    let len = dst.len().min(src.len());
    let chunks = len / 4;

    // 4 样本展开：让编译器生成 SIMD 指令
    for i in 0..chunks {
        let b = i * 4;
        dst[b]     += src[b]     * gain;
        dst[b + 1] += src[b + 1] * gain;
        dst[b + 2] += src[b + 2] * gain;
        dst[b + 3] += src[b + 3] * gain;
    }
    // 尾部
    for i in (chunks * 4)..len {
        dst[i] += src[i] * gain;
    }
}

/// 归一化：如果 peak > 1.0 则将所有样本缩放到 [-1, 1]
pub fn normalize(samples: &mut [f32]) {
    let peak = samples.iter().fold(0.0f32, |acc, &s| acc.max(s.abs()));
    if peak > 1.0 {
        let inv = 1.0 / peak;
        for s in samples.iter_mut() {
            *s *= inv;
        }
    }
}

/// 批量将 s16le PCM 字节转换为 f32（4 样本/迭代，SIMD 可展开）
///
/// input：小端 i16 字节流（每 2 字节 = 1 样本）
/// output：f32 样本，[-1.0, 1.0]
pub fn i16_to_f32_bulk(input: &[u8]) -> Vec<f32> {
    let n = input.len() / 2;
    let mut out = Vec::with_capacity(n);
    let chunks = n / 4;

    // 4 样本展开
    for i in 0..chunks {
        let b = i * 8;
        let s0 = i16::from_le_bytes([input[b],     input[b + 1]]) as f32 * (1.0 / 32767.0);
        let s1 = i16::from_le_bytes([input[b + 2], input[b + 3]]) as f32 * (1.0 / 32767.0);
        let s2 = i16::from_le_bytes([input[b + 4], input[b + 5]]) as f32 * (1.0 / 32767.0);
        let s3 = i16::from_le_bytes([input[b + 6], input[b + 7]]) as f32 * (1.0 / 32767.0);
        out.push(s0);
        out.push(s1);
        out.push(s2);
        out.push(s3);
    }
    // 尾部
    for i in (chunks * 4)..n {
        let b = i * 2;
        out.push(i16::from_le_bytes([input[b], input[b + 1]]) as f32 * (1.0 / 32767.0));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mix_add_sums_correctly() {
        let mut dst = vec![0.5f32; 8];
        let src = vec![0.1f32; 8];
        mix_add(&mut dst, &src, 1.0);
        for s in &dst {
            assert!((s - 0.6).abs() < 1e-6, "expected 0.6, got {s}");
        }
    }

    #[test]
    fn mix_add_applies_gain() {
        let mut dst = vec![0.0f32; 4];
        let src = vec![1.0f32; 4];
        mix_add(&mut dst, &src, 0.5);
        for s in &dst {
            assert!((s - 0.5).abs() < 1e-6);
        }
    }

    #[test]
    fn normalize_scales_over_1() {
        let mut samples = vec![0.0, 2.0, -1.5, 0.5];
        normalize(&mut samples);
        assert!((samples[1] - 1.0).abs() < 1e-6);
        assert!((samples[2] - -0.75).abs() < 1e-6);
    }

    #[test]
    fn i16_to_f32_bulk_roundtrip() {
        let values: Vec<i16> = vec![0, 32767, -32768, 16384];
        let bytes: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
        let f = i16_to_f32_bulk(&bytes);
        assert_eq!(f.len(), 4);
        assert!((f[0]).abs() < 1e-6);
        assert!((f[1] - 1.0).abs() < 0.001);
        assert!(f[2] < -0.99);
    }
}
