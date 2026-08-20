"""Yun native voice sidecar: py-xiaozhi-derived audio infrastructure only.

The engine owns one Windows full-duplex PCM stream. Its output callback creates
the exact render reference submitted to WebRTC APM before the matching mic
frame is processed. It deliberately has no LLM, persona, or command logic.
"""

from __future__ import annotations

import asyncio
import audioop
import io
import json
import logging
import threading
import time
import wave
import urllib.request
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import numpy as np
import sounddevice as sd
import webrtcvad
from fastapi import Body, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from py_xiaozhi_apm import NativeWebRtcApm
from py_xiaozhi_wake import PyXiaozhiWakeWord

ROOT = Path(__file__).resolve().parent
SPEECH_ROOT = ROOT.parent / "local-speech-service"
KWS_MODEL = SPEECH_ROOT / "models" / "sherpa-kws-wenetspeech" / "sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01"
KWS_KEYWORDS = SPEECH_ROOT / "wake-keywords.txt"
RATE, CHANNELS, FRAME_SAMPLES = 16000, 1, 160
FRAME_BYTES = FRAME_SAMPLES * 2
LOG = logging.getLogger("yun.native_voice")


class VoiceEngine:
    def __init__(self) -> None:
        self.apm: NativeWebRtcApm | None = None
        self.stream: sd.RawStream | None = None
        self.wake: PyXiaozhiWakeWord | None = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self.capture_queue: asyncio.Queue[tuple[bytes, bytes]] | None = None
        self.playback: deque[bytes] = deque()
        self.preroll: deque[bytes] = deque(maxlen=120)  # 1.2 seconds before KWS settles
        self.session_pcm: list[bytes] = []
        self.session_started_at = 0.0
        self.session_command_started = False
        self.session_silence_after_wake = False
        self.session_started_during_speech = False
        self.transcribing = False
        self.playback_lock = threading.Lock()
        self.events: deque[dict[str, Any]] = deque(maxlen=400)
        self.subscribers: set[WebSocket] = set()
        self.sequence = 0
        self.running = self.session_active = self.playing = False
        self.playback_end_pending = False
        self.speech_active = False
        self.last_voice_at = 0.0
        self.last_level_emit_at = 0.0
        self.vad = webrtcvad.Vad(2)
        self.stats = {"captureFrames": 0, "renderFrames": 0, "apmFrames": 0, "apmErrors": 0, "callbackDrops": 0}

    async def emit(self, event: str, **payload: Any) -> None:
        self.sequence += 1
        item = {"id": self.sequence, "event": event, "at": round(time.time() * 1000), **payload}
        self.events.append(item)
        stale: list[WebSocket] = []
        for socket in self.subscribers:
            try:
                await socket.send_json(item)
            except Exception:
                stale.append(socket)
        for socket in stale:
            self.subscribers.discard(socket)

    def _callback(self, indata, outdata, frames, _time, status) -> None:
        if status:
            LOG.warning("sounddevice callback status: %s", status)
        if frames != FRAME_SAMPLES:
            outdata[:] = b"\0" * len(outdata)
            return
        with self.playback_lock:
            render = self.playback.popleft() if self.playback else b"\0" * FRAME_BYTES
            was_playing = self.playing
            self.playing = bool(self.playback) or any(render)
            if was_playing and not self.playing:
                self.playback_end_pending = True
        outdata[:] = render
        capture = bytes(indata)
        self.stats["captureFrames"] += 1
        self.stats["renderFrames"] += 1
        if self.loop and self.capture_queue:
            try:
                self.loop.call_soon_threadsafe(self.capture_queue.put_nowait, (capture, render))
            except asyncio.QueueFull:
                self.stats["callbackDrops"] += 1

    async def start(self) -> None:
        if self.running:
            return
        self.loop = asyncio.get_running_loop()
        self.capture_queue = asyncio.Queue(maxsize=200)
        self.apm = NativeWebRtcApm(RATE, CHANNELS)
        self.wake = PyXiaozhiWakeWord(KWS_MODEL, KWS_KEYWORDS, self._on_wake, RATE)
        await self.wake.start()
        self.stream = sd.RawStream(samplerate=RATE, blocksize=FRAME_SAMPLES, channels=CHANNELS, dtype="int16", callback=self._callback)
        self.stream.start()
        self.running = True
        asyncio.create_task(self._capture_worker(), name="native-apm-capture")
        await self.emit("engine_ready", engine="native_webrtc_apm", apm="loaded", aec=True, ns=True, kws="loaded", mic="capture_running")
        LOG.info("[VOICE ENGINE] py-xiaozhi derived native engine loaded")
        LOG.info("[WEBRTC APM] loaded; [AEC] native processing enabled; [MIC] capture running")

    async def stop(self) -> None:
        if not self.running:
            return
        self.running = False
        if self.wake:
            await self.wake.stop()
        if self.stream:
            self.stream.stop()
            self.stream.close()
            self.stream = None
        if self.apm:
            self.apm.close()
            self.apm = None
        await self.emit("engine_stopped")

    async def _capture_worker(self) -> None:
        assert self.capture_queue is not None
        while self.running:
            capture, render = await self.capture_queue.get()
            try:
                assert self.apm is not None
                processed = self.apm.process(capture, render)
                self.stats["apmFrames"] += 1
            except Exception as error:
                self.stats["apmErrors"] += 1
                await self.emit("voice_error", stage="webrtc_apm", message=str(error))
                continue
            if self.wake and not self.session_active:
                self.wake.submit(processed)
            self.preroll.append(processed)
            if self.session_active and not self.transcribing:
                self.session_pcm.append(processed)
            if self.playback_end_pending:
                self.playback_end_pending = False
                await self.emit("playback_end", completed=True)
            voiced = self.vad.is_speech(processed, RATE)
            now = time.monotonic()
            # VAD can remain positive indefinitely in a noisy room. The old
            # timeout lived only in the `not voiced` branch, leaving the
            # wake session active forever and causing every later wake word
            # to be ignored. A wake turn is intentionally short: if no real
            # command starts within five seconds, always release it.
            if self.session_active and not self.session_command_started and now - self.session_started_at >= 5.0:
                self.session_active = False
                self.session_pcm = []
                self.session_silence_after_wake = False
                await self.emit("asr_final", text="", reason="command_timeout")
                continue
            if self.session_active and now - self.last_level_emit_at >= 0.08:
                samples = np.frombuffer(processed, dtype=np.int16).astype(np.float32) / 32768.0
                rms = float(np.sqrt(np.mean(samples * samples))) if samples.size else 0.0
                self.last_level_emit_at = now
                await self.emit("voice_level", level=round(min(1.0, rms * 9.0), 4))
            if voiced:
                self.last_voice_at = now
                if self.session_active:
                    # A command starts only after the wake phrase has ended
                    # and the user has made a natural pause.  Previously the
                    # tail of “小昀” itself could be marked as a command and
                    # immediately sent to ASR, leaving the real instruction
                    # unrecorded.
                    if self.session_silence_after_wake:
                        self.session_command_started = True
                if not self.speech_active:
                    self.speech_active = True
                    await self.emit("speech_start", playback_active=self.playing)
                    if self.playing:
                        # A stable VAD start while Yun is speaking is a
                        # barge-in command, not another wake-word request.
                        # Begin a fresh ASR turn from this first user frame.
                        self.session_active = True
                        self.session_started_at = now
                        self.session_pcm = [processed]
                        self.session_command_started = True
                        self.session_silence_after_wake = True
                        await self.emit("barge_in")
            elif self.speech_active and now - self.last_voice_at >= 0.35:
                self.speech_active = False
                await self.emit("speech_end")
                if self.session_active:
                    if not self.session_silence_after_wake:
                        if self.session_started_during_speech:
                            # The KWS callback can arrive only after a user
                            # has already said “小昀换一首歌”.  That is one
                            # complete command, so preserve it for ASR and
                            # strip the wake phrase later in the UI.
                            self.session_silence_after_wake = True
                            self.session_command_started = True
                            await self._transcribe_session()
                            continue
                        # Discard both KWS pre-roll and the wake phrase. The
                        # following speech is the only audio that belongs to
                        # the command turn.
                        self.session_silence_after_wake = True
                        self.session_pcm = []
                        await self.emit("command_ready")
                    elif self.session_command_started:
                        await self._transcribe_session()
            elif self.session_active and not voiced:
                # The first quiet gap belongs to the wake phrase.  Keep the
                # session open so a natural half-second pause before the
                # command does not produce an empty ASR request.
                self.session_silence_after_wake = True
                if self.session_command_started and not self.transcribing and now - self.last_voice_at >= 0.35:
                    await self._transcribe_session()
                elif not self.session_command_started and now - self.session_started_at >= 5.0:
                    self.session_active = False
                    self.session_pcm = []
                    await self.emit("asr_final", text="", reason="command_timeout")

    async def _on_wake(self, keyword: str) -> None:
        if self.session_active:
            return
        self.session_active = True
        self.session_started_at = time.monotonic()
        self.session_pcm = list(self.preroll)
        self.session_command_started = False
        self.session_silence_after_wake = False
        self.session_started_during_speech = self.speech_active
        await self.emit("wake_word", keyword=keyword)

    async def _transcribe_session(self) -> None:
        if self.transcribing:
            return
        pcm = b"".join(self.session_pcm)
        self.session_pcm = []
        self.session_active = False
        self.session_command_started = False
        self.session_silence_after_wake = False
        if len(pcm) < RATE // 4 * 2:
            await self.emit("asr_final", text="", reason="too_short")
            return
        self.transcribing = True
        await self.emit("asr_partial", text="", state="transcribing")
        try:
            result = await asyncio.to_thread(self._transcribe_pcm, pcm)
            await self.emit("asr_final", text=str(result.get("text") or "").strip(), elapsed_ms=result.get("elapsedMs"))
        except Exception as error:
            await self.emit("voice_error", stage="asr", message=str(error))
        finally:
            self.transcribing = False

    @staticmethod
    def _transcribe_pcm(pcm: bytes) -> dict[str, Any]:
        wav = io.BytesIO()
        with wave.open(wav, "wb") as output:
            output.setnchannels(CHANNELS)
            output.setsampwidth(2)
            output.setframerate(RATE)
            output.writeframes(pcm)
        boundary = "----yunNativeVoiceBoundary"
        body = b"".join([
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.wav\"\r\nContent-Type: audio/wav\r\n\r\n".encode(),
            wav.getvalue(),
            # SenseVoice auto mode is essential for spoken English/Japanese
            # song titles; forcing Chinese turns names into unreliable homonyms.
            f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nauto\r\n--{boundary}--\r\n".encode(),
        ])
        request = urllib.request.Request("http://127.0.0.1:17892/asr/transcribe", data=body, method="POST", headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))

    def enqueue_wav(self, raw: bytes) -> int:
        try:
            with wave.open(io.BytesIO(raw), "rb") as wav:
                if wav.getsampwidth() != 2:
                    raise ValueError("only PCM_16 WAV is accepted")
                channels, source_rate = wav.getnchannels(), wav.getframerate()
                pcm = wav.readframes(wav.getnframes())
        except (wave.Error, EOFError) as error:
            raise ValueError(f"invalid WAV: {error}") from error
        if channels > 1:
            pcm = audioop.tomono(pcm, 2, 0.5, 0.5)
        if source_rate != RATE:
            pcm, _ = audioop.ratecv(pcm, 2, 1, source_rate, RATE, None)
        frames = [pcm[index:index + FRAME_BYTES].ljust(FRAME_BYTES, b"\0") for index in range(0, len(pcm), FRAME_BYTES)]
        with self.playback_lock:
            self.playback.extend(frames)
        return len(frames)

    def stop_playback(self) -> None:
        with self.playback_lock:
            self.playback.clear()
            self.playing = False

    def health(self) -> dict[str, Any]:
        return {"ok": self.running, "service": "yun-native-voice-engine", "engine": "native_webrtc_apm", "fallback": "browser_aec_fallback", "sampleRate": RATE, "frameMs": 10, "eventSequence": self.sequence, "apm": {"loaded": self.apm is not None, "aec": self.apm is not None, "noiseSuppression": self.apm is not None, "dll": str(self.apm.dll_path) if self.apm else None}, "kws": {"loaded": self.wake is not None, "model": str(KWS_MODEL), "keywordFile": str(KWS_KEYWORDS)}, "mic": {"captureRunning": bool(self.stream and self.stream.active)}, "playback": {"active": self.playing, "queuedFrames": len(self.playback)}, "sessionActive": self.session_active, "stats": self.stats}


