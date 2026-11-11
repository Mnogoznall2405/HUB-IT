<#
.SYNOPSIS
  Safe backup of project .env outside the git repository.

.DESCRIPTION
  Copies C:\Project\Image_scan\.env to C:\Backups\hub-it\env\ (default) as a
  timestamped file and env-latest.bak. Keeps the 10 newest timestamped backups.
  Run before editing secrets: powershell -File scripts\backup-env.ps1

.PARAMETER DestinationPath
  Override backup directory (must not be inside the repo or a git-tracked path).
#>
param(
    [string]$DestinationPath = 'C:\Backups\hub-it\env'
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $ProjectRoot '.env'

function Resolve-FullPath {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return [IO.Path]::GetFullPath($Path)
    }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Test-IsUnderPath {
    param(
        [string]$Child,
        [string]$Parent
    )
    $childFull = (Resolve-FullPath $Child).TrimEnd('\') + '\'
    $parentFull = (Resolve-FullPath $Parent).TrimEnd('\') + '\'
    return $childFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)
}

function Get-RelativePathCompat {
    param(
        [string]$From,
        [string]$To
    )
    $fromUri = New-Object Uri((Join-Path $From '.'))
    $toUri = New-Object Uri((Resolve-FullPath $To))
    $relativeUri = $fromUri.MakeRelativeUri($toUri)
    return [Uri]::UnescapeDataString($relativeUri.ToString()).Replace('/', '\')
}

function Test-GitTrackedPath {
    param([string]$Path)

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        return $false
    }

    if (-not (Test-IsUnderPath -Child $Path -Parent $ProjectRoot)) {
        return $false
    }

    Push-Location $ProjectRoot
    try {
        $relative = Get-RelativePathCompat -From $ProjectRoot -To $Path
        if ($relative -eq '.' -or $relative -eq '') {
            return $true
        }
        & git ls-files --error-unmatch -- $relative 2>$null | Out-Null
        return ($LASTEXITCODE -eq 0)
    }
    finally {
        Pop-Location
    }
}

function Assert-SafeBackupDestination {
    param([string]$DestinationDir)

    $destFull = Resolve-FullPath $DestinationDir

    if (Test-IsUnderPath -Child $destFull -Parent $ProjectRoot) {
        throw "Refusing to write backup inside the repository: $destFull"
    }

    $gitDir = Join-Path $ProjectRoot '.git'
    if (Test-IsUnderPath -Child $destFull -Parent $gitDir) {
        throw "Refusing to write backup inside .git: $destFull"
    }

    if (Test-GitTrackedPath -Path $destFull) {
        throw "Refusing to write backup to a git-tracked path: $destFull"
    }

    return $destFull
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw ".env not found: $EnvFile"
}

$destDir = Assert-SafeBackupDestination -DestinationDir $DestinationPath
New-Item -ItemType Directory -Path $destDir -Force | Out-Null

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$timestampedName = "env-$timestamp.bak"
$timestampedPath = Join-Path $destDir $timestampedName
$latestPath = Join-Path $destDir 'env-latest.bak'

Copy-Item -LiteralPath $EnvFile -Destination $timestampedPath -Force
Copy-Item -LiteralPath $EnvFile -Destination $latestPath -Force

$retentionPattern = '^env-\d{8}-\d{6}\.bak$'
Get-ChildItem -LiteralPath $destDir -File |
    Where-Object { $_.Name -match $retentionPattern } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 10 |
    ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Force
    }

Write-Host "Backup saved: $timestampedPath" -ForegroundColor Green
Write-Host "Latest copy:  $latestPath" -ForegroundColor Green
