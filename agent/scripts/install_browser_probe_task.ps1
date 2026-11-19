param(
    [string]$TaskName = "HUB-IT Browser Probe",
    [string]$ExecutablePath = "C:\Program Files\HUB-IT\Agent\ITInventBrowserProbe.exe",
    [string]$EnvFilePath = "",
    [switch]$StartAfterRegister
)

$ErrorActionPreference = "Stop"

$defaultRuntimeRoot = Join-Path ([Environment]::GetFolderPath("CommonApplicationData")) "HUB-IT\Agent"
$probeRuntime = Join-Path ([Environment]::GetFolderPath("CommonApplicationData")) "HUB-IT\BrowserProbe"
$devLauncher = "C:\Project\Image_scan\agent\scripts\run_browser_probe_dev.cmd"

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
New-Item -ItemType Directory -Force -Path (Join-Path $probeRuntime "screenshots") | Out-Null

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
# state/visits/screenshots here; SYSTEM (agent service) and Administrators
# keep full control. Other local users must not read intercepted data or plant
# files, so BUILTIN\Users gets nothing. The tree is sanitized for upgrades:
# explicit Users grants are removed, inherited ACEs are dropped at the root
# and the hardened ACL is reset onto all existing children. SIDs are used so
# localized group names cannot break icacls (RU Server).
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
        Write-Warning "No interactive user resolved; BrowserProbe runtime is writable only by SYSTEM/Administrators. Re-run this installer from the target user session so the probe task account is granted Modify."
    }
    & icacls.exe $probeRuntime /inheritance:r /C /Q | Out-Null
    Get-ChildItem -LiteralPath $probeRuntime -Force | ForEach-Object {
        & icacls.exe $_.FullName /reset /T /C /Q | Out-Null
    }
    Write-Host "[OK] BrowserProbe runtime ACL hardened: SYSTEM/Administrators full, task user modify, no BUILTIN\Users access."
} catch {
    Write-Warning "Failed to harden ACL on BrowserProbe runtime: $($_.Exception.Message)"
}

$action = New-ScheduledTaskAction -Execute $ExecutablePath -WorkingDirectory $workDir
# AtLogOn plus a periodic re-fire: if the probe was killed (MSI update, crash)
# Task Scheduler restarts it within 15 min instead of waiting for a logon.
# MultipleInstances IgnoreNew + probe.lock keep single-instance semantics.
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn
$repeatTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
$trigger = @($logonTrigger, $repeatTrigger)
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew

# Users-group principal: any interactive logon starts the probe as that user.
# A specific-user principal silently skips every other user on shared machines;
# the per-user runtime fallback keeps non-ACL'd users working anyway.
$principal = New-ScheduledTaskPrincipal -GroupId "Users" -RunLevel Highest
Write-Host "[OK] Browser probe task will run for any interactive user logon (Users group)"

$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null

if ($StartAfterRegister) {
    try {
        Start-ScheduledTask -TaskName $TaskName | Out-Null
        Write-Host "[OK] Browser probe task started."
    } catch {
        Write-Warning "Browser probe task registered, but start failed: $($_.Exception.Message)"
    }
}

Write-Host "Scheduled task '$TaskName' registered. Output: $probeRuntime Env: $envPath"
