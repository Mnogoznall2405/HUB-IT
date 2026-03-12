param(
    [switch]$SaveState
)

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$ecosystemAll = Join-Path $projectRoot 'scripts\pm2\ecosystem.all.config.js'
$processNames = @('itinvent-backend', 'itinvent-scan', 'itinvent-bot')

function Get-Pm2Snapshot {
    $jlistRaw = & pm2 jlist 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $jlistRaw) {
        return @()
    }

    $rows = @(
        $jlistRaw | & node -e "const fs=require('fs'); const raw=fs.readFileSync(0,'utf8'); const data=JSON.parse(raw); for (const item of data) { const status=(item.pm2_env&&item.pm2_env.status)||''; const pid=item.pid||0; const restarts=(item.pm2_env&&item.pm2_env.restart_time)||0; const mem=((item.monit&&item.monit.memory)||0)/1024/1024; console.log([item.name||'', status, String(pid), mem.toFixed(1), String(restarts)].join('\t')); }"
    )

    return @(
        $rows | ForEach-Object {
            if (-not $_) { return }
            $parts = $_ -split "`t"
            [pscustomobject]@{
                Name      = $parts[0]
                Status    = $parts[1]
                PID       = $parts[2]
                MemoryMB  = $parts[3]
                Restarts  = $parts[4]
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

Write-Host 'PM2: cleaning old processes...' -ForegroundColor Cyan
foreach ($name in $processNames) {
    if ($existingProcesses -contains $name) {
        & pm2 delete $name | Out-Null
    }
}

Write-Host 'PM2: starting all processes...' -ForegroundColor Cyan
& pm2 start $ecosystemAll | Out-Null

Write-Host 'PM2: current process list:' -ForegroundColor Cyan
Show-Pm2Snapshot

if ($SaveState) {
    Write-Host 'PM2: saving current state...' -ForegroundColor Cyan
    & pm2 save | Out-Host
}
