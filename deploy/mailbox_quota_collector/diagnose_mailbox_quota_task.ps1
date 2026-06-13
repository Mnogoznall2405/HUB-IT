param(
    [string]$TaskName = "IT-Invent Mailbox Quota",
    [string]$RuntimeRoot = "",
    [int]$LogTail = 40
)

$ErrorActionPreference = "Continue"

$defaultRuntimeRoot = Join-Path ([Environment]::GetFolderPath("CommonApplicationData")) "IT-Invent\MailboxQuota"
$resolvedRuntimeRoot = if ($RuntimeRoot) { $RuntimeRoot } else { $defaultRuntimeRoot }
$envPath = Join-Path $resolvedRuntimeRoot ".env"
$scriptPath = Join-Path $resolvedRuntimeRoot "scripts\mail_box_sync_domain.ps1"
$logPath = Join-Path $resolvedRuntimeRoot "sync.log"

function Format-TaskResult {
    param([int]$Code)
    switch ($Code) {
        0 { return "0 (OK)" }
        0x41301 { return "0x41301 (running)" }
        0x41303 { return "0x41303 (not run yet)" }
        0x800710E0 { return "0x800710E0 (task disabled)" }
        default { return "0x{0:X} ({1})" -f $Code, $Code }
    }
}

Write-Host "=== Mailbox quota collector diagnostics ===" -f Cyan
Write-Host "Computer: $env:COMPUTERNAME"
Write-Host "Runtime root: $resolvedRuntimeRoot"
Write-Host ""

Write-Host "--- Files ---" -f Yellow
@(
    @{ Label = "Sync script"; Path = $scriptPath }
    @{ Label = ".env"; Path = $envPath }
    @{ Label = "sync.log"; Path = $logPath }
) | ForEach-Object {
    $exists = Test-Path -LiteralPath $_.Path
    $status = if ($exists) { "OK" } else { "MISSING" }
    Write-Host ("{0,-12} [{1}] {2}" -f $_.Label, $status, $_.Path)
}

if (Test-Path -LiteralPath $envPath) {
    $requiredKeys = @(
        "EXCHANGE_QUOTA_SERVER",
        "EXCHANGE_QUOTA_USERNAME",
        "EXCHANGE_QUOTA_PASSWORD",
        "MAIL_QUOTA_IMPORT_API_URL",
        "MAIL_QUOTA_IMPORT_API_KEY"
    )
    Write-Host ""
    Write-Host ".env keys:" -f Yellow
    foreach ($key in $requiredKeys) {
        $value = [Environment]::GetEnvironmentVariable($key)
        if (-not $value) {
            foreach ($line in Get-Content -LiteralPath $envPath -Encoding UTF8) {
                if ($line -match "^(?<k>[A-Za-z_][A-Za-z0-9_]*)=(?<v>.*)$") {
                    if ($Matches.k -eq $key) {
                        $value = $Matches.v.Trim().Trim('"').Trim("'")
                        break
                    }
                }
            }
        }
        $masked = if ($value) {
            if ($key -match "PASSWORD|API_KEY") { "***set***" } else { $value }
        } else {
            "MISSING"
        }
        Write-Host ("  {0} = {1}" -f $key, $masked)
    }
}

Write-Host ""
Write-Host "--- Scheduled task ---" -f Yellow
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Task '$TaskName' not found." -f Red
    Write-Host "Register with:"
    Write-Host "  powershell -ExecutionPolicy Bypass -File C:\Project\Image_scan\scripts\install_mailbox_quota_task.ps1 -RepeatHours 4 -StartAfterRegister"
    exit 1
}

$info = Get-ScheduledTaskInfo -TaskName $TaskName
$lastRunText = if ($info.LastRunTime -and $info.LastRunTime.Year -gt 2000) { $info.LastRunTime.ToString() } else { "never" }
$nextRunText = if ($info.NextRunTime -and $info.NextRunTime.Year -gt 2000) { $info.NextRunTime.ToString() } else { "not scheduled" }
Write-Host ("State:        {0}" -f $task.State)
Write-Host ("Last run:     {0}" -f $lastRunText)
Write-Host ("Last result:  {0}" -f (Format-TaskResult $info.LastTaskResult))
Write-Host ("Next run:     {0}" -f $nextRunText)
Write-Host ("Missed runs:  {0}" -f $info.NumberOfMissedRuns)

Write-Host ""
Write-Host "Triggers:" -f Yellow
foreach ($trigger in $task.Triggers) {
    $triggerType = $trigger.CimClass.CimClassName
    $start = if ($trigger.StartBoundary) { $trigger.StartBoundary } else { "-" }
    $interval = if ($trigger.Repetition -and $trigger.Repetition.Interval) { $trigger.Repetition.Interval } else { "-" }
    $duration = if ($trigger.Repetition -and $trigger.Repetition.Duration) { $trigger.Repetition.Duration } else { "indefinite" }
    Write-Host ("  {0} start={1} interval={2} duration={3}" -f $triggerType, $start, $interval, $duration)
}

if ($info.LastTaskResult -ne 0 -and $info.LastTaskResult -ne 0x41301 -and $info.LastTaskResult -ne 0x41303) {
    Write-Host ""
    Write-Host "Last run failed. Re-run manually:" -f Red
    Write-Host "  powershell -ExecutionPolicy Bypass -File `"$scriptPath`" -ResultSize 5 -WhatIf -SaveLocalJson"
}

if (Test-Path -LiteralPath $logPath) {
    Write-Host ""
    Write-Host ("--- sync.log (last {0} lines) ---" -f $LogTail) -f Yellow
    Get-Content -LiteralPath $logPath -Tail $LogTail -Encoding UTF8 | ForEach-Object { Write-Host $_ }
} else {
    Write-Host ""
    Write-Host "sync.log not found - task likely never completed a run." -f Red
}

Write-Host ""
Write-Host "If Next run is empty or Last run is old, re-register task:" -f Cyan
Write-Host "  powershell -ExecutionPolicy Bypass -File C:\Project\Image_scan\scripts\install_mailbox_quota_task.ps1 -RepeatHours 4 -StartAfterRegister"
