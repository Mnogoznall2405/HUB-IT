<#
.SYNOPSIS
Builds an immutable HUB-IT release archive from the current Git commit.

.DESCRIPTION
Builds the web frontend, exports only tracked source files with git archive,
and appends the built frontend dist directory. The resulting archive never
contains the local .env, runtime data, virtual environments, or node_modules.

When -Destination is supplied, the archive is published to an SMB incoming
directory. A .ready.json marker is written last, so the production receiver
must process only releases that have this marker.
#>
[CmdletBinding()]
param(
    [string]$Version,
    [string]$OutputDirectory = 'C:\Backups\hub-it\releases',
    [string]$Destination,
    [ValidateSet('Development', 'Production')]
    [string]$ReleaseEnvironment = 'Production',
    [string]$CanonicalHost,
    [switch]$RunFrontendTests,
    [switch]$SkipFrontendBuild,
    [switch]$SkipWorkingTreeCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$FrontendRoot = Join-Path $ProjectRoot 'WEB-itinvent\frontend'

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
}

function Add-ProjectNodeToPath {
    $bundledNode = Join-Path $ProjectRoot 'tools\node-v24.14.0-win-x64-full'
    $nodeExe = Join-Path $bundledNode 'node.exe'

    if ((Test-Path -LiteralPath $nodeExe) -and $env:PATH -notlike "*$bundledNode*") {
        $env:PATH = "$bundledNode;$env:PATH"
    }

    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw 'npm was not found. Install Node.js or add the project Node runtime.'
    }
}

function Assert-PathOutsideProject {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    $projectPrefix = ([IO.Path]::GetFullPath($ProjectRoot)).TrimEnd('\') + '\'
    $candidate = [IO.Path]::GetFullPath($Path)
    if ($candidate.StartsWith($projectPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Description must be outside the repository: $candidate"
    }
}

function Copy-ReleaseToIncoming {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ReleaseArchive,
        [Parameter(Mandatory = $true)]
        [string]$ManifestPath,
        [Parameter(Mandatory = $true)]
        [string]$ChecksumPath,
        [Parameter(Mandatory = $true)]
        [string]$IncomingDirectory,
        [Parameter(Mandatory = $true)]
        [string]$ReleaseVersion,
        [Parameter(Mandatory = $true)]
        [string]$Sha256,
        [Parameter(Mandatory = $true)]
        [string]$EnvironmentName,
        [Parameter(Mandatory = $true)]
        [string]$HostName
    )

    if (-not (Test-Path -LiteralPath $IncomingDirectory)) {
        throw "Incoming directory does not exist: $IncomingDirectory"
    }

    $archiveName = Split-Path -Leaf $ReleaseArchive
    $remoteArchive = Join-Path $IncomingDirectory $archiveName
    $remoteManifest = Join-Path $IncomingDirectory ($archiveName + '.manifest.json')
    $remoteChecksum = Join-Path $IncomingDirectory ($archiveName + '.sha256')
    $remoteReady = Join-Path $IncomingDirectory ($archiveName + '.ready.json')
    $temporaryArchive = $remoteArchive + '.uploading'

    foreach ($path in @($remoteArchive, $remoteManifest, $remoteChecksum, $remoteReady, $temporaryArchive)) {
        if (Test-Path -LiteralPath $path) {
            throw "Release already exists on the destination: $path"
        }
    }

    Copy-Item -LiteralPath $ReleaseArchive -Destination $temporaryArchive -ErrorAction Stop
    $remoteHash = (Get-FileHash -LiteralPath $temporaryArchive -Algorithm SHA256).Hash
    if ($remoteHash -ne $Sha256) {
        throw "Checksum mismatch after copying $archiveName to $IncomingDirectory"
    }

    Move-Item -LiteralPath $temporaryArchive -Destination $remoteArchive -ErrorAction Stop
    Copy-Item -LiteralPath $ManifestPath -Destination $remoteManifest -ErrorAction Stop
    Copy-Item -LiteralPath $ChecksumPath -Destination $remoteChecksum -ErrorAction Stop

    [ordered]@{
        schema_version = 1
        version = $ReleaseVersion
        archive = $archiveName
        sha256 = $Sha256
        environment = $EnvironmentName
        canonical_host = $HostName
        published_at_utc = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $remoteReady -Encoding utf8
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'git was not found.'
}

Push-Location $ProjectRoot
try {
    $commit = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to resolve the current Git commit.'
    }

    $shortCommit = (& git rev-parse --short=12 HEAD).Trim()
    $branch = (& git branch --show-current).Trim()
    $worktreeStatus = @(& git status --porcelain)
    if (-not $SkipWorkingTreeCheck -and $worktreeStatus.Count -gt 0) {
        throw 'Refusing to build a release from a dirty worktree. Commit or stash changes first, then rerun. Use -SkipWorkingTreeCheck only when intentionally packaging the current commit without local changes.'
    }
}
finally {
    Pop-Location
}

if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = 'v{0}-{1}' -f (Get-Date -Format 'yyyy.MM.dd.HHmm'), $shortCommit
}

$defaultHosts = @{
    Development = 'hubitdev.zsgp.ru'
    Production = 'hubit.zsgp.ru'
}
if ([string]::IsNullOrWhiteSpace($CanonicalHost)) {
    $CanonicalHost = $defaultHosts[$ReleaseEnvironment]
}
$CanonicalHost = $CanonicalHost.Trim().ToLowerInvariant()
if ($CanonicalHost -notmatch '^[a-z0-9.-]+$') {
    throw 'CanonicalHost may contain only letters, digits, dots, and hyphens.'
}
if ($Version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') {
    throw 'Version may contain only letters, digits, dots, underscores, and hyphens.'
}

