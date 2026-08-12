[CmdletBinding()]
param(
    [ValidateSet('Release')]
    [string]$Configuration = 'Release',
    [switch]$NoRestore,
    [switch]$SuppressMsiValidation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$desktopProject = Join-Path $repoRoot 'desktop\Hub.Desktop\Hub.Desktop.csproj'
$msiProject = Join-Path $repoRoot 'desktop\Hub.Desktop.Installer\Hub.Desktop.Installer.wixproj'
$bundleProject = Join-Path $repoRoot 'desktop\Hub.Desktop.Setup\Hub.Desktop.Setup.wixproj'
$nugetConfig = Join-Path $repoRoot 'desktop\NuGet.Config'
$publishScript = Join-Path $repoRoot 'scripts\desktop\publish.ps1'
$iconPath = Join-Path $repoRoot 'desktop\Hub.Desktop\Assets\hub-icon.ico'
$setupLogoPath = Join-Path $repoRoot 'desktop\Hub.Desktop.Setup\Assets\hub-setup-logo.png'
$policySourceDirectory = Join-Path $repoRoot 'desktop\policy'
$projectDocument = [xml](Get-Content -Raw -LiteralPath $desktopProject)
$version = $projectDocument.SelectSingleNode('/Project/PropertyGroup/Version').InnerText
$targetFramework = $projectDocument.SelectSingleNode('/Project/PropertyGroup/TargetFramework').InnerText
$runtimeIdentifier = 'win-x64'
$publishDirectory = Join-Path (Split-Path -Parent $desktopProject) "bin\$Configuration\$targetFramework\$runtimeIdentifier\publish"
$packageDirectory = Join-Path (Split-Path -Parent $desktopProject) "bin\$Configuration\$targetFramework\$runtimeIdentifier\package"
$buildDirectory = Join-Path $repoRoot ".codex_tmp\desktop-installer\$version"
$prerequisiteDirectory = Join-Path $repoRoot '.codex_tmp\desktop-installer\prerequisites'
$msiBuildDirectory = Join-Path $buildDirectory 'msi'
$bundleBuildDirectory = Join-Path $buildDirectory 'bundle'

$repoDotnet = @(
    Join-Path $repoRoot 'tools\dotnet-sdk-8\dotnet.exe'
    Get-ChildItem -LiteralPath (Join-Path $repoRoot 'tools') -Directory -Filter 'dotnet-sdk-8*' -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'dotnet.exe' }
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
$dotnetPath = if ($null -ne $repoDotnet) {
    [string]$repoDotnet
} else {
    (Get-Command dotnet -ErrorAction Stop).Source
}

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

function Test-MicrosoftSignature([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    return $signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid `
        -and $null -ne $signature.SignerCertificate `
        -and $signature.SignerCertificate.Subject -match '(^|, )CN=Microsoft Corporation(,|$)'
}

function Get-MicrosoftPrerequisite(
    [string]$Uri,
    [string]$Destination
) {
    if (Test-MicrosoftSignature $Destination) {
        return
    }

    Assert-ChildPath $prerequisiteDirectory $Destination
    $downloadPath = "$Destination.download"
    Assert-ChildPath $prerequisiteDirectory $downloadPath
    if (Test-Path -LiteralPath $downloadPath) {
        Remove-Item -LiteralPath $downloadPath -Force
    }

    Invoke-WebRequest -Uri $Uri -OutFile $downloadPath -UseBasicParsing
    if (-not (Test-MicrosoftSignature $downloadPath)) {
        Remove-Item -LiteralPath $downloadPath -Force
        throw "Downloaded prerequisite is not validly signed by Microsoft: $Uri"
    }

    Move-Item -LiteralPath $downloadPath -Destination $Destination -Force
}

function Invoke-DotnetBuild(
    [string]$Project,
    [string[]]$Properties
) {
    $arguments = @('build', $Project, '--configuration', $Configuration, '--no-restore')
    $arguments += $Properties
    & $dotnetPath @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet build failed for $Project with exit code $LASTEXITCODE"
    }
}

function Invoke-DotnetClean([string]$Project) {
    & $dotnetPath clean $Project --configuration $Configuration
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet clean failed for $Project with exit code $LASTEXITCODE"
    }
}

function Invoke-DotnetRestore([string]$Project) {
    & $dotnetPath restore $Project --configfile $nugetConfig
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet restore failed for $Project with exit code $LASTEXITCODE"
    }
}

if ($NoRestore) {
    & $publishScript -NoRestore
}
else {
    & $publishScript
}
if ($LASTEXITCODE -ne 0) {
    throw "Desktop publish failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath (Join-Path $publishDirectory 'HUB.Desktop.exe') -PathType Leaf)) {
    throw "Published desktop executable is missing: $publishDirectory"
}

foreach ($brandingAsset in @($iconPath, $setupLogoPath)) {
    if (-not (Test-Path -LiteralPath $brandingAsset -PathType Leaf)) {
        throw "Desktop branding asset is missing: $brandingAsset"
    }
}

New-Item -ItemType Directory -Path $prerequisiteDirectory -Force | Out-Null
$vcRedist = Join-Path $prerequisiteDirectory 'VC_redist.x64.exe'
$webView2Bootstrapper = Join-Path $prerequisiteDirectory 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
$windowsAppRuntime = Join-Path $prerequisiteDirectory 'WindowsAppRuntimeInstall-x64.exe'

Get-MicrosoftPrerequisite `
    'https://aka.ms/vs/17/release/vc_redist.x64.exe' `
    $vcRedist
Get-MicrosoftPrerequisite `
    'https://go.microsoft.com/fwlink/p/?LinkId=2124701' `
    $webView2Bootstrapper
