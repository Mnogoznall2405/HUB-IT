[CmdletBinding()]
param(
    [ValidateSet('Release')]
    [string]$Configuration = 'Release',
    [Parameter(Mandatory)]
    [string]$IisUpdateRoot,
    [string]$SigningCertificateThumbprint = '5BAFC4CB42DF2F612705786E689696283BFA592F',
    [ValidateCount(1, 10)]
    [string[]]$ReleaseNotes = @('Обновление HUB Desktop'),
    [switch]$NoBuild,
    [switch]$NoRestore
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$projectPath = Join-Path $repoRoot 'desktop\Hub.Desktop\Hub.Desktop.csproj'
$buildScript = Join-Path $repoRoot 'scripts\desktop\build-installer.ps1'
$projectDocument = [xml](Get-Content -Raw -LiteralPath $projectPath)
$version = $projectDocument.SelectSingleNode('/Project/PropertyGroup/Version').InnerText
$targetFramework = $projectDocument.SelectSingleNode('/Project/PropertyGroup/TargetFramework').InnerText
$runtimeIdentifier = 'win-x64'
$packageDirectory = Join-Path (Split-Path -Parent $projectPath) "bin\$Configuration\$targetFramework\$runtimeIdentifier\package"
$setupName = "HUB-Desktop-Setup-$version-$runtimeIdentifier.exe"
$setupPath = Join-Path $packageDirectory $setupName
$channel = 'stable'
$keyId = 'hub-desktop-update-2026-01'
$relativePath = "$channel/$version/$setupName"

function Assert-ChildPath([string]$Parent, [string]$Path) {
    $fullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar)
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith(
        $fullParent + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe child path: $fullPath"
    }
}

if ($version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
    throw "Desktop version must use major.minor.patch: $version"
}

foreach ($note in $ReleaseNotes) {
    if ([string]::IsNullOrWhiteSpace($note) -or $note.Length -gt 200 -or $note -match '[\x00-\x1F\x7F-\x9F]') {
        throw 'Each release note must contain 1-200 characters without control characters.'
    }
}

if (-not $NoBuild) {
    if ($NoRestore) {
        & $buildScript -NoRestore
    } else {
        & $buildScript
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Desktop installer build failed with exit code $LASTEXITCODE"
    }
}

if (-not (Test-Path -LiteralPath $setupPath -PathType Leaf)) {
    throw "Desktop Setup is missing: $setupPath"
}

$certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$SigningCertificateThumbprint" -ErrorAction Stop
if (-not $certificate.HasPrivateKey) {
    throw 'Desktop update signing certificate has no private key.'
}

$rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($certificate)
if ($null -eq $rsa) {
    throw 'Desktop update signing certificate has no RSA private key.'
}

try {
    $setup = Get-Item -LiteralPath $setupPath
    if ($setup.Length -le 0 -or $setup.Length -gt 500MB) {
        throw "Desktop Setup size is outside the allowed range: $($setup.Length)"
    }

    $sha256 = (Get-FileHash -LiteralPath $setupPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $publishedAt = [DateTimeOffset]::UtcNow.ToString(
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        [Globalization.CultureInfo]::InvariantCulture)
    $notesBytes = [Text.Encoding]::UTF8.GetBytes(($ReleaseNotes -join "`n"))
    $notesHashBytes = [Security.Cryptography.SHA256]::Create().ComputeHash($notesBytes)
    $notesHash = ([BitConverter]::ToString($notesHashBytes)).Replace('-', '').ToLowerInvariant()
    $canonical = @(
        'hub-desktop-update-v1',
        $channel,
        $version,
        $publishedAt,
        $relativePath,
        $setup.Length.ToString([Globalization.CultureInfo]::InvariantCulture),
        $sha256,
        $notesHash,
        'RSA-PSS-SHA256',
        $keyId
    ) -join "`n"
    $canonicalBytes = [Text.Encoding]::UTF8.GetBytes($canonical)
    $signatureBytes = $rsa.SignData(
        $canonicalBytes,
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pss)
    if (-not $rsa.VerifyData(
        $canonicalBytes,
        $signatureBytes,
        [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pss)) {
        throw 'Desktop update manifest signature self-check failed.'
    }

    $manifest = [ordered]@{
        schema_version = 1
        channel = $channel
        version = $version
        published_at = $publishedAt
        relative_path = $relativePath
        size_bytes = $setup.Length
        sha256 = $sha256
        release_notes = @($ReleaseNotes)
        signature = [ordered]@{
            algorithm = 'RSA-PSS-SHA256'
            key_id = $keyId
            value = [Convert]::ToBase64String($signatureBytes)
        }
    }
    $manifestJson = $manifest | ConvertTo-Json -Depth 4
    $manifestBytes = [Text.Encoding]::UTF8.GetBytes($manifestJson)
    if ($manifestBytes.Length -gt 32KB) {
        throw 'Desktop update manifest exceeds 32 KiB.'
    }

    $stableRoot = Join-Path $IisUpdateRoot $channel
    $finalVersionDirectory = Join-Path $stableRoot $version
    $stagingDirectory = Join-Path $IisUpdateRoot ('.staging-' + [Guid]::NewGuid().ToString('N'))
    Assert-ChildPath $IisUpdateRoot $stableRoot
    Assert-ChildPath $IisUpdateRoot $finalVersionDirectory
    Assert-ChildPath $IisUpdateRoot $stagingDirectory
    if (Test-Path -LiteralPath $finalVersionDirectory) {
        throw "Desktop update version is already published: $finalVersionDirectory"
    }

    New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null
    try {
        Copy-Item -LiteralPath $setupPath -Destination (Join-Path $stagingDirectory $setupName)
        [IO.File]::WriteAllText(
            (Join-Path $stagingDirectory 'manifest.json'),
            $manifestJson,
            [Text.UTF8Encoding]::new($false))

        New-Item -ItemType Directory -Path $stableRoot -Force | Out-Null
        Move-Item -LiteralPath $stagingDirectory -Destination $finalVersionDirectory
        $latestTemporaryPath = Join-Path $stableRoot 'latest.json.tmp'
        $latestPath = Join-Path $stableRoot 'latest.json'
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

    [pscustomobject]@{
        Version = $version
        Manifest = Join-Path $stableRoot 'latest.json'
        Setup = Join-Path $finalVersionDirectory $setupName
        SizeMiB = [math]::Round($setup.Length / 1MB, 2)
        SHA256 = $sha256
        SigningCertificate = $certificate.Thumbprint
    }
}
finally {
    $rsa.Dispose()
}
