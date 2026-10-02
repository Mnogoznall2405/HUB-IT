param(
    [int]$DelaySeconds = 30,
    # After resurrect, heavy non-chat workers wait for chat nodes to become
    # ready so cold-start DB/CPU contention does not delay the ARR farm.
    [int]$ChatReadyTimeoutSec = 240,
    # Time given to started processes to reach "online" before the final check.
    [int]$SettleSeconds = 30,
    [switch]$NoChatStaging
)

# Boot autostart for HUB-IT PM2 processes. Idempotent: safe to rerun at any
# time (Task Scheduler retries it on a non-zero exit code).
#   1. pm2 resurrect from dump.pm2 when nothing is online;
#   2. start every app of ecosystem.all.config.js that is still missing
#      (covers a stale or missing dump.pm2);
#   3. staged start of heavy workers after chat nodes are ready;
#   4. pm2 save when every expected app is online, otherwise exit 1.

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$logFile = Join-Path $projectRoot 'scripts\pm2\_boot_resurrect.log'
$prevLogFile = Join-Path $projectRoot 'scripts\pm2\_boot_resurrect.prev.log'
$ecosystemAll = Join-Path $projectRoot 'scripts\pm2\ecosystem.all.config.js'
. (Join-Path $projectRoot 'scripts\pm2\chat-runtime-mode.ps1')

function Write-BootLog {
    param([string]$Message)
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

function Add-LocalNodeToPath {
    if (Get-Command 'node' -ErrorAction SilentlyContinue) {
        return
    }

    $toolsDir = Join-Path $projectRoot 'tools'
    if (-not (Test-Path $toolsDir)) {
        return
    }

    $nodeDir = Get-ChildItem -Path $toolsDir -Directory -Filter 'node-*-win-x64-*' -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName 'node.exe') } |
        Sort-Object Name |
        Select-Object -First 1

    if ($nodeDir) {
        $env:Path = "$($nodeDir.FullName);$env:Path"
    }
}

function Resolve-Pm2Command {
    # S4U/AtStartup runs without the user's HKCU environment, so APPDATA can be
    # null and Join-Path would throw before any fallback is attempted.
    $npmRoots = @()
    if ($env:APPDATA) { $npmRoots += $env:APPDATA }
    if ($env:USERPROFILE) { $npmRoots += (Join-Path $env:USERPROFILE 'AppData\Roaming') }
    foreach ($npmRoot in ($npmRoots | Select-Object -Unique)) {
        $preferredGlobalPm2Cmd = Join-Path $npmRoot 'npm\pm2.cmd'
        if (Test-Path $preferredGlobalPm2Cmd) {
            return $preferredGlobalPm2Cmd
        }
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

# Runs pm2 without letting its stderr (HOME warnings, PM2+ banner) turn into a
# terminating NativeCommandError under Windows PowerShell 5.1.
function Invoke-Pm2 {
    param([string[]]$Arguments)
    $prevErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $script:pm2Cmd @Arguments 2>&1 | Out-String
        return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $out }
    } catch {
        return [pscustomobject]@{ ExitCode = 1; Output = $_.Exception.Message }
    } finally {
        $ErrorActionPreference = $prevErrorActionPreference
    }
}

# Returns $null when the PM2 state could not be read, so callers never mistake
# a read failure for "no processes" and resurrect duplicates.
function Get-Pm2Snapshot {
    $result = Invoke-Pm2 -Arguments @('jlist')
    $jlistRaw = $result.Output
    if (-not $jlistRaw) {
        Write-BootLog "jlist empty output (exit=$($result.ExitCode))"
        return $null
    }

    # A PM2+ banner or HOME warning may precede the JSON array.
    $jsonStart = $jlistRaw.IndexOf('[')
    $jsonEnd = $jlistRaw.LastIndexOf(']')
    if ($jsonStart -lt 0 -or $jsonEnd -le $jsonStart) {
        $preview = ($jlistRaw -replace '\s+', ' ').Trim()
        Write-BootLog ("jlist without JSON (len={0}): {1}" -f $jlistRaw.Length, $preview.Substring(0, [Math]::Min(300, $preview.Length)))
        return $null
    }

    # ConvertFrom-Json in Windows PowerShell 5.1 fails on pm2_env keys that
    # differ only by case (username/USERNAME); JavaScriptSerializer does not.
    try {
        Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
        $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
        $serializer.MaxJsonLength = [int]::MaxValue
        $rows = @($serializer.DeserializeObject($jlistRaw.Substring($jsonStart, $jsonEnd - $jsonStart + 1)))
    } catch {
        Write-BootLog "jlist JSON parse failed: $($_.Exception.Message)"
        return $null
    }

    # Unary comma: an empty list must reach the caller as @(), not $null.
    return , @(
        $rows | ForEach-Object {
            if (-not $_) { return }
            $pm2Env = $_['pm2_env']
            [pscustomobject]@{
                Name     = $_['name']
                Status   = if ($pm2Env) { $pm2Env['status'] } else { $null }
                PID      = $_['pid']
                Restarts = if ($pm2Env) { $pm2Env['restart_time'] } else { $null }
            }
        }
    )
}

