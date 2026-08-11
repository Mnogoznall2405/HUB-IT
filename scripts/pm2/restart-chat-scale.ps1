param(
    [int]$ReadyTimeoutSec = 75
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
    # Parsing `pm2 jlist` is not safe on Windows PowerShell 5.1 because its
    # environment objects can contain case-only duplicate keys. `pm2 pid` is
    # stable and returns 0 when the process is not registered/running.
    $pidOutput = @(& $pm2Cmd pid $requiredName 2>$null)
    $registeredPid = $pidOutput | Where-Object { "$_" -match '^\d+$' } | Select-Object -Last 1
    if (-not $registeredPid -or [int]$registeredPid -le 0) {
        throw "$requiredName is not registered in PM2. Refusing to activate scale mode from a restart script."
    }
}

$nodes = @(
    [pscustomobject]@{ Name = 'itinvent-chat-a'; ReadyUrl = 'http://127.0.0.1:8002/health/ready' },
    [pscustomobject]@{ Name = 'itinvent-chat-b'; ReadyUrl = 'http://127.0.0.1:8004/health/ready' }
)

# Restart one node at a time so the other node can keep existing WebSockets.
foreach ($node in $nodes) {
    Write-Host "Reloading $($node.Name)..." -ForegroundColor Cyan
    & $pm2Cmd start $chatScaleConfig --only $node.Name --update-env | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "PM2 failed to reload $($node.Name) (exit $LASTEXITCODE)."
    }
    Wait-PostgresChatReady -Url $node.ReadyUrl -TimeoutSec $ReadyTimeoutSec
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
