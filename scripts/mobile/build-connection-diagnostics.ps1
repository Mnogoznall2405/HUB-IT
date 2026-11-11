param(
  [string]$ToolchainRoot,
  [switch]$TestOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $ToolchainRoot) { $ToolchainRoot = Join-Path $repoRoot 'tools\android-diagnostics' }
$sourceRoot = Join-Path $repoRoot 'mobile-hub\connection-diagnostics'
$jdkRoot = Get-ChildItem -LiteralPath (Join-Path $ToolchainRoot 'jdk17') -Directory | Select-Object -First 1
$java = Join-Path $jdkRoot.FullName 'bin\java.exe'
$javac = Join-Path $jdkRoot.FullName 'bin\javac.exe'
$jar = Join-Path $jdkRoot.FullName 'bin\jar.exe'
$keytool = Join-Path $jdkRoot.FullName 'bin\keytool.exe'
$androidJar = Join-Path $ToolchainRoot 'platform-36\android-36\android.jar'
$buildTools = Join-Path $ToolchainRoot 'build-tools-36\android-16'
foreach ($required in @($java, $javac, $jar, $keytool, $androidJar, (Join-Path $buildTools 'aapt2.exe'))) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Build tool not found: $required" }
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Tool failed: $([IO.Path]::GetFileName($Executable)), exit $LASTEXITCODE" }
}

# Every invocation gets its own workspace; no existing build or user data is removed.
$work = Join-Path $repoRoot ('tmp\connection-diagnostics-' + [guid]::NewGuid().ToString('N'))
$testClasses = Join-Path $work 'test-classes'
New-Item -ItemType Directory -Path $testClasses -Force | Out-Null
$coreSource = Join-Path $sourceRoot 'src\ru\zsgp\hubit\connectiondiagnostics\ConnectionProbe.java'
$testSource = Join-Path $sourceRoot 'test\ru\zsgp\hubit\connectiondiagnostics\ConnectionProbeTest.java'
Invoke-Checked $javac @('-encoding', 'UTF-8', '-d', $testClasses, $coreSource, $testSource)
Invoke-Checked $java @('-cp', $testClasses, 'ru.zsgp.hubit.connectiondiagnostics.ConnectionProbeTest')
if ($TestOnly) { return }

$classes = Join-Path $work 'classes'
$dex = Join-Path $work 'dex'
New-Item -ItemType Directory -Path $classes, $dex -Force | Out-Null
$sources = @(Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'src') -Filter '*.java' -Recurse | ForEach-Object FullName)
$androidBootClasspath = (Join-Path $buildTools 'core-lambda-stubs.jar') + [IO.Path]::PathSeparator + $androidJar
Invoke-Checked $javac (@('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-bootclasspath', $androidBootClasspath, '-d', $classes) + $sources)
$classJar = Join-Path $work 'classes.jar'
Invoke-Checked $jar @('--create', '--file', $classJar, '-C', $classes, '.')
Invoke-Checked $java @('-cp', (Join-Path $buildTools 'lib\d8.jar'), 'com.android.tools.r8.D8', '--lib', $androidJar, '--min-api', '26', '--output', $dex, $classJar)
$unsigned = Join-Path $work 'unsigned.apk'
$resourceZip = Join-Path $work 'resources.zip'
Invoke-Checked (Join-Path $buildTools 'aapt2.exe') @('compile', '--dir', (Join-Path $sourceRoot 'res'), '-o', $resourceZip)
Invoke-Checked (Join-Path $buildTools 'aapt2.exe') @('link', '--manifest', (Join-Path $sourceRoot 'AndroidManifest.xml'), '-I', $androidJar, '-o', $unsigned, $resourceZip)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open($unsigned, [IO.Compression.ZipArchiveMode]::Update)
try { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $dex 'classes.dex'), 'classes.dex') | Out-Null }
finally { $zip.Dispose() }
$aligned = Join-Path $work 'aligned.apk'
Invoke-Checked (Join-Path $buildTools 'zipalign.exe') @('-p', '4', $unsigned, $aligned)

# This key belongs only to the separate diagnostics package. Password stays in DPAPI/env.
$signing = Join-Path $ToolchainRoot 'signing'
New-Item -ItemType Directory -Path $signing -Force | Out-Null
$keyFile = Join-Path $signing 'connection-diagnostics.p12'
$protectedPasswordFile = Join-Path $signing 'connection-diagnostics.password.dpapi'
if ((Test-Path -LiteralPath $keyFile) -and -not (Test-Path -LiteralPath $protectedPasswordFile)) {
  throw 'Diagnostics signing key exists without its protected password; it was left untouched.'
}
if (-not (Test-Path -LiteralPath $protectedPasswordFile)) {
  $randomBytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($randomBytes) } finally { $rng.Dispose() }
  $securePassword = ConvertTo-SecureString ([Convert]::ToBase64String($randomBytes)) -AsPlainText -Force
  $protectedPassword = ConvertFrom-SecureString $securePassword
  Set-Content -LiteralPath $protectedPasswordFile -Value $protectedPassword -Encoding ASCII
}
$securePassword = (Get-Content -LiteralPath $protectedPasswordFile -Raw).Trim() | ConvertTo-SecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$previousPassword = [Environment]::GetEnvironmentVariable('HUBIT_DIAGNOSTIC_SIGNING_PASSWORD')
try {
  $env:HUBIT_DIAGNOSTIC_SIGNING_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if (-not (Test-Path -LiteralPath $keyFile)) {
    Invoke-Checked $keytool @('-genkeypair', '-keystore', $keyFile, '-storetype', 'PKCS12', '-storepass:env', 'HUBIT_DIAGNOSTIC_SIGNING_PASSWORD', '-alias', 'connection-diagnostics', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '3650', '-dname', 'CN=HUB-IT Connection Diagnostics, O=HUB-IT, C=RU', '-noprompt')
  }
  $outputRoot = Join-Path $repoRoot 'artifacts\mobile\connection-diagnostics'
  New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
  $apk = Join-Path $outputRoot 'HUB-IT-Connection-Diagnostics-1.0.0.apk'
  Invoke-Checked $java @('-jar', (Join-Path $buildTools 'lib\apksigner.jar'), 'sign', '--ks', $keyFile, '--ks-key-alias', 'connection-diagnostics', '--ks-pass', 'env:HUBIT_DIAGNOSTIC_SIGNING_PASSWORD', '--out', $apk, $aligned)
} finally {
  [Environment]::SetEnvironmentVariable('HUBIT_DIAGNOSTIC_SIGNING_PASSWORD', $previousPassword)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}
Invoke-Checked $java @('-jar', (Join-Path $buildTools 'lib\apksigner.jar'), 'verify', '--verbose', '--print-certs', $apk)
Invoke-Checked (Join-Path $buildTools 'zipalign.exe') @('-c', '4', $apk)
Invoke-Checked (Join-Path $buildTools 'aapt.exe') @('dump', 'badging', $apk)
$audit = [ordered]@{
  package = 'ru.zsgp.hubit.connectiondiagnostics'
  version = '1.0.0'
  versionCode = 1
  minAndroidApi = 26
  targetAndroidApi = 36
  sizeBytes = (Get-Item -LiteralPath $apk).Length
  sha256 = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
  generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
  deviceAcceptance = 'not_run'
}
$audit | ConvertTo-Json | Set-Content -LiteralPath ($apk + '.audit.json') -Encoding UTF8
Write-Output "APK: $apk"
$audit | ConvertTo-Json
