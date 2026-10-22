# Download font data only. No OS installation and no downloaded code execution.
# PowerShell 7 uses the Windows network settings that also serve this preview.
$ErrorActionPreference = 'Stop'
$fontRoot = Join-Path $PSScriptRoot '../public/fonts/lyrics'
$fontRoot = [IO.Path]::GetFullPath($fontRoot)
$fontDefinitions = node --input-type=module -e "import { LYRIC_FONTS } from './server/visuals/lyricFontCatalog.js'; console.log(JSON.stringify(LYRIC_FONTS.filter(font => font.name)))" | ConvertFrom-Json
$fontAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
$fontManifest = @()
foreach ($fontDefinition in $fontDefinitions) {
  $fontFolder = Join-Path $fontRoot $fontDefinition.id
  New-Item -ItemType Directory -Force -Path $fontFolder | Out-Null
  $fontCssUrl = 'https://fonts.googleapis.com/css2?family=' + $fontDefinition.name.Replace(' ', '+') + ':wght@' + $fontDefinition.weight + '&display=swap'
  $fontCss = (Invoke-WebRequest -Uri $fontCssUrl -UserAgent $fontAgent -TimeoutSec 30).Content
  $fontLicenseUrl = 'https://raw.githubusercontent.com/google/fonts/main/ofl/' + $fontDefinition.folder + '/OFL.txt'
  try { $fontLicense = (Invoke-WebRequest -Uri $fontLicenseUrl -TimeoutSec 15).Content; $fontLicenseRetrieved = $fontLicenseUrl }
  catch {
    $fontLicenseRetrieved = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/' + $fontDefinition.folder + '/OFL.txt'
    $fontLicense = (Invoke-WebRequest -Uri $fontLicenseRetrieved -TimeoutSec 30).Content
  }
  if ($fontLicense -notmatch 'SIL OPEN FONT LICENSE') { throw "Missing OFL: $($fontDefinition.id)" }
  [IO.File]::WriteAllText((Join-Path $fontFolder 'OFL.txt'), $fontLicense)
  $fontUrls = [regex]::Matches($fontCss, 'url\((https://fonts\.gstatic\.com/[^)]+)\)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
  if (-not $fontUrls) { throw "No subsets: $($fontDefinition.id)" }
  Write-Output ('Downloading ' + $fontDefinition.name + ': ' + $fontUrls.Count + ' WOFF2 subsets')
  $fontJobs = @($fontUrls | ForEach-Object { [pscustomobject]@{ Url = $_; Folder = $fontFolder; Agent = $fontAgent } })
  $fontFiles = @($fontJobs | ForEach-Object -ThrottleLimit 6 -Parallel {
    $ErrorActionPreference = 'Stop'
    $job = $_
    $filename = ([uri]$job.Url).Segments[-1]
    if ($filename -notmatch '^[a-zA-Z0-9_.-]+\.woff2$') { throw "Expected WOFF2: $($job.Url)" }
    $destination = Join-Path $job.Folder $filename
    $cachedValid = $false
    if (Test-Path -LiteralPath $destination) {
      $cachedBytes = [IO.File]::ReadAllBytes($destination)
      $cachedValid = $cachedBytes.Length -ge 4 -and [Text.Encoding]::ASCII.GetString($cachedBytes, 0, 4) -eq 'wOF2'
    }
    if (-not $cachedValid) {
      for ($attempt = 0; $attempt -lt 5; $attempt++) {
        try { Invoke-WebRequest -Uri $job.Url -UserAgent $job.Agent -TimeoutSec 30 -OutFile $destination; break }
        catch { if ($attempt -eq 4) { throw ('Font download failed: ' + $job.Url + ' - ' + $_.Exception.Message) } }
      }
    }
    $fontBytes = [IO.File]::ReadAllBytes($destination)
    if ([Text.Encoding]::ASCII.GetString($fontBytes, 0, 4) -ne 'wOF2') { throw "Invalid WOFF2: $filename" }
    [pscustomobject]@{ filename = $filename; source = $job.Url; bytes = $fontBytes.Length; sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLower() }
  })
  $fontCss = [regex]::Replace($fontCss, 'url\((https://fonts\.gstatic\.com/[^)]+)\)', { param($match) "url('./" + ([uri]$match.Groups[1].Value).Segments[-1] + "')" })
  if ($fontCss -match 'https?://') { throw 'Unexpected remote font reference' }
  [IO.File]::WriteAllText((Join-Path $fontFolder 'font.css'), "/* $($fontDefinition.name); SIL OFL 1.1. See OFL.txt. */`n$fontCss")
  $fontTotal = ($fontFiles | Measure-Object -Property bytes -Sum).Sum
  $fontManifest += [ordered]@{ id = $fontDefinition.id; name = $fontDefinition.name; weight = $fontDefinition.weight; cssSource = $fontCssUrl; licenseUrl = $fontLicenseUrl; licenseRetrievedFrom = $fontLicenseRetrieved; bytes = $fontTotal; files = @($fontFiles | Sort-Object filename) }
  [IO.File]::WriteAllText((Join-Path $fontRoot 'manifest.json'), (@{ generatedAt = [DateTime]::UtcNow.ToString('o'); fonts = $fontManifest } | ConvertTo-Json -Depth 8))
  Write-Output ('Ready ' + $fontDefinition.name + ': ' + [math]::Round($fontTotal / 1024) + ' KiB')
}
[IO.File]::WriteAllText((Join-Path $fontRoot 'manifest.json'), (@{ generatedAt = [DateTime]::UtcNow.ToString('o'); fonts = $fontManifest } | ConvertTo-Json -Depth 8))
[IO.File]::WriteAllText((Join-Path $fontRoot 'README.md'), "# Lyric fonts`n`nLocally hosted, unmodified Google Fonts WOFF2 subsets. Each family includes its SIL OFL 1.1 notice. Font CSS and Unicode subsets load only when selected. No Google Fonts runtime request.`n`nSee manifest.json for sources, sizes and SHA256 checksums. Refresh with PowerShell 7: pwsh -NoProfile -File tools/vendor-lyric-fonts.ps1`n")
Write-Output ('Total: ' + [math]::Round(($fontManifest | ForEach-Object { $_.bytes } | Measure-Object -Sum).Sum / 1MB, 2) + ' MiB')
