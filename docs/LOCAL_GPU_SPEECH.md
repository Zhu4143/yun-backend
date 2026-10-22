# Yun local GPU speech

This project can run its speech synthesis and transcription locally on the GPU:

- TTS: `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` by default (safe on 8 GB GPUs)
- ASR: `iic/SenseVoiceSmall` with VAD and punctuation
- listener: `127.0.0.1:17892` only

## One-time setup

Install a working 64-bit Python 3.10 or 3.11 first. The current PowerShell
`python` command must be able to run `python --version`.

Then run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-local-speech.ps1
```

The first request downloads the public model weights into
`yun-desktop-agent/local-speech-service/cache/`; that directory is ignored by
Git. Do not put a real person's cloned voice into this project without their
permission.

## Enable it

Add these lines to the local `.env` file, then start Yun with `start-yun.bat`:

```dotenv
YUN_TTS_PROVIDER=local-qwen3
ASR_PROVIDER=local-sensevoice
YUN_LOCAL_SPEECH_URL=http://127.0.0.1:17892
```

The public frontend contract remains unchanged: `/api/tts` returns WAV audio,
and `/api/asr/transcribe` returns `{ text }`. Remove the two provider lines to
fall back to the existing Doubao TTS and DashScope ASR paths.

## First health check

After startup, open `http://127.0.0.1:17892/health`. `cudaAvailable` should be
`true` and `device` should be `cuda:0`. The TTS and ASR model fields change to
`loaded: true` after their first respective request.
