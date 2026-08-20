"""Download and validate Yun's local Qwen3-TTS model ahead of first use."""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / "cache"
os.environ.setdefault("MODELSCOPE_CACHE", str(CACHE_DIR / "modelscope"))
os.environ.setdefault("HF_HOME", str(CACHE_DIR / "huggingface"))
sox_bin = Path(sys.prefix) / "Library" / "bin"
if sox_bin.exists():
    os.environ["PATH"] = f"{sox_bin}{os.pathsep}{os.environ.get('PATH', '')}"

import torch
from qwen_tts import Qwen3TTSModel

if not torch.cuda.is_available():
    raise RuntimeError("CUDA GPU was not detected")

local_model_dir = ROOT / "models" / "Qwen3-TTS-12Hz-0.6B-CustomVoice"
model_id = os.environ.get(
    "QWEN_TTS_MODEL",
    str(local_model_dir) if local_model_dir.exists() else "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
)
model = Qwen3TTSModel.from_pretrained(
    model_id,
    device_map="cuda:0",
    dtype=torch.bfloat16,
    attn_implementation="sdpa",
)
print(f"ready model={model.__class__.__name__} device={torch.cuda.get_device_name(0)}")
