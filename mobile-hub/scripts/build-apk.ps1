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
  [switch]$SkipPrebuild,
  [switch]$AllowDebugSigning,
  [ValidateSet('debug', 'preview')]
  [string]$Variant = 'preview',
  [ValidateSet('preview', 'production')]
  [string]$Profile = 'preview',
  [ValidateSet('dual', 'arm64')]
  [string]$Architectures = 'dual'
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
  $candidates = @()
  if ($env:HUBIT_JAVA_HOME) {
    $candidates += $env:HUBIT_JAVA_HOME
  }
  $candidates += Get-ChildItem $toolsRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'jdk-17*' -and (Test-Path (Join-Path $_.FullName 'bin\java.exe')) } |
    ForEach-Object { $_.FullName }
  $javaCommand = Get-Command java -ErrorAction SilentlyContinue
  if ($javaCommand -and $javaCommand.Path) {
    $candidates += Split-Path (Split-Path $javaCommand.Path -Parent) -Parent
  }

  $bundledJdk = $candidates |
    Where-Object {
      $release = Join-Path $_ 'release'
      (Test-Path (Join-Path $_ 'bin\java.exe')) -and
        (Test-Path $release) -and
        ((Get-Content $release -Raw -Encoding UTF8) -match '(?m)^JAVA_VERSION="17(?:\.|"|-)')
    } |
    Select-Object -First 1

  if ($bundledJdk) {
    $env:JAVA_HOME = [IO.Path]::GetFullPath([string]$bundledJdk)
    $env:Path = "$env:JAVA_HOME\bin;$env:Path"
    Write-Host "JAVA_HOME=$env:JAVA_HOME"
    return
  }

  throw 'Java 17 is required. Set HUBIT_JAVA_HOME or put JDK 17 first on PATH.'
}

