param(
    [ValidateSet('Status', 'Enable', 'Disable', 'Remove')]
    [string]$Mode = 'Status'
)

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$taskName = 'HUB-IT PM2 Autostart'
$resurrectScript = Join-Path $projectRoot 'scripts\pm2\pm2-boot-resurrect.ps1'

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
        RunLevel   = $task.Principal.RunLevel
        Trigger    = (($task.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace 'MSFT_Task|Trigger', '' }) -join ',')
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
        if (-not (Test-Path $resurrectScript)) {
            throw "Resurrect script not found: $resurrectScript"
        }

        $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$resurrectScript`""
        $trigger = New-ScheduledTaskTrigger -AtStartup
        $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType S4U -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 2)

        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -Description 'Resurrect the saved PM2 process list (dump.pm2) after server reboot without requiring interactive logon.' | Out-Null

        Write-Host "Scheduled task '$taskName' registered for $userId (AtStartup, S4U)." -ForegroundColor Green
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
