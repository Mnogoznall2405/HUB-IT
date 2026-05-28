#Requires -Version 5.1
<#
.SYNOPSIS
  Builds HUB-IT Android APK.

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
$toolsRoot = Join-Path $repoRoot 'tools'
$androidRoot = Join-Path $root 'android'

function Write-Step($message) {
  Write-Host "`n==> $message" -ForegroundColor Cyan
}

function Convert-ToGradlePath($path) {
  return ([IO.Path]::GetFullPath($path) -replace '\\', '/')
}

function Get-ShortPath($path) {
  if ($env:OS -ne 'Windows_NT') {
    return $path
  }

  if (-not ('Native.Win32Path' -as [type])) {
    $signature = @'
[DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern int GetShortPathName(string longPath, System.Text.StringBuilder shortPath, int shortPathLength);
'@
    Add-Type -MemberDefinition $signature -Name Win32Path -Namespace Native
  }

  $buffer = New-Object System.Text.StringBuilder 1024
  $length = [Native.Win32Path]::GetShortPathName($path, $buffer, $buffer.Capacity)
  if ($length -gt 0) {
    return $buffer.ToString()
  }

  return $path
}

function Test-ContainsNonAscii($text) {
  return [regex]::IsMatch($text, '[^\u0000-\u007F]')
}

function Write-Utf8NoBom($path, $text) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  $cleanText = $text.TrimStart([char]0xFEFF)
  [IO.File]::WriteAllText($path, $cleanText, $encoding)
}

function Set-LocalProperty($path, $name, $value) {
  $line = "$name=$value"
  if (Test-Path $path) {
    $text = Get-Content -Path $path -Raw -Encoding UTF8
    if ($text -match "(?m)^$([regex]::Escape($name))=") {
      $text = [regex]::Replace($text, "(?m)^$([regex]::Escape($name))=.*$", $line)
    } elseif ($text.Length -eq 0) {
      $text = $line + [Environment]::NewLine
    } else {
      $text = $text.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine
    }
    Write-Utf8NoBom $path $text
  } else {
    Write-Utf8NoBom $path ($line + [Environment]::NewLine)
  }
}

function Test-AndroidProject($path) {
  $required = @(
    'gradlew.bat',
    'settings.gradle',
    'build.gradle',
    'app\build.gradle'
  )

  foreach ($item in $required) {
    if (-not (Test-Path (Join-Path $path $item))) {
      return $false
    }
  }

  return $true
}

function Use-BundledJdk {
  $bundledJdk = Get-ChildItem $toolsRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'jdk*' -and (Test-Path (Join-Path $_.FullName 'bin\java.exe')) } |
    Select-Object -First 1

  if ($bundledJdk) {
    $env:JAVA_HOME = $bundledJdk.FullName
    $env:Path = "$env:JAVA_HOME\bin;$env:Path"
    Write-Host "JAVA_HOME=$env:JAVA_HOME"
    return
  }

  if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
    throw 'Java 17 is required. Install Android Studio or put a JDK under tools\jdk* first.'
  }
}

function Use-AndroidSdk {
  if (-not $env:ANDROID_HOME) {
    $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
  }
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME

  if (-not (Test-Path $env:ANDROID_HOME)) {
    throw "Android SDK was not found: $env:ANDROID_HOME"
  }

  $env:ANDROID_HOME = Get-ShortPath $env:ANDROID_HOME
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
  Write-Host "ANDROID_HOME=$env:ANDROID_HOME"
}

function Use-GradleHome {
  if ($env:HUBIT_GRADLE_USER_HOME) {
    $gradleHome = $env:HUBIT_GRADLE_USER_HOME
    New-Item -ItemType Directory -Path $gradleHome -Force | Out-Null
    $env:GRADLE_USER_HOME = $gradleHome
    Write-Host "GRADLE_USER_HOME=$env:GRADLE_USER_HOME"
    return
  }

  $defaultGradleHome = Join-Path $env:USERPROFILE '.gradle'
  if ($env:OS -eq 'Windows_NT' -and (Test-ContainsNonAscii $defaultGradleHome) -and (Test-Path $defaultGradleHome)) {
    $junction = Join-Path $toolsRoot 'gradle-home'
    if (-not (Test-Path $junction)) {
      New-Item -ItemType Junction -Path $junction -Target $defaultGradleHome | Out-Null
    }
    $env:GRADLE_USER_HOME = $junction
    Write-Host "GRADLE_USER_HOME=$env:GRADLE_USER_HOME"
  }
}

