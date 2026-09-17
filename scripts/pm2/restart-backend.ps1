param(
    [int]$Port = 8001,
    [string]$ProcessName = 'itinvent-backend',
    [string]$HealthUrl = '',
    [int]$StartupTimeoutSeconds = 90,
    [int]$StabilitySeconds = 5,
    [switch]$SkipScanRestart
)

$ErrorActionPreference = 'Stop'

if (-not $HealthUrl) {
    $HealthUrl = "http://127.0.0.1:$Port/health/ready"
}
if ($StartupTimeoutSeconds -lt 10) { throw 'StartupTimeoutSeconds must be at least 10.' }
if ($StabilitySeconds -lt 1) { throw 'StabilitySeconds must be at least 1.' }

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

function Get-ProcessCommandLine {
    param([int]$ProcessId)

    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if ($proc) {
        return [string]$proc.CommandLine
    }
    return ''
}

function Test-IsBackendCommandLine {
    param([string]$CommandLine)

    return [bool]($CommandLine -match '(^|[\\/\s\"])(start_server\.py)([\s\"]|$)')
}

function Stop-PidTree {
    param([int]$ProcessId, [string]$Reason)

    Write-Host "Killing PID $ProcessId ($Reason)..." -ForegroundColor Yellow
    taskkill /PID $ProcessId /T /F 2>$null | Out-Null
}

function Stop-OrphanBackendProcesses {
    param([int]$ListenPort)

    $listenerPids = Get-PortListenerPids -ListenPort $ListenPort
    foreach ($listenerPid in $listenerPids) {
        $commandLine = Get-ProcessCommandLine -ProcessId $listenerPid
        if (-not (Test-IsBackendCommandLine -CommandLine $commandLine)) {
            throw "Refusing to kill non-backend listener on port $ListenPort (PID ${listenerPid}): $commandLine"
        }
        Stop-PidTree -ProcessId $listenerPid -Reason "stale backend listener on port $ListenPort"
    }

    $orphans = Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" -ErrorAction SilentlyContinue |
        Where-Object { Test-IsBackendCommandLine -CommandLine ([string]$_.CommandLine) }

    foreach ($proc in $orphans) {
        if ($listenerPids -contains $proc.ProcessId) {
            continue
        }
        Stop-PidTree -ProcessId $proc.ProcessId -Reason 'orphan start_server.py'
    }
}

function Get-Pm2ProcessState {
    $lines = & $pm2Cmd pid $ProcessName 2>$null
    $processId = 0
    foreach ($line in @($lines)) {
        $text = ([string]$line).Trim()
        if ($text -match '^\d+$' -and [int]$text -gt 0) {
            $processId = [int]$text
        }
    }
    if ($processId -le 0) {
        return $null
    }
    return [pscustomobject]@{
        Status = 'online'
        PID = $processId
    }
}

function Test-BackendReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 5
        return ($response.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Wait-BackendReady {
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    $stableSince = $null
    $stablePid = 0
    $lastStatus = '<missing>'
    $lastPid = 0
    $lastListeners = @()

    while ((Get-Date) -lt $deadline) {
        $state = Get-Pm2ProcessState
        $lastStatus = if ($state) { $state.Status } else { '<missing>' }
        $lastPid = if ($state) { $state.PID } else { 0 }
        $lastListeners = Get-PortListenerPids -ListenPort $Port

        $ready = $false
        if ($state -and $state.Status -eq 'online' -and $state.PID -gt 0) {
            if ($lastListeners -contains $state.PID) {
                $ready = Test-BackendReady
            }
        }

        if ($ready) {
            if (($null -eq $stableSince) -or ($stablePid -ne $state.PID)) {
                $stablePid = $state.PID
                $stableSince = Get-Date
            }
            if (((Get-Date) - $stableSince).TotalSeconds -ge $StabilitySeconds) {
                Write-Host "Backend ready: PM2 PID $($state.PID) listening on port $Port." -ForegroundColor Green
                return
            }
        } else {
            $stableSince = $null
            $stablePid = 0
        }
        Start-Sleep -Milliseconds 500
    }

    Write-Host "Backend failed readiness within $StartupTimeoutSeconds s (status=$lastStatus pid=$lastPid listeners=$($lastListeners -join ','))." -ForegroundColor Red
    & $pm2Cmd logs $ProcessName --lines 30 --nostream
    throw "Backend did not become ready: status=$lastStatus pid=$lastPid listeners=$($lastListeners -join ',')"
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
if ($LASTEXITCODE -ne 0) {
    throw "pm2 start failed with exit code $LASTEXITCODE"
}

Wait-BackendReady

Write-Host ''
Write-Host 'PM2 backend status:' -ForegroundColor Cyan
& $pm2Cmd list

if (-not $SkipScanRestart) {
    # Bare `pm2 restart` on Windows often leaves orphan python -m scan_server*
    # holding singleton locks while PM2 spawns replacements → restart storm.
    Write-Host 'PM2: safely reloading scan services (stop + orphan cleanup + start)...' -ForegroundColor Cyan
    $restartScan = Join-Path $projectRoot 'scripts\pm2\restart-scan.ps1'
    & powershell -NoProfile -ExecutionPolicy Bypass -File $restartScan
    if ($LASTEXITCODE -ne 0) {
        throw "restart-scan.ps1 failed with exit code $LASTEXITCODE"
    }
}

$logs = & $pm2Cmd logs $ProcessName --lines 10 --nostream 2>$null
$uvicornLine = $logs | Select-String 'Uvicorn running on http://127.0.0.1:' | Select-Object -Last 1
if ($uvicornLine) {
    Write-Host $uvicornLine.Line.Trim() -ForegroundColor Green
} else {
    Write-Host 'Warning: Uvicorn startup line not found in recent logs.' -ForegroundColor Yellow
    & $pm2Cmd logs $ProcessName --lines 20 --nostream
}
