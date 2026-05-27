#Requires -Version 5.1
<#
.SYNOPSIS
  Сборка APK для HUB-IT mobile-hub.

  Локально (debug, без подписи release): prebuild + Gradle — нужны JDK 17 и Android SDK.
  Облако (рекомендуется на Server): EAS Build — нужен аккаунт Expo и EXPO_TOKEN.

.EXAMPLE
  .\scripts\build-apk.ps1 -Local
  .\scripts\build-apk.ps1 -Eas
#>
param(
  [switch]$Local,
  [switch]$Eas,
  [ValidateSet('preview', 'production')]
  [string]$Profile = 'preview'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$repoRoot = Split-Path $root -Parent
$jdk = Join-Path $repoRoot 'tools\jdk-17.0.19+10'
if (Test-Path $jdk) {
  $env:JAVA_HOME = $jdk
  $env:Path = "$env:JAVA_HOME\bin;$env:Path"
}
$env:ANDROID_HOME = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
Set-Location $root

function Write-Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

if (-not $Local -and -not $Eas) {
  $Eas = $true
}

Write-Step "Генерация icon/splash"
python (Join-Path $PSScriptRoot 'generate-assets.py')

if ($Local) {
  Write-Step "Локальная сборка debug APK (assembleDebug)"
  $bundledJdk = Join-Path (Split-Path $PSScriptRoot -Parent | Split-Path -Parent) 'tools'
  $bundledJdk = Get-ChildItem $bundledJdk -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'jdk*' } | Select-Object -First 1
  if ($bundledJdk -and (Test-Path (Join-Path $bundledJdk.FullName 'bin\java.exe'))) {
    $env:JAVA_HOME = $bundledJdk.FullName
    $env:Path = "$env:JAVA_HOME\bin;" + $env:Path
    Write-Host "JAVA_HOME=$env:JAVA_HOME"
  } elseif (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    Write-Error "Нужна Java 17. Запустите scripts\install-jdk.ps1 или установите Android Studio."
  }
  $sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
  $env:ANDROID_HOME = $sdk
  $env:ANDROID_SDK_ROOT = $sdk

  if (-not (Test-Path "$root\android")) {
    Write-Step "expo prebuild (android)"
    npx expo prebuild --platform android --clean --non-interactive
  }

  Write-Step "Kotlin 1.9.25 (expo-modules-core Compose)"
  & (Join-Path $PSScriptRoot 'patch-android-kotlin.ps1')
  $props = Join-Path $root 'android\gradle.properties'
  if (Test-Path $props) {
    $gp = Get-Content $props -Raw
    if ($gp -notmatch 'android\.kotlinVersion') {
      Add-Content $props "`nandroid.kotlinVersion=1.9.25"
    }
  }
  $bg = Join-Path $root 'android\build.gradle'
  if (Test-Path $bg) {
    $bgText = Get-Content $bg -Raw
    if ($bgText -notmatch 'kotlin-gradle-plugin:\$\{kotlinVersion\}') {
      $bgText = $bgText -replace "classpath\('org\.jetbrains\.kotlin:kotlin-gradle-plugin'\)", 'classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:${kotlinVersion}")'
      Set-Content $bg $bgText -Encoding UTF8 -NoNewline
    }
    if ($bgText -notmatch 'apply plugin: "com.facebook.react.rootproject"') { } else {
      if ($bgText -notmatch 'ext \{\s*\n\s*kotlinVersion') {
        $bgText = Get-Content $bg -Raw
        $insert = @"

// Visible to expo-modules-core (Compose 1.5.15 needs Kotlin 1.9.25)
ext {
    kotlinVersion = findProperty('android.kotlinVersion') ?: '1.9.25'
}

"@
        $bgText = $bgText -replace '(apply plugin: "com\.facebook\.react\.rootproject"\r?\n)', "`$1$insert"
        Set-Content $bg $bgText -Encoding UTF8 -NoNewline
      }
    }
  }

  Push-Location "$root\android"
  try {
    .\gradlew.bat assembleDebug --no-daemon
    $apk = Get-ChildItem -Path "app\build\outputs\apk\debug" -Filter "*.apk" -Recurse | Select-Object -First 1
    if ($apk) {
      $out = Join-Path $root "dist"
      New-Item -ItemType Directory -Path $out -Force | Out-Null
      $dest = Join-Path $out "hubit-mobile-debug.apk"
      Copy-Item $apk.FullName $dest -Force
      Write-Host "`nAPK: $dest" -ForegroundColor Green
    }
  } finally {
    Pop-Location
  }
}

if ($Eas) {
  Write-Step "EAS Build (profile=$Profile, APK в облаке Expo)"
  if (-not $env:EXPO_TOKEN) {
    Write-Host "Войдите: npx eas-cli login  (или задайте EXPO_TOKEN для CI)" -ForegroundColor Yellow
  }
  npx eas-cli build --platform android --profile $Profile --non-interactive
  Write-Host "После сборки скачайте APK: npx eas-cli build:list" -ForegroundColor Gray
}
