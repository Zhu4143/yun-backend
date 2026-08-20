import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime


YUN = "\u6600"
SAFE_DEFAULT_CONTACT = "\u4e1c\u5b87"
RAW_DEFAULT_CONTACT = os.getenv("YUN_WECHAT_ALLOWED_CONTACT", SAFE_DEFAULT_CONTACT)
DEFAULT_AGENT_URL = os.getenv(
    "YUN_WECHAT_COMMAND_URL",
    "http://127.0.0.1:17890/api/wechat-command",
)
DEFAULT_VISION_URL = os.getenv(
    "YUN_WECHAT_VISION_URL",
    "http://127.0.0.1:3030/api/vision-chat",
)
WECHAT_AUDIO_PROCESSES = {"weixin.exe", "wechat.exe", "wechatappex.exe"}


def looks_garbled_contact(value):
    text = str(value or "").strip()
    if not text:
        return True
    if text == SAFE_DEFAULT_CONTACT:
        return False
    if "\ufffd" in text or "?" in text or "\u951f" in text:
        return True
    # Common mojibake characters seen when ?? is passed through cmd/npm/PowerShell.
    mojibake_markers = (
        "\u6d93", "\u6ec3", "\u7564",  # ???
        "\u00e4", "\u00b8", "\u0153", "\u00e5", "\u00ae", "\u2021",  # ??????
    )
    if any(marker in text for marker in mojibake_markers):
        return True
    if re.fullmatch(r"[A-Za-z0-9_\- .]+", text):
        return False
    return False


def normalize_contact_name(contact):
    value = str(contact or "").strip()
    if looks_garbled_contact(value):
        return SAFE_DEFAULT_CONTACT
    return value


DEFAULT_CONTACT = normalize_contact_name(RAW_DEFAULT_CONTACT)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def log(message):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[wechat-listener {timestamp}] {message}", flush=True)


def normalize_text(value):
    return str(value or "").replace("\r\n", "\n").strip()


def extract_message_text(message):
    if message is None:
        return ""
    if isinstance(message, str):
        return normalize_text(message)
    if isinstance(message, dict):
        for key in ("content", "text", "message", "msg", "\u6d88\u606f\u5185\u5bb9", "\u5185\u5bb9"):
            if key in message and normalize_text(message.get(key)):
                return normalize_text(message.get(key))
        values = [normalize_text(value) for value in message.values()]
        values = [value for value in values if value]
        return values[-1] if values else ""
    if isinstance(message, (list, tuple)):
        values = [normalize_text(value) for value in message if normalize_text(value)]
        return values[-1] if values else ""
    for attr in ("content", "text", "message", "msg"):
        value = getattr(message, attr, "")
        if normalize_text(value):
            return normalize_text(value)
    return normalize_text(message)


def extract_message_time(message):
    if isinstance(message, dict):
        for key in ("time", "create_time", "datetime", "date", "\u65f6\u95f4"):
            if key in message and normalize_text(message.get(key)):
                return normalize_text(message.get(key))
    return ""


def extract_command(raw_text):
    text = normalize_text(raw_text)
    if not text:
        return ""
    match = re.search(r"@?\s*\u6600[\uff0c,\u3002.\s]*(.*)", text, re.S)
    if not match:
        return ""
    command = normalize_text(match.group(1))
    return command or text


def normalize_command_text(raw_text, require_wake_word=True):
    text = normalize_text(raw_text)
    if not text:
        return ""
    if require_wake_word:
        return extract_command(text)
    return text


