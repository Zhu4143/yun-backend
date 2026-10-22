import asyncio
import io
import os
import re
import time
import unicodedata
from pathlib import Path

import numpy as np
import scipy.io.wavfile as wavf
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from torch import LongTensor, no_grad

import lib.commons as commons
import lib.utils as utils
from lib.models import SynthesizerTrn
from lib.text import text_to_sequence

ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "model"
MAX_TEXT_LENGTH = 500
REQUEST_LOCK = asyncio.Lock()
DEVICE = "cpu"  # CPU is the required first-run mode; only change after verification.

app = FastAPI()
model = None
hps = None
speaker_ids = {}
sampling_rate = None
load_error = None


class TextToSpeechParams(BaseModel):
    text: str
    speechRate: float = 0.98


VOICE_TERM_REPLACEMENTS = (
    # The local checkpoint is Mandarin-only. These are voice-only renderings;
    # the original response remains unchanged in the visual terminal.
    (r"\bINTELLIGENT QUANTUM COMPUTER\b", "智能量子计算机"),
    (r"\bCENTRAL INTELLIGENCE\b", "中央智能系统"),
    (r"\bDESKTOP CONTROL AGENT\b", "桌面控制代理"),
    (r"\bDESKTOP AGENT\b", "桌面代理"),
    (r"\bMOSS BACKEND\b", "莫斯后端"),
    (r"\bMODEL ONLINE\b", "模型在线"),
    (r"\bMODEL OFFLINE\b", "模型离线"),
    (r"\bGET SYSTEM STATUS\b", "系统状态查询"),
    (r"\bget_system_status\b", "系统状态查询"),
    (r"\bSYSTEM ONLINE\b", "系统在线"),
    (r"\bSYSTEM STATUS\b", "系统状态"),
    (r"\bget_system_info\b", "系统信息查询"),
    (r"\bset_volume\b", "设置音量"),
    (r"\bget_volume\b", "读取音量"),
    (r"\bopen_application\b", "打开应用程序"),
    (r"\bclose_application\b", "关闭应用程序"),
    (r"\bSUCCESS\b", "成功"),
    (r"\bERROR\b", "错误"),
    (r"\bONLINE\b", "在线"),
    (r"\bOFFLINE\b", "离线"),
    (r"\bCONNECTED\b", "已连接"),
    (r"\bDISCONNECTED\b", "未连接"),
    (r"\bAPI\b", "接口"),
    (r"\bTTS\b", "语音合成"),
    (r"\bCPU\b", "中央处理器"),
    (r"\bGPU\b", "图形处理器"),
    (r"\bWAV\b", "音频文件"),
    (r"\bChatGPT\b", "查特吉皮提"),
    (r"\bDeepSeek\b", "深度求索"),
    (r"\bChrome\b", "克罗姆浏览器"),
    (r"\bEdge\b", "微软浏览器"),
    (r"\bWindows Terminal\b", "温斗斯终端"),
    (r"\bWindows\b", "温斗斯"),
    (r"\bMOSS\b", "莫斯"),
    (r"\b550W\b", "五五零瓦"),
)


def prepare_text(text: str) -> str:
    """Create a natural Mandarin script for the monolingual local model."""
    prepared = unicodedata.normalize("NFKC", text).replace("_", " ")
    for pattern, replacement in VOICE_TERM_REPLACEMENTS:
        prepared = re.sub(pattern, replacement, prepared, flags=re.IGNORECASE)

    # Unknown Latin terms otherwise become individual spoken letters. The UI
    # preserves the exact identifier, while speech reports it as a term.
    prepared = re.sub(r"[A-Za-z]+(?:[.-][A-Za-z0-9]+)*", "外文术语", prepared)
    prepared = re.sub(r"(?:外文术语\s*){2,}", "外文术语 ", prepared)
    prepared = re.sub(r"(\d+(?:\.\d+)?)\s*%", r"百分之\1", prepared)
    prepared = re.sub(r"[;:|/]", "，", prepared)
    return re.sub(r"\s+", " ", prepared).strip()


