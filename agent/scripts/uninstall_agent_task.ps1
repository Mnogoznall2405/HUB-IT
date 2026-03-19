param(
    [string]$TaskName = "IT-Invent Agent",
    [string]$OutlookTaskName = "ITInventOutlookProbe",
    [string]$ProcessName = "ITInventAgent",
    [string]$InstallPath = "C:\Program Files\IT-Invent\Agent",
    [string]$RuntimeRoot = "C:\ProgramData\IT-Invent\Agent",
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

Write-Host "=== Starting IT-Invent Agent uninstall ==="

### 1. Remove Scheduled Tasks
$mainTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -ne $mainTask) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "[OK] Task '$TaskName' removed."
} else {
    Write-Host "[INFO] Task '$TaskName' was not found."
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
    $processNames = @($ProcessName, "ITInventOutlookProbe")
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

### 4. Remove runtime data and legacy artifacts
Remove-PathIfExists -TargetPath $RuntimeRoot -Recurse
Remove-PathIfExists -TargetPath (Join-Path $LegacyProgramDataRoot ".env")
Remove-PathIfExists -TargetPath (Join-Path $LegacyProgramDataRoot "Logs") -Recurse
Remove-PathIfExists -TargetPath (Join-Path $LegacyProgramDataRoot "Spool") -Recurse
Remove-PathIfExists -TargetPath (Join-Path $LegacyProgramDataRoot "ScanAgent") -Recurse
Remove-PathIfExists -TargetPath (Join-Path $InstallPath ".env")

### 5. Remove installed files only when explicitly allowed
if ($SkipInstallPathRemoval) {
    Write-Host "[INFO] Install directory removal skipped because SkipInstallPathRemoval was set."
} elseif (Test-Path -LiteralPath $InstallPath) {
    Remove-PathIfExists -TargetPath $InstallPath -Recurse
} else {
    Write-Host "[INFO] Install directory '$InstallPath' was not found."
}

Write-Host "=== IT-Invent Agent uninstall completed ==="