function Use-RepoCmake {
  $source = if ($env:HUBIT_ANDROID_CMAKE_DIR) {
    $env:HUBIT_ANDROID_CMAKE_DIR
  } else {
    Join-Path $env:ANDROID_HOME 'cmake\3.22.1'
  }

  if (-not (Test-Path (Join-Path $source 'bin\cmake.exe'))) {
    throw "CMake 3.22.1 was not found: $source"
  }
  if (-not (Test-Path (Join-Path $source 'bin\ninja.exe'))) {
    throw "ninja.exe was not found under CMake: $source"
  }

  $target = Join-Path $toolsRoot 'android-cmake\3.22.1'
  if (-not (Test-Path (Join-Path $target 'bin\ninja.exe'))) {
    Write-Step "Copy CMake 3.22.1 to an ASCII project path"
    New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
    Copy-Item -Path $source -Destination $target -Recurse -Force
  }

  $env:Path = "$(Join-Path $target 'bin');$env:Path"
  return $target
}

function Ensure-AndroidLocalProperties($cmakeDir) {
  $localProperties = Join-Path $androidRoot 'local.properties'
  Set-LocalProperty $localProperties 'sdk.dir' (Convert-ToGradlePath $env:ANDROID_HOME)
  Set-LocalProperty $localProperties 'cmake.dir' (Convert-ToGradlePath $cmakeDir)
}

function Patch-Kotlin {
  Write-Step "Kotlin 1.9.25 for expo-modules-core Compose"
  & (Join-Path $PSScriptRoot 'patch-android-kotlin.ps1')

  $props = Join-Path $androidRoot 'gradle.properties'
  if (Test-Path $props) {
    $gp = Get-Content $props -Raw -Encoding UTF8
    if ($gp -notmatch '(?m)^android\.kotlinVersion=') {
      $gp = $gp.TrimEnd() + [Environment]::NewLine + 'android.kotlinVersion=1.9.25' + [Environment]::NewLine
      Write-Utf8NoBom $props $gp
    } else {
      Write-Utf8NoBom $props $gp
    }
  }

  $buildGradle = Join-Path $androidRoot 'build.gradle'
  if (Test-Path $buildGradle) {
    $text = Get-Content $buildGradle -Raw -Encoding UTF8
    $next = $text -replace "classpath\('org\.jetbrains\.kotlin:kotlin-gradle-plugin'\)", 'classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:${kotlinVersion}")'

    if ($next -match 'apply plugin: "com\.facebook\.react\.rootproject"' -and $next -notmatch 'ext \{\s*\r?\n\s*kotlinVersion') {
      $insert = @"

// Visible to expo-modules-core. Compose Compiler 1.5.15 needs Kotlin 1.9.25.
ext {
    kotlinVersion = findProperty('android.kotlinVersion') ?: '1.9.25'
}

"@
      $next = $next -replace '(apply plugin: "com\.facebook\.react\.rootproject"\r?\n)', "`$1$insert"
    }

    if ($next -ne $text) {
      Write-Utf8NoBom $buildGradle $next
    } else {
      Write-Utf8NoBom $buildGradle $text
    }
  }
}

function Patch-GradleWrapper {
  $wrapperProperties = Join-Path $androidRoot 'gradle\wrapper\gradle-wrapper.properties'
  if (-not (Test-Path $wrapperProperties)) {
    return
  }

  $text = Get-Content $wrapperProperties -Raw -Encoding UTF8
  $text = $text -replace 'networkTimeout=\d+', 'networkTimeout=120000'
  $text = $text -replace 'gradle-8\.10\.2-all\.zip', 'gradle-8.10.2-bin.zip'
  Write-Utf8NoBom $wrapperProperties $text
}

