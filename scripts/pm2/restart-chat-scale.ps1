param(
    [int]$ReadyTimeoutSec = 75,
    # Wait after disabling a farm server before stopping the node: ARR polls
    # farm state every ~5s, so 8s covers one interval plus margin.
    [int]$DrainWaitSec = 8,
    [switch]$WhatIf,
    [ValidateSet('itinvent-chat-a', 'itinvent-chat-b')][string]$NodeName = '',
    [switch]$SkipSharedWorkers,
    [switch]$SkipSave,
    [switch]$SkipOperationLock,
    [string]$ProjectRoot = 'C:\Project\Image_scan'
)

$ErrorActionPreference = 'Stop'

. (Join-Path $projectRoot 'scripts\pm2\runtime-operations.ps1')
Initialize-HubitRuntime -ProjectRoot $projectRoot
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
                $payload.status -eq 'ok' -and
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

    $snapshot = Invoke-HubitPm2 -Pm2Command $Pm2Command -Arguments @('jlist') -TimeoutSeconds 30
    if ($snapshot.ExitCode -ne 0) { throw 'Cannot verify listener ownership.' }
    $owner = @((Convert-HubitPm2Snapshot -Json $snapshot.Output) | Where-Object { $_.Name -eq $Name })
    $knownPid = if ($owner.Count -eq 1) { [int]$owner[0].PID } else { 0 }
    foreach ($listenerPid in (Get-PortListenerPids -ListenPort $Port)) {
        if ($knownPid -le 0 -or $listenerPid -ne $knownPid) { throw 'Port belongs to an unverified process; refusing restart.' }
    }
    $stop = Invoke-HubitPm2 -Pm2Command $Pm2Command -Arguments @('stop',$Name)
    if ($stop.ExitCode -ne 0) { throw "Cannot stop $Name." }
    Start-Sleep -Seconds 2
    foreach ($listenerPid in (Get-PortListenerPids -ListenPort $Port)) {
        if ($listenerPid -ne $knownPid) { throw 'Listener ownership changed during restart.' }
        Write-Host "Stopping stale $Name listener on port $Port (PID $listenerPid)..." -ForegroundColor Yellow
        taskkill /PID $listenerPid /T /F 2>$null | Out-Null
    }
    Start-Sleep -Seconds 1
    $remaining = Get-PortListenerPids -ListenPort $Port
    if ($remaining.Count -gt 0) {
        throw "Port $Port is still in use after stopping ${Name}: $($remaining -join ', ')"
    }
    $delete = Invoke-HubitPm2 -Pm2Command $Pm2Command -Arguments @('delete',$Name)
    if ($delete.ExitCode -ne 0) { throw "Cannot replace $Name registration." }
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
    $describe = Invoke-HubitPm2 -Pm2Command $pm2Cmd -Arguments @('describe',$requiredName) -TimeoutSeconds 30
    if ($describe.ExitCode -ne 0) {
        throw "$requiredName is not registered in PM2. Refusing to activate scale mode from a restart script."
    }
}

$nodes = @(
    [pscustomobject]@{ Name = 'itinvent-chat-a'; Port = 8002; ReadyUrl = 'http://127.0.0.1:8002/health/ready' },
    [pscustomobject]@{ Name = 'itinvent-chat-b'; Port = 8004; ReadyUrl = 'http://127.0.0.1:8004/health/ready' }
)
if ($NodeName) { $nodes = @($nodes | Where-Object { $_.Name -eq $NodeName }) }

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

