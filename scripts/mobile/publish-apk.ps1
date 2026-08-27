[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$IisUpdateRoot,
    [string]$ApkPath,
    [string]$Version,
    [ValidateRange(0, 2147483647)]
    [int]$VersionCode = 0,
    [string]$PackageName = 'ru.zsgp.hubit.mobile',
    [ValidateRange(24, 100)]
    [int]$MinSdk = 24,
    [ValidateRange(1, 2147483647)]
    [int]$MinSupportedVersionCode = 1,
    [string[]]$Changelog = @(),
    [string]$ExpectedSignerSHA256 = '',
    [switch]$AllowDebugPreviewSigner,
    [switch]$AllowSignerRotation,
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$mobileRoot = Join-Path $repoRoot 'mobile-hub'
$packageJsonPath = Join-Path $mobileRoot 'package.json'
$packageJson = Get-Content -Raw -LiteralPath $packageJsonPath | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = [string]$packageJson.version
}
if ([string]::IsNullOrWhiteSpace($ApkPath)) {
    $ApkPath = Join-Path $mobileRoot 'dist\hubit-mobile-preview.apk'
}

$releaseNotesPath = Join-Path $mobileRoot "release-notes\$Version.json"
if (Test-Path -LiteralPath $releaseNotesPath -PathType Leaf) {
    $releaseNotes = Get-Content -Raw -LiteralPath $releaseNotesPath -Encoding UTF8 | ConvertFrom-Json
    if ([string]$releaseNotes.version -ne $Version) {
        throw "Release notes version does not match: $releaseNotesPath"
    }
    if ($VersionCode -le 0 -and $releaseNotes.version_code) {
        $VersionCode = [int]$releaseNotes.version_code
    }
    if ($Changelog.Count -eq 0 -and $releaseNotes.changelog) {
        $Changelog = @($releaseNotes.changelog | ForEach-Object { [string]$_ })
    }
}

if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
    throw "Mobile version must use major.minor.patch: $Version"
}
if ($PackageName -ne 'ru.zsgp.hubit.mobile') {
    throw "Unexpected Android package name: $PackageName"
}
if ($Changelog.Count -lt 1 -or $Changelog.Count -gt 8) {
    throw 'Schema v2 requires 1-8 changelog items.'
}
foreach ($item in $Changelog) {
    if ([string]::IsNullOrWhiteSpace($item) -or $item.Trim().Length -gt 240 -or $item -match '[\x00-\x1f\x7f]') {
        throw 'Each changelog item must contain 1-240 printable characters.'
    }
}
if (-not (Test-Path -LiteralPath $ApkPath -PathType Leaf)) {
    throw "Mobile APK is missing: $ApkPath"
}

$resolvedApkPath = (Resolve-Path -LiteralPath $ApkPath).Path
$apk = Get-Item -LiteralPath $resolvedApkPath
if ($apk.Length -le 0 -or $apk.Length -gt 250MB) {
    throw "Mobile APK size is outside the 250 MiB preview limit: $($apk.Length)"
}

function Find-AndroidBuildTool([string]$Name) {
    $roots = @()
    if ($env:HUBIT_ANDROID_SDK_ROOT) { $roots += $env:HUBIT_ANDROID_SDK_ROOT }
    if ($env:ANDROID_HOME) { $roots += $env:ANDROID_HOME }
    if ($env:ANDROID_SDK_ROOT) { $roots += $env:ANDROID_SDK_ROOT }
    if ($env:LOCALAPPDATA) { $roots += (Join-Path $env:LOCALAPPDATA 'Android\Sdk') }
    foreach ($root in @($roots | Select-Object -Unique)) {
        $buildToolsRoot = Join-Path $root 'build-tools'
        if (-not (Test-Path -LiteralPath $buildToolsRoot -PathType Container)) { continue }
        $candidate = Get-ChildItem -LiteralPath $buildToolsRoot -Directory |
            Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending |
            ForEach-Object { Join-Path $_.FullName $Name } |
            Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
            Select-Object -First 1
        if ($candidate) { return $candidate }
    }
    throw "Android build tool was not found: $Name"
}

$aaptPath = Find-AndroidBuildTool 'aapt.exe'
$badgingOutput = (& $aaptPath dump badging $resolvedApkPath 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'aapt could not inspect the APK.' }
if ($badgingOutput -notmatch "package: name='(?<package>[^']+)' versionCode='(?<code>\d+)' versionName='(?<version>[^']+)'") {
    throw 'aapt output does not contain package/version metadata.'
}
$artifactPackage = [string]$Matches.package
$artifactVersionCode = [int]$Matches.code
$artifactVersion = [string]$Matches.version
if ($artifactPackage -ne $PackageName -or $artifactVersion -ne $Version) {
    throw "APK identity mismatch: $artifactPackage $artifactVersion ($artifactVersionCode)"
}
if ($VersionCode -le 0) { $VersionCode = $artifactVersionCode }
if ($VersionCode -ne $artifactVersionCode) {
    throw "APK versionCode mismatch: expected $VersionCode, actual $artifactVersionCode"
}
if ($badgingOutput -match "sdkVersion:'(?<sdk>\d+)'") {
    $artifactMinSdk = [int]$Matches.sdk
    if ($artifactMinSdk -ne $MinSdk) {
        throw "APK minSdk mismatch: expected $MinSdk, actual $artifactMinSdk"
    }
}
if ($MinSupportedVersionCode -gt $VersionCode) {
    throw 'min_supported_version_code cannot exceed version_code.'
}