Assert-PathOutsideProject -Path $OutputDirectory -Description 'OutputDirectory'
if ($Destination) {
    Assert-PathOutsideProject -Path $Destination -Description 'Destination'
}

Add-ProjectNodeToPath
if (-not (Test-Path -LiteralPath $FrontendRoot)) {
    throw "Frontend directory not found: $FrontendRoot"
}

$previousCanonicalHost = $env:VITE_CANONICAL_HOST
$hadCanonicalHost = Test-Path 'Env:VITE_CANONICAL_HOST'
$env:VITE_CANONICAL_HOST = $CanonicalHost

try {
    if (-not $SkipFrontendBuild) {
        Push-Location $FrontendRoot
        try {
            if ($RunFrontendTests) {
                Invoke-CheckedCommand -FilePath 'npm' -Arguments @('run', 'test:run')
            }
            Invoke-CheckedCommand -FilePath 'npm' -Arguments @('run', 'build')
        }
        finally {
            Pop-Location
        }
    }
}
finally {
    if ($hadCanonicalHost) {
        $env:VITE_CANONICAL_HOST = $previousCanonicalHost
    } else {
        Remove-Item 'Env:VITE_CANONICAL_HOST' -ErrorAction SilentlyContinue
    }
}

$distPath = Join-Path $FrontendRoot 'dist'
if (-not (Test-Path -LiteralPath (Join-Path $distPath 'index.html'))) {
    throw "Frontend dist is missing: $distPath. Run without -SkipFrontendBuild."
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$releaseName = "HUB-IT-$Version"
$releaseArchive = Join-Path $OutputDirectory ($releaseName + '.zip')
$manifestPath = Join-Path $OutputDirectory ($releaseName + '.manifest.json')
$checksumPath = Join-Path $OutputDirectory ($releaseName + '.sha256')

foreach ($path in @($releaseArchive, $manifestPath, $checksumPath)) {
    if (Test-Path -LiteralPath $path) {
        throw "Release output already exists: $path"
    }
}

$stagingPath = Join-Path ([IO.Path]::GetTempPath()) ("hub-it-release-$Version-$PID")
$sourceArchive = Join-Path ([IO.Path]::GetTempPath()) ("hub-it-source-$Version-$PID.zip")

try {
    New-Item -ItemType Directory -Path $stagingPath -Force | Out-Null

    Push-Location $ProjectRoot
    try {
        Invoke-CheckedCommand -FilePath 'git' -Arguments @('archive', '--format=zip', "--output=$sourceArchive", $commit)
    }
    finally {
        Pop-Location
    }

    Expand-Archive -LiteralPath $sourceArchive -DestinationPath $stagingPath -Force
    $stagedFrontend = Join-Path $stagingPath 'WEB-itinvent\frontend'
    Copy-Item -LiteralPath $distPath -Destination (Join-Path $stagedFrontend 'dist') -Recurse -Force
    $stagedWebConfig = Join-Path $stagedFrontend 'dist\web.config'
    $webConfig = Get-Content -LiteralPath $stagedWebConfig -Raw
    if ($webConfig -notlike '*__HUBIT_CANONICAL_HOST__*') {
        throw "Release web.config template marker is missing: $stagedWebConfig"
    }
    $webConfig.Replace('__HUBIT_CANONICAL_HOST__', $CanonicalHost) |
        Set-Content -LiteralPath $stagedWebConfig -Encoding utf8

    $manifest = [ordered]@{
        schema_version = 1
        product = 'HUB-IT'
        version = $Version
        git_commit = $commit
        git_branch = $branch
        environment = $ReleaseEnvironment
        canonical_host = $CanonicalHost
        created_at_utc = [DateTime]::UtcNow.ToString('o')
        frontend_dist_included = $true
        runtime_files_excluded = @('.env', 'data runtime files', 'node_modules', 'Python virtual environments')
    }
    $manifestJson = $manifest | ConvertTo-Json -Depth 4
    Set-Content -LiteralPath (Join-Path $stagingPath 'release-manifest.json') -Value $manifestJson -Encoding utf8

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stagingPath, $releaseArchive, [IO.Compression.CompressionLevel]::Optimal, $false)
    Set-Content -LiteralPath $manifestPath -Value $manifestJson -Encoding utf8

    $sha256 = (Get-FileHash -LiteralPath $releaseArchive -Algorithm SHA256).Hash
    Set-Content -LiteralPath $checksumPath -Value ("{0}  {1}" -f $sha256, (Split-Path -Leaf $releaseArchive)) -Encoding ascii

    if ($Destination) {
        Copy-ReleaseToIncoming -ReleaseArchive $releaseArchive -ManifestPath $manifestPath -ChecksumPath $checksumPath -IncomingDirectory $Destination -ReleaseVersion $Version -Sha256 $sha256 -EnvironmentName $ReleaseEnvironment -HostName $CanonicalHost
        Write-Host "Published to: $Destination" -ForegroundColor Green
    }

    Write-Host "Release archive: $releaseArchive" -ForegroundColor Green
    Write-Host "Profile:         $ReleaseEnvironment ($CanonicalHost)" -ForegroundColor Green
    Write-Host "Manifest:        $manifestPath" -ForegroundColor Green
    Write-Host "SHA-256:         $sha256" -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $stagingPath) {
        Remove-Item -LiteralPath $stagingPath -Recurse -Force
    }
    if (Test-Path -LiteralPath $sourceArchive) {
        Remove-Item -LiteralPath $sourceArchive -Force
    }
}
