import { WebSocketServer } from 'ws'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const host = process.env.YUN_DESKTOP_AGENT_HOST || '127.0.0.1'
const port = Number(process.env.YUN_DESKTOP_AGENT_PORT || 3131)
const httpPort = Number(process.env.YUN_DESKTOP_AGENT_HTTP_PORT || 17890)
const companionChatUrl = process.env.YUN_COMPANION_CHAT_URL || 'http://127.0.0.1:3030/api/companion-chat'
const allowedWeChatContact = process.env.YUN_WECHAT_ALLOWED_CONTACT || '东宇'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const agentRoot = path.resolve(__dirname, '..')
const screenshotsDir = process.env.YUN_SCREENSHOT_DIR || path.join(agentRoot, 'screenshots')
const desktopInputScript = path.join(agentRoot, 'desktop-input', 'desktop_input.py')

const appAliases = new Map([
  ['blender', 'blender'],
  ['chrome', 'chrome'],
  ['edge', 'msedge'],
  ['vscode', 'code'],
  ['code', 'code'],
  ['notepad', 'notepad'],
  ['calculator', 'calc'],
  ['calc', 'calc'],
  ['paint', 'mspaint'],
  ['explorer', 'explorer'],
  ['cmd', 'cmd'],
  ['powershell', 'powershell'],
  ['terminal', 'wt'],
  ['ps', 'photoshop'],
  ['photoshop', 'photoshop'],
  ['adobe photoshop', 'photoshop'],
  ['photo shop', 'photoshop'],
  ['wechat', 'WeChat'],
  ['qq', 'QQ'],
  ['netease', 'cloudmusic'],
  ['netease music', 'cloudmusic'],
  ['网易云音乐', 'cloudmusic'],
])

const tools = [
  {
    name: 'open_app',
    description: '打开Windows应用',
    parameters: {
      type: 'object',
      properties: {
        app: { type: 'string', description: '应用名、别名、可执行文件名或路径' },
      },
      required: ['app'],
    },
  },
  {
    name: 'set_volume',
    description: '调节Windows系统主音量',
    parameters: {
      type: 'object',
      properties: {
        value: { type: 'number', minimum: 0, maximum: 100, description: '音量百分比' },
      },
      required: ['value'],
    },
  },
  {
    name: 'get_system_info',
    description: '获取当前系统音量和正在运行的软件',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'take_screenshot',
    description: 'Capture the current Windows desktop screen and save it as a PNG for vision models',
    parameters: {
      type: 'object',
      properties: {
        includeBase64: { type: 'boolean', description: 'Whether to include PNG base64 in the result' },
      },
    },
  },
  {
    name: 'get_mouse_position',
    description: 'Get current mouse position and screen size',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'mouse_move',
    description: 'Move mouse pointer to screen coordinates',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        duration: { type: 'number' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'mouse_click',
    description: 'Click at screen coordinates',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        clicks: { type: 'number' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'mouse_scroll',
    description: 'Scroll the mouse wheel, positive up and negative down',
    parameters: {
      type: 'object',
      properties: {
        clicks: { type: 'number' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['clicks'],
    },
  },
  {
    name: 'keyboard_type_text',
    description: 'Type text into the active window, using clipboard paste for Unicode text',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        paste: { type: 'boolean' },
      },
      required: ['text'],
    },
  },
  {
    name: 'keyboard_press',
    description: 'Press a keyboard key',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        presses: { type: 'number' },
      },
      required: ['key'],
    },
  },
  {
    name: 'keyboard_hotkey',
    description: 'Press a keyboard shortcut, such as ctrl+l or alt+tab',
    parameters: {
      type: 'object',
      properties: {
        keys: { type: 'array', items: { type: 'string' } },
      },
      required: ['keys'],
    },
  },
  {
    name: 'close_app',
    description: '关闭Windows应用',
    parameters: {
      type: 'object',
      properties: {
        app: { type: 'string', description: '应用名、别名或进程名' },
      },
      required: ['app'],
    },
  },
  {
    name: 'wechat_open_chat',
    description: 'Open the allowed WeChat contact chat',
    parameters: {
      type: 'object',
      properties: {
        contact: { type: 'string', description: 'Allowed WeChat contact name' },
      },
    },
  },
  {
    name: 'wechat_send_message',
    description: 'Send a WeChat message to the allowed contact without confirmation',
    parameters: {
      type: 'object',
      properties: {
        contact: { type: 'string', description: 'Allowed WeChat contact name' },
        text: { type: 'string', description: 'Message text' },
      },
      required: ['text'],
    },
  },
  {
    name: 'wechat_read_latest_text',
    description: 'Read visible text from the allowed WeChat chat using Windows OCR',
    parameters: {
      type: 'object',
      properties: {
        contact: { type: 'string', description: 'Allowed WeChat contact name' },
      },
    },
  },
  {
    name: 'wechat_read_notifications',
    description: 'Read recent Windows notifications from WeChat for the allowed contact',
    parameters: {
      type: 'object',
      properties: {
        contact: { type: 'string', description: 'Allowed WeChat contact name' },
        limit: { type: 'number', description: 'Maximum notifications to inspect' },
      },
    },
  },
]