def fingerprint_message(message, text):
    payload = json.dumps(
        {
            "time": extract_message_time(message),
            "text": text,
            "raw": repr(message),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def create_wechat_audio_meter():
    try:
        from pycaw.pycaw import AudioUtilities, IAudioMeterInformation
    except Exception as exc:
        raise RuntimeError("pycaw is required for sound trigger mode. Run: pip install -r requirements.txt") from exc

    def read_peak():
        peak = 0.0
        active_processes = []
        for session in AudioUtilities.GetAllSessions():
            process = session.Process
            if not process:
                continue
            name = (process.name() or "").lower()
            if name not in WECHAT_AUDIO_PROCESSES:
                continue
            try:
                meter = session._ctl.QueryInterface(IAudioMeterInformation)
                value = float(meter.GetPeakValue())
            except Exception:
                value = 0.0
            if value > 0:
                active_processes.append(f"{name}:{process.pid}:{value:.3f}")
            peak = max(peak, value)
        return peak, active_processes

    return read_peak


def wait_for_wechat_sound(read_peak, args):
    while True:
        peak, active_processes = read_peak()
        if peak >= args.sound_threshold:
            log(f"WeChat sound trigger peak={peak:.3f} sessions={','.join(active_processes)}")
            time.sleep(args.after_sound_delay)
            return
        time.sleep(args.audio_poll)


def ps_string(value):
    return "'" + str(value).replace("'", "''") + "'"


def sendkeys_text(value):
    escaped = []
    special = set("+^%~(){}[]")
    for char in str(value):
        if char in special:
            escaped.append("{" + char + "}")
        elif char == "\n":
            escaped.append("{ENTER}")
        else:
            escaped.append(char)
    return "".join(escaped)


def ocr_current_wechat_window(
    contact,
    debug_ocr=False,
    crop_left_offset=0,
    crop_top_offset=0,
    crop_width_ratio=0.62,
    crop_bottom_offset=0,
):
    contact = normalize_contact_name(contact)
    contact_b64 = base64.b64encode(str(contact).encode("utf-8")).decode("ascii")
    debug_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "debug"))
    debug_dir_b64 = base64.b64encode(debug_dir.encode("utf-8")).decode("ascii")
    debug_ocr_ps = "$true" if debug_ocr else "$false"
    script = f"""
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class YunWeChatOcr {{
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  public struct RECT {{ public int Left; public int Top; public int Right; public int Bottom; }}
}}
"@

function Await-WinRt($operation, $resultType) {{
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {{
    $_.Name -eq "AsTask" -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
  }} | Select-Object -First 1).MakeGenericMethod($resultType)
  $task = $asTask.Invoke($null, @($operation))
  $task.Wait()
  $task.Result
}}

function Set-ClipboardText($text) {{
  $payload = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text))
  $clipScript = @"
Add-Type -AssemblyName System.Windows.Forms
`$text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('$payload'))
[System.Windows.Forms.Clipboard]::SetText(`$text)
"@
  $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($clipScript))
  $process = Start-Process -FilePath powershell.exe -ArgumentList @("-NoProfile", "-STA", "-EncodedCommand", $encoded) -PassThru -WindowStyle Hidden
  if (-not $process.WaitForExit(3000)) {{
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "clipboard helper timed out"
  }}
  if ($process.ExitCode -ne 0) {{ throw "clipboard helper failed: $($process.ExitCode)" }}
}}

$contact = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{contact_b64}'))
$debugDir = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{debug_dir_b64}'))
$debugOcr = {debug_ocr_ps}
$cropLeftOffset = {int(crop_left_offset)}
$cropTopOffset = {int(crop_top_offset)}
$cropWidthRatio = {float(crop_width_ratio)}
$cropBottomOffset = {int(crop_bottom_offset)}
$wechatProcesses = @(Get-Process -Name Weixin -ErrorAction SilentlyContinue)
if (-not $wechatProcesses.Count) {{
  Start-Process -FilePath "C:\\Program Files\\Tencent\\Weixin\\Weixin.exe"
  Start-Sleep -Seconds 2
  $wechatProcesses = @(Get-Process -Name Weixin -ErrorAction SilentlyContinue)
}}
if (-not $wechatProcesses.Count) {{ throw "Weixin process not found" }}

$wechatPids = @{{}}
foreach ($p in $wechatProcesses) {{ $wechatPids[[uint32]$p.Id] = $p }}
$windowCandidates = New-Object System.Collections.Generic.List[object]
$callback = [YunWeChatOcr+EnumWindowsProc] {{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  $targetProcessId = [UInt32]0
  [YunWeChatOcr]::GetWindowThreadProcessId($hWnd, [ref]$targetProcessId) | Out-Null
  if (-not $wechatPids.ContainsKey($targetProcessId)) {{ return $true }}
  $title = [System.Diagnostics.Process]::GetProcessById([int]$targetProcessId).MainWindowTitle
  $rect = New-Object YunWeChatOcr+RECT
  [YunWeChatOcr]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  $windowCandidates.Add([pscustomobject]@{{ Handle = $hWnd; Pid = $targetProcessId; Title = $title; Width = $width; Height = $height; Area = $width * $height; Visible = [YunWeChatOcr]::IsWindowVisible($hWnd) }}) | Out-Null
  return $true
}}
[YunWeChatOcr]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
$candidate = $windowCandidates | Where-Object {{ $_.Visible -and $_.Area -gt 1000 }} | Sort-Object Area -Descending | Select-Object -First 1
if (-not $candidate) {{ throw "Weixin window not found" }}
$handle = $candidate.Handle
$process = Get-Process -Id $candidate.Pid
[YunWeChatOcr]::ShowWindow($handle, 9) | Out-Null
$HWND_TOPMOST = [IntPtr](-1)
$HWND_NOTOPMOST = [IntPtr](-2)
$SWP_SHOWWINDOW = 0x0040
[YunWeChatOcr]::MoveWindow($handle, 80, 70, 1280, 860, $true) | Out-Null
[YunWeChatOcr]::SetWindowPos($handle, $HWND_TOPMOST, 80, 70, 1280, 860, $SWP_SHOWWINDOW) | Out-Null
[YunWeChatOcr]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Milliseconds 900

$shell = New-Object -ComObject WScript.Shell
$shell.AppActivate($process.Id) | Out-Null
Start-Sleep -Milliseconds 500
$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
[YunWeChatOcr]::SetCursorPos($rect.Left + 140, $rect.Top + 90) | Out-Null
[YunWeChatOcr]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
[YunWeChatOcr]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 300
$foreground = [YunWeChatOcr]::GetForegroundWindow()
$foregroundPid = [UInt32]0
[YunWeChatOcr]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid) | Out-Null
$foregroundProcess = Get-Process -Id $foregroundPid -ErrorAction SilentlyContinue
if (-not $foregroundProcess -or $foregroundProcess.ProcessName -notin @("Weixin", "WeChat", "WeChatAppEx")) {{
  throw "Foreground window is not WeChat; skip OCR to avoid reading another app. Foreground=$($foregroundProcess.ProcessName)"
}}
$shell.SendKeys("^f")
Start-Sleep -Milliseconds 300
for ($try = 0; $try -lt 5; $try++) {{
  try {{
    Set-ClipboardText $contact
    break
  }} catch {{
    Start-Sleep -Milliseconds 180
    if ($try -eq 4) {{ throw }}
  }}
}}
$shell.SendKeys("^v")
Start-Sleep -Milliseconds 700
$shell.SendKeys("{{ENTER}}")
Start-Sleep -Milliseconds 1200

$rect = New-Object YunWeChatOcr+RECT
[YunWeChatOcr]::GetWindowRect($handle, [ref]$rect) | Out-Null
$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)

$sidebarWidth = 250
$headerHeight = 80
$inputHeight = 170
$adaptiveSidebarWidth = [Math]::Max($sidebarWidth, [int]($width * 0.39))
$adaptiveHeaderHeight = [Math]::Max($headerHeight, 130)
$chatLeft = $rect.Left + $adaptiveSidebarWidth + 20 + $cropLeftOffset
$chatTop = $rect.Top + $adaptiveHeaderHeight + $cropTopOffset
$chatWidth = [Math]::Max(1, $width - $adaptiveSidebarWidth - 40 - $cropLeftOffset)
$chatHeight = [Math]::Max(1, $height - $adaptiveHeaderHeight - $inputHeight - $cropTopOffset - $cropBottomOffset)
$captureLeft = [Math]::Max($rect.Left, $chatLeft)
$captureTop = [Math]::Max($rect.Top, $chatTop)
$captureWidth = [Math]::Max(1, [int]($chatWidth * $cropWidthRatio))
$captureHeight = [Math]::Max(1, $chatHeight)
if ($captureLeft + $captureWidth -gt $rect.Right) {{ $captureWidth = [Math]::Max(1, $rect.Right - $captureLeft) }}
if ($captureTop + $captureHeight -gt $rect.Bottom) {{ $captureHeight = [Math]::Max(1, $rect.Bottom - $captureTop) }}

$fullBitmap = New-Object System.Drawing.Bitmap($width, $height)
$fullGraphics = [System.Drawing.Graphics]::FromImage($fullBitmap)
$fullGraphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($width, $height))

if ($debugOcr) {{
  New-Item -ItemType Directory -Force -Path $debugDir | Out-Null
  $fullPath = Join-Path $debugDir "wechat-full.png"
  $cropPath = Join-Path $debugDir "wechat-ocr-crop.png"
  $overlayPath = Join-Path $debugDir "wechat-ocr-debug-overlay.png"
  $fullBitmap.Save($fullPath, [System.Drawing.Imaging.ImageFormat]::Png)
}} else {{
  $fullPath = ""
  $cropPath = ""
  $overlayPath = ""
}}

$bitmap = New-Object System.Drawing.Bitmap($captureWidth, $captureHeight)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$sourceRect = [System.Drawing.Rectangle]::new($captureLeft - $rect.Left, $captureTop - $rect.Top, $captureWidth, $captureHeight)
$destRect = [System.Drawing.Rectangle]::new(0, 0, $captureWidth, $captureHeight)
$graphics.DrawImage($fullBitmap, $destRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)

if ($debugOcr) {{
  $bitmap.Save($cropPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $overlayBitmap = $fullBitmap.Clone()
  $overlayGraphics = [System.Drawing.Graphics]::FromImage($overlayBitmap)
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Red, 5)
  $font = New-Object System.Drawing.Font("Arial", 18, [System.Drawing.FontStyle]::Bold)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Red)
  $overlayGraphics.DrawRectangle($pen, $sourceRect)
  $overlayGraphics.DrawString("x=$captureLeft, y=$captureTop, w=$captureWidth, h=$captureHeight", $font, $brush, 12, 12)
  $overlayBitmap.Save($overlayPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $brush.Dispose()
  $font.Dispose()
  $pen.Dispose()
  $overlayGraphics.Dispose()
  $overlayBitmap.Dispose()
}}
$fullGraphics.Dispose()
$fullBitmap.Dispose()

$streamForPng = New-Object System.IO.MemoryStream
$bitmap.Save($streamForPng, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
$bytes = $streamForPng.ToArray()
$streamForPng.Dispose()

$stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
$writer = [Windows.Storage.Streams.DataWriter]::new($stream)
$writer.WriteBytes($bytes)
Await-WinRt $writer.StoreAsync() ([UInt32]) | Out-Null
Await-WinRt $writer.FlushAsync() ([Boolean]) | Out-Null
$writer.DetachStream() | Out-Null
$writer.Dispose()
$stream.Seek(0)
$decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$softwareBitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) {{ throw "Windows OCR engine unavailable" }}
$ocr = Await-WinRt ($engine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])
[YunWeChatOcr]::SetWindowPos($handle, $HWND_NOTOPMOST, $rect.Left, $rect.Top, $width, $height, $SWP_SHOWWINDOW) | Out-Null
[pscustomobject]@{{
  Text = (($ocr.Text -replace "`r`n", "`n").Trim())
  WindowLeft = $rect.Left
  WindowTop = $rect.Top
  WindowWidth = $width
  WindowHeight = $height
  CropX = $captureLeft
  CropY = $captureTop
  CropW = $captureWidth
  CropH = $captureHeight
  FullPath = $fullPath
  CropPath = $cropPath
  OverlayPath = $overlayPath
}} | ConvertTo-Json -Compress
"""
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=45,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "WeChat OCR failed")
    payload = json.loads(result.stdout)
    log(
        "WeChat window rect: "
        f"left={payload.get('WindowLeft')}, top={payload.get('WindowTop')}, "
        f"width={payload.get('WindowWidth')}, height={payload.get('WindowHeight')}"
    )
    log(
        "OCR crop rect: "
        f"x={payload.get('CropX')}, y={payload.get('CropY')}, "
        f"w={payload.get('CropW')}, h={payload.get('CropH')}"
    )
    if payload.get("OverlayPath"):
        log(f"Debug overlay saved: {payload.get('OverlayPath')}")
    return normalize_text(payload.get("Text"))


