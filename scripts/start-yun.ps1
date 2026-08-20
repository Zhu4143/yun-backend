param(
  [double]$SoundThreshold = 0.015,
  [switch]$NoWechat,
  [switch]$EnableWechat,
  [switch]$DebugOcr,
  [switch]$Silent
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Test-PortOpen {
  param([int]$Port)
  $client = $null
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(300)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    if ($client) { $client.Close() }
  }
}

function Wait-YunFrontend {
  param(
    [string]$Url = "http://127.0.0.1:5173",
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
        Write-Host "Frontend is ready. Opening $Url" -ForegroundColor Green
        Start-Process $Url
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  Write-Warning "Frontend did not become ready within $TimeoutSeconds seconds; it was not opened automatically."
  return $false
}

function Wait-YunService {
  param(
    [string]$Title,
    [string]$Url,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
        Write-Host "$Title is ready: $Url" -ForegroundColor Green
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 750
    }
  }

  Write-Warning "$Title did not pass its health check within $TimeoutSeconds seconds: $Url"
  return $false
}

function Confirm-YunService {
  param(
    [string]$Title,
    [string]$Url,
    [string]$RetryTitle,
    [string]$RetryCommand,
    [int]$TimeoutSeconds = 30
  )

  if (Wait-YunService -Title $Title -Url $Url -TimeoutSeconds $TimeoutSeconds) {
    return $true
  }

  if ($RetryCommand) {
    Write-Warning "$Title failed health check. Retrying its local service once..."
    Start-YunWindow -Title $RetryTitle -Command $RetryCommand
    if (Wait-YunService -Title $Title -Url $Url -TimeoutSeconds $TimeoutSeconds) {
      return $true
    }
  }

  Write-Warning "$Title is unavailable. Voice wake-up will not work until this service is healthy. Keep this terminal open and check the '$RetryTitle' window for the error."
  return $false
}

