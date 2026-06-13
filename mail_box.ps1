# Exchange mailbox quota export for workgroup (non-domain) PC.
# Default server: tmn-srv-exch-01.zsgp.corp
# Run: powershell -ExecutionPolicy Bypass -File mail_box.ps1
[CmdletBinding()]
param(
    [string]$ExchangeServer = 'tmn-srv-exch-01.zsgp.corp',
    [string]$OutputFolder = 'C:\Temp\MailData',
    [int]$ResultSize = 0,
    [switch]$PreferHttps,
    [switch]$SkipDnsCheck
)

$ErrorActionPreference = 'Stop'

function Test-IsIpAddress {
    param([string]$Value)
    $parsed = $null
    return [System.Net.IPAddress]::TryParse($Value, [ref]$parsed)
}

function Add-TrustedHostForSession {
    param([Parameter(Mandatory)][string]$Server)
    $item = Get-Item WSMan:\localhost\Client\TrustedHosts
    $previous = [string]$item.Value
    $hostList = @($previous.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($hostList -notcontains $Server) {
        $hostList += $Server
        Set-Item WSMan:\localhost\Client\TrustedHosts -Value ($hostList -join ',') -Force
        Write-Host "Added to WinRM TrustedHosts: $Server" -ForegroundColor Yellow
    }
    return $previous
}

function Restore-TrustedHosts {
    param([string]$PreviousValue)
    if ($null -ne $PreviousValue) {
        Set-Item WSMan:\localhost\Client\TrustedHosts -Value $PreviousValue -Force
    }
}

function Enable-WinRmClientForExchangeBasic {
    $backup = [ordered]@{
        AllowUnencrypted = (Get-Item WSMan:\localhost\Client\AllowUnencrypted).Value
        Basic            = (Get-Item WSMan:\localhost\Client\Auth\Basic).Value
    }
    try {
        if (-not $backup.AllowUnencrypted) {
            Write-Host 'Enabling WinRM client AllowUnencrypted (HTTP Basic to Exchange)...' -ForegroundColor Yellow
            Set-Item WSMan:\localhost\Client\AllowUnencrypted -Value $true -Force
        }
        if (-not $backup.Basic) {
            Write-Host 'Enabling WinRM client Basic authentication...' -ForegroundColor Yellow
            Set-Item WSMan:\localhost\Client\Auth\Basic -Value $true -Force
        }
    } catch {
        Write-Host ''
        Write-Host 'Cannot change WinRM client settings. Run PowerShell as Administrator once:' -ForegroundColor Red
        Write-Host '  winrm set winrm/client @{AllowUnencrypted="true"}' -ForegroundColor Yellow
        Write-Host '  winrm set winrm/client/auth @{Basic="true"}' -ForegroundColor Yellow
        throw
    }
    return $backup
}

function Restore-WinRmClientForExchangeBasic {
    param($Backup)
    if (-not $Backup) { return }
    Set-Item WSMan:\localhost\Client\AllowUnencrypted -Value ([bool]$Backup.AllowUnencrypted) -Force
    Set-Item WSMan:\localhost\Client\Auth\Basic -Value ([bool]$Backup.Basic) -Force
}

function Test-ExchangeEndpointPorts {
    param([string]$Server)
    Write-Host "Port check for $Server ..." -ForegroundColor Cyan
    foreach ($port in @(80, 443)) {
        $ok = Test-NetConnection -ComputerName $Server -Port $port -WarningAction SilentlyContinue
        $color = if ($ok.TcpTestSucceeded) { 'Green' } else { 'Red' }
        Write-Host ("  TCP {0}: {1}" -f $port, $(if ($ok.TcpTestSucceeded) { 'open' } else { 'closed' })) -ForegroundColor $color
    }
}

function Get-ExchangePowerShellAuthMethods {
    param([string]$Server)
    $methods = @()
    try {
        $request = [System.Net.WebRequest]::Create("http://$Server/PowerShell/")
        $request.Method = 'HEAD'
        $request.Timeout = 15000
        try {
            $null = $request.GetResponse()
        } catch [System.Net.WebException] {
            $response = $_.Exception.Response
            if ($response) {
                $header = $response.Headers['WWW-Authenticate']
                if ($header) {
                    $methods = @($header -split '\s*,\s*')
                }
            }
        }
    } catch {
        Write-Warning "Auth probe failed: $($_.Exception.Message)"
    }
    return $methods
}

function Show-WorkgroupExchangeAuthHint {
    param([string[]]$AuthMethods)
    Write-Host ''
    Write-Host 'DIAGNOSIS: Exchange /PowerShell/ auth on HTTP:' -ForegroundColor Yellow
    if ($AuthMethods.Count -gt 0) {
        Write-Host ("  Server accepts: {0}" -f ($AuthMethods -join ', ')) -ForegroundColor Gray
    } else {
        Write-Host '  Could not read WWW-Authenticate header.' -ForegroundColor Gray
    }
    if ($AuthMethods -contains 'Kerberos' -and $AuthMethods -notcontains 'NTLM' -and $AuthMethods -notcontains 'Negotiate' -and $AuthMethods -notcontains 'Basic') {
        Write-Host ''
        Write-Host 'Workgroup PC cannot use Kerberos-only Remote PowerShell.' -ForegroundColor Red
        Write-Host 'Ask Exchange admin to enable NTLM/Basic on the PowerShell vdir, then iisreset:' -ForegroundColor Yellow
        Write-Host '  Get-PowerShellVirtualDirectory | fl Identity,WindowsAuthentication,BasicAuthentication' -ForegroundColor Cyan
        Write-Host '  Set-PowerShellVirtualDirectory -Identity "TMN-SRV-EXCH-01\PowerShell (Default Web Site)" `'
        Write-Host '    -WindowsAuthentication $true -BasicAuthentication $true' -ForegroundColor Cyan
        Write-Host '  iisreset /noforce' -ForegroundColor Cyan
        Write-Host ''
        Write-Host 'Or run this script on a domain-joined PC / directly on Exchange (EMS).' -ForegroundColor Yellow
    }
}

function Resolve-ExchangeSizeGB {
    param($Value)
    if ($null -eq $Value) { return $null }
    $text = "$Value".Trim()
    if (-not $text -or $text -match 'unlimited') { return $null }
    if ($text -match '\((\d+)\s*bytes\)') {
        return [math]::Round([int64]$Matches[1] / 1GB, 2)
    }
    if ($text -match '([\d\.,]+)\s*GB') {
        return [math]::Round([double]($Matches[1] -replace ',', '.'), 2)
    }
    if ($text -match '([\d\.,]+)\s*MB') {
        return [math]::Round([double]($Matches[1] -replace ',', '.') / 1024, 2)
    }
    return $null
}

function Connect-ExchangeSession {
    param(
        [string]$Server,
        [pscredential]$Credential,
        [bool]$HttpsFirst
    )

    $schemes = if ($HttpsFirst) { @('https', 'http') } else { @('http', 'https') }
    # Negotiate can use NTLM from workgroup when server allows it; Basic as fallback.
    $authMethods = @('Negotiate', 'Basic', 'Kerberos')
    $sessionOption = New-PSSessionOption -SkipCACheck -SkipCNCheck -MaximumRedirection 5
    $lastError = $null

    foreach ($scheme in $schemes) {
        $uri = '{0}://{1}/PowerShell/' -f $scheme, $Server
        foreach ($auth in $authMethods) {
            try {
                Write-Host "Connecting: $uri ($auth)..." -ForegroundColor Yellow
                $session = New-PSSession `
                    -ConfigurationName Microsoft.Exchange `
                    -ConnectionUri $uri `
                    -Authentication $auth `
                    -Credential $Credential `
                    -SessionOption $sessionOption `
                    -AllowRedirection `
                    -ErrorAction Stop
                Import-PSSession $session -DisableNameChecking -AllowClobber -ErrorAction Stop | Out-Null
                Write-Host "Connected: $uri ($auth)" -ForegroundColor Green
                return $session
            } catch {
                $lastError = $_
                Write-Warning "Failed ($uri / $auth): $($_.Exception.Message)"
            }
        }
    }

    throw $lastError
}

Clear-Host
Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  EXCHANGE MAILBOX QUOTA REPORT' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''

$prompt = "Exchange server [$ExchangeServer]"
$entered = Read-Host $prompt
if (-not [string]::IsNullOrWhiteSpace($entered)) {
    $ExchangeServer = $entered.Trim()
}

if ([string]::IsNullOrWhiteSpace($ExchangeServer)) {
    Write-Host 'Server name is required.' -ForegroundColor Red
    exit 1
}

if (-not $SkipDnsCheck.IsPresent -and -not (Test-IsIpAddress $ExchangeServer)) {
    Write-Host ''
    Write-Host "Checking DNS for $ExchangeServer ..." -ForegroundColor Cyan
    try {
        $dns = Resolve-DnsName -Name $ExchangeServer -ErrorAction Stop | Select-Object -First 1
        Write-Host "DNS OK -> $($dns.IPAddress)" -ForegroundColor Green
    } catch {
        Write-Host ''
        Write-Host 'Server name does not resolve on this PC.' -ForegroundColor Red
        Write-Host 'Fix options:' -ForegroundColor Yellow
        Write-Host '  1) Connect VPN to corporate network'
        Write-Host '  2) Set DNS suffix zsgp.corp on network adapter'
        Write-Host '  3) Add to hosts file as Administrator:'
        Write-Host '     C:\Windows\System32\drivers\etc\hosts'
        Write-Host '     10.103.0.50    tmn-srv-exch-01.zsgp.corp'
        Write-Host ''
        $continue = Read-Host 'Continue anyway? (y/N)'
        if ($continue -notmatch '^[yY]') { exit 1 }
    }
}

Write-Host ''
Write-Host 'Use domain account with Exchange read rights.' -ForegroundColor Yellow
Write-Host 'Login format: ZSGP\service_account' -ForegroundColor Gray
$UserCredentials = Get-Credential -Message 'Exchange service account (ZSGP\user)'
if (-not $UserCredentials) {
    Write-Host 'Cancelled.' -ForegroundColor Red
    exit 1
}

$trustedHostsBackup = $null
$winRmClientBackup = $null
$Session = $null

try {
    Test-ExchangeEndpointPorts -Server $ExchangeServer
    $authMethods = Get-ExchangePowerShellAuthMethods -Server $ExchangeServer
    Show-WorkgroupExchangeAuthHint -AuthMethods $authMethods
    Write-Host ''
    $trustedHostsBackup = Add-TrustedHostForSession -Server $ExchangeServer
    $winRmClientBackup = Enable-WinRmClientForExchangeBasic
    $Session = Connect-ExchangeSession -Server $ExchangeServer -Credential $UserCredentials -HttpsFirst:$PreferHttps.IsPresent

    if (-not (Test-Path -LiteralPath $OutputFolder)) {
        New-Item -ItemType Directory -Path $OutputFolder -Force | Out-Null
    }

    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $LocalOutputPath = Join-Path $OutputFolder "MailboxQuotaReport_$stamp.csv"
    $LocalSummaryPath = Join-Path $OutputFolder "MailboxQuotaSummary_$stamp.txt"

    Write-Host ''
    Write-Host 'Loading mailboxes...' -ForegroundColor Cyan
    $mailboxParams = @{ RecipientTypeDetails = @('UserMailbox', 'SharedMailbox') }
    if ($ResultSize -gt 0) {
        $mailboxParams.ResultSize = $ResultSize
        Write-Host "Test mode: first $ResultSize mailboxes only" -ForegroundColor Yellow
    } else {
        $mailboxParams.ResultSize = 'Unlimited'
    }
    $Mailboxes = @(Get-Mailbox @mailboxParams)
    $TotalCount = $Mailboxes.Count
    Write-Host "Found: $TotalCount" -ForegroundColor Green
    Write-Host ''

    $Results = New-Object System.Collections.Generic.List[object]
    $Current = 0
    $ErrorCount = 0

    foreach ($Mb in $Mailboxes) {
        $Current++
        $PercentComplete = [math]::Round(($Current / [Math]::Max(1, $TotalCount)) * 100, 0)
        Write-Progress -Activity 'Mailboxes' -Status "$Current / $TotalCount - $($Mb.DisplayName)" -PercentComplete $PercentComplete

        try {
            $Stats = Get-MailboxStatistics -Identity $Mb.Identity -ErrorAction Stop
        } catch {
            $Stats = $null
            $ErrorCount++
        }

        $UsedSizeGB = Resolve-ExchangeSizeGB $Stats.TotalItemSize
        $QuotaLimitGB = Resolve-ExchangeSizeGB $Mb.ProhibitSendReceiveQuota
        if (-not $QuotaLimitGB) {
            $QuotaLimitGB = Resolve-ExchangeSizeGB $Mb.ProhibitSendQuota
        }

        $FreeSpaceGB = $null
        $PercentUsed = 'N/A'
        if (($null -ne $UsedSizeGB) -and ($null -ne $QuotaLimitGB) -and ($QuotaLimitGB -gt 0)) {
            $FreeSpaceGB = [math]::Max(0, [math]::Round($QuotaLimitGB - $UsedSizeGB, 2))
            $PercentUsed = [math]::Round(($UsedSizeGB / $QuotaLimitGB) * 100, 2)
        }

        $quotaText = if ($QuotaLimitGB) { $QuotaLimitGB } else { 'unlimited' }
        $freeText = if ($null -ne $FreeSpaceGB) { $FreeSpaceGB } else { 'unlimited' }

        $Results.Add([pscustomobject]@{
            DisplayName    = $Mb.DisplayName
            UserPrincipalName = $Mb.UserPrincipalName
            Email          = $Mb.PrimarySmtpAddress
            MailboxType    = $Mb.RecipientTypeDetails
            UsedGB         = $UsedSizeGB
            QuotaGB        = $quotaText
            FreeGB         = $freeText
            UsedPercent    = $PercentUsed
            Database       = [string]$Mb.Database
        }) | Out-Null

        if ($Current % 100 -eq 0) {
            Write-Host "  ... $Current / $TotalCount" -ForegroundColor Gray
        }
    }

    Write-Progress -Activity 'Mailboxes' -Completed

    $Results | Export-Csv -Path $LocalOutputPath -NoTypeInformation -Encoding UTF8 -Delimiter ';'

    $ValidResults = @($Results | Where-Object { $_.UsedGB -is [double] })
    $OverQuota = @($Results | Where-Object { $_.UsedPercent -ne 'N/A' -and [double]$_.UsedPercent -gt 100 }).Count
    $WarningLevel = @($Results | Where-Object { $_.UsedPercent -ne 'N/A' -and [double]$_.UsedPercent -ge 90 -and [double]$_.UsedPercent -le 100 }).Count
    $TotalUsedSpaceGB = [math]::Round(($ValidResults | Measure-Object -Property UsedGB -Sum).Sum, 2)

    @"
Server: $ExchangeServer
Date: $(Get-Date -Format 'dd.MM.yyyy HH:mm:ss')
Mailboxes: $TotalCount
Total used GB: $TotalUsedSpaceGB
Over quota: $OverQuota
Warning 90-100%: $WarningLevel
Stats errors: $ErrorCount
CSV: $LocalOutputPath
"@ | Set-Content -LiteralPath $LocalSummaryPath -Encoding UTF8

    Write-Host ''
    Write-Host 'DONE' -ForegroundColor Green
    Write-Host "CSV:     $LocalOutputPath" -ForegroundColor Yellow
    Write-Host "Summary: $LocalSummaryPath" -ForegroundColor Yellow
    Write-Host "Over quota: $OverQuota | Warning: $WarningLevel" -ForegroundColor $(if ($OverQuota -gt 0) { 'Red' } else { 'Gray' })

    $ValidResults | Sort-Object UsedGB -Descending | Select-Object -First 10 |
        Format-Table DisplayName, Email, UsedGB, QuotaGB, UsedPercent -AutoSize
}
catch {
    Write-Host ''
    Write-Host 'ERROR:' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ''
    Show-WorkgroupExchangeAuthHint -AuthMethods (Get-ExchangePowerShellAuthMethods -Server $ExchangeServer)
    exit 1
}
finally {
    if ($Session) {
        Remove-PSSession $Session -ErrorAction SilentlyContinue
    }
    if ($winRmClientBackup) {
        Restore-WinRmClientForExchangeBasic -Backup $winRmClientBackup
    }
    if ($null -ne $trustedHostsBackup) {
        Restore-TrustedHosts -PreviousValue $trustedHostsBackup
    }
}

Write-Host ''
Read-Host 'Press Enter to exit'
