"""Sherpa-ONNX wake detector adapted from py-xiaozhi (MIT, 2025 Junsen)."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Awaitable, Callable

import numpy as np
import sherpa_onnx


class PyXiaozhiWakeWord:
    """Bounded asynchronous KWS worker; model is loaded once and stays resident."""

    def __init__(self, model_dir: Path, keywords: Path, on_detected: Callable[[str], Awaitable[None]], sample_rate: int = 16000):
        self.queue: asyncio.Queue[np.ndarray] = asyncio.Queue(maxsize=100)
        self.sample_rate, self.on_detected = sample_rate, on_detected
        self.last_detection_time, self.cooldown = 0.0, 1.5
        required = {"tokens": model_dir / "tokens.txt", "encoder": model_dir / "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx", "decoder": model_dir / "decoder-epoch-12-avg-2-chunk-16-left-64.onnx", "joiner": model_dir / "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx", "keywords": keywords}
        missing = [str(value) for value in required.values() if not value.exists()]
        if missing:
            raise FileNotFoundError("KWS model files missing: " + ", ".join(missing))
        self.spotter = sherpa_onnx.KeywordSpotter(tokens=str(required["tokens"]), encoder=str(required["encoder"]), decoder=str(required["decoder"]), joiner=str(required["joiner"]), keywords_file=str(required["keywords"]), num_threads=2, sample_rate=sample_rate, feature_dim=80, max_active_paths=4, keywords_score=3.0, keywords_threshold=0.12, num_trailing_blanks=1, provider="cpu")
        self.stream = self.spotter.create_stream()
        self.running, self.task = False, None

    def submit(self, pcm: bytes) -> None:
        if not self.running:
            return
        frame = np.frombuffer(pcm, dtype=np.int16).copy()
        try:
            self.queue.put_nowait(frame)
        except asyncio.QueueFull:
            try:
                self.queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            self.queue.put_nowait(frame)

    async def start(self) -> None:
        self.running = True
        self.task = asyncio.create_task(self._loop(), name="py-xiaozhi-kws")

    async def stop(self) -> None:
        self.running = False
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass

    async def _loop(self) -> None:
        while self.running:
            try:
                frame = self.queue.get_nowait()
            except asyncio.QueueEmpty:
                await asyncio.sleep(0.005)
                continue
            self.stream.accept_waveform(sample_rate=self.sample_rate, waveform=frame.astype(np.float32) / 32768.0)
            if self.spotter.is_ready(self.stream):
                self.spotter.decode_stream(self.stream)
                result = self.spotter.get_result(self.stream)
                if result and time.monotonic() - self.last_detection_time >= self.cooldown:
                    self.last_detection_time = time.monotonic()
                    await self.on_detected(result)
                    self.spotter.reset_stream(self.stream)
