# Agent Pilot Guide

## 1. Install MSI

```powershell
msiexec /i "C:\Path\IT-Invent Agent-1.2.3-win64.msi" /qn /norestart /l*v "C:\Temp\itinvent_agent_install.log"
```

Ожидаемый путь:

- `C:\Program Files\IT-Invent\Agent\ITInventAgent.exe`

## 2. Configure runtime

```powershell
$env:ITINV_AGENT_SERVER_URL = "https://hubit.zsgp.ru/api/v1/inventory"
$env:ITINV_AGENT_API_KEY = "itinvent_agent_secure_token_v1"
$env:ITINV_AGENT_INTERVAL_SEC = "3600"

$env:ITINV_SCAN_ENABLED = "1"
$env:SCAN_AGENT_SERVER_BASE = "https://hubit.zsgp.ru/api/v1/scan"
$env:SCAN_AGENT_API_KEY = "itinvent_agent_secure_token_v1"
$env:SCAN_AGENT_POLL_INTERVAL_SEC = "60"
$env:SCAN_AGENT_SCAN_ON_START = "0"
$env:SCAN_AGENT_WATCHDOG_ENABLED = "0"

$env:ITINV_OUTLOOK_SEARCH_ROOTS = "D:\"
```

`ITINV_OUTLOOK_SEARCH_ROOTS` задаёт дополнительные корни для поиска `PST/OST`. Пустое значение отключает extra-root поиск.

## 3. Validate connectivity

```powershell
& "C:\Program Files\IT-Invent\Agent\ITInventAgent.exe" --check
```

## 4. One-shot run

```powershell
& "C:\Program Files\IT-Invent\Agent\ITInventAgent.exe" --once
```

## 5. Verify logs

```powershell
Get-Content "C:\ProgramData\IT-Invent\Logs\itinvent_agent.log" -Tail 80
```

Проверь:

- startup config line;
- inventory collection line;
- `Inventory sent successfully, status=200`;
- строки Outlook fallback scan summary.

## 6. Register autostart task

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install_agent_task.ps1
```

Проверка:

```powershell
Get-ScheduledTask -TaskName "IT-Invent Agent" | % Settings | Format-List ExecutionTimeLimit, MultipleInstances, StartWhenAvailable
Get-ScheduledTask -TaskName "IT-Invent Agent" | % Triggers | Select Enabled, @{n='RepetitionInterval';e={$_.Repetition.Interval}}, @{n='RepetitionDuration';e={$_.Repetition.Duration}}
```

Ожидается:

- `ExecutionTimeLimit : PT0S`
- `MultipleInstances : IgnoreNew`
- `StartWhenAvailable : True`
- `RepetitionInterval : PT1H`
- `RepetitionDuration : P3650D`
