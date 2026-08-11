param(
    [int]$Port = 8002,
    [string]$ProcessName = 'itinvent-chat',
    [string]$PreviewWorkerName = 'itinvent-preview-worker'
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

function Stop-OrphanChatProcesses {
    param([int]$ListenPort)

    $listenerPids = Get-PortListenerPids -ListenPort $ListenPort
    foreach ($listenerPid in $listenerPids) {
        Write-Host "Killing listener on port $ListenPort (PID $listenerPid)..." -ForegroundColor Yellow
        taskkill /PID $listenerPid /T /F 2>$null | Out-Null
    }

}

$pm2Cmd = Resolve-Pm2Command

Write-Host "PM2: stopping $ProcessName..." -ForegroundColor Cyan
try {
    & $pm2Cmd stop $ProcessName 2>$null | Out-Null
} catch {
    Write-Host "PM2: $ProcessName was not running (ok for first start)" -ForegroundColor DarkYellow
}
Start-Sleep -Seconds 2

Write-Host "PM2: clearing port $Port listeners..." -ForegroundColor Cyan
Stop-OrphanChatProcesses -ListenPort $Port
Start-Sleep -Seconds 1

$remaining = Get-PortListenerPids -ListenPort $Port
if ($remaining.Count -gt 0) {
    throw "Port $Port is still in use by PID(s): $($remaining -join ', ')"
}

Write-Host "PM2: reloading $ProcessName with updated ecosystem..." -ForegroundColor Cyan
try {
    & $pm2Cmd delete $ProcessName 2>$null | Out-Null
} catch {
    # first start
}
& $pm2Cmd start $ecosystemBackend --only $ProcessName --update-env | Out-Null
Start-Sleep -Seconds 12

if ($ProcessName -eq 'itinvent-chat' -and $PreviewWorkerName) {
    Write-Host "PM2: reloading $PreviewWorkerName..." -ForegroundColor Cyan
    try {
        & $pm2Cmd delete $PreviewWorkerName 2>$null | Out-Null
    } catch {
        # first start
    }
    & $pm2Cmd start $ecosystemBackend --only $PreviewWorkerName --update-env | Out-Null
}

Write-Host ''
Write-Host 'PM2 chat status:' -ForegroundColor Cyan
& $pm2Cmd list

$listener = Get-PortListenerPids -ListenPort $Port
if ($listener.Count -eq 0) {
    throw "Chat API did not bind to port $Port"
}

Write-Host "Port $Port listener PID: $($listener[0])" -ForegroundColor Green
