param(
    [switch]$SaveState,
    [ValidateSet('auto', 'single', 'dual')][string]$ChatMode = 'auto',
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
. (Join-Path $projectRoot 'scripts\pm2\chat-runtime-mode.ps1')
$resolvedChatMode = Get-ChatRuntimeMode -ProjectRoot $projectRoot -Override $ChatMode
$processNames = @('itinvent-backend') + (Get-ChatProcessNames -Mode $resolvedChatMode) + @('itinvent-preview-worker', 'itinvent-mail-notification-worker', 'itinvent-chat-push-worker', 'itinvent-ai-chat-worker', 'itinvent-my-files-worker', 'itinvent-hub-notifications-retention-worker', 'itinvent-inventory', 'itinvent-scan', 'itinvent-scan-worker', 'itinvent-bot')

if ($WhatIf) {
    Write-Host "[WhatIf] chat mode: $resolvedChatMode" -ForegroundColor Cyan
    Write-Host "[WhatIf] managed processes: $($processNames -join ', ')"
    Write-Host '[WhatIf] would run: pm2 stop <each running managed process>; clear-pm2-orphans.ps1'
    return
}

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

$pm2Cmd = Resolve-Pm2Command

function Get-Pm2Snapshot {
    try {
        $jlistRaw = & $pm2Cmd jlist 2>$null
    } catch {
        return @()
    }
    if ($LASTEXITCODE -ne 0 -or -not $jlistRaw) {
        return @()
    }

    # ConvertFrom-Json в Windows PowerShell 5.1 падает на ключах pm2_env,
    # различающихся только регистром (username/USERNAME).
    try {
        Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
        $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
        $serializer.MaxJsonLength = [int]::MaxValue
        $rows = @($serializer.DeserializeObject(($jlistRaw -join "`n")))
    } catch {
        return @()
    }

    return @(
        $rows | ForEach-Object {
            if (-not $_) { return }
            $pm2Env = $_['pm2_env']
            $monit = $_['monit']
            $memoryMb = $null
            if ($monit -and $null -ne $monit['memory']) {
                $memoryMb = '{0:N1}' -f ([double]$monit['memory'] / 1MB)
            }
            [pscustomobject]@{
                Name      = $_['name']
                Status    = if ($pm2Env) { $pm2Env['status'] } else { $null }
                PID       = $_['pid']
                MemoryMB  = $memoryMb
                Restarts  = if ($pm2Env) { $pm2Env['restart_time'] } else { $null }
            }
        }
    )
}

function Show-Pm2Snapshot {
    $snapshot = Get-Pm2Snapshot
    if (-not $snapshot -or $snapshot.Count -eq 0) {
        Write-Host 'No PM2 processes found.' -ForegroundColor Yellow
        return
    }

    $snapshot |
        Sort-Object Name |
        Format-Table Name, Status, PID, MemoryMB, Restarts -AutoSize
}

$existingProcesses = @(Get-Pm2Snapshot | ForEach-Object { $_.Name })
if (-not $existingProcesses) {
    $existingProcesses = @()
}

Write-Host 'PM2: stopping managed processes...' -ForegroundColor Cyan
foreach ($name in $processNames) {
    if ($existingProcesses -contains $name) {
        & $pm2Cmd stop $name | Out-Null
    }
}

# `pm2 stop` on Windows may leave python children holding ports/singleton locks.
$clearOrphans = Join-Path $projectRoot 'scripts\pm2\clear-pm2-orphans.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $clearOrphans

Write-Host 'PM2: current process list:' -ForegroundColor Cyan
Show-Pm2Snapshot

if ($SaveState) {
    Write-Host 'PM2: saving current state...' -ForegroundColor Cyan
    & $pm2Cmd save | Out-Host
}