function Get-Pm2SnapshotWithRetry {
    param([int]$Attempts = 5)
    for ($i = 1; $i -le $Attempts; $i++) {
        $snapshot = Get-Pm2Snapshot
        if ($null -ne $snapshot) {
            return , @($snapshot)
        }
        Start-Sleep -Seconds 5
    }
    return $null
}

# App names that autostart must guarantee: everything in ecosystem.all.config.js
# for the resolved chat mode. Extra apps restored from dump.pm2 are kept as is.
function Get-ExpectedAppNames {
    $prevErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        # No quotes inside: Windows PowerShell 5.1 strips them from native args.
        $jsCode = 'for (const a of (require(process.argv[1]).apps || [])) console.log(a.name)'
        $raw = & node -e $jsCode $ecosystemAll 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) {
            Write-BootLog "cannot read ecosystem apps: $($raw.Trim())"
            return @()
        }
        return @($raw -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    } finally {
        $ErrorActionPreference = $prevErrorActionPreference
    }
}

function Start-MissingApps {
    param([string[]]$ExpectedNames, [object[]]$Snapshot)
    $present = @($Snapshot | ForEach-Object { $_.Name })
    $missing = @($ExpectedNames | Where-Object { $present -notcontains $_ })
    foreach ($name in $missing) {
        $result = Invoke-Pm2 -Arguments @('start', $ecosystemAll, '--only', $name)
        Write-BootLog "start missing $name from ecosystem.all: exit=$($result.ExitCode)"
    }
    return $missing.Count
}

if (Test-Path $logFile) {
    Copy-Item -Path $logFile -Destination $prevLogFile -Force -ErrorAction SilentlyContinue
    Clear-Content -Path $logFile
}
Write-BootLog "pm2-boot-resurrect start (user=$env:USERNAME, delay=${DelaySeconds}s)"

try {
    Add-LocalNodeToPath
    $script:pm2Cmd = Resolve-Pm2Command
    Write-BootLog "pm2 resolved: $pm2Cmd"
    # S4U/AtStartup has no HOMEPATH: PM2 then falls back to C:\etc\.pm2, finds
    # no dump.pm2 and resurrects nothing. Pin PM2_HOME to the owner's profile.
    if (-not $env:PM2_HOME) {
        $pm2UserHome = $env:USERPROFILE
        if (-not $pm2UserHome) {
            # pm2.cmd lives in <profile>\AppData\Roaming\npm\pm2.cmd
            $pm2UserHome = Split-Path (Split-Path (Split-Path (Split-Path $pm2Cmd)))
        }
        $env:PM2_HOME = Join-Path $pm2UserHome '.pm2'
    }
    if (-not $env:HOMEPATH -and -not $env:HOME) {
        $env:HOME = Split-Path $env:PM2_HOME
    }
    Write-BootLog "PM2_HOME: $env:PM2_HOME (dump exists=$(Test-Path (Join-Path $env:PM2_HOME 'dump.pm2')))"
} catch {
    Write-BootLog "FAILED to resolve pm2: $($_.Exception.Message)"
    exit 1
}

if ($DelaySeconds -gt 0) {
    Start-Sleep -Seconds $DelaySeconds
}

$resolvedChatMode = Get-ChatRuntimeMode -ProjectRoot $projectRoot
if (-not $env:HUBIT_CHAT_MODE) {
    # ecosystem.all.config.js resolves chat apps by the same mode.
    $env:HUBIT_CHAT_MODE = $resolvedChatMode
}
Write-BootLog "chat mode: $resolvedChatMode"

