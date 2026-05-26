param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Debug",

    [string]$ApiUrl = "https://hubit.zsgp.ru/api",

    [switch]$SkipNative
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$FrontendDir = Join-Path $RepoRoot "WEB-itinvent\frontend"
$MobileDir = Join-Path $RepoRoot "mobile-android"
$CapConfig = Join-Path $MobileDir "capacitor.config.ts"
$AndroidDir = Join-Path $MobileDir "android"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message"
}

function Assert-Path {
    param(
        [string]$Path,
        [string]$Message
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        throw $Message
    }
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [string[]]$Arguments = @()
    )
    & $FilePath @Arguments
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    if ($exitCode -ne 0) {
        throw "Command failed with exit code ${exitCode}: $FilePath $($Arguments -join ' ')"
    }
}

function Add-ToProcessPath {
    param([string]$Path)
    if ($Path -and (Test-Path -LiteralPath $Path) -and $env:Path -notlike "*$Path*") {
        $env:Path = "$Path;$env:Path"
    }
}

function Initialize-AndroidBuildEnvironment {
    if (-not $env:JAVA_HOME) {
        $jdkCandidates = @(
            "C:\AndroidDev\jdk-21",
            "C:\Program Files\Microsoft\jdk-21",
            "C:\Program Files\Eclipse Adoptium\jdk-21"
        )
        $jdkHome = $jdkCandidates |
            Where-Object { Test-Path -LiteralPath (Join-Path $_ "bin\java.exe") } |
            Select-Object -First 1
        if ($jdkHome) {
            $env:JAVA_HOME = $jdkHome
        }
    }

    if ($env:JAVA_HOME) {
        Add-ToProcessPath (Join-Path $env:JAVA_HOME "bin")
    }

    if (-not $env:ANDROID_HOME) {
        $androidHomeFromRoot = $env:ANDROID_SDK_ROOT
        $androidHomeFromUser = [Environment]::GetEnvironmentVariable("ANDROID_HOME", "User")
        $androidRootFromUser = [Environment]::GetEnvironmentVariable("ANDROID_SDK_ROOT", "User")
        $defaultAndroidHome = Join-Path $env:LOCALAPPDATA "Android\Sdk"
        $androidCandidates = @(
            $androidHomeFromRoot,
            $androidHomeFromUser,
            $androidRootFromUser,
            $defaultAndroidHome
        )
        $androidHome = $androidCandidates |
            Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ "platforms")) } |
            Select-Object -First 1
        if ($androidHome) {
            $env:ANDROID_HOME = $androidHome
        }
    }

    if (-not $env:ANDROID_SDK_ROOT -and $env:ANDROID_HOME) {
        $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    }

    if ($env:ANDROID_HOME) {
        Add-ToProcessPath (Join-Path $env:ANDROID_HOME "platform-tools")
        Add-ToProcessPath (Join-Path $env:ANDROID_HOME "cmdline-tools\latest\bin")
    }
}

function Disable-PushNotificationsPluginWithoutFirebase {
    $googleServicesPath = Join-Path $AndroidDir "app\google-services.json"
    $hasGoogleServices = (Test-Path -LiteralPath $googleServicesPath) -and ((Get-Item -LiteralPath $googleServicesPath).Length -gt 0)
    if ($hasGoogleServices) {
        return
    }

    Write-Step "Disabling native FCM plugin for build without google-services.json"

    $settingsPath = Join-Path $AndroidDir "capacitor.settings.gradle"
    if (Test-Path -LiteralPath $settingsPath) {
        $settingsText = Get-Content -Raw -Encoding UTF8 -LiteralPath $settingsPath
        $settingsText = $settingsText -replace "(?m)^include ':capacitor-push-notifications'\r?\n", ""
        $settingsText = $settingsText -replace "(?m)^project\(':capacitor-push-notifications'\)\.projectDir = .*\r?\n", ""
        [System.IO.File]::WriteAllText($settingsPath, $settingsText, [System.Text.UTF8Encoding]::new($false))
    }

    $capacitorBuildPath = Join-Path $AndroidDir "app\capacitor.build.gradle"
    if (Test-Path -LiteralPath $capacitorBuildPath) {
        $capacitorBuildText = Get-Content -Raw -Encoding UTF8 -LiteralPath $capacitorBuildPath
        $capacitorBuildText = $capacitorBuildText -replace "(?m)^\s*implementation project\(':capacitor-push-notifications'\)\r?\n", ""
        [System.IO.File]::WriteAllText($capacitorBuildPath, $capacitorBuildText, [System.Text.UTF8Encoding]::new($false))
    }
}

