param(
    [string]$BackendUrl = 'http://127.0.0.1:8001/health',
    [string]$BackendSecondaryUrl = '',
    [string]$InventoryUrl = 'http://127.0.0.1:8012/health',
    [string]$ScanUrl = 'http://127.0.0.1:8011/health'
)

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$script:Pm2SnapshotError = ''

function Resolve-Pm2Command {
    $preferredGlobalPm2Cmd = Join-Path $env:APPDATA 'npm\pm2.cmd'
    if (Test-Path $preferredGlobalPm2Cmd) {
        return $preferredGlobalPm2Cmd
    }

    $globalPm2Cmd = (where.exe pm2.cmd 2>$null | Where-Object { $_ -and ($_ -notlike "$projectRoot*") } | Select-Object -First 1)
    if ($globalPm2Cmd) {
        return $globalPm2Cmd.Trim()
    }

    $globalPm2 = (Get-Command 'pm2' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
    if ($globalPm2) {
        return $globalPm2
    }

    $localPm2 = Join-Path $projectRoot 'pm2.cmd'
    if (Test-Path $localPm2) {
        & $localPm2 --version *> $null
        if ($LASTEXITCODE -eq 0) {
            return $localPm2
        }
    }

    throw 'PM2 command not found.'
}

try {
    $pm2Cmd = Resolve-Pm2Command
} catch {
    $pm2Cmd = $null
    $script:Pm2SnapshotError = (($_ | Out-String).Trim() -replace '\s+', ' ')
}

function Get-Pm2Snapshot {
    if (-not $pm2Cmd) {
        if (-not $script:Pm2SnapshotError) {
            $script:Pm2SnapshotError = 'PM2 command not found.'
        }
        return @()
    }

    try {
        $jlistRaw = & $pm2Cmd jlist 2>&1
    } catch {
        $script:Pm2SnapshotError = (($_ | Out-String).Trim() -replace '\s+', ' ')
        return @()
    }
    if ($LASTEXITCODE -ne 0 -or -not $jlistRaw) {
        $errorText = (($jlistRaw | ForEach-Object { "$_" }) -join ' ').Trim()
        $script:Pm2SnapshotError = if ($errorText) {
            "PM2 jlist failed (exit=$LASTEXITCODE): $errorText"
        } else {
            "PM2 jlist failed (exit=$LASTEXITCODE)."
        }
        return @()
    }

    try {
        $rows = @(($jlistRaw -join "`n") | ConvertFrom-Json)
    } catch {
        $script:Pm2SnapshotError = "Failed to parse PM2 jlist JSON: $($_.Exception.Message)"
        return @()
    }

    $script:Pm2SnapshotError = ''
    return @($rows | ForEach-Object {
        $pm2Env = $_.pm2_env
        $monit = $_.monit
        $memoryBytes = if ($monit -and $null -ne $monit.memory) { [double]$monit.memory } else { 0.0 }
        [pscustomobject]@{
            Name = $_.name
            Status = if ($pm2Env) { $pm2Env.status } else { $null }
            PID = $_.pid
            MemoryMB = '{0:N1}' -f ($memoryBytes / 1MB)
            Restarts = if ($pm2Env) { $pm2Env.restart_time } else { $null }
        }
    })
}

function Test-HttpHealth {
    param(
        [string]$Name,
        [string]$Url
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        return [pscustomobject]@{
            Name    = $Name
            Status  = if ($response.StatusCode -eq 200) { 'ok' } else { 'warn' }
            Details = "$($response.StatusCode) $Url"
        }
    } catch {
        return [pscustomobject]@{
            Name    = $Name
            Status  = 'fail'
            Details = $_.Exception.Message
        }
    }
}

function Test-BackendChatRuntime {
    param(
        [string]$Name,
        [string]$Url
    )

    if (-not $Url) {
        return $null
    }

    try {
        $payload = Invoke-RestMethod -Uri $Url -TimeoutSec 5
    } catch {
        return [pscustomobject]@{
            Name    = $Name
            Status  = 'fail'
            Details = $_.Exception.Message
        }
    }

    if (-not $payload.chat) {
        return [pscustomobject]@{
            Name    = $Name
            Status  = 'warn'
            Details = 'chat snapshot missing from /health'
        }
    }

    $chat = $payload.chat
    $redisConfigured = [bool]$chat.redis_configured
    $redisReady = [bool]$chat.redis_available -and [bool]$chat.pubsub_subscribed
    $chatAvailable = [bool]$chat.available
    $eventDispatcherActive = [bool]$chat.event_dispatcher_active
    $status = if (-not $chatAvailable) {
        'fail'
    } elseif (-not $eventDispatcherActive) {
        'fail'
    } elseif ($redisConfigured -and -not $redisReady) {
        'warn'
    } else {
        'ok'
    }

    $details = @(
        "mode=$($chat.realtime_mode)"
        "available=$($chat.available)"
        "redis_configured=$($chat.redis_configured)"
        "redis_available=$($chat.redis_available)"
        "pubsub_subscribed=$($chat.pubsub_subscribed)"
        "push_outbox_backlog=$($chat.push_outbox_backlog)"
        "push_oldest_queued_age_sec=$($chat.push_outbox_oldest_queued_age_sec)"
        "event_dispatcher_active=$($chat.event_dispatcher_active)"
        "event_outbox_backlog=$($chat.event_outbox_backlog)"
        "event_oldest_queued_age_sec=$($chat.event_outbox_oldest_queued_age_sec)"
        "node=$($chat.realtime_node_id)"
    ) -join ' '

    return [pscustomobject]@{
        Name    = $Name
        Status  = $status
        Details = $details
    }
}

function Get-Pm2ProcessStatus {
    param(
        [object[]]$Snapshot,
        [string]$Name
    )

    if (($Snapshot.Count -eq 0) -and $script:Pm2SnapshotError) {
        return [pscustomobject]@{
            Name    = $Name
            Status  = 'warn'
            Details = "PM2 snapshot unavailable: $script:Pm2SnapshotError"
        }
    }

    $rows = @($Snapshot | Where-Object { $_.Name -eq $Name })
    if (-not $rows -or $rows.Count -eq 0) {
        return [pscustomobject]@{
            Name    = $Name
            Status  = 'fail'
            Details = 'process not found in PM2'
        }
    }

    $online = @($rows | Where-Object { $_.Status -eq 'online' })
    $status = if ($online.Count -eq $rows.Count) { 'ok' } else { 'warn' }
    $details = ($rows | ForEach-Object { "status=$($_.Status) pid=$($_.PID) restarts=$($_.Restarts)" }) -join '; '
    return [pscustomobject]@{
        Name    = $Name
        Status  = $status
        Details = $details
    }
}

Write-Host 'PM2 process status:' -ForegroundColor Cyan
$snapshot = Get-Pm2Snapshot
if (-not $snapshot -or $snapshot.Count -eq 0) {
    if ($script:Pm2SnapshotError) {
        Write-Host "PM2 snapshot unavailable: $script:Pm2SnapshotError" -ForegroundColor Yellow
    } else {
        Write-Host 'No PM2 processes found.' -ForegroundColor Yellow
    }
} else {
    $snapshot |
        Sort-Object Name |
        Format-Table Name, Status, PID, MemoryMB, Restarts -AutoSize
}

Write-Host 'HTTP health checks:' -ForegroundColor Cyan
$healthRows = @(
    Test-HttpHealth -Name 'backend-health' -Url $BackendUrl
    Test-HttpHealth -Name 'inventory-health' -Url $InventoryUrl
    Test-HttpHealth -Name 'scan-health' -Url $ScanUrl
)
if ($BackendSecondaryUrl) {
    $healthRows += Test-HttpHealth -Name 'backend-secondary-health' -Url $BackendSecondaryUrl
}
$chatRuntimeRows = @(
    Test-BackendChatRuntime -Name 'backend-chat-runtime' -Url $BackendUrl
)
if ($BackendSecondaryUrl) {
    $chatRuntimeRows += Test-BackendChatRuntime -Name 'backend-secondary-chat-runtime' -Url $BackendSecondaryUrl
}
$pm2RuntimeRows = @(
    Get-Pm2ProcessStatus -Snapshot $snapshot -Name 'itinvent-backend'
    Get-Pm2ProcessStatus -Snapshot $snapshot -Name 'itinvent-chat-push-worker'
    Get-Pm2ProcessStatus -Snapshot $snapshot -Name 'itinvent-ai-chat-worker'
)
$healthRows | Format-Table Name, Status, Details -AutoSize
Write-Host 'Chat runtime checks:' -ForegroundColor Cyan
@($chatRuntimeRows | Where-Object { $_ }) | Format-Table Name, Status, Details -AutoSize
Write-Host 'Critical PM2 processes:' -ForegroundColor Cyan
$pm2RuntimeRows | Format-Table Name, Status, Details -AutoSize
