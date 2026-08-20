param(
  [switch]$CpuOnly
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$serviceDir = Join-Path $root "yun-desktop-agent\local-speech-service"
$venvDir = Join-Path $serviceDir ".venv"

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "找不到 Python。请先安装 64 位 Python 3.10 或 3.11，并确保 python 在 PATH 中。"
}

if (-not (Test-Path $venvDir)) {
  python -m venv $venvDir
}

$python = Join-Path $venvDir "Scripts\python.exe"
& $python -m pip install --upgrade pip

if ($CpuOnly) {
  Write-Warning "CPU 模式可用于 SenseVoice，但不建议运行 Qwen3-TTS。"
} else {
  & $python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
}

& $python -m pip install -r (Join-Path $serviceDir "requirements.txt")

Write-Host "Local speech runtime installed." -ForegroundColor Green
Write-Host "首次启动时会下载 Qwen3-TTS 和 SenseVoice 权重；完成后请在 .env 写入："
Write-Host "YUN_TTS_PROVIDER=local-qwen3"
Write-Host "ASR_PROVIDER=local-sensevoice"
