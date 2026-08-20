"""Windows WebRTC APM binding derived from py-xiaozhi.

Derived from `py-xiaozhi/scripts/webrtc_aec_demo.py` and
`py-xiaozhi/libs/webrtc_apm/__init__.py` (MIT, Copyright 2025 Junsen).
This adapter intentionally loads the Windows x64 DLL bundled by that project;
the reference package's macOS-only guard is not applicable to its own DLL.
"""

from __future__ import annotations

import ctypes
from ctypes import POINTER, Structure, byref, c_bool, c_float, c_int, c_short, c_void_p
from pathlib import Path


class Pipeline(Structure):
    _fields_ = [("MaximumInternalProcessingRate", c_int), ("MultiChannelRender", c_bool), ("MultiChannelCapture", c_bool), ("CaptureDownmixMethod", c_int)]


class PreAmplifier(Structure):
    _fields_ = [("Enabled", c_bool), ("FixedGainFactor", c_float)]


class AnalogMicGainEmulation(Structure):
    _fields_ = [("Enabled", c_bool), ("InitialLevel", c_int)]


class CaptureLevelAdjustment(Structure):
    _fields_ = [("Enabled", c_bool), ("PreGainFactor", c_float), ("PostGainFactor", c_float), ("MicGainEmulation", AnalogMicGainEmulation)]


class HighPassFilter(Structure):
    _fields_ = [("Enabled", c_bool), ("ApplyInFullBand", c_bool)]


class EchoCanceller(Structure):
    _fields_ = [("Enabled", c_bool), ("MobileMode", c_bool), ("ExportLinearAecOutput", c_bool), ("EnforceHighPassFiltering", c_bool)]


class NoiseSuppression(Structure):
    _fields_ = [("Enabled", c_bool), ("NoiseLevel", c_int), ("AnalyzeLinearAecOutputWhenAvailable", c_bool)]


class TransientSuppression(Structure):
    _fields_ = [("Enabled", c_bool)]


class ClippingPredictor(Structure):
    _fields_ = [("Enabled", c_bool), ("PredictorMode", c_int), ("WindowLength", c_int), ("ReferenceWindowLength", c_int), ("ReferenceWindowDelay", c_int), ("ClippingThreshold", c_float), ("CrestFactorMargin", c_float), ("UsePredictedStep", c_bool)]


class AnalogGainController(Structure):
    _fields_ = [("Enabled", c_bool), ("StartupMinVolume", c_int), ("ClippedLevelMin", c_int), ("EnableDigitalAdaptive", c_bool), ("ClippedLevelStep", c_int), ("ClippedRatioThreshold", c_float), ("ClippedWaitFrames", c_int), ("Predictor", ClippingPredictor)]


class GainController1(Structure):
    _fields_ = [("Enabled", c_bool), ("ControllerMode", c_int), ("TargetLevelDbfs", c_int), ("CompressionGainDb", c_int), ("EnableLimiter", c_bool), ("AnalogController", AnalogGainController)]


class InputVolumeController(Structure):
    _fields_ = [("Enabled", c_bool)]


class AdaptiveDigital(Structure):
    _fields_ = [("Enabled", c_bool), ("HeadroomDb", c_float), ("MaxGainDb", c_float), ("InitialGainDb", c_float), ("MaxGainChangeDbPerSecond", c_float), ("MaxOutputNoiseLevelDbfs", c_float)]


class FixedDigital(Structure):
    _fields_ = [("GainDb", c_float)]


class GainController2(Structure):
    _fields_ = [("Enabled", c_bool), ("VolumeController", InputVolumeController), ("AdaptiveController", AdaptiveDigital), ("FixedController", FixedDigital)]


class Config(Structure):
    _fields_ = [("PipelineConfig", Pipeline), ("PreAmp", PreAmplifier), ("LevelAdjustment", CaptureLevelAdjustment), ("HighPass", HighPassFilter), ("Echo", EchoCanceller), ("NoiseSuppress", NoiseSuppression), ("TransientSuppress", TransientSuppression), ("GainControl1", GainController1), ("GainControl2", GainController2)]


