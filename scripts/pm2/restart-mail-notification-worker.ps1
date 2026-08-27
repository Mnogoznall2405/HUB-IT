param(
    [int]$StableWaitSec = 12
)

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$ecosystemBackend = Join-Path $projectRoot 'scripts\pm2\ecosystem.backend.config.js'
$processName = 'itinvent-mail-notification-worker'

function Resolve-Pm2Command {
    $preferred = Join-Path $env:APPDATA 'npm\pm2.cmd'
    if (Test-Path -LiteralPath $preferred) {
        return $preferred
    }
    $resolved = where.exe pm2.cmd 2>$null | Select-Object -First 1
    if ($resolved) {
        return $resolved.Trim()
    }
    throw 'PM2 command not found.'
}

function Stop-MailNotificationProcesses {
    $workers = @(
        Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" -ErrorAction SilentlyContinue |
            Where-Object { [string]$_.CommandLine -match '(^|[\\/\s])start_mail_notification_worker\.py(\s|$)' }
    )
    foreach ($worker in $workers) {
        Write-Host "Stopping stale mail notification worker PID=$($worker.ProcessId)..." -ForegroundColor Yellow
        taskkill /PID $worker.ProcessId /T /F 2>$null | Out-Null
    }
}

function Get-Pm2Pid {
    param([string]$Pm2Command)
    $output = @(& $Pm2Command pid $processName 2>$null)
    $value = $output | Where-Object { "$_" -match '^\d+$' } | Select-Object -Last 1
    if (-not $value) { return 0 }
    return [int]$value
}

$pm2Cmd = Resolve-Pm2Command
Write-Host "PM2: stopping $processName..." -ForegroundColor Cyan
& $pm2Cmd delete $processName 2>$null | Out-Null
Start-Sleep -Seconds 2
Stop-MailNotificationProcesses
Start-Sleep -Seconds 1

$remaining = @(
    Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" -ErrorAction SilentlyContinue |
        Where-Object { [string]$_.CommandLine -match '(^|[\\/\s])start_mail_notification_worker\.py(\s|$)' }
)
if ($remaining.Count -gt 0) {
    throw "Mail notification worker cleanup failed; remaining PID(s): $($remaining.ProcessId -join ', ')"
}

Write-Host "PM2: starting $processName with updated environment..." -ForegroundColor Cyan
& $pm2Cmd start $ecosystemBackend --only $processName --update-env | Out-Host
if ($LASTEXITCODE -ne 0) {
    throw "PM2 failed to start $processName (exit $LASTEXITCODE)."
}

Start-Sleep -Seconds $StableWaitSec
$firstPid = Get-Pm2Pid -Pm2Command $pm2Cmd
if ($firstPid -le 0) {
    throw "$processName did not reach the online state."
}
Start-Sleep -Seconds 3
$secondPid = Get-Pm2Pid -Pm2Command $pm2Cmd
if ($secondPid -ne $firstPid) {
    throw "$processName is not stable: PID changed from $firstPid to $secondPid."
}

Write-Host "$processName is stable with PID $secondPid." -ForegroundColor Green
