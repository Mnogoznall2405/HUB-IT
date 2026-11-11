param(
    [int]$StableWaitSec = 12,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$projectRoot = 'C:\Project\Image_scan'
$processName = 'itinvent-my-files-worker'
$ecosystem = Join-Path $projectRoot 'scripts\pm2\ecosystem.backend.config.js'
$nodeDirectory = Join-Path $projectRoot 'tools\node-v24.14.0-win-x64-full'
$env:PATH = "$nodeDirectory;$env:PATH"
$pm2Cmd = Join-Path $env:APPDATA 'npm\pm2.cmd'
if (-not (Test-Path -LiteralPath $pm2Cmd)) { throw 'PM2 command not found.' }

$probe = @'
import sys
sys.path.insert(0, r'C:\Project\Image_scan\WEB-itinvent')
import sqlalchemy as sa
from backend.appdb.db import get_app_database_url
try:
    engine = sa.create_engine(get_app_database_url(), echo=False, connect_args={'application_name':'my-files-restart-preflight','options':'-c statement_timeout=5000'})
    with engine.connect() as connection, connection.begin():
        connection.execute(sa.text('SET TRANSACTION READ ONLY'))
        busy = connection.execute(sa.text("SELECT count(*) FROM app.my_files WHERE (status IN ('scanning','processing') OR security_scan_status='scanning') AND updated_at > now()-interval '1 day'")).scalar_one()
    engine.dispose()
    print(busy)
except Exception as error:
    print(type(error).__name__)
    raise SystemExit(1)
'@

function Get-WorkerPid {
    $values = @(& $pm2Cmd pid $processName 2>$null)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read the worker PID.' }
    $value = $values | Where-Object { "$_" -match '^\d+$' } | Select-Object -Last 1
    if (-not $value) { return 0 }
    return [int]$value
}

Push-Location $projectRoot
try {
    $probeDirectory = Join-Path $projectRoot 'output\pm2'
    New-Item -ItemType Directory -Path $probeDirectory -Force | Out-Null
    $probePath = Join-Path $probeDirectory ("my-files-preflight-" + [guid]::NewGuid().ToString('N') + '.py')
    [System.IO.File]::WriteAllText($probePath, $probe, (New-Object System.Text.UTF8Encoding($false)))
    try { $result = @(& python $probePath) }
    finally { Remove-Item -LiteralPath $probePath -Force }
    if ($LASTEXITCODE -ne 0 -or $result.Count -ne 1 -or "$($result[0])" -notmatch '^\d+$') { throw 'Cannot verify that the file worker is idle.' }
    if ([int]$result[0] -gt 0) { throw 'Recent file processing is active. Wait for it to finish before restarting.' }
    $oldPid = Get-WorkerPid
    if ($oldPid -le 0) { throw 'Expected an existing file worker.' }
    $oldProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $oldPid" -ErrorAction Stop
    if ([string]$oldProcess.CommandLine -notmatch '(^|[\\/\s"])(start_my_files_worker\.py)([\s"]|$)') { throw 'Refusing to stop an unrelated PID.' }
    if ($WhatIf) { Write-Host "[WhatIf] idle worker PID=$oldPid; stop, verify exit, start $processName, check stable PID."; return }

    $mutex = New-Object System.Threading.Mutex($false, 'Global\HUB-IT-PM2-Operations')
    $locked = $false
    try {
        $locked = $mutex.WaitOne(0)
        if (-not $locked) { throw 'Another PM2 operation is running.' }
        & $pm2Cmd stop $processName | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'PM2 could not stop the file worker.' }
        Start-Sleep -Seconds 2
        $remaining = Get-CimInstance Win32_Process -Filter "ProcessId = $oldPid" -ErrorAction SilentlyContinue
        if ($remaining) {
            if ([string]$remaining.CommandLine -notmatch '(^|[\\/\s"])(start_my_files_worker\.py)([\s"]|$)') { throw 'PID was reused; cleanup stopped.' }
            taskkill /PID $oldPid /T /F 2>$null | Out-Null
            Start-Sleep -Seconds 1
        }
        if (Get-Process -Id $oldPid -ErrorAction SilentlyContinue) { throw 'The previous worker did not exit.' }
        & $pm2Cmd delete $processName 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'PM2 could not remove the stopped worker definition.' }
        & $pm2Cmd start $ecosystem --only $processName --update-env | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'PM2 could not start the file worker.' }
        Start-Sleep -Seconds $StableWaitSec
        $firstPid = Get-WorkerPid
        Start-Sleep -Seconds 3
        $secondPid = Get-WorkerPid
        if ($firstPid -le 0 -or $firstPid -ne $secondPid) { throw 'The file worker did not reach a stable state.' }
        Write-Host "$processName is stable with PID $secondPid (previous PID $oldPid)."
    } finally {
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
} finally {
    Pop-Location
}
