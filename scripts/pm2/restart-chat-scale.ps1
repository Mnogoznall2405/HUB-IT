param(
    [int]$ReadyTimeoutSec = 75,
    # Wait after disabling a farm server before stopping the node: ARR polls
    # farm state every ~5s, so 8s covers one interval plus margin.
    [int]$DrainWaitSec = 8,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$envPath = Join-Path $projectRoot '.env'
$chatScaleConfig = Join-Path $projectRoot 'scripts\pm2\ecosystem.chat.scale.config.js'
$postgresBudgetCheck = Join-Path $projectRoot 'scripts\check_postgres_connection_budget.py'

function Resolve-Pm2Command {
    $preferredGlobalPm2Cmd = Join-Path $env:APPDATA 'npm\pm2.cmd'
    if (Test-Path -LiteralPath $preferredGlobalPm2Cmd) {
        return $preferredGlobalPm2Cmd
    }

    $globalPm2Cmd = (where.exe pm2.cmd 2>$null | Select-Object -First 1)
    if ($globalPm2Cmd) {
        return $globalPm2Cmd.Trim()
    }

    throw 'PM2 command not found.'
}

function Get-EnvValue {
    param(
        [string]$Path,
        [string]$Name
    )

    $pattern = '^\s*{0}\s*=\s*(.*)$' -f [regex]::Escape($Name)
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match $pattern) {
            return $Matches[1].Trim()
        }
    }
    return ''
}

function Wait-PostgresChatReady {
    param(
        [string]$Url,
        [int]$TimeoutSec
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSec)
    $lastError = 'not checked'
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $payload = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 5
            $chat = if ($payload.chat) { $payload.chat } else { $payload }
            if (
                $chat.realtime_transport -eq 'postgres' -and
                $chat.realtime_available -eq $true -and
                $chat.realtime_subscriber_ready -eq $true
            ) {
                Write-Host "$Url is ready with PostgreSQL realtime." -ForegroundColor Green
                return
            }
            $lastError = 'readiness payload does not confirm postgres/available/subscriber_ready'
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Seconds 2
    }
    throw "Chat readiness failed at $Url after ${TimeoutSec}s: $lastError"
}

function Invoke-PostgresConnectionBudgetCheck {
    param(
        [switch]$Projected
    )

    if (-not (Test-Path -LiteralPath $postgresBudgetCheck)) {
        throw "PostgreSQL connection budget checker not found: $postgresBudgetCheck"
    }
    $arguments = @($postgresBudgetCheck, '--reserve', '20')
    if ($Projected) {
        $arguments += '--enforce-projected'
    } else {
        $arguments += '--enforce'
    }
    & python @arguments | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "PostgreSQL connection budget check failed (exit $LASTEXITCODE)."
    }
}

function Get-ChatFarmServerAddress {
    param([int]$Port)

    try {
        Import-Module WebAdministration -ErrorAction Stop
        $servers = Get-WebConfiguration -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter "webFarms/webFarm[@name='itinvent-chat']/server" -ErrorAction Stop
        foreach ($server in @($servers)) {
            $httpPort = 0
            [void][int]::TryParse([string]$server.GetChildElement('applicationRequestRouting').GetAttributeValue('httpPort'), [ref]$httpPort)
            if ($httpPort -eq $Port) {
                return [string]$server.GetAttributeValue('address')
            }
        }
    } catch {
        throw "Cannot read ARR farm itinvent-chat (run elevated): $($_.Exception.Message)"
    }
    throw "No itinvent-chat farm server with httpPort=$Port"
}

