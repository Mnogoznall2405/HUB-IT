param(
    [string]$BackendUrl = 'http://127.0.0.1:8001/health',
    [string]$ScanUrl = 'http://127.0.0.1:8011/health'
)

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$pm2Cmd = Join-Path $projectRoot 'pm2.cmd'

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