Get-MicrosoftPrerequisite `
    'https://download.microsoft.com/download/712421b4-6f72-47fc-acb8-2ebf030b2260/WindowsAppRuntimeInstall-x64.exe' `
    $windowsAppRuntime

foreach ($target in @($msiBuildDirectory, $bundleBuildDirectory)) {
    Assert-ChildPath $buildDirectory $target
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
    New-Item -ItemType Directory -Path $target | Out-Null
}

Invoke-DotnetRestore $msiProject
Invoke-DotnetRestore $bundleProject
Invoke-DotnetClean $msiProject
Invoke-DotnetClean $bundleProject

$msiBuildProperties = @(
    "-p:DesktopVersion=$version",
    "-p:PublishDir=$publishDirectory",
    "-p:IconPath=$iconPath",
    "-p:OutputPath=$msiBuildDirectory"
)
if ($SuppressMsiValidation) {
    Write-Warning 'MSI ICE validation is suppressed for this build.'
    $msiBuildProperties += '-p:SuppressValidation=true'
}
Invoke-DotnetBuild $msiProject $msiBuildProperties

$msiFiles = @(Get-ChildItem -LiteralPath $msiBuildDirectory -Filter '*.msi' -File -Recurse)
if ($msiFiles.Count -ne 1) {
    throw "Expected exactly one MSI output, found $($msiFiles.Count)"
}
$msi = $msiFiles[0]

Invoke-DotnetBuild $bundleProject @(
    "-p:DesktopVersion=$version",
    "-p:MsiPath=$($msi.FullName)",
    "-p:WebView2BootstrapperPath=$webView2Bootstrapper",
    "-p:WindowsAppRuntimePath=$windowsAppRuntime",
    "-p:VCRedistPath=$vcRedist",
    "-p:IconPath=$iconPath",
    "-p:LogoPath=$setupLogoPath",
    "-p:OutputPath=$bundleBuildDirectory"
)

$bundleFiles = @(Get-ChildItem -LiteralPath $bundleBuildDirectory -Filter '*.exe' -File -Recurse)
if ($bundleFiles.Count -ne 1) {
    throw "Expected exactly one setup EXE output, found $($bundleFiles.Count)"
}
$bundle = $bundleFiles[0]

New-Item -ItemType Directory -Path $packageDirectory -Force | Out-Null
$finalMsi = Join-Path $packageDirectory $msi.Name
$finalBundle = Join-Path $packageDirectory $bundle.Name
$policyArchive = Join-Path $packageDirectory 'HUB-Desktop-Policy-Templates.zip'
foreach ($artifact in @(
    $finalMsi,
    $finalBundle,
    "$finalMsi.sha256",
    "$finalBundle.sha256",
    $policyArchive,
    "$policyArchive.sha256"
)) {
    Assert-ChildPath $packageDirectory $artifact
    if (Test-Path -LiteralPath $artifact) {
        Remove-Item -LiteralPath $artifact -Force
    }
}

Copy-Item -LiteralPath $msi.FullName -Destination $finalMsi
Copy-Item -LiteralPath $bundle.FullName -Destination $finalBundle
if (-not (Test-Path -LiteralPath (Join-Path $policySourceDirectory 'HUBDesktop.admx') -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $policySourceDirectory 'ru-RU\HUBDesktop.adml') -PathType Leaf)) {
    throw 'Desktop policy templates are incomplete'
}
Compress-Archive `
    -Path (Join-Path $policySourceDirectory '*') `
    -DestinationPath $policyArchive `
    -CompressionLevel Optimal

$msiHash = Get-FileHash -LiteralPath $finalMsi -Algorithm SHA256
$bundleHash = Get-FileHash -LiteralPath $finalBundle -Algorithm SHA256
$policyArchiveHash = Get-FileHash -LiteralPath $policyArchive -Algorithm SHA256
$prerequisiteInventory = @(
    [ordered]@{ name = 'Microsoft Visual C++ Redistributable x64'; file = $vcRedist },
    [ordered]@{ name = 'Microsoft Edge WebView2 Evergreen Standalone x64'; file = $webView2Bootstrapper },
    [ordered]@{ name = 'Microsoft Windows App SDK Runtime 1.8 x64'; file = $windowsAppRuntime }
) | ForEach-Object {
    $file = Get-Item -LiteralPath $_.file
    [ordered]@{
        name = $_.name
        file_name = $file.Name
        file_version = $file.VersionInfo.FileVersion
        sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}
$prerequisiteInventoryPath = Join-Path $packageDirectory 'HUB-Desktop-prerequisites.json'
$prerequisiteInventory |
    ConvertTo-Json -Depth 3 |
    Set-Content -LiteralPath $prerequisiteInventoryPath -Encoding utf8
"$($msiHash.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($finalMsi))" |
    Set-Content -LiteralPath "$finalMsi.sha256" -Encoding ascii
"$($bundleHash.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($finalBundle))" |
    Set-Content -LiteralPath "$finalBundle.sha256" -Encoding ascii
"$($policyArchiveHash.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($policyArchive))" |
    Set-Content -LiteralPath "$policyArchive.sha256" -Encoding ascii

[pscustomobject]@{
    Version = $version
    Runtime = $runtimeIdentifier
    SetupMiB = [math]::Round((Get-Item -LiteralPath $finalBundle).Length / 1MB, 2)
    Setup = $finalBundle
    SetupSHA256 = $bundleHash.Hash.ToLowerInvariant()
    MsiMiB = [math]::Round((Get-Item -LiteralPath $finalMsi).Length / 1MB, 2)
    Msi = $finalMsi
    MsiSHA256 = $msiHash.Hash.ToLowerInvariant()
    Prerequisites = $prerequisiteInventoryPath
    PolicyTemplates = $policyArchive
}
