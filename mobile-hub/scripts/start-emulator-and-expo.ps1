#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot

$adb = Join-Path $sdkRoot 'platform-tools\adb.exe'
if (-not (Test-Path $adb)) {
  Write-Error "adb не найден. Сначала: scripts\setup-android-emulator.ps1 или установите Android Studio."
}
& $adb start-server 2>$null
if ($LASTEXITCODE -ne 0 -and $?) { throw "adb start-server failed" }

$devices = & $adb devices 2>&1 | Out-String
if ($devices -notmatch "emulator-\d+\s+device") {
  $emulator = Join-Path $sdkRoot 'emulator\emulator.exe'
  $avdName = 'HubIT_Pixel_API34'
  if (-not (Test-Path $emulator)) {
    Write-Error "Эмулятор не установлен. Запустите scripts\setup-android-emulator.ps1 на Windows 10/11."
  }
  Write-Host "Запуск AVD $avdName ..."
  Start-Process -FilePath $emulator -ArgumentList "-avd", $avdName
  Write-Host "Ожидание boot (до 120 с)..."
  & $adb wait-for-device
  $deadline = (Get-Date).AddSeconds(120)
  do {
    Start-Sleep -Seconds 3
    $boot = & $adb shell getprop sys.boot_completed 2>$null
  } while ($boot.Trim() -ne '1' -and (Get-Date) -lt $deadline)
}

Set-Location $root
npx expo start --android
