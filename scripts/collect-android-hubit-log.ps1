param(
    [string]$PackageName = "ru.zsgp.hubit",
    [string]$OutputPath = "exports\hubit_android_crash_log.txt",
    [int]$Seconds = 90
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedOutput = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath
} else {
    Join-Path $repoRoot $OutputPath
}

$outputDir = Split-Path -Parent $resolvedOutput
if ($outputDir) {
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

$adb = Get-Command adb.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
if (-not $adb -and $env:ANDROID_HOME) {
    $candidate = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
    if (Test-Path -LiteralPath $candidate) {
        $adb = $candidate
    }
}
if (-not $adb -and $env:ANDROID_SDK_ROOT) {
    $candidate = Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe"
    if (Test-Path -LiteralPath $candidate) {
        $adb = $candidate
    }
}
if (-not $adb) {
    $candidate = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
    if (Test-Path -LiteralPath $candidate) {
        $adb = $candidate
    }
}
if (-not $adb) {
    throw "adb.exe not found. Install Android SDK platform-tools or set ANDROID_HOME."
}

Write-Host "Using adb: $adb"
Write-Host "Connected devices:"
& $adb devices

Write-Host "Clearing logcat..."
& $adb logcat -c

Write-Host "Start HUB-IT on the phone and reproduce the crash. Capturing for $Seconds seconds..."
$process = Start-Process -FilePath $adb -ArgumentList @(
    "logcat",
    "-v",
    "time",
    "AndroidRuntime:E",
    "chromium:E",
    "Capacitor:E",
    "HubItMainActivity:V",
    "HubitWebChromeClient:V",
    "*:S"
) -NoNewWindow -RedirectStandardOutput $resolvedOutput -PassThru

Start-Sleep -Seconds $Seconds
if (-not $process.HasExited) {
    $process.Kill()
    $process.WaitForExit()
}

Add-Content -Path $resolvedOutput -Encoding UTF8 -Value ""
Add-Content -Path $resolvedOutput -Encoding UTF8 -Value "=== dumpsys package $PackageName ==="
& $adb shell dumpsys package $PackageName | Out-File -FilePath $resolvedOutput -Encoding UTF8 -Append

Write-Host "Saved log: $resolvedOutput"
