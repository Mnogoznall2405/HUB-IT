# Shared Windows orphan cleanup after `pm2 stop` / `pm2 kill` / bare `pm2 restart`.
# On Windows, python children often survive daemon death and keep ports/singleton locks.
$ErrorActionPreference = 'SilentlyContinue'

function Get-PortListenerPids {
    param([int]$ListenPort)
    $pids = @()
    $lines = netstat -ano | Select-String ":$ListenPort\s+.*LISTENING"
    foreach ($line in $lines) {
        $parts = ($line -split '\s+') | Where-Object { $_ }
        if ($parts.Count -ge 1 -and $parts[-1] -match '^\d+$') {
            $pids += [int]$parts[-1]
        }
    }
    return @($pids | Sort-Object -Unique)
}

function Stop-PidTree {
    param([int]$ProcessId, [string]$Reason)
    if ($ProcessId -le 0) { return }
    Write-Host "Killing PID $ProcessId ($Reason)..." -ForegroundColor Yellow
    taskkill /PID $ProcessId /T /F 2>$null | Out-Null
}

# Ports that must not stay occupied by orphans
foreach ($pair in @(
    @{ Port = 8001; Reason = 'backend port' },
    @{ Port = 8002; Reason = 'chat port' },
    @{ Port = 8011; Reason = 'scan port' },
    @{ Port = 8012; Reason = 'inventory port' }
)) {
    foreach ($listenerPid in (Get-PortListenerPids -ListenPort $pair.Port)) {
        Stop-PidTree -ProcessId $listenerPid -Reason $pair.Reason
    }
}

$patterns = @(
    @{ Re = 'start_server\.py'; Reason = 'backend start_server.py' },
    @{ Re = 'start_chat_server\.py'; Reason = 'chat start_chat_server.py' },
    @{ Re = 'start_preview_worker\.py'; Reason = 'shared preview worker' },
    @{ Re = '(^|\s)-m\s+scan_server(\s|$)'; Reason = 'scan_server API' },
    @{ Re = 'scan_server\.worker_main'; Reason = 'scan worker' },
    @{ Re = '(^|\s)-m\s+inventory_server(\s|$)'; Reason = 'inventory_server' },
    @{ Re = 'start_(mail_notification|chat_push)_worker\.py'; Reason = 'notification worker' },
    @{ Re = 'start_ai_chat_worker\.py'; Reason = 'ai chat worker' },
    @{ Re = 'start_my_files_worker\.py'; Reason = 'my files worker' },
    @{ Re = 'hub_notifications_retention'; Reason = 'hub retention worker' },
    @{ Re = '-m\s+bot\.main'; Reason = 'telegram bot' }
)

$procs = @(Get-CimInstance Win32_Process -Filter "Name = 'python.exe' OR Name = 'pythonw.exe'" -ErrorAction SilentlyContinue)
foreach ($proc in $procs) {
    $cmd = [string]$proc.CommandLine
    if (-not $cmd) { continue }
    foreach ($pat in $patterns) {
        if ($cmd -match $pat.Re) {
            Stop-PidTree -ProcessId ([int]$proc.ProcessId) -Reason $pat.Reason
            break
        }
    }
}

Write-Host 'Orphan cleanup done.' -ForegroundColor Green
