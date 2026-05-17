#!/usr/bin/env python3
import argparse
import base64
import json
import math
import os
import ssl
import sys
import urllib.request

import numpy as np
import onnxruntime as ort
import scipy.signal
import torch

_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE

BASE_URL = "https://raw.githubusercontent.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI/main"
MIRROR = "https://mirror.ghproxy.com/" + BASE_URL
RVC_FILES = [
    "infer/lib/infer_pack/__init__.py",
    "infer/lib/infer_pack/commons.py",
    "infer/lib/infer_pack/transforms.py",
    "infer/lib/infer_pack/modules.py",
    "infer/lib/infer_pack/attentions.py",
    "infer/lib/infer_pack/models.py",
]
CACHE_DIR = os.path.join(os.path.expanduser("~"), ".cache", "streamix_rvc")
CHUNK_SAMPLES = 16080
HUBERT_TARGET_FRAMES = 50
RVC_TARGET_FRAMES = 100
SAMPLE_RATE = 16000.0
F0_MIN_HZ = 50.0
F0_MAX_HZ = 1100.0
F0_BINS = 256
RVC_HOP = 160


def ensure_rvc_code():
    sentinel = os.path.join(CACHE_DIR, "infer", "lib", "infer_pack", "models.py")
    if os.path.exists(sentinel):
        return
    for pkg in ("infer", "infer/lib", "infer/lib/infer_pack"):
        pkg_dir = os.path.join(CACHE_DIR, pkg)
        os.makedirs(pkg_dir, exist_ok=True)
        init = os.path.join(pkg_dir, "__init__.py")
        if not os.path.exists(init):
            open(init, "w").close()
    for rpath in RVC_FILES:
        local = os.path.join(CACHE_DIR, rpath)
        if os.path.exists(local):
            continue
        downloaded = False
        for base in (BASE_URL, MIRROR):
            try:
                req = urllib.request.Request(f"{base}/{rpath}")
                with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as resp:
                    with open(local, "wb") as f:
                        f.write(resp.read())
                downloaded = True
                break
            except Exception:
                continue
        if not downloaded:
            raise RuntimeError(f"下载 RVC 架构代码失败: {rpath}")


