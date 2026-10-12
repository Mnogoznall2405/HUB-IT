param(
    [ValidateSet('Status', 'Enable', 'Disable', 'Remove')]
    [string]$Mode = 'Status',
    [int]$IntervalMinutes = 1
)

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$taskName = 'HUB-IT PM2 Watchdog'
$watchdogScript = Join-Path $projectRoot 'scripts\pm2\pm2-watchdog.ps1'

function Show-TaskStatus {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if (-not $task) {
        Write-Host "Scheduled task '$taskName' is not registered." -ForegroundColor Yellow
        return
    }

    $info = $task | Get-ScheduledTaskInfo
    [pscustomobject]@{
        TaskName   = $task.TaskName
        State      = $task.State
        UserId     = $task.Principal.UserId
        LogonType  = $task.Principal.LogonType
        Action     = (($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)".Trim() }) -join ' | ')
        LastRun    = $info.LastRunTime
        LastResult = $info.LastTaskResult
        NextRun    = $info.NextRunTime
    } | Format-List
}

switch ($Mode) {
    'Status' {
        Show-TaskStatus
        break
    }
    'Enable' {
        if (-not (Test-Path $watchdogScript)) {
            throw "Watchdog script not found: $watchdogScript"
        }

        # S4U + Hidden: задача не использует интерактивный рабочий стол, окно консоли не появляется.
        $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchdogScript`""
        $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
        $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType S4U -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -Hidden -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -Description 'Restore PM2 processes via pm2-boot-resurrect.ps1 when PM2 has no online apps (daemon killed or restarted empty). Runs hidden, no console window.' | Out-Null

        Write-Host "Scheduled task '$taskName' registered for $userId (every $IntervalMinutes min, S4U, hidden)." -ForegroundColor Green
        Show-TaskStatus
        break
    }
    'Disable' {
        Disable-ScheduledTask -TaskName $taskName | Out-Null
        Write-Host "Scheduled task '$taskName' disabled." -ForegroundColor Yellow
        Show-TaskStatus
        break
    }
    'Remove' {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "Scheduled task '$taskName' removed." -ForegroundColor Yellow
        break
    }
}
