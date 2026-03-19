$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$toolsDir = Join-Path $root 'tools'
$nodeDir = Get-ChildItem -Path $toolsDir -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    Select-Object -First 1

if (-not $nodeDir) {
    throw "Local Node.js not found under '$toolsDir'."
}

$nodeExe = Join-Path $nodeDir.FullName 'node.exe'
$pm2Js = Join-Path $env:APPDATA 'npm\node_modules\pm2\bin\pm2'

if (-not (Test-Path $nodeExe)) {
    throw "node.exe not found: $nodeExe"
}

if (-not (Test-Path $pm2Js)) {
    throw "PM2 CLI not found: $pm2Js"
}

& $nodeExe $pm2Js @args
exit $LASTEXITCODE