function Use-AndroidSdk {
  $sdkRoot = if ($env:HUBIT_ANDROID_SDK_ROOT) {
    $env:HUBIT_ANDROID_SDK_ROOT
  } elseif ($env:ANDROID_HOME) {
    $env:ANDROID_HOME
  } else {
    Join-Path $env:LOCALAPPDATA 'Android\Sdk'
  }

  if (-not (Test-Path $sdkRoot)) {
    throw "Android SDK was not found: $sdkRoot"
  }

  $sdkRoot = [IO.Path]::GetFullPath($sdkRoot)
  if ($env:OS -eq 'Windows_NT' -and (Test-ContainsNonAscii $sdkRoot)) {
    $asciiSdkRoot = Join-Path $toolsRoot 'android-sdk'
    if (Test-Path $asciiSdkRoot) {
      $existing = Get-Item -LiteralPath $asciiSdkRoot -Force
      if (-not ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "ASCII Android SDK path already exists and is not a junction: $asciiSdkRoot"
      }
    } else {
      Write-Step "Create an ASCII junction for Android SDK"
      New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
      New-Item -ItemType Junction -Path $asciiSdkRoot -Target $sdkRoot | Out-Null
    }
    $sdkRoot = $asciiSdkRoot
  }

  $env:ANDROID_HOME = Get-ShortPath $sdkRoot
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
  if ($env:OS -eq 'Windows_NT' -and (Test-ContainsNonAscii $defaultGradleHome)) {
    # Keep the cache path short: React Native prefab headers can otherwise exceed
    # the Win32 260-character limit when CMake/Ninja builds native dependencies.
    $projectGradleHome = Join-Path $repoRoot '.gradle-hub'
    New-Item -ItemType Directory -Path $projectGradleHome -Force | Out-Null
    $env:GRADLE_USER_HOME = $projectGradleHome
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

function Configure-GradleWrapper {
  $wrapperProperties = Join-Path $androidRoot 'gradle\wrapper\gradle-wrapper.properties'
  if (-not (Test-Path $wrapperProperties)) {
    return
  }

  $text = Get-Content $wrapperProperties -Raw -Encoding UTF8
  $text = $text -replace 'networkTimeout=\d+', 'networkTimeout=120000'
  # AGP 8.12 officially targets Gradle 8.13. Gradle 9.3.1 intermittently fails
  # to snapshot Android JDK image transforms on this Windows build host.
  $text = $text -replace 'gradle-[0-9.]+-(?:all|bin)\.zip', 'gradle-8.13-bin.zip'
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
  Set-GradleProperty $gradleProperties 'org.gradle.jvmargs' '-Xmx2048m -XX:MaxMetaspaceSize=1024m'
  Set-GradleProperty $gradleProperties 'org.gradle.parallel' 'false'
  Set-GradleProperty $gradleProperties 'org.gradle.workers.max' '1'
  Set-GradleProperty $gradleProperties 'org.gradle.vfs.watch' 'false'
  Set-GradleProperty $gradleProperties 'kotlin.compiler.execution.strategy' 'in-process'
}

function Initialize-GoogleServicesConfig {
  if (-not $env:EXPO_GOOGLE_SERVICES_FILE) {
    $repoCandidate = Join-Path $repoRoot 'google-services.json'
    if (Test-Path -LiteralPath $repoCandidate -PathType Leaf) {
      $env:EXPO_GOOGLE_SERVICES_FILE = [IO.Path]::GetFullPath($repoCandidate)
    }
  }
  if (-not $env:EXPO_GOOGLE_SERVICES_FILE) {
    throw 'Firebase client config is required. Set EXPO_GOOGLE_SERVICES_FILE or place ignored google-services.json in the repository root.'
  }
  $configPath = [IO.Path]::GetFullPath($env:EXPO_GOOGLE_SERVICES_FILE)
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "Firebase client config was not found: $configPath"
  }
  try {
    $firebaseConfig = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $packages = @($firebaseConfig.client | ForEach-Object { $_.client_info.android_client_info.package_name })
    if ($packages -notcontains 'ru.zsgp.hubit.mobile') {
      throw 'package mismatch'
    }
  } catch {
    throw 'google-services.json is invalid or does not contain ru.zsgp.hubit.mobile.'
  }
  $env:EXPO_GOOGLE_SERVICES_FILE = $configPath
}

function Configure-ReleaseSigning {
  if ($Variant -eq 'debug') {
    return $null
  }

  $requiredNames = @(
    'HUBIT_ANDROID_KEYSTORE_FILE',
    'HUBIT_ANDROID_KEYSTORE_PASSWORD',
    'HUBIT_ANDROID_KEY_ALIAS',
    'HUBIT_ANDROID_KEY_PASSWORD'
  )
  $missing = @($requiredNames | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) })
  if ($missing.Count -gt 0) {
    if ($AllowDebugSigning) {
      Write-Warning 'Building an explicitly allowed debug-signed preview APK. It is not eligible for the stable channel.'
      return $null
    }
    throw 'Permanent release signing is required. Set the four HUBIT_ANDROID_* signing environment variables, or use -AllowDebugSigning only for preview upgrade testing.'
  }

  $keystorePath = [IO.Path]::GetFullPath($env:HUBIT_ANDROID_KEYSTORE_FILE)
  if (-not (Test-Path -LiteralPath $keystorePath -PathType Leaf)) {
    throw "Android release keystore was not found: $keystorePath"
  }
  $keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
  if (-not (Test-Path -LiteralPath $keytool -PathType Leaf)) {
    throw 'keytool was not found in the selected JDK 17.'
  }
  $keytoolOutput = (& $keytool -J-Duser.language=en -list -v -keystore $keystorePath -alias $env:HUBIT_ANDROID_KEY_ALIAS -storepass:env HUBIT_ANDROID_KEYSTORE_PASSWORD 2>&1) -join "`n"
  if ($LASTEXITCODE -ne 0) {
    throw 'Release keystore or alias validation failed.'
  }
  if ($keytoolOutput -notmatch '(?im)^\s*SHA-?256:\s*(?<digest>(?:[0-9A-F]{2}:){31}[0-9A-F]{2})\s*$') {
    throw 'Release signer SHA-256 fingerprint was not found.'
  }
  $expectedSigner = ([string]$Matches.digest -replace ':', '').ToLowerInvariant()

  $buildGradle = Join-Path $androidRoot 'app\build.gradle'
  $text = Get-Content -LiteralPath $buildGradle -Raw -Encoding UTF8
  if ($text -notmatch '(?s)signingConfigs\s*\{\s*debug\s*\{.*?\}\s*\}') {
    throw 'Generated app/build.gradle signingConfigs block was not recognized.'
  }
  $releaseBlock = @'
signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            storeFile file(System.getenv('HUBIT_ANDROID_KEYSTORE_FILE'))
            storePassword System.getenv('HUBIT_ANDROID_KEYSTORE_PASSWORD')
            keyAlias System.getenv('HUBIT_ANDROID_KEY_ALIAS')
            keyPassword System.getenv('HUBIT_ANDROID_KEY_PASSWORD')
            enableV1Signing true
            enableV2Signing true
        }
    }