function Set-GradleProperty($path, $name, $value) {
  if (-not (Test-Path $path)) {
    return
  }

  $line = "$name=$value"
  $text = Get-Content $path -Raw -Encoding UTF8
  if ($text -match "(?m)^#?\s*$([regex]::Escape($name))=") {
    $text = [regex]::Replace($text, "(?m)^#?\s*$([regex]::Escape($name))=.*$", $line)
  } else {
    $text = $text.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine
  }
  Write-Utf8NoBom $path $text
}

function Patch-GradleWindowsSettings {
  $gradleProperties = Join-Path $androidRoot 'gradle.properties'
  Set-GradleProperty $gradleProperties 'org.gradle.parallel' 'false'
  Set-GradleProperty $gradleProperties 'org.gradle.workers.max' '1'
  Set-GradleProperty $gradleProperties 'org.gradle.vfs.watch' 'false'
}

function Clear-GradleTransformCache {
  if ($env:HUBIT_CLEAR_GRADLE_TRANSFORMS -ne '1') {
    return
  }
  if (-not $env:GRADLE_USER_HOME) {
    return
  }

  $cache = Join-Path $env:GRADLE_USER_HOME 'caches\8.10.2\transforms'
  if (-not (Test-Path $cache)) {
    return
  }

  $cacheFull = [IO.Path]::GetFullPath($cache)
  $homeFull = [IO.Path]::GetFullPath($env:GRADLE_USER_HOME)
  if (-not $cacheFull.StartsWith($homeFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clear Gradle cache outside GRADLE_USER_HOME: $cacheFull"
  }

  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Remove-Item -LiteralPath $cacheFull -Recurse -Force -ErrorAction Stop
      return
    } catch {
      if ($attempt -eq 3) {
        throw
      }
      Start-Sleep -Seconds 2
    }
  }
}

Set-Location $root
$env:CI = '1'

if (-not $Local -and -not $Eas) {
  $Eas = $true
}

Write-Step "Generate icon and splash assets"
python (Join-Path $PSScriptRoot 'generate-assets.py')

if ($Local) {
  Use-BundledJdk
  Use-AndroidSdk
  Use-GradleHome

  if (-not (Test-AndroidProject $androidRoot)) {
    Write-Step "expo prebuild (android clean)"
    npx expo prebuild --platform android --clean --non-interactive
  }

  Patch-Kotlin
  Patch-GradleWrapper
  Patch-GradleWindowsSettings
  $cmakeDir = Use-RepoCmake
  Ensure-AndroidLocalProperties $cmakeDir
  Clear-GradleTransformCache

  Write-Step "Local debug APK build (assembleDebug)"
  Push-Location $androidRoot
  try {
    .\gradlew.bat assembleDebug --no-daemon --stacktrace --max-workers=1
    if ($LASTEXITCODE -ne 0) {
      throw "gradlew assembleDebug failed with exit code $LASTEXITCODE"
    }

    $apk = Get-ChildItem -Path 'app\build\outputs\apk\debug' -Filter '*.apk' -Recurse | Select-Object -First 1
    if ($apk) {
      $out = Join-Path $root 'dist'
      New-Item -ItemType Directory -Path $out -Force | Out-Null
      $dest = Join-Path $out 'hubit-mobile-debug.apk'
      Copy-Item $apk.FullName $dest -Force
      Write-Host "`nAPK: $dest" -ForegroundColor Green
    } else {
      throw 'assembleDebug finished, but no debug APK was found.'
    }
  } finally {
    Pop-Location
  }
}

if ($Eas) {
  Write-Step "EAS Build (profile=$Profile)"
  if (-not $env:EXPO_TOKEN) {
    Write-Host 'Run npx eas-cli login first, or set EXPO_TOKEN for CI.' -ForegroundColor Yellow
  }
  npx eas-cli build --platform android --profile $Profile --non-interactive
  Write-Host 'After the build finishes, list/download it with: npx eas-cli build:list' -ForegroundColor Gray
}