class NativeWebRtcApm:
    """10 ms, signed-16-bit PCM WebRTC APM processor with true render input."""

    def __init__(self, sample_rate: int = 16000, channels: int = 1, delay_ms: int = 50):
        if sample_rate not in (8000, 16000, 32000, 48000) or channels not in (1, 2):
            raise ValueError("APM supports 8/16/32/48 kHz and one or two channels")
        self.sample_rate, self.channels = sample_rate, channels
        self.frame_samples = sample_rate // 100 * channels
        self.dll_path = Path(__file__).parent / "vendor" / "py_xiaozhi" / "webrtc_apm" / "windows" / "x64" / "libwebrtc_apm.dll"
        if not self.dll_path.exists():
            raise FileNotFoundError(f"py-xiaozhi WebRTC APM DLL is missing: {self.dll_path}")
        self.lib = ctypes.CDLL(str(self.dll_path))
        self._bind()
        self.handle = self.lib.WebRTC_APM_Create()
        if not self.handle:
            raise RuntimeError("WebRTC_APM_Create returned null")
        self.stream_config = self.lib.WebRTC_APM_CreateStreamConfig(sample_rate, channels)
        if not self.stream_config:
            self.close()
            raise RuntimeError("WebRTC_APM_CreateStreamConfig returned null")
        status = self.lib.WebRTC_APM_ApplyConfig(self.handle, byref(self._config()))
        if status != 0:
            self.close()
            raise RuntimeError(f"WebRTC_APM_ApplyConfig failed: {status}")
        self.lib.WebRTC_APM_SetStreamDelayMs(self.handle, delay_ms)

    def _bind(self) -> None:
        self.lib.WebRTC_APM_Create.restype, self.lib.WebRTC_APM_Create.argtypes = c_void_p, []
        self.lib.WebRTC_APM_Destroy.restype, self.lib.WebRTC_APM_Destroy.argtypes = None, [c_void_p]
        self.lib.WebRTC_APM_CreateStreamConfig.restype, self.lib.WebRTC_APM_CreateStreamConfig.argtypes = c_void_p, [c_int, c_int]
        self.lib.WebRTC_APM_DestroyStreamConfig.restype, self.lib.WebRTC_APM_DestroyStreamConfig.argtypes = None, [c_void_p]
        self.lib.WebRTC_APM_ApplyConfig.restype, self.lib.WebRTC_APM_ApplyConfig.argtypes = c_int, [c_void_p, POINTER(Config)]
        args = [c_void_p, POINTER(c_short), c_void_p, c_void_p, POINTER(c_short)]
        self.lib.WebRTC_APM_ProcessReverseStream.restype, self.lib.WebRTC_APM_ProcessReverseStream.argtypes = c_int, args
        self.lib.WebRTC_APM_ProcessStream.restype, self.lib.WebRTC_APM_ProcessStream.argtypes = c_int, args
        self.lib.WebRTC_APM_SetStreamDelayMs.restype, self.lib.WebRTC_APM_SetStreamDelayMs.argtypes = None, [c_void_p, c_int]

    def _config(self) -> Config:
        config = Config()
        config.PipelineConfig.MaximumInternalProcessingRate = self.sample_rate
        config.PipelineConfig.CaptureDownmixMethod = 0
        config.HighPass.Enabled = True
        config.HighPass.ApplyInFullBand = True
        config.Echo.Enabled = True
        config.Echo.EnforceHighPassFiltering = True
        config.NoiseSuppress.Enabled = True
        config.NoiseSuppress.NoiseLevel = 2  # High
        config.GainControl1.Enabled = True
        config.GainControl1.ControllerMode = 1  # Adaptive digital
        config.GainControl1.TargetLevelDbfs = 3
        config.GainControl1.CompressionGainDb = 9
        config.GainControl1.EnableLimiter = True
        return config

    def process(self, capture_pcm: bytes, render_pcm: bytes) -> bytes:
        """Feed exact speaker PCM first, then return AEC/NS processed microphone PCM."""
        expected = self.frame_samples * 2
        if len(capture_pcm) != expected or len(render_pcm) != expected:
            raise ValueError(f"APM requires exact 10 ms frames ({expected} bytes)")
        render = (c_short * self.frame_samples).from_buffer_copy(render_pcm)
        render_out = (c_short * self.frame_samples)()
        status = self.lib.WebRTC_APM_ProcessReverseStream(self.handle, render, self.stream_config, self.stream_config, render_out)
        if status != 0:
            raise RuntimeError(f"WebRTC_APM_ProcessReverseStream failed: {status}")
        capture = (c_short * self.frame_samples).from_buffer_copy(capture_pcm)
        capture_out = (c_short * self.frame_samples)()
        status = self.lib.WebRTC_APM_ProcessStream(self.handle, capture, self.stream_config, self.stream_config, capture_out)
        if status != 0:
            raise RuntimeError(f"WebRTC_APM_ProcessStream failed: {status}")
        return bytes(capture_out)

    def close(self) -> None:
        if getattr(self, "stream_config", None):
            self.lib.WebRTC_APM_DestroyStreamConfig(self.stream_config)
            self.stream_config = None
        if getattr(self, "handle", None):
            self.lib.WebRTC_APM_Destroy(self.handle)
            self.handle = None
