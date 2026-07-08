param(
    [string]$BackendUrl = 'http://127.0.0.1:8001/health',
    [string]$BackendReadyUrl = 'http://127.0.0.1:8001/health/ready',
    [string]$BackendSecondaryUrl = '',
    [string]$BackendSecondaryReadyUrl = '',
    [string]$InventoryUrl = 'http://127.0.0.1:8012/health',
    [string]$InventoryReadyUrl = 'http://127.0.0.1:8012/health/ready',
    [string]$ScanUrl = 'http://127.0.0.1:8011/health',
    [switch]$RepairBackend,
    [switch]$RepairScan
)

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$script:Pm2SnapshotError = ''

function Resolve-NodeCommand {
    $node = Get-Command 'node' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
    if ($node) {
        return $node
    }

    $toolsDir = Join-Path $projectRoot 'tools'
    if (Test-Path $toolsDir) {
        $nodeDir = Get-ChildItem -Path $toolsDir -Directory -Filter 'node-*-win-x64-*' -ErrorAction SilentlyContinue |
            Where-Object { Test-Path (Join-Path $_.FullName 'node.exe') } |
            Sort-Object Name -Descending |
            Select-Object -First 1
        if ($nodeDir) {
            $env:Path = "$($nodeDir.FullName);$env:Path"
            return (Join-Path $nodeDir.FullName 'node.exe')
        }
    }

    return $null
}

$nodeCmd = Resolve-NodeCommand

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

