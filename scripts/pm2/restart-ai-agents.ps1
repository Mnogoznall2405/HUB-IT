param([switch]$ChatWorkerOnly)
$ErrorActionPreference = 'Stop'
$root = 'C:\Project\Image_scan'
$env:PATH = (Join-Path $root 'tools\node-v24.14.0-win-x64-full') + ';' + $env:PATH
$pm2 = Join-Path $env:APPDATA 'npm\pm2.cmd'
$targets = @('itinvent-ai-chat-worker')
if (-not $ChatWorkerOnly) { $targets += 'itinvent-ai-sandbox-control' }
$oldWorkers = @(Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" |
    Where-Object { [string]$_.CommandLine -match '(^|[\\/\s])start_ai_chat_worker\.py(\s|$)' } |
    Select-Object -ExpandProperty ProcessId)
# `pm2 stop` on a missing process writes a native error record, which is
# terminating under $ErrorActionPreference='Stop' despite 2>$null. A process
# that is not running must not abort the script before the start step.
$prevErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    foreach ($name in $targets) {
        & $pm2 stop $name 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Output "PM2 process $name was not running; continuing with start."
        }
    }
} finally {
    $ErrorActionPreference = $prevErrorActionPreference
}
Start-Sleep -Seconds 2
$deadline = [datetime]::UtcNow.AddSeconds(20)
foreach ($workerPid in $oldWorkers) {
    while (Get-Process -Id $workerPid -ErrorAction SilentlyContinue) {
        if ([datetime]::UtcNow -ge $deadline) {
            throw "Old AI worker PID=$workerPid still exists; inspect before retrying."
        }
        Start-Sleep -Milliseconds 500
    }
}
if (-not $ChatWorkerOnly -and (Get-NetTCPConnection -LocalPort 8443 -State Listen -ErrorAction SilentlyContinue)) {
    throw 'Control port 8443 is still occupied; inspect its owner before retrying.'
}
& $pm2 start (Join-Path $root 'scripts\pm2\ecosystem.backend.config.js') --only itinvent-ai-chat-worker --update-env | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'AI worker start failed' }
if (-not $ChatWorkerOnly) {
    & $pm2 start (Join-Path $root 'scripts\ai-sandbox\ecosystem.control.config.js') --only itinvent-ai-sandbox-control --update-env | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Control start failed' }
}
Write-Output "Started: $($targets -join ', '); verify readiness independently."
