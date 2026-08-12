[CmdletBinding()]
param(
    [ValidateSet('Release')]
    [string]$Configuration = 'Release',
    [Parameter(Mandatory)]
    [string]$IisUpdateRoot,
    [string]$SigningCertificateThumbprint = '0A9CFEF49EB1E11819D81A351978BAFA05EF7CBE',
    [string]$SigningKeyId = 'hubit-zsgp-ru-tls-2026-04',
    [ValidateCount(1, 10)]
    [string[]]$ReleaseNotes = @('Обновление HUB Desktop'),
    [switch]$NoBuild,
    [switch]$NoRestore,
    [switch]$ValidateSigningCertificateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$projectPath = Join-Path $repoRoot 'desktop\Hub.Desktop\Hub.Desktop.csproj'
$buildScript = Join-Path $repoRoot 'scripts\desktop\build-installer.ps1'
$generateSbomScript = Join-Path $repoRoot 'scripts\desktop\generate-sbom.ps1'
$validateReleaseScript = Join-Path $repoRoot 'scripts\desktop\validate-release.ps1'
$payloadSignerScript = Join-Path $repoRoot 'scripts\desktop\sign-update-payload.ps1'
$projectDocument = [xml](Get-Content -Raw -LiteralPath $projectPath)
$version = $projectDocument.SelectSingleNode('/Project/PropertyGroup/Version').InnerText
$targetFramework = $projectDocument.SelectSingleNode('/Project/PropertyGroup/TargetFramework').InnerText
$runtimeIdentifier = 'win-x64'
$packageDirectory = Join-Path (Split-Path -Parent $projectPath) "bin\$Configuration\$targetFramework\$runtimeIdentifier\package"
$setupName = "HUB-Desktop-Setup-$version-$runtimeIdentifier.exe"
$setupPath = Join-Path $packageDirectory $setupName
$channel = 'stable'
$relativePath = "$channel/$version/$setupName"
$signingCertificateStore = 'Cert:\LocalMachine\My'
$normalizedSigningThumbprint = $SigningCertificateThumbprint.Replace(' ', '').ToUpperInvariant()

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

function Get-ValidatedSigningCertificate {
    if ($normalizedSigningThumbprint -notmatch '^[0-9A-F]{40}$') {
        throw 'Signing certificate thumbprint must contain exactly 40 hexadecimal characters.'
    }

    if ($SigningKeyId -notmatch '^[A-Za-z0-9._-]{1,64}$') {
        throw 'Signing key id has an invalid format.'
    }

    $certificatePath = Join-Path $signingCertificateStore $normalizedSigningThumbprint
    $certificate = Get-Item -LiteralPath $certificatePath -ErrorAction Stop
    if (-not $certificate.Thumbprint.Equals(
            $normalizedSigningThumbprint,
            [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The selected signing certificate thumbprint does not match the requested thumbprint.'
    }

    $dnsNames = @($certificate.DnsNameList | ForEach-Object { $_.Unicode })
    if ($dnsNames -notcontains '*.zsgp.ru' -and $dnsNames -notcontains 'hubit.zsgp.ru') {
        throw 'The selected signing certificate does not cover hubit.zsgp.ru.'
    }

    if ($certificate.Subject.Equals($certificate.Issuer, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'A self-signed certificate cannot be used as the production TLS signing certificate.'
    }

    $now = [DateTime]::UtcNow
    if ($certificate.NotBefore.ToUniversalTime() -gt $now) {
        throw 'The selected signing certificate is not valid yet.'
    }
    if ($certificate.NotAfter.ToUniversalTime() -le $now.AddDays(30)) {
        throw 'The selected signing certificate expires in 30 days or less; rotate trust before publishing.'
    }

    $ekuExtension = @($certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' })
    if ($ekuExtension.Count -ne 1 -or
        -not @($ekuExtension[0].EnhancedKeyUsages | ForEach-Object { $_.Value }).Contains(
            '1.3.6.1.5.5.7.3.1')) {
        throw 'The selected signing certificate is not valid for TLS server authentication.'
    }

    if (-not $certificate.HasPrivateKey) {
        throw 'Desktop update signing certificate has no private key.'
    }

    return $certificate
}

function Invoke-PayloadSigner([byte[]]$Data) {
    $payloadBase64 = [Convert]::ToBase64String($Data)
    $signatureOutput = & powershell -NoProfile -ExecutionPolicy Bypass `
        -File $payloadSignerScript `
        -SigningCertificateThumbprint $normalizedSigningThumbprint `
        -PayloadBase64 $payloadBase64
    if ($LASTEXITCODE -ne 0) {
        throw "Production TLS payload signer failed with exit code $LASTEXITCODE"
    }

    $signatureValue = ([string]$signatureOutput).Trim()
    try {
        $signatureBytes = [Convert]::FromBase64String($signatureValue)
    }
    catch [FormatException] {
        throw 'Production TLS payload signer returned an invalid signature.'
    }
    if ($signatureBytes.Length -le 0 -or $signatureBytes.Length -gt 2048) {
        throw 'Production TLS payload signer returned a signature outside the allowed size.'
    }

    return $signatureValue
}

function New-ManifestSignature([byte[]]$Data) {
    $manifestCertificate = Get-ValidatedSigningCertificate
    $value = Invoke-PayloadSigner $Data
    return [pscustomobject]@{
        Value = $value
        Thumbprint = $manifestCertificate.Thumbprint
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

if ($ValidateSigningCertificateOnly) {
    $certificate = Get-ValidatedSigningCertificate
    $probe = [Text.Encoding]::UTF8.GetBytes('hub-desktop-update-signing-probe-v1')
    $rsaPssValidated = -not [string]::IsNullOrWhiteSpace((Invoke-PayloadSigner $probe))
    [pscustomobject]@{
        KeyId = $SigningKeyId
        Store = $signingCertificateStore
        Subject = $certificate.Subject
        Issuer = $certificate.Issuer
        Thumbprint = $certificate.Thumbprint
        NotAfterUtc = $certificate.NotAfter.ToUniversalTime()
        HasPrivateKey = $certificate.HasPrivateKey
        RsaPssValidated = $rsaPssValidated
    }
    return
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

& $generateSbomScript -Configuration $Configuration
& $validateReleaseScript -Configuration $Configuration

if (-not (Test-Path -LiteralPath $setupPath -PathType Leaf)) {
    throw "Desktop Setup is missing: $setupPath"
}

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
        $SigningKeyId
    ) -join "`n"
    $canonicalBytes = [Text.Encoding]::UTF8.GetBytes($canonical)
    $manifestSignature = New-ManifestSignature $canonicalBytes
    $signatureValue = $manifestSignature.Value

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
            key_id = $SigningKeyId
            value = $signatureValue
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
    SigningCertificate = $manifestSignature.Thumbprint
}
