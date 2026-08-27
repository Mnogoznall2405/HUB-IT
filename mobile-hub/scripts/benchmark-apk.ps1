#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$DualApkPath = '',
  [string]$Arm64ApkPath = '',
  [string]$Serial = '',
  [ValidateRange(5, 100)]
  [int]$Runs = 20,
  [switch]$Device
)

$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path $PSScriptRoot -Parent
$repoRoot = Split-Path $mobileRoot -Parent
$packageName = 'ru.zsgp.hubit.mobile'
$dualApk = if ($DualApkPath) { [IO.Path]::GetFullPath($DualApkPath) } else { Join-Path $mobileRoot 'dist\hubit-mobile-preview.apk' }
$arm64Apk = if ($Arm64ApkPath) { [IO.Path]::GetFullPath($Arm64ApkPath) } else { Join-Path $mobileRoot 'dist\hubit-mobile-preview-arm64.apk' }

function Get-Percentile {
  param([double[]]$Values, [double]$Percentile)
  if (-not $Values -or $Values.Count -eq 0) { return $null }
  $sorted = @($Values | Sort-Object)
  $index = [Math]::Ceiling(($Percentile / 100.0) * $sorted.Count) - 1
  return [Math]::Round([double]$sorted[[Math]::Max(0, $index)], 2)
}

