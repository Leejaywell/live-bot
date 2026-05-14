//! HuggingFace Hub 模型下载
//!
//! 使用方式：
//! ```ignore
//! let hub = ModelHub::new(model_dir);          // model_dir 来自 config::model_dir()
//!
//! // HuggingFace repo 单文件
//! let path = hub.ensure(ModelSpec::hf(
//!     "onnx-community/silero-vad",
//!     "onnx/model.onnx",
//! ), Some(progress_tx)).await?;
//!
//! // 直链下载
//! let path = hub.ensure(ModelSpec::url(
//!     "https://example.com/model.onnx",
//!     "my_model.onnx",
//! ), None).await?;
//! ```

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tokio::sync::mpsc;

// ── 进度事件 ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct DownloadProgress {
    pub stage: DownloadStage,
    pub downloaded: u64,
    pub total: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DownloadStage {
    Checking,
    Downloading,
    Done,
}

// ── 模型来源描述 ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum ModelSource {
    /// HuggingFace Hub：`repo/file`，可选 revision（默认 main）
    HuggingFace {
        repo: String,
        file: String,
        revision: Option<String>,
    },
    /// 直链 URL，下载后以 `filename` 存入缓存目录
    Url { url: String, filename: String },
}

impl ModelSource {
    pub fn hf(repo: impl Into<String>, file: impl Into<String>) -> Self {
        Self::HuggingFace { repo: repo.into(), file: file.into(), revision: None }
    }

    pub fn hf_rev(
        repo: impl Into<String>,
        file: impl Into<String>,
        revision: impl Into<String>,
    ) -> Self {
        Self::HuggingFace {
            repo:     repo.into(),
            file:     file.into(),
            revision: Some(revision.into()),
        }
    }

    pub fn url(url: impl Into<String>, filename: impl Into<String>) -> Self {
        Self::Url { url: url.into(), filename: filename.into() }
    }

    /// 本地缓存文件名（用于 Url 来源，或 HF 的 file 最终片段）
    fn local_filename(&self) -> &str {
        match self {
            Self::HuggingFace { file, .. } => {
                Path::new(file).file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(file.as_str())
            }
            Self::Url { filename, .. } => filename.as_str(),
        }
    }
}

// ── ModelHub ──────────────────────────────────────────────────────────────────

/// 模型下载 / 缓存管理器。
///
/// `cache_dir` 通常来自 `config::model_dir()`（平台缓存目录下的 `models/`）。
/// HuggingFace Hub 下载会在 `cache_dir/hf/` 使用 hf-hub 原生缓存结构；
/// 直链下载会存入 `cache_dir/`。
pub struct ModelHub {
    cache_dir: PathBuf,
}

impl ModelHub {
    pub fn new(cache_dir: impl Into<PathBuf>) -> Self {
        Self { cache_dir: cache_dir.into() }
    }

    /// 返回模型本地路径。已缓存则直接返回，否则下载。
    ///
    /// `progress_tx`：可选进度通道，调用方用于更新 UI。
    pub async fn ensure(
        &self,
        source: ModelSource,
        progress_tx: Option<mpsc::Sender<DownloadProgress>>,
    ) -> Result<PathBuf> {
        let send = |p: DownloadProgress| {
            if let Some(ref tx) = progress_tx { let _ = tx.try_send(p); }
        };

        send(DownloadProgress { stage: DownloadStage::Checking, downloaded: 0, total: None });

        match &source {
            ModelSource::HuggingFace { repo, file, revision } => {
                self.ensure_hf(repo, file, revision.as_deref(), send).await
            }
            ModelSource::Url { url, filename } => {
                self.ensure_url(url, filename, send).await
            }
        }
    }

    /// 检查是否已缓存（不触发下载）。
    pub fn is_cached(&self, source: &ModelSource) -> bool {
        self.local_path(source).exists()
    }

    // ── 内部 ──────────────────────────────────────────────────────────────────

    fn local_path(&self, source: &ModelSource) -> PathBuf {
        match source {
            ModelSource::Url { filename, .. } => self.cache_dir.join(filename),
            // HF 的实际路径由 hf-hub 决定，此处仅用于 is_cached 的快速检查
            ModelSource::HuggingFace { .. } => {
                self.cache_dir.join("hf").join(source.local_filename())
            }
        }
    }

    async fn ensure_hf(
        &self,
        repo: &str,
        file: &str,
        revision: Option<&str>,
        send: impl Fn(DownloadProgress),
    ) -> Result<PathBuf> {
        use hf_hub::{Repo, RepoType};
        use hf_hub::api::tokio::ApiBuilder;

        let hf_cache = self.cache_dir.join("hf");
        std::fs::create_dir_all(&hf_cache)
            .context("创建 HF 缓存目录失败")?;

        let api = ApiBuilder::new()
            .with_cache_dir(hf_cache)
            .build()
            .context("初始化 HF Hub API 失败")?;

        let repo_obj = match revision {
            Some(rev) => Repo::with_revision(repo.to_string(), RepoType::Model, rev.to_string()),
            None      => Repo::new(repo.to_string(), RepoType::Model),
        };
        let model_api = api.repo(repo_obj);

        send(DownloadProgress { stage: DownloadStage::Downloading, downloaded: 0, total: None });

        // hf-hub 自动处理缓存命中
        let path: PathBuf = model_api.get(file).await
            .with_context(|| format!("HF 下载失败: {repo}/{file}"))?;

        send(DownloadProgress { stage: DownloadStage::Done, downloaded: 0, total: None });
        Ok(path)
    }

    async fn ensure_url(
        &self,
        url: &str,
        filename: &str,
        send: impl Fn(DownloadProgress),
    ) -> Result<PathBuf> {
        use tokio::io::AsyncWriteExt;

        let dest = self.cache_dir.join(filename);
        if dest.exists() {
            send(DownloadProgress { stage: DownloadStage::Done, downloaded: 0, total: None });
            return Ok(dest);
        }

        std::fs::create_dir_all(&self.cache_dir)
            .context("创建模型缓存目录失败")?;

        send(DownloadProgress { stage: DownloadStage::Downloading, downloaded: 0, total: None });

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(600))
            .build()?;

        let mut resp = client.get(url).send().await
            .with_context(|| format!("请求失败: {url}"))?
            .error_for_status()
            .with_context(|| format!("HTTP 错误: {url}"))?;

        let total = resp.content_length();
        let tmp = dest.with_extension("tmp");
        let mut file = tokio::fs::File::create(&tmp).await
            .context("创建临时文件失败")?;
        let mut downloaded: u64 = 0;

        while let Some(chunk) = resp.chunk().await.context("下载中断")? {
            file.write_all(&chunk).await.context("写入失败")?;
            downloaded += chunk.len() as u64;
            send(DownloadProgress {
                stage:      DownloadStage::Downloading,
                downloaded,
                total,
            });
        }

        file.flush().await?;
        drop(file);
        tokio::fs::rename(&tmp, &dest).await.context("重命名失败")?;

        send(DownloadProgress { stage: DownloadStage::Done, downloaded, total });
        Ok(dest)
    }
}