def extract_latest_command_from_ocr(text):
    compact = normalize_text(text)
    compact = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", compact)
    compact = re.sub(r"\s*([\uff0c,\u3002.!?\uff01\uff1f:：])\s*", r"\1", compact)
    matches = list(re.finditer(r"@?\s*\u6600[\uff0c,\u3002.\s]*(.*)", compact, re.S))
    if not matches:
        return "", compact
    command = normalize_text(matches[-1].group(1))
    command = re.split(
        r"(?:\d{1,2}[:：]\d{2}|嗯[\uff0c,\u3002.\s]|好的[\uff0c,\u3002.\s]|系统状态查到了|我帮你|我已经|没问题)",
        command,
        maxsplit=1,
    )[0]
    return normalize_text(command), compact


def pick_ocr_command(text, require_wake_word=False):
    raw_text = normalize_text(text)
    compact = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", raw_text)
    compact = re.sub(r"\s*([\uff0c,\u3002.!?\uff01\uff1f:：])\s*", r"\1", compact)
    wake_index = compact.rfind(YUN)
    if wake_index >= 0:
        command = normalize_text(compact[wake_index + len(YUN):])
        command = re.sub(r"^[\uff0c,\u3002.\s]+", "", command)
        command = re.split(
            r"(?:\d{2,}|\d{1,2}[:：]\d{2}|\u55ef[\uff0c,\u3002.\s]|\u597d\u7684[\uff0c,\u3002.\s]|\u7cfb\u7edf\u72b6\u6001\u67e5\u5230\u4e86|\u6211\u5e2e\u4f60|\u6211\u5df2\u7ecf|\u6ca1\u95ee\u9898|\u6587\u4ef6\u4f20\u8f93\u52a9\u624b|\u516c\u4f17\u53f7|\u5fae\u4fe1\u6e38\u620f|\u5468\u661f|\u5fae\u4fe1\u56e2\u961f)",
            command,
            maxsplit=1,
        )[0]
        return normalize_text(command), compact
    if require_wake_word:
        return "", compact
    chunks = re.findall(r"[\u4e00-\u9fffA-Za-z0-9\uff0c,\u3002.!?\uff01\uff1f:：]{2,}", compact)
    return normalize_text(chunks[-1] if chunks else compact), compact