function runPowerShell(script, { timeout = 15000 } = {}) {
  const utf8Script = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
${script}
`
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', utf8Script],
      {
        windowsHide: true,
        timeout,
        maxBuffer: 1024 * 1024 * 4,
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr?.trim() || stdout?.trim() || error.message
          reject(new Error(message))
          return
        }
        resolve(stdout.trim())
      },
    )
  })
}

function parseJsonOutput(output, fallback = null) {
  if (!output) return fallback
  try {
    return JSON.parse(output)
  } catch {
    return fallback
  }
}

function runPythonJson(scriptPath, payload, { timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'python',
      [scriptPath],
      {
        windowsHide: true,
        timeout,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const parsed = parseJsonOutput(stdout.trim(), null)
        if (error || parsed?.ok === false) {
          const message = parsed?.error || stderr?.trim() || stdout?.trim() || error?.message || 'Python tool failed'
          reject(new Error(message))
          return
        }
        resolve(parsed?.result ?? parsed)
      },
    )
    child.stdin?.write(JSON.stringify(payload))
    child.stdin?.end()
  })
}

function normalizeAppName(app) {
  const value = String(app || '').trim()
  if (!value) {
    throw new Error('Missing required parameter: app')
  }
  if (/[\r\n;]/.test(value)) {
    throw new Error('Invalid app name')
  }
  return appAliases.get(value.toLowerCase()) || value
}

function psString(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function normalizeWeChatContact(contact) {
  const value = String(contact || allowedWeChatContact).trim()
  if (!value) throw new Error('Missing WeChat contact')
  const comparableValue = value.normalize('NFKC')
  const comparableAllowed = allowedWeChatContact.normalize('NFKC')
  if (comparableValue !== comparableAllowed) {
    throw new Error(`WeChat is restricted to the allowed contact: ${allowedWeChatContact}`)
  }
  return allowedWeChatContact
}

function normalizeMessageText(text) {
  const value = String(text || '').trim()
  if (!value) throw new Error('Missing required parameter: text')
  if (value.length > 1000) throw new Error('WeChat message is too long')
  return value
}

function wechatAutomationScript({ contact, text = '' }) {
  const shouldSend = String(text || '').trim().length > 0
  return `
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Window {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

$contact = ${psString(contact)}
$messageText = ${psString(text)}
$shouldSend = ${shouldSend ? '$true' : '$false'}
$previousClipboard = $null
$hadClipboard = $false
try {
  $previousClipboard = Get-Clipboard -Raw -ErrorAction Stop
  $hadClipboard = $true
} catch {}

function Find-WeChatProcess {
  @(Get-Process -Name Weixin -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Sort-Object Id |
    Select-Object -First 1)[0]
}

$wechat = Find-WeChatProcess
if (-not $wechat) {
  Start-Process -FilePath "Weixin"
  Start-Sleep -Seconds 2
  $wechat = Find-WeChatProcess
}
if (-not $wechat) {
  $shortcutRoots = @(
    [Environment]::GetFolderPath("StartMenu"),
    [Environment]::GetFolderPath("CommonStartMenu"),
    "$env:PUBLIC\\Desktop",
    [Environment]::GetFolderPath("Desktop")
  ) | Where-Object { $_ -and (Test-Path $_) }
  $shortcut = Get-ChildItem -Path $shortcutRoots -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.BaseName -match "微信|WeChat|Weixin" } |
    Select-Object -First 1
  if ($shortcut) {
    Start-Process -FilePath $shortcut.FullName
    Start-Sleep -Seconds 2
    $wechat = Find-WeChatProcess
  }
}
if (-not $wechat) { throw "WeChat window was not found" }

[Win32Window]::ShowWindow($wechat.MainWindowHandle, 9) | Out-Null
$rect = New-Object Win32Window+RECT
[Win32Window]::GetWindowRect($wechat.MainWindowHandle, [ref]$rect) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($rect.Left -lt -1000 -or $rect.Top -lt -1000 -or $width -lt 640 -or $height -lt 420) {
  [Win32Window]::MoveWindow($wechat.MainWindowHandle, 120, 80, 980, 720, $true) | Out-Null
  Start-Sleep -Milliseconds 300
}
[Win32Window]::SetForegroundWindow($wechat.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 400

$shell = New-Object -ComObject WScript.Shell
$shell.AppActivate($wechat.Id) | Out-Null
Start-Sleep -Milliseconds 300
$rect = New-Object Win32Window+RECT
[Win32Window]::GetWindowRect($wechat.MainWindowHandle, [ref]$rect) | Out-Null
function Click-At($x, $y) {
  [Win32Window]::SetCursorPos([int]$x, [int]$y) | Out-Null
  Start-Sleep -Milliseconds 60
  [Win32Window]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [Win32Window]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}

Click-At ($rect.Left + 152) ($rect.Top + 42)
Start-Sleep -Milliseconds 260
$shell.SendKeys("^a")
Start-Sleep -Milliseconds 80
Set-Clipboard -Value $contact
$shell.SendKeys("^v")
Start-Sleep -Milliseconds 620
Click-At ($rect.Left + 150) ($rect.Top + 118)
Start-Sleep -Milliseconds 820

if ($shouldSend) {
  Set-Clipboard -Value $messageText
  $shell.SendKeys("^v")
  Start-Sleep -Milliseconds 260
  $shell.SendKeys("{ENTER}")
}

Start-Sleep -Milliseconds 250
if ($hadClipboard) {
  Set-Clipboard -Value $previousClipboard
}

[pscustomobject]@{
  contact = $contact
  opened = $true
  sent = $shouldSend
} | ConvertTo-Json -Compress
`
}

async function openWeChatChat({ contact } = {}) {
  const safeContact = normalizeWeChatContact(contact)
  const output = await runPowerShell(wechatAutomationScript({ contact: safeContact }), { timeout: 20000 })
  return parseJsonOutput(output, { contact: safeContact, opened: true, sent: false })
}

async function sendWeChatMessage({ contact, text } = {}) {
  const safeContact = normalizeWeChatContact(contact)
  const safeText = normalizeMessageText(text)
  const output = await runPowerShell(wechatAutomationScript({ contact: safeContact, text: safeText }), { timeout: 22000 })
  return parseJsonOutput(output, { contact: safeContact, opened: true, sent: true })
}

async function readWeChatLatestText({ contact } = {}) {
  const safeContact = normalizeWeChatContact(contact)
  const script = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32OcrWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

function Await-WinRt($operation, $resultType) {
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq "AsTask" -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
  } | Select-Object -First 1).MakeGenericMethod($resultType)
  $task = $asTask.Invoke($null, @($operation))
  $task.Wait()
  $task.Result
}

$contact = ${psString(safeContact)}
$processes = @(Get-Process -Name Weixin -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
if (-not $processes.Count) {
  Start-Process -FilePath "Weixin"
  Start-Sleep -Seconds 2
  $processes = @(Get-Process -Name Weixin -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
}
if (-not $processes.Count) { throw "WeChat window was not found" }

$windows = foreach ($process in $processes) {
  $rect = New-Object Win32OcrWindow+RECT
  [Win32OcrWindow]::GetWindowRect($process.MainWindowHandle, [ref]$rect) | Out-Null
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  [pscustomobject]@{ Process = $process; Rect = $rect; Area = $width * $height; Width = $width; Height = $height }
}
$window = $windows | Sort-Object Area -Descending | Select-Object -First 1
$handle = $window.Process.MainWindowHandle
[Win32OcrWindow]::ShowWindow($handle, 9) | Out-Null
if ($window.Rect.Left -lt -1000 -or $window.Rect.Top -lt -1000 -or $window.Width -lt 640 -or $window.Height -lt 420) {
  [Win32OcrWindow]::MoveWindow($handle, 120, 80, 980, 720, $true) | Out-Null
  Start-Sleep -Milliseconds 300
}
[Win32OcrWindow]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Milliseconds 500

$shell = New-Object -ComObject WScript.Shell
$shell.AppActivate($window.Process.Id) | Out-Null
Start-Sleep -Milliseconds 300
$rect = New-Object Win32OcrWindow+RECT
[Win32OcrWindow]::GetWindowRect($handle, [ref]$rect) | Out-Null
function Click-At($x, $y) {
  [Win32OcrWindow]::SetCursorPos([int]$x, [int]$y) | Out-Null
  Start-Sleep -Milliseconds 60
  [Win32OcrWindow]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [Win32OcrWindow]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}
Click-At ($rect.Left + 152) ($rect.Top + 42)
Start-Sleep -Milliseconds 220
$shell.SendKeys("^a")
Start-Sleep -Milliseconds 80
Set-Clipboard -Value $contact
$shell.SendKeys("^v")
Start-Sleep -Milliseconds 620
Click-At ($rect.Left + 150) ($rect.Top + 118)
Start-Sleep -Milliseconds 820

$rect = New-Object Win32OcrWindow+RECT
[Win32OcrWindow]::GetWindowRect($handle, [ref]$rect) | Out-Null
$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($width, $height))
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
if (-not $engine) { throw "Windows OCR engine unavailable" }
$ocr = Await-WinRt ($engine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])
$text = ($ocr.Text -replace "\\r\\n", "\\n").Trim()

[pscustomobject]@{
  contact = $contact
  text = $text
  hasText = -not [string]::IsNullOrWhiteSpace($text)
  method = "windows-ocr"
} | ConvertTo-Json -Compress
`
  const output = await runPowerShell(script, { timeout: 30000 })
  return parseJsonOutput(output, { contact: safeContact, text: '', hasText: false, method: 'windows-ocr' })
}

async function readWeChatNotifications({ contact, limit = 40 } = {}) {
  const safeContact = normalizeWeChatContact(contact)
  const safeLimit = Math.max(1, Math.min(80, Math.round(Number(limit) || 40)))
  const script = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType=WindowsRuntime]
$null = [Windows.UI.Notifications.NotificationKinds, Windows.UI.Notifications, ContentType=WindowsRuntime]
$null = [Windows.UI.Notifications.KnownNotificationBindings, Windows.UI.Notifications, ContentType=WindowsRuntime]

function Await-WinRt($operation, $resultType) {
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq "AsTask" -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
  } | Select-Object -First 1).MakeGenericMethod($resultType)
  $task = $asTask.Invoke($null, @($operation))
  $task.Wait()
  $task.Result
}

