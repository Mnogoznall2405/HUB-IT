[CmdletBinding()]
param(
    [ValidateSet('Release')]
    [string]$Configuration = 'Release',
    [switch]$NoRestore
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$projectPath = Join-Path $repoRoot 'desktop\Hub.Desktop\Hub.Desktop.csproj'
$runnerProjectPath = Join-Path $repoRoot 'desktop\Hub.Desktop.UpdateRunner\Hub.Desktop.UpdateRunner.csproj'
$projectDirectory = Split-Path -Parent $projectPath
$projectDocument = [xml](Get-Content -Raw -LiteralPath $projectPath)
$version = $projectDocument.SelectSingleNode('/Project/PropertyGroup/Version').InnerText
$targetFramework = $projectDocument.SelectSingleNode('/Project/PropertyGroup/TargetFramework').InnerText
$runtimeIdentifier = 'win-x64'
$publishDirectory = Join-Path $projectDirectory "bin\$Configuration\$targetFramework\$runtimeIdentifier\publish"
$packageDirectory = Join-Path $projectDirectory "bin\$Configuration\$targetFramework\$runtimeIdentifier\package"
$packageName = "HUB-Desktop-$version-$runtimeIdentifier"
$stagingDirectory = Join-Path $packageDirectory $packageName
$archivePath = Join-Path $packageDirectory "$packageName.zip"
$checksumPath = "$archivePath.sha256"
$runnerPublishDirectory = Join-Path $repoRoot ".codex_tmp\desktop-update-runner\$version"
$packageReadme = Join-Path $repoRoot 'desktop\package\README.txt'

if (-not (Test-Path -LiteralPath $packageReadme -PathType Leaf)) {
    throw "Package README is missing: $packageReadme"
}

$repoDotnet = Join-Path $repoRoot 'tools\dotnet-sdk-8\dotnet.exe'
$dotnetPath = if (Test-Path -LiteralPath $repoDotnet) {
    $repoDotnet
} else {
    (Get-Command dotnet -ErrorAction Stop).Source
}

function Assert-PackageChildPath([string]$Path) {
    $fullPackageDirectory = [System.IO.Path]::GetFullPath($packageDirectory)
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith(
        $fullPackageDirectory + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe package path: $fullPath"
    }
}

function Assert-RepoChildPath([string]$Path) {
    $fullRepoRoot = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar)
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith(
        $fullRepoRoot + [System.IO.Path]::DirectorySeparatorChar,
        [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe build output path: $fullPath"
    }
}

foreach ($outputDirectory in @($publishDirectory, $runnerPublishDirectory)) {
    Assert-RepoChildPath $outputDirectory
    if (Test-Path -LiteralPath $outputDirectory) {
        Remove-Item -LiteralPath $outputDirectory -Recurse -Force
    }
}

$publishArguments = @(
    'publish',
    $projectPath,
    '--configuration', $Configuration,
    '--runtime', $runtimeIdentifier,
    '-p:PublishProfile=win-x64',
    '--output', $publishDirectory
)
if ($NoRestore) {
    $publishArguments += '--no-restore'
}

& $dotnetPath @publishArguments
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE"
}

$runnerPublishArguments = @(
    'publish',
    $runnerProjectPath,
    '--configuration', $Configuration,
    '--runtime', $runtimeIdentifier,
    '--self-contained', 'true',
    '-p:PublishSingleFile=true',
    '-p:PublishTrimmed=true',
    "-p:Version=$version",
    '--output', $runnerPublishDirectory
)
if ($NoRestore) {
    $runnerPublishArguments += '--no-restore'
}

& $dotnetPath @runnerPublishArguments
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed for update runner with exit code $LASTEXITCODE"
}

$runnerPath = Join-Path $runnerPublishDirectory 'HUB.Desktop.UpdateRunner.exe'
if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
    throw "Published update runner is missing: $runnerPath"
}
Copy-Item -LiteralPath $runnerPath -Destination $publishDirectory -Force

$requiredFiles = @(
    'HUB.Desktop.exe',
    'HUB.Desktop.dll',
    'HUB.Desktop.UpdateRunner.exe',
    'appsettings.json',
    'Microsoft.Web.WebView2.Core.dll',
    'WebView2Loader.dll',
    'Microsoft.WindowsAppRuntime.dll',
    'Microsoft.WindowsAppRuntime.pri'
)
foreach ($requiredFile in $requiredFiles) {
    $requiredPath = Join-Path $publishDirectory $requiredFile
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Published output is missing $requiredFile"
    }
}

New-Item -ItemType Directory -Path $packageDirectory -Force | Out-Null
foreach ($target in @($stagingDirectory, $archivePath, $checksumPath)) {
    Assert-PackageChildPath $target
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}

New-Item -ItemType Directory -Path $stagingDirectory | Out-Null
Copy-Item -Path (Join-Path $publishDirectory '*') -Destination $stagingDirectory -Recurse -Force
Copy-Item -LiteralPath $packageReadme -Destination (Join-Path $stagingDirectory 'README.txt') -Force
Compress-Archive -LiteralPath $stagingDirectory -DestinationPath $archivePath -CompressionLevel Optimal

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $archiveEntries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    $requiredArchiveEntries = @(
        "$packageName/HUB.Desktop.exe",
        "$packageName/HUB.Desktop.UpdateRunner.exe",
        "$packageName/appsettings.json",
        "$packageName/WebView2Loader.dll",
        "$packageName/Microsoft.WindowsAppRuntime.dll",
        "$packageName/Microsoft.WindowsAppRuntime.pri",
        "$packageName/README.txt"
    )

    foreach ($requiredEntry in $requiredArchiveEntries) {
        if ($archiveEntries -notcontains $requiredEntry) {
            throw "Package archive is missing $requiredEntry"
        }
    }

    if ($archiveEntries | Where-Object { $_.EndsWith('.pdb', [System.StringComparison]::OrdinalIgnoreCase) }) {
        throw 'Package archive must not contain debug symbols'
    }
}
finally {
    $archive.Dispose()
}

$archiveHash = Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
"$($archiveHash.Hash.ToLowerInvariant())  $([System.IO.Path]::GetFileName($archivePath))" |
    Set-Content -LiteralPath $checksumPath -Encoding ascii

$publishedFiles = Get-ChildItem -LiteralPath $publishDirectory -File -Recurse
$publishedBytes = ($publishedFiles | Measure-Object -Property Length -Sum).Sum

[pscustomobject]@{
    Version = $version
    Runtime = $runtimeIdentifier
    Files = $publishedFiles.Count
    PublishedMiB = [math]::Round($publishedBytes / 1MB, 2)
    ArchiveMiB = [math]::Round((Get-Item -LiteralPath $archivePath).Length / 1MB, 2)
    Archive = $archivePath
    SHA256 = $archiveHash.Hash.ToLowerInvariant()
}
