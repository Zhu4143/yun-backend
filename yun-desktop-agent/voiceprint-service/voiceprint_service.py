"""Local-only speaker verification for Yun.

The service binds to 127.0.0.1. Enrollment audio and the resulting embedding
never leave this computer; only SpeechBrain's public model weights are fetched
once on the first start and then cached under this folder.
"""

from __future__ import annotations

import io
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Annotated

import numpy as np
import soundfile as sf
import torch
import torch.nn.functional as F
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from speechbrain.inference.speaker import EncoderClassifier

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
MODELS_DIR = ROOT / "models"
VOICEPRINT_PATH = DATA_DIR / "yun_voiceprint.npy"
PROFILE_PATH = DATA_DIR / "yun_voiceprint.json"
SAMPLE_RATE = 16_000
# Lower threshold requested for a more responsive first-time wake experience.
DEFAULT_THRESHOLD = float(os.environ.get("YUN_VOICEPRINT_THRESHOLD", "0.30"))
MIN_DURATION_SECONDS = 1.0

app = FastAPI(title="Yun local voiceprint service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)

_model: EncoderClassifier | None = None
_model_lock = Lock()


def profile_payload() -> dict:
    if not VOICEPRINT_PATH.exists():
        return {"enrolled": False, "threshold": DEFAULT_THRESHOLD}
    details: dict = {}
    if PROFILE_PATH.exists():
        try:
            details = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            details = {}
    return {"enrolled": True, "threshold": DEFAULT_THRESHOLD, **details}


def get_model() -> EncoderClassifier:
    global _model
    with _model_lock:
        if _model is None:
            MODELS_DIR.mkdir(parents=True, exist_ok=True)
            _model = EncoderClassifier.from_hparams(
                source="speechbrain/spkrec-ecapa-voxceleb",
                savedir=str(MODELS_DIR),
                run_opts={"device": "cpu"},
            )
    return _model


def read_audio(raw: bytes) -> torch.Tensor:
    try:
        samples, sample_rate = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    except RuntimeError as error:
        raise HTTPException(status_code=400, detail="无法读取录音，请重新录制 WAV 音频") from error
    if len(samples) < int(sample_rate * MIN_DURATION_SECONDS):
        raise HTTPException(status_code=400, detail="录音太短，请至少说 1 秒")
    mono = torch.from_numpy(samples.mean(axis=1)).float().unsqueeze(0)
    if sample_rate != SAMPLE_RATE:
        mono = F.interpolate(mono.unsqueeze(0), size=round(mono.shape[-1] * SAMPLE_RATE / sample_rate), mode="linear", align_corners=False).squeeze(0)
    return mono


def normalize(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    if norm < 1e-8:
        raise HTTPException(status_code=400, detail="录音没有检测到有效人声，请靠近麦克风再试")
    return vector / norm


def embed(raw: bytes) -> np.ndarray:
    waveform = read_audio(raw)
    with torch.inference_mode():
        embedding = get_model().encode_batch(waveform).squeeze().cpu().numpy().astype(np.float32)
    return normalize(embedding)


async def upload_bytes(upload: UploadFile) -> bytes:
    raw = await upload.read()
    if not raw:
        raise HTTPException(status_code=400, detail="录音文件为空")
    if len(raw) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="录音文件过大")
    return raw


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "yun-voiceprint", "model": "speechbrain/ecapa-voxceleb", **profile_payload()}


@app.post("/enroll")
async def enroll(files: Annotated[list[UploadFile], File(...)]) -> dict:
    if len(files) < 3:
        raise HTTPException(status_code=400, detail="请录入至少 3 段语音")
    if len(files) > 6:
        raise HTTPException(status_code=400, detail="一次最多录入 6 段语音")
    embeddings = [embed(await upload_bytes(upload)) for upload in files]
    prototype = normalize(np.mean(np.stack(embeddings), axis=0))
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    np.save(VOICEPRINT_PATH, prototype)
    profile = {
        "sampleCount": len(embeddings),
        "enrolledAt": datetime.now(timezone.utc).astimezone().isoformat(),
    }
    PROFILE_PATH.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "message": "声纹已仅在本机保存", "threshold": DEFAULT_THRESHOLD, **profile_payload()}


@app.post("/verify")
async def verify(file: Annotated[UploadFile, File(...)]) -> dict:
    if not VOICEPRINT_PATH.exists():
        raise HTTPException(status_code=409, detail="尚未录入声纹")
    stored = normalize(np.load(VOICEPRINT_PATH).astype(np.float32))
    score = float(np.dot(embed(await upload_bytes(file)), stored))
    return {
        "ok": True,
        "verified": score >= DEFAULT_THRESHOLD,
        "score": round(score, 4),
        "threshold": DEFAULT_THRESHOLD,
    }


@app.delete("/profile")
def delete_profile() -> dict:
    for target in (VOICEPRINT_PATH, PROFILE_PATH):
        if target.exists():
            target.unlink()
    return {"ok": True, "enrolled": False}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("YUN_VOICEPRINT_PORT", "17891")))