Assert-Path $FrontendDir "Frontend directory not found: $FrontendDir"
Assert-Path $MobileDir "Mobile Android directory not found: $MobileDir"
Assert-Path $CapConfig "Capacitor config not found: $CapConfig"

Initialize-AndroidBuildEnvironment

Write-Step "Checking Capacitor release config"
$capConfigText = Get-Content -Raw -Encoding UTF8 -LiteralPath $CapConfig
if ($Configuration -eq "Release") {
    if ($capConfigText -match "server\s*:") {
        throw "Release build blocked: capacitor.config.ts must not define server.url/server.cleartext for production APK."
    }
    if ($capConfigText -match "allowMixedContent\s*:\s*true") {
        throw "Release build blocked: Android allowMixedContent must not be true."
    }
}

if (-not $SkipNative -and -not (Get-Command java -ErrorAction SilentlyContinue)) {
    throw "Java was not found. Install JDK 21, set JAVA_HOME (see scripts/install-android-devtools.ps1), then rebuild. Use -SkipNative to build only the frontend bundle."
}

Write-Step "Building frontend for Android shell"
Push-Location $FrontendDir
try {
    $previousPlatform = $env:VITE_PLATFORM
    $previousApiUrl = $env:VITE_API_URL
    $env:VITE_PLATFORM = "capacitor"
    $env:VITE_API_URL = $ApiUrl
    Invoke-CheckedCommand "npm" @("run", "build:android")
}
finally {
    if ($null -eq $previousPlatform) { Remove-Item Env:\VITE_PLATFORM -ErrorAction SilentlyContinue } else { $env:VITE_PLATFORM = $previousPlatform }
    if ($null -eq $previousApiUrl) { Remove-Item Env:\VITE_API_URL -ErrorAction SilentlyContinue } else { $env:VITE_API_URL = $previousApiUrl }
    Pop-Location
}

if ($SkipNative) {
    Write-Host ""
    Write-Host "Frontend build completed. Native build skipped."
    exit 0
}

Write-Step "Checking mobile dependencies"
Assert-Path (Join-Path $MobileDir "node_modules") "mobile-android dependencies are missing. Run: cd mobile-android; npm install"

Write-Step "Syncing Capacitor Android project"
Push-Location $MobileDir
try {
    Invoke-CheckedCommand "npx" @("cap", "sync", "android")
}
finally {
    Pop-Location
}
Disable-PushNotificationsPluginWithoutFirebase

Assert-Path $AndroidDir "Android project not found. Run: cd mobile-android; npm run add:android"

$GradleWrapper = Join-Path $AndroidDir "gradlew.bat"
Assert-Path $GradleWrapper "Gradle wrapper not found: $GradleWrapper"

$GradleTask = if ($Configuration -eq "Release") { "assembleRelease" } else { "assembleDebug" }
Write-Step "Running Gradle $GradleTask"
Push-Location $AndroidDir
try {
    Invoke-CheckedCommand $GradleWrapper @($GradleTask)
}
finally {
    Pop-Location
}

$ApkPattern = if ($Configuration -eq "Release") { "*release*.apk" } else { "*debug*.apk" }
$Apks = Get-ChildItem -Path (Join-Path $AndroidDir "app\build\outputs\apk") -Recurse -Filter $ApkPattern -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending

if ($Apks.Count -gt 0) {
    Write-Host ""
    Write-Host "APK: $($Apks[0].FullName)"
}
else {
    Write-Host ""
    Write-Host "Gradle finished, but APK was not found under android\app\build\outputs\apk."
}
