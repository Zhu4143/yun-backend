"""Local GPU speech service for Yun.

It deliberately binds only to loopback. Qwen3-TTS and SenseVoice weights are
downloaded by their upstream libraries on first use and cached locally.
"""

from __future__ import annotations

import io
import os
import re
import sys
import tempfile
import time
import gc
from pathlib import Path
from threading import Lock

import soundfile as sf
import torch
import torchaudio
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / "cache"
os.environ.setdefault("MODELSCOPE_CACHE", str(CACHE_DIR / "modelscope"))
os.environ.setdefault("HF_HOME", str(CACHE_DIR / "huggingface"))
# `sox` is installed into the Conda environment rather than system-wide.
_sox_bin = Path(sys.prefix) / "Library" / "bin"
if _sox_bin.exists():
    os.environ["PATH"] = f"{_sox_bin}{os.pathsep}{os.environ.get('PATH', '')}"
try:
    import imageio_ffmpeg

    _ffmpeg_bin = str(Path(imageio_ffmpeg.get_ffmpeg_exe()).parent)
    os.environ["PATH"] = f"{_ffmpeg_bin}{os.pathsep}{os.environ.get('PATH', '')}"
except ImportError:
    pass
DEVICE = os.environ.get("YUN_SPEECH_DEVICE", "cuda:0" if torch.cuda.is_available() else "cpu")
ASR_DEVICE = os.environ.get("YUN_ASR_DEVICE", "cpu")
LOCAL_TTS_MODEL_DIR = ROOT / "models" / "Qwen3-TTS-12Hz-0.6B-CustomVoice"
TTS_MODEL_ID = os.environ.get(
    "QWEN_TTS_MODEL",
    str(LOCAL_TTS_MODEL_DIR) if LOCAL_TTS_MODEL_DIR.exists() else "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
)
TTS_SPEAKER = os.environ.get("QWEN_TTS_SPEAKER", "Vivian")
TTS_INSTRUCT = os.environ.get("QWEN_TTS_INSTRUCT", "用温柔、自然、陪伴感强的女声说话，语速稍慢。")
LOCAL_ASR_MODEL_DIR = ROOT / "models" / "SenseVoiceSmall"
ASR_MODEL_ID = os.environ.get(
    "SENSEVOICE_MODEL",
    str(LOCAL_ASR_MODEL_DIR) if LOCAL_ASR_MODEL_DIR.exists() else "iic/SenseVoiceSmall",
)
KWS_MODEL_DIR = ROOT / "models" / "sherpa-kws-wenetspeech" / "sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01"
KWS_KEYWORDS_FILE = ROOT / "wake-keywords.txt"
KWS_SAMPLE_RATE = 16000

app = FastAPI(title="Yun local GPU speech", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

_tts = None
_asr = None
_kws = None
_tts_lock = Lock()
_asr_lock = Lock()
_kws_lock = Lock()
_model_switch_lock = Lock()


def release_model(kind: str) -> None:
    """Only swap models when both are competing for the GPU."""
    global _tts, _asr
    with _model_switch_lock:
        if kind == "tts" and _asr is not None and ASR_DEVICE.startswith("cuda"):
            _asr = None
        elif kind == "asr" and _tts is not None and ASR_DEVICE.startswith("cuda"):
            _tts = None
        else:
            return
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def require_cuda() -> None:
    if not DEVICE.startswith("cuda"):
        raise HTTPException(status_code=503, detail="未检测到 CUDA GPU；请检查 NVIDIA 驱动和 PyTorch CUDA 版本。")


def get_tts():
    global _tts
    with _tts_lock:
        if _tts is None:
            release_model("tts")
            require_cuda()
            from qwen_tts import Qwen3TTSModel

            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            _tts = Qwen3TTSModel.from_pretrained(
                TTS_MODEL_ID,
                device_map=DEVICE,
                dtype=torch.bfloat16,
                # SDPA works on Windows CUDA without compiling flash-attn.
                attn_implementation="sdpa",
            )
    return _tts


def get_asr():
    global _asr
    with _asr_lock:
        if _asr is None:
            release_model("asr")
            from funasr import AutoModel

            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            _asr = AutoModel(
                model=ASR_MODEL_ID,
                device=ASR_DEVICE,
                # Yun sends short, already voice-activity-segmented clips. Do
                # not trigger additional remote VAD/punctuation model downloads
                # or keep them resident alongside Qwen3-TTS on an 8 GB GPU.
                disable_update=True,
            )
    return _asr


def get_kws():
    """Load the small, CPU-only Chinese keyword spotter on demand."""
    global _kws
    with _kws_lock:
        if _kws is None:
            required = [
                KWS_MODEL_DIR / "tokens.txt",
                KWS_MODEL_DIR / "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
                KWS_MODEL_DIR / "decoder-epoch-12-avg-2-chunk-16-left-64.onnx",
                KWS_MODEL_DIR / "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
                KWS_KEYWORDS_FILE,
            ]
            missing = [str(path) for path in required if not path.exists()]
            if missing:
                raise HTTPException(status_code=503, detail="KWS model files are missing")
            import sherpa_onnx

            _kws = sherpa_onnx.KeywordSpotter(
                tokens=str(required[0]),
                encoder=str(required[1]),
                decoder=str(required[2]),
                joiner=str(required[3]),
                keywords_file=str(KWS_KEYWORDS_FILE),
                num_threads=2,
                max_active_paths=4,
                keywords_score=3.0,
                keywords_threshold=0.12,
                provider="cpu",
            )
    return _kws


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "service": "yun-local-gpu-speech",
        "device": DEVICE,
        "cudaAvailable": torch.cuda.is_available(),
        "tts": {"loaded": _tts is not None, "model": TTS_MODEL_ID},
        "asr": {"loaded": _asr is not None, "device": ASR_DEVICE, "model": ASR_MODEL_ID},
        "kws": {"loaded": _kws is not None, "modelPresent": KWS_MODEL_DIR.exists(), "keyword": "小昀"},
    }


