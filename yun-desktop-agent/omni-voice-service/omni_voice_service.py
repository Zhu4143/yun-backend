"""Loopback-only OmniVoice reference-audio cloning service for Yun."""
from __future__ import annotations

import io
import os
import re
import uuid
from pathlib import Path
from threading import Lock

import soundfile as sf
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from omnivoice import OmniVoice, VoiceClonePrompt
from omnivoice.utils.common import fix_random_seed

ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "models" / "OmniVoice"
CLONES_DIR = ROOT / "voice_clones"
DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"
_model = None
_lock = Lock()
_generation_lock = Lock()
# OmniVoice samples during generation. A fixed seed prevents the same clone
# from unexpectedly changing identity between replies, while the input text
# still determines the spoken content.
GENERATION_SEED = int(os.getenv("YUN_OMNIVOICE_SEED", "3407"))

app = FastAPI(title="Yun OmniVoice", version="1.0.0")

def get_model():
    global _model
    with _lock:
        if _model is None:
            if not (MODEL_DIR / "model.safetensors").exists():
                raise HTTPException(503, "OmniVoice model files are missing")
            _model = OmniVoice.from_pretrained(
                str(MODEL_DIR), device_map=DEVICE,
                dtype=torch.float16 if DEVICE.startswith("cuda") else torch.float32,
            )
    return _model

def clone_path(clone_id: str) -> Path:
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", clone_id):
        raise HTTPException(400, "Invalid clone id")
    return CLONES_DIR / f"{clone_id}.pt"

@app.get("/health")
def health():
    return {"ok": True, "service": "yun-omnivoice", "device": DEVICE,
            "modelLoaded": _model is not None, "modelPresent": (MODEL_DIR / "model.safetensors").exists()}

@app.post("/clones")
async def create_clone(
    reference_audio: UploadFile = File(...),
    reference_text: str = Form(""),
    clone_id: str = Form(""),
):
    raw = await reference_audio.read()
    if not raw or len(raw) > 25 * 1024 * 1024:
        raise HTTPException(400, "Reference audio must be 1 byte–25 MB")
    suffix = Path(reference_audio.filename or "reference.wav").suffix or ".wav"
    CLONES_DIR.mkdir(parents=True, exist_ok=True)
    audio_path = CLONES_DIR / f"upload-{uuid.uuid4().hex}{suffix}"
    try:
        audio_path.write_bytes(raw)
        safe_id = clone_id.strip() or f"clone-{uuid.uuid4().hex[:12]}"
        prompt = get_model().create_voice_clone_prompt(
            ref_audio=str(audio_path), ref_text=reference_text.strip() or None
        )
        prompt.save(str(clone_path(safe_id)))
        return {"ok": True, "cloneId": safe_id}
    finally:
        audio_path.unlink(missing_ok=True)

@app.post("/tts")
async def tts(payload: dict):
    text = str(payload.get("text") or "").strip()
    clone_id = str(payload.get("cloneId") or "").strip()
    if not text or not clone_id:
        raise HTTPException(400, "text and cloneId are required")
    prompt_file = clone_path(clone_id)
    if not prompt_file.exists():
        raise HTTPException(404, "Voice clone not found")
    prompt = VoiceClonePrompt.load(str(prompt_file))
    with _generation_lock:
        fix_random_seed(GENERATION_SEED)
        if DEVICE.startswith("cuda"):
            torch.cuda.manual_seed_all(GENERATION_SEED)
        audio = get_model().generate(
            text=text,
            voice_clone_prompt=prompt,
            num_step=16,
            # The upstream default randomly samples token positions, which can
            # noticeably alter a cloned identity between two identical calls.
            position_temperature=0.0,
            class_temperature=0.0,
            speed=float(payload.get("speed") or 1.0),
        )
    out = io.BytesIO()
    sf.write(out, audio[0], 24000, format="WAV", subtype="PCM_16")
    return Response(out.getvalue(), media_type="audio/wav")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("YUN_OMNIVOICE_PORT", "17893")))
