<#
.SYNOPSIS
  Export Exchange mailbox sizes and quota limits to CSV/JSON.

.DESCRIPTION
  Uses Exchange Management Shell (local or remote PSSession) to list mailboxes
  with used size, quota limits, and remaining space.

  Credentials are never stored in the script. Provide them via:
  - -Credential
  - env vars EXCHANGE_QUOTA_USERNAME + EXCHANGE_QUOTA_PASSWORD
  - the same keys in project .env (local only, do not commit)
  - interactive Get-Credential prompt

.EXAMPLE
  # From your PC: credentials in .env, FQDN in EXCHANGE_QUOTA_SERVER
  powershell -ExecutionPolicy Bypass -File scripts\export_exchange_mailbox_quotas.ps1 -UseSsl -ResultSize 20

.EXAMPLE
  # From your PC by IP (adds host to WinRM TrustedHosts for this run)
  powershell -ExecutionPolicy Bypass -File scripts\export_exchange_mailbox_quotas.ps1 `
    -ExchangeServer 10.103.0.50 -UseSsl -TrustServer -ResultSize 20

.EXAMPLE
  # Interactive credential prompt on your PC
  powershell -ExecutionPolicy Bypass -File scripts\export_exchange_mailbox_quotas.ps1 `
    -ExchangeServer mail.zsgp.corp -UseSsl

.NOTES
  Remote from workstation (recommended):
    1. Set in .env: EXCHANGE_QUOTA_USERNAME, EXCHANGE_QUOTA_PASSWORD
    2. Prefer FQDN: EXCHANGE_QUOTA_SERVER=tmn-srv-exch-01.zsgp.corp (not raw IP)
    3. Run with -UseSsl; for IP also pass -TrustServer
  -LocalSession is only for running ON the Exchange server (EMS).
#>
[CmdletBinding()]
param(
    [string]$ExchangeServer = '',
    [string]$OutputPath = '',
    [ValidateRange(1, [int]::MaxValue)]
    [int]$ResultSize = 0,
    [switch]$UseSsl,
    [switch]$TrustServer,
    [switch]$LocalSession,
    [pscredential]$Credential,
    [switch]$IncludeArchive,
    [switch]$Json
)

$ErrorActionPreference = 'Stop'

function Resolve-ProjectRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Read-EnvValue {
    param(
        [string]$Key,
        [string]$EnvFile
    )
    $fromProcess = [Environment]::GetEnvironmentVariable($Key)
    if ($fromProcess) {
        return $fromProcess.Trim()
    }
    if (-not (Test-Path -LiteralPath $EnvFile)) {
        return ''
    }
    foreach ($line in Get-Content -LiteralPath $EnvFile -Encoding UTF8) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -match '^(?<key>[A-Za-z_][A-Za-z0-9_]*)=(?<value>.*)$') {
            if ($Matches.key -eq $Key) {
                return $Matches.value.Trim().Trim('"').Trim("'")
            }
        }
    }
    return ''
}

function Resolve-ExchangeCredential {
    param(
        [pscredential]$ProvidedCredential,
        [string]$EnvFile
    )

    if ($ProvidedCredential) {
        return $ProvidedCredential
    }

    $username = Read-EnvValue -Key 'EXCHANGE_QUOTA_USERNAME' -EnvFile $EnvFile
    $password = Read-EnvValue -Key 'EXCHANGE_QUOTA_PASSWORD' -EnvFile $EnvFile
    if ($username -and $password) {
        $secure = ConvertTo-SecureString $password -AsPlainText -Force
        return [pscredential]::new($username, $secure)
    }

    Write-Host 'Enter service account credentials for Exchange remote PowerShell.'
    return Get-Credential -Message 'Exchange service account (DOMAIN\user)'
}

function Resolve-ExchangeSizeGBFromRemote {
    param($Value)
    if ($null -eq $Value) { return $null }

    try {
        if ($Value.PSObject.Properties['IsUnlimited'] -and $Value.IsUnlimited) {
            return $null
        }
    } catch {
    }

    $sizeString = $Value.ToString()
    if (-not $sizeString -or $sizeString -match '(?i)unlimited') {
        return $null
    }

    if ($sizeString -match '([\d\.]+)\s*GB') {
        return [math]::Round([double]$Matches[1], 2)
    }
    if ($sizeString -match '([\d\.]+)\s*MB') {
        $usedSizeMB = [math]::Round([double]$Matches[1], 2)
        return [math]::Round($usedSizeMB / 1024, 2)
    }
    if ($sizeString -match '([\d\.]+)\s*bytes') {
        $bytes = [double]$Matches[1]
        return [math]::Round($bytes / 1GB, 2)
    }

    try {
        $bytesValue = $Value.Value
        if ($bytesValue -is [long] -or $bytesValue -is [int]) {
            return [math]::Round($bytesValue / 1GB, 2)
        }
    } catch {
    }

    return $null
}