@app.post("/tts")
async def tts(payload: dict) -> Response:
    text = str(payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="TTS 文本不能为空")
    if len(text) > 500:
        raise HTTPException(status_code=400, detail="TTS 文本最多 500 字")
    speaker = str(payload.get("speaker") or TTS_SPEAKER).strip()
    instruct = str(payload.get("instruct") or TTS_INSTRUCT).strip()
    started = time.perf_counter()
    try:
        model = get_tts()
        # A licensed preset plus a role instruction gives Yun a stable identity
        # without cloning an unlicensed real person's voice.
        wavs, sample_rate = model.generate_custom_voice(
            text=text,
            language="Chinese",
            speaker=speaker,
            instruct=instruct,
        )
        audio = io.BytesIO()
        sf.write(audio, wavs[0], sample_rate, format="WAV", subtype="PCM_16")
        print(f"[local-tts] chars={len(text)} elapsedMs={round((time.perf_counter() - started) * 1000)} device={DEVICE}")
        return Response(audio.getvalue(), media_type="audio/wav", headers={"Cache-Control": "no-store"})
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Qwen3-TTS 合成失败：{error}") from error


@app.post("/asr/transcribe")
async def transcribe(file: UploadFile = File(...), language: str = Form("zh")) -> dict:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="缺少音频文件")
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="音频超过 10MB 限制")
    suffix = Path(file.filename or "speech.wav").suffix or ".wav"
    started = time.perf_counter()
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temp:
            temp.write(raw)
            temp_path = temp.name
        result = get_asr().generate(
            input=temp_path,
            cache={},
            language="auto" if language in ("", "auto") else "zh",
            use_itn=True,
            batch_size_s=60,
            merge_vad=True,
            merge_length_s=15,
        )
        text = "".join(str(item.get("text") or "") for item in result).strip()
        text = re.sub(r"<\|[^<|>]+\|>?", "", text).strip()
        return {
            "text": text,
            "language": language,
            "model": ASR_MODEL_ID,
            "durationSeconds": None,
            "elapsedMs": round((time.perf_counter() - started) * 1000),
        }
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"SenseVoice 转写失败：{error}") from error
    finally:
        if "temp_path" in locals():
            Path(temp_path).unlink(missing_ok=True)


@app.post("/wake/detect")
async def detect_wake_word(file: UploadFile = File(...)) -> dict:
    """Detect the configured wake word without producing a full transcript."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Missing audio file")
    if len(raw) > 2 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Wake audio exceeds 2 MB")
    started = time.perf_counter()
    try:
        samples, sample_rate = sf.read(io.BytesIO(raw), dtype="float32", always_2d=False)
        if getattr(samples, "ndim", 1) > 1:
            samples = samples.mean(axis=1)
        waveform = torch.as_tensor(samples, dtype=torch.float32)
        if sample_rate != KWS_SAMPLE_RATE:
            waveform = torchaudio.functional.resample(waveform, sample_rate, KWS_SAMPLE_RATE)
        kws = get_kws()
        stream = kws.create_stream()
        stream.accept_waveform(KWS_SAMPLE_RATE, waveform.numpy())
        # Small tail lets the streaming decoder settle after a short phrase.
        stream.accept_waveform(KWS_SAMPLE_RATE, torch.zeros(int(KWS_SAMPLE_RATE * 0.35)).numpy())
        stream.input_finished()
        keyword = ""
        while kws.is_ready(stream):
            kws.decode_stream(stream)
            keyword = kws.get_result(stream)
            if keyword:
                kws.reset_stream(stream)
                break
        return {
            "detected": bool(keyword),
            "keyword": keyword,
            "elapsedMs": round((time.perf_counter() - started) * 1000),
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Wake word detection failed: {error}") from error


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("YUN_LOCAL_SPEECH_PORT", "17892")))
