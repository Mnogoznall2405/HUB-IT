param(
    [switch]$SaveState
)

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$processNames = @('itinvent-backend', 'itinvent-chat-push-worker', 'itinvent-ai-chat-worker', 'itinvent-inventory', 'itinvent-scan', 'itinvent-scan-worker', 'itinvent-bot')

function Resolve-Pm2Command {
    $preferredGlobalPm2Cmd = Join-Path $env:APPDATA 'npm\pm2.cmd'
    if (Test-Path $preferredGlobalPm2Cmd) {
        return $preferredGlobalPm2Cmd
    }

    $globalPm2Cmd = (where.exe pm2.cmd 2>$null | Where-Object { $_ -and ($_ -notlike "$projectRoot*") } | Select-Object -First 1)
    if ($globalPm2Cmd) {
        return $globalPm2Cmd.Trim()
    }

    $globalPm2 = (Get-Command 'pm2' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
    if ($globalPm2) {
        return $globalPm2
    }

    $localPm2 = Join-Path $projectRoot 'pm2.cmd'
    if (Test-Path $localPm2) {
        & $localPm2 --version *> $null
        if ($LASTEXITCODE -eq 0) {
            return $localPm2
        }
    }

    throw 'PM2 command not found.'
}

$pm2Cmd = Resolve-Pm2Command

function Get-Pm2Snapshot {
    try {
        $jlistRaw = & $pm2Cmd jlist 2>$null
    } catch {
        return @()
    }
    if ($LASTEXITCODE -ne 0 -or -not $jlistRaw) {
        return @()
    }

    try {
        $rows = @(($jlistRaw -join "`n") | ConvertFrom-Json -Depth 10)
    } catch {
        return @()
    }

    return @(
        $rows | ForEach-Object {
            if (-not $_) { return }
            [pscustomobject]@{
                Name      = $_.name
                Status    = $_.pm2_env.status
                PID       = $_.pid
                MemoryMB  = '{0:N1}' -f ((($_.monit.memory) | ForEach-Object { [double]$_ }) / 1MB)
                Restarts  = $_.pm2_env.restart_time
            }
        }
    )
}

function Show-Pm2Snapshot {
    $snapshot = Get-Pm2Snapshot
    if (-not $snapshot -or $snapshot.Count -eq 0) {
        Write-Host 'No PM2 processes found.' -ForegroundColor Yellow
        return
    }

    $snapshot |
        Sort-Object Name |
        Format-Table Name, Status, PID, MemoryMB, Restarts -AutoSize
}

$existingProcesses = @(Get-Pm2Snapshot | ForEach-Object { $_.Name })
if (-not $existingProcesses) {
    $existingProcesses = @()
}

Write-Host 'PM2: stopping managed processes...' -ForegroundColor Cyan
foreach ($name in $processNames) {
    if ($existingProcesses -contains $name) {
        & $pm2Cmd stop $name | Out-Null
    }
}

Write-Host 'PM2: current process list:' -ForegroundColor Cyan
Show-Pm2Snapshot

if ($SaveState) {
    Write-Host 'PM2: saving current state...' -ForegroundColor Cyan
    & $pm2Cmd save | Out-Host
}
