#!/usr/bin/env python3
"""
RVC v2 PTH → ONNX exporter.
Downloads the RVC model architecture files (~100 KB) from GitHub on first run.

Usage: python rvc_export.py <model.pth> <output.onnx>
Requires: pip install torch numpy scipy
"""
import sys, os, urllib.request, ssl

# macOS Python may lack system CA bundle; use unverified context for model downloads.
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE

# ── dependency check ──────────────────────────────────────────────────────────

try:
    import torch
    import numpy as np
except ImportError as e:
    print(f"缺少依赖: {e}\n请运行: pip install torch numpy scipy", file=sys.stderr)
    sys.exit(2)

# ── download RVC architecture if needed ──────────────────────────────────────

BASE_URL = "https://raw.githubusercontent.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI/main"
MIRROR   = "https://mirror.ghproxy.com/" + BASE_URL

RVC_FILES = [
    "infer/lib/infer_pack/__init__.py",
    "infer/lib/infer_pack/commons.py",
    "infer/lib/infer_pack/transforms.py",
    "infer/lib/infer_pack/modules.py",
    "infer/lib/infer_pack/attentions.py",
    "infer/lib/infer_pack/models.py",
]

CACHE_DIR = os.path.join(os.path.expanduser("~"), ".cache", "streamix_rvc")


def ensure_rvc_code() -> None:
    sentinel = os.path.join(CACHE_DIR, "infer", "lib", "infer_pack", "models.py")
    if os.path.exists(sentinel):
        return

    print("首次使用：下载 RVC 架构代码 (~100 KB)…", flush=True)
    # Create all __init__.py stubs for package hierarchy
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
        print(f"  {rpath.split('/')[-1]}", flush=True)
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
            print(f"下载失败: {rpath}，请检查网络或手动安装 RVC WebUI", file=sys.stderr)
            sys.exit(1)


# ── wrapper: exposes infer() as forward() for ONNX tracing ───────────────────

class OnnxWrapper(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, phone, phone_lengths, pitch, pitchf, sid):
        result = self.model.infer(phone, phone_lengths, pitch, pitchf, sid)
        # infer() may return (audio, x_mask, ...) — take only audio
        return result[0] if isinstance(result, (tuple, list)) else result


class OnnxWrapperNoF0(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, phone, phone_lengths, sid):
        result = self.model.infer(phone, phone_lengths, sid)
        return result[0] if isinstance(result, (tuple, list)) else result


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        print("Usage: rvc_export.py model.pth output.onnx", file=sys.stderr)
        sys.exit(1)

    pth_path, out_path = sys.argv[1], sys.argv[2]

    ensure_rvc_code()
    sys.path.insert(0, CACHE_DIR)

    try:
        from infer.lib.infer_pack.models import (
            SynthesizerTrnMs256NSFsid,
            SynthesizerTrnMs768NSFsid,
        )
        try:
            from infer.lib.infer_pack.models import (
                SynthesizerTrnMs256NSFsid_nono,
                SynthesizerTrnMs768NSFsid_nono,
            )
        except ImportError:
            SynthesizerTrnMs256NSFsid_nono = SynthesizerTrnMs256NSFsid
            SynthesizerTrnMs768NSFsid_nono = SynthesizerTrnMs768NSFsid
    except Exception as e:
        print(f"导入失败: {e}", file=sys.stderr)
        sys.exit(1)

    # ── load checkpoint ──
    print(f"加载 {os.path.basename(pth_path)} …", flush=True)
    cpt = torch.load(pth_path, map_location="cpu", weights_only=False)

    cfg = cpt.get("config", [])
    version = cpt.get("version", "v2")
    f0 = int(cpt.get("f0", 1))

    if len(cfg) < 18:
        print(f"不支持的模型格式 (config 长度 {len(cfg)})", file=sys.stderr)
        sys.exit(1)

    sr = cfg[17]

    # ── select class ──
    if version == "v2":
        cls = SynthesizerTrnMs768NSFsid if f0 else SynthesizerTrnMs768NSFsid_nono
        phone_dim = 768
    else:
        cls = SynthesizerTrnMs256NSFsid if f0 else SynthesizerTrnMs256NSFsid_nono
        phone_dim = 256

    print(f"架构: {cls.__name__}  sr={sr}  f0={bool(f0)}", flush=True)

    # The constructor signature of SynthesizerTrnMs*NSFsid is:
    #   (spec_channels, segment_size, inter_channels, hidden_channels, ...)
    # cfg layout: [spec_ch, n_spk, inter_ch, hidden_ch, ...sr]
    # We pass cfg[2:] which starts at inter_ch, plus sr separately.
    try:
        net = cls(*cfg, is_half=False)
    except TypeError:
        try:
            net = cls(*cfg)
        except Exception as e:
            print(f"模型实例化失败: {e}", file=sys.stderr)
            sys.exit(1)

    net.eval()
    missing, unexpected = net.load_state_dict(cpt["weight"], strict=False)
    if missing:
        print(f"  缺失权重: {len(missing)} 个（通常正常）", flush=True)
    try:
        net.remove_weight_norm()
    except Exception:
        pass

    # ── dummy inputs ──
    T = 100
    phone = torch.randn(1, T, phone_dim)
    lengths = torch.tensor([T], dtype=torch.long)
    pitch = torch.zeros(1, T, dtype=torch.long)
    pitchf = torch.zeros(1, T, dtype=torch.float)
    sid = torch.zeros(1, dtype=torch.long)

    if f0:
        wrapper = OnnxWrapper(net)
        dummy = (phone, lengths, pitch, pitchf, sid)
        in_names = ["phone", "phone_lengths", "pitch", "pitchf", "ds"]
        dyn = {"phone": {1: "T"}, "pitch": {1: "T"}, "pitchf": {1: "T"}, "audio": {2: "S"}}
    else:
        wrapper = OnnxWrapperNoF0(net)
        dummy = (phone, lengths, sid)
        in_names = ["phone", "phone_lengths", "ds"]
        dyn = {"phone": {1: "T"}, "audio": {2: "S"}}

    print(f"导出 ONNX → {out_path} …", flush=True)
    with torch.no_grad():
        export_kwargs = dict(
            input_names=in_names,
            output_names=["audio"],
            dynamic_axes=dyn,
            opset_version=17,
            do_constant_folding=True,
        )
        try:
            # PyTorch ≥2.x: force legacy jit.trace exporter
            torch.onnx.export(wrapper, dummy, out_path, dynamo=False, **export_kwargs)
        except TypeError:
            # PyTorch <2.x doesn't have the dynamo kwarg
            torch.onnx.export(wrapper, dummy, out_path, **export_kwargs)
    print("转换成功！", flush=True)


if __name__ == "__main__":
    main()
