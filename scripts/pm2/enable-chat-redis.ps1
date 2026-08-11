param(
    [string]$RedisUrl = 'redis://127.0.0.1:6379/0',
    [string]$RedisPassword = '',
    [switch]$DualNode,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$envPath = Join-Path $projectRoot '.env'
$chatScaleConfig = Join-Path $projectRoot 'scripts\pm2\ecosystem.chat.scale.config.js'
$backendConfig = Join-Path $projectRoot 'scripts\pm2\ecosystem.backend.config.js'
$healthCheckScript = Join-Path $projectRoot 'scripts\pm2\health-check.ps1'

function Resolve-Pm2Command {
    $preferredGlobalPm2Cmd = Join-Path $env:APPDATA 'npm\pm2.cmd'
    if (Test-Path $preferredGlobalPm2Cmd) {
        return $preferredGlobalPm2Cmd
    }

    $globalPm2Cmd = (where.exe pm2.cmd 2>$null | Select-Object -First 1)
    if ($globalPm2Cmd) {
        return $globalPm2Cmd.Trim()
    }

    throw 'PM2 command not found.'
}

function Parse-RedisEndpoint {
    param([string]$Url)

    $uri = [System.Uri]$Url
    $port = if ($uri.Port -gt 0) { [int]$uri.Port } else { 6379 }
    return [pscustomobject]@{
        Host = $uri.Host
        Port = $port
    }
}

function Test-TcpEndpoint {
    param(
        [string]$EndpointHost,
        [int]$Port,
        [int]$TimeoutMs = 3000
    )

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $asyncResult = $client.BeginConnect($EndpointHost, $Port, $null, $null)
        if (-not $asyncResult.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            $client.Close()
            return $false
        }
        $client.EndConnect($asyncResult)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Set-Or-AppendEnvValue {
    param(
        [string[]]$Lines,
        [string]$Name,
        [string]$Value
    )

    $pattern = '^{0}=' -f [regex]::Escape($Name)
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

function Update-RedisEnvConfig {
    param(
        [string]$Path,
        [string]$Url,
        [string]$Password,
        [bool]$Required
    )

    if (-not (Test-Path $Path)) {
        throw ".env not found at $Path"
    }

    $lines = Get-Content -LiteralPath $Path
    $lines = Set-Or-AppendEnvValue -Lines $lines -Name 'REDIS_URL' -Value $Url
    $lines = Set-Or-AppendEnvValue -Lines $lines -Name 'REDIS_PASSWORD' -Value $Password
    $lines = Set-Or-AppendEnvValue -Lines $lines -Name 'CHAT_REDIS_CHANNEL' -Value 'itinvent:chat:events'
    $lines = Set-Or-AppendEnvValue -Lines $lines -Name 'CHAT_REDIS_REQUIRED' -Value $(if ($Required) { '1' } else { '0' })
    Set-Content -LiteralPath $Path -Value $lines -Encoding UTF8
}

$pm2Cmd = Resolve-Pm2Command
$redisEndpoint = Parse-RedisEndpoint -Url $RedisUrl

Write-Host ("Checking Redis endpoint {0}:{1}..." -f $redisEndpoint.Host, $redisEndpoint.Port) -ForegroundColor Cyan
if (-not (Test-TcpEndpoint -EndpointHost $redisEndpoint.Host -Port $redisEndpoint.Port)) {
    throw ("Redis is not reachable at {0}:{1}. Install/start Redis-compatible server first." -f $redisEndpoint.Host, $redisEndpoint.Port)
}

Write-Host "Redis endpoint is reachable." -ForegroundColor Green

if ($ValidateOnly) {
    Write-Host "ValidateOnly mode: .env and PM2 runtime were not changed." -ForegroundColor Yellow
    exit 0
}

Update-RedisEnvConfig -Path $envPath -Url $RedisUrl -Password $RedisPassword -Required ([bool]$DualNode)
Write-Host ".env updated with Redis settings." -ForegroundColor Green

if ($DualNode) {
    # Keep the main API on 8001. Replace only the single Chat node with two
    # Redis-gated Chat nodes on 8002/8004.
    & $pm2Cmd delete itinvent-chat 2>$null
    & $pm2Cmd start $chatScaleConfig --update-env
    & powershell -File $healthCheckScript `
        -BackendUrl 'http://127.0.0.1:8001/health' `
        -ChatUrl 'http://127.0.0.1:8002/health' `
        -ChatReadyUrl 'http://127.0.0.1:8002/health/ready' `
        -BackendSecondaryUrl 'http://127.0.0.1:8004/health' `
        -BackendSecondaryReadyUrl 'http://127.0.0.1:8004/health/ready'
} else {
    & $pm2Cmd delete itinvent-chat-a 2>$null
    & $pm2Cmd delete itinvent-chat-b 2>$null
    & $pm2Cmd start $backendConfig --only itinvent-chat --update-env
    & $pm2Cmd start $backendConfig --only itinvent-preview-worker --update-env
    & powershell -File $healthCheckScript
}