function Convert-Pm2JlistWithNode {
    param([string[]]$JlistRaw)

    $nodeScript = @"
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const rows = JSON.parse(input);
  const slim = rows.map((item) => ({
    name: item && item.name,
    pid: item && item.pid,
    pm2_env: {
      status: item && item.pm2_env && item.pm2_env.status,
      restart_time: item && item.pm2_env && item.pm2_env.restart_time,
      pm_uptime: item && item.pm2_env && item.pm2_env.pm_uptime,
    },
    monit: {
      memory: item && item.monit && item.monit.memory,
    },
  }));
  for (const item of slim) {
    process.stdout.write(JSON.stringify(item) + '\n');
  }
});
"@
    $slimRaw = (($JlistRaw -join "`n") | & $nodeCmd -e $nodeScript 2>&1)
    if ($LASTEXITCODE -ne 0 -or -not $slimRaw) {
        $errorText = (($slimRaw | ForEach-Object { "$_" }) -join ' ').Trim()
        throw "Failed to reduce PM2 jlist JSON with Node: $errorText"
    }

    return @(
        $slimRaw |
            Where-Object { "$_".Trim() } |
            ForEach-Object { "$_" | ConvertFrom-Json }
    )
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

    if ($nodeCmd) {
        try {
            $rows = Convert-Pm2JlistWithNode -JlistRaw $jlistRaw
        } catch {
            $script:Pm2SnapshotError = $_.Exception.Message
            return @()
        }
    } else {
        try {
            $rows = @(($jlistRaw -join "`n") | ConvertFrom-Json)
        } catch {
            $script:Pm2SnapshotError = "Failed to parse PM2 jlist JSON and Node fallback is unavailable: $($_.Exception.Message)"
            return @()
        }
    }

    $script:Pm2SnapshotError = ''
    return @($rows | ForEach-Object {
        $pm2Env = $_.pm2_env
        $monit = $_.monit
        $memoryRaw = if ($monit -and $null -ne $monit.memory) { $monit.memory } else { 0.0 }
        if ($memoryRaw -is [array]) {
            $memoryRaw = $memoryRaw | Select-Object -First 1
        }
        $restartRaw = if ($pm2Env) { $pm2Env.restart_time } else { 0 }
        if ($restartRaw -is [array]) {
            $restartRaw = $restartRaw | Select-Object -First 1
        }
        $uptimeRaw = if ($pm2Env) { $pm2Env.pm_uptime } else { 0 }
        if ($uptimeRaw -is [array]) {
            $uptimeRaw = $uptimeRaw | Select-Object -First 1
        }
        $memoryBytes = 0.0
        [void][double]::TryParse([string]$memoryRaw, [ref]$memoryBytes)
        $uptimeMs = 0
        [void][int64]::TryParse([string]$uptimeRaw, [ref]$uptimeMs)
        [pscustomobject]@{
            Name = $_.name
            Status = if ($pm2Env) { $pm2Env.status } else { $null }
            PID = $_.pid
            MemoryMB = '{0:N1}' -f ($memoryBytes / 1MB)
            Restarts = $restartRaw
            UptimeSec = if ($pm2Env -and $null -ne $uptimeRaw) { [int]($uptimeMs / 1000) } else { 0 }
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

function Get-PortListenerPids {
    param([int]$ListenPort = 8001)
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

function Test-BackendPortMismatch {
    param($Snapshot)

    $backend = $Snapshot | Where-Object { $_.Name -eq 'itinvent-backend' } | Select-Object -First 1
    if (-not $backend -or $backend.Status -ne 'online') {
        return $null
    }

    $listeners = Get-PortListenerPids -ListenPort 8001
    if ($listeners.Count -eq 0) {
        return [pscustomobject]@{
            Mismatch = $true
            Reason   = 'port 8001 has no listener while PM2 backend is online'
        }
    }

    $pm2Pid = [int]$backend.PID
    if ($listeners -notcontains $pm2Pid) {
        return [pscustomobject]@{
            Mismatch = $true
            Reason   = "port 8001 held by PID $($listeners -join ', '), PM2 backend PID is $pm2Pid"
        }
    }

    if ([int]$backend.Restarts -gt 20 -and [int]$backend.UptimeSec -lt 60) {
        return [pscustomobject]@{
            Mismatch = $true
            Reason   = "restart storm (restarts=$($backend.Restarts), short uptime)"
        }
    }

    return [pscustomobject]@{ Mismatch = $false }
}

function Get-ScanPythonProcesses {
    $rows = @(Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" -ErrorAction SilentlyContinue)
    $api = @()
    $worker = @()
    foreach ($row in $rows) {
        $cmd = [string]$row.CommandLine
        if (-not $cmd) {
            continue
        }
        if ($cmd -match '(^|\s)-m\s+scan_server(\s|$)' -and $cmd -notmatch 'scan_server\.worker_main') {
            $api += $row
        } elseif ($cmd -match '(^|\s)-m\s+scan_server\.worker_main(\s|$)') {
            $worker += $row
        }
    }
    return [pscustomobject]@{
        Api = @($api)
        Worker = @($worker)
    }
}

function Test-ScanRuntime {
    param($Snapshot)

    $scan = $Snapshot | Where-Object { $_.Name -eq 'itinvent-scan' } | Select-Object -First 1
    $scanWorker = $Snapshot | Where-Object { $_.Name -eq 'itinvent-scan-worker' } | Select-Object -First 1
    $listeners = Get-PortListenerPids -ListenPort 8011
    $processes = Get-ScanPythonProcesses
    $failures = @()
    $warnings = @()

    if (-not $scan -or $scan.Status -ne 'online') {
        $failures += 'PM2 itinvent-scan is not online'
    } elseif ($listeners.Count -eq 0) {
        $failures += 'port 8011 has no listener while PM2 scan is online'
    } elseif ($listeners -notcontains [int]$scan.PID) {
        $failures += "port 8011 held by PID $($listeners -join ', '), PM2 scan PID is $($scan.PID)"
    }

    if (-not $scanWorker -or $scanWorker.Status -ne 'online') {
        $failures += 'PM2 itinvent-scan-worker is not online'
    }

    if ($processes.Api.Count -ne 1) {
        $failures += "scan API process count is $($processes.Api.Count), expected 1"
    }
    if ($processes.Worker.Count -ne 1) {
        $failures += "scan worker process count is $($processes.Worker.Count), expected 1"
    }

    $apiPids = @($processes.Api | ForEach-Object { $_.ProcessId }) -join ','
    $workerPids = @($processes.Worker | ForEach-Object { $_.ProcessId }) -join ','
    $details = @(
        "port8011=$($listeners -join ',')"
        "pm2ScanPid=$($scan.PID)"
        "pm2WorkerPid=$($scanWorker.PID)"
        "apiPids=$apiPids"
        "workerPids=$workerPids"
    ) -join ' '

    if ($failures.Count -gt 0) {
        return [pscustomobject]@{
            Name = 'scan-runtime'
            Status = 'fail'
            Details = (($failures + $warnings + $details) -join '; ')
        }
    }
    if ($warnings.Count -gt 0) {
        return [pscustomobject]@{
            Name = 'scan-runtime'
            Status = 'warn'
            Details = (($warnings + $details) -join '; ')
        }
    }
    return [pscustomobject]@{
        Name = 'scan-runtime'
        Status = 'ok'
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
$chatRuntimeRows = @(
    Test-BackendChatRuntime -Name 'backend-chat-runtime' -Url $BackendReadyUrl
)
if ($BackendSecondaryUrl) {
    $healthRows += Test-HttpHealth -Name 'backend-secondary-health' -Url $BackendSecondaryUrl
}
if ($BackendSecondaryReadyUrl) {
    $chatRuntimeRows += Test-BackendChatRuntime -Name 'backend-secondary-chat-runtime' -Url $BackendSecondaryReadyUrl
} elseif ($BackendSecondaryUrl) {
    $secondaryReadyUrl = ($BackendSecondaryUrl -replace '/health/?$', '/health/ready')
    $chatRuntimeRows += Test-BackendChatRuntime -Name 'backend-secondary-chat-runtime' -Url $secondaryReadyUrl
}
$pm2RuntimeRows = @(
    Get-Pm2ProcessStatus -Snapshot $snapshot -Name 'itinvent-backend'
    Get-Pm2ProcessStatus -Snapshot $snapshot -Name 'itinvent-mail-notification-worker'
    Get-Pm2ProcessStatus -Snapshot $snapshot -Name 'itinvent-chat-push-worker'
    Get-Pm2ProcessStatus -Snapshot $snapshot -Name 'itinvent-ai-chat-worker'
    Get-Pm2ProcessStatus -Snapshot $snapshot -Name 'itinvent-my-files-worker'
)
$healthRows | Format-Table Name, Status, Details -AutoSize
Write-Host 'Chat runtime checks:' -ForegroundColor Cyan
@($chatRuntimeRows | Where-Object { $_ }) | Format-Table Name, Status, Details -AutoSize
Write-Host 'Critical PM2 processes:' -ForegroundColor Cyan
$pm2RuntimeRows | Format-Table Name, Status, Details -AutoSize

Write-Host 'Scan runtime checks:' -ForegroundColor Cyan
$scanRuntimeRows = @(
    Get-Pm2ProcessStatus -Snapshot $snapshot -Name 'itinvent-scan'
    Get-Pm2ProcessStatus -Snapshot $snapshot -Name 'itinvent-scan-worker'
    Test-ScanRuntime -Snapshot $snapshot
)
$scanRuntimeRows | Format-Table Name, Status, Details -AutoSize
if (@($scanRuntimeRows | Where-Object { $_.Name -eq 'scan-runtime' -and $_.Status -eq 'fail' }).Count -gt 0) {
    Write-Host 'Scan runtime mismatch detected. Run recovery:' -ForegroundColor Red
    if ($RepairScan) {
        Write-Host 'RepairScan: restarting itinvent-scan and itinvent-scan-worker...' -ForegroundColor Cyan
        try {
            $pm2Cmd = Resolve-Pm2Command
            & $pm2Cmd restart itinvent-scan itinvent-scan-worker --update-env | Out-Null
        } catch {
            Write-Host "RepairScan failed: $($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host 'Run: pm2 restart itinvent-scan itinvent-scan-worker --update-env' -ForegroundColor Yellow
        Write-Host 'Or:  powershell -File scripts\pm2\health-check.ps1 -RepairScan' -ForegroundColor Yellow
    }
}

$portMismatch = Test-BackendPortMismatch -Snapshot $snapshot
if ($portMismatch -and $portMismatch.Mismatch) {
    Write-Host "Backend port mismatch: $($portMismatch.Reason)" -ForegroundColor Red
    if ($RepairBackend) {
        Write-Host 'RepairBackend: running restart-backend.ps1...' -ForegroundColor Cyan
        $repairScript = Join-Path $projectRoot 'scripts\pm2\restart-backend.ps1'
        & powershell -NoProfile -ExecutionPolicy Bypass -File $repairScript
    } else {
        Write-Host 'Run: powershell -File scripts\pm2\restart-backend.ps1' -ForegroundColor Yellow
        Write-Host 'Or:  powershell -File scripts\pm2\health-check.ps1 -RepairBackend' -ForegroundColor Yellow
    }
}