'@
  $text = [regex]::Replace(
    $text,
    '(?s)signingConfigs\s*\{\s*debug\s*\{.*?\}\s*\}',
    $releaseBlock,
    1)
  $text = $text -replace 'signingConfig signingConfigs\.debug(?=\r?\n\s*def enableShrinkResources)', 'signingConfig signingConfigs.release'
  Write-Utf8NoBom $buildGradle $text
  return $expectedSigner
}

function Find-AndroidBuildTool($name) {
  $buildToolsRoot = Join-Path $env:ANDROID_HOME 'build-tools'
  $candidate = Get-ChildItem -LiteralPath $buildToolsRoot -Directory |
    Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending |
    ForEach-Object { Join-Path $_.FullName $name } |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
  if (-not $candidate) { throw "Android build tool was not found: $name" }
  return $candidate
}

function Write-ApkAudit($apkPath, $artifactName, $expectedSigner) {
  $aapt = Find-AndroidBuildTool 'aapt.exe'
  $badging = (& $aapt dump badging $apkPath 2>&1) -join "`n"
  if ($LASTEXITCODE -ne 0 -or $badging -notmatch "package: name='(?<package>[^']+)' versionCode='(?<code>\d+)' versionName='(?<version>[^']+)'") {
    throw 'Built APK identity audit failed.'
  }
  $packageName = [string]$Matches.package
  $versionCode = [int]$Matches.code
  $versionName = [string]$Matches.version
  if ($packageName -ne 'ru.zsgp.hubit.mobile') { throw "Unexpected APK package: $packageName" }
  $abiMatches = [regex]::Matches($badging, "(?m)^native-code:\s*(?<values>.+)$")
  $abis = @()
  foreach ($abiMatch in $abiMatches) {
    $abis += [regex]::Matches($abiMatch.Groups['values'].Value, "'(?<abi>[^']+)'") |
      ForEach-Object { $_.Groups['abi'].Value }
  }
  $abis = @($abis | Sort-Object -Unique)
  if ($Variant -eq 'preview' -and @($abis | Where-Object { $_ -match '^x86' }).Count -gt 0) {
    throw 'Preview APK contains emulator-only x86 ABI libraries.'
  }

  $apksigner = Find-AndroidBuildTool 'apksigner.bat'
  $signerOutput = (& $apksigner verify --verbose --print-certs $apkPath 2>&1) -join "`n"
  if ($LASTEXITCODE -ne 0 -or $signerOutput -notmatch '(?im)Verified using v2 scheme[^:]*:\s*true') {
    throw 'Built APK Android v2 signature audit failed.'
  }
  if ($signerOutput -notmatch '(?im)certificate SHA-256 digest:\s*(?<digest>[0-9a-f]{64})') {
    throw 'Built APK signer fingerprint was not found.'
  }
  $signer = [string]$Matches.digest.ToLowerInvariant()
  if ($expectedSigner -and $signer -ne $expectedSigner) {
    throw 'Built APK signer does not match the configured permanent release key.'
  }

  $item = Get-Item -LiteralPath $apkPath
  $maxApkBytes = if ($env:HUBIT_ANDROID_MAX_APK_BYTES) {
    [long]$env:HUBIT_ANDROID_MAX_APK_BYTES
  } else {
    90MB
  }
  if ($Variant -eq 'preview' -and $item.Length -gt $maxApkBytes) {
    throw "Preview APK size $($item.Length) exceeds the release budget $maxApkBytes bytes."
  }
  $audit = [ordered]@{
    schema_version = 1
    artifact = $artifactName
    package_name = $packageName
    version = $versionName
    version_code = $versionCode
    size_bytes = $item.Length
    sha256 = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
    signer_sha256 = $signer
    signing = if ($expectedSigner) { 'release' } else { 'debug-preview' }
    abis = $abis
    minified = $Variant -eq 'preview'
    resource_shrinking = $Variant -eq 'preview'
    audited_at = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
  }
  $auditPath = Join-Path $item.DirectoryName ($item.BaseName + '.audit.json')
  Write-Utf8NoBom $auditPath ($audit | ConvertTo-Json -Depth 3)
  Write-Host "Audit: $auditPath" -ForegroundColor Green
}

Set-Location $root
$env:CI = '1'
$env:NODE_ENV = 'production'
Initialize-GoogleServicesConfig

