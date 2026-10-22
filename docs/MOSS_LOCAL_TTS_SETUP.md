# MOSS local TTS setup

## Service layout

```text
tools/
  moss-tts-service-source/   # public runtime source snapshot, no weights
  moss-tts-service/
    lib/
    model/
      moss.pth               # user-supplied, Git-ignored
      config.json            # user-supplied model configuration
    requirements.txt
    server.py
```

The local service binds only to `127.0.0.1:5010` and loads the model once on startup. It runs CPU-first (`DEVICE = "cpu"`). The source uses an older PyTorch dependency set, so verify CPU inference before attempting any RTX 5060/CUDA change.

## Model files

Place your manually obtained files here:

- `tools/moss-tts-service/model/moss.pth`
- `tools/moss-tts-service/model/config.json`

`moss.pth` and generated WAV files are Git-ignored. No model weights are included, downloaded, uploaded, or committed by this project.

## Python environment

The expected environment is:

```bat
conda create -n moss-tts python=3.8 -y
conda activate moss-tts
cd tools\moss-tts-service
pip install -r requirements.txt
```

`torchsummary` is included in the requirements because the original source imports it. If the original CPU PyTorch pins fail on a current machine, install a compatible CPU PyTorch build first, then install the remaining requirements without broadly upgrading unrelated packages.

## API contract

`GET http://127.0.0.1:5010/health`

```json
{ "status": "ok", "modelLoaded": true, "device": "cpu" }
```

`POST http://127.0.0.1:5010/text_to_speech`

```json
{ "text": "我是五五零 W 离线版本，系统自检正在进行。", "speechRate": 0.92 }
```

The service returns `audio/wav`, accepts up to 500 characters, constrains speech rate to 0.6–1.4, serializes inference with a lock, returns audio from memory, and avoids logging full text.

The web app calls the Node proxy rather than port 5010 directly:

```text
browser -> POST /api/moss-tts -> http://127.0.0.1:5010/text_to_speech
```

## Startup

Use `scripts\start-moss-tts.bat` to start only TTS. It checks Conda and both model files, then keeps the terminal open on error.

Use `scripts\start-moss-system.bat` to start TTS, the Node backend, and the Vite frontend in separate windows. It does not start a service again when ports 5010, 3030, or 4173 are already in use.

The console has `[F4] MOSS VOICE / ON|OFF`. This setting is retained in local storage. Turning it off prevents further TTS requests; text chat remains unaffected.

## Verified local CPU run

The initial Windows CPU run uses the `moss-tts` Conda environment and binds only
to `127.0.0.1:5010`. The public runtime source is installed without model
weights; the checkpoint and configuration are supplied locally by the user.

Validated endpoints:

- `GET /health` returned `status: ok`, `modelLoaded: true`, `device: cpu`.
- `POST /text_to_speech` generated a mono 16-bit, 16 kHz WAV in memory.
- The Node proxy endpoint `/api/moss-tts` also returned WAV content successfully.

The model configuration uses `chinese_cleaners`. If the optional `jieba`
dictionary is unavailable, the service falls back to character-level Chinese
segmentation so the local service remains operational. Installing `jieba` later
improves phrase-level prosody but is not required to start the service.

## Validation sequence

After both model files and Conda are available:

1. Run `scripts\start-moss-tts.bat`.
2. Check `GET http://127.0.0.1:5010/health`.
3. Submit one short request to `/text_to_speech` and save it as `temp\moss-test.wav`.
4. Validate the WAV header, non-zero size, and duration.
5. Start the web system and send one MOSS directive with voice enabled.
6. Confirm `/api/moss-tts` returns 200 and the browser plays the WAV.
