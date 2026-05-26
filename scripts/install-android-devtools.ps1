#Requires -Version 5.1
<#
.SYNOPSIS
  Installs JDK 21 and Android SDK command-line tools for Capacitor APK builds.

.DESCRIPTION
  - JDK: Microsoft Build of OpenJDK 21 LTS (zip) -> C:\AndroidDev\jdk-21
  - Android SDK -> %LOCALAPPDATA%\Android\Sdk
  - Sets user env: JAVA_HOME, ANDROID_HOME, PATH

  Android Studio GUI is optional; Gradle builds work with SDK + JDK only.
  To add Studio later, install from https://developer.android.com/studio

.PARAMETER SkipSdkPackages
  Only install JDK and cmdline-tools skeleton (no platform/build-tools download).

.PARAMETER AndroidApiLevel
  Android platform API level to install (default 35).
#>
param(
    [switch]$SkipSdkPackages,
    [int]$AndroidApiLevel = 35
)

$ErrorActionPreference = 'Stop'

$JdkRoot = 'C:\AndroidDev'
# Capacitor 8 / Android Gradle Plugin require JDK 21 for compilation.
$JdkDir = Join-Path $JdkRoot 'jdk-21'
$AndroidHome = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$CmdlineToolsDir = Join-Path $AndroidHome 'cmdline-tools\latest'
$SdkManager = Join-Path $CmdlineToolsDir 'bin\sdkmanager.bat'
$TempDir = Join-Path $env:TEMP 'hubit-android-setup'

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Ensure-Dir([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Expand-Zip([string]$ZipPath, [string]$Destination) {
    Ensure-Dir $Destination
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $Destination)
}

function Set-UserEnvVar([string]$Name, [string]$Value) {
    [Environment]::SetEnvironmentVariable($Name, $Value, 'User')
    Set-Item -Path "Env:$Name" -Value $Value
}

function Add-UserPath([string]$Segment) {
    if (-not $Segment) { return }
    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @()
    if ($current) { $parts = $current -split ';' | Where-Object { $_ } }
    if ($parts -notcontains $Segment) {
        $parts += $Segment
        $joined = ($parts -join ';').TrimEnd(';')
        [Environment]::SetEnvironmentVariable('Path', $joined, 'User')
    }
    if ($env:Path -notlike "*$Segment*") {
        $env:Path = "$Segment;$env:Path"
    }
}

function Invoke-Download([string]$Url, [string]$OutFile) {
    Write-Host "Downloading: $Url"
    Ensure-Dir (Split-Path -Parent $OutFile)
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
}

function Resolve-JdkHome([string]$ExtractRoot) {
    $direct = Join-Path $ExtractRoot 'bin\java.exe'
    if (Test-Path -LiteralPath $direct) { return $ExtractRoot }
    $nested = Get-ChildItem -LiteralPath $ExtractRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } |
        Select-Object -First 1
    if ($nested) { return $nested.FullName }
    throw "Could not find bin\java.exe under $ExtractRoot"
}

Write-Step "Preparing directories"
Ensure-Dir $JdkRoot
Ensure-Dir $AndroidHome
Ensure-Dir $TempDir

# --- Microsoft OpenJDK 21 ---
if (-not (Test-Path -LiteralPath (Join-Path $JdkDir 'bin\java.exe'))) {
    Write-Step "Installing Microsoft Build of OpenJDK 21"
    $jdkZip = Join-Path $TempDir 'microsoft-jdk-21-windows-x64.zip'
    $jdkUrl = 'https://aka.ms/download-jdk/microsoft-jdk-21.0.7-windows-x64.zip'
    Invoke-Download $jdkUrl $jdkZip
    $jdkExtract = Join-Path $TempDir 'jdk-extract'
    if (Test-Path -LiteralPath $jdkExtract) { Remove-Item -LiteralPath $jdkExtract -Recurse -Force }
    Expand-Zip $jdkZip $jdkExtract
    $resolved = Resolve-JdkHome $jdkExtract
    if (Test-Path -LiteralPath $JdkDir) { Remove-Item -LiteralPath $JdkDir -Recurse -Force }
    Ensure-Dir (Split-Path -Parent $JdkDir)
    Move-Item -LiteralPath $resolved -Destination $JdkDir
}
else {
    Write-Step "JDK already present at $JdkDir"
}