$contact = ${psString(safeContact)}
$listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
$access = Await-WinRt ($listener.RequestAccessAsync()) ([Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus])
$items = @()
if ($access.ToString() -eq "Allowed") {
  $notifications = Await-WinRt ($listener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)) ([System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]])
  foreach ($notification in $notifications) {
    $binding = $notification.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric)
    $texts = @()
    if ($binding) {
      foreach ($text in $binding.GetTextElements()) {
        if (-not [string]::IsNullOrWhiteSpace($text.Text)) { $texts += $text.Text }
      }
    }
    $app = $notification.AppInfo.DisplayInfo.DisplayName
    $joined = ($texts -join "\\n")
    if ($app -match "微信|WeChat|Weixin") {
      $items += [pscustomobject]@{
        id = $notification.Id
        app = $app
        created = $notification.CreationTime.ToString("o")
        texts = $texts
        text = $joined
        matchesContact = $joined -match [regex]::Escape($contact)
      }
    }
  }
}
$sorted = @($items | Sort-Object created -Descending | Select-Object -First ${safeLimit})
[pscustomobject]@{
  contact = $contact
  access = $access.ToString()
  count = $sorted.Count
  notifications = $sorted
} | ConvertTo-Json -Depth 8 -Compress
`
  const output = await runPowerShell(script, { timeout: 25000 })
  return parseJsonOutput(output, {
    contact: safeContact,
    access: 'Unknown',
    count: 0,
    notifications: [],
  })
}

async function openApp({ app }) {
  const appName = normalizeAppName(app)
  const script = `