function Convert-ExchangeSizeGBToBytes {
    param($SizeGB)
    if ($null -eq $SizeGB) { return $null }
    return [int64][math]::Round([double]$SizeGB * 1GB)
}

function Convert-ExchangeSizeToBytes {
    param($Value)
    return Convert-ExchangeSizeGBToBytes (Resolve-ExchangeSizeGBFromRemote $Value)
}

function Format-BytesHuman {
    param([Nullable[int64]]$Bytes)
    if ($null -eq $Bytes) { return '' }
    if ($Bytes -lt 1KB) { return "$Bytes B" }
    if ($Bytes -lt 1MB) { return '{0:N2} KB' -f ($Bytes / 1KB) }
    if ($Bytes -lt 1GB) { return '{0:N2} MB' -f ($Bytes / 1MB) }
    return '{0:N2} GB' -f ($Bytes / 1GB)
}

function Test-ExchangeCmdletAvailable {
    return [bool](Get-Command Get-Mailbox -ErrorAction SilentlyContinue)
}

function Test-IsIpAddress {
    param([string]$Value)
    $parsed = $null
    return [System.Net.IPAddress]::TryParse($Value, [ref]$parsed)
}

function Add-TrustedHostForSession {
    param([Parameter(Mandatory)][string]$Server)

    $item = Get-Item WSMan:\localhost\Client\TrustedHosts
    $previous = [string]$item.Value
    $hosts = @($previous.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($hosts -notcontains $Server) {
        $hosts += $Server
        $joined = ($hosts -join ',')
        Set-Item WSMan:\localhost\Client\TrustedHosts -Value $joined -Force
        Write-Host "Added '$Server' to WinRM TrustedHosts for this user."
    }
    return $previous
}

function Restore-TrustedHosts {
    param([string]$PreviousValue)
    if ($null -eq $PreviousValue) { return }
    Set-Item WSMan:\localhost\Client\TrustedHosts -Value $PreviousValue -Force
}

function Connect-ExchangeRemoteSession {
    param(
        [Parameter(Mandatory)][string]$Server,
        [pscredential]$Cred,
        [bool]$Ssl,
        [bool]$HasCredential
    )

    $schemes = if ($Ssl) { @('https') } else { @('http', 'https') }
  # Service account from a workstation usually needs Basic + explicit credentials.
    $authMethods = if ($HasCredential) { @('Basic', 'Negotiate') } else { @('Negotiate', 'Kerberos', 'Default', 'Basic') }

    foreach ($scheme in $schemes) {
        $uri = '{0}://{1}/PowerShell/' -f $scheme, $Server
        foreach ($auth in $authMethods) {
            if ($auth -eq 'Basic' -and -not $HasCredential) {
                continue
            }
            try {
                Write-Host "Connecting to Exchange remote PowerShell: $uri (auth=$auth)"
                $sessionParams = @{
                    ConfigurationName = 'Microsoft.Exchange'
                    ConnectionUri     = $uri
                    Authentication    = $auth
                    AllowRedirection  = $true
                    ErrorAction       = 'Stop'
                }
                if ($Cred) {
                    $sessionParams.Credential = $Cred
                }
                $session = New-PSSession @sessionParams
                Import-PSSession $session -DisableNameChecking -AllowClobber | Out-Null
                Write-Host "Connected via $scheme ($auth)."
                return $session
            } catch {
                Write-Warning "Connect failed ($scheme/$auth): $($_.Exception.Message)"
            }
        }
    }

    $hint = @(
        'Remote from your PC checklist:'
        '  1) Set EXCHANGE_QUOTA_USERNAME and EXCHANGE_QUOTA_PASSWORD in .env'
        '  2) Prefer FQDN in EXCHANGE_QUOTA_SERVER (Kerberos does not like raw IP)'
        '  3) Run with -UseSsl'
        '  4) For IP address add -TrustServer'
        '  5) Service account needs Exchange read rights (View-Only Organization Management)'
    ) -join "`n"
    throw "Unable to connect to Exchange remote PowerShell on $Server.`n$hint"
}

function Get-MailboxQuotaRows {
    param(
        [int]$Limit,
        [switch]$WithArchive
    )

    $mailboxQuery = @{
        ResultSize = if ($Limit -gt 0) { $Limit } else { 'Unlimited' }
    }

    $mailboxes = @(Get-Mailbox @mailboxQuery)
    $total = $mailboxes.Count
    $index = 0
    $rows = New-Object System.Collections.Generic.List[object]

    foreach ($mb in $mailboxes) {
        $index++
        $identity = $mb.Identity
        $smtp = [string]$mb.PrimarySmtpAddress
        Write-Progress -Activity 'Reading mailbox quotas' -Status $smtp -PercentComplete (($index / [Math]::Max(1, $total)) * 100)

        $stats = $null
        try {
            $stats = Get-MailboxStatistics -Identity $identity -ErrorAction Stop
        } catch {
            Write-Warning "Mailbox statistics unavailable for $smtp : $($_.Exception.Message)"
        }

        $archiveStats = $null
        if ($WithArchive) {
            try {
                $archiveStats = Get-MailboxStatistics -Identity $identity -Archive -ErrorAction Stop
            } catch {
                # Archive may not exist for this mailbox.
            }
        }

        $usedBytes = Convert-ExchangeSizeToBytes $stats.TotalItemSize
        $deletedBytes = Convert-ExchangeSizeToBytes $stats.TotalDeletedItemSize
        $warningBytes = Convert-ExchangeSizeToBytes $mb.IssueWarningQuota
        $prohibitSendBytes = Convert-ExchangeSizeToBytes $mb.ProhibitSendQuota
        $prohibitSendReceiveBytes = Convert-ExchangeSizeToBytes $mb.ProhibitSendReceiveQuota

        $effectiveLimitBytes = $prohibitSendReceiveBytes
        if (-not $effectiveLimitBytes) {
            $effectiveLimitBytes = $prohibitSendBytes
        }

        $remainingBytes = $null
        $usagePercent = $null
        if ($effectiveLimitBytes -and $null -ne $usedBytes) {
            $remainingBytes = [Math]::Max(0, $effectiveLimitBytes - $usedBytes)
            if ($effectiveLimitBytes -gt 0) {
                $usagePercent = [Math]::Round(($usedBytes / $effectiveLimitBytes) * 100, 2)
            }
        }

        $archiveUsedBytes = Convert-ExchangeSizeToBytes $archiveStats.TotalItemSize

        $rows.Add([pscustomobject]@{
            DisplayName               = [string]$mb.DisplayName
            PrimarySmtpAddress        = $smtp
            RecipientTypeDetails    = [string]$mb.RecipientTypeDetails
            Database                  = [string]$mb.Database
            UseDatabaseQuotaDefaults  = [bool]$mb.UseDatabaseQuotaDefaults
            UsedBytes                 = $usedBytes
            UsedDisplay               = Format-BytesHuman $usedBytes
            DeletedBytes              = $deletedBytes
            DeletedDisplay            = Format-BytesHuman $deletedBytes
            WarningQuotaBytes         = $warningBytes
            WarningQuotaDisplay       = Format-BytesHuman $warningBytes
            ProhibitSendQuotaBytes    = $prohibitSendBytes
            ProhibitSendQuotaDisplay  = Format-BytesHuman $prohibitSendBytes
            ProhibitSendReceiveBytes  = $prohibitSendReceiveBytes
            ProhibitSendReceiveDisplay = Format-BytesHuman $prohibitSendReceiveBytes
            EffectiveLimitBytes       = $effectiveLimitBytes
            EffectiveLimitDisplay     = Format-BytesHuman $effectiveLimitBytes
            RemainingBytes            = $remainingBytes
            RemainingDisplay          = Format-BytesHuman $remainingBytes
            UsagePercent              = $usagePercent
            ArchiveUsedBytes          = $archiveUsedBytes
            ArchiveUsedDisplay        = Format-BytesHuman $archiveUsedBytes
            ItemCount                 = if ($stats) { $stats.ItemCount } else { $null }
            LastLogonTime             = if ($stats) { $stats.LastLogonTime } else { $null }
            LastLoggedOnUserAccount   = if ($stats) { [string]$stats.LastLoggedOnUserAccount } else { '' }
            StatisticsError           = if ($stats) { '' } else { 'statistics_unavailable' }
        }) | Out-Null
    }

    Write-Progress -Activity 'Reading mailbox quotas' -Completed
    return $rows
}

# --- main ---

$projectRoot = Resolve-ProjectRoot
$envFile = Join-Path $projectRoot '.env'

if (-not $ExchangeServer) {
    $ExchangeServer = Read-EnvValue -Key 'EXCHANGE_QUOTA_SERVER' -EnvFile $envFile
}
if (-not $ExchangeServer) {
    $ExchangeServer = Read-EnvValue -Key 'MAIL_EXCHANGE_HOST' -EnvFile $envFile
}

if (-not $OutputPath) {
    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $OutputPath = Join-Path $projectRoot ("mailbox_quotas_{0}.csv" -f $stamp)
} else {
    $OutputPath = [IO.Path]::GetFullPath($OutputPath)
}

$remoteSession = $null
$startedLocalSession = $false
$trustedHostsBackup = $null

try {
    if ($LocalSession) {
        if (-not (Test-ExchangeCmdletAvailable)) {
            throw 'Get-Mailbox is not available. -LocalSession only works on the Exchange server in EMS.'
        }
        $startedLocalSession = $true
        Write-Host 'Using local Exchange Management Shell on this machine.'
    } else {
        if (-not $ExchangeServer) {
            throw 'Exchange server is not set. Pass -ExchangeServer or set EXCHANGE_QUOTA_SERVER / MAIL_EXCHANGE_HOST in .env.'
        }

        $username = Read-EnvValue -Key 'EXCHANGE_QUOTA_USERNAME' -EnvFile $envFile
        $password = Read-EnvValue -Key 'EXCHANGE_QUOTA_PASSWORD' -EnvFile $envFile
        if (-not $Credential -and $username -and $password) {
            $secure = ConvertTo-SecureString $password -AsPlainText -Force
            $Credential = [pscredential]::new($username, $secure)
        }
        if (-not $Credential) {
            $Credential = Resolve-ExchangeCredential -ProvidedCredential $null -EnvFile $envFile
        }
        if (-not $Credential) {
            throw 'Credentials are required for remote run. Set EXCHANGE_QUOTA_USERNAME/EXCHANGE_QUOTA_PASSWORD in .env.'
        }

        if ($TrustServer.IsPresent -or (Test-IsIpAddress $ExchangeServer)) {
            if (-not $TrustServer.IsPresent) {
                Write-Host "Target looks like an IP address. Adding $ExchangeServer to TrustedHosts for this run (or pass -TrustServer explicitly)."
            }
            $trustedHostsBackup = Add-TrustedHostForSession -Server $ExchangeServer
        }

        Write-Host "Remote mode: connecting from this PC to $ExchangeServer ..."
        $remoteSession = Connect-ExchangeRemoteSession `
            -Server $ExchangeServer `
            -Cred $Credential `
            -Ssl:$UseSsl.IsPresent `
            -HasCredential:$true
    }

    $rows = @(Get-MailboxQuotaRows -Limit $ResultSize -WithArchive:$IncludeArchive.IsPresent)
    if ($rows.Count -eq 0) {
        Write-Warning 'No mailboxes returned.'
        exit 0
    }

    $sorted = $rows | Sort-Object PrimarySmtpAddress
    $parentDir = Split-Path -Parent $OutputPath
    if ($parentDir -and -not (Test-Path -LiteralPath $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }

    $sorted | Export-Csv -LiteralPath $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Host "Saved CSV: $OutputPath ($($sorted.Count) mailboxes)"

    if ($Json.IsPresent) {
        $jsonPath = [IO.Path]::ChangeExtension($OutputPath, '.json')
        $sorted | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
        Write-Host "Saved JSON: $jsonPath"
    }

    $limited = @($sorted | Where-Object { $null -ne $_.EffectiveLimitBytes -and $null -ne $_.RemainingBytes })
    $topUsed = $sorted | Sort-Object { if ($_.UsedBytes) { $_.UsedBytes } else { 0 } } -Descending | Select-Object -First 5
    $nearFull = $limited | Where-Object { $_.UsagePercent -ge 90 } | Sort-Object UsagePercent -Descending | Select-Object -First 10

    Write-Host ''
    Write-Host 'Top 5 by used size:'
    foreach ($row in $topUsed) {
        Write-Host ('  {0,-40} used={1,-12} limit={2,-12} remaining={3}' -f `
            $row.PrimarySmtpAddress, $row.UsedDisplay, $row.EffectiveLimitDisplay, $row.RemainingDisplay)
    }

    if ($nearFull.Count -gt 0) {
        Write-Host ''
        Write-Host 'Mailboxes at >= 90% of effective limit:'
        foreach ($row in $nearFull) {
            Write-Host ('  {0,-40} {1,6}%  used={2}  limit={3}' -f `
                $row.PrimarySmtpAddress, $row.UsagePercent, $row.UsedDisplay, $row.EffectiveLimitDisplay)
        }
    }
}
finally {
    if ($remoteSession) {
        Remove-PSSession $remoteSession -ErrorAction SilentlyContinue
    }
    if ($null -ne $trustedHostsBackup) {
        Restore-TrustedHosts -PreviousValue $trustedHostsBackup
    }
}
