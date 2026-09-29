#Requires -Version 5.1
<#
.SYNOPSIS
    Boot guard for HUB-IT PM2 processes: resurrect only when nothing is online.

.DESCRIPTION
    Called by the "HUB-IT PM2 resurrect" scheduled task at system startup.
    Uses the Администратор PM2 home explicitly so it works under SYSTEM.
    Idempotent: if any PM2 app is already online, does nothing (no duplicates).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'SilentlyContinue'
$Pm2Home = 'C:\Users\Администратор\.pm2'
$Pm2Cmd = 'C:\Users\Администратор\AppData\Roaming\npm\pm2.cmd'

$env:PM2_HOME = $Pm2Home
$env:Path = 'C:\Users\Администратор\AppData\Roaming\npm;' + $env:Path

$onlineCount = 0
try {
    $listOutput = & $Pm2Cmd list 2>$null | Out-String
    if ($listOutput -match 'online') {
        $onlineCount = ([regex]::Matches($listOutput, 'online')).Count
    }
} catch {
    $onlineCount = 0
}

if ($onlineCount -gt 0) {
    Write-Output "PM2 already manages $onlineCount online app(s); resurrect skipped."
    exit 0
}

Write-Output 'No online PM2 apps detected; running pm2 resurrect...'
& $Pm2Cmd resurrect --update-env
exit $LASTEXITCODE