$ErrorActionPreference = "Stop"
$name = ${psString(appName)}
$startedBy = "file"

try {
  Start-Process -FilePath $name
} catch {
  $shortcutRoots = @(
    [Environment]::GetFolderPath("StartMenu"),
    [Environment]::GetFolderPath("CommonStartMenu"),
    "$env:PUBLIC\\Desktop",
    [Environment]::GetFolderPath("Desktop")
  ) | Where-Object { $_ -and (Test-Path $_) }

  $query = $name.ToLowerInvariant()
  $tokens = @($query -split "\\s+" | Where-Object { $_ })
  $shortcuts = foreach ($root in $shortcutRoots) {
    Get-ChildItem -Path $root -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue
  }

  $match = $shortcuts |
    Sort-Object @{ Expression = {
      $base = $_.BaseName.ToLowerInvariant()
      if ($base -eq $query) { 0 }
      elseif ($tokens.Count -gt 0 -and (@($tokens | Where-Object { $base.Contains($_) }).Count -eq $tokens.Count)) { 1 }
      elseif ($base.Contains($query)) { 2 }
      else { 9 }
    }}, @{ Expression = { $_.BaseName.Length } } |
    Where-Object {
      $base = $_.BaseName.ToLowerInvariant()
      $base -eq $query -or $base.Contains($query) -or ($tokens.Count -gt 0 -and (@($tokens | Where-Object { $base.Contains($_) }).Count -eq $tokens.Count))
    } |
    Select-Object -First 1

  if (-not $match) { throw }
  Start-Process -FilePath $match.FullName
  $startedBy = "shortcut"
}