def is_ocr_noise(value):
    text = normalize_text(value)
    if not text:
        return True
    compact = re.sub(r"\s+", "", text)
    lower = compact.lower()
    if re.fullmatch(r"[\d:：/\\.\-]+", compact):
        return True
    if re.search(r"https?://|www\.|console\.|aliyun|spm=|utm_|api#|bailian", lower):
        return True
    replacement_count = compact.count("\ufffd") + compact.count("?")
    if len(compact) >= 6 and replacement_count / max(1, len(compact)) > 0.25:
        return True
    cjk_count = len(re.findall(r"[\u4e00-\u9fff]", compact))
    if cjk_count == 0 and len(compact) >= 12:
        return True
    ui_words = {
        "\u6587\u4ef6\u4f20\u8f93\u52a9\u624b",
        "\u516c\u4f17\u53f7",
        "\u5fae\u4fe1\u6e38\u620f",
        "\u5fae\u4fe1\u56e2\u961f",
        "\u641c\u7d22",
        "\u53d1\u9001",
    }
    return compact in ui_words


WAKE_WORD_PATTERN = re.compile(r"(?i)(@?\s*(?:\u6600|\u5c0f\u4e91)|\byun\b)")


def extract_wake_command(text):
    raw_text = normalize_text(text)
    if not raw_text:
        return "", raw_text

    compact_lines = []
    for line in raw_text.splitlines():
        line = normalize_text(line)
        if line:
            line = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", line)
            compact_lines.append(line)

    for line in reversed(compact_lines):
        matches = list(WAKE_WORD_PATTERN.finditer(line))
        if not matches:
            continue
        command = line[matches[-1].end():]
        command = re.sub(r"^[\s\uff0c,\u3002.!?\uff01\uff1f:：]+", "", command)
        command = re.sub(r"[\s\uff0c,\u3002.!?\uff01\uff1f:：]+$", "", command)
        command = re.split(r"\b\d{1,2}[:：]\d{2}\b", command, maxsplit=1)[0]
        command = normalize_text(command)
        if command and not is_ocr_noise(command):
            return command, raw_text

    # No wake word: treat the latest readable message as the command.
    # The listener is already restricted to the configured WeChat contact.
    fallback = normalize_text(compact_lines[-1] if compact_lines else raw_text)
    return ("", raw_text) if is_ocr_noise(fallback) else (fallback, raw_text)


