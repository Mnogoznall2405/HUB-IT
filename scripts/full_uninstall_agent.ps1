param(
    [string]$TaskName = "IT-Invent Agent",
    [string]$OutlookTaskName = "ITInventOutlookProbe",
    [string]$InstallPath = "C:\Program Files\IT-Invent\Agent",
    [string]$RuntimeRoot = "C:\ProgramData\IT-Invent\Agent",
    [string]$LegacyProgramDataRoot = "C:\ProgramData\IT-Invent",
    [string]$LogPath = "$env:TEMP\itinvent_agent_full_uninstall.log",
    [switch]$DryRun,
    [switch]$SkipMsi,
    [switch]$ClearInstallerEnv
)

$ErrorActionPreference = "Stop"

function Write-Log {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )

    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Write-Host $line
    if ($LogPath) {
        try {
            $logDir = Split-Path -Parent $LogPath
            if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {
                New-Item -ItemType Directory -Path $logDir -Force | Out-Null
            }
            Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
        }
        catch {
            Write-Host "[WARN] Failed to write log: $($_.Exception.Message)"
        }
    }
}

function Invoke-CleanupAction {
    param(
        [string]$Description,
        [scriptblock]$Action
    )

    if ($DryRun) {
        Write-Log "DRY-RUN: $Description"
        return
    }

    try {
        & $Action
        Write-Log "OK: $Description"
    }
    catch {
        Write-Log "FAILED: $Description - $($_.Exception.Message)" "WARN"
    }
}

function Remove-PathIfExists {
    param(
        [string]$TargetPath,
        [switch]$Recurse
    )

    if (-not $TargetPath) {
        return
    }
    if (-not (Test-Path -LiteralPath $TargetPath)) {
        Write-Log "Path not found: $TargetPath"
        return
    }

    $description = "Remove path $TargetPath"
    Invoke-CleanupAction $description {
        if ($Recurse) {
            Remove-Item -LiteralPath $TargetPath -Recurse -Force -ErrorAction Stop
        } else {
            Remove-Item -LiteralPath $TargetPath -Force -ErrorAction Stop
        }
    }
}

function Stop-AgentProcesses {
    $processNames = @("ITInventAgent", "ITInventScanAgent", "ITInventOutlookProbe")
    foreach ($name in $processNames) {
        $processes = Get-Process -Name $name -ErrorAction SilentlyContinue
        if ($null -eq $processes) {
            Write-Log "Process is not running: $name"
            continue
        }
        Invoke-CleanupAction "Stop process $name" {
            $processes | Stop-Process -Force -ErrorAction Stop
            Start-Sleep -Seconds 1
        }
    }
}

function Remove-AgentScheduledTasks {
    foreach ($name in @($TaskName, $OutlookTaskName)) {
        if (-not $name) {
            continue
        }
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($null -eq $task) {
            Write-Log "Scheduled task not found: $name"
            continue
        }
        Invoke-CleanupAction "Remove scheduled task $name" {
            Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop
        }
    }
}

function Get-AgentUninstallEntries {
    $roots = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
    )
    $entries = @()

    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) {
            continue
        }
        foreach ($key in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
            try {
                $props = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop
            }
            catch {
                continue
            }

            $displayName = [string]($props.DisplayName)
            $publisher = [string]($props.Publisher)
            $installLocation = [string]($props.InstallLocation)
            $isCleanupPackage = $displayName -like "*Cleanup*"
            $isExactAgentName = $displayName -eq "IT-Invent Agent"
            $isAgentByPublisherAndPath = $publisher -eq "IT-Invent" -and $installLocation -match "\\IT-Invent\\Agent\\?$"

            if (($isExactAgentName -or $isAgentByPublisherAndPath) -and -not $isCleanupPackage) {
                $entries += [pscustomobject]@{
                    KeyPath = $key.PSPath
                    ProductCode = $key.PSChildName
                    DisplayName = $displayName
                    Publisher = $publisher
                    InstallLocation = $installLocation
                    UninstallString = [string]($props.UninstallString)
                }
            }
        }
    }

    return $entries
}

function Get-ProductCode {
    param([object]$Entry)

    if ($Entry.ProductCode -match "^\{[0-9A-Fa-f-]{36}\}$") {
        return $Entry.ProductCode
    }
    if ($Entry.UninstallString -match "(\{[0-9A-Fa-f-]{36}\})") {
        return $Matches[1]
    }
    return ""
}

function Uninstall-AgentMsiProducts {
    if ($SkipMsi) {
        Write-Log "MSI uninstall skipped because SkipMsi was set."
        return
    }

    $entries = Get-AgentUninstallEntries
    if ($entries.Count -eq 0) {
        Write-Log "No old IT-Invent Agent MSI products found."
        return
    }

    foreach ($entry in $entries) {
        $productCode = Get-ProductCode -Entry $entry
        if (-not $productCode) {
            Write-Log "No MSI product code for '$($entry.DisplayName)' at $($entry.KeyPath)" "WARN"
            continue
        }

        Invoke-CleanupAction "Uninstall MSI product $productCode ($($entry.DisplayName))" {
            $process = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/x", $productCode, "/qn", "/norestart") -Wait -PassThru -WindowStyle Hidden
            if ($process.ExitCode -notin @(0, 1605, 1614, 3010)) {
                throw "msiexec exit code $($process.ExitCode)"
            }
        }
    }
}

function Remove-StaleAgentUninstallEntries {
    foreach ($entry in Get-AgentUninstallEntries) {
        Invoke-CleanupAction "Remove stale uninstall registry key $($entry.KeyPath)" {
            Remove-Item -LiteralPath $entry.KeyPath -Recurse -Force -ErrorAction Stop
        }
    }
}

function Clear-AgentMachineEnvironment {
    if (-not $ClearInstallerEnv) {
        Write-Log "Machine environment cleanup skipped because ClearInstallerEnv was not set."
        return
    }

    $envKey = "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment"
    if (-not (Test-Path -LiteralPath $envKey)) {
        Write-Log "Machine environment registry key not found."
        return
    }

    $props = Get-ItemProperty -LiteralPath $envKey
    $names = $props.PSObject.Properties |
        Where-Object { $_.Name -like "ITINV_*" -or $_.Name -like "SCAN_AGENT_*" } |
        ForEach-Object { $_.Name }

    foreach ($name in $names) {
        Invoke-CleanupAction "Remove machine environment variable $name" {
            [Environment]::SetEnvironmentVariable($name, $null, "Machine")
            Remove-ItemProperty -LiteralPath $envKey -Name $name -ErrorAction SilentlyContinue
        }
    }
}

Write-Log "=== Starting IT-Invent Agent full uninstall cleanup ==="
Stop-AgentProcesses
Remove-AgentScheduledTasks
Uninstall-AgentMsiProducts
Stop-AgentProcesses
Remove-AgentScheduledTasks
Clear-AgentMachineEnvironment
Remove-PathIfExists -TargetPath $RuntimeRoot -Recurse
Remove-PathIfExists -TargetPath (Join-Path $LegacyProgramDataRoot ".env")
Remove-PathIfExists -TargetPath (Join-Path $LegacyProgramDataRoot "Logs") -Recurse
Remove-PathIfExists -TargetPath (Join-Path $LegacyProgramDataRoot "Spool") -Recurse
Remove-PathIfExists -TargetPath (Join-Path $LegacyProgramDataRoot "ScanAgent") -Recurse
Remove-PathIfExists -TargetPath $InstallPath -Recurse
Remove-StaleAgentUninstallEntries
Write-Log "=== IT-Invent Agent full uninstall cleanup completed ==="
