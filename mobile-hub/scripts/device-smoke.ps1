#Requires -Version 5.1
[CmdletBinding()]
param(
  [ValidateSet('Verify', 'Upgrade', 'Clean')]
  [string]$InstallMode = 'Verify',
  [string]$ApkPath = '',
  [string]$Serial = '',
  [switch]$AllowDataReset,
  [switch]$Interactive
)

$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path $PSScriptRoot -Parent
$repoRoot = Split-Path $mobileRoot -Parent
$packageName = 'ru.zsgp.hubit.mobile'
$expectedVersion = [string](Get-Content -LiteralPath (Join-Path $mobileRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$resolvedApk = if ($ApkPath) {
  [IO.Path]::GetFullPath($ApkPath)
} else {
  Join-Path $mobileRoot 'dist\hubit-mobile-preview.apk'
}

function Resolve-AdbPath {
  $candidates = @()
  if ($env:HUBIT_ANDROID_SDK_ROOT) {
    $candidates += Join-Path $env:HUBIT_ANDROID_SDK_ROOT 'platform-tools\adb.exe'
  }
  if ($env:ANDROID_HOME) {
    $candidates += Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
  }
  if ($env:LOCALAPPDATA) {
    $candidates += Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
  }
  $adbCommand = Get-Command adb -ErrorAction SilentlyContinue
  if ($adbCommand -and $adbCommand.Path) {
    $candidates += $adbCommand.Path
  }

  $resolved = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if (-not $resolved) {
    throw 'adb.exe was not found. Install Android Platform-Tools 37.0.1+ or set HUBIT_ANDROID_SDK_ROOT.'
  }
  return [IO.Path]::GetFullPath([string]$resolved)
}

$adbPath = Resolve-AdbPath

function Invoke-Adb {
  param(
    [Parameter(Mandatory)]
    [string[]]$Arguments,
    [switch]$WithoutDevice
  )

  $prefix = if ($WithoutDevice) { @() } else { @('-s', $script:deviceSerial) }
  $output = & $adbPath @prefix @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    $safeText = ($output | Out-String).Trim()
    throw "adb exited with code $exitCode. $safeText"
  }
  return @($output)
}

Invoke-Adb -WithoutDevice -Arguments @('start-server') | Out-Null
$deviceRows = Invoke-Adb -WithoutDevice -Arguments @('devices', '-l')
$connected = @(
  foreach ($row in $deviceRows) {
    $text = [string]$row
    if ($text -match '^(?<serial>\S+)\s+device(?:\s|$)') {
      $Matches.serial
    }
  }
)

if ($Serial) {
  if ($connected -notcontains $Serial) {
    throw 'The requested Android device is missing or is not authorized in adb.'
  }
  $script:deviceSerial = $Serial
} elseif ($connected.Count -eq 1) {
  $script:deviceSerial = $connected[0]
} elseif ($connected.Count -eq 0) {
  throw 'No connected and authorized Android device was found. Enable USB debugging and accept the RSA prompt.'
} else {
  throw 'Multiple Android devices are connected. Repeat with the -Serial parameter.'
}

$packageDump = (Invoke-Adb -Arguments @('shell', 'dumpsys', 'package', $packageName) | Out-String)
$wasInstalled = $packageDump -match '(?m)^\s*versionName='

if ($InstallMode -ne 'Verify') {
  if (-not (Test-Path -LiteralPath $resolvedApk)) {
    throw "APK was not found: $resolvedApk"
  }
  if ($InstallMode -eq 'Clean') {
    if (-not $AllowDataReset) {
      throw 'Clean install removes local app data. Repeat with -AllowDataReset.'
    }
    if ($wasInstalled) {
      Invoke-Adb -Arguments @('uninstall', $packageName) | Out-Null
    }
    Invoke-Adb -Arguments @('install', $resolvedApk) | Out-Null
  } else {
    Invoke-Adb -Arguments @('install', '-r', $resolvedApk) | Out-Null
  }
  $packageDump = (Invoke-Adb -Arguments @('shell', 'dumpsys', 'package', $packageName) | Out-String)
}

$versionName = if ($packageDump -match '(?m)^\s*versionName=(?<value>\S+)') { $Matches.value } else { '' }
$versionCode = if ($packageDump -match '(?m)^\s*versionCode=(?<value>\d+)') { $Matches.value } else { '' }
if (-not $versionName) {
  throw "$packageName is not installed on the selected device. Use -InstallMode Upgrade or Clean."
}
if ($versionName -ne $expectedVersion) {
  throw "Installed version is $versionName; expected $expectedVersion. Upgrade the APK before device smoke."
}

Invoke-Adb -Arguments @('shell', 'monkey', '-p', $packageName, '-c', 'android.intent.category.LAUNCHER', '1') | Out-Null
Start-Sleep -Seconds 2
$initialPid = ((Invoke-Adb -Arguments @('shell', 'pidof', $packageName) | Out-String).Trim())
$launchOk = -not [string]::IsNullOrWhiteSpace($initialPid)

$deepLink = 'hubit://portal?path=%2Ftasks'
$deepLinkOutput = (Invoke-Adb -Arguments @(
  'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', $deepLink, $packageName
) | Out-String)
$deepLinkOk = $deepLinkOutput -match '(?im)^Status:\s*ok\s*$'

Invoke-Adb -Arguments @('shell', 'input', 'keyevent', 'KEYCODE_HOME') | Out-Null
Start-Sleep -Seconds 1
Invoke-Adb -Arguments @('shell', 'monkey', '-p', $packageName, '-c', 'android.intent.category.LAUNCHER', '1') | Out-Null
Start-Sleep -Seconds 2
$resumePid = ((Invoke-Adb -Arguments @('shell', 'pidof', $packageName) | Out-String).Trim())
$resumeOk = -not [string]::IsNullOrWhiteSpace($resumePid)

$manualChecks = [ordered]@{
  auth_2fa_portal = $null
  biometric_opt_in_after_2fa = $null
  biometric_cold_start = $null
  cold_start_keeps_session = $null
  connectivity_snapshot_refresh = $null
  background_settings_open = $null
  offline_prepared_lists = $null
  offline_cached_pages_read_only = $null
  offline_recovery_banner = $null
  lifecycle_twenty_cycles = $null
  logout_clears_session = $null
  tasks_executor_controller = $null
  chat_two_accounts_realtime = $null
  chat_offline_reconnect = $null
  background_push_opens_target = $null
  mail_download_and_print = $null
  keyboard_chat_mail_tasks_settings = $null
  status_and_navigation_bars = $null
  font_scale_and_safe_area = $null
}

function Read-CheckResult([string]$Prompt) {
  while ($true) {
    $answer = (Read-Host "$Prompt [y/n]").Trim().ToLowerInvariant()
    if ($answer -in @('y', 'yes')) { return $true }
    if ($answer -in @('n', 'no')) { return $false }
  }
}

if ($Interactive) {
  Write-Host 'Manual acceptance records only pass/fail results; do not enter credentials or business data into this console.' -ForegroundColor Cyan
  $manualChecks.auth_2fa_portal = Read-CheckResult 'Do Login and 2FA open the portal without returning to Login?'
  $manualChecks.biometric_opt_in_after_2fa = Read-CheckResult 'Is fingerprint opt-in offered only after successful 2FA?'
  $manualChecks.biometric_cold_start = Read-CheckResult 'Does a cold start require the enrolled fingerprint and then open the portal?'
  $manualChecks.cold_start_keeps_session = Read-CheckResult 'Does a cold start restore the authenticated session?'
  $manualChecks.connectivity_snapshot_refresh = Read-CheckResult 'Do Settings show validated Android connectivity, transport and metered state, and does Refresh update it after airplane mode?'
  $manualChecks.background_settings_open = Read-CheckResult "Does Background and battery open this app's battery screen or app-details fallback without asking for an exemption?"
  $manualChecks.offline_prepared_lists = Read-CheckResult 'While online, does Prepare offline mode confirm only the Dashboard, Tasks and Mail lists that were actually saved?'
  $manualChecks.offline_cached_pages_read_only = Read-CheckResult 'In airplane mode, do prepared Dashboard, Tasks and Mail lists open read-only while an unprepared detail clearly says it is unavailable offline?'
  $manualChecks.offline_recovery_banner = Read-CheckResult 'After reconnecting, does a green connection-restored banner appear and then disappear without leaving the offline banner?'
  $manualChecks.lifecycle_twenty_cycles = Read-CheckResult 'Did 20 cold starts and 20 offline-online cycles complete without a blank screen, logout, route loss or false save success?'
  $manualChecks.logout_clears_session = Read-CheckResult 'Does Logout return to Login without restoring the old session?'
  $manualChecks.tasks_executor_controller = Read-CheckResult 'Were task actions verified as executor and controller?'
  $manualChecks.chat_two_accounts_realtime = Read-CheckResult 'Does Chat A-B and B-A work without manual refresh?'
  $manualChecks.chat_offline_reconnect = Read-CheckResult 'Did Chat recover after 30-60 seconds offline?'
  $manualChecks.background_push_opens_target = Read-CheckResult 'Did background push open the target page or conversation?'
  $manualChecks.mail_download_and_print = Read-CheckResult 'Do mail preview, download and print work?'
  $manualChecks.keyboard_chat_mail_tasks_settings = Read-CheckResult 'Does the keyboard keep every active text field visible in Chat, Mail, Tasks and Settings?'
  $manualChecks.status_and_navigation_bars = Read-CheckResult 'Is content below the status bar and is the Android navigation bar hidden?'
  $manualChecks.font_scale_and_safe_area = Read-CheckResult 'Are safe-area and Android font scale rendered correctly?'
}

$deviceModel = ((Invoke-Adb -Arguments @('shell', 'getprop', 'ro.product.model') | Out-String).Trim())
$androidVersion = ((Invoke-Adb -Arguments @('shell', 'getprop', 'ro.build.version.release') | Out-String).Trim())
$androidSdk = ((Invoke-Adb -Arguments @('shell', 'getprop', 'ro.build.version.sdk') | Out-String).Trim())
$android13OrNewer = $androidSdk -match '^\d+$' -and [int]$androidSdk -ge 33
$automatedChecks = [ordered]@{
  package_installed = $true
  expected_version = $true
  android_13_or_newer = $android13OrNewer
  launcher_process_started = $launchOk
  portal_deep_link_resolved = $deepLinkOk
  background_resume_started = $resumeOk
}

function Convert-CheckMapToStatuses {
  param(
    [Parameter(Mandatory)]
    [System.Collections.IDictionary]$Checks
  )

  $statuses = [ordered]@{}
  foreach ($name in $Checks.Keys) {
    $value = $Checks[$name]
    $statuses[$name] = if ($null -eq $value) {
      'not_run'
    } elseif ($value -eq $true) {
      'passed'
    } else {
      'failed'
    }
  }
  return $statuses
}

$automatedPassed = @($automatedChecks.Values | Where-Object { $_ -ne $true }).Count -eq 0
$manualPassed = -not $Interactive -or @($manualChecks.Values | Where-Object { $_ -ne $true }).Count -eq 0
$overallStatus = if (-not $automatedPassed -or ($Interactive -and -not $manualPassed)) {
  'failed'
} elseif ($Interactive) {
  'passed'
} else {
  'not_run'
}
$report = [ordered]@{
  schema_version = 2
  checked_at = (Get-Date).ToUniversalTime().ToString('o')
  package = $packageName
  version_name = $versionName
  version_code = $versionCode
  install_mode = $InstallMode.ToLowerInvariant()
  device = [ordered]@{
    model = $deviceModel
    android = $androidVersion
    api_level = $androidSdk
  }
  automated = $automatedChecks
  manual = $manualChecks
  results = [ordered]@{
    automated = Convert-CheckMapToStatuses -Checks $automatedChecks
    manual = Convert-CheckMapToStatuses -Checks $manualChecks
    overall = $overallStatus
  }
  privacy = 'No serial, credentials, tokens, cookies, message content, screenshots, logcat, SSID, IP address or operator name were collected.'
}

$reportDir = Join-Path $repoRoot 'artifacts\mobile'
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
$reportPath = Join-Path $reportDir ("device-smoke-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Host "Device smoke report: $reportPath" -ForegroundColor Green
Write-Host "Package: $packageName $versionName ($versionCode); Android $androidVersion; model $deviceModel"

if (-not $automatedPassed) {
  throw 'One or more automated device checks failed. See the de-identified JSON report.'
}
if (-not $manualPassed) {
  throw 'Manual device acceptance has failed checks. See the de-identified JSON report.'
}
if (-not $Interactive) {
  Write-Host 'Automated checks passed; manual checks were not run. Repeat with -Interactive.' -ForegroundColor Yellow
}