def capture_wechat_chat_for_vision(
    contact,
    debug_ocr=False,
    crop_left_offset=0,
    crop_top_offset=0,
    crop_width_ratio=0.62,
    crop_bottom_offset=0,
):
    contact = normalize_contact_name(contact)
    try:
        import pyautogui
        import pyperclip
        import win32con
        import win32gui
        import win32process
        import psutil
        from PIL import ImageDraw, ImageFont
    except Exception as exc:
        raise RuntimeError("pyautogui, pyperclip, pywin32, psutil and pillow are required for vision capture") from exc

    pyautogui.FAILSAFE = False
    debug_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "debug"))
    os.makedirs(debug_dir, exist_ok=True)

    def find_weixin_window():
        candidates = []

        def callback(hwnd, _):
            try:
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                process = psutil.Process(pid)
                if process.name().lower() not in ("weixin.exe", "wechat.exe", "wechatappex.exe"):
                    return True
                title = win32gui.GetWindowText(hwnd)
                class_name = win32gui.GetClassName(hwnd)
                left, top, right, bottom = win32gui.GetWindowRect(hwnd)
                width = max(0, right - left)
                height = max(0, bottom - top)
                area = width * height
                if area <= 1000:
                    return True
                score = area
                if win32gui.IsWindowVisible(hwnd):
                    score += 10_000_000
                if title in ("微信", "寰俊", "WeChat", "Weixin"):
                    score += 5_000_000
                if "TrayIcon" in class_name or "MessageWindow" in class_name:
                    score -= 20_000_000
                candidates.append((score, hwnd, title, class_name, (left, top, right, bottom)))
            except Exception:
                pass
            return True

        win32gui.EnumWindows(callback, None)
        if not candidates:
            subprocess.Popen([r"C:\Program Files\Tencent\Weixin\Weixin.exe"])
            time.sleep(2)
            win32gui.EnumWindows(callback, None)
        if not candidates:
            raise RuntimeError("Weixin window not found")
        selected = sorted(candidates, reverse=True)[0]
        log(f"Vision capture selected WeChat window: title={selected[2] or '<empty>'} class={selected[3]} rect={selected[4]}")
        return selected[1]

    hwnd = find_weixin_window()
    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    win32gui.MoveWindow(hwnd, 80, 70, 1280, 860, True)
    win32gui.SetWindowPos(hwnd, win32con.HWND_TOPMOST, 80, 70, 1280, 860, win32con.SWP_SHOWWINDOW)
    time.sleep(0.5)
    try:
        win32gui.SetForegroundWindow(hwnd)
    except Exception:
        pass
    pyautogui.click(140, 110)
    time.sleep(0.5)

    pyautogui.hotkey("ctrl", "f")
    time.sleep(0.2)
    pyperclip.copy(str(contact))
    pyautogui.hotkey("ctrl", "v")
    time.sleep(0.6)
    pyautogui.press("enter")
    time.sleep(1.0)

    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    width = max(1, right - left)
    height = max(1, bottom - top)
    adaptive_sidebar_width = max(250, int(width * 0.39))
    adaptive_header_height = max(80, 130)
    input_height = 170
    chat_left = left + adaptive_sidebar_width + 20 + int(crop_left_offset)
    chat_top = top + adaptive_header_height + int(crop_top_offset)
    chat_width = max(1, width - adaptive_sidebar_width - 40 - int(crop_left_offset))
    chat_height = max(1, height - adaptive_header_height - input_height - int(crop_top_offset) - int(crop_bottom_offset))
    crop_x = max(left, chat_left)
    crop_y = max(top, chat_top)
    crop_w = max(1, int(chat_width * float(crop_width_ratio)))
    crop_h = max(1, chat_height)
    if crop_x + crop_w > right:
        crop_w = max(1, right - crop_x)
    if crop_y + crop_h > bottom:
        crop_h = max(1, bottom - crop_y)

    full_path = os.path.join(debug_dir, "wechat-vision-full.png")
    crop_path = os.path.join(debug_dir, "wechat-vision-crop.png")
    overlay_path = os.path.join(debug_dir, "wechat-vision-debug-overlay.png")
    full = pyautogui.screenshot(region=(left, top, width, height))
    crop = full.crop((crop_x - left, crop_y - top, crop_x - left + crop_w, crop_y - top + crop_h))
    crop.save(crop_path)
    if debug_ocr:
        full.save(full_path)
        overlay = full.copy()
        draw = ImageDraw.Draw(overlay)
        rect = (crop_x - left, crop_y - top, crop_x - left + crop_w, crop_y - top + crop_h)
        draw.rectangle(rect, outline="red", width=5)
        draw.text((12, 12), f"x={crop_x}, y={crop_y}, w={crop_w}, h={crop_h}", fill="red")
        overlay.save(overlay_path)

    log(f"WeChat window rect: left={left}, top={top}, width={width}, height={height}")
    log(f"Vision crop rect: x={crop_x}, y={crop_y}, w={crop_w}, h={crop_h}")
    if debug_ocr:
        log(f"Vision debug overlay saved: {overlay_path}")
    return {
        "cropPath": crop_path,
        "fullPath": full_path if debug_ocr else "",
        "overlayPath": overlay_path if debug_ocr else "",
        "window": {"left": left, "top": top, "width": width, "height": height},
        "crop": {"x": crop_x, "y": crop_y, "w": crop_w, "h": crop_h},
    }


