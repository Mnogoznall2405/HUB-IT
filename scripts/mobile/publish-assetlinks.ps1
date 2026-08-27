[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$SignerSHA256 = '',
    [string]$WebRoot = '',
    [string]$ReleaseAuditPath = '',
    [string]$ExistingAssetLinksPath = '',
    [string]$BackupRoot = 'C:\ProgramData\HUB-IT\Backups\IIS',
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$packageName = 'ru.zsgp.hubit.mobile'
$blockedDebugSigner = 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c'

function Normalize-SignerFingerprint([string]$Value) {
    $normalized = ($Value.Trim() -replace ':', '').ToLowerInvariant()
    if ($normalized -notmatch '^[0-9a-f]{64}$') {
        throw 'SignerSHA256 must contain exactly 64 hexadecimal characters, with optional colons.'
    }
    return $normalized
}

function Convert-ToAndroidFingerprint([string]$Value) {
    $pairs = [regex]::Matches($Value.ToUpperInvariant(), '[0-9A-F]{2}') |
        ForEach-Object { $_.Value }
    return $pairs -join ':'
}

function Get-BytesSHA256([byte[]]$Bytes) {
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        return -join @($sha256.ComputeHash($Bytes) | ForEach-Object { '{0:x2}' -f $_ })
    } finally {
        $sha256.Dispose()
    }
}

if ([string]::IsNullOrWhiteSpace($SignerSHA256)) {
    $SignerSHA256 = [string]$env:HUBIT_ANDROID_EXPECTED_SIGNER_SHA256
}
$signer = Normalize-SignerFingerprint $SignerSHA256
if ($signer -eq $blockedDebugSigner) {
    throw 'The known debug-preview certificate must never be delegated by production assetlinks.json.'
}

$audit = $null
if ($ReleaseAuditPath) {
    if (-not (Test-Path -LiteralPath $ReleaseAuditPath -PathType Leaf)) {
        throw "Release APK audit was not found: $ReleaseAuditPath"
    }
    try {
        $audit = Get-Content -LiteralPath $ReleaseAuditPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        throw 'Release APK audit is invalid JSON.'
    }
    if (
        [string]$audit.package_name -ne $packageName -or
        [string]$audit.signing -ne 'release' -or
        (Normalize-SignerFingerprint ([string]$audit.signer_sha256)) -ne $signer
    ) {
        throw 'Release APK audit does not prove this package and permanent signer.'
    }
} elseif (-not $ValidateOnly) {
    throw 'ReleaseAuditPath is required for production assetlinks publication.'
}

$entry = [ordered]@{
    relation = @(
        'delegate_permission/common.handle_all_urls',
        'delegate_permission/common.get_login_creds'
    )
    target = [ordered]@{
        namespace = 'android_app'
        package_name = $packageName
        sha256_cert_fingerprints = @(Convert-ToAndroidFingerprint $signer)
    }
}

function New-AssetLinksCandidate([object[]]$ExistingEntries) {
    $preserved = @($ExistingEntries | Where-Object {
        -not (
            [string]$_.target.namespace -eq 'android_app' -and
            [string]$_.target.package_name -eq $packageName
        )
    })
    $entries = @($preserved) + @($entry)
    $json = ConvertTo-Json -InputObject $entries -Depth 6
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    if ($bytes.Length -gt 16KB) {
        throw 'assetlinks.json candidate exceeds 16 KiB.'
    }
    return [pscustomobject]@{
        Json = $json
        Bytes = $bytes
        SHA256 = Get-BytesSHA256 $bytes
        EntryCount = $entries.Count
        PreservedEntryCount = $preserved.Count
    }
}
$validationEntries = @()
if ($ExistingAssetLinksPath) {
    if (-not $ValidateOnly) {
        throw 'ExistingAssetLinksPath is supported only with -ValidateOnly.'
    }
    if (-not (Test-Path -LiteralPath $ExistingAssetLinksPath -PathType Leaf)) {
        throw "Existing assetlinks validation file was not found: $ExistingAssetLinksPath"
    }
    try {
        $validationEntries = @(Get-Content -LiteralPath $ExistingAssetLinksPath -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch {
        throw 'Existing assetlinks validation file is invalid.'
    }
}
$candidate = New-AssetLinksCandidate $validationEntries
$result = [pscustomobject]@{
    PackageName = $packageName
    SignerSHA256 = $signer
    AndroidFingerprint = Convert-ToAndroidFingerprint $signer
    Relations = @($entry.relation)
    CandidateSHA256 = $candidate.SHA256
    EntryCount = $candidate.EntryCount
    PreservedEntryCount = $candidate.PreservedEntryCount
    Changed = $null
    ValidateOnly = [bool]$ValidateOnly
}
if ($ValidateOnly) {
    return $result
}

if ([string]::IsNullOrWhiteSpace($WebRoot)) {
    throw 'WebRoot is required unless -ValidateOnly is used.'
}
if (-not (Test-Path -LiteralPath $WebRoot -PathType Container)) {
    throw "Frontend IIS physical path does not exist: $WebRoot"
}
$resolvedWebRoot = (Resolve-Path -LiteralPath $WebRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $resolvedWebRoot 'index.html') -PathType Leaf)) {
    throw 'WebRoot does not look like the deployed HUB-IT frontend.'
}
$wellKnownRoot = Join-Path $resolvedWebRoot '.well-known'
$targetPath = Join-Path $wellKnownRoot 'assetlinks.json'
$temporaryPath = Join-Path $resolvedWebRoot ('.assetlinks-' + [Guid]::NewGuid().ToString('N') + '.tmp')
$backupPath = $null
$existingBytes = $null
$existingEntries = @()

