param(
    [string]$TaskName = "IT-Invent Scan Agent",
    [string]$PythonExe = "C:\Python312\python.exe",
    [string]$ScriptPath = "C:\Program Files\IT-Invent\ScanAgent\agent.py",
    [int]$RepeatMinutes = 1,
    [string]$EnvFilePath = ""
)

$ErrorActionPreference = "Stop"

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

if (-not (Test-Path -Path $PythonExe)) {
    throw "Python not found: $PythonExe"
}
if (-not (Test-Path -Path $ScriptPath)) {
    throw "Script not found: $ScriptPath"
}
if ($RepeatMinutes -lt 1) {
    throw "RepeatMinutes must be >= 1"
}

$workDir = Split-Path -Path $ScriptPath -Parent
$envPath = if ($EnvFilePath) { $EnvFilePath } else { Join-Path $workDir ".env" }

Set-ScanOnDemandDefaults -EnvPath $envPath

$action = New-ScheduledTaskAction -Execute $PythonExe -Argument "`"$ScriptPath`"" -WorkingDirectory $workDir
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
Write-Host "Task '$TaskName' registered successfully. Scan defaults forced to on-demand in $envPath"
