param()
$ErrorActionPreference = 'Stop'
$root = 'C:\Project\Image_scan'
$env:PATH = (Join-Path $root 'tools\node-v24.14.0-win-x64-full') + ';' + $env:PATH
$pm2 = Join-Path $env:APPDATA 'npm\pm2.cmd'
foreach ($name in @('itinvent-ai-chat-worker', 'itinvent-ai-sandbox-control')) {
    & $pm2 stop $name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Cannot stop $name" }
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
