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