$releaseSigningNames = @(
  'HUBIT_ANDROID_KEYSTORE_FILE',
  'HUBIT_ANDROID_KEYSTORE_PASSWORD',
  'HUBIT_ANDROID_KEY_ALIAS',
  'HUBIT_ANDROID_KEY_PASSWORD'
)
$releaseSigningConfigured = @(
  $releaseSigningNames |
    Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }
).Count -eq 0
if ($Local -and ($Variant -eq 'debug' -or -not $releaseSigningConfigured)) {
  if ($env:HUBIT_ANDROID_ENABLE_APP_LINKS -eq '1') {
    throw 'HTTPS App Links require permanent release signing and a matching production assetlinks.json.'
  }
  $env:HUBIT_ANDROID_ENABLE_APP_LINKS = '0'
}

if (-not $Local -and -not $Eas) {
  $Eas = $true
}

if ($Eas -and -not $env:EXPO_EAS_PROJECT_ID) {
  throw 'Set EXPO_EAS_PROJECT_ID to the UUID created by eas init before a non-interactive EAS build.'
}

Write-Step "Generate icon and splash assets"
python (Join-Path $PSScriptRoot 'generate-assets.py')
if ($LASTEXITCODE -ne 0) {
  throw "Asset generation failed with exit code $LASTEXITCODE"
}

if ($Local -and -not $SkipPrebuild) {
  Write-Step "Sync native Android project from app.config.ts"
  npx expo prebuild --platform android --clean
  if ($LASTEXITCODE -ne 0) {
    $prebuildExitCode = $LASTEXITCODE
    if (Test-Path -LiteralPath $androidRoot -PathType Container) {
      if (Test-AndroidProject $androidRoot) {
        throw "expo prebuild failed with exit code $prebuildExitCode; the existing Android project is complete and was left untouched."
      }
      $staleAndroidRoot = Join-Path $root ("android-stale-" + [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmss'))
      Write-Warning "Incomplete Android project could not be cleaned; preserving it at $staleAndroidRoot and retrying."
      Move-Item -LiteralPath $androidRoot -Destination $staleAndroidRoot
      npx expo prebuild --platform android --clean
    }
    if ($LASTEXITCODE -ne 0) {
      throw "expo prebuild failed with exit code $LASTEXITCODE"
    }
  }

}

if ($Local) {
  Use-BundledJdk
  Use-AndroidSdk
  Use-GradleHome

  if (-not (Test-AndroidProject $androidRoot)) {
    throw 'expo prebuild finished without a complete Android project.'
  }

  Configure-GradleWrapper
  Patch-GradleWindowsSettings
  $cmakeDir = Use-RepoCmake
  Ensure-AndroidLocalProperties $cmakeDir
  $expectedSigner = Configure-ReleaseSigning
  $gradleTask = if ($Variant -eq 'debug') { ':app:assembleDebug' } else { ':app:assembleRelease' }
  $outputVariant = if ($Variant -eq 'debug') { 'debug' } else { 'release' }
  $artifactSuffix = if ($Architectures -eq 'arm64') { '-arm64' } else { '' }
  $artifactName = if ($Variant -eq 'debug') { "hubit-mobile-debug$artifactSuffix.apk" } else { "hubit-mobile-preview$artifactSuffix.apk" }
  $gradleArguments = @($gradleTask, '--no-daemon', '--no-watch-fs', '--stacktrace', '--max-workers=1')
  if ($Architectures -eq 'arm64') {
    $gradleArguments += '-PreactNativeArchitectures=arm64-v8a'
  }

  Write-Step "Local $Variant APK build ($gradleTask)"
  Push-Location $androidRoot
  try {
    .\gradlew.bat @gradleArguments
    if ($LASTEXITCODE -ne 0) {
      throw "gradlew $gradleTask failed with exit code $LASTEXITCODE"
    }

    $apk = Get-ChildItem -Path "app\build\outputs\apk\$outputVariant" -Filter '*.apk' -Recurse | Select-Object -First 1
    if ($apk) {
      $out = Join-Path $root 'dist'
      New-Item -ItemType Directory -Path $out -Force | Out-Null
      $dest = Join-Path $out $artifactName
      Copy-Item $apk.FullName $dest -Force
      Write-ApkAudit $dest $artifactName $expectedSigner
      Write-Host "`nAPK: $dest" -ForegroundColor Green
    } else {
      throw "$gradleTask finished, but no $outputVariant APK was found."
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
  if ($LASTEXITCODE -ne 0) {
    throw "EAS build failed with exit code $LASTEXITCODE"
  }
  Write-Host 'After the build finishes, list/download it with: npx eas-cli build:list' -ForegroundColor Gray
}
