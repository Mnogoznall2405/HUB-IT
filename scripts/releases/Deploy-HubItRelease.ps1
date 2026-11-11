<#
.SYNOPSIS
Verifies and deploys a published HUB-IT release on a Windows IIS/PM2 host.

.DESCRIPTION
The script is intentionally bound to the existing C:\Project\Image_scan
runtime layout because the PM2 ecosystem files use that location. It preserves
.env and mutable runtime directories while mirroring versioned source files.

Run without -Apply first. The apply stage stops PM2, updates the project files,
publishes the already-built frontend to IIS, starts PM2, and runs health checks.
Database migrations are deliberately not automatic: perform a verified
PostgreSQL backup and run them as a separate change-controlled operation.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ReleaseArchivePath,
    [ValidateSet('Development', 'Production')]
    [string]$ReleaseEnvironment = 'Production',
    [string]$ProjectRoot = 'C:\Project\Image_scan',
    [string]$IisSitePath = 'C:\inetpub\wwwroot\itinvent',
    [string]$ExpectedCanonicalHost,
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

function Invoke-RobocopyMirror {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,
        [Parameter(Mandatory = $true)]
        [string]$Destination,
        [string[]]$ExcludedDirectories = @(),
        [string[]]$ExcludedFiles = @()
    )

    $arguments = @($Source, $Destination, '/MIR', '/R:2', '/W:2', '/NFL', '/NDL', '/NJH', '/NJS')
    if ($ExcludedDirectories.Count -gt 0) {
        $arguments += '/XD'
        $arguments += $ExcludedDirectories
    }
    if ($ExcludedFiles.Count -gt 0) {
        $arguments += '/XF'
        $arguments += $ExcludedFiles
    }

    & robocopy @arguments | Out-Host
    if ($LASTEXITCODE -ge 8) {
        throw "robocopy failed with exit code $LASTEXITCODE"
    }
}

$archivePath = (Resolve-Path -LiteralPath $ReleaseArchivePath).Path
$archiveName = Split-Path -Leaf $archivePath
$releaseDirectory = Split-Path -Parent $archivePath
$checksumPath = Join-Path $releaseDirectory ($archiveName + '.sha256')
$readyPath = Join-Path $releaseDirectory ($archiveName + '.ready.json')

foreach ($requiredPath in @($checksumPath, $readyPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Published release sidecar is missing: $requiredPath"
    }
}

$checksumLine = (Get-Content -LiteralPath $checksumPath -TotalCount 1).Trim()
$expectedHash = ($checksumLine -split '\s+')[0].ToUpperInvariant()
if ($expectedHash -notmatch '^[A-F0-9]{64}$') {
    throw "Invalid SHA-256 sidecar: $checksumPath"
}
$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToUpperInvariant()
if ($actualHash -ne $expectedHash) {
    throw "Release checksum mismatch: $archiveName"
}

$ready = Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json
if ($ready.archive -ne $archiveName -or $ready.sha256.ToUpperInvariant() -ne $actualHash) {
    throw "Ready marker does not match release archive: $readyPath"
}

$stagePath = Join-Path ([IO.Path]::GetTempPath()) ("hub-it-deploy-$PID")
try {
    Expand-Archive -LiteralPath $archivePath -DestinationPath $stagePath -Force
    $manifestPath = Join-Path $stagePath 'release-manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw 'release-manifest.json is missing from the archive.'
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $defaultHosts = @{ Development = 'hubitdev.zsgp.ru'; Production = 'hubit.zsgp.ru' }
    if ([string]::IsNullOrWhiteSpace($ExpectedCanonicalHost)) {
        $ExpectedCanonicalHost = $defaultHosts[$ReleaseEnvironment]
    }

    if ($manifest.environment -ne $ReleaseEnvironment) {
        throw "Release environment '$($manifest.environment)' does not match '$ReleaseEnvironment'."
    }
    if ($manifest.canonical_host -ne $ExpectedCanonicalHost) {
        throw "Release canonical host '$($manifest.canonical_host)' does not match '$ExpectedCanonicalHost'."
    }

    $requiredReleasePaths = @(
        'WEB-itinvent\frontend\dist\index.html',
        'WEB-itinvent\frontend\dist\web.config',
        'scripts\pm2\start-all.ps1',
        'scripts\pm2\stop-all.ps1',
        'scripts\pm2\health-check.ps1'
    )
    foreach ($relativePath in $requiredReleasePaths) {
        if (-not (Test-Path -LiteralPath (Join-Path $stagePath $relativePath))) {
            throw "Release archive is incomplete: $relativePath"
        }
    }

    Write-Host "Release verified: $($manifest.version) ($($manifest.git_commit))" -ForegroundColor Green
    Write-Host "Environment: $ReleaseEnvironment; host: $ExpectedCanonicalHost" -ForegroundColor Green
    if (-not $Apply) {
        Write-Host 'Verification only. Rerun with -Apply to publish this release.' -ForegroundColor Yellow
        return
    }

    if ($ProjectRoot -ne 'C:\Project\Image_scan') {
        throw 'This deployment script currently supports only C:\Project\Image_scan because the PM2 ecosystem uses that fixed path.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot '.env'))) {
        throw "Production .env is missing: $ProjectRoot\.env"
    }

    Invoke-CheckedCommand -FilePath 'powershell' -Arguments @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $ProjectRoot 'scripts\pm2\stop-all.ps1')
    )

    Invoke-RobocopyMirror -Source $stagePath -Destination $ProjectRoot -ExcludedDirectories @(
        '.git', '.venv', 'venv', 'node_modules', 'data', 'backups', 'logs', 'tools', 'WEB-itinvent\uploads'
    ) -ExcludedFiles @('.env')

    Invoke-RobocopyMirror -Source (Join-Path $ProjectRoot 'WEB-itinvent\frontend\dist') -Destination $IisSitePath

    Invoke-CheckedCommand -FilePath 'powershell' -Arguments @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $ProjectRoot 'scripts\pm2\start-all.ps1')
    )
    Invoke-CheckedCommand -FilePath 'powershell' -Arguments @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $ProjectRoot 'scripts\pm2\health-check.ps1')
    )

    Write-Host "Release deployed: $($manifest.version)" -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $stagePath) {
        Remove-Item -LiteralPath $stagePath -Recurse -Force
    }
}
