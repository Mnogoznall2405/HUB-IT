param(
    [string]$TaskName = "IT-Invent Agent",
    [string]$ExecutablePath = "C:\Program Files\IT-Invent\Agent\ITInventAgent.exe",
    [int]$RepeatMinutes = 60,
    [string]$EnvFilePath = "",
    [switch]$StartAfterRegister
)

$ErrorActionPreference = "Stop"

$defaultRuntimeRoot = Join-Path ([Environment]::GetFolderPath("CommonApplicationData")) "IT-Invent\Agent"

function Set-EnvFileValue {
    param(
        [string]$Path,
        [string]$Key,
        [string]$Value
    )

    $targetPath = [string]$Path
    if (-not $targetPath) {
        return
    }

    $parent = Split-Path -Path $targetPath -Parent
    if ($parent) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }

    $lines = @()
    if (Test-Path -LiteralPath $targetPath) {
        $lines = @(Get-Content -LiteralPath $targetPath -Encoding UTF8)
    }

    $updated = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^\s*${Key}\s*=") {
            $lines[$i] = "${Key}=${Value}"
            $updated = $true
        }
    }

    if (-not $updated) {
        $lines += "${Key}=${Value}"
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($targetPath, [string[]]$lines, $utf8NoBom)
}

function Set-ScanOnDemandDefaults {
    param([string]$EnvPath)

    [Environment]::SetEnvironmentVariable("SCAN_AGENT_SCAN_ON_START", "0", "Machine")
    [Environment]::SetEnvironmentVariable("SCAN_AGENT_WATCHDOG_ENABLED", "0", "Machine")
    $env:SCAN_AGENT_SCAN_ON_START = "0"
    $env:SCAN_AGENT_WATCHDOG_ENABLED = "0"

    Set-EnvFileValue -Path $EnvPath -Key "SCAN_AGENT_SCAN_ON_START" -Value "0"
    Set-EnvFileValue -Path $EnvPath -Key "SCAN_AGENT_WATCHDOG_ENABLED" -Value "0"
    Set-EnvFileValue -Path $EnvPath -Key "ITINV_AGENT_HEARTBEAT_SEC" -Value "600"
    Set-EnvFileValue -Path $EnvPath -Key "ITINV_AGENT_HEARTBEAT_JITTER_SEC" -Value "120"
    Set-EnvFileValue -Path $EnvPath -Key "SCAN_AGENT_POLL_INTERVAL_SEC" -Value "600"
    Set-EnvFileValue -Path $EnvPath -Key "SCAN_AGENT_POLL_JITTER_SEC" -Value "120"
}

function Stop-ExistingAgentRuntime {
    param([string]$TaskName)

    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -ne $existingTask) {
        try {
            Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
            Start-Sleep -Seconds 1
            Write-Host "[OK] Existing task '$TaskName' stopped before registration."
        }
        catch {
            Write-Warning "Failed to stop existing task '$TaskName': $($_.Exception.Message)"
        }
    }

    foreach ($name in @("ITInventAgent", "ITInventScanAgent", "ITInventOutlookProbe")) {
        $processes = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
        if ($processes.Count -eq 0) {
            continue
        }
        foreach ($process in $processes) {
            try {
                Stop-Process -Id $process.Id -Force -ErrorAction Stop
                Write-Host "[OK] Process '$name' pid=$($process.Id) stopped before registration."
            }
            catch {
                Write-Warning "Failed to stop process '$name' pid=$($process.Id): $($_.Exception.Message)"
            }
        }
    }
}

if (-not (Test-Path -Path $ExecutablePath)) {
    throw "Executable not found: $ExecutablePath"
}

if ($RepeatMinutes -lt 1) {
    throw "RepeatMinutes must be >= 1"
}

$workDir = Split-Path -Path $ExecutablePath -Parent
$envPath = if ($EnvFilePath) { $EnvFilePath } else { Join-Path $defaultRuntimeRoot ".env" }

Set-ScanOnDemandDefaults -EnvPath $envPath
Stop-ExistingAgentRuntime -TaskName $TaskName

$action = New-ScheduledTaskAction -Execute $ExecutablePath -WorkingDirectory $workDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$repetition = New-CimInstance -ClientOnly -Namespace Root/Microsoft/Windows/TaskScheduler -ClassName MSFT_TaskRepetitionPattern -Property @{
    Interval = [System.Xml.XmlConvert]::ToString((New-TimeSpan -Minutes $RepeatMinutes))
    Duration = [System.Xml.XmlConvert]::ToString((New-TimeSpan -Days 3650))
    StopAtDurationEnd = $false
}
$trigger.Repetition = $repetition

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew

$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
if ($StartAfterRegister) {
    try {
        Start-ScheduledTask -TaskName $TaskName | Out-Null
    }
    catch {
        Write-Warning "Scheduled task '$TaskName' registered, but immediate start failed: $($_.Exception.Message)"
    }
}
Write-Host "Scheduled task '$TaskName' registered successfully. Scan defaults forced to on-demand in $envPath"
