use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

use anyhow::{Result, bail};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

const WORKER_SCRIPT: &str = include_str!("rvc_worker.py");

struct WorkerProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

pub struct PythonWorkerEngine {
    proc: Mutex<WorkerProcess>,
    chunk_samples: usize,
}

impl std::fmt::Debug for PythonWorkerEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PythonWorkerEngine").finish_non_exhaustive()
    }
}

impl PythonWorkerEngine {
    pub fn new(model_path: &str, hubert_path: &str) -> Result<Self> {
        let python = find_python()?;
        let script_path = write_worker_script()?;
        let mut child = Command::new(&python)
            .arg("-u")
            .arg(&script_path)
            .arg("--model")
            .arg(model_path)
            .arg("--hubert")
            .arg(hubert_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| anyhow::anyhow!("启动 Python 变声 worker 失败: {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow::anyhow!("无法打开 Python worker stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("无法打开 Python worker stdout"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow::anyhow!("无法打开 Python worker stderr"))?;
        pipe_worker_stderr(stderr);

        let mut proc = WorkerProcess {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        };

        let ready = read_json_line(&mut proc.stdout)?;
        if !ready["ok"].as_bool().unwrap_or(false) {
            let err = ready["error"]
                .as_str()
                .unwrap_or("Python worker 初始化失败")
                .to_string();
            bail!(err);
        }
        let chunk_samples = ready["chunk_samples"].as_u64().unwrap_or(16_080) as usize;

        Ok(Self {
            proc: Mutex::new(proc),
            chunk_samples,
        })
    }

    pub fn process(&self, input: &[f32]) -> Result<Vec<f32>> {
        let mut proc = self.proc.lock().unwrap();
        let payload = BASE64.encode(f32_to_bytes(input));
        let req = serde_json::json!({
            "cmd": "process",
            "audio_b64": payload,
        });
        writeln!(proc.stdin, "{req}")
            .and_then(|_| proc.stdin.flush())
            .map_err(|e| anyhow::anyhow!("写入 Python worker 失败: {e}"))?;

        let resp = read_json_line(&mut proc.stdout)?;
        if !resp["ok"].as_bool().unwrap_or(false) {
            let err = resp["error"]
                .as_str()
                .unwrap_or("Python worker 推理失败")
                .to_string();
            bail!(err);
        }
        let audio_b64 = resp["audio_b64"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("Python worker 响应缺少音频"))?;
        let bytes = BASE64
            .decode(audio_b64)
            .map_err(|e| anyhow::anyhow!("解码 Python worker 响应失败: {e}"))?;
        bytes_to_f32(&bytes)
    }

    pub fn recommended_chunk_samples(&self) -> usize {
        self.chunk_samples
    }
}

impl Drop for PythonWorkerEngine {
    fn drop(&mut self) {
        if let Ok(mut proc) = self.proc.lock() {
            let _ = writeln!(proc.stdin, "{}", serde_json::json!({ "cmd": "shutdown" }));
            let _ = proc.stdin.flush();
            let _ = proc.child.kill();
            let _ = proc.child.wait();
        }
    }
}

fn read_json_line(reader: &mut BufReader<ChildStdout>) -> Result<serde_json::Value> {
    let mut line = String::new();
    let n = reader
        .read_line(&mut line)
        .map_err(|e| anyhow::anyhow!("读取 Python worker 输出失败: {e}"))?;
    if n == 0 {
        bail!("Python worker 已退出");
    }
    serde_json::from_str(line.trim())
        .map_err(|e| anyhow::anyhow!("解析 Python worker 输出失败: {e}; raw={line}"))
}

fn pipe_worker_stderr(stderr: ChildStderr) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(|line| line.ok()) {
            eprintln!("[VoiceChangerPy] {line}");
        }
    });
}

fn write_worker_script() -> Result<std::path::PathBuf> {
    let path = std::env::temp_dir().join("streamix_rvc_worker.py");
    std::fs::write(&path, WORKER_SCRIPT)
        .map_err(|e| anyhow::anyhow!("写入 Python worker 脚本失败: {e}"))?;
    Ok(path)
}

fn find_python() -> Result<String> {
    for candidate in ["python3", "python"] {
        if Command::new(candidate)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
        {
            return Ok(candidate.to_string());
        }
    }
    bail!("未找到可用的 Python 解释器（python3 / python）")
}

fn f32_to_bytes(input: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len() * 4);
    for sample in input {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

fn bytes_to_f32(input: &[u8]) -> Result<Vec<f32>> {
    if input.len() % 4 != 0 {
        bail!("Python worker 返回的音频字节长度无效");
    }
    Ok(input
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}
