[CmdletBinding()]
param(
    [ValidateSet('Release')]
    [string]$Configuration = 'Release',
    [ValidateSet('NotSigned', 'Valid')]
    [string]$ExpectedAuthenticodeStatus = 'NotSigned'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$projectPath = Join-Path $repoRoot 'desktop\Hub.Desktop\Hub.Desktop.csproj'
$publishProfilePath = Join-Path $repoRoot 'desktop\Hub.Desktop\Properties\PublishProfiles\win-x64.pubxml'
$inspectMsiScript = Join-Path $PSScriptRoot 'inspect-msi.ps1'
$projectDocument = [xml](Get-Content -Raw -LiteralPath $projectPath)
$publishProfileDocument = [xml](Get-Content -Raw -LiteralPath $publishProfilePath)
$version = $projectDocument.SelectSingleNode('/Project/PropertyGroup/Version').InnerText
$windowsAppSdkSelfContained =
    $projectDocument.SelectSingleNode('/Project/PropertyGroup/WindowsAppSDKSelfContained').InnerText
$windowsAppSdkBootstrapInitialize =
    $projectDocument.SelectSingleNode('/Project/PropertyGroup/WindowsAppSdkBootstrapInitialize').InnerText
$publishProfileWindowsAppSdkSelfContained =
    $publishProfileDocument.SelectSingleNode('/Project/PropertyGroup/WindowsAppSDKSelfContained').InnerText
$targetFramework = $projectDocument.SelectSingleNode('/Project/PropertyGroup/TargetFramework').InnerText
$runtimeIdentifier = 'win-x64'
$outputRoot = Join-Path (Split-Path -Parent $projectPath) "bin\$Configuration\$targetFramework\$runtimeIdentifier"
$publishDirectory = Join-Path $outputRoot 'publish'
$packageDirectory = Join-Path $outputRoot 'package'
$setupPath = Join-Path $packageDirectory "HUB-Desktop-Setup-$version-$runtimeIdentifier.exe"
$msiPath = Join-Path $packageDirectory "HUB-Desktop-$version-$runtimeIdentifier.msi"
$archivePath = Join-Path $packageDirectory "HUB-Desktop-$version-$runtimeIdentifier.zip"
$prerequisiteInventoryPath = Join-Path $packageDirectory 'HUB-Desktop-prerequisites.json'
$policyArchivePath = Join-Path $packageDirectory 'HUB-Desktop-Policy-Templates.zip'
$sbomPath = Join-Path $packageDirectory "HUB-Desktop-$version-$runtimeIdentifier.cdx.json"
$expectedUpgradeCode = '{E6CBB09A-A4C5-458B-995B-544B999F4A1F}'

function Assert-File([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required release file is missing: $Path"
    }
}

function Assert-Sha256Sidecar([string]$Path) {
    $sidecarPath = "$Path.sha256"
    Assert-File $sidecarPath
    $line = (Get-Content -LiteralPath $sidecarPath -Raw -Encoding ascii).Trim()
    if ($line -notmatch '^([0-9a-f]{64})  ([^\\/]+)$') {
        throw "Invalid SHA-256 sidecar format: $sidecarPath"
    }
    if (-not $Matches[2].Equals(
            [IO.Path]::GetFileName($Path),
            [StringComparison]::Ordinal)) {
        throw "SHA-256 sidecar references a different file: $sidecarPath"
    }

    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if (-not $actual.Equals($Matches[1], [StringComparison]::Ordinal)) {
        throw "SHA-256 mismatch: $Path"
    }
    return $actual
}

function Assert-AuthenticodeStatus([string]$Path) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if (-not $signature.Status.ToString().Equals(
            $ExpectedAuthenticodeStatus,
            [StringComparison]::Ordinal)) {
        throw "Unexpected Authenticode status for $Path`: $($signature.Status); expected $ExpectedAuthenticodeStatus"
    }

    if ($ExpectedAuthenticodeStatus -eq 'Valid' -and $null -eq $signature.SignerCertificate) {
        throw "Authenticode signer certificate is missing: $Path"
    }
}

if ($version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
    throw "Desktop version must use major.minor.patch: $version"
}

if ($windowsAppSdkSelfContained -ne 'true' -or
    $windowsAppSdkBootstrapInitialize -ne 'false' -or
    $publishProfileWindowsAppSdkSelfContained -ne 'true') {
    throw 'Desktop must use self-contained Windows App SDK without the DDLM bootstrapper.'
}

foreach ($path in @($setupPath, $msiPath, $archivePath, $policyArchivePath, $sbomPath)) {
    Assert-File $path
}
Assert-File $prerequisiteInventoryPath

$prerequisites = Get-Content -LiteralPath $prerequisiteInventoryPath -Raw -Encoding utf8 |
    ConvertFrom-Json
$expectedPrerequisiteFiles = @(
    'VC_redist.x64.exe',
    'MicrosoftEdgeWebView2RuntimeInstallerX64.exe',
    'WindowsAppRuntimeInstall-x64.exe'
)
if ($prerequisites.Count -ne $expectedPrerequisiteFiles.Count) {
    throw "Unexpected prerequisite inventory count: $($prerequisites.Count)"
}
foreach ($prerequisite in $prerequisites) {
    if ($expectedPrerequisiteFiles -notcontains $prerequisite.file_name -or
        $prerequisite.sha256 -notmatch '^[0-9a-f]{64}$' -or
        [string]::IsNullOrWhiteSpace($prerequisite.name)) {
        throw "Invalid prerequisite inventory entry"
    }
}