$operationMutex = New-Object System.Threading.Mutex($false, 'Global\HUB-IT-PM2-Operations')
$operationLocked = $false
if (-not $SkipOperationLock) {
    $operationLocked = $operationMutex.WaitOne(0)
    if (-not $operationLocked) { $operationMutex.Dispose(); throw 'Another PM2 operation is running.' }
}
try {
# Restart one node at a time so the other node can keep existing WebSockets.
foreach ($node in $nodes) {
    Write-Host "Reloading $($node.Name)..." -ForegroundColor Cyan
    $farmAddress = Get-ChatFarmServerAddress -Port $node.Port
    Write-Host "Draining farm server $farmAddress (port $($node.Port))..." -ForegroundColor Cyan
    Set-ChatFarmServerEnabled -Address $farmAddress -Enabled $false
    $drained = $true
    $nodeReady = $false
    try {
        Start-Sleep -Seconds $DrainWaitSec
        Stop-ChatNodeForRestart -Pm2Command $pm2Cmd -Name $node.Name -Port $node.Port
        $start = Invoke-HubitPm2 -Pm2Command $pm2Cmd -Arguments @('start',$chatScaleConfig,'--only',$node.Name,'--update-env')
        if ($start.ExitCode -ne 0) {
            throw "PM2 failed to reload $($node.Name) (exit $LASTEXITCODE)."
        }
        Wait-PostgresChatReady -Url $node.ReadyUrl -TimeoutSec $ReadyTimeoutSec
        $nodeReady = $true
    } finally {
        if ($drained -and $nodeReady) {
            Write-Host "Re-enabling farm server $farmAddress..." -ForegroundColor Cyan
            Set-ChatFarmServerEnabled -Address $farmAddress -Enabled $true
        } elseif ($drained) { Write-Warning "$($node.Name) remains disabled in ARR because readiness failed." }
    }
    Invoke-PostgresConnectionBudgetCheck
}

# An early dual-node config used this alias.  PM2 keeps removed app names
# indefinitely, so explicitly delete it before reloading the one shared worker.
$legacyResult = Invoke-HubitPm2 -Pm2Command $pm2Cmd -Arguments @('pid','itinvent-chat-preview-worker') -TimeoutSeconds 30
$legacyPreviewPidOutput = @($legacyResult.Output -split '\r?\n')
$legacyPreviewPid = $legacyPreviewPidOutput | Where-Object { "$_" -match '^\d+$' } | Select-Object -Last 1
if (-not $SkipSharedWorkers -and $legacyPreviewPid -and [int]$legacyPreviewPid -gt 0) {
    $deletedAlias = Invoke-HubitPm2 -Pm2Command $pm2Cmd -Arguments @('delete','itinvent-chat-preview-worker')
    if ($deletedAlias.ExitCode -ne 0) {
        throw "PM2 failed to delete obsolete itinvent-chat-preview-worker (exit $LASTEXITCODE)."
    }
}

foreach ($workerName in @(if (-not $SkipSharedWorkers) { 'itinvent-preview-worker'; 'itinvent-chat-push-worker' })) {
    Write-Host "Reloading shared worker $workerName..." -ForegroundColor Cyan
    $worker = Invoke-HubitPm2 -Pm2Command $pm2Cmd -Arguments @('start',(Join-Path $projectRoot 'scripts\pm2\ecosystem.all.config.js'),'--only',$workerName,'--update-env')
    if ($worker.ExitCode -ne 0) {
        throw "PM2 failed to reload $workerName (exit $LASTEXITCODE)."
    }
}
Invoke-PostgresConnectionBudgetCheck

if (-not $SkipSave) {
    $state = Invoke-HubitPm2 -Pm2Command $pm2Cmd -Arguments @('jlist') -TimeoutSeconds 30
    if ($state.ExitCode -ne 0) { throw 'Cannot verify final environment.' }
    $expected = Get-HubitExpectedApps -ProjectRoot $projectRoot
    $drift = Get-HubitConfigDrift -Expected $expected -Snapshot (Convert-HubitPm2Snapshot -Json $state.Output)
    if ($drift.Count -gt 0) { throw 'Runtime configuration differs from ecosystem; refusing save.' }
    $save = Invoke-HubitPm2 -Pm2Command $pm2Cmd -Arguments @('save')
    if ($save.ExitCode -ne 0) { throw 'Cannot save verified chat configuration.' }
}

Write-Host 'PostgreSQL Chat cluster restarted successfully.' -ForegroundColor Green
} finally {
    if ($operationLocked) { $operationMutex.ReleaseMutex() }
    $operationMutex.Dispose()
}
