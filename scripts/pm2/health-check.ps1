param(
    [string]$BackendUrl = 'http://127.0.0.1:8001/health',
    [string]$ScanUrl = 'http://127.0.0.1:8011/health'
)

$ErrorActionPreference = 'Stop'

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

function Test-HttpHealth {
    param(
        [string]$Name,
        [string]$Url
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        return [pscustomobject]@{
            Name    = $Name
            Status  = if ($response.StatusCode -eq 200) { 'ok' } else { 'warn' }
            Details = "$($response.StatusCode) $Url"
        }
    } catch {
        return [pscustomobject]@{
            Name    = $Name
            Status  = 'fail'
            Details = $_.Exception.Message
        }
    }
}

Write-Host 'PM2 process status:' -ForegroundColor Cyan
$snapshot = Get-Pm2Snapshot
if (-not $snapshot -or $snapshot.Count -eq 0) {
    Write-Host 'No PM2 processes found.' -ForegroundColor Yellow
} else {
    $snapshot |
        Sort-Object Name |
        Format-Table Name, Status, PID, MemoryMB, Restarts -AutoSize
}

Write-Host 'HTTP health checks:' -ForegroundColor Cyan
$healthRows = @(
    Test-HttpHealth -Name 'backend-health' -Url $BackendUrl
    Test-HttpHealth -Name 'scan-health' -Url $ScanUrl
)
$healthRows | Format-Table Name, Status, Details -AutoSize
