param(
    [switch]$SaveState
)

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$pm2Cmd = Join-Path $projectRoot 'pm2.cmd'
$processNames = @('itinvent-backend', 'itinvent-scan', 'itinvent-bot')

function Get-Pm2Snapshot {
    $jlistRaw = & $pm2Cmd jlist 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $jlistRaw) {
        return @()
    }

    try {
        $rows = @($jlistRaw | ConvertFrom-Json -Depth 10)
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
