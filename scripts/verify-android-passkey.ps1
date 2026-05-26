#Requires -Version 5.1
<#
.SYNOPSIS
  Server-side passkey/APK diagnostics: login-mode, assetlinks, APK cert vs assetlinks, adb hints.
#>
param(
    [string]$ApkPath = (Join-Path $PSScriptRoot "..\mobile-android\android\app\build\outputs\apk\debug\app-debug.apk"),
    [string]$PackageName = 'ru.zsgp.hubit'
)

$ErrorActionPreference = 'Continue'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$failed = $false

function Write-Block([string]$Title) {
    Write-Host ""
    Write-Host "==> $Title" -ForegroundColor Cyan
}

Write-Block 'Backend and assetlinks (production)'
& (Join-Path $PSScriptRoot 'check-passkey-backend.ps1')
if ($LASTEXITCODE -ne 0) { $failed = $true }

Write-Block 'APK signing certificate vs assetlinks.json'
$printScript = Join-Path $PSScriptRoot 'print-apk-signing-cert.ps1'
if (Test-Path -LiteralPath $ApkPath) {
    & $printScript -ApkPath $ApkPath
    if ($LASTEXITCODE -ne 0) { $failed = $true }
} else {
    Write-Host "APK not built yet: $ApkPath" -ForegroundColor Yellow
    Write-Host 'Run: powershell -File .\scripts\build-android-apk.ps1' -ForegroundColor Yellow
}

Write-Block 'ADB App Links (device connected)'
$adb = Get-Command adb -ErrorAction SilentlyContinue
if (-not $adb) {
    Write-Host 'adb not on PATH. Install Android platform-tools or set ANDROID_HOME.' -ForegroundColor Yellow
} else {
    $devices = & adb devices 2>&1
    Write-Host $devices
    if ($devices -match "`tdevice") {
        Write-Host ""
        & adb shell pm get-app-links $PackageName 2>&1
        Write-Host ""
        Write-Host "If hubit.zsgp.ru is not verified, run:" -ForegroundColor Yellow
        Write-Host "  adb shell pm verify-app-links --re-verify $PackageName"
    } else {
        Write-Host 'No USB device. On phone: Settings > Apps > HUB-IT > Open by default > hubit.zsgp.ru verified.' -ForegroundColor Yellow
    }
}

Write-Block 'WebView console check (phone + USB debugging)'
Write-Host 'Chrome -> chrome://inspect -> HUB-IT WebView on /login:' -ForegroundColor Green
Write-Host '  ({ secure: location.protocol==="https:", pk: !!window.PublicKeyCredential, native: !!window.Capacitor?.Plugins?.HubitPasskey, origin: location.origin })' -ForegroundColor Green

Write-Host ""
if ($failed) {
    Write-Host 'Some checks failed. Fix assetlinks/APK cert or backend WEBAUTHN_* before testing on device.' -ForegroundColor Red
    exit 1
}
Write-Host 'Server-side checks passed. Complete phone checks on mobile internet.' -ForegroundColor Green
exit 0
