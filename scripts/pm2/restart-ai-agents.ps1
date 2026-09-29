param()
$ErrorActionPreference = 'Stop'
$root = 'C:\Project\Image_scan'
$env:PATH = (Join-Path $root 'tools\node-v24.14.0-win-x64-full') + ';' + $env:PATH
$pm2 = Join-Path $env:APPDATA 'npm\pm2.cmd'
# `pm2 stop` on a missing process writes a native error record, which is
# terminating under $ErrorActionPreference='Stop' despite 2>$null. A process
# that is not running must not abort the script before the start step.
$prevErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    foreach ($name in @('itinvent-ai-chat-worker', 'itinvent-ai-sandbox-control')) {
        & $pm2 stop $name 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Output "PM2 process $name was not running; continuing with start."
        }
    }
} finally {
    $ErrorActionPreference = $prevErrorActionPreference
}
Start-Sleep -Seconds 2
if (Get-NetTCPConnection -LocalPort 8443 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Control port 8443 is still occupied; inspect its owner before retrying.'
}
& $pm2 start (Join-Path $root 'scripts\pm2\ecosystem.backend.config.js') --only itinvent-ai-chat-worker --update-env | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'AI worker start failed' }
& $pm2 start (Join-Path $root 'scripts\ai-sandbox\ecosystem.control.config.js') --only itinvent-ai-sandbox-control --update-env | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Control start failed' }
Write-Output 'AI worker and private control started; verify readiness independently.'