function Start-YunWindow {
  param(
    [string]$Title,
    [string]$Command
  )

  $escapedRoot = $Root.Replace("'", "''")
  $escapedTitle = $Title.Replace("'", "''")
  $fullCommand = @"
`$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
`$env:PYTHONIOENCODING = 'utf-8'
`$host.UI.RawUI.WindowTitle = '$escapedTitle'
Set-Location '$escapedRoot'
$Command
"@

  $windowStyle = if ($Silent) { "Hidden" } else { "Normal" }

  Start-Process powershell.exe -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-Command", $fullCommand
  ) -WindowStyle $windowStyle | Out-Null
}

Write-Host "Starting Yun Companion stack..." -ForegroundColor Cyan
Write-Host "Workspace: $Root"

if (Test-PortOpen 3030) {
  Write-Host "Backend already running on http://127.0.0.1:3030" -ForegroundColor Yellow
} else {
  Start-YunWindow -Title "Yun Backend :3030" -Command "npm run server"
}

if ((Test-PortOpen 3131) -or (Test-PortOpen 17890)) {
  Write-Host "Desktop Agent already running on ws://127.0.0.1:3131 or http://127.0.0.1:17890" -ForegroundColor Yellow
} else {
  Start-YunWindow -Title "Yun Desktop Agent :3131/:17890" -Command "npm run desktop-agent"
}

$voiceprintPython = Join-Path $Root "yun-desktop-agent\voiceprint-service\.venv\Scripts\python.exe"
if (Test-PortOpen 17891) {
  Write-Host "Local voiceprint service already running on http://127.0.0.1:17891" -ForegroundColor Yellow
} elseif (Test-Path $voiceprintPython) {
  $voiceprintCommand = "& '$($voiceprintPython.Replace("'", "''"))' '$($Root.Replace("'", "''"))\yun-desktop-agent\voiceprint-service\voiceprint_service.py'"
  Start-YunWindow -Title "Yun Local Voiceprint :17891" -Command $voiceprintCommand
} else {
  Write-Host "Local voiceprint service is not installed yet; skip it." -ForegroundColor Yellow
}

$localSpeechPython = Join-Path $Root "yun-desktop-agent\local-speech-service\.venv\python.exe"
$localSpeechCommand = $null
if (Test-PortOpen 17892) {
  Write-Host "Local GPU speech service already running on http://127.0.0.1:17892" -ForegroundColor Yellow
} elseif (Test-Path $localSpeechPython) {
  $localSpeechCommand = "& '$($localSpeechPython.Replace("'", "''"))' '$($Root.Replace("'", "''"))\yun-desktop-agent\local-speech-service\speech_service.py'"
  Start-YunWindow -Title "Yun Local GPU Speech :17892" -Command $localSpeechCommand
} else {
  Write-Host "Local GPU speech service is not installed yet; run scripts\install-local-speech.ps1 first." -ForegroundColor Yellow
}

$omniVoicePython = Join-Path $Root "yun-desktop-agent\omni-voice-service\.venv\Scripts\python.exe"
if (Test-PortOpen 17893) {
  Write-Host "OmniVoice clone service already running on http://127.0.0.1:17893" -ForegroundColor Yellow
} elseif (Test-Path $omniVoicePython) {
  $omniVoiceCommand = "& '$($omniVoicePython.Replace("'", "''"))' '$($Root.Replace("'", "''"))\yun-desktop-agent\omni-voice-service\omni_voice_service.py'"
  Start-YunWindow -Title "Yun OmniVoice Clone :17893" -Command $omniVoiceCommand
} else {
  Write-Host "OmniVoice clone service is not installed yet; skip it." -ForegroundColor Yellow
}

$nativeVoicePython = Join-Path $Root "yun-desktop-agent\local-speech-service\.venv\python.exe"
$nativeVoiceCommand = $null
if (Test-PortOpen 17894) {
  Write-Host "Native WebRTC APM voice engine already running on http://127.0.0.1:17894" -ForegroundColor Yellow
} elseif (Test-Path $nativeVoicePython) {
  $nativeVoiceCommand = "& '$($nativeVoicePython.Replace("'", "''"))' '$($Root.Replace("'", "''"))\yun-desktop-agent\native-voice-engine\voice_engine.py'"
  Start-YunWindow -Title "Yun Native Voice Engine :17894" -Command $nativeVoiceCommand
} else {
  Write-Host "Native voice engine Python environment is unavailable; browser AEC fallback remains available." -ForegroundColor Yellow
}

if (Test-PortOpen 5173) {
  Write-Host "Frontend already running on http://127.0.0.1:5173" -ForegroundColor Yellow
} else {
  Start-YunWindow -Title "Yun Frontend :5173" -Command "npm run dev -- --host 127.0.0.1"
}

if ($EnableWechat -and -not $NoWechat) {
  $wechatArgs = "npm run wechat-listener -- --sound-threshold $SoundThreshold"
  if ($DebugOcr) {
    $wechatArgs += " --debug-ocr --crop-width-ratio 0.62"
  }
  Start-YunWindow -Title "Yun WeChat Listener" -Command $wechatArgs
} else {
  Write-Host "WeChat listener is disabled. Pass -EnableWechat to start it explicitly." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Yun stack launch requested." -ForegroundColor Green
Write-Host "Frontend: http://127.0.0.1:5173"
Write-Host "Backend:  http://127.0.0.1:3030"
Write-Host "Agent WS: ws://127.0.0.1:3131"
Write-Host "Agent HTTP: http://127.0.0.1:17890/api/wechat-command"
Write-Host "Voiceprint: http://127.0.0.1:17891/health"
Write-Host "OmniVoice: http://127.0.0.1:17893/health"
Write-Host "Native Voice Engine: http://127.0.0.1:17894/health"
Write-Host ""
Confirm-YunService -Title "Local speech recognition" -Url "http://127.0.0.1:17892/health" -RetryTitle "Yun Local GPU Speech :17892" -RetryCommand $localSpeechCommand -TimeoutSeconds 75 | Out-Null
Confirm-YunService -Title "Native wake-word engine" -Url "http://127.0.0.1:17894/health" -RetryTitle "Yun Native Voice Engine :17894" -RetryCommand $nativeVoiceCommand -TimeoutSeconds 35 | Out-Null
Wait-YunFrontend | Out-Null
Write-Host "Close the opened terminal windows to stop each service."
