param(
    [ValidateSet("status", "start", "restart", "stop")]
    [string]$Action = "restart",
    [string]$ServiceName = "itinvent-scan-agent",
    [string]$TaskName = "IT-Invent Agent",
    [string[]]$ProcessNames = @("ITInventAgent", "ITInventOutlookProbe"),
    [string]$ExecutablePath = "C:\Program Files\IT-Invent\Agent\ITInventAgent.exe"
)

$ErrorActionPreference = "Stop"

function Get-AgentService {
    param([string]$Name)
    return Get-Service -Name $Name -ErrorAction SilentlyContinue
}

function Get-AgentTask {
    param([string]$Name)
    return Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
}

function Stop-AgentProcesses {
    param([string[]]$Names)

    foreach ($name in @($Names | Where-Object { $_ })) {
        $processes = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
        foreach ($process in $processes) {
            try {
                Stop-Process -Id $process.Id -Force -ErrorAction Stop
                Write-Host "[OK] Stopped process '$name' (PID $($process.Id))."
            }
            catch {
                Write-Warning "Failed to stop process '$name' (PID $($process.Id)): $($_.Exception.Message)"
            }
        }
    }
}

function Start-AgentExecutable {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Agent executable not found: $Path"
    }

    $workDir = Split-Path -Path $Path -Parent
    $proc = Start-Process -FilePath $Path -WorkingDirectory $workDir -PassThru
    Write-Host "[OK] Started executable '$Path' (PID $($proc.Id))."
}

function Show-AgentStatus {
    param(
        [object]$Service,
        [object]$Task
    )

    if ($null -ne $Service) {
        Write-Host ("Mode: service | Name: {0} | Status: {1}" -f $Service.Name, $Service.Status)
    }
    elseif ($null -ne $Task) {
        $taskInfo = Get-ScheduledTaskInfo -TaskName $Task.TaskName
        Write-Host ("Mode: scheduled-task | Name: {0} | State: {1} | LastRunTime: {2}" -f $Task.TaskName, $Task.State, $taskInfo.LastRunTime)
    }
    elseif (Test-Path -LiteralPath $ExecutablePath) {
        Write-Host ("Mode: executable | Path: {0}" -f $ExecutablePath)
    }
    else {
        Write-Host "Agent is not installed as service, scheduled task, or executable." -ForegroundColor Yellow
    }
}

$service = Get-AgentService -Name $ServiceName
$task = if ($null -eq $service) { Get-AgentTask -Name $TaskName } else { $null }

switch ($Action) {
    "status" {
        Show-AgentStatus -Service $service -Task $task
    }
    "start" {
        if ($null -ne $service) {
            if ($service.Status -ne "Running") {
                Start-Service -Name $ServiceName
                $service.Refresh()
            }
            Show-AgentStatus -Service $service -Task $null
            break
        }
        if ($null -ne $task) {
            Start-ScheduledTask -TaskName $TaskName | Out-Null
            Show-AgentStatus -Service $null -Task $task
            break
        }
        Start-AgentExecutable -Path $ExecutablePath
    }
    "restart" {
        if ($null -ne $service) {
            if ($service.Status -eq "Running") {
                Restart-Service -Name $ServiceName -Force
            }
            else {
                Start-Service -Name $ServiceName
            }
            $service = Get-AgentService -Name $ServiceName
            Show-AgentStatus -Service $service -Task $null
            break
        }
        if ($null -ne $task) {
            try {
                Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
            }
            catch {
            }
            Stop-AgentProcesses -Names $ProcessNames
            Start-ScheduledTask -TaskName $TaskName | Out-Null
            Show-AgentStatus -Service $null -Task $task
            break
        }
        Stop-AgentProcesses -Names $ProcessNames
        Start-AgentExecutable -Path $ExecutablePath
    }
    "stop" {
        if ($null -ne $service) {
            if ($service.Status -eq "Running") {
                Stop-Service -Name $ServiceName -Force
            }
            $service = Get-AgentService -Name $ServiceName
            Show-AgentStatus -Service $service -Task $null
            break
        }
        if ($null -ne $task) {
            try {
                Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
            }
            catch {
            }
            Stop-AgentProcesses -Names $ProcessNames
            Show-AgentStatus -Service $null -Task $task
            break
        }
        Stop-AgentProcesses -Names $ProcessNames
        Write-Host "[OK] Executable mode stop completed."
    }
}
