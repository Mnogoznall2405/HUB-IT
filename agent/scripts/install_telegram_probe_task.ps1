param(
    [string]$TaskName = "HUB-IT Telegram Probe",
    [string]$ExecutablePath = "C:\Program Files\HUB-IT\Agent\ITInventTelegramProbe.exe",
    [string]$EnvFilePath = "",
    [switch]$StartAfterRegister
)

$ErrorActionPreference = "Stop"

$defaultRuntimeRoot = Join-Path ([Environment]::GetFolderPath("CommonApplicationData")) "HUB-IT\Agent"
$probeRuntime = Join-Path ([Environment]::GetFolderPath("CommonApplicationData")) "HUB-IT\TelegramProbe"

if (-not (Test-Path -Path $ExecutablePath)) {
    throw "Executable not found: $ExecutablePath"
}

$workDir = Split-Path -Path $ExecutablePath -Parent
$envPath = if ($EnvFilePath) { $EnvFilePath } else { Join-Path $defaultRuntimeRoot ".env" }

New-Item -ItemType Directory -Force -Path $probeRuntime | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $probeRuntime "Logs") | Out-Null

# Interactive user must write state/chats/media under ProgramData.
try {
    $acl = Get-Acl -LiteralPath $probeRuntime
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        "Users", "Modify", "ContainerInherit,ObjectInherit", "None", "Allow"
    )
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $probeRuntime -AclObject $acl
} catch {
    Write-Warning "Failed to grant Users modify on TelegramProbe runtime: $($_.Exception.Message)"
}

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
    Write-Host "[OK] Telegram probe task will run as $interactiveUser (AtLogOn)"
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
        Write-Host "[OK] Telegram probe task started."
    } catch {
        Write-Warning "Telegram probe task registered, but start failed: $($_.Exception.Message)"
    }
}

Write-Host "Scheduled task '$TaskName' registered. Output: $probeRuntime Env: $envPath"