$setupInfo = Get-Item -LiteralPath $setupPath
if ($setupInfo.Length -le 0 -or $setupInfo.Length -gt 500MB) {
    throw "Desktop Setup size is outside the allowed range: $($setupInfo.Length)"
}

$setupSha256 = Assert-Sha256Sidecar $setupPath
$msiSha256 = Assert-Sha256Sidecar $msiPath
$archiveSha256 = Assert-Sha256Sidecar $archivePath
$policyArchiveSha256 = Assert-Sha256Sidecar $policyArchivePath
$sbomSha256 = Assert-Sha256Sidecar $sbomPath
Assert-AuthenticodeStatus $setupPath
Assert-AuthenticodeStatus $msiPath

Add-Type -AssemblyName System.IO.Compression.FileSystem
$policyArchive = [System.IO.Compression.ZipFile]::OpenRead($policyArchivePath)
try {
    $policyEntries = @($policyArchive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    foreach ($requiredPolicyEntry in @('HUBDesktop.admx', 'ru-RU/HUBDesktop.adml')) {
        if ($policyEntries -notcontains $requiredPolicyEntry) {
            throw "Policy archive is missing $requiredPolicyEntry"
        }
    }
}
finally {
    $policyArchive.Dispose()
}

$sbomRaw = Get-Content -LiteralPath $sbomPath -Raw -Encoding utf8
$sbom = $sbomRaw | ConvertFrom-Json
if ($sbom.bomFormat -ne 'CycloneDX' -or
    $sbom.specVersion -ne '1.5' -or
    $sbom.serialNumber -notmatch '^urn:uuid:[0-9a-f-]{36}$' -or
    $sbom.metadata.component.name -ne 'HUB Desktop' -or
    $sbom.metadata.component.version -ne $version -or
    @($sbom.components).Count -lt 3) {
    throw 'Desktop CycloneDX SBOM metadata validation failed.'
}
$bomReferences = @($sbom.components | ForEach-Object { [string]$_.'bom-ref' })
if (@($bomReferences | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0 -or
    @($bomReferences | Sort-Object -Unique).Count -ne $bomReferences.Count) {
    throw 'Desktop CycloneDX SBOM contains missing or duplicate bom-ref values.'
}
if ($sbomRaw.IndexOf($repoRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
    $sbomRaw -match '(?i)-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|\.pfx|refresh_token|access_token') {
    throw 'Desktop CycloneDX SBOM contains an absolute workspace path or forbidden secret marker.'
}

$msi = & $inspectMsiScript -Path $msiPath
$msiFileNames = @($msi.Files | ForEach-Object {
    $parts = ([string]$_).Split('|', 2)
    $parts[$parts.Count - 1]
})
foreach ($requiredMsiFile in @('HUB.Desktop.exe', 'Microsoft.WindowsAppRuntime.dll', 'Microsoft.WindowsAppRuntime.pri')) {
    if ($msiFileNames -notcontains $requiredMsiFile) {
        throw "MSI payload is missing $requiredMsiFile"
    }
}
if ($msi.ProductName -ne 'HUB Desktop' -or
    $msi.ProductVersion -ne $version -or
    $msi.Manufacturer -ne 'HUB-IT' -or
    $msi.UpgradeCode -ne $expectedUpgradeCode -or
    $msi.ProductCode -notmatch '^\{[0-9A-Fa-f-]{36}\}$') {
    throw "MSI metadata validation failed: $($msi | ConvertTo-Json -Compress)"
}

$requiredPublishFiles = @(
    'HUB.Desktop.exe',
    'HUB.Desktop.dll',
    'HUB.Desktop.UpdateRunner.exe',
    'appsettings.json',
    'Microsoft.Web.WebView2.Core.dll',
    'WebView2Loader.dll',
    'Microsoft.WindowsAppRuntime.dll',
    'Microsoft.WindowsAppRuntime.pri'
)
foreach ($fileName in $requiredPublishFiles) {
    Assert-File (Join-Path $publishDirectory $fileName)
}

$forbiddenFiles = @(Get-ChildItem -LiteralPath $publishDirectory -File -Recurse | Where-Object {
    $_.Extension -in @('.pdb', '.pfx', '.p12', '.key', '.pem') -or
    $_.Name.EndsWith('.partial', [StringComparison]::OrdinalIgnoreCase) -or
    $_.Name.EndsWith('.tmp', [StringComparison]::OrdinalIgnoreCase)
})
if ($forbiddenFiles.Count -gt 0) {
    throw "Forbidden files are present in publish output: $($forbiddenFiles.Name -join ', ')"
}

[pscustomobject]@{
    Version = $version
    Authenticode = $ExpectedAuthenticodeStatus
    Setup = $setupPath
    SetupSHA256 = $setupSha256
    MSI = $msiPath
    MSISHA256 = $msiSha256
    ProductCode = $msi.ProductCode
    UpgradeCode = $msi.UpgradeCode
    Archive = $archivePath
    ArchiveSHA256 = $archiveSha256
    PolicyTemplates = $policyArchivePath
    PolicyTemplatesSHA256 = $policyArchiveSha256
    SBOM = $sbomPath
    SBOMSHA256 = $sbomSha256
    SBOMComponents = @($sbom.components).Count
}
