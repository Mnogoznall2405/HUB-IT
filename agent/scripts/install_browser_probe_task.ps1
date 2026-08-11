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

# Grant BUILTIN\Users modify via SID (localized "Users" name breaks icacls on RU Server).
try {
    & icacls.exe $probeRuntime /grant "*S-1-5-32-545:(OI)(CI)M" /T /C /Q | Out-Null
} catch {
    Write-Warning "icacls grant failed: $($_.Exception.Message)"
}

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
    Write-Host "[OK] Browser probe task will run as $interactiveUser (AtLogOn)"
} else {
    $principal = New-ScheduledTaskPrincipal -GroupId "Users" -RunLevel Highest
    Write-Host "[WARN] No interactive user detected; registering probe for Users group AtLogOn"
}

$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null

if ($StartAfterRegister -and $interactiveUser) {
    try {
        Start-ScheduledTask -TaskName $TaskName | Out-Null
        Write-Host "[OK] Browser probe task started."
    } catch {
        Write-Warning "Browser probe task registered, but start failed: $($_.Exception.Message)"
    }
}

Write-Host "Scheduled task '$TaskName' registered. Output: $probeRuntime Env: $envPath"