function Get-ApkFact {
  param([string]$Path, [string]$Kind)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $item = Get-Item -LiteralPath $Path
  return [ordered]@{
    kind = $Kind
    path = $item.FullName
    size_bytes = $item.Length
    size_mib = [Math]::Round($item.Length / 1MB, 2)
    sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$dual = Get-ApkFact -Path $dualApk -Kind 'dual-abi'
$arm64 = Get-ApkFact -Path $arm64Apk -Kind 'arm64-only'
if (-not $dual -and -not $arm64) {
  throw 'No benchmark APK was found. Build dual-ABI or arm64 artifact first.'
}

$comparison = $null
if ($dual -and $arm64) {
  $savedBytes = [long]$dual.size_bytes - [long]$arm64.size_bytes
  $comparison = [ordered]@{
    arm64_saved_bytes = $savedBytes
    arm64_saved_mib = [Math]::Round($savedBytes / 1MB, 2)
    arm64_reduction_percent = if ($dual.size_bytes -gt 0) {
      [Math]::Round(($savedBytes / [double]$dual.size_bytes) * 100, 2)
    } else { 0 }
  }
}

$deviceResult = $null
if ($Device) {
  $adbCandidates = @()
  if ($env:HUBIT_ANDROID_SDK_ROOT) { $adbCandidates += Join-Path $env:HUBIT_ANDROID_SDK_ROOT 'platform-tools\adb.exe' }
  if ($env:ANDROID_HOME) { $adbCandidates += Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe' }
  if ($env:LOCALAPPDATA) { $adbCandidates += Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe' }
  $adbCommand = Get-Command adb -ErrorAction SilentlyContinue
  if ($adbCommand -and $adbCommand.Path) { $adbCandidates += $adbCommand.Path }
  $adbPath = $adbCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if (-not $adbPath) { throw 'adb.exe was not found.' }

  & $adbPath start-server | Out-Null
  $connected = @(
    & $adbPath devices -l |
      ForEach-Object { if ([string]$_ -match '^(?<serial>\S+)\s+device(?:\s|$)') { $Matches.serial } }
  )
  if ($Serial) {
    if ($connected -notcontains $Serial) { throw 'The requested Android device is not connected or authorized.' }
    $deviceSerial = $Serial
  } elseif ($connected.Count -eq 1) {
    $deviceSerial = $connected[0]
  } elseif ($connected.Count -eq 0) {
    throw 'No connected and authorized Android device was found.'
  } else {
    throw 'Multiple devices are connected. Repeat with -Serial.'
  }

  $prefix = @('-s', $deviceSerial)
  $packageDump = (& $adbPath @prefix shell dumpsys package $packageName | Out-String)
  if ($packageDump -notmatch '(?m)^\s*versionName=') {
    throw "$packageName is not installed. Install the release candidate before benchmarking."
  }

  $launchMs = @()
  $pssKb = @()
  for ($index = 0; $index -lt $Runs; $index += 1) {
    & $adbPath @prefix shell am force-stop $packageName | Out-Null
    $launch = (& $adbPath @prefix shell am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER $packageName | Out-String)
    if ($launch -match '(?m)^TotalTime:\s*(?<value>\d+)\s*$') {
      $launchMs += [double]$Matches.value
    } elseif ($launch -match '(?m)^WaitTime:\s*(?<value>\d+)\s*$') {
      $launchMs += [double]$Matches.value
    } else {
      throw "Android did not return launch timing on run $($index + 1)."
    }
    Start-Sleep -Milliseconds 750
    $memory = (& $adbPath @prefix shell dumpsys meminfo $packageName | Out-String)
    if ($memory -match '(?m)^\s*TOTAL PSS:\s*(?<value>\d+)') {
      $pssKb += [double]$Matches.value
    } elseif ($memory -match '(?m)^\s*TOTAL\s+(?<value>\d+)\s+') {
      $pssKb += [double]$Matches.value
    }
  }

  $deviceResult = [ordered]@{
    model = ((& $adbPath @prefix shell getprop ro.product.model | Out-String).Trim())
    android = ((& $adbPath @prefix shell getprop ro.build.version.release | Out-String).Trim())
    api_level = ((& $adbPath @prefix shell getprop ro.build.version.sdk | Out-String).Trim())
    runs = $Runs
    cold_start_ms = [ordered]@{
      p50 = Get-Percentile -Values $launchMs -Percentile 50
      p95 = Get-Percentile -Values $launchMs -Percentile 95
      samples = $launchMs
    }
    total_pss_kb = [ordered]@{
      p50 = Get-Percentile -Values $pssKb -Percentile 50
      p95 = Get-Percentile -Values $pssKb -Percentile 95
      samples = $pssKb
    }
  }
}

$report = [ordered]@{
  schema_version = 1
  measured_at = (Get-Date).ToUniversalTime().ToString('o')
  package = $packageName
  artifacts = @($dual, $arm64 | Where-Object { $null -ne $_ })
  comparison = $comparison
  device = $deviceResult
  method = [ordered]@{
    size = 'Exact APK file size and SHA-256.'
    cold_start = 'adb am force-stop followed by am start -W; TotalTime, WaitTime fallback.'
    memory = 'adb dumpsys meminfo TOTAL PSS after each cold launch.'
    privacy = 'No device serial, credentials, tokens, cookies, message content, screenshots or logcat are recorded.'
  }
}

$reportDir = Join-Path $repoRoot 'artifacts\mobile'
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
$reportPath = Join-Path $reportDir ("apk-benchmark-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Host "APK benchmark report: $reportPath" -ForegroundColor Green
foreach ($artifact in @($dual, $arm64 | Where-Object { $null -ne $_ })) {
  Write-Host ("{0}: {1} MiB, SHA-256 {2}" -f $artifact.kind, $artifact.size_mib, $artifact.sha256)
}
if ($comparison) {
  Write-Host ("arm64 reduction: {0} MiB ({1}%)" -f $comparison.arm64_saved_mib, $comparison.arm64_reduction_percent)
}
if ($Device) {
  Write-Host ("Cold start p50/p95: {0}/{1} ms; PSS p50/p95: {2}/{3} KiB" -f `
    $deviceResult.cold_start_ms.p50, $deviceResult.cold_start_ms.p95, `
    $deviceResult.total_pss_kb.p50, $deviceResult.total_pss_kb.p95)
} else {
  Write-Host 'Device metrics skipped. Repeat with -Device after connecting a physical Android device.' -ForegroundColor Yellow
}
