#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [ValidateSet('20260818_0100', '20260822_0101')]
    [string]$ExpectedCurrentRevision = '20260818_0100',
    [string]$BackupPath = '',
    [switch]$OfflinePlan,
    [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$targetRevision = '20260823_0102'
$repoRoot = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path).TrimEnd('\', '/')
$preflightScript = Join-Path $PSScriptRoot 'mobile_migration_preflight.py'
$webRoot = Join-Path $repoRoot 'WEB-itinvent'

function Invoke-MigrationPreflight([switch]$Offline) {
    $arguments = @($preflightScript)
    if ($Offline) { $arguments += '--offline' }
    $output = & python @arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'Mobile migration preflight did not pass.'
    }
    try {
        return ($output -join "`n") | ConvertFrom-Json
    } catch {
        throw 'Mobile migration preflight returned invalid JSON.'
    }
}

function Resolve-BackupFile([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw 'BackupPath is required with -Execute.'
    }
    $resolved = [IO.Path]::GetFullPath($Path)
    if (
        $resolved.Equals($repoRoot, [StringComparison]::OrdinalIgnoreCase) -or
        $resolved.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
    ) {
        throw 'Production database backup must be outside the repository.'
    }
    if ([IO.Path]::GetExtension($resolved) -ne '.dump') {
        throw 'BackupPath must use the .dump extension.'
    }
    $parent = Split-Path $resolved -Parent
    if (-not $parent -or -not (Test-Path -LiteralPath $parent -PathType Container)) {
        throw "Backup parent directory must already exist: $parent"
    }
    if (Test-Path -LiteralPath $resolved) {
        throw "Refusing to overwrite an existing database backup: $resolved"
    }
    return $resolved
}

function Resolve-PostgresTool([string]$Name) {
    $candidates = @()
    if ($env:HUBIT_POSTGRES_BIN) {
        $candidates += Join-Path $env:HUBIT_POSTGRES_BIN "$Name.exe"
    }
    $command = Get-Command "$Name.exe" -ErrorAction SilentlyContinue
    if ($command -and $command.Path) { $candidates += $command.Path }
    $resolved = $candidates |
        Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
        Select-Object -First 1
    if (-not $resolved) {
        throw "$Name.exe was not found. Set HUBIT_POSTGRES_BIN to the approved PostgreSQL client tools."
    }
    return [IO.Path]::GetFullPath([string]$resolved)
}

if ($OfflinePlan) {
    if ($Execute) { throw '-OfflinePlan cannot be combined with -Execute.' }
    $offline = Invoke-MigrationPreflight -Offline
    return [pscustomobject]@{
        Mode = 'offline_plan'
        RepositoryHead = [string]$offline.repository_head
        TargetRevision = $targetRevision
        ExpectedCurrentRevision = $ExpectedCurrentRevision
        ProductionConnected = $false
        WritesPerformed = $false
    }
}

if ([string]::IsNullOrWhiteSpace([string]$env:APP_DATABASE_URL)) {
    throw 'APP_DATABASE_URL must be provided through the protected process environment.'
}
$preflight = Invoke-MigrationPreflight
$status = [string]$preflight.assessment.status
$currentRevisions = @($preflight.current_revisions | ForEach-Object { [string]$_ })
if ($status -eq 'already_current') {
    return [pscustomobject]@{
        Mode = 'already_current'
        TargetRevision = $targetRevision
        CurrentRevision = $currentRevisions[0]
        WritesPerformed = $false
    }
}
if ($status -ne 'ready' -or $currentRevisions.Count -ne 1) {
    throw 'Production migration preflight requires review; no write was performed.'
}
if ($currentRevisions[0] -ne $ExpectedCurrentRevision) {
    throw 'Production revision does not match ExpectedCurrentRevision; no write was performed.'
}
if (-not $Execute) {
    return [pscustomobject]@{
        Mode = 'database_plan'
        TargetRevision = $targetRevision
        CurrentRevision = $currentRevisions[0]
        LongTransactions = [int]$preflight.activity.long_transactions_over_5m
        WaitingLocks = [int]$preflight.activity.waiting_locks
        WritesPerformed = $false
    }
}

$resolvedBackup = Resolve-BackupFile $BackupPath
$pgDump = Resolve-PostgresTool 'pg_dump'
$pgRestore = Resolve-PostgresTool 'pg_restore'
if (-not $PSCmdlet.ShouldProcess(
    "production app database $($currentRevisions[0]) -> $targetRevision",
    "Create schema backup and apply only the two HUB-IT mobile migrations"
)) {
    return [pscustomobject]@{
        Mode = 'what_if'
        TargetRevision = $targetRevision
        CurrentRevision = $currentRevisions[0]
        Backup = $resolvedBackup
        WritesPerformed = $false
    }
}

$previousPgDatabase = [Environment]::GetEnvironmentVariable('PGDATABASE')
$previousSkipDocs = [Environment]::GetEnvironmentVariable('SKIP_PG_SCHEMA_DOCS')
$env:PGDATABASE = ([string]$env:APP_DATABASE_URL) -replace '^postgresql\+[^:]+://', 'postgresql://'
$env:SKIP_PG_SCHEMA_DOCS = '1'
try {
    & $pgDump `
        --format=custom `
        --compress=9 `
        --no-owner `
        --no-privileges `
        --schema=app `
        --schema=system `
        --file=$resolvedBackup
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $resolvedBackup -PathType Leaf)) {
        throw 'pg_dump did not create the required production backup.'
    }
    $backupItem = Get-Item -LiteralPath $resolvedBackup
    if ($backupItem.Length -le 0) { throw 'Production database backup is empty.' }
    & $pgRestore --list $resolvedBackup | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'pg_restore could not validate the production backup archive.' }

    Push-Location $webRoot
    try {
        & python -m alembic -c backend/alembic.ini upgrade $targetRevision
        if ($LASTEXITCODE -ne 0) { throw 'Alembic mobile migration failed.' }
    } finally {
        Pop-Location
    }

    $postflight = Invoke-MigrationPreflight
    if (
        [string]$postflight.assessment.status -ne 'already_current' -or
        @($postflight.current_revisions)[0] -ne $targetRevision
    ) {
        throw 'Post-migration read-only verification did not confirm the target revision.'
    }

    return [pscustomobject]@{
        Mode = 'applied'
        PreviousRevision = $ExpectedCurrentRevision
        CurrentRevision = $targetRevision
        Backup = $resolvedBackup
        BackupSizeBytes = $backupItem.Length
        BackupSHA256 = (Get-FileHash -LiteralPath $resolvedBackup -Algorithm SHA256).Hash.ToLowerInvariant()
        WritesPerformed = $true
        AutomaticDowngrade = $false
    }
} finally {
    if ($null -eq $previousPgDatabase) {
        Remove-Item Env:PGDATABASE -ErrorAction SilentlyContinue
    } else {
        $env:PGDATABASE = $previousPgDatabase
    }
    if ($null -eq $previousSkipDocs) {
        Remove-Item Env:SKIP_PG_SCHEMA_DOCS -ErrorAction SilentlyContinue
    } else {
        $env:SKIP_PG_SCHEMA_DOCS = $previousSkipDocs
    }
}