engine = VoiceEngine()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        await engine.start()
    except Exception as error:
        LOG.exception("Native engine failed to start: %s", error)
    yield
    await engine.stop()


app = FastAPI(title="Yun native voice engine", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"], allow_methods=["GET", "POST"], allow_headers=["*"])


@app.get("/health")
async def health() -> dict[str, Any]:
    return engine.health()


@app.post("/start")
async def start() -> dict[str, Any]:
    await engine.start()
    return engine.health()


@app.post("/stop")
async def stop() -> dict[str, Any]:
    await engine.stop()
    return {"ok": True}


@app.post("/wake-word")
async def set_wake_word(payload: dict = Body(default={})) -> dict[str, Any]:
    # The Sherpa graph needs a keywords file; expose configuration honestly
    # instead of pretending an arbitrary runtime string reconfigures the graph.
    return {"ok": False, "reason": "setWakeWord requires generating a Sherpa keywords file", "requested": payload.get("keyword")}


@app.post("/session/start")
async def start_session() -> dict[str, Any]:
    engine.session_active = True
    engine.session_started_at = time.monotonic()
    engine.session_pcm = list(engine.preroll)
    await engine.emit("session_started")
    return {"ok": True}


@app.post("/session/end")
async def end_session() -> dict[str, Any]:
    engine.session_active = False
    await engine.emit("session_ended")
    return {"ok": True}


@app.post("/playback")
async def start_playback(request: Request) -> dict[str, Any]:
    if not engine.running:
        raise HTTPException(503, "native voice engine is not running")
    frames = engine.enqueue_wav(await request.body())
    await engine.emit("playback_start", queued_frames=frames)
    return {"ok": True, "queuedFrames": frames}


@app.post("/playback/stop")
async def stop_playback() -> dict[str, Any]:
    engine.stop_playback()
    await engine.emit("playback_end", stopped=True)
    return {"ok": True}


@app.post("/playback/flush")
async def flush_playback() -> dict[str, Any]:
    engine.stop_playback()
    return {"ok": True}


@app.get("/events")
async def events(after: int = 0) -> dict[str, Any]:
    return {"events": [item for item in engine.events if item["id"] > after], "lastId": engine.sequence}


@app.websocket("/ws")
async def websocket_events(socket: WebSocket) -> None:
    await socket.accept()
    engine.subscribers.add(socket)
    try:
        after = max(0, int(socket.query_params.get("after", "0")))
        await socket.send_json({"event": "engine_snapshot", "health": engine.health()})
        # Health gives the browser a watermark before it opens this socket.
        # Replay the short gap after that watermark so a first-page wake cannot
        # vanish while the React listener is still connecting.
        for event in tuple(engine.events):
            if event["id"] > after:
                await socket.send_json(event)
        while True:
            await socket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        engine.subscribers.discard(socket)


if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    uvicorn.run(app, host="127.0.0.1", port=17894, log_level="info")
