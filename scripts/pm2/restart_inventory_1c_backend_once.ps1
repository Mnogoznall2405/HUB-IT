$ErrorActionPreference = 'Stop'
$projectRoot = 'C:\Project\Image_scan'
$env:PM2_HOME = Join-Path $env:USERPROFILE '.pm2'
$bundledNode = Join-Path $projectRoot 'tools\node-v24.14.0-win-x64-full'
if (-not (Test-Path -LiteralPath (Join-Path $bundledNode 'node.exe'))) { throw 'Project Node runtime missing.' }
if (-not (Test-Path -LiteralPath $env:PM2_HOME)) { throw 'Expected PM2 profile missing.' }
$env:PATH = "$bundledNode;$env:PATH"
$daemon = Get-CimInstance Win32_Process -Filter 'ProcessId=18696'
if (-not $daemon -or $daemon.Name -ne 'node.exe') { throw 'Expected production PM2 daemon changed; rerun preflight.' }
$backend = Get-CimInstance Win32_Process -Filter 'ProcessId=39180'
if (-not $backend -or $backend.ParentProcessId -ne 18696) { throw 'Expected backend process changed; rerun preflight.' }
$serverProcesses = @(Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" | Where-Object { $_.CommandLine -match '(^|[\\/\s"])(start_server\.py)([\s"]|$)' })
if ($serverProcesses.Count -ne 1 -or $serverProcesses[0].ProcessId -ne 39180) { throw 'Unexpected start_server.py process; refusing orphan cleanup.' }
$listener = @(Get-NetTCPConnection -State Listen -LocalPort 8001 -ErrorAction Stop)
if ($listener.Count -ne 1 -or $listener[0].OwningProcess -ne 39180) { throw 'Backend listener differs from preflight.' }
$pm2 = Join-Path $env:APPDATA 'npm\pm2.cmd'
if (-not (Test-Path -LiteralPath $pm2)) { throw 'Expected global PM2 shim missing.' }
$managedPid = @(& $pm2 pid itinvent-backend 2>$null) | Where-Object { ([string]$_).Trim() -eq '39180' }
if (-not $managedPid) { throw 'PM2 profile does not own expected backend.' }
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot 'scripts\pm2\restart-backend.ps1') -SkipScanRestart
exit $LASTEXITCODE
