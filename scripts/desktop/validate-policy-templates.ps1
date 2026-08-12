[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$admxPath = Join-Path $repoRoot 'desktop\policy\HUBDesktop.admx'
$admlPath = Join-Path $repoRoot 'desktop\policy\ru-RU\HUBDesktop.adml'

foreach ($path in @($admxPath, $admlPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Policy template is missing: $path"
    }
}

[xml]$admx = Get-Content -LiteralPath $admxPath -Raw -Encoding utf8
[xml]$adml = Get-Content -LiteralPath $admlPath -Raw -Encoding utf8

$namespace = New-Object System.Xml.XmlNamespaceManager($admx.NameTable)
$namespace.AddNamespace('p', 'http://www.microsoft.com/GroupPolicy/PolicyDefinitions')
$policyNodes = @($admx.SelectNodes('/*[local-name()="policyDefinitions"]/*[local-name()="policies"]/*[local-name()="policy"]'))
$expectedPolicies = @(
    'AutostartMode',
    'UpdatesEnabled',
    'UpdateDeferralHours',
    'DiagnosticsExportEnabled',
    'NotificationFallbackEnabled'
)
$actualPolicies = @($policyNodes | ForEach-Object { $_.name })
if (@(Compare-Object $expectedPolicies $actualPolicies).Count -ne 0) {
    throw "Unexpected policy set: $($actualPolicies -join ', ')"
}

foreach ($policy in $policyNodes) {
    if ($policy.class -ne 'Machine' -or
        $policy.key -ne 'Software\Policies\HUB-IT\Desktop') {
        throw "Policy has an unsafe class or registry root: $($policy.name)"
    }
}

$admxText = Get-Content -LiteralPath $admxPath -Raw -Encoding utf8
$admlStringIds = @($adml.SelectNodes('/*[local-name()="policyDefinitionResources"]/*[local-name()="resources"]/*[local-name()="stringTable"]/*[local-name()="string"]') |
    ForEach-Object { $_.id })
$references = [regex]::Matches($admxText, '\$\(string\.([A-Za-z0-9_]+)\)') |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique
foreach ($reference in $references) {
    if ($admlStringIds -notcontains $reference) {
        throw "ADML string is missing: $reference"
    }
}

foreach ($forbiddenName in @('BaseUrl', 'FeedUrl', 'Executable', 'Password', 'Token', 'ReleaseChannel')) {
    if ($admxText.IndexOf($forbiddenName, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw "Forbidden policy surface found: $forbiddenName"
    }
}

[pscustomobject]@{
    ADMX = $admxPath
    ADML = $admlPath
    Policies = $actualPolicies.Count
    RegistryRoot = 'HKLM\Software\Policies\HUB-IT\Desktop'
}