$javaExe = Join-Path $JdkDir 'bin\java.exe'
& $javaExe -version
if ($LASTEXITCODE -ne 0) { throw "java -version failed" }

Set-UserEnvVar 'JAVA_HOME' $JdkDir
Add-UserPath (Join-Path $JdkDir 'bin')

# --- Android command-line tools ---
if (-not (Test-Path -LiteralPath $SdkManager)) {
    Write-Step "Installing Android SDK command-line tools"
    $cmdZip = Join-Path $TempDir 'commandlinetools-win.zip'
    $cmdUrl = 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip'
    Invoke-Download $cmdUrl $cmdZip
    $cmdExtract = Join-Path $TempDir 'cmdline-extract'
    if (Test-Path -LiteralPath $cmdExtract) { Remove-Item -LiteralPath $cmdExtract -Recurse -Force }
    Expand-Zip $cmdZip $cmdExtract
    $inner = Get-ChildItem -LiteralPath $cmdExtract -Recurse -Directory -Filter 'cmdline-tools' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $inner) {
        $binSdk = Get-ChildItem -LiteralPath $cmdExtract -Recurse -Filter 'sdkmanager.bat' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($binSdk) {
            $innerFull = $binSdk.Directory.Parent.Parent.FullName
            $inner = Get-Item -LiteralPath $innerFull
        }
    }
    if (-not $inner) { throw 'cmdline-tools layout not recognized in zip' }
    Ensure-Dir (Join-Path $AndroidHome 'cmdline-tools')
    if (Test-Path -LiteralPath $CmdlineToolsDir) { Remove-Item -LiteralPath $CmdlineToolsDir -Recurse -Force }
    $sourcePayload = Join-Path $inner.FullName 'cmdline-tools'
    if (Test-Path -LiteralPath $sourcePayload) {
        Move-Item -LiteralPath $sourcePayload -Destination (Join-Path $AndroidHome 'cmdline-tools\latest')
    }
    else {
        Move-Item -LiteralPath $inner.FullName -Destination $CmdlineToolsDir
    }
}
else {
    Write-Step "Android cmdline-tools already present"
}

Set-UserEnvVar 'ANDROID_HOME' $AndroidHome
Set-UserEnvVar 'ANDROID_SDK_ROOT' $AndroidHome
Add-UserPath $AndroidHome
Add-UserPath (Join-Path $AndroidHome 'platform-tools')
Add-UserPath (Join-Path $CmdlineToolsDir 'bin')

if (-not $SkipSdkPackages) {
    Write-Step "Accepting SDK licenses"
    $yes = (1..100 | ForEach-Object { 'y' }) -join "`n"
    $yes | & $SdkManager --licenses --sdk_root=$AndroidHome | Out-Null

    Write-Step "Installing SDK packages (API $AndroidApiLevel)"
    $packages = @(
        'platform-tools',
        "platforms;android-$AndroidApiLevel",
        'build-tools;35.0.1'
    )
    $yes | & $SdkManager @packages --sdk_root=$AndroidHome
    if ($LASTEXITCODE -ne 0) { throw "sdkmanager package install failed (exit $LASTEXITCODE)" }
}

Write-Step "Verification"
Write-Host "JAVA_HOME=$env:JAVA_HOME"
Write-Host "ANDROID_HOME=$env:ANDROID_HOME"
java -version
$adb = Join-Path $AndroidHome 'platform-tools\adb.exe'
if (Test-Path -LiteralPath $adb) {
    & $adb version
}
else {
    Write-Warning "adb not found yet (platform-tools may still be installing)."
}

Write-Host ""
Write-Host "Done. Open a NEW PowerShell window so user PATH/JAVA_HOME refresh." -ForegroundColor Green
Write-Host "Then: powershell -ExecutionPolicy Bypass -File .\scripts\build-android-apk.ps1 -Configuration Debug"
