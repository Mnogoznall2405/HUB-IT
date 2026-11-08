# Shared operational guards. Dot-sourcing this file never mutates runtime.
function Initialize-HubitRuntime {
    param([string]$ProjectRoot)
    if (-not $env:USERPROFILE) {
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $env:USERPROFILE = [Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sid").ProfileImagePath)
    }
    $portableNode = Join-Path $ProjectRoot 'tools\node-v24.14.0-win-x64-full'
    if (Test-Path (Join-Path $portableNode 'node.exe')) { $env:Path = "$portableNode;$env:Path" }
    if (-not $env:PM2_HOME) { $env:PM2_HOME = Join-Path $env:USERPROFILE '.pm2' }
    # Scheduled S4U jobs can lack the user's PATH. Reuse the runtime Python.
    $pythonCandidates = @(
        $env:PM2_PYTHON
        (Join-Path $ProjectRoot '.venv\Scripts\python.exe')
        (Join-Path $ProjectRoot 'WEB-itinvent\.venv\Scripts\python.exe')
        (Join-Path $env:USERPROFILE 'AppData\Local\Programs\Python\Python312\python.exe')
        (Join-Path $env:USERPROFILE 'AppData\Local\Programs\Python\Python311\python.exe')
    )
    $python = $pythonCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if ($python) { $env:Path = "$(Split-Path $python);$env:Path" }
}

function Invoke-HubitCommand {
    param([string]$Executable, [string[]]$Arguments, [int]$TimeoutSeconds = 90)
    # Files avoid waiting for EOF on a pipe inherited by a detached PM2 daemon.
    $prefix = Join-Path ([IO.Path]::GetTempPath()) ('hubit-pm2-' + [guid]::NewGuid().ToString('N'))
    $stdout = "$prefix.out"
    $stderr = "$prefix.err"
    foreach ($arg in $Arguments) {
        if ($arg -match '["\r\n]') { throw 'Unsupported command argument.' }
    }
    $quoted = @($Arguments | ForEach-Object { '"' + $_ + '"' })
    try {
        $process = Start-Process -FilePath $Executable -ArgumentList $quoted -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr -ErrorAction Stop
        # Cache the handle before a short-lived CLI exits (Windows PowerShell 5.1).
        $null = $process.Handle
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            # Kill only this command client; preserve managed services and the daemon.
            $process.Kill()
            return [pscustomobject]@{ ExitCode = 124; Output = ''; TimedOut = $true }
        }
        $exitCode = $process.ExitCode
        $output = if (Test-Path $stdout) { Get-Content -LiteralPath $stdout -Raw -Encoding UTF8 } else { '' }
        return [pscustomobject]@{ ExitCode = $exitCode; Output = $output; TimedOut = $false }
    } finally {
        # Raw jlist contains environment values: never retain it as an incident log.
        Remove-Item -LiteralPath $stdout,$stderr -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-HubitPm2 {
    param([string]$Pm2Command, [string[]]$Arguments, [int]$TimeoutSeconds = 90)
    $cli = Join-Path (Split-Path $Pm2Command) 'node_modules\pm2\bin\pm2'
    if (-not (Test-Path $cli)) { throw 'PM2 CLI entrypoint not found.' }
    $node = (Get-Command node -ErrorAction Stop).Source
    return Invoke-HubitCommand -Executable $node -Arguments (@($cli) + $Arguments) -TimeoutSeconds $TimeoutSeconds
}

function Convert-HubitPm2Snapshot {
    param([string]$Json)
    $start = $Json.IndexOf('[')
    $end = $Json.LastIndexOf(']')
    if ($start -lt 0 -or $end -le $start) { throw 'PM2 snapshot is unreadable.' }
    $payload = $Json.Substring($start, $end-$start+1)
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        $parsed = ConvertFrom-Json -InputObject $payload -AsHashtable
        $rows = @($parsed)
    } else {
        Add-Type -AssemblyName System.Web.Extensions
        $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
        $serializer.MaxJsonLength = [int]::MaxValue
        $rows = @($serializer.DeserializeObject($payload))
    }
    return ,@($rows | ForEach-Object {
        $row = $_
        $pm = $row['pm2_env']
        $safe = @{}
        foreach ($key in $pm.Keys) {
            if ($key -match '^(APP_DB|CHAT_DB)_(POOL_SIZE|MAX_OVERFLOW|WRITE_POOL_SIZE|WRITE_MAX_OVERFLOW|READ_POOL_SIZE|READ_MAX_OVERFLOW|POOL_TIMEOUT|APPLICATION_NAME|READ_APPLICATION_NAME)$|^CHAT_REALTIME_(TRANSPORT|REQUIRED)$|^CHAT_PROCESS_COUNT$') {
                $safe[$key] = [string]$pm[$key]
            }
        }
        [pscustomobject]@{ Name=$row['name']; Status=$pm['status']; PID=$row['pid']; Restarts=$pm['restart_time']; Environment=$safe }
    })
}

function Get-HubitExpectedApps {
    param([string]$ProjectRoot)
    $result = Invoke-HubitCommand -Executable (Get-Command node).Source -Arguments @((Join-Path $ProjectRoot 'scripts\pm2\runtime-policy.js')) -TimeoutSeconds 20
    if ($result.ExitCode -ne 0) { throw 'Cannot read ecosystem policy.' }
    $apps = ConvertFrom-Json -InputObject $result.Output
    if (@($apps).Count -eq 0 -or @($apps | Where-Object { -not ($_.Name -is [string]) -or -not $_.Name -or $null -eq $_.Environment }).Count -gt 0) { throw 'Invalid ecosystem policy.' }
    return ,@($apps)
}

function Get-HubitConfigDrift {
    param([object[]]$Expected, [object[]]$Snapshot)
    return ,@(foreach ($app in $Expected) {
        $actual = @($Snapshot | Where-Object { $_.Name -eq $app.Name })
        if ($actual.Count -ne 1) { continue }
        $keys = @($app.Environment.PSObject.Properties | Where-Object { [string]$actual[0].Environment[$_.Name] -cne [string]$_.Value } | ForEach-Object { $_.Name })
        if ($keys.Count -gt 0) { [pscustomobject]@{ Name=$app.Name; Keys=$keys } }
    })
}

function Get-HubitHealthTargets {
    param([string]$ChatMode)
    return @(
        [pscustomobject]@{ Name='itinvent-backend'; Url='http://127.0.0.1:8001/health/ready' }
        if ($ChatMode -eq 'dual') {
            [pscustomobject]@{ Name='itinvent-chat-a'; Url='http://127.0.0.1:8002/health/ready' }
            [pscustomobject]@{ Name='itinvent-chat-b'; Url='http://127.0.0.1:8004/health/ready' }
        } else { [pscustomobject]@{ Name='itinvent-chat'; Url='http://127.0.0.1:8002/health/ready' } }
        [pscustomobject]@{ Name='itinvent-inventory'; Url='http://127.0.0.1:8012/health/ready' }
        [pscustomobject]@{ Name='itinvent-scan'; Url='http://127.0.0.1:8011/health' }
        [pscustomobject]@{ Name='itinvent-voice'; Url='http://127.0.0.1:8013/health' }
    )
}

function Test-HubitHealth {
    param([object]$Target)
    try {
        $payload = Invoke-RestMethod -Uri $Target.Url -TimeoutSec 5
        $ok = $payload.status -eq 'ok'
        if ($Target.Name -match '^itinvent-chat-[ab]$') {
            $ok = $ok -and $payload.chat.realtime_transport -eq 'postgres' -and $payload.chat.realtime_available -eq $true -and $payload.chat.realtime_subscriber_ready -eq $true
        }
        return [bool]$ok
    } catch { return $false }
}

function Get-HubitFailedTargets {
    param([object[]]$Targets)
    return ,@($Targets | Where-Object { -not (Test-HubitHealth -Target $_) } | ForEach-Object { $_.Name })
}

function Get-HubitRecoveryDecision {
    param([int]$Failures, [datetime]$Now, [datetime]$LastAttempt, [datetime[]]$Attempts, [int]$Threshold=3, [int]$CooldownSeconds=600)
    $Now = $Now.ToUniversalTime()
    $LastAttempt = $LastAttempt.ToUniversalTime()
    if ($Failures -lt $Threshold) { return 'wait' }
    if (($Now-$LastAttempt).TotalSeconds -lt $CooldownSeconds) { return 'cooldown' }
    if (@($Attempts | Where-Object { ($Now-$_.ToUniversalTime()).TotalSeconds -lt 3600 }).Count -ge 2) { return 'circuit_open' }
    return 'recover'
}

function Get-HubitProbeClassification {
    # Tells an independent probe from the aftermath of a frozen host.
    #   stall  - the watchdog itself did not run for >= StallGapSeconds: the VM/storage was frozen, and health
    #            failures right after it are the aftermath, not independent failures (counters are reset).
    #   grace  - still inside the post-stall grace window (services are catching up; no recovery yet).
    #   burst  - a scheduler run that fired right after another run (queued while the VM was frozen): it is not
    #            an independent probe and must not add to the failure counters.
    #   normal - count failures and recover by the usual policy.
    param([int]$ProbeGapSeconds, [datetime]$Now, [string]$GraceUntilUtc = '', [int]$StallGapSeconds = 240, [int]$BurstGapSeconds = 20)
    if ($ProbeGapSeconds -ge $StallGapSeconds) { return 'stall' }
    if ($GraceUntilUtc) {
        $until = [datetime]::Parse($GraceUntilUtc, $null, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
        if ($Now.ToUniversalTime() -lt $until) { return 'grace' }
    }
    if ($ProbeGapSeconds -gt 0 -and $ProbeGapSeconds -lt $BurstGapSeconds) { return 'burst' }
    return 'normal'
}

function Get-HubitFlag {
    param([string]$Name, [bool]$Default = $false)
    foreach ($scope in 'Process', 'User', 'Machine') {
        $value = [Environment]::GetEnvironmentVariable($Name, $scope)
        if ($value) { return ($value.Trim().ToLowerInvariant() -in @('1', 'true', 'yes', 'on')) }
    }
    return $Default
}

function ConvertTo-HubitCommandKey {
    param([string]$Text)
    return (($Text -replace '"', '') -replace '\s+', ' ').Trim().ToLowerInvariant()
}

function Get-HubitProcessTable {
    return ,@(Get-CimInstance Win32_Process | ForEach-Object {
        [pscustomobject]@{
            ProcessId = [int]$_.ProcessId
            ParentProcessId = [int]$_.ParentProcessId
            CreationDate = $_.CreationDate
            CommandLine = [string]$_.CommandLine
        }
    })
}

# Orphans: processes launched like an expected PM2 app whose parent is gone and that the live PM2 does not
# manage. A dead PM2 daemon leaves them behind; they keep ports and singleton locks, so the replacement
# copies started by the new daemon crash-loop (incident 12.10.2026). Pure function: no side effects.
function Get-HubitOrphanProcesses {
    param([object[]]$Expected, [object[]]$Snapshot, [object[]]$Processes)
    $managed = @{}
    foreach ($row in @($Snapshot)) {
        if ($row.PID -and [int]$row.PID -gt 0) { $managed[[int]$row.PID] = $true }
    }
    $byId = @{}
    foreach ($proc in @($Processes)) { $byId[[int]$proc.ProcessId] = $proc }
    $found = @()
    foreach ($proc in @($Processes)) {
        if (-not $proc.CommandLine -or $managed.ContainsKey([int]$proc.ProcessId)) { continue }
        $created = ([datetime]$proc.CreationDate).ToUniversalTime()
        $parent = $byId[[int]$proc.ParentProcessId]
        # A "parent" younger than its child is a reused PID, i.e. the real parent is gone.
        if ($null -ne $parent -and ([datetime]$parent.CreationDate).ToUniversalTime() -le $created) { continue }
        $key = ConvertTo-HubitCommandKey $proc.CommandLine
        $apps = @($Expected | Where-Object {
            $_.PSObject.Properties['Executable'] -and $_.Executable -and $_.Arguments -and
            $key.StartsWith((ConvertTo-HubitCommandKey $_.Executable), [StringComparison]::Ordinal) -and
            $key.EndsWith(' ' + (ConvertTo-HubitCommandKey $_.Arguments), [StringComparison]::Ordinal)
        } | ForEach-Object { $_.Name })
        if ($apps.Count -gt 0) {
            $found += [pscustomobject]@{
                ProcessId = [int]$proc.ProcessId
                ParentProcessId = [int]$proc.ParentProcessId
                Apps = $apps
                StartedUtc = $created.ToString('o')
            }
        }
    }
    return $found
}

# Which orphans may be stopped now. Bounded: only after they were seen for MinAgeMinutes, only while PM2 runs
# something and already has an entry for the app (a replacement exists), at most MaxPerRun per run.
function Select-HubitOrphansToStop {
    param([object[]]$Orphans, [hashtable]$FirstSeen, [datetime]$Now, [string[]]$KnownAppNames, [int]$OnlineCount, [int]$MinAgeMinutes = 6, [int]$MaxPerRun = 1)
    if ($OnlineCount -le 0) { return @() }
    $selected = @()
    foreach ($orphan in @($Orphans)) {
        if ($selected.Count -ge $MaxPerRun) { break }
        $seen = $FirstSeen[[int]$orphan.ProcessId]
        if ($null -eq $seen) { continue }
        if (($Now.ToUniversalTime() - ([datetime]$seen).ToUniversalTime()).TotalMinutes -lt $MinAgeMinutes) { continue }
        if (@($orphan.Apps | Where-Object { $KnownAppNames -contains $_ }).Count -eq 0) { continue }
        $selected += $orphan
    }
    return $selected
}

function Restart-HubitSimpleService {
    param([ValidateSet('itinvent-inventory','itinvent-voice')][string]$Name, [string]$Pm2Command, [string]$ProjectRoot)
    $port = if ($Name -eq 'itinvent-inventory') { 8012 } else { 8013 }
    $stop = Invoke-HubitPm2 -Pm2Command $Pm2Command -Arguments @('stop',$Name)
    if ($stop.ExitCode -ne 0) { throw 'Cannot stop the selected service.' }
    $ecosystem = Join-Path $ProjectRoot 'scripts\pm2\ecosystem.all.config.js'
    try {
        # A stopped process may need a while to leave (kernel-side teardown after a hung socket); never kill an unverified owner.
        $portDeadline = [datetime]::UtcNow.AddSeconds(60)
        do {
            Start-Sleep -Seconds 3
            $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
        } while ($listeners.Count -gt 0 -and [datetime]::UtcNow -lt $portDeadline)
        if ($listeners.Count -gt 0) { throw 'Port still occupied; refusing to kill an unverified process.' }
        $delete = Invoke-HubitPm2 -Pm2Command $Pm2Command -Arguments @('delete',$Name)
        if ($delete.ExitCode -ne 0) { throw 'Cannot replace the selected PM2 registration.' }
        $start = Invoke-HubitPm2 -Pm2Command $Pm2Command -Arguments @('start',$ecosystem,'--only',$Name,'--update-env')
        if ($start.ExitCode -ne 0) { throw 'Cannot start the selected service.' }
        $target = (Get-HubitHealthTargets -ChatMode 'dual' | Where-Object { $_.Name -eq $Name })
        $deadline = [datetime]::UtcNow.AddSeconds(75)
        do {
            if (Test-HubitHealth -Target $target) {
                $save = Invoke-HubitPm2 -Pm2Command $Pm2Command -Arguments @('save')
                if ($save.ExitCode -ne 0) { throw 'Cannot save recovered service state.' }
                return
            }
            Start-Sleep -Seconds 3
        } while ([datetime]::UtcNow -lt $deadline)
        throw 'Recovered service did not become ready.'
    } catch {
        # The service was stopped above: never leave it down until the next cooldown. PM2 autorestart keeps retrying
        # (e.g. while a dying process still holds the port); the original failure is still reported to the caller.
        $failure = $_
        try { [void](Invoke-HubitPm2 -Pm2Command $Pm2Command -Arguments @('start',$ecosystem,'--only',$Name,'--update-env')) } catch { }
        throw $failure
    }
}

function Restart-HubitWorker {
    param([ValidateSet('itinvent-my-files-worker','itinvent-mail-notification-worker','itinvent-preview-worker','itinvent-chat-push-worker','itinvent-monitoring-worker')][string]$Name, [string]$Pm2Command, [string]$ProjectRoot)
    $result = Invoke-HubitPm2 -Pm2Command $Pm2Command -Arguments @('jlist') -TimeoutSeconds 30
    if ($result.ExitCode -ne 0) { throw 'Cannot inspect worker ownership.' }
    $row = @((Convert-HubitPm2Snapshot -Json $result.Output) | Where-Object { $_.Name -eq $Name })
    if ($row.Count -ne 1) { throw 'Expected one registered worker.' }
    $oldPid = [int]$row[0].PID
    $stop = Invoke-HubitPm2 -Pm2Command $Pm2Command -Arguments @('stop',$Name)
    if ($stop.ExitCode -ne 0) { throw 'Cannot stop worker.' }
    $deadline = [datetime]::UtcNow.AddSeconds(20)
    while ($oldPid -gt 0 -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
        if ([datetime]::UtcNow -ge $deadline) { throw 'Old worker is still running; refusing duplicate start.' }
        Start-Sleep -Seconds 1
    }
    $delete = Invoke-HubitPm2 -Pm2Command $Pm2Command -Arguments @('delete',$Name)
    if ($delete.ExitCode -ne 0) { throw 'Cannot replace worker registration.' }
    $start = Invoke-HubitPm2 -Pm2Command $Pm2Command -Arguments @('start',(Join-Path $ProjectRoot 'scripts\pm2\ecosystem.all.config.js'),'--only',$Name,'--update-env')
    if ($start.ExitCode -ne 0) { throw 'Cannot start worker.' }
}