def estimate_f0(audio: np.ndarray, num_frames: int, hop: int) -> tuple[np.ndarray, np.ndarray]:
    min_period = int(SAMPLE_RATE / F0_MAX_HZ)
    max_period = int(SAMPLE_RATE / F0_MIN_HZ)
    win = max_period * 2 + 64
    log_min = math.log(F0_MIN_HZ)
    log_range = math.log(F0_MAX_HZ) - log_min
    pitchf = np.zeros((num_frames,), dtype=np.float32)

    for frame in range(num_frames):
        center = frame * hop + hop // 2
        start = max(0, center - win // 2)
        if start >= len(audio):
            continue
        end = min(start + win, len(audio))
        seg = audio[start:end]
        if len(seg) < min_period * 2:
            continue
        energy = float(np.sum(seg * seg))
        if energy < 1e-6:
            continue
        max_lag = min(max_period, len(seg) // 2)
        best_tau = 0
        best_nsdf = 0.0
        for tau in range(min_period, max_lag + 1):
            n = len(seg) - tau
            s1 = seg[:n]
            s2 = seg[tau:tau + n]
            acf = float(np.sum(s1 * s2))
            m0 = float(np.sum(s1 * s1))
            mt = float(np.sum(s2 * s2))
            denom = math.sqrt((m0 + mt) / 2.0)
            nsdf = acf / (n * denom) if denom > 1e-8 else 0.0
            if nsdf > best_nsdf:
                best_nsdf = nsdf
                best_tau = tau
        if best_tau > 0 and best_nsdf > 0.45:
            pitchf[frame] = SAMPLE_RATE / best_tau

    pitch = np.zeros((num_frames,), dtype=np.int64)
    for i, hz in enumerate(pitchf):
        if hz >= F0_MIN_HZ:
            b = round((math.log(float(hz)) - log_min) / log_range * (F0_BINS - 1))
            pitch[i] = max(1, min(F0_BINS - 1, b))
    return pitch, pitchf


class Worker:
    def __init__(self, model_path: str, hubert_path: str):
        self.chunk_samples = CHUNK_SAMPLES
        self.hubert = ort.InferenceSession(hubert_path, providers=["CPUExecutionProvider"])
        self.hubert_output_name = "embed"
        out_names = [o.name for o in self.hubert.get_outputs()]
        if self.hubert_output_name not in out_names:
            self.hubert_output_name = out_names[0]
        self.hubert_has_mask = any(i.name == "padding_mask" for i in self.hubert.get_inputs())
        self.model_mode = "pth" if model_path.endswith(".pth") else "onnx"
        if self.model_mode == "pth":
            self._load_pth_model(model_path)
        else:
            self._load_onnx_model(model_path)

    def _load_pth_model(self, model_path: str):
        ensure_rvc_code()
        if CACHE_DIR not in sys.path:
            sys.path.insert(0, CACHE_DIR)
        from infer.lib.infer_pack.models import SynthesizerTrnMs256NSFsid, SynthesizerTrnMs768NSFsid
        try:
            from infer.lib.infer_pack.models import SynthesizerTrnMs256NSFsid_nono, SynthesizerTrnMs768NSFsid_nono
        except ImportError:
            SynthesizerTrnMs256NSFsid_nono = SynthesizerTrnMs256NSFsid
            SynthesizerTrnMs768NSFsid_nono = SynthesizerTrnMs768NSFsid

        cpt = torch.load(model_path, map_location="cpu", weights_only=False)
        cfg = cpt.get("config", [])
        version = cpt.get("version", "v2")
        f0 = int(cpt.get("f0", 1))
        self.model_sample_rate = int(cfg[17])
        if version == "v2":
            cls = SynthesizerTrnMs768NSFsid if f0 else SynthesizerTrnMs768NSFsid_nono
        else:
            cls = SynthesizerTrnMs256NSFsid if f0 else SynthesizerTrnMs256NSFsid_nono
        net = cls(*cfg, is_half=False)
        net.eval()
        net.load_state_dict(cpt["weight"], strict=False)
        try:
            net.remove_weight_norm()
        except Exception:
            pass
        self.net = net
        self.model = None

    def _load_onnx_model(self, model_path: str):
        self.model = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        self.model_sample_rate = 48000
        self.net = None

    def _extract_hubert(self, audio: np.ndarray) -> np.ndarray:
        inputs = {"source": audio[None, :].astype(np.float32)}
        if self.hubert_has_mask:
            inputs["padding_mask"] = np.zeros((1, len(audio)), dtype=bool)
        feats = self.hubert.run([self.hubert_output_name], inputs)[0]
        if feats.shape[1] != HUBERT_TARGET_FRAMES:
            raise RuntimeError(f"HuBERT 帧数异常: {feats.shape}")
        return feats.astype(np.float32)

    def _run_model(self, feats: np.ndarray, pitch: np.ndarray, pitchf: np.ndarray) -> np.ndarray:
        if self.net is not None:
            with torch.no_grad():
                phone = torch.from_numpy(feats)
                lengths = torch.tensor([feats.shape[1]], dtype=torch.long)
                pitch_t = torch.from_numpy(pitch[None, :])
                pitchf_t = torch.from_numpy(pitchf[None, :])
                sid = torch.zeros(1, dtype=torch.long)
                audio = self.net.infer(phone, lengths, pitch_t, pitchf_t, sid)
                if isinstance(audio, (list, tuple)):
                    audio = audio[0]
                return audio.reshape(-1).cpu().numpy().astype(np.float32)

        out = self.model.run(
            None,
            {
                "phone": feats.astype(np.float32),
                "phone_lengths": np.array([feats.shape[1]], dtype=np.int64),
                "pitch": pitch[None, :].astype(np.int64),
                "pitchf": pitchf[None, :].astype(np.float32),
                "ds": np.array([0], dtype=np.int64),
            },
        )[0]
        return np.asarray(out).reshape(-1).astype(np.float32)

    def process(self, audio: np.ndarray) -> np.ndarray:
        if len(audio) < self.chunk_samples:
            audio = np.pad(audio, (0, self.chunk_samples - len(audio)))
        elif len(audio) > self.chunk_samples:
            audio = audio[-self.chunk_samples:]

        feats = self._extract_hubert(audio)
        feats = np.repeat(feats, 2, axis=1)
        if feats.shape[1] != RVC_TARGET_FRAMES:
            raise RuntimeError(f"RVC 输入帧数异常: {feats.shape}")
        pitch, pitchf = estimate_f0(audio, RVC_TARGET_FRAMES, RVC_HOP)
        out = self._run_model(feats, pitch, pitchf)
        if self.model_sample_rate != 16000:
            out = scipy.signal.resample_poly(out, 16000, self.model_sample_rate).astype(np.float32)
        if len(out) != len(audio):
            src = np.linspace(0, len(out) - 1, len(audio), dtype=np.float32)
            out = np.interp(src, np.arange(len(out), dtype=np.float32), out).astype(np.float32)
        return np.clip(out, -1.0, 1.0)


def write_json(payload: dict):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--hubert", required=True)
    args = parser.parse_args()

    try:
        worker = Worker(args.model, args.hubert)
        write_json({
            "ok": True,
            "chunk_samples": worker.chunk_samples,
            "model_sample_rate": worker.model_sample_rate,
            "engine": worker.model_mode,
        })
    except Exception as exc:
        write_json({"ok": False, "error": str(exc)})
        return 1

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            cmd = req.get("cmd")
            if cmd == "shutdown":
                write_json({"ok": True})
                return 0
            if cmd != "process":
                raise RuntimeError(f"未知命令: {cmd}")
            audio_bytes = base64.b64decode(req["audio_b64"])
            audio = np.frombuffer(audio_bytes, dtype="<f4").astype(np.float32)
            out = worker.process(audio)
            write_json({
                "ok": True,
                "audio_b64": base64.b64encode(out.astype("<f4").tobytes()).decode("ascii"),
            })
        except Exception as exc:
            write_json({"ok": False, "error": str(exc)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
