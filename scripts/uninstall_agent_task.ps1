param(
    [string]$TaskName = "HUB-IT Agent",
    [string]$OutlookTaskName = "ITInventOutlookProbe",
    [string]$ProcessName = "ITInventAgent",
    [string]$InstallPath = "C:\Program Files\HUB-IT\Agent",
    [string]$RuntimeRoot = "C:\ProgramData\HUB-IT\Agent",
    [string]$ProgramDataRoot = "C:\ProgramData\HUB-IT",
    [string]$LegacyInstallPath = "C:\Program Files\IT-Invent\Agent",
    [string]$LegacyProgramDataRoot = "C:\ProgramData\IT-Invent",
    [switch]$SkipProcessStop,
    [switch]$SkipInstallPathRemoval,
    [switch]$ClearInstallerEnv
)

$ErrorActionPreference = "Stop"

function Remove-PathIfExists {
    param(
        [string]$TargetPath,
        [switch]$Recurse
    )

    if (-not $TargetPath) {
        return
    }

    if (-not (Test-Path -LiteralPath $TargetPath)) {
        Write-Host "[INFO] Path '$TargetPath' was not found."
        return
    }

    try {
        if ($Recurse) {
            Remove-Item -LiteralPath $TargetPath -Recurse -Force -ErrorAction Stop
        } else {
            Remove-Item -LiteralPath $TargetPath -Force -ErrorAction Stop
        }
        Write-Host "[OK] Removed '$TargetPath'."
    }
    catch {
        Write-Warning "Failed to remove '$TargetPath': $($_.Exception.Message)"
    }
}

function Remove-ProgramDataTree {
    param([string]$Root)

    if (-not $Root) {
        return
    }

    Remove-PathIfExists -TargetPath (Join-Path $Root "Agent") -Recurse
    Remove-PathIfExists -TargetPath (Join-Path $Root "ScanAgent") -Recurse
    Remove-PathIfExists -TargetPath (Join-Path $Root "AgentUpgrade") -Recurse
    Remove-PathIfExists -TargetPath (Join-Path $Root ".env")
    Remove-PathIfExists -TargetPath (Join-Path $Root "Logs") -Recurse
    Remove-PathIfExists -TargetPath (Join-Path $Root "Spool") -Recurse
}

Write-Host "=== Starting HUB-IT Agent uninstall ==="

### 1. Remove Scheduled Tasks
foreach ($name in @($TaskName, "IT-Invent Agent") | Select-Object -Unique) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($null -ne $task) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "[OK] Task '$name' removed."
    } else {
        Write-Host "[INFO] Task '$name' was not found."
    }
}

$outlookTask = Get-ScheduledTask -TaskName $OutlookTaskName -ErrorAction SilentlyContinue
if ($null -ne $outlookTask) {
    Unregister-ScheduledTask -TaskName $OutlookTaskName -Confirm:$false
    Write-Host "[OK] Task '$OutlookTaskName' removed."
} else {
    Write-Host "[INFO] Task '$OutlookTaskName' was not found."
}

### 2. Stop running processes
if ($SkipProcessStop) {
    Write-Host "[INFO] Process stop skipped because SkipProcessStop was set."
} else {
    $processNames = @($ProcessName, "ITInventScanAgent", "ITInventOutlookProbe")
    foreach ($name in $processNames) {
        $process = Get-Process -Name $name -ErrorAction SilentlyContinue
        if ($null -ne $process) {
            Stop-Process -Name $name -Force -ErrorAction SilentlyContinue
            Write-Host "[OK] Process '$name' stopped."
            Start-Sleep -Seconds 1
        } else {
            Write-Host "[INFO] Process '$name' is not running."
        }
    }
}

### 3. Clear installer-created env vars
if ($ClearInstallerEnv) {
    [Environment]::SetEnvironmentVariable("SCAN_AGENT_SCAN_ON_START", $null, "Machine")
    [Environment]::SetEnvironmentVariable("SCAN_AGENT_WATCHDOG_ENABLED", $null, "Machine")
    Write-Host "[OK] Machine-level scan env vars cleared."
}

### 4. Remove runtime data (HUB-IT + legacy IT-Invent)
if ($RuntimeRoot -and ($RuntimeRoot -ne (Join-Path $ProgramDataRoot "Agent"))) {
    Remove-PathIfExists -TargetPath $RuntimeRoot -Recurse
}
foreach ($root in @($ProgramDataRoot, $LegacyProgramDataRoot) | Select-Object -Unique) {
    Remove-ProgramDataTree -Root $root
}
foreach ($path in @($InstallPath, $LegacyInstallPath) | Select-Object -Unique) {
    Remove-PathIfExists -TargetPath (Join-Path $path ".env")
}

### 5. Remove installed files only when explicitly allowed
if ($SkipInstallPathRemoval) {
    Write-Host "[INFO] Install directory removal skipped because SkipInstallPathRemoval was set."
} else {
    foreach ($path in @($InstallPath, $LegacyInstallPath) | Select-Object -Unique) {
        if (Test-Path -LiteralPath $path) {
            Remove-PathIfExists -TargetPath $path -Recurse
        } else {
            Write-Host "[INFO] Install directory '$path' was not found."
        }
    }
}

Write-Host "=== HUB-IT Agent uninstall completed ==="
