param(
    # Не вмешиваться первые N минут после загрузки: там работает HUB-IT PM2 Autostart.
    [int]$BootGraceMinutes = 10
)

# Сторож PM2: если в PM2 нет ни одного online-процесса (демон убит или поднялся
# пустым), запускает штатный pm2-boot-resurrect.ps1. Запускается по расписанию
# из задачи "HUB-IT PM2 Watchdog" (S4U, без окна). Идемпотентен: при живых
# процессах ничего не делает; при нечитаемом состоянии PM2 тоже ничего не делает.

$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Project\Image_scan'
$logFile = Join-Path $projectRoot 'scripts\pm2\_watchdog.log'
$bootScript = Join-Path $projectRoot 'scripts\pm2\pm2-boot-resurrect.ps1'

function Write-WatchdogLog {
    param([string]$Message)
    Add-Content -Path $logFile -Value ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message) -Encoding UTF8
}

# Ограничение размера лога: при превышении 1 МБ оставляем хвост.
if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 1MB)) {
    $tail = Get-Content $logFile -Tail 200 -Encoding UTF8
    Set-Content -Path $logFile -Value $tail -Encoding UTF8
}

# Один экземпляр на машину (также не пересекается сам с собой при долгом resurrect).
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($false, 'Global\HUB-IT-PM2-Watchdog', [ref]$createdNew)
if (-not $mutex.WaitOne(0)) {
    exit 0
}

try {
    $bootTime = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
    if (((Get-Date) - $bootTime).TotalMinutes -lt $BootGraceMinutes) {
        exit 0
    }

    $pm2Cmd = $null
    foreach ($root in @($env:APPDATA, (Join-Path $env:USERPROFILE 'AppData\Roaming')) | Where-Object { $_ }) {
        $candidate = Join-Path $root 'npm\pm2.cmd'
        if (Test-Path $candidate) { $pm2Cmd = $candidate; break }
    }
    if (-not $pm2Cmd) {
        Write-WatchdogLog 'pm2.cmd not found; nothing done'
        exit 1
    }

    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $raw = & $pm2Cmd jlist 2>&1 | Out-String } finally { $ErrorActionPreference = $prevPref }

    $start = $raw.IndexOf('[')
    $end = $raw.LastIndexOf(']')
    if ($start -lt 0 -or $end -le $start) {
        Write-WatchdogLog 'jlist unreadable; nothing done'
        exit 1
    }

    # ConvertFrom-Json падает на pm2_env-ключах, различающихся только регистром
    # (username/USERNAME); JavaScriptSerializer — нет (как в pm2-boot-resurrect.ps1).
    try {
        Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
        $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
        $serializer.MaxJsonLength = [int]::MaxValue
        $apps = @($serializer.DeserializeObject($raw.Substring($start, $end - $start + 1)))
    } catch {
        Write-WatchdogLog "jlist JSON parse failed: $($_.Exception.Message); nothing done"
        exit 1
    }
    $online = @($apps | Where-Object { $_ -and $_['pm2_env'] -and $_['pm2_env']['status'] -eq 'online' }).Count
    if ($online -gt 0) {
        exit 0
    }

    Write-WatchdogLog "PM2 has no online apps (total=$($apps.Count)); running pm2-boot-resurrect.ps1"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $bootScript -DelaySeconds 0
    Write-WatchdogLog "pm2-boot-resurrect.ps1 exit=$LASTEXITCODE"
    exit $LASTEXITCODE
} catch {
    Write-WatchdogLog "unexpected error: $($_.Exception.Message)"
    exit 1
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