function Set-ChatFarmServerEnabled {
    param(
        [string]$Address,
        [bool]$Enabled
    )

    Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' `
        -Filter "webFarms/webFarm[@name='itinvent-chat']/server[@address='$Address']" `
        -Name 'enabled' -Value $(if ($Enabled) { 'true' } else { 'false' }) -ErrorAction Stop
}

function Get-PortListenerPids {
    param([int]$ListenPort)

    $pids = @()
    $lines = netstat -ano | Select-String ":$ListenPort\s+.*LISTENING"
    foreach ($line in $lines) {
        $parts = ($line -split '\s+') | Where-Object { $_ }
        if ($parts.Count -ge 1 -and $parts[-1] -match '^\d+$') {
            $pids += [int]$parts[-1]
        }
    }
    return @($pids | Sort-Object -Unique)
}

function Stop-ChatNodeForRestart {
    param(
        [string]$Pm2Command,
        [string]$Name,
        [int]$Port
    )

    & $Pm2Command stop $Name 2>$null | Out-Null
    Start-Sleep -Seconds 2
    foreach ($listenerPid in (Get-PortListenerPids -ListenPort $Port)) {
        Write-Host "Stopping stale $Name listener on port $Port (PID $listenerPid)..." -ForegroundColor Yellow
        taskkill /PID $listenerPid /T /F 2>$null | Out-Null
    }
    Start-Sleep -Seconds 1
    $remaining = Get-PortListenerPids -ListenPort $Port
    if ($remaining.Count -gt 0) {
        throw "Port $Port is still in use after stopping ${Name}: $($remaining -join ', ')"
    }
    & $Pm2Command delete $Name 2>$null | Out-Null
}

if (-not (Test-Path -LiteralPath $envPath)) {
    throw ".env not found at $envPath"
}
if ((Get-EnvValue -Path $envPath -Name 'CHAT_REALTIME_TRANSPORT') -ne 'postgres' -or
    (Get-EnvValue -Path $envPath -Name 'CHAT_REALTIME_REQUIRED') -ne '1') {
    throw 'PostgreSQL dual-node mode is not enabled. Run enable-chat-postgres.ps1 -Mode EnableDual first.'
}

$pm2Cmd = Resolve-Pm2Command
# Validate the configuration before touching live nodes. The subsequent live
# check after each rolling restart prevents consuming the maintenance reserve.
Invoke-PostgresConnectionBudgetCheck -Projected
foreach ($requiredName in @('itinvent-chat-a', 'itinvent-chat-b')) {
    # `pm2 describe` distinguishes an already configured but failed node from a
    # missing node. That lets this restart script recover `waiting restart`
    # without becoming an activation path for a cluster that was never enabled.
    & $pm2Cmd describe $requiredName 1>$null 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "$requiredName is not registered in PM2. Refusing to activate scale mode from a restart script."
    }
}

$nodes = @(
    [pscustomobject]@{ Name = 'itinvent-chat-a'; Port = 8002; ReadyUrl = 'http://127.0.0.1:8002/health/ready' },
    [pscustomobject]@{ Name = 'itinvent-chat-b'; Port = 8004; ReadyUrl = 'http://127.0.0.1:8004/health/ready' }
)

if ($WhatIf) {
    Write-Host '[WhatIf] Rolling restart plan (no changes applied):' -ForegroundColor Cyan
    Write-Host '[WhatIf] 1. Validate PostgreSQL connection budget (projected dual envelope).'
    Write-Host '[WhatIf] 2. Verify itinvent-chat-a/-b are registered in PM2.'
    foreach ($node in $nodes) {
        Write-Host "[WhatIf] 3. Drain $($node.Name): disable farm server for port $($node.Port), wait ${DrainWaitSec}s, stop + delete PM2 process, start from scale config, wait /health/ready (<= ${ReadyTimeoutSec}s), re-enable farm server, re-check budget."
    }
    Write-Host '[WhatIf] 4. Reload shared workers itinvent-preview-worker and itinvent-chat-push-worker, final budget check.'
    return
}

# Restart one node at a time so the other node can keep existing WebSockets.
foreach ($node in $nodes) {
    Write-Host "Reloading $($node.Name)..." -ForegroundColor Cyan
    $farmAddress = Get-ChatFarmServerAddress -Port $node.Port
    Write-Host "Draining farm server $farmAddress (port $($node.Port))..." -ForegroundColor Cyan
    Set-ChatFarmServerEnabled -Address $farmAddress -Enabled $false
    $drained = $true
    try {
        Start-Sleep -Seconds $DrainWaitSec
        Stop-ChatNodeForRestart -Pm2Command $pm2Cmd -Name $node.Name -Port $node.Port
        & $pm2Cmd start $chatScaleConfig --only $node.Name --update-env | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "PM2 failed to reload $($node.Name) (exit $LASTEXITCODE)."
        }
        Wait-PostgresChatReady -Url $node.ReadyUrl -TimeoutSec $ReadyTimeoutSec
    } finally {
        if ($drained) {
            Write-Host "Re-enabling farm server $farmAddress..." -ForegroundColor Cyan
            Set-ChatFarmServerEnabled -Address $farmAddress -Enabled $true
        }
    }
    Invoke-PostgresConnectionBudgetCheck
}

# An early dual-node config used this alias.  PM2 keeps removed app names
# indefinitely, so explicitly delete it before reloading the one shared worker.
$legacyPreviewPidOutput = @(& $pm2Cmd pid 'itinvent-chat-preview-worker' 2>$null)
$legacyPreviewPid = $legacyPreviewPidOutput | Where-Object { "$_" -match '^\d+$' } | Select-Object -Last 1
if ($legacyPreviewPid -and [int]$legacyPreviewPid -gt 0) {
    & $pm2Cmd delete 'itinvent-chat-preview-worker' | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "PM2 failed to delete obsolete itinvent-chat-preview-worker (exit $LASTEXITCODE)."
    }
}

foreach ($workerName in @('itinvent-preview-worker', 'itinvent-chat-push-worker')) {
    Write-Host "Reloading shared worker $workerName..." -ForegroundColor Cyan
    & $pm2Cmd start $chatScaleConfig --only $workerName --update-env | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "PM2 failed to reload $workerName (exit $LASTEXITCODE)."
    }
}
Invoke-PostgresConnectionBudgetCheck

Write-Host 'PostgreSQL Chat cluster restarted successfully.' -ForegroundColor Green
