param(
    [string]$TaskName = "HUB-IT MAX Probe",
    [string]$ExecutablePath = "C:\Program Files\HUB-IT\Agent\ITInventMaxProbe.exe",
    [string]$EnvFilePath = "",
    [switch]$StartAfterRegister
)

$ErrorActionPreference = "Stop"

$defaultRuntimeRoot = Join-Path ([Environment]::GetFolderPath("CommonApplicationData")) "HUB-IT\Agent"
$probeRuntime = Join-Path ([Environment]::GetFolderPath("CommonApplicationData")) "HUB-IT\MaxProbe"
$devLauncher = "C:\Project\Image_scan\agent\scripts\run_max_probe_dev.cmd"

if (-not (Test-Path -Path $ExecutablePath)) {
    if (Test-Path -Path $devLauncher) {
        Write-Warning "Executable not found: $ExecutablePath - falling back to Python launcher $devLauncher"
        $ExecutablePath = $devLauncher
    } else {
        throw "Executable not found: $ExecutablePath"
    }
}

$workDir = if ($ExecutablePath -like "*.cmd") {
    "C:\Project\Image_scan"
} else {
    Split-Path -Path $ExecutablePath -Parent
}
$envPath = if ($EnvFilePath) { $EnvFilePath } else { Join-Path $defaultRuntimeRoot ".env" }

New-Item -ItemType Directory -Force -Path $probeRuntime | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $probeRuntime "Logs") | Out-Null

# Prefer interactive user for UIA; fall back to Users group AtLogOn.
$interactiveUser = $null
try {
    $explorer = Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" | Select-Object -First 1
    if ($null -ne $explorer) {
        $owner = Invoke-CimMethod -InputObject $explorer -MethodName GetOwner
        if ($owner -and $owner.User) {
            if ($owner.Domain) {
                $interactiveUser = "$($owner.Domain)\$($owner.User)"
            } else {
                $interactiveUser = [string]$owner.User
            }
        }
    }
} catch {
    $interactiveUser = $null
}

# Least-privilege runtime ACL (audit H-7): the probe task user writes
# state/chats/media here; SYSTEM (agent service) and Administrators keep full
# control. Other local users must not read intercepted data or plant files, so
# BUILTIN\Users gets nothing. The tree is sanitized for upgrades: explicit
# Users grants are removed, inherited ACEs are dropped at the root and the
# hardened ACL is reset onto all existing children.
try {
    $taskUserSid = $null
    if ($interactiveUser) {
        try {
            $taskUserSid = (New-Object System.Security.Principal.NTAccount($interactiveUser)).Translate(
                [System.Security.Principal.SecurityIdentifier]
            ).Value
        } catch {
            Write-Warning "Could not resolve SID for '$interactiveUser': $($_.Exception.Message)"
        }
    }
    & icacls.exe $probeRuntime /remove:g "*S-1-5-32-545" /T /C /Q | Out-Null
    & icacls.exe $probeRuntime /grant "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" /C /Q | Out-Null
    if ($taskUserSid) {
        & icacls.exe $probeRuntime /grant "*${taskUserSid}:(OI)(CI)M" /C /Q | Out-Null
    } else {
        Write-Warning "No interactive user resolved; MaxProbe runtime is writable only by SYSTEM/Administrators. Re-run this installer from the target user session so the probe task account is granted Modify."
    }
    & icacls.exe $probeRuntime /inheritance:r /C /Q | Out-Null
    Get-ChildItem -LiteralPath $probeRuntime -Force | ForEach-Object {
        & icacls.exe $_.FullName /reset /T /C /Q | Out-Null
    }
    Write-Host "[OK] MaxProbe runtime ACL hardened: SYSTEM/Administrators full, task user modify, no BUILTIN\Users access."
} catch {
    Write-Warning "Failed to harden ACL on MaxProbe runtime: $($_.Exception.Message)"
}

$action = New-ScheduledTaskAction -Execute $ExecutablePath -WorkingDirectory $workDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew

if ($interactiveUser) {
    $principal = New-ScheduledTaskPrincipal -UserId $interactiveUser -LogonType Interactive -RunLevel Highest
    Write-Host "[OK] MAX probe task will run as $interactiveUser (AtLogOn)"
} else {
    # Register for all users via AtLogOn without explicit user — Task Scheduler expands at logon.
    $principal = New-ScheduledTaskPrincipal -GroupId "Users" -RunLevel Highest
    Write-Host "[WARN] No interactive user detected; registering probe for Users group AtLogOn"
}

$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null

if ($StartAfterRegister -and $interactiveUser) {
    try {
        Start-ScheduledTask -TaskName $TaskName | Out-Null
        Write-Host "[OK] MAX probe task started."
    } catch {
        Write-Warning "MAX probe task registered, but start failed: $($_.Exception.Message)"
    }
}

Write-Host "Scheduled task '$TaskName' registered. Output: $probeRuntime Env: $envPath"