[pscustomobject]@{
  app = $name
  started = $true
  method = $startedBy
} | ConvertTo-Json -Compress
`
  const output = await runPowerShell(script)
  return parseJsonOutput(output, { app: appName, started: true })
}

async function closeApp({ app }) {
  const appName = normalizeAppName(app)
  const processName = appName.replace(/\.exe$/i, '')
  const script = `
$ErrorActionPreference = "Stop"
$name = ${psString(processName)}
$processes = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
foreach ($process in $processes) {
  if ($process.MainWindowHandle -ne 0) {
    $null = $process.CloseMainWindow()
  }
}
Start-Sleep -Milliseconds 700
$remaining = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
foreach ($process in $remaining) {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
}
[pscustomobject]@{
  app = $name
  closedCount = $processes.Count
} | ConvertTo-Json -Compress
`
  const output = await runPowerShell(script)
  return parseJsonOutput(output, { app: processName, closedCount: 0 })
}

const coreAudioScript = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"), ComImport]
public class MMDeviceEnumerator {}

public enum EDataFlow { eRender, eCapture, eAll }
public enum ERole { eConsole, eMultimedia, eCommunications }

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int NotImpl1();
  [PreserveSig]
  int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppDevice);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  [PreserveSig]
  int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, out IAudioEndpointVolume ppInterface);
}

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr pNotify);
  int UnregisterControlChangeNotify(IntPtr pNotify);
  int GetChannelCount(out int pnChannelCount);
  int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int GetMasterVolumeLevel(out float pfLevelDB);
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
  int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
  int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
  int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
  int SetMute(bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}

public static class AudioEndpoint {
  public static IAudioEndpointVolume GetVolumeObject() {
    IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
    IMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device));
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume volume;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out volume));
    return volume;
  }

  public static float GetMasterVolume() {
    IAudioEndpointVolume volume = GetVolumeObject();
    float level;
    Marshal.ThrowExceptionForHR(volume.GetMasterVolumeLevelScalar(out level));
    return level;
  }

  public static bool GetMute() {
    IAudioEndpointVolume volume = GetVolumeObject();
    bool muted;
    Marshal.ThrowExceptionForHR(volume.GetMute(out muted));
    return muted;
  }

  public static void SetMasterVolume(float level) {
    IAudioEndpointVolume volume = GetVolumeObject();
    Guid eventId = Guid.Empty;
    Marshal.ThrowExceptionForHR(volume.SetMasterVolumeLevelScalar(level, eventId));
    Marshal.ThrowExceptionForHR(volume.SetMute(false, eventId));
  }
}
"@
`

async function getVolume() {
  const script = `
$ErrorActionPreference = "Stop"
${coreAudioScript}
$level = [AudioEndpoint]::GetMasterVolume()
$muted = [AudioEndpoint]::GetMute()
[pscustomobject]@{
  value = [math]::Round($level * 100)
  muted = $muted
} | ConvertTo-Json -Compress
`
  return parseJsonOutput(await runPowerShell(script), { value: null, muted: null })
}

