param(
    [ValidateSet('Validate', 'EnableDual', 'RollbackSingle')]
    [string]$Mode = 'Validate',
    [int]$ReadyTimeoutSec = 75
)

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$envPath = Join-Path $projectRoot '.env'
$chatScaleConfig = Join-Path $projectRoot 'scripts\pm2\ecosystem.chat.scale.config.js'
$backendConfig = Join-Path $projectRoot 'scripts\pm2\ecosystem.backend.config.js'

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

function Assert-PostgresConfigured {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw ".env not found at $Path"
    }

    $configured = Get-Content -LiteralPath $Path | Where-Object {
        $_ -match '^\s*(CHAT_DATABASE_URL|APP_DATABASE_URL)\s*=\s*\S.+'
    } | Select-Object -First 1

    if (-not $configured) {
        throw 'CHAT_DATABASE_URL or APP_DATABASE_URL must be configured before PostgreSQL Chat scale-out.'
    }
}

function Set-OrAppendEnvValue {
    param(
        [string[]]$Lines,
        [string]$Name,
        [string]$Value
    )

    $pattern = '^\s*{0}\s*=' -f [regex]::Escape($Name)
    $updated = $false
    $result = foreach ($line in $Lines) {
        if ($line -match $pattern) {
            $updated = $true
            '{0}={1}' -f $Name, $Value
        } else {
            $line
        }
    }
    if (-not $updated) {
        $result += ('{0}={1}' -f $Name, $Value)
    }
    return ,$result
}

function Update-RealtimeEnvConfig {
    param(
        [string]$Path,
        [string]$Transport,
        [bool]$Required
    )

    $lines = Get-Content -LiteralPath $Path
    $lines = Set-OrAppendEnvValue -Lines $lines -Name 'CHAT_REALTIME_TRANSPORT' -Value $Transport
    $lines = Set-OrAppendEnvValue -Lines $lines -Name 'CHAT_REALTIME_REQUIRED' -Value $(if ($Required) { '1' } else { '0' })
    # A stale legacy flag must not make the Redis-free PostgreSQL mode depend on Redis.
    $lines = Set-OrAppendEnvValue -Lines $lines -Name 'CHAT_REDIS_REQUIRED' -Value '0'

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($Path, [string[]]$lines, $utf8NoBom)
}

function Invoke-Pm2StartConfig {
    param(
        [string]$Pm2Command,
        [string]$Config,
        [string]$Only = ''
    )

    if ($Only) {
        & $Pm2Command start $Config --only $Only --update-env | Out-Host
    } else {
        & $Pm2Command start $Config --update-env | Out-Host
    }
    if ($LASTEXITCODE -ne 0) {
        throw "PM2 failed to start $Config $Only (exit $LASTEXITCODE)."
    }
}

function Remove-Pm2ProcessIfPresent {
    param(
        [string]$Pm2Command,
        [string]$Name
    )

    $pidOutput = & $Pm2Command pid $Name 2>$null
    $processIds = @($pidOutput) |
        ForEach-Object { "$_".Trim() } |
        Where-Object { $_ -match '^\d+$' -and $_ -ne '0' }
    if ($processIds.Count -eq 0) {
        return
    }

    & $Pm2Command delete $Name | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "PM2 failed to delete $Name (exit $LASTEXITCODE)."
    }
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

function Start-SingleChat {
    param([string]$Pm2Command)

    Remove-Pm2ProcessIfPresent -Pm2Command $Pm2Command -Name 'itinvent-chat-a'
    Remove-Pm2ProcessIfPresent -Pm2Command $Pm2Command -Name 'itinvent-chat-b'
    Invoke-Pm2StartConfig -Pm2Command $Pm2Command -Config $backendConfig -Only 'itinvent-chat'
    Invoke-Pm2StartConfig -Pm2Command $Pm2Command -Config $backendConfig -Only 'itinvent-preview-worker'
    Invoke-Pm2StartConfig -Pm2Command $Pm2Command -Config $backendConfig -Only 'itinvent-chat-push-worker'
}

Assert-PostgresConfigured -Path $envPath
if (-not (Test-Path -LiteralPath $chatScaleConfig)) {
    throw "Chat scale config not found at $chatScaleConfig"
}
if (-not (Test-Path -LiteralPath $backendConfig)) {
    throw "Backend config not found at $backendConfig"
}

$pm2Cmd = Resolve-Pm2Command

if ($Mode -eq 'Validate') {
    Write-Host 'Validation passed. No .env or PM2 state was changed.' -ForegroundColor Green
    Write-Host 'Use -Mode EnableDual only after IIS is configured for ports 8002 and 8004.' -ForegroundColor Yellow
    exit 0
}

if ($Mode -eq 'RollbackSingle') {
    Update-RealtimeEnvConfig -Path $envPath -Transport 'local' -Required $false
    Start-SingleChat -Pm2Command $pm2Cmd
    Write-Host 'Chat rolled back to the single node on port 8002.' -ForegroundColor Green
    exit 0
}

$originalEnvBytes = [System.IO.File]::ReadAllBytes($envPath)
try {
    Update-RealtimeEnvConfig -Path $envPath -Transport 'postgres' -Required $true

    # Keep the main API on 8001 and replace only the single Chat process.
    Remove-Pm2ProcessIfPresent -Pm2Command $pm2Cmd -Name 'itinvent-chat'
    # Remove the obsolete alias used by an earlier scale config.  Leaving it
    # alive starts a second preview worker and wastes scarce PostgreSQL slots.
    Remove-Pm2ProcessIfPresent -Pm2Command $pm2Cmd -Name 'itinvent-chat-preview-worker'
    Invoke-Pm2StartConfig -Pm2Command $pm2Cmd -Config $chatScaleConfig

    Wait-PostgresChatReady -Url 'http://127.0.0.1:8002/health/ready' -TimeoutSec $ReadyTimeoutSec
    Wait-PostgresChatReady -Url 'http://127.0.0.1:8004/health/ready' -TimeoutSec $ReadyTimeoutSec
    Write-Host 'Both PostgreSQL-backed Chat nodes are ready. IIS balancing is still a separate operator step.' -ForegroundColor Green
} catch {
    $failure = $_
    Write-Warning "Dual-node activation failed; restoring the previous .env and single Chat node. $($failure.Exception.Message)"
    Remove-Pm2ProcessIfPresent -Pm2Command $pm2Cmd -Name 'itinvent-chat-a'
    Remove-Pm2ProcessIfPresent -Pm2Command $pm2Cmd -Name 'itinvent-chat-b'
    [System.IO.File]::WriteAllBytes($envPath, $originalEnvBytes)
    Start-SingleChat -Pm2Command $pm2Cmd
    throw $failure
}
