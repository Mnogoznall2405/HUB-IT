#Requires -Version 5.1
<#
.SYNOPSIS
  Print SHA-256 signing certificate(s) for an Android APK and compare with assetlinks.json.
#>
param(
    [string]$ApkPath = (Join-Path $PSScriptRoot "..\mobile-android\android\app\build\outputs\apk\debug\app-debug.apk"),
    [string]$AssetLinksPath = (Join-Path $PSScriptRoot "..\WEB-itinvent\frontend\public\.well-known\assetlinks.json")
)

$ErrorActionPreference = 'Stop'

function Normalize-Fingerprint([string]$Value) {
    return ($Value -replace '[^A-Fa-f0-9]', '').ToUpperInvariant()
}

function Get-KeytoolPath {
    if ($env:JAVA_HOME) {
        $candidate = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    $keytool = Get-Command keytool -ErrorAction SilentlyContinue
    if ($keytool) { return $keytool.Source }
    throw 'keytool not found. Set JAVA_HOME to JDK 21.'
}

function Get-ApksignerPath {
    $roots = @(
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

    foreach ($root in $roots) {
        $buildTools = Join-Path $root 'build-tools'
        if (-not (Test-Path -LiteralPath $buildTools)) { continue }
        $apksigner = Get-ChildItem -Path $buildTools -Recurse -Filter 'apksigner.bat' -ErrorAction SilentlyContinue |
            Sort-Object { [version]$_.Directory.Name } -Descending |
            Select-Object -First 1
        if ($apksigner) { return $apksigner.FullName }
    }
    return $null
}

if (-not (Test-Path -LiteralPath $ApkPath)) {
    throw "APK not found: $ApkPath"
}

Write-Host "APK: $ApkPath" -ForegroundColor Cyan
Write-Host ""

$raw = ''
$apksigner = Get-ApksignerPath
if ($apksigner) {
    $raw = & $apksigner verify --print-certs $ApkPath 2>&1 | Out-String
    Write-Host $raw
}

if (-not $raw -or $raw -notmatch 'SHA-256') {
    $keytool = Get-KeytoolPath
    $raw = & $keytool -printcert -jarfile $ApkPath 2>&1 | Out-String
    Write-Host $raw
}

$matches = [regex]::Matches($raw, 'SHA-?256(?:\s+digest)?[:\s]+([0-9A-Fa-f:\s]+)', 'IgnoreCase')
if ($matches.Count -eq 0) {
    throw 'No SHA256 fingerprint found in apksigner/keytool output.'
}

function Format-Fingerprint([string]$Hex) {
    $normalized = Normalize-Fingerprint $Hex
    if ($normalized.Length -lt 64) {
        return $Hex.Trim().ToUpperInvariant()
    }
    $parts = for ($index = 0; $index -lt $normalized.Length; $index += 2) {
        $normalized.Substring($index, 2)
    }
    return ($parts -join ':')
}

$apkFingerprints = @()
foreach ($match in $matches) {
    $apkFingerprints += Format-Fingerprint $match.Groups[1].Value
}

Write-Host "APK SHA-256 fingerprint(s):" -ForegroundColor Green
$apkFingerprints | ForEach-Object { Write-Host "  $_" }

if (-not (Test-Path -LiteralPath $AssetLinksPath)) {
    Write-Host "assetlinks.json not found: $AssetLinksPath" -ForegroundColor Yellow
    exit 0
}

$assetText = Get-Content -Raw -LiteralPath $AssetLinksPath
$assetMatches = [regex]::Matches($assetText, '"sha256_cert_fingerprints"\s*:\s*\[\s*"([^"]+)"')
$assetFingerprints = @()
foreach ($match in $assetMatches) {
    $assetFingerprints += $match.Groups[1].Value.Trim().ToUpperInvariant()
}

Write-Host ""
Write-Host "assetlinks.json fingerprints:" -ForegroundColor Cyan
$assetFingerprints | ForEach-Object { Write-Host "  $_" }

$apkNormalized = $apkFingerprints | ForEach-Object { Normalize-Fingerprint $_ }
$assetNormalized = $assetFingerprints | ForEach-Object { Normalize-Fingerprint $_ }
$overlap = $apkNormalized | Where-Object { $assetNormalized -contains $_ }

Write-Host ""
if ($overlap.Count -gt 0) {
    Write-Host 'MATCH: APK signing cert is listed in assetlinks.json (App Links can verify for this build).' -ForegroundColor Green
    exit 0
}

Write-Host 'MISMATCH: Add the APK SHA-256 above to WEB-itinvent/frontend/public/.well-known/assetlinks.json, deploy to IIS, then reinstall the APK.' -ForegroundColor Red
exit 1
