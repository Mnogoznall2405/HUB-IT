<#
.SYNOPSIS
  Collect Exchange mailbox quotas and POST JSON snapshot to HUB-IT.

.DESCRIPTION
  Reads credentials from C:\ProgramData\IT-Invent\MailboxQuota\.env
  Intended for Scheduled Task (SYSTEM) on a domain-joined collector PC.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File mail_box_sync_domain.ps1 -ResultSize 10 -WhatIf -SaveLocalJson
#>
[CmdletBinding()]
param(
    [string]$EnvFile = '',
    [string]$ExchangeServer = '',
    [string]$ApiUrl = '',
    [string]$ApiKey = '',
    [ValidateRange(0, [int]::MaxValue)]
    [int]$ResultSize = 0,
    [switch]$WhatIf,
    [switch]$SaveLocalJson,
    [switch]$SaveLocalCsv,
    [switch]$UseSsl
)

$ErrorActionPreference = 'Stop'

$defaultRuntimeRoot = Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'IT-Invent\MailboxQuota'
$resolvedEnvFile = if ($EnvFile) { $EnvFile } else { Join-Path $defaultRuntimeRoot '.env' }
$logPath = Join-Path $defaultRuntimeRoot 'sync.log'
$archiveDir = Join-Path $defaultRuntimeRoot 'archive'

function Write-SyncLog {
    param([string]$Message)
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    try {
        $parent = Split-Path -Parent $logPath
        if ($parent -and -not (Test-Path -LiteralPath $parent)) {
            New-Item -ItemType Directory -Force -Path $parent | Out-Null
        }
        Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
    } catch {
        Write-Warning "Failed to write log: $($_.Exception.Message)"
    }
    Write-Host $line
}

