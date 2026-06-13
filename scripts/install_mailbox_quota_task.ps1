param(
    [string]$TaskName = "IT-Invent Mailbox Quota",
    [string]$ScriptPath = "",
    [int]$RepeatHours = 4,
    [string]$RuntimeRoot = "",
    [switch]$StartAfterRegister
)

$ErrorActionPreference = "Stop"

if ($RepeatHours -lt 1) {
    throw "RepeatHours must be >= 1"
}

$defaultRuntimeRoot = Join-Path ([Environment]::GetFolderPath("CommonApplicationData")) "IT-Invent\MailboxQuota"
$resolvedRuntimeRoot = if ($RuntimeRoot) { $RuntimeRoot } else { $defaultRuntimeRoot }
$resolvedScriptPath = if ($ScriptPath) {
    $ScriptPath
} else {
    Join-Path $resolvedRuntimeRoot "scripts\mail_box_sync_domain.ps1"
}

if (-not (Test-Path -LiteralPath $resolvedScriptPath)) {
    throw "Sync script not found: $resolvedScriptPath"
}

$repeatMinutes = [Math]::Max(1, $RepeatHours * 60)

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$resolvedScriptPath`"" `
    -WorkingDirectory (Split-Path -Parent $resolvedScriptPath)

# Once + Repetition is more reliable than AtStartup for "every N hours".
# Duration is required on some Windows builds or NextRunTime stays empty.
$startAt = (Get-Date).AddMinutes(2)
$trigger = New-ScheduledTaskTrigger `
    -Once `
    -At $startAt `
    -RepetitionInterval (New-TimeSpan -Minutes $repeatMinutes) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -MultipleInstances IgnoreNew

$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null

if ($StartAfterRegister) {
    try {
        Start-ScheduledTask -TaskName $TaskName | Out-Null
    } catch {
        Write-Warning "Task '$TaskName' registered, but immediate start failed: $($_.Exception.Message)"
    }
}

Write-Host "Scheduled task '$TaskName' registered (every $RepeatHours h, SYSTEM, StartWhenAvailable)."
Write-Host "First scheduled run: $($startAt.ToString('yyyy-MM-dd HH:mm:ss'))."
Write-Host "Ensure $resolvedRuntimeRoot\.env exists with Exchange and HUB credentials."
