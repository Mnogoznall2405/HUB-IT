param(
    [int]$Port = 8001,
    [string]$ProcessName = 'itinvent-backend'
)

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$ecosystemBackend = Join-Path $projectRoot 'scripts\pm2\ecosystem.backend.config.js'

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

    throw 'PM2 command not found.'
}

function Get-PortListenerPids {
    param([int]$ListenPort)

    $pids = @()
    $lines = netstat -ano | Select-String ":$ListenPort\s+.*LISTENING"
    foreach ($line in $lines) {
        $parts = ($line -split '\s+') | Where-Object { $_ }
        if ($parts.Count -ge 1) {
            $pidText = $parts[-1]
            if ($pidText -match '^\d+$') {
                $pids += [int]$pidText
            }
        }
    }

    return @($pids | Sort-Object -Unique)
}

function Stop-OrphanBackendProcesses {
    param([int]$ListenPort)

    $listenerPids = Get-PortListenerPids -ListenPort $ListenPort
    foreach ($listenerPid in $listenerPids) {
        Write-Host "Killing listener on port $ListenPort (PID $listenerPid)..." -ForegroundColor Yellow
        taskkill /PID $listenerPid /T /F 2>$null | Out-Null
    }

    $orphans = Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'start_server\.py' }

    foreach ($proc in $orphans) {
        if ($listenerPids -contains $proc.ProcessId) {
            continue
        }
        Write-Host "Killing orphan start_server.py (PID $($proc.ProcessId))..." -ForegroundColor Yellow
        taskkill /PID $proc.ProcessId /T /F 2>$null | Out-Null
    }
}

$pm2Cmd = Resolve-Pm2Command

Write-Host "PM2: stopping $ProcessName..." -ForegroundColor Cyan
& $pm2Cmd stop $ProcessName | Out-Null
Start-Sleep -Seconds 2

Write-Host "PM2: clearing port $Port listeners..." -ForegroundColor Cyan
Stop-OrphanBackendProcesses -ListenPort $Port
Start-Sleep -Seconds 1

$remaining = Get-PortListenerPids -ListenPort $Port
if ($remaining.Count -gt 0) {
    throw "Port $Port is still in use by PID(s): $($remaining -join ', ')"
}

Write-Host "PM2: reloading $ProcessName with updated ecosystem..." -ForegroundColor Cyan
& $pm2Cmd delete $ProcessName 2>$null | Out-Null
& $pm2Cmd start $ecosystemBackend --only $ProcessName --update-env | Out-Null
Start-Sleep -Seconds 8

Write-Host ''
Write-Host 'PM2 backend status:' -ForegroundColor Cyan
& $pm2Cmd list

$listener = Get-PortListenerPids -ListenPort $Port
if ($listener.Count -eq 0) {
    throw "Backend did not bind to port $Port"
}

Write-Host "Port $Port listener PID: $($listener[0])" -ForegroundColor Green

Write-Host 'PM2: restarting scan services to reload shared JWT auth config...' -ForegroundColor Cyan
& $pm2Cmd restart itinvent-scan itinvent-scan-worker --update-env | Out-Null
Start-Sleep -Seconds 5

$logs = & $pm2Cmd logs $ProcessName --lines 10 --nostream 2>$null
$uvicornLine = $logs | Select-String 'Uvicorn running on http://127.0.0.1:' | Select-Object -Last 1
if ($uvicornLine) {
    Write-Host $uvicornLine.Line.Trim() -ForegroundColor Green
} else {
    Write-Host 'Warning: Uvicorn startup line not found in recent logs.' -ForegroundColor Yellow
    & $pm2Cmd logs $ProcessName --lines 20 --nostream
}