function Read-EnvValue {
    param(
        [string]$Key,
        [string]$Path
    )
    $fromProcess = [Environment]::GetEnvironmentVariable($Key)
    if ($fromProcess) {
        return $fromProcess.Trim()
    }
    if (-not (Test-Path -LiteralPath $Path)) {
        return ''
    }
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
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

# Сбор размеров — как в mail_box_l.ps1 (Exchange 2019 remote PS, без .ToMB()/.ToGB()).
function Get-ExchangeUsedSizeGB {
    param($Stats)
    if (-not $Stats -or -not $Stats.TotalItemSize) {
        return $null
    }

    $SizeString = $Stats.TotalItemSize.ToString()
    if ($SizeString -match '([\d\.]+)\s*GB') {
        return [math]::Round([double]$Matches[1], 2)
    }
    if ($SizeString -match '([\d\.]+)\s*MB') {
        $UsedSizeMB = [math]::Round([double]$Matches[1], 2)
        return [math]::Round($UsedSizeMB / 1024, 2)
    }
    if ($SizeString -match '([\d\.]+)\s*bytes') {
        $bytes = [double]$Matches[1]
        return [math]::Round($bytes / 1GB, 2)
    }

    try {
        $bytesValue = $Stats.TotalItemSize.Value
        if ($bytesValue -is [long] -or $bytesValue -is [int]) {
            return [math]::Round($bytesValue / 1GB, 2)
        }
    } catch {
    }

    return $null
}

function Get-ExchangeQuotaLimitGB {
    param($Mailbox)
    if ($null -eq $Mailbox.ProhibitSendReceiveQuota -or $Mailbox.ProhibitSendReceiveQuota.IsUnlimited) {
        return $null
    }

    $QuotaString = $Mailbox.ProhibitSendReceiveQuota.ToString()
    if ($QuotaString -match '([\d\.]+)\s*GB') {
        return [math]::Round([double]$Matches[1], 2)
    }
    if ($QuotaString -match '([\d\.]+)\s*MB') {
        $QuotaLimitMB = [math]::Round([double]$Matches[1], 2)
        return [math]::Round($QuotaLimitMB / 1024, 2)
    }
    if ($QuotaString -match '([\d\.]+)\s*bytes') {
        $bytes = [double]$Matches[1]
        return [math]::Round($bytes / 1GB, 2)
    }

    return $null
}

function Convert-ExchangeSizeGBToBytes {
    param($SizeGB)
    if ($null -eq $SizeGB) { return $null }
    return [int64][math]::Round([double]$SizeGB * 1GB)
}

function Connect-ExchangeRemoteSession {
    param(
        [Parameter(Mandatory)][string]$Server,
        [pscredential]$Cred
    )
    $schemes = if ($UseSsl.IsPresent) { @('https') } else { @('http', 'https') }
    $authMethods = @('Kerberos', 'Negotiate', 'Default', 'Basic')
    foreach ($scheme in $schemes) {
        $uri = '{0}://{1}/PowerShell/' -f $scheme, $Server
        foreach ($auth in $authMethods) {
            if ($auth -eq 'Basic' -and -not $Cred) { continue }
            try {
                Write-SyncLog "Connecting Exchange PS: $uri auth=$auth"
                $sessionParams = @{
                    ConfigurationName = 'Microsoft.Exchange'
                    ConnectionUri     = $uri
                    Authentication    = $auth
                    AllowRedirection  = $true
                    ErrorAction       = 'Stop'
                }
                if ($Cred) { $sessionParams.Credential = $Cred }
                $session = New-PSSession @sessionParams
                Import-PSSession $session -DisableNameChecking -AllowClobber | Out-Null
                Write-SyncLog "Connected via $scheme ($auth)"
                return $session
            } catch {
                Write-Warning "Connect failed ($scheme/$auth): $($_.Exception.Message)"
            }
        }
    }
    throw "Unable to connect to Exchange remote PowerShell on $Server"
}

function Get-MailboxQuotaPayloadRows {
    param([int]$Limit)
    if ($Limit -gt 0) {
        $mailboxes = @(Get-Mailbox -ResultSize $Limit -RecipientTypeDetails UserMailbox, SharedMailbox -ErrorAction Stop)
    } else {
        $mailboxes = @(Get-Mailbox -ResultSize Unlimited -RecipientTypeDetails UserMailbox, SharedMailbox -ErrorAction Stop)
    }

    $total = $mailboxes.Count
    $index = 0
    $rows = New-Object System.Collections.Generic.List[object]
    Write-SyncLog "Mailboxes to process: $total"

    foreach ($mb in $mailboxes) {
        $index++
        $smtp = [string]$mb.PrimarySmtpAddress
        Write-Progress -Activity 'Collecting mailbox quotas' -Status $smtp -PercentComplete (($index / [Math]::Max(1, $total)) * 100)

        try {
            $stats = Get-MailboxStatistics -Identity $mb.Identity -ErrorAction SilentlyContinue
        } catch {
            $stats = $null
            Write-Warning "Statistics unavailable for $smtp : $($_.Exception.Message)"
        }

        $usedSizeGB = Get-ExchangeUsedSizeGB $stats
        $usedBytes = Convert-ExchangeSizeGBToBytes $usedSizeGB
        $quotaLimitGB = Get-ExchangeQuotaLimitGB $mb
        $usesDefaultQuota = ($null -eq $quotaLimitGB)
        if ($usesDefaultQuota) {
            $quotaLimitGB = 5
        }
        $effectiveLimitBytes = if ($usesDefaultQuota) { $null } else { Convert-ExchangeSizeGBToBytes $quotaLimitGB }

        $freeBytes = $null
        $usagePercent = $null
        if ($null -ne $usedSizeGB -and $null -ne $quotaLimitGB -and $quotaLimitGB -gt 0) {
            $freeSizeGB = [math]::Max(0, [math]::Round($quotaLimitGB - $usedSizeGB, 2))
            $freeBytes = Convert-ExchangeSizeGBToBytes $freeSizeGB
            $usagePercent = [math]::Round(($usedSizeGB / $quotaLimitGB) * 100, 2)
        }

        $rows.Add([ordered]@{
            display_name        = [string]$mb.DisplayName
            email               = $smtp.ToLowerInvariant()
            user_principal_name = [string]$mb.UserPrincipalName
            mailbox_type        = [string]$mb.RecipientTypeDetails
            used_bytes          = $usedBytes
            quota_bytes         = $effectiveLimitBytes
            free_bytes          = $freeBytes
            used_percent        = $usagePercent
            database_name       = [string]$mb.Database
        }) | Out-Null
    }
    Write-Progress -Activity 'Collecting mailbox quotas' -Completed
    return ,$rows.ToArray()
}

$remoteSession = $null
try {
    if (-not $ExchangeServer) {
        $ExchangeServer = Read-EnvValue -Key 'EXCHANGE_QUOTA_SERVER' -Path $resolvedEnvFile
    }
    if (-not $ApiUrl) {
        $ApiUrl = Read-EnvValue -Key 'MAIL_QUOTA_IMPORT_API_URL' -Path $resolvedEnvFile
    }
    if (-not $ApiKey) {
        $ApiKey = Read-EnvValue -Key 'MAIL_QUOTA_IMPORT_API_KEY' -Path $resolvedEnvFile
    }
    if (-not $ResultSize) {
        $envLimit = Read-EnvValue -Key 'MAIL_QUOTA_SYNC_RESULT_SIZE' -Path $resolvedEnvFile
        if ($envLimit -match '^\d+$') {
            $ResultSize = [int]$envLimit
        }
    }

    if (-not $ExchangeServer) {
        throw "EXCHANGE_QUOTA_SERVER is not set in $resolvedEnvFile"
    }

    $username = Read-EnvValue -Key 'EXCHANGE_QUOTA_USERNAME' -Path $resolvedEnvFile
    $password = Read-EnvValue -Key 'EXCHANGE_QUOTA_PASSWORD' -Path $resolvedEnvFile
    if (-not $username -or -not $password) {
        throw "EXCHANGE_QUOTA_USERNAME and EXCHANGE_QUOTA_PASSWORD are required in $resolvedEnvFile"
    }

    $secure = ConvertTo-SecureString $password -AsPlainText -Force
    $credential = [pscredential]::new($username, $secure)

    $remoteSession = Connect-ExchangeRemoteSession -Server $ExchangeServer -Cred $credential
    $payloadRows = Get-MailboxQuotaPayloadRows -Limit $ResultSize
    if ($payloadRows.Count -eq 0) {
        Write-SyncLog 'No mailboxes returned.'
        exit 0
    }

    $collectedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $payload = [ordered]@{
        exchange_server = $ExchangeServer
        source_host     = $env:COMPUTERNAME
        collected_at    = $collectedAt
        rows            = @($payloadRows | Sort-Object email)
    }

    if ($SaveLocalJson.IsPresent -or $WhatIf.IsPresent) {
        if (-not (Test-Path -LiteralPath $archiveDir)) {
            New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null
        }
        $jsonPath = Join-Path $archiveDir ("payload_{0}.json" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
        $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $jsonPath -Encoding UTF8
        Write-SyncLog "Saved local JSON: $jsonPath"
    }

    if ($SaveLocalCsv.IsPresent) {
        if (-not (Test-Path -LiteralPath $archiveDir)) {
            New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null
        }
        $csvPath = Join-Path $archiveDir ("payload_{0}.csv" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
        $payloadRows | ForEach-Object {
            [pscustomobject]@{
                DisplayName = $_.display_name
                Email       = $_.email
                UsedBytes   = $_.used_bytes
                QuotaBytes  = $_.quota_bytes
                FreeBytes   = $_.free_bytes
                UsedPercent = $_.used_percent
                Database    = $_.database_name
            }
        } | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8
        Write-SyncLog "Saved local CSV: $csvPath"
    }

    if ($WhatIf.IsPresent) {
        Write-SyncLog ("WhatIf: collected {0} rows, upload skipped." -f $payloadRows.Count)
        exit 0
    }

    if (-not $ApiUrl -or -not $ApiKey) {
        throw 'MAIL_QUOTA_IMPORT_API_URL and MAIL_QUOTA_IMPORT_API_KEY are required for upload.'
    }

    $body = $payload | ConvertTo-Json -Depth 6 -Compress
    Write-SyncLog ("POST {0} rows={1}" -f $ApiUrl, $payloadRows.Count)
    try {
        $response = Invoke-RestMethod -Method Post -Uri $ApiUrl -Headers @{
            'X-API-Key'    = $ApiKey
            'Content-Type' = 'application/json; charset=utf-8'
        } -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
        Write-SyncLog ("OK snapshot_id={0} row_count={1} duplicate={2}" -f $response.snapshot_id, $response.row_count, $response.duplicate)
        exit 0
    } catch {
        $failedPath = Join-Path $archiveDir ("failed_payload_{0}.json" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
        if (-not (Test-Path -LiteralPath $archiveDir)) {
            New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null
        }
        $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $failedPath -Encoding UTF8
        Write-SyncLog "Upload failed, saved $failedPath : $($_.Exception.Message)"
        exit 1
    }
}
catch {
    Write-SyncLog "ERROR: $($_.Exception.Message)"
    exit 1
}
finally {
    if ($remoteSession) {
        Remove-PSSession $remoteSession -ErrorAction SilentlyContinue
    }
}
