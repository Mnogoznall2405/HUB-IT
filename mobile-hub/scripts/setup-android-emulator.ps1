#Requires -Version 5.1
<#
.SYNOPSIS
  Установка Android Emulator + запуск AVD для mobile-hub (Expo).

.NOTES
  Официальный эмулятор Google НЕ поддерживается на Windows Server.
  Нужен Windows 10/11 (Pro) с виртуализацией (Intel HAXM или Hyper-V / WHPX).
#>
$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

$os = (Get-CimInstance Win32_OperatingSystem).Caption
if ($os -match 'Server') {
  Write-Host @"

ВНИМАНИЕ: обнаружен $os
Android Emulator и adb часто НЕ работают на Windows Server (ошибка adb 0xC0000135).
Рекомендации:
  1) Разработку mobile-hub вести на Windows 10/11 с Android Studio, или
  2) Тестировать через Expo Go на физическом телефоне (см. README).

Скрипт всё равно попробует продолжить, но успех маловероятен на Server.
"@ -ForegroundColor Yellow
}

$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot

Write-Step "SDK: $sdkRoot"
if (-not (Test-Path $sdkRoot)) { New-Item -ItemType Directory -Path $sdkRoot -Force | Out-Null }

# --- Java (для sdkmanager) ---
$java = Get-Command java -ErrorAction SilentlyContinue
if (-not $java) {
  Write-Step "Java не найдена. Установите Android Studio (включает JBR) или OpenJDK 17:"
  Write-Host "  https://developer.android.com/studio" -ForegroundColor Gray
  Write-Host "После установки перезапустите PowerShell и снова запустите этот скрипт." -ForegroundColor Gray
  exit 1
}

# --- adb sanity ---
$adb = Join-Path $sdkRoot 'platform-tools\adb.exe'
if (Test-Path $adb) {
  Write-Step "Проверка adb..."
  $p = Start-Process -FilePath $adb -ArgumentList 'version' -Wait -PassThru -NoNewWindow
  if ($p.ExitCode -ne 0) {
    Write-Host "adb не запускается (код $($p.ExitCode)). Переустановите platform-tools через Android Studio -> SDK Manager." -ForegroundColor Red
    exit 1
  }
  & $adb version
}

$sdkmanager = Get-ChildItem (Join-Path $sdkRoot 'cmdline-tools') -Recurse -Filter 'sdkmanager.bat' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $sdkmanager) {
  Write-Step "cmdline-tools не найдены. Установите Android Studio -> SDK Manager -> Android SDK Command-line Tools."
  exit 1
}

Write-Step "Установка emulator + образа system-images (может занять 10–20 мин)..."
$yes = "y`n" * 20
$yes | & $sdkmanager.FullName --install `
  "platform-tools" `
  "emulator" `
  "platforms;android-34" `
  "system-images;android-34;google_apis;x86_64"

$avdmanager = Join-Path $sdkmanager.DirectoryName 'avdmanager.bat'
$avdName = 'HubIT_Pixel_API34'
Write-Step "Создание AVD $avdName..."
& $avdmanager list avd | Out-String | Select-String $avdName -Quiet
if (-not $?) {
  echo "no" | & $avdmanager create avd -n $avdName -k "system-images;android-34;google_apis;x86_64" -d pixel_6
}

$emulator = Join-Path $sdkRoot 'emulator\emulator.exe'
if (-not (Test-Path $emulator)) {
  Write-Host "emulator.exe не найден после установки." -ForegroundColor Red
  exit 1
}

Write-Step "Запуск эмулятора $avdName (отдельное окно)..."
Start-Process -FilePath $emulator -ArgumentList "-avd", $avdName

Write-Step "Дождитесь загрузки Android, затем в mobile-hub:"
Write-Host "  cd $PSScriptRoot\.." -ForegroundColor Green
Write-Host "  npx expo start --android" -ForegroundColor Green
