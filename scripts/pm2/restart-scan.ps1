param(
    [int]$Port = 8011,
    [string[]]$ProcessNames = @('itinvent-scan', 'itinvent-scan-worker', 'itinvent-ollama', 'itinvent-scan-llm-worker')
)

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$ecosystemScan = Join-Path $projectRoot 'scripts\pm2\ecosystem.scan.config.js'

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

function Get-ScanPythonProcesses {
    $rows = @(Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" -ErrorAction SilentlyContinue)
    $api = @()
    $worker = @()
    foreach ($row in $rows) {
        $cmd = [string]$row.CommandLine
        if (-not $cmd) {
            continue
        }
        if ($cmd -match '(^|\s)-m\s+scan_server(\s|$)' -and $cmd -notmatch 'scan_server\.worker_main') {
            $api += $row
        } elseif ($cmd -match '(^|\s)-m\s+scan_server\.worker_main(\s|$)') {
            $worker += $row
        }
    }
    return [pscustomobject]@{
        Api    = @($api)
        Worker = @($worker)
    }
}

function Get-ScanProcessRoots {
    param([array]$Processes)

    # Each venv pythonw.exe launcher spawns the real interpreter as a child with the
    # same "-m scan_server*" command line: a process whose parent is another matched
    # process is the child, so counting roots only counts each logical service once.
    $ids = @($Processes | ForEach-Object { [int]$_.ProcessId })
    return @($Processes | Where-Object { $ids -notcontains [int]$_.ParentProcessId })
}

function Stop-OrphanScanProcesses {
    param(
        [int]$ListenPort,
        [bool]$IncludeApi,
        [bool]$IncludeWorker
    )

    # The port listener belongs to itinvent-scan: killing it on a worker/ollama
    # restart drops the API mid-flight. Cleanup is scoped to restarted services.
    $listenerPids = @()
    if ($IncludeApi) {
        $listenerPids = Get-PortListenerPids -ListenPort $ListenPort
        foreach ($listenerPid in $listenerPids) {
            Write-Host "Killing scan listener on port $ListenPort (PID $listenerPid)..." -ForegroundColor Yellow
            taskkill /PID $listenerPid /T /F 2>$null | Out-Null
        }
    }

    $scanProcs = Get-ScanPythonProcesses
    $targets = @()
    if ($IncludeApi) { $targets += $scanProcs.Api }
    if ($IncludeWorker) { $targets += $scanProcs.Worker }
    foreach ($proc in $targets) {
        if ($listenerPids -contains $proc.ProcessId) {
            continue
        }
        Write-Host "Killing orphan scan process (PID $($proc.ProcessId))..." -ForegroundColor Yellow
        taskkill /PID $proc.ProcessId /T /F 2>$null | Out-Null
    }
}

$pm2Cmd = Resolve-Pm2Command

$restartApi = $ProcessNames -contains 'itinvent-scan'
$restartWorker = $ProcessNames -contains 'itinvent-scan-worker'

Write-Host "PM2: stopping $($ProcessNames -join ', ')..." -ForegroundColor Cyan
foreach ($name in $ProcessNames) {
    try {
        & $pm2Cmd stop $name 2>$null | Out-Null
    } catch {
        Write-Host "PM2: $name was not running (ok)" -ForegroundColor DarkYellow
    }
}
Start-Sleep -Seconds 2

Write-Host "PM2: clearing scan orphans (port $Port + leftover python -m scan_server*)..." -ForegroundColor Cyan
Stop-OrphanScanProcesses -ListenPort $Port -IncludeApi:$restartApi -IncludeWorker:$restartWorker
Start-Sleep -Seconds 1

if ($restartApi) {
    $remainingListeners = Get-PortListenerPids -ListenPort $Port
    if ($remainingListeners.Count -gt 0) {
        throw "Port $Port is still in use by PID(s): $($remainingListeners -join ', ')"
    }
}

$leftover = Get-ScanPythonProcesses
if (($restartApi -and $leftover.Api.Count -gt 0) -or ($restartWorker -and $leftover.Worker.Count -gt 0)) {
    $ids = @($leftover.Api + $leftover.Worker | ForEach-Object { $_.ProcessId }) -join ', '
    throw "Scan python process(es) still running after cleanup: $ids"
}

Write-Host 'PM2: reloading scan services with updated ecosystem...' -ForegroundColor Cyan
foreach ($name in $ProcessNames) {
    try {
        & $pm2Cmd delete $name 2>$null | Out-Null
    } catch {
        # first start / already deleted
    }
}
$reloadStarted = Get-Date
& $pm2Cmd start $ecosystemScan --only ($ProcessNames -join ',') --update-env | Out-Null
Start-Sleep -Seconds 8

Write-Host ''
Write-Host 'PM2 scan status:' -ForegroundColor Cyan
& $pm2Cmd list

$listener = Get-PortListenerPids -ListenPort $Port
if ($listener.Count -eq 0) {
    throw "Scan API did not bind to port $Port"
}
if ($listener.Count -gt 1) {
    throw "Port $Port has multiple listeners: $($listener -join ', ')"
}

$running = Get-ScanPythonProcesses
# Ignore processes created before this reload: a service killed via taskkill can still
# be tearing down when the new instance has already bound the port, and the dying copy
# would otherwise be counted as an extra root.
$reloadCutoff = $reloadStarted.AddSeconds(-3)
$apiRoots = @($running.Api)
$workerRoots = @($running.Worker)
if ($restartApi) {
    $freshApi = @($running.Api | Where-Object { -not $_.CreationDate -or $_.CreationDate -ge $reloadCutoff })
    $apiRoots = @(Get-ScanProcessRoots $freshApi)
}
if ($restartWorker) {
    $freshWorker = @($running.Worker | Where-Object { -not $_.CreationDate -or $_.CreationDate -ge $reloadCutoff })
    $workerRoots = @(Get-ScanProcessRoots $freshWorker)
}
if ($apiRoots.Count -lt 1 -or $workerRoots.Count -lt 1 -or `
    ($restartApi -and $apiRoots.Count -ne 1) -or ($restartWorker -and $workerRoots.Count -ne 1)) {
    $apiDesc = ($running.Api | ForEach-Object { "$($_.ProcessId)@$($_.CreationDate)" }) -join ','
    $workerDesc = ($running.Worker | ForEach-Object { "$($_.ProcessId)@$($_.CreationDate)" }) -join ','
    throw "Expected live scan API + worker after reload; got api=$($apiRoots.Count) worker=$($workerRoots.Count) (api: $apiDesc | worker: $workerDesc)"
}

Write-Host "Port $Port listener PID: $($listener[0]) (api=$($apiRoots[0].ProcessId) worker=$($workerRoots[0].ProcessId))" -ForegroundColor Green

try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 10
    if ($health.StatusCode -ne 200) {
        throw "Scan /health returned $($health.StatusCode)"
    }
    Write-Host 'Scan /health: 200 OK' -ForegroundColor Green
} catch {
    throw "Scan /health failed: $($_.Exception.Message)"
}
