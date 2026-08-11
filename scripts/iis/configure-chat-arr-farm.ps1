param(
    [ValidateSet('Validate', 'Enable', 'Rollback')]
    [string]$Mode = 'Validate',
    [ValidatePattern('^[A-Za-z0-9_.-]+$')]
    [string]$FarmName = 'itinvent-chat',
    [ValidatePattern('^[A-Za-z0-9_.-]*$')]
    [string]$BackupName = '',
    [int]$ReadyTimeoutSec = 60
)

$ErrorActionPreference = 'Stop'

$appcmd = Join-Path $env:WinDir 'System32\inetsrv\appcmd.exe'
$iisBackupRoot = Join-Path $env:WinDir 'System32\inetsrv\backup'
$primaryReadyUrl = 'http://127.0.0.1:8002/health/ready'
$secondaryReadyUrl = 'http://localhost:8004/health/ready'
$farmHealthUrl = "http://$FarmName/health/ready"

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
            $lastError = 'payload does not confirm postgres/available/subscriber_ready'
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Seconds 2
    }

    throw "Chat readiness failed at $Url after ${TimeoutSec}s: $lastError"
}

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this script from an elevated PowerShell session.'
    }
}

function Invoke-AppCmd {
    param([string[]]$Arguments)

    $output = @(& $appcmd @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "appcmd failed (exit $LASTEXITCODE): $($Arguments -join ' ')`n$($output -join "`n")"
    }
    return $output
}

function Assert-IisPrerequisites {
    if (-not (Test-Path -LiteralPath $appcmd)) {
        throw 'appcmd.exe not found. Install IIS Management Scripts and Tools.'
    }

    $schemaRoot = Join-Path $env:WinDir 'System32\inetsrv\config\schema'
    if (-not (Test-Path -LiteralPath (Join-Path $schemaRoot 'arr_schema.xml')) -or
        -not (Test-Path -LiteralPath (Join-Path $schemaRoot 'webfarm.xml'))) {
        throw 'IIS ARR/Web Farm schema is missing. Install Application Request Routing first.'
    }

    $getWindowsFeature = Get-Command 'Get-WindowsFeature' -ErrorAction SilentlyContinue
    if ($getWindowsFeature) {
        $webSocketFeature = Get-WindowsFeature -Name 'Web-WebSockets'
        if (-not $webSocketFeature.Installed) {
            throw 'IIS WebSocket Protocol is not installed (Web-WebSockets).'
        }
    }

    [void](Invoke-AppCmd -Arguments @('list', 'config', '-section:webFarms'))
}

function Get-FarmConfigText {
    return ((Invoke-AppCmd -Arguments @('list', 'config', '-section:webFarms')) -join "`n")
}

function Add-IisBackup {
    param([string]$Name)

    [void](Invoke-AppCmd -Arguments @('add', 'backup', $Name))
    $backupPath = Join-Path $iisBackupRoot $Name
    if (-not (Test-Path -LiteralPath $backupPath)) {
        throw "IIS reported success, but backup was not found at $backupPath"
    }
    Write-Host "IIS applicationHost backup created: $Name" -ForegroundColor Green
}

function Restore-IisBackup {
    param([string]$Name)

    if (-not $Name) {
        throw 'Rollback requires -BackupName from a previous Enable run.'
    }
    $backupPath = Join-Path $iisBackupRoot $Name
    if (-not (Test-Path -LiteralPath $backupPath)) {
        throw "IIS backup not found: $backupPath"
    }
    [void](Invoke-AppCmd -Arguments @('restore', 'backup', $Name))
    Write-Host "IIS applicationHost configuration restored from $Name." -ForegroundColor Green
}

function Set-ChatArrFarm {
    param([string]$Name)

    $existingConfig = Get-FarmConfigText
    if ($existingConfig -match ('<webFarm\s+name="{0}"' -f [regex]::Escape($Name))) {
        [void](Invoke-AppCmd -Arguments @(
            'set', 'config', '-section:webFarms', "/-[name='$Name']", '/commit:apphost'
        ))
    }

    [void](Invoke-AppCmd -Arguments @(
        'set', 'config', '-section:webFarms', "/+[name='$Name']", '/commit:apphost'
    ))

    [void](Invoke-AppCmd -Arguments @(
        'set', 'config', '-section:webFarms',
        "/+[name='$Name'].[address='127.0.0.1']", '/commit:apphost'
    ))
    [void](Invoke-AppCmd -Arguments @(
        'set', 'config', '-section:webFarms',
        "/[name='$Name'].[address='127.0.0.1'].applicationRequestRouting.httpPort:8002",
        "/[name='$Name'].[address='127.0.0.1'].applicationRequestRouting.weight:100",
        '/commit:apphost'
    ))

    [void](Invoke-AppCmd -Arguments @(
        'set', 'config', '-section:webFarms',
        "/+[name='$Name'].[address='localhost']", '/commit:apphost'
    ))
    [void](Invoke-AppCmd -Arguments @(
        'set', 'config', '-section:webFarms',
        "/[name='$Name'].[address='localhost'].applicationRequestRouting.httpPort:8004",
        "/[name='$Name'].[address='localhost'].applicationRequestRouting.weight:100",
        '/commit:apphost'
    ))

    [void](Invoke-AppCmd -Arguments @(
        'set', 'config', '-section:webFarms',
        "/[name='$Name'].applicationRequestRouting.loadBalancing.algorithm:WeightedRoundRobin",
        "/[name='$Name'].applicationRequestRouting.affinity.useCookie:False",
        "/[name='$Name'].applicationRequestRouting.affinity.useHostName:False",
        "/[name='$Name'].applicationRequestRouting.affinity.useExternalCache:False",
        '/commit:apphost'
    ))

    # HTTP/1.1 keep-alive, no response/cache buffering, and a long proxy timeout
    # preserve WebSocket upgrades and active Chat connections.
    [void](Invoke-AppCmd -Arguments @(
        'set', 'config', '-section:webFarms',
        "/[name='$Name'].applicationRequestRouting.protocol.httpVersion:Http11",
        "/[name='$Name'].applicationRequestRouting.protocol.keepAlive:True",
        "/[name='$Name'].applicationRequestRouting.protocol.timeout:01:00:00",
        "/[name='$Name'].applicationRequestRouting.protocol.connectTimeout:00:00:05",
        "/[name='$Name'].applicationRequestRouting.protocol.bufferChunkedResponses:False",
        "/[name='$Name'].applicationRequestRouting.protocol.cache.enabled:False",
        '/commit:apphost'
    ))

    # Status 503 from fail-closed Chat readiness immediately removes a node
    # from rotation; no body match is needed.
    [void](Invoke-AppCmd -Arguments @(
        'set', 'config', '-section:webFarms',
        "/[name='$Name'].applicationRequestRouting.healthCheck.url:$farmHealthUrl",
        "/[name='$Name'].applicationRequestRouting.healthCheck.statusCodeMatch:200",
        "/[name='$Name'].applicationRequestRouting.healthCheck.interval:00:00:05",
        "/[name='$Name'].applicationRequestRouting.healthCheck.timeout:00:00:03",
        "/[name='$Name'].applicationRequestRouting.healthCheck.connectTimeout:00:00:02",
        "/[name='$Name'].applicationRequestRouting.healthCheck.retries:2",
        "/[name='$Name'].applicationRequestRouting.healthCheck.fastFailure:True",
        '/commit:apphost'
    ))

    # ARR proxy stays server-level. This script intentionally does not touch
    # the repository or deployed web.config rewrite rules.
    [void](Invoke-AppCmd -Arguments @(
        'set', 'config', '-section:system.webServer/proxy',
        '/enabled:True', '/preserveHostHeader:True',
        '/reverseRewriteHostInResponseHeaders:False', '/commit:apphost'
    ))
}

if ($Mode -eq 'Rollback') {
    Assert-Administrator
    if (-not (Test-Path -LiteralPath $appcmd)) {
        throw 'appcmd.exe not found.'
    }
    Restore-IisBackup -Name $BackupName
    exit 0
}

# Readiness is deliberately checked before IIS privilege/schema validation and
# before any backup or mutation. Both nodes must already be fail-closed ready.
Wait-PostgresChatReady -Url $primaryReadyUrl -TimeoutSec $ReadyTimeoutSec
Wait-PostgresChatReady -Url $secondaryReadyUrl -TimeoutSec $ReadyTimeoutSec
Assert-Administrator
Assert-IisPrerequisites

if ($Mode -eq 'Validate') {
    Write-Host 'Validation passed. IIS applicationHost.config was not changed.' -ForegroundColor Green
    exit 0
}

$createdBackupName = if ($BackupName) {
    $BackupName
} else {
    'hubit-chat-arr-{0}' -f (Get-Date -Format 'yyyyMMdd-HHmmss')
}

Add-IisBackup -Name $createdBackupName
try {
    Set-ChatArrFarm -Name $FarmName
    $configured = Get-FarmConfigText
    foreach ($requiredText in @($FarmName, '127.0.0.1', 'localhost', 'WeightedRoundRobin', $farmHealthUrl)) {
        if ($configured -notmatch [regex]::Escape($requiredText)) {
            throw "ARR farm post-check is missing: $requiredText"
        }
    }
    Write-Host "ARR farm '$FarmName' configured. Backup: $createdBackupName" -ForegroundColor Green
    Write-Host "Rollback command: powershell -File scripts\iis\configure-chat-arr-farm.ps1 -Mode Rollback -BackupName $createdBackupName" -ForegroundColor Yellow
} catch {
    $failure = $_
    Write-Warning "ARR configuration failed; restoring applicationHost.config backup $createdBackupName."
    Restore-IisBackup -Name $createdBackupName
    throw $failure
}
