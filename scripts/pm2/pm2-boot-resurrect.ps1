param(
    [int]$DelaySeconds = 30,
    # After resurrect, heavy non-chat workers wait for chat nodes to become
    # ready so cold-start DB/CPU contention does not delay the ARR farm.
    [int]$ChatReadyTimeoutSec = 240,
    [switch]$NoChatStaging
)

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$logFile = Join-Path $projectRoot 'scripts\pm2\_boot_resurrect.log'
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

function Get-Pm2Snapshot {
    param([string]$Pm2Cmd)
    try {
        $jlistRaw = & $Pm2Cmd jlist 2>&1 | Out-String
    } catch {
        return @()
    }
    if (-not $jlistRaw) {
        return @()
    }

    # В non-interactive сессии PM2+ баннер или сам JSON может уйти в stderr —
    # извлекаем массив по внешним границам [...] из объединённого вывода.
    $jsonStart = $jlistRaw.IndexOf('[')
    $jsonEnd = $jlistRaw.LastIndexOf(']')
    if ($jsonStart -lt 0 -or $jsonEnd -le $jsonStart) {
        $preview = ($jlistRaw -replace '\s+', ' ').Trim()
        Write-BootLog ("jlist without JSON (len={0}): {1}" -f $jlistRaw.Length, $preview.Substring(0, [Math]::Min(300, $preview.Length)))
        return @()
    }

    # ConvertFrom-Json из Windows PowerShell 5.1 не подходит: у pm2_env есть
    # ключи, различающиеся только регистром (username/USERNAME), на которых он
    # падает. JavaScriptSerializer регистрочувствителен.
    try {
        Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
        $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
        $serializer.MaxJsonLength = [int]::MaxValue
        $rows = @($serializer.DeserializeObject($jlistRaw.Substring($jsonStart, $jsonEnd - $jsonStart + 1)))
    } catch {
        Write-BootLog "jlist JSON parse failed: $($_.Exception.Message)"
        return @()
    }

    return @(
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

if (Test-Path $logFile) {
    Clear-Content -Path $logFile
}
Write-BootLog "pm2-boot-resurrect start (user=$env:USERNAME, delay=${DelaySeconds}s)"

try {
    Add-LocalNodeToPath
    $pm2Cmd = Resolve-Pm2Command
    Write-BootLog "pm2 resolved: $pm2Cmd"
} catch {
    Write-BootLog "FAILED to resolve pm2: $($_.Exception.Message)"
    exit 1
}

if ($DelaySeconds -gt 0) {
    Start-Sleep -Seconds $DelaySeconds
}

$resolvedChatMode = Get-ChatRuntimeMode -ProjectRoot $projectRoot
Write-BootLog "chat mode: $resolvedChatMode"

$resurrected = $false
$onlineBefore = @(Get-Pm2Snapshot -Pm2Cmd $pm2Cmd | Where-Object { $_.Status -eq 'online' })
if ($onlineBefore.Count -gt 0) {
    Write-BootLog "skip resurrect: $($onlineBefore.Count) process(es) already online"
} else {
    Write-BootLog 'running pm2 resurrect...'
    # PS 5.1: stderr нативной команды при 2>&1 и EAP=Stop бросает
    # NativeCommandError и убивает скрипт до восстановления процессов.
    $prevErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $resurrectOut = & $pm2Cmd resurrect 2>&1 | Out-String
        Write-BootLog "resurrect exit=$LASTEXITCODE"
        Write-BootLog $resurrectOut.Trim()
        $resurrected = $true
    } catch {
        Write-BootLog "resurrect failed: $($_.Exception.Message)"
    } finally {
        $ErrorActionPreference = $prevErrorActionPreference
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
    $presentNames = @((Get-Pm2Snapshot -Pm2Cmd $pm2Cmd) | ForEach-Object { $_.Name })
    $prevErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        foreach ($name in ($deferredWorkers | Where-Object { $presentNames -contains $_ })) {
            Write-BootLog "staging: holding $name until chat nodes are ready"
            & $pm2Cmd stop $name 2>&1 | Out-String | Out-Null
        }
    } finally {
        $ErrorActionPreference = $prevErrorActionPreference
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

    $prevErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        foreach ($name in ($deferredWorkers | Where-Object { $presentNames -contains $_ })) {
            Write-BootLog "staging: starting $name"
            & $pm2Cmd restart $name 2>&1 | Out-String | Out-Null
        }
    } finally {
        $ErrorActionPreference = $prevErrorActionPreference
    }
}

$snapshot = @(Get-Pm2Snapshot -Pm2Cmd $pm2Cmd)
foreach ($row in ($snapshot | Sort-Object Name)) {
    Write-BootLog ("{0,-46} {1,-10} pid={2} restarts={3}" -f $row.Name, $row.Status, $row.PID, $row.Restarts)
}
$onlineCount = @($snapshot | Where-Object { $_.Status -eq 'online' }).Count
Write-BootLog "done: $onlineCount/$($snapshot.Count) online"
