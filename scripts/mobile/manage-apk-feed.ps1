[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [string]$IisUpdateRoot,
    [Parameter(Mandatory)]
    [ValidateSet('SetMinimum', 'RestoreManifest', 'DisableFeed')]
    [string]$Action,
    [ValidateRange(1, 2147483647)]
    [int]$MinSupportedVersionCode = 1,
    [string]$HistoryManifestPath,
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $IisUpdateRoot -PathType Container)) {
    throw "IIS update root does not exist: $IisUpdateRoot"
}
$root = (Resolve-Path -LiteralPath $IisUpdateRoot).Path
$channelRoot = Join-Path $root 'mobile\preview'
$latestPath = Join-Path $channelRoot 'latest.json'
$historyRoot = Join-Path $channelRoot '.manifest-history'

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

Assert-ChildPath $root $channelRoot
Assert-ChildPath $root $latestPath
Assert-ChildPath $root $historyRoot
if (-not (Test-Path -LiteralPath $latestPath -PathType Leaf)) {
    throw "Current mobile feed manifest is missing: $latestPath"
}

$currentJson = Get-Content -Raw -LiteralPath $latestPath -Encoding UTF8
$current = $currentJson | ConvertFrom-Json
if ([int]$current.schema_version -ne 2) {
    throw 'Feed management requires a schema v2 manifest.'
}

$replacementJson = $null
$summary = [ordered]@{
    Action = $Action
    CurrentVersion = [string]$current.version
    CurrentVersionCode = [int]$current.version_code
    CurrentMinimum = [int]$current.min_supported_version_code
    TargetMinimum = $null
    SourceManifest = $null
    ValidateOnly = [bool]$ValidateOnly
}

if ($Action -eq 'SetMinimum') {
    if ($MinSupportedVersionCode -gt [int]$current.version_code) {
        throw 'Minimum supported versionCode cannot exceed the current feed versionCode.'
    }
    $current.min_supported_version_code = $MinSupportedVersionCode
    $replacementJson = $current | ConvertTo-Json -Depth 8
    $summary.TargetMinimum = $MinSupportedVersionCode
}
elseif ($Action -eq 'RestoreManifest') {
    if ([string]::IsNullOrWhiteSpace($HistoryManifestPath)) {
        throw 'RestoreManifest requires an explicit -HistoryManifestPath.'
    }
    $resolvedHistory = (Resolve-Path -LiteralPath $HistoryManifestPath).Path
    Assert-ChildPath $historyRoot $resolvedHistory
    $replacementJson = Get-Content -Raw -LiteralPath $resolvedHistory -Encoding UTF8
    $replacement = $replacementJson | ConvertFrom-Json
    if ([int]$replacement.schema_version -notin @(1, 2) -or [string]$replacement.channel -ne 'preview') {
        throw 'Selected history manifest is not a HUB-IT mobile preview manifest.'
    }
    $summary.SourceManifest = $resolvedHistory
}

if ($ValidateOnly) {
    return [pscustomobject]$summary
}
if (-not $PSCmdlet.ShouldProcess($latestPath, "$Action mobile preview feed")) {
    return [pscustomobject]$summary
}

New-Item -ItemType Directory -Path $historyRoot -Force | Out-Null
$backupName = 'latest-' + [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N') + '.json'
$backupPath = Join-Path $historyRoot $backupName
Copy-Item -LiteralPath $latestPath -Destination $backupPath

if ($Action -eq 'DisableFeed') {
    $disabledName = 'latest-disabled-' + [DateTimeOffset]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.json'
    $disabledPath = Join-Path $historyRoot $disabledName
    Move-Item -LiteralPath $latestPath -Destination $disabledPath
    $summary.SourceManifest = $backupPath
    return [pscustomobject]$summary
}

$temporaryPath = Join-Path $channelRoot ('latest.json.tmp-' + [Guid]::NewGuid().ToString('N'))
Assert-ChildPath $channelRoot $temporaryPath
try {
    [IO.File]::WriteAllText($temporaryPath, $replacementJson, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporaryPath -Destination $latestPath -Force
}
finally {
    if (Test-Path -LiteralPath $temporaryPath) {
        Remove-Item -LiteralPath $temporaryPath -Force
    }
}

$summary.SourceManifest = $backupPath
return [pscustomobject]$summary
