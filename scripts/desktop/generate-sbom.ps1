[CmdletBinding()]
param(
    [ValidateSet('Release')]
    [string]$Configuration = 'Release'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$projectPath = Join-Path $repoRoot 'desktop\Hub.Desktop\Hub.Desktop.csproj'
$solution = Join-Path $repoRoot 'desktop\Hub.Desktop.sln'
$dotnet = @(
    Join-Path $repoRoot 'tools\dotnet-sdk-8\dotnet.exe'
    Get-ChildItem -LiteralPath (Join-Path $repoRoot 'tools') -Directory -Filter 'dotnet-sdk-8*' -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'dotnet.exe' }
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ($null -eq $dotnet) {
    $dotnet = (Get-Command dotnet -ErrorAction Stop).Source
}
$dotnet = [string]$dotnet

$projectDocument = [xml](Get-Content -Raw -LiteralPath $projectPath)
$version = $projectDocument.SelectSingleNode('/Project/PropertyGroup/Version').InnerText
$targetFramework = $projectDocument.SelectSingleNode('/Project/PropertyGroup/TargetFramework').InnerText
$runtimeIdentifier = 'win-x64'
$packageDirectory = Join-Path (Split-Path -Parent $projectPath) "bin\$Configuration\$targetFramework\$runtimeIdentifier\package"
$prerequisiteInventoryPath = Join-Path $packageDirectory 'HUB-Desktop-prerequisites.json'
$sbomPath = Join-Path $packageDirectory "HUB-Desktop-$version-$runtimeIdentifier.cdx.json"

if (-not (Test-Path -LiteralPath $prerequisiteInventoryPath -PathType Leaf)) {
    throw "Prerequisite inventory is missing; build the installer first: $prerequisiteInventoryPath"
}

$rawOutput = & $dotnet list $solution package --include-transitive --format json --output-version 1
if ($LASTEXITCODE -ne 0) {
    throw "NuGet package inventory failed with exit code $LASTEXITCODE"
}
try {
    $packageReport = ([string]::Join([Environment]::NewLine, @($rawOutput))) | ConvertFrom-Json
}
catch {
    throw "NuGet package inventory returned invalid JSON: $($_.Exception.Message)"
}
$prerequisites = Get-Content -LiteralPath $prerequisiteInventoryPath -Raw -Encoding utf8 |
    ConvertFrom-Json

$productionProjects = @(
    'Hub.Desktop.csproj',
    'Hub.Desktop.UpdateCore.csproj',
    'Hub.Desktop.UpdateRunner.csproj',
    'Hub.Desktop.UpdateVerifier.csproj'
)
$packages = @{}
foreach ($project in @($packageReport.projects)) {
    $projectName = [IO.Path]::GetFileName([string]$project.path)
    if ($productionProjects -notcontains $projectName) {
        continue
    }
    foreach ($framework in @($project.frameworks)) {
        foreach ($kind in @('topLevelPackages', 'transitivePackages')) {
            $packageProperty = $framework.PSObject.Properties[$kind]
            if ($null -eq $packageProperty) {
                continue
            }
            foreach ($package in @($packageProperty.Value)) {
                $packageId = [string]$package.id
                $packageVersion = [string]$package.resolvedVersion
                if ([string]::IsNullOrWhiteSpace($packageId) -or [string]::IsNullOrWhiteSpace($packageVersion)) {
                    throw "Incomplete NuGet package entry in $projectName"
                }
                $key = "$($packageId.ToLowerInvariant())@$packageVersion"
                if (-not $packages.ContainsKey($key)) {
                    $packages[$key] = [ordered]@{
                        id = $packageId
                        version = $packageVersion
                        direct = $false
                        projects = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
                    }
                }
                if ($kind -eq 'topLevelPackages') {
                    $packages[$key].direct = $true
                }
                [void]$packages[$key].projects.Add($projectName)
            }
        }
    }
}

$components = [System.Collections.Generic.List[object]]::new()
foreach ($entry in @($packages.GetEnumerator() | Sort-Object Name)) {
    $package = $entry.Value
    $purlName = [Uri]::EscapeDataString([string]$package.id)
    $purlVersion = [Uri]::EscapeDataString([string]$package.version)
    $components.Add([ordered]@{
        type = 'library'
        'bom-ref' = "pkg:nuget/$purlName@$purlVersion"
        name = [string]$package.id
        version = [string]$package.version
        purl = "pkg:nuget/$purlName@$purlVersion"
        properties = @(
            [ordered]@{ name = 'hub.desktop.dependencyKind'; value = if ($package.direct) { 'direct' } else { 'transitive' } },
            [ordered]@{ name = 'hub.desktop.projects'; value = (@($package.projects) | Sort-Object) -join ',' }
        )
    })
}

foreach ($prerequisite in @($prerequisites | Sort-Object file_name)) {
    $fileName = [string]$prerequisite.file_name
    $fileVersion = ([string]$prerequisite.file_version).Trim()
    if ([string]::IsNullOrWhiteSpace($fileVersion)) {
        $fileVersion = 'unknown'
    }
    $sha256 = ([string]$prerequisite.sha256).ToLowerInvariant()
    if ($sha256 -notmatch '^[0-9a-f]{64}$') {
        throw "Invalid prerequisite SHA-256: $fileName"
    }
    $components.Add([ordered]@{
        type = 'framework'
        'bom-ref' = "hub-prerequisite:$fileName@$fileVersion"
        name = [string]$prerequisite.name
        version = $fileVersion
        hashes = @([ordered]@{ alg = 'SHA-256'; content = $sha256 })
        properties = @([ordered]@{ name = 'hub.desktop.fileName'; value = $fileName })
    })
}

$seed = "HUB Desktop|$version|$runtimeIdentifier|" +
    (($components | ForEach-Object { "$($_['bom-ref'])" }) -join '|')
$seedHash = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($seed))
$guidBytes = [byte[]]::new(16)
[Array]::Copy($seedHash, $guidBytes, 16)
$guidBytes[7] = ($guidBytes[7] -band 0x0F) -bor 0x50
$guidBytes[8] = ($guidBytes[8] -band 0x3F) -bor 0x80
$serialNumber = 'urn:uuid:' + [Guid]::new($guidBytes).ToString()