def parse_vision_json(answer):
    text = normalize_text(answer)
    if not text:
        return {}
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except Exception:
        pass
    match = re.search(r"\{.*\}", text, re.S)
    if match:
        try:
            return json.loads(match.group(0))
        except Exception:
            return {}
    return {}


def post_vision_image(vision_url, image_path, prompt):
    boundary = f"----YunVisionBoundary{int(time.time() * 1000)}"
    with open(image_path, "rb") as file:
        image_bytes = file.read()
    fields = [
        (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="text"\r\n\r\n'
            f"{prompt}\r\n"
        ).encode("utf-8"),
        (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="image"; filename="wechat-vision-crop.png"\r\n'
            "Content-Type: image/png\r\n\r\n"
        ).encode("utf-8"),
        image_bytes,
        f"\r\n--{boundary}--\r\n".encode("utf-8"),
    ]
    body = b"".join(fields)
    request = urllib.request.Request(
        vision_url,
        data=body,
        method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Vision HTTP {exc.code}: {detail}") from exc


def read_wechat_message_with_vision(args):
    capture = capture_wechat_chat_for_vision(
        args.contact,
        debug_ocr=args.debug_ocr,
        crop_left_offset=args.crop_left_offset,
        crop_top_offset=args.crop_top_offset,
        crop_width_ratio=args.crop_width_ratio,
        crop_bottom_offset=args.crop_bottom_offset,
    )
    prompt = (
        "你正在帮昀读取电脑微信聊天截图。请只看截图里左侧灰色来信气泡，忽略右侧绿色气泡、联系人列表、时间戳和输入框。\n"
        f"目标联系人是：{args.contact}。\n"
        "任务：找出截图中最新一条来自对方的消息。\n"
        "如果消息以“昀”“小云”“yun”“YUN”开头，请去掉唤醒词和标点，把剩余内容作为 command。\n"
        "如果消息没有唤醒词，也把整条最新来信作为 command。\n"
        "只返回严格 JSON，不要 Markdown，不要解释：\n"
        "{\"rawText\":\"最新来信原文\",\"command\":\"要交给昀处理的内容\",\"shouldRespond\":true}\n"
        "如果截图里没有可信的对方新消息，返回：{\"rawText\":\"\",\"command\":\"\",\"shouldRespond\":false}"
    )
    result = post_vision_image(args.vision_url, capture["cropPath"], prompt)
    answer = normalize_text(result.get("answer", ""))
    parsed = parse_vision_json(answer)
    raw_text = normalize_text(parsed.get("rawText") or parsed.get("text") or "")
    command = normalize_text(parsed.get("command") or raw_text)
    should_respond = bool(parsed.get("shouldRespond", bool(command)))
    log(f"Vision result: {answer[:500]}")
    return {
        "text": raw_text or command,
        "command": command,
        "shouldRespond": should_respond,
        "capture": capture,
    }


def post_command(agent_url, contact, raw_text, command):
    body = json.dumps(
        {
            "source": "wechat",
            "from": contact,
            "rawText": raw_text,
            "command": command,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        agent_url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Agent HTTP {exc.code}: {detail}") from exc


def load_wechat_api():
    try:
        from pyweixin import Messages

        return "pyweixin", Messages
    except Exception as pyweixin_error:
        try:
            from pywechat import Messages

            return "pywechat", Messages
        except Exception as pywechat_error:
            raise RuntimeError(
                "Cannot import pyweixin/pywechat. Run: pip install -r requirements.txt"
            ) from (pywechat_error or pyweixin_error)


def read_latest_message(Messages, contact, search_pages):
    messages = Messages.pull_messages(
        contact,
        1,
        is_json=False,
        search_pages=search_pages,
        close_weixin=False,
    )
    if not messages:
        return None
    return messages[-1]


def sanitize_reply_text(reply):
    text = normalize_text(reply)
    text = re.sub(r"^\s*@?\s*\u6600[\uff0c,\u3002.\s]+", "", text)
    return normalize_text(text)


def send_reply_by_clipboard_fallback(contact, reply):
    contact = normalize_contact_name(contact)
    try:
        import pyautogui
        import pyperclip
        import win32con
        import win32gui
        import win32process
        import psutil
    except Exception as exc:
        raise RuntimeError("pyautogui, pyperclip, pywin32 and psutil are required for clipboard fallback") from exc

    pyautogui.FAILSAFE = False

    def find_weixin_window():
        candidates = []

        def callback(hwnd, _):
            try:
                _, pid = win32process.GetWindowThreadProcessId(hwnd)
                process = psutil.Process(pid)
                process_name = process.name().lower()
                if process_name not in ("weixin.exe", "wechat.exe", "wechatappex.exe"):
                    return True
                title = win32gui.GetWindowText(hwnd)
                class_name = win32gui.GetClassName(hwnd)
                left, top, right, bottom = win32gui.GetWindowRect(hwnd)
                width = max(0, right - left)
                height = max(0, bottom - top)
                area = width * height
                if area <= 1000:
                    return True
                score = area
                if win32gui.IsWindowVisible(hwnd):
                    score += 10_000_000
                if title in ("微信", "WeChat", "Weixin"):
                    score += 5_000_000
                if "TrayIcon" in class_name or "MessageWindow" in class_name:
                    score -= 20_000_000
                candidates.append((score, area, hwnd, title, class_name, (left, top, right, bottom)))
            except Exception:
                pass
            return True

        win32gui.EnumWindows(callback, None)
        if not candidates:
            subprocess.Popen([r"C:\Program Files\Tencent\Weixin\Weixin.exe"])
            time.sleep(2)
            win32gui.EnumWindows(callback, None)
        if not candidates:
            raise RuntimeError("Weixin window not found")
        selected = sorted(candidates, reverse=True)[0]
        log(f"Clipboard fallback selected window: title={selected[3] or '<empty>'} class={selected[4]} rect={selected[5]}")
        return selected[2]

    hwnd = find_weixin_window()
    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    win32gui.MoveWindow(hwnd, 80, 70, 1280, 860, True)
    win32gui.SetWindowPos(hwnd, win32con.HWND_TOPMOST, 80, 70, 1280, 860, win32con.SWP_SHOWWINDOW)
    time.sleep(0.3)
    try:
        win32gui.SetForegroundWindow(hwnd)
    except Exception:
        pass
    pyautogui.click(140, 110)
    time.sleep(0.4)

    pyautogui.hotkey("ctrl", "f")
    time.sleep(0.2)
    pyperclip.copy(str(contact))
    if pyperclip.paste() != str(contact):
        raise RuntimeError("clipboard contact verification failed")
    pyautogui.hotkey("ctrl", "v")
    time.sleep(0.6)
    pyautogui.press("enter")
    time.sleep(0.9)

    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    input_x = left + int((right - left) * 0.60)
    input_y = bottom - 92
    send_x = right - 78
    send_y = bottom - 45
    pyautogui.click(input_x, input_y)
    time.sleep(0.2)
    pyperclip.copy(str(reply))
    if pyperclip.paste() != str(reply):
        raise RuntimeError("clipboard reply verification failed")
    pyautogui.hotkey("ctrl", "v")
    time.sleep(0.4)
    pyautogui.press("enter")
    time.sleep(0.3)
    pyautogui.click(send_x, send_y)
    time.sleep(0.5)
    win32gui.SetWindowPos(hwnd, win32con.HWND_NOTOPMOST, 80, 70, 1280, 860, win32con.SWP_SHOWWINDOW)


def send_reply(Messages, contact, reply, search_pages):
    contact = normalize_contact_name(contact)
    text = normalize_text(reply)
    if not text:
        return
    try:
        Messages.send_messages_to_friend(
            contact,
            [text],
            search_pages=search_pages,
            close_weixin=False,
        )
        log(f"Sent WeChat reply by pyweixin: {text}")
    except Exception as exc:
        log(f"pyweixin send failed, using clipboard fallback: {exc}")
        send_reply_by_clipboard_fallback(contact, text)
        log("Sent WeChat reply by clipboard fallback")


def run(args):
    original_contact = args.contact
    args.contact = normalize_contact_name(args.contact)
    if args.contact != original_contact:
        log(f"Contact argument looked garbled; using configured contact: {args.contact}")
    api_name, Messages = load_wechat_api()
    read_peak = create_wechat_audio_meter()
    log(f"WeChat listener started: sound-trigger + {api_name}")
    log(f"Listening chat: {args.contact}")
    log(f"Agent endpoint: {args.agent_url}")
    log(f"Vision endpoint: {args.vision_url}")
    log(f"Waiting for WeChat sound peak >= {args.sound_threshold}")

    seen = set()
    recent_commands = {}
    sent_replies = {}
    last_trigger_at = 0.0

    while True:
        try:
            wait_for_wechat_sound(read_peak, args)
            now = time.time()
            if now - last_trigger_at < args.trigger_cooldown:
                log("Skipped sound trigger during cooldown")
                continue
            last_trigger_at = now

            latest = None
            text = ""
            vision_result = None
            if args.use_vision:
                log("Sound triggered, opening WeChat for vision read")
                try:
                    vision_result = read_wechat_message_with_vision(args)
                    text = vision_result["text"]
                    command = vision_result["command"]
                    if not vision_result["shouldRespond"]:
                        log("Vision found no message to respond to")
                        continue
                    message_key = hashlib.sha256(text.encode("utf-8")).hexdigest()
                except Exception as exc:
                    if not args.allow_ocr_fallback:
                        log(f"Vision read failed; OCR fallback is disabled: {exc}")
                        continue
                    log(f"Vision read failed, using one-shot OCR fallback: {exc}")
                    text = ocr_current_wechat_window(
                        args.contact,
                        debug_ocr=args.debug_ocr,
                        crop_left_offset=args.crop_left_offset,
                        crop_top_offset=args.crop_top_offset,
                        crop_width_ratio=args.crop_width_ratio,
                        crop_bottom_offset=args.crop_bottom_offset,
                    )
                    command, raw_text = extract_wake_command(text)
                    message_key = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()
                    text = raw_text
            elif args.force_ocr_on_sound:
                log("Sound triggered, opening WeChat for one-shot OCR")
                text = ocr_current_wechat_window(
                    args.contact,
                    debug_ocr=args.debug_ocr,
                    crop_left_offset=args.crop_left_offset,
                    crop_top_offset=args.crop_top_offset,
                    crop_width_ratio=args.crop_width_ratio,
                    crop_bottom_offset=args.crop_bottom_offset,
                )
                command, raw_text = extract_wake_command(text)
                message_key = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()
                text = raw_text
            else:
                try:
                    latest = read_latest_message(Messages, args.contact, args.search_pages)
                    text = extract_message_text(latest)
                    command, _ = extract_wake_command(text)
                    message_key = fingerprint_message(latest, text)
                except Exception as exc:
                    if not args.allow_ocr_fallback:
                        log(f"pyweixin read failed; OCR fallback is disabled: {exc}")
                        continue
                    log(f"pyweixin read failed, using one-shot OCR: {exc}")
                    text = ocr_current_wechat_window(
                        args.contact,
                        debug_ocr=args.debug_ocr,
                        crop_left_offset=args.crop_left_offset,
                        crop_top_offset=args.crop_top_offset,
                        crop_width_ratio=args.crop_width_ratio,
                        crop_bottom_offset=args.crop_bottom_offset,
                    )
                    command, raw_text = extract_wake_command(text)
                    message_key = hashlib.sha256(raw_text.encode("utf-8")).hexdigest()
                    text = raw_text

            if not text:
                log("Triggered, but no readable WeChat text")
                continue
            if message_key in seen:
                log("Triggered, but latest message was already processed")
                continue
            seen.add(message_key)
            if len(seen) > 500:
                seen = set(list(seen)[-250:])

            log(f"Received WeChat message: {text}")
            if not command:
                log(f"No {YUN} wake word found")
                continue
            if latest is None and is_ocr_noise(command):
                log(f"Skipped OCR noise: {command}")
                continue
            command_key = hashlib.sha256(command.encode("utf-8")).hexdigest()
            recent_commands = {
                key: value
                for key, value in recent_commands.items()
                if now - value <= args.dedupe_seconds
            }
            if command_key in recent_commands:
                log(f"Skipped duplicate command: {command}")
                continue
            recent_commands[command_key] = now

            log(f"Forwarding to Agent: {command}")
            result = post_command(args.agent_url, args.contact, text, command)
            log(f"Agent result: {json.dumps(result, ensure_ascii=False)[:800]}")
            reply = sanitize_reply_text(result.get("reply", ""))
            if args.reply and reply:
                reply_key = hashlib.sha256(reply.encode("utf-8")).hexdigest()
                sent_replies = {
                    key: value
                    for key, value in sent_replies.items()
                    if now - value <= args.dedupe_seconds
                }
                if reply_key in sent_replies:
                    log(f"Skipped duplicate WeChat reply: {reply}")
                    continue
                send_reply(Messages, args.contact, reply, args.search_pages)
                sent_replies[reply_key] = time.time()
                recent_commands[reply_key] = time.time()
                seen.add(reply_key)
        except KeyboardInterrupt:
            log("WeChat listener stopped")
            return 0
        except Exception as exc:
            log(f"Listen loop error: {exc}")
            time.sleep(max(args.poll, 2.0))


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Yun Companion pywechat/pyweixin bridge.")
    parser.add_argument("--contact", default=DEFAULT_CONTACT, help="Only listen to this chat/contact")
    parser.add_argument("--agent-url", default=DEFAULT_AGENT_URL, help="yun-desktop-agent HTTP command endpoint")
    parser.add_argument("--vision-url", default=DEFAULT_VISION_URL, help="Backend vision-chat endpoint")
    parser.add_argument("--poll", type=float, default=1.0, help="Retry interval after errors")
    parser.add_argument("--search-pages", type=int, default=5, help="Max pages pyweixin searches for the contact")
    parser.add_argument("--dedupe-seconds", type=float, default=300.0, help="Duplicate command cooldown")
    parser.add_argument("--audio-poll", type=float, default=0.12, help="Audio meter polling interval")
    parser.add_argument("--sound-threshold", type=float, default=0.04, help="WeChat audio peak threshold")
    parser.add_argument("--after-sound-delay", type=float, default=0.9, help="Delay after sound before reading WeChat")
    parser.add_argument("--trigger-cooldown", type=float, default=4.0, help="Minimum seconds between sound triggers")
    parser.add_argument("--debug-ocr", action="store_true", help="Save full, crop and overlay OCR screenshots")
    parser.add_argument("--crop-left-offset", type=int, default=0, help="Extra pixels added to OCR crop left")
    parser.add_argument("--crop-top-offset", type=int, default=0, help="Extra pixels added to OCR crop top")
    parser.add_argument("--crop-width-ratio", type=float, default=0.62, help="OCR crop width ratio inside chat area")
    parser.add_argument("--crop-bottom-offset", type=int, default=0, help="Extra pixels removed from OCR crop bottom")
    parser.add_argument("--no-ocr-fallback", dest="allow_ocr_fallback", action="store_false", help="Disable one-shot OCR when pyweixin cannot read WeChat")
    parser.add_argument("--no-vision", dest="use_vision", action="store_false", help="Disable Qwen vision reading and use legacy OCR/pyweixin flow")
    parser.add_argument("--no-force-ocr-on-sound", dest="force_ocr_on_sound", action="store_false", help="Try pyweixin first instead of opening WeChat on every sound trigger")
    parser.add_argument("--no-reply", dest="reply", action="store_false", help="Do not send Yun's reply back to WeChat")
    parser.set_defaults(reply=True, allow_ocr_fallback=True, force_ocr_on_sound=True, use_vision=True)
    return parser.parse_args(argv)


if __name__ == "__main__":
    sys.exit(run(parse_args(sys.argv[1:])))