$apksignerPath = Find-AndroidBuildTool 'apksigner.bat'
$signerOutput = (& $apksignerPath verify --verbose --print-certs $resolvedApkPath 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
if ($signerOutput -notmatch '(?im)Verified using v2 scheme[^:]*:\s*true') {
    throw 'APK must contain an Android v2 signature.'
}
if ($signerOutput -notmatch '(?im)certificate SHA-256 digest:\s*(?<digest>[0-9a-f]{64})') {
    throw 'APK signer SHA-256 digest was not found.'
}
$signerSha256 = [string]$Matches.digest.ToLowerInvariant()
$ExpectedSignerSHA256 = if ([string]::IsNullOrWhiteSpace($ExpectedSignerSHA256)) {
    [string]$env:HUBIT_ANDROID_EXPECTED_SIGNER_SHA256
} else {
    $ExpectedSignerSHA256
}
$ExpectedSignerSHA256 = $ExpectedSignerSHA256.Trim().ToLowerInvariant()
if ($ExpectedSignerSHA256 -and $ExpectedSignerSHA256 -notmatch '^[0-9a-f]{64}$') {
    throw 'ExpectedSignerSHA256 must contain exactly 64 hexadecimal characters.'
}
if ($ExpectedSignerSHA256 -and $signerSha256 -ne $ExpectedSignerSHA256) {
    throw 'APK signer does not match ExpectedSignerSHA256.'
}
if ($AllowSignerRotation -and -not $ExpectedSignerSHA256) {
    throw 'Signer rotation requires an explicit ExpectedSignerSHA256 for the new permanent key.'
}

$channel = 'preview'
$apkName = "HUB-IT-Mobile-Preview-$Version.apk"
$relativePath = "mobile/$channel/$Version/$apkName"
$sha256 = (Get-FileHash -LiteralPath $resolvedApkPath -Algorithm SHA256).Hash.ToLowerInvariant()
$auditPath = Join-Path $apk.DirectoryName ($apk.BaseName + '.audit.json')
if (-not (Test-Path -LiteralPath $auditPath -PathType Leaf)) {
    throw "APK build audit is required before publication: $auditPath"
}
try {
    $audit = Get-Content -LiteralPath $auditPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    throw 'APK build audit is not valid JSON.'
}
$auditSigning = [string]$audit.signing
if ($auditSigning -notin @('release', 'debug-preview')) {
    throw 'APK build audit has an unknown signing mode.'
}
if (
    [string]$audit.package_name -ne $artifactPackage -or
    [string]$audit.version -ne $artifactVersion -or
    [int]$audit.version_code -ne $artifactVersionCode -or
    [long]$audit.size_bytes -ne $apk.Length -or
    ([string]$audit.sha256).ToLowerInvariant() -ne $sha256 -or
    ([string]$audit.signer_sha256).ToLowerInvariant() -ne $signerSha256
) {
    throw 'APK build audit does not match the selected artifact.'
}
if ($auditSigning -eq 'debug-preview' -and -not $AllowDebugPreviewSigner) {
    throw 'Debug-preview signing is blocked. Use a permanent release key, or pass -AllowDebugPreviewSigner only for an explicitly approved compatibility build.'
}
$publishedAt = [DateTimeOffset]::UtcNow.ToString(
    "yyyy-MM-dd'T'HH:mm:ss'Z'",
    [Globalization.CultureInfo]::InvariantCulture)
$manifest = [ordered]@{
    schema_version = 2
    channel = $channel
    version = $Version
    version_code = $VersionCode
    published_at = $publishedAt
    relative_path = $relativePath
    size_bytes = $apk.Length
    sha256 = $sha256
    package_name = $PackageName
    min_sdk = $MinSdk
    min_supported_version_code = $MinSupportedVersionCode
    changelog = @($Changelog | ForEach-Object { $_.Trim() })
    signer_sha256 = $signerSha256
}
$manifestJson = $manifest | ConvertTo-Json -Depth 3
$manifestBytes = [Text.Encoding]::UTF8.GetBytes($manifestJson)
if ($manifestBytes.Length -gt 16KB) {
    throw 'Mobile preview manifest exceeds 16 KiB.'
}

$result = [pscustomobject]@{
    Channel = $channel
    Version = $Version
    VersionCode = $VersionCode
    SourceApk = $resolvedApkPath
    RelativePath = $relativePath
    SizeMiB = [math]::Round($apk.Length / 1MB, 2)
    SHA256 = $sha256
    PackageName = $PackageName
    MinSdk = $MinSdk
    MinSupportedVersionCode = $MinSupportedVersionCode
    SignerSHA256 = $signerSha256
    Signing = $auditSigning
    ValidateOnly = [bool]$ValidateOnly
}
if ($ValidateOnly) {
    return $result
}

if ([string]::IsNullOrWhiteSpace($IisUpdateRoot)) {
    throw 'IisUpdateRoot is required unless -ValidateOnly is used.'
}

if (-not (Test-Path -LiteralPath $IisUpdateRoot -PathType Container)) {
    throw "IIS update root does not exist: $IisUpdateRoot"
}
$resolvedIisRoot = (Resolve-Path -LiteralPath $IisUpdateRoot).Path

function Assert-ChildPath([string]$Parent, [string]$Path) {
    $fullParent = [IO.Path]::GetFullPath($Parent).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar)
    $fullPath = [IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith(
        $fullParent + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe child path: $fullPath"
    }
}

$mobileFeedRoot = Join-Path $resolvedIisRoot 'mobile'
$channelRoot = Join-Path $mobileFeedRoot $channel
$finalVersionDirectory = Join-Path $channelRoot $Version
$stagingDirectory = Join-Path $mobileFeedRoot ('.staging-' + [Guid]::NewGuid().ToString('N'))
Assert-ChildPath $resolvedIisRoot $mobileFeedRoot
Assert-ChildPath $resolvedIisRoot $channelRoot
Assert-ChildPath $resolvedIisRoot $finalVersionDirectory
Assert-ChildPath $resolvedIisRoot $stagingDirectory

$currentLatestPath = Join-Path $channelRoot 'latest.json'
if (Test-Path -LiteralPath $currentLatestPath -PathType Leaf) {
    try {
        $currentManifest = Get-Content -LiteralPath $currentLatestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $currentSigner = ([string]$currentManifest.signer_sha256).Trim().ToLowerInvariant()
    } catch {
        throw 'Current mobile preview manifest is invalid; signer continuity cannot be verified.'
    }
    if ($currentSigner -notmatch '^[0-9a-f]{64}$') {
        throw 'Current mobile preview manifest does not contain a valid signer fingerprint.'
    }
    if ($currentSigner -ne $signerSha256) {
        if (-not $AllowSignerRotation) {
            throw 'APK signer differs from the current preview channel. Signer rotation requires explicit -AllowSignerRotation and ExpectedSignerSHA256.'
        }
        if ($ExpectedSignerSHA256 -ne $signerSha256) {
            throw 'Signer rotation fingerprint does not match the selected APK.'
        }
    }
} elseif (-not $ExpectedSignerSHA256) {
    throw 'A new preview channel requires explicit ExpectedSignerSHA256.'
}

if (Test-Path -LiteralPath $finalVersionDirectory) {
    throw "Mobile preview version is already published: $finalVersionDirectory"
}
if (-not $PSCmdlet.ShouldProcess($finalVersionDirectory, 'Publish HUB-IT Mobile preview APK and latest manifest')) {
    return $result
}

New-Item -ItemType Directory -Path $mobileFeedRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null
try {
    $stagedApk = Join-Path $stagingDirectory $apkName
    Copy-Item -LiteralPath $resolvedApkPath -Destination $stagedApk
    $stagedSha256 = (Get-FileHash -LiteralPath $stagedApk -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($stagedSha256 -ne $sha256) {
        throw 'Staged APK hash does not match the source APK.'
    }
    [IO.File]::WriteAllText(
        (Join-Path $stagingDirectory 'manifest.json'),
        $manifestJson,
        [Text.UTF8Encoding]::new($false))

    New-Item -ItemType Directory -Path $channelRoot -Force | Out-Null
    Move-Item -LiteralPath $stagingDirectory -Destination $finalVersionDirectory
    $latestTemporaryPath = Join-Path $channelRoot 'latest.json.tmp'
    $latestPath = Join-Path $channelRoot 'latest.json'
    if (Test-Path -LiteralPath $latestPath -PathType Leaf) {
        $historyRoot = Join-Path $channelRoot '.manifest-history'
        New-Item -ItemType Directory -Path $historyRoot -Force | Out-Null
        $historyName = 'latest-' + [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N') + '.json'
        Copy-Item -LiteralPath $latestPath -Destination (Join-Path $historyRoot $historyName)
    }
    [IO.File]::WriteAllText(
        $latestTemporaryPath,
        $manifestJson,
        [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $latestTemporaryPath -Destination $latestPath -Force
}
finally {
    if (Test-Path -LiteralPath $stagingDirectory) {
        Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
    }
}

return [pscustomobject]@{
    Channel = $channel
    Version = $Version
    VersionCode = $VersionCode
    Manifest = Join-Path $channelRoot 'latest.json'
    Apk = Join-Path $finalVersionDirectory $apkName
    RelativePath = $relativePath
    SizeMiB = [math]::Round($apk.Length / 1MB, 2)
    SHA256 = $sha256
    PackageName = $PackageName
    MinSdk = $MinSdk
    MinSupportedVersionCode = $MinSupportedVersionCode
    SignerSHA256 = $signerSha256
    Signing = $auditSigning
    ValidateOnly = $false
}