$sbom = [ordered]@{
    '$schema' = 'http://cyclonedx.org/schema/bom-1.5.schema.json'
    bomFormat = 'CycloneDX'
    specVersion = '1.5'
    serialNumber = $serialNumber
    version = 1
    metadata = [ordered]@{
        tools = [ordered]@{
            components = @([ordered]@{
                type = 'application'
                name = 'HUB Desktop release scripts'
                version = '1'
            })
        }
        component = [ordered]@{
            type = 'application'
            'bom-ref' = "pkg:generic/HUB-Desktop@${version}?arch=x86_64&os=windows"
            name = 'HUB Desktop'
            version = $version
            properties = @(
                [ordered]@{ name = 'hub.desktop.runtimeIdentifier'; value = $runtimeIdentifier },
                [ordered]@{ name = 'hub.desktop.targetFramework'; value = $targetFramework }
            )
        }
    }
    components = @($components)
}

New-Item -ItemType Directory -Path $packageDirectory -Force | Out-Null
$json = $sbom | ConvertTo-Json -Depth 12
[IO.File]::WriteAllText($sbomPath, $json, [Text.UTF8Encoding]::new($false))
$hash = (Get-FileHash -LiteralPath $sbomPath -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($sbomPath))" |
    Set-Content -LiteralPath "$sbomPath.sha256" -Encoding ascii

[pscustomobject]@{
    Path = $sbomPath
    SHA256 = $hash
    Components = $components.Count
    SerialNumber = $serialNumber
}