if (Test-Path -LiteralPath $targetPath -PathType Leaf) {
    $existingBytes = [IO.File]::ReadAllBytes($targetPath)
    if ($existingBytes.Length -gt 64KB) {
        throw 'Existing assetlinks.json is unexpectedly large; refusing automatic replacement.'
    }
    try {
        $existingEntries = @(Get-Content -LiteralPath $targetPath -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch {
        throw 'Existing assetlinks.json is invalid; refusing automatic replacement.'
    }
}
$candidate = New-AssetLinksCandidate $existingEntries
if ($existingBytes) {
    $existingHash = Get-BytesSHA256 $existingBytes
    if ($existingHash -eq $candidate.SHA256) {
        return [pscustomobject]@{
            PackageName = $packageName
            SignerSHA256 = $signer
            AndroidFingerprint = Convert-ToAndroidFingerprint $signer
            Relations = @($entry.relation)
            CandidateSHA256 = $candidate.SHA256
            EntryCount = $candidate.EntryCount
            PreservedEntryCount = $candidate.PreservedEntryCount
            AssetLinks = $targetPath
            Backup = $null
            Changed = $false
            ValidateOnly = $false
        }
    }
}

if (-not $PSCmdlet.ShouldProcess($targetPath, 'Publish Android Digital Asset Links for the permanent HUB-IT signer')) {
    $result.Changed = $false
    return $result
}

New-Item -ItemType Directory -Path $wellKnownRoot -Force | Out-Null
if ($existingBytes) {
    New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
    $timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmssfff')
    $backupPath = Join-Path $BackupRoot "assetlinks-$timestamp.json"
    Copy-Item -LiteralPath $targetPath -Destination $backupPath
}

try {
    [IO.File]::WriteAllText($temporaryPath, $candidate.Json, [Text.UTF8Encoding]::new($false))
    $written = Get-Content -LiteralPath $temporaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $writtenEntry = @($written) | Where-Object {
        [string]$_.target.namespace -eq 'android_app' -and
        [string]$_.target.package_name -eq $packageName
    } | Select-Object -First 1
    if (-not $writtenEntry) { throw 'Written assetlinks.json failed semantic validation.' }
    Move-Item -LiteralPath $temporaryPath -Destination $targetPath -Force
} finally {
    if (Test-Path -LiteralPath $temporaryPath) {
        Remove-Item -LiteralPath $temporaryPath -Force
    }
}

return [pscustomobject]@{
    PackageName = $packageName
    SignerSHA256 = $signer
    AndroidFingerprint = Convert-ToAndroidFingerprint $signer
    Relations = @($entry.relation)
    CandidateSHA256 = $candidate.SHA256
    EntryCount = $candidate.EntryCount
    PreservedEntryCount = $candidate.PreservedEntryCount
    AssetLinks = $targetPath
    Backup = $backupPath
    Changed = $true
    ValidateOnly = $false
}
