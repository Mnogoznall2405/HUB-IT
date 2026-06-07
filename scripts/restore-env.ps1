<#
.SYNOPSIS
  Restore project .env from an external backup.

.DESCRIPTION
  Copies a backup file to C:\Project\Image_scan\.env after confirmation.
  After restore, restart PM2 processes: pm2 restart all --update-env

.PARAMETER BackupFile
  Path to a .bak file. Defaults to C:\Backups\hub-it\env\env-latest.bak

.PARAMETER BackupDir
  Directory used when -BackupFile is omitted.
#>
param(
    [string]$BackupFile,
    [string]$BackupDir = 'C:\Backups\hub-it\env'
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $ProjectRoot '.env'

if (-not $BackupFile) {
    $BackupFile = Join-Path $BackupDir 'env-latest.bak'
}

if (-not (Test-Path -LiteralPath $BackupFile)) {
    throw "Backup file not found: $BackupFile"
}

Write-Host "Restore target: $EnvFile" -ForegroundColor Cyan
Write-Host "From backup:    $BackupFile" -ForegroundColor Cyan
Write-Host ''
$confirm = Read-Host 'Overwrite .env? Type YES to continue'
if ($confirm -ne 'YES') {
    Write-Host 'Restore cancelled.' -ForegroundColor Yellow
    exit 0
}

Copy-Item -LiteralPath $BackupFile -Destination $EnvFile -Force

Write-Host "Restored .env from: $BackupFile" -ForegroundColor Green
Write-Host 'Restart services to pick up changes:' -ForegroundColor Yellow
Write-Host '  pm2 restart all --update-env' -ForegroundColor Yellow
Write-Host '  # or: powershell -File scripts\pm2\restart-all.ps1' -ForegroundColor DarkGray