$expectedNames = @(Get-ExpectedAppNames)
Write-BootLog "expected apps ($($expectedNames.Count)): $($expectedNames -join ', ')"

$snapshotBefore = Get-Pm2SnapshotWithRetry
if ($null -eq $snapshotBefore) {
    Write-BootLog 'PM2 state unreadable; aborting to avoid duplicate processes'
    exit 1
}

$resurrected = $false
$onlineBefore = @($snapshotBefore | Where-Object { $_.Status -eq 'online' })
if ($onlineBefore.Count -gt 0) {
    Write-BootLog "skip resurrect: $($onlineBefore.Count) process(es) already online"
} else {
    Write-BootLog 'running pm2 resurrect...'
    $result = Invoke-Pm2 -Arguments @('resurrect')
    Write-BootLog "resurrect exit=$($result.ExitCode)"
    Write-BootLog $result.Output.Trim()
    $resurrected = $true
}

$afterResurrect = Get-Pm2SnapshotWithRetry
if ($null -ne $afterResurrect -and $expectedNames.Count -gt 0) {
    $startedMissing = Start-MissingApps -ExpectedNames $expectedNames -Snapshot $afterResurrect
    if ($startedMissing -gt 0) {
        $resurrected = $true
    }
}

if ($resurrected -and $resolvedChatMode -eq 'dual' -and -not $NoChatStaging) {
    # Workers that compete for DB connections and CPU during cold start. Chat
    # nodes and the main backend start first; the ARR farm needs chat ready
    # as early as possible to stop the 502.4 handshake storm.
    $deferredWorkers = @(
        'itinvent-scan', 'itinvent-scan-worker', 'itinvent-inventory',
        'itinvent-mail-notification-worker', 'itinvent-my-files-worker',
        'itinvent-ai-chat-worker', 'itinvent-bot'
    )
    $presentNames = @((Get-Pm2SnapshotWithRetry) | ForEach-Object { $_.Name })
    foreach ($name in ($deferredWorkers | Where-Object { $presentNames -contains $_ })) {
        Write-BootLog "staging: holding $name until chat nodes are ready"
        Invoke-Pm2 -Arguments @('stop', $name) | Out-Null
    }

    $chatPorts = @(8002, 8004)
    $deadline = (Get-Date).AddSeconds($ChatReadyTimeoutSec)
    $chatReady = $false
    while ((Get-Date) -lt $deadline -and -not $chatReady) {
        $chatReady = $true
        foreach ($port in $chatPorts) {
            try {
                $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health/ready" -TimeoutSec 5
                if ($resp.status -ne 'ok') { $chatReady = $false }
            } catch {
                $chatReady = $false
            }
        }
        if (-not $chatReady) { Start-Sleep -Seconds 5 }
    }
    Write-BootLog "chat nodes ready=$chatReady after staged wait (timeout=${ChatReadyTimeoutSec}s)"

    foreach ($name in ($deferredWorkers | Where-Object { $presentNames -contains $_ })) {
        Write-BootLog "staging: starting $name"
        Invoke-Pm2 -Arguments @('restart', $name) | Out-Null
    }
}

if ($SettleSeconds -gt 0) {
    Start-Sleep -Seconds $SettleSeconds
}

$snapshot = Get-Pm2SnapshotWithRetry
if ($null -eq $snapshot) {
    Write-BootLog 'final PM2 state unreadable'
    exit 1
}
foreach ($row in ($snapshot | Sort-Object Name)) {
    Write-BootLog ("{0,-46} {1,-10} pid={2} restarts={3}" -f $row.Name, $row.Status, $row.PID, $row.Restarts)
}
$onlineNames = @($snapshot | Where-Object { $_.Status -eq 'online' } | ForEach-Object { $_.Name })
$notOnline = @($expectedNames | Where-Object { $onlineNames -notcontains $_ })
Write-BootLog "done: $($onlineNames.Count)/$($snapshot.Count) online"

if ($onlineNames.Count -eq 0 -or $notOnline.Count -gt 0) {
    # Non-zero exit makes Task Scheduler rerun this idempotent script.
    Write-BootLog "NOT READY: expected apps not online: $($notOnline -join ', ')"
    exit 1
}

# Keep dump.pm2 in sync with ecosystem.all so the next boot restores the same set.
$saveResult = Invoke-Pm2 -Arguments @('save')
Write-BootLog "pm2 save exit=$($saveResult.ExitCode)"
exit 0
