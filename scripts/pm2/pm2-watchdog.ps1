param(
    [int]$BootGraceMinutes = 10,
    [int]$FailureThreshold = 3,
    [int]$CooldownSeconds = 600,
    [switch]$CheckOnly,
    # Leftovers of a dead PM2 daemon (see Get-HubitOrphanProcesses) are stopped by default. -ReportOnlyOrphans
    # (or HUBIT_WATCHDOG_STOP_ORPHANS=0) keeps them only in the log and in -CheckOnly output.
    [switch]$ReportOnlyOrphans,
    [int]$OrphanMinAgeMinutes = 6,
    [string]$ProjectRoot = 'C:\Project\Image_scan'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $ProjectRoot 'scripts\pm2\runtime-operations.ps1')
. (Join-Path $ProjectRoot 'scripts\pm2\chat-runtime-mode.ps1')
$logFile = Join-Path $ProjectRoot 'scripts\pm2\_watchdog.log'
$stateFile = Join-Path $ProjectRoot 'scripts\pm2\_watchdog_state.json'
function Write-WatchdogLog {
    param([string]$Message)
    Add-Content -LiteralPath $logFile -Value ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message) -Encoding UTF8
}
$mutex = New-Object System.Threading.Mutex($false, 'Global\HUB-IT-PM2-Operations')
$locked = $mutex.WaitOne(0)
if (-not $locked) { $mutex.Dispose(); if ($CheckOnly) { exit 1 }; exit 0 }
$stage = 'initialization'
try {
    Initialize-HubitRuntime -ProjectRoot $ProjectRoot
    if (-not $CheckOnly -and $BootGraceMinutes -gt 0) {
        $bootTime = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
        if (((Get-Date)-$bootTime).TotalMinutes -lt $BootGraceMinutes) { exit 0 }
    }
    if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 1MB) {
        $tail = Get-Content $logFile -Tail 200 -Encoding UTF8
        Set-Content $logFile -Value $tail -Encoding UTF8
    }
    $pm2Cmd = Join-Path $env:USERPROFILE 'AppData\Roaming\npm\pm2.cmd'
    $stage = 'pm2_snapshot'
    $result = Invoke-HubitPm2 -Pm2Command $pm2Cmd -Arguments @('jlist') -TimeoutSeconds 30
    if ($result.ExitCode -ne 0) { throw 'PM2 state unavailable; no recovery attempted.' }
    $snapshot = Convert-HubitPm2Snapshot -Json $result.Output
    $stage = 'readiness_and_policy'
    $expected = Get-HubitExpectedApps -ProjectRoot $ProjectRoot
    if ($expected.Count -eq 0) { throw 'Expected app list is empty.' }
    $mode = Get-ChatRuntimeMode -ProjectRoot $ProjectRoot
    $targets = Get-HubitHealthTargets -ChatMode $mode
    $online = @($snapshot | Where-Object { $_.Status -eq 'online' } | ForEach-Object { $_.Name })
    $notOnline = @($expected | Where-Object { $online -notcontains $_.Name } | ForEach-Object { $_.Name })
    $failedHealth = Get-HubitFailedTargets -Targets $targets
    $drift = Get-HubitConfigDrift -Expected $expected -Snapshot $snapshot
    $failed = @((@($notOnline) + @($failedHealth) + @($drift | ForEach-Object { $_.Name })) | Select-Object -Unique)
    $stage = 'orphan_scan'
    $orphans = @()
    try {
        $orphans = @(Get-HubitOrphanProcesses -Expected $expected -Snapshot $snapshot -Processes (Get-HubitProcessTable))
    } catch {
        # Diagnostics must never block the recovery below.
        Write-WatchdogLog "orphan scan failed: type=$($_.Exception.GetType().Name)"
    }
    $stage = 'readiness_and_policy'
    if ($CheckOnly) {
        [pscustomobject]@{ Failed=$failed; Offline=$notOnline; Readiness=$failedHealth; ConfigDrift=$drift; Orphans=$orphans } | ConvertTo-Json -Depth 5
        if ($failed.Count -gt 0) { exit 1 }
        exit 0
    }
    $state = @{}
    $stage = 'recovery_state'
    if (Test-Path $stateFile) {
        $stored = Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($property in $stored.PSObject.Properties) { $state[$property.Name] = $property.Value }
    }
    foreach ($app in $expected) {
        if (-not $state.ContainsKey($app.Name)) {
            $state[$app.Name] = [pscustomobject]@{ Failures=0; LastAttempt='2000-01-01T00:00:00Z'; Attempts=@() }
        }
        if ($failed -contains $app.Name) { $state[$app.Name].Failures++ } else { $state[$app.Name].Failures=0 }
    }
    $now = [datetime]::UtcNow
    $probeGap = if ($state.ContainsKey('_last_probe_utc')) { [int]($now-([datetime]$state['_last_probe_utc']).ToUniversalTime()).TotalSeconds } else { 0 }
    $state['_last_probe_utc'] = $now.ToString('o')
    $stage = 'orphans'
    $firstSeen = @{}
    foreach ($entry in @($state['_orphans'])) {
        $parts = "$entry" -split '\|', 2
        if ($parts.Count -eq 2) { $firstSeen[[int]$parts[0]] = [datetime]::Parse($parts[1], $null, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime() }
    }
    $stopEnabled = (-not $ReportOnlyOrphans.IsPresent) -and (Get-HubitFlag -Name 'HUBIT_WATCHDOG_STOP_ORPHANS' -Default $true)
    $stillSeen = @{}
    foreach ($orphan in $orphans) {
        $orphanPid = [int]$orphan.ProcessId
        if ($firstSeen.ContainsKey($orphanPid)) {
            $stillSeen[$orphanPid] = $firstSeen[$orphanPid]
        } else {
            $stillSeen[$orphanPid] = $now
            $action = if ($stopEnabled) { "stop after ${OrphanMinAgeMinutes} min if PM2 holds the app" } else { 'report only' }
            Write-WatchdogLog ("orphan detected: apps={0}, pid={1}, parent={2}, started={3}, action={4}" -f ($orphan.Apps -join ','), $orphanPid, $orphan.ParentProcessId, $orphan.StartedUtc, $action)
        }
    }
    if ($stopEnabled -and $orphans.Count -gt 0) {
        $toStop = @(Select-HubitOrphansToStop -Orphans $orphans -FirstSeen $stillSeen -Now $now -KnownAppNames @($snapshot | ForEach-Object { $_.Name }) -OnlineCount $online.Count -MinAgeMinutes $OrphanMinAgeMinutes -MaxPerRun 1)
        foreach ($orphan in $toStop) {
            $kill = Invoke-HubitCommand -Executable 'taskkill.exe' -Arguments @('/PID', "$($orphan.ProcessId)", '/T', '/F') -TimeoutSeconds 30
            Write-WatchdogLog ("orphan stopped: apps={0}, pid={1}, exit={2}" -f ($orphan.Apps -join ','), $orphan.ProcessId, $kill.ExitCode)
            $stillSeen.Remove([int]$orphan.ProcessId)
        }
    }
    $state['_orphans'] = @($stillSeen.GetEnumerator() | ForEach-Object { '{0}|{1}' -f $_.Key, $_.Value.ToString('o') })
    $stage = 'recovery_state'
    $recover = @($failed | Where-Object {
        $entry = $state[$_]
        $decision = Get-HubitRecoveryDecision -Failures $entry.Failures -Now $now -LastAttempt ([datetime]$entry.LastAttempt) -Attempts @($entry.Attempts | ForEach-Object { [datetime]$_ }) -Threshold $FailureThreshold -CooldownSeconds $CooldownSeconds
        Write-WatchdogLog "health failure: $_, count=$($entry.Failures), decision=$decision"
        $decision -eq 'recover'
    })
    if ($recover.Count -gt 0) {
        $name = $recover[0]
        $entry = $state[$name]
        $entry.LastAttempt = $now.ToString('o')
        $entry.Attempts = @($entry.Attempts | Where-Object { ($now-([datetime]$_).ToUniversalTime()).TotalSeconds -lt 3600 }) + @($entry.LastAttempt)
    }
    $temporaryState = "$stateFile.tmp"
    $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporaryState -Encoding UTF8
    Move-Item -LiteralPath $temporaryState -Destination $stateFile -Force
    if ($recover.Count -eq 0 -and $probeGap -lt 300) { exit 0 }
    $incidentPath = Join-Path $ProjectRoot ('output\pm2-incidents\' + $now.ToString('yyyyMMdd-HHmmss') + '.json')
    $capture = Invoke-HubitCommand -Executable (Get-Command python).Source -Arguments @((Join-Path $ProjectRoot 'scripts\pm2\capture-runtime-diagnostics.py'), '--output', $incidentPath, '--probe-gap-seconds', "$probeGap") -TimeoutSeconds 60
    Write-WatchdogLog "incident snapshot exit=$($capture.ExitCode), path=$incidentPath"
    if ($recover.Count -eq 0) { Write-WatchdogLog "probe gap: ${probeGap}s; readiness recovered, no restart"; exit 0 }
    $stage = 'recovery'
    if ($name -in @('itinvent-inventory','itinvent-voice') -and $online.Count -gt 0) {
        Write-WatchdogLog "recovering $name via simple service restart"
        Restart-HubitSimpleService -Name $name -Pm2Command $pm2Cmd -ProjectRoot $ProjectRoot
        Write-WatchdogLog "recovered ${name}; health check passed"
        exit 0
    }
    if ($name -in @('itinvent-my-files-worker','itinvent-mail-notification-worker','itinvent-preview-worker','itinvent-chat-push-worker') -and $online.Count -gt 0) {
        Write-WatchdogLog "recovering $name via worker restart"
        Restart-HubitWorker -Name $name -Pm2Command $pm2Cmd -ProjectRoot $ProjectRoot
        Write-WatchdogLog "restarted $name"
        exit 0
    }
    if ($online.Count -eq 0 -or @($snapshot | Where-Object { $_.Name -eq $name }).Count -eq 0) {
        $scriptPath = Join-Path $ProjectRoot 'scripts\pm2\pm2-boot-resurrect.ps1'
        $scriptArgs = @('-DelaySeconds','0','-SkipOperationLock')
        $timeout = 900
    } elseif ($name -match '^itinvent-chat-[ab]$') {
        $scriptPath = Join-Path $ProjectRoot 'scripts\pm2\restart-chat-scale.ps1'
        $scriptArgs = @('-NodeName',$name,'-SkipSharedWorkers','-SkipOperationLock')
        $timeout = 240
    } elseif ($name -eq 'itinvent-chat') {
        $scriptPath = Join-Path $ProjectRoot 'scripts\pm2\restart-chat.ps1'
        $scriptArgs = @()
        $timeout = 180
    } elseif ($name -eq 'itinvent-backend') {
        $scriptPath = Join-Path $ProjectRoot 'scripts\pm2\restart-backend.ps1'
        $scriptArgs = @()
        $timeout = 240
    } elseif ($name -eq 'itinvent-scan') {
        $scriptPath = Join-Path $ProjectRoot 'scripts\pm2\restart-scan.ps1'
        $scriptArgs = @()
        $timeout = 180
    } elseif ($notOnline -contains $name) {
        $scriptPath = Join-Path $ProjectRoot 'scripts\pm2\pm2-boot-resurrect.ps1'
        $scriptArgs = @('-DelaySeconds','0','-SkipOperationLock')
        $timeout = 900
    } else {
        Write-WatchdogLog "manual recovery required: $name; no dedicated restart procedure"
        exit 1
    }
    Write-WatchdogLog "recovering $name via $scriptPath"
    $repair = Invoke-HubitCommand -Executable 'powershell.exe' -Arguments (@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$scriptPath) + $scriptArgs) -TimeoutSeconds $timeout
    $post = Get-HubitFailedTargets -Targets $targets
    Write-WatchdogLog "recovery exit=$($repair.ExitCode), readiness failures=$($post -join ',')"
    if ($repair.ExitCode -ne 0 -or $post.Count -gt 0) { exit 1 }
    exit 0
} catch {
    $reason = ([string]$_.Exception.Message) -replace '\s+', ' '
    if ($reason.Length -gt 200) { $reason = $reason.Substring(0, 200) }
    Write-WatchdogLog "watchdog failed: stage=$stage, type=$($_.Exception.GetType().Name), reason=$reason; no additional recovery attempted"
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