def get_text(text: str):
    normalized = text_to_sequence(prepare_text(text), hps.symbols, hps.data.text_cleaners)
    if hps.data.add_blank:
        normalized = commons.intersperse(normalized, 0)
    return LongTensor(normalized)


def load_model_once():
    global model, hps, speaker_ids, sampling_rate, load_error
    checkpoint = MODEL_DIR / "moss.pth"
    config = MODEL_DIR / "config.json"
    if not checkpoint.is_file() or not config.is_file():
        missing = [str(path) for path in (checkpoint, config) if not path.is_file()]
        load_error = "missing model files: " + ", ".join(missing)
        print(f"[moss-tts] {load_error}")
        return
    try:
        print(f"[moss-tts] loading model device={DEVICE}")
        hps = utils.get_hparams_from_file(str(config))
        loaded = SynthesizerTrn(
            len(hps.symbols),
            hps.data.filter_length // 2 + 1,
            hps.train.segment_size // hps.data.hop_length,
            n_speakers=hps.data.n_speakers,
            **hps.model,
        ).to(DEVICE)
        loaded.eval()
        utils.load_checkpoint(str(checkpoint), loaded, None)
        model = loaded
        speaker_ids = hps.speakers
        sampling_rate = hps.data.sampling_rate
        load_error = None
        print(f"[moss-tts] model loaded device={DEVICE} sampleRate={sampling_rate}")
    except Exception as error:
        model = None
        load_error = f"model load failed: {type(error).__name__}: {error}"
        print(f"[moss-tts] {load_error}")


def infer_audio(text: str, speech_rate: float):
    if model is None:
        raise RuntimeError(load_error or "model is not loaded")
    speaker_id = speaker_ids["MOSS"] if "MOSS" in speaker_ids else None
    if speaker_id is None:
        raise RuntimeError("MOSS speaker id was not found in config.json")
    sequence = get_text(text)
    with no_grad():
        x = sequence.unsqueeze(0).to(DEVICE)
        x_lengths = LongTensor([sequence.size(0)]).to(DEVICE)
        sid = LongTensor([speaker_id]).to(DEVICE)
        audio = model.infer(
            x,
            x_lengths,
            sid=sid,
            noise_scale=0.667,
            noise_scale_w=0.8,
            length_scale=1.0 / speech_rate,
        )[0][0, 0].data.cpu().float().numpy()
    return np.clip(audio, -1.0, 1.0)


@app.on_event("startup")
async def startup_event():
    load_model_once()


@app.get("/health")
async def health():
    return {
        "status": "ok" if model is not None else "error",
        "modelLoaded": model is not None,
        "device": DEVICE,
        "error": load_error,
    }


@app.post("/text_to_speech")
async def text_to_speech(params: TextToSpeechParams):
    text = " ".join(params.text.split())
    if not text:
        raise HTTPException(status_code=400, detail="text cannot be empty")
    if len(text) > MAX_TEXT_LENGTH:
        raise HTTPException(status_code=400, detail=f"text exceeds {MAX_TEXT_LENGTH} characters")
    if not 0.6 <= params.speechRate <= 1.4:
        raise HTTPException(status_code=400, detail="speechRate must be between 0.6 and 1.4")
    if model is None:
        raise HTTPException(status_code=503, detail=load_error or "model is not loaded")

    started_at = time.perf_counter()
    async with REQUEST_LOCK:
        try:
            audio = infer_audio(text, params.speechRate)
            pcm16 = (audio * 32767.0).astype(np.int16)
            buffer = io.BytesIO()
            wavf.write(buffer, sampling_rate, pcm16)
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            print(f"[moss-tts] generated chars={len(text)} elapsedMs={elapsed_ms} device={DEVICE}")
            return Response(content=buffer.getvalue(), media_type="audio/wav")
        except HTTPException:
            raise
        except Exception as error:
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            print(f"[moss-tts] inference failed chars={len(text)} elapsedMs={elapsed_ms} error={type(error).__name__}")
            return JSONResponse(status_code=500, content={"error": "tts inference failed", "detail": str(error)})


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=5010, log_level="info")