async function setVolume({ value }) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    throw new Error('Missing required numeric parameter: value')
  }
  const clamped = Math.max(0, Math.min(100, Math.round(numericValue)))
  const scalar = clamped / 100
  const script = `
$ErrorActionPreference = "Stop"
${coreAudioScript}
[AudioEndpoint]::SetMasterVolume(${scalar})
[pscustomobject]@{
  value = ${clamped}
  muted = $false
} | ConvertTo-Json -Compress
`
  return parseJsonOutput(await runPowerShell(script), { value: clamped, muted: false })
}

async function getRunningApps() {
  const script = `
$ErrorActionPreference = "Stop"
Get-Process |
  Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 } |
  Sort-Object ProcessName, Id |
  Select-Object -First 80 @{Name="name";Expression={$_.ProcessName}}, Id, MainWindowTitle, Path |
  ConvertTo-Json -Depth 3 -Compress
`
  const output = await runPowerShell(script)
  const apps = parseJsonOutput(output, [])
  return Array.isArray(apps) ? apps : apps ? [apps] : []
}

async function getSystemInfo() {
  const [volume, runningApps] = await Promise.all([
    getVolume(),
    getRunningApps(),
  ])
  return {
    volume,
    runningApps,
  }
}

async function takeScreenshot({ includeBase64 = false } = {}) {
  await fs.mkdir(screenshotsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(screenshotsDir, `screenshot-${stamp}.png`)
  const script = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$path = ${psString(filePath)}
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, [System.Drawing.Size]::new($bounds.Width, $bounds.Height))
$bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
[pscustomobject]@{
  path = $path
  left = $bounds.Left
  top = $bounds.Top
  width = $bounds.Width
  height = $bounds.Height
  capturedAt = (Get-Date).ToString("o")
} | ConvertTo-Json -Compress
`
  const output = await runPowerShell(script, { timeout: 20000 })
  const result = parseJsonOutput(output, {
    path: filePath,
    left: 0,
    top: 0,
    width: null,
    height: null,
    capturedAt: new Date().toISOString(),
  })
  const stat = await fs.stat(filePath)
  const payload = {
    ...result,
    path: filePath,
    mimeType: 'image/png',
    sizeBytes: stat.size,
    includeBase64: Boolean(includeBase64),
  }
  if (includeBase64) {
    payload.base64 = await fs.readFile(filePath, 'base64')
  }
  return payload
}

async function runDesktopInput(action, parameters = {}) {
  return runPythonJson(desktopInputScript, { action, parameters }, { timeout: 12000 })
}

const handlers = {
  list_tools: async () => ({ tools }),
  tools: async () => ({ tools }),
  open_app: openApp,
  set_volume: setVolume,
  get_system_info: getSystemInfo,
  take_screenshot: takeScreenshot,
  get_mouse_position: (parameters) => runDesktopInput('get_mouse_position', parameters),
  mouse_move: (parameters) => runDesktopInput('mouse_move', parameters),
  mouse_click: (parameters) => runDesktopInput('mouse_click', parameters),
  mouse_scroll: (parameters) => runDesktopInput('mouse_scroll', parameters),
  keyboard_type_text: (parameters) => runDesktopInput('keyboard_type_text', parameters),
  keyboard_press: (parameters) => runDesktopInput('keyboard_press', parameters),
  keyboard_hotkey: (parameters) => runDesktopInput('keyboard_hotkey', parameters),
  close_app: closeApp,
  wechat_open_chat: openWeChatChat,
  wechat_send_message: sendWeChatMessage,
  wechat_read_latest_text: readWeChatLatestText,
  wechat_read_notifications: readWeChatNotifications,
}

function normalizeRequest(raw) {
  const message = typeof raw === 'string' ? JSON.parse(raw) : raw
  const action = message.action || message.name
  const parameters = {
    ...(message.parameters && typeof message.parameters === 'object' ? message.parameters : {}),
  }

  if (message.app !== undefined && parameters.app === undefined) parameters.app = message.app
  if (message.value !== undefined && parameters.value === undefined) parameters.value = message.value
  if (message.contact !== undefined && parameters.contact === undefined) parameters.contact = message.contact
  if (message.text !== undefined && parameters.text === undefined) parameters.text = message.text
  if (message.limit !== undefined && parameters.limit === undefined) parameters.limit = message.limit
  if (message.includeBase64 !== undefined && parameters.includeBase64 === undefined) parameters.includeBase64 = message.includeBase64

  return {
    id: message.id || randomUUID(),
    action,
    parameters,
  }
}

async function handleMessage(raw) {
  const request = normalizeRequest(raw)
  const handler = handlers[request.action]

  if (!handler) {
    throw Object.assign(new Error(`Unknown desktop action: ${request.action || 'undefined'}`), {
      requestId: request.id,
    })
  }

  const result = await handler(request.parameters)
  return {
    id: request.id,
    ok: true,
    action: request.action,
    result,
  }
}

function sendHttpJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  })
  res.end(body)
}

function readHttpJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 1024 * 1024) {
        reject(new Error('Request body is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8').trim()
        resolve(text ? JSON.parse(text) : {})
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

async function runCompanionCommand({ source = 'wechat', from, rawText, command }) {
  const contact = normalizeWeChatContact(from)
  const cleanCommand = String(command || '').trim()
  const originalText = String(rawText || cleanCommand).trim()
  if (!cleanCommand) throw new Error('Missing command')

  console.log(`[yun-desktop-agent] received ${source} command from ${contact}: ${cleanCommand}`)
  const response = await fetch(companionChatUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      userText: cleanCommand,
      chatHistory: [],
      currentSong: null,
      responseMode: 'companion',
      persona: 'warm',
      companionMemory: {},
      userMemory: null,
      memoryEnabled: true,
      recentAiReplies: [],
      questionCountWindow: 0,
      localTime: new Date().toLocaleString('zh-CN'),
      playHistory: [],
      rejectedTracks: [],
      recentRecommendations: [],
      source,
      sourceContact: contact,
      rawText: originalText,
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.error) {
    throw new Error(data.error || `Companion chat failed with HTTP ${response.status}`)
  }
  const reply = String(data.reply || '嗯，我处理好了。').trim()
  console.log(`[yun-desktop-agent] companion reply for ${contact}: ${reply}`)
  return {
    ok: true,
    source,
    from: contact,
    rawText: originalText,
    command: cleanCommand,
    reply,
    companion: data,
  }
}

const httpServer = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      sendHttpJson(res, 204, {})
      return
    }

    if (req.method === 'POST' && req.url === '/api/wechat-command') {
      const body = await readHttpJson(req)
      const result = await runCompanionCommand(body)
      sendHttpJson(res, 200, result)
      return
    }

    sendHttpJson(res, 404, {
      ok: false,
      error: 'Not found',
      endpoints: ['POST /api/wechat-command'],
    })
  } catch (error) {
    console.error('[yun-desktop-agent] http command failed:', error instanceof Error ? error.message : error)
    sendHttpJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

const wss = new WebSocketServer({ host, port })

wss.on('connection', (socket, request) => {
  console.log(`[yun-desktop-agent] client connected from ${request.socket.remoteAddress}`)
  socket.send(JSON.stringify({
    ok: true,
    event: 'ready',
    agent: 'yun-desktop-agent',
    tools,
  }))

  socket.on('message', async (data) => {
    let id = null
    try {
      const text = data.toString('utf8')
      id = parseJsonOutput(text, {})?.id || null
      const response = await handleMessage(text)
      socket.send(JSON.stringify(response))
    } catch (error) {
      socket.send(JSON.stringify({
        id: error.requestId || id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  })
})

wss.on('listening', () => {
  console.log(`[yun-desktop-agent] listening on ws://${host}:${port}`)
})

httpServer.listen(httpPort, host, () => {
  console.log(`[yun-desktop-agent] listening on http://${host}:${httpPort}`)
  console.log(`[yun-desktop-agent] wechat command endpoint: http://${host}:${httpPort}/api/wechat-command`)
})

httpServer.on('error', (error) => {
  console.error('[yun-desktop-agent] http server error:', error)
  process.exitCode = 1
})

wss.on('error', (error) => {
  console.error('[yun-desktop-agent] server error:', error)
  process.exitCode = 1
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[yun-desktop-agent] ${signal} received, shutting down`)
    httpServer.close(() => {
      wss.close(() => process.exit(0))
    })
  })
}
