# Agent Pilot Guide

См. также технические отчёты:

- [AGENT_SYSTEM_COLLECTION_REPORT.md](./AGENT_SYSTEM_COLLECTION_REPORT.md)
- [AGENT_SCAN_INSTALL_REPORT.md](./AGENT_SCAN_INSTALL_REPORT.md)

## 1. Что делает MSI автоматически

После установки MSI сам:

- кладёт бинарные файлы в `C:\Program Files\IT-Invent\Agent`
- пишет runtime `.env` в `C:\ProgramData\IT-Invent\Agent\.env`
- мигрирует legacy `.env` из `C:\Program Files\IT-Invent\Agent\.env`, если он найден
- создаёт Scheduled Task `IT-Invent Agent`
- выставляет безопасные scheduler settings:
  - `ExecutionTimeLimit=PT0S`
  - `StartWhenAvailable=True`
  - `MultipleInstances=IgnoreNew`
  - `AtStartup + repetition PT1H / P3650D`
- форсирует on-demand scan:
  - `SCAN_AGENT_SCAN_ON_START=0`
  - `SCAN_AGENT_WATCHDOG_ENABLED=0`
- сразу запускает задачу после установки

Внутри MSI install/uninstall работает отдельный helper `ITInventAgentMsiHelper.exe`. `ITInventAgent.exe` больше не используется как installer helper.

## 2. Пошаговая ручная установка MSI

```powershell
New-Item -ItemType Directory -Force -Path C:\Temp | Out-Null
msiexec /i "C:\Path\IT-Invent Agent-1.2.3-win64.msi" /l*v "C:\Temp\itinvent_agent_install.log"
```

Если нужен нестандартный путь для binaries:

```powershell
New-Item -ItemType Directory -Force -Path C:\Temp | Out-Null
msiexec /i "C:\Path\IT-Invent Agent-1.2.3-win64.msi" INSTALLDIR="D:\Apps\IT-Invent\Agent" /l*v "C:\Temp\itinvent_agent_install.log"
```

## 3. Пошаговая тихая установка

Минимально рекомендуемый silent install:

```powershell
New-Item -ItemType Directory -Force -Path C:\Temp | Out-Null
msiexec /i "C:\Path\IT-Invent Agent-1.2.3-win64.msi" /qn /norestart /l*v "C:\Temp\itinvent_agent_install.log" `
  ITINV_AGENT_SERVER_URL="http://127.0.0.1:8001/api/v1/inventory" `
  ITINV_AGENT_API_KEY="YOUR_SECURE_AGENT_KEY" `
  SCAN_AGENT_SERVER_BASE="http://127.0.0.1:8011/api/v1/scan" `
  SCAN_AGENT_API_KEY="YOUR_SECURE_AGENT_KEY"
```

Полный пример:

```powershell
New-Item -ItemType Directory -Force -Path C:\Temp | Out-Null
msiexec /i "C:\Path\IT-Invent Agent-1.2.3-win64.msi" /qn /norestart /l*v "C:\Temp\itinvent_agent_install.log" `
  ITINV_AGENT_SERVER_URL="http://127.0.0.1:8001/api/v1/inventory" `
  ITINV_AGENT_API_KEY="YOUR_SECURE_AGENT_KEY" `
  ITINV_AGENT_INTERVAL_SEC="3600" `
  ITINV_AGENT_HEARTBEAT_SEC="300" `
  ITINV_AGENT_HEARTBEAT_JITTER_SEC="60" `
  ITINV_SCAN_ENABLED="1" `
  SCAN_AGENT_SERVER_BASE="http://127.0.0.1:8011/api/v1/scan" `
  SCAN_AGENT_API_KEY="YOUR_SECURE_AGENT_KEY" `
  SCAN_AGENT_POLL_INTERVAL_SEC="60" `
  ITINV_OUTLOOK_SEARCH_ROOTS="D:\"
```

## 4. Silent install keys

| Property | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ITINV_AGENT_SERVER_URL` | Да | runtime default | Inventory endpoint |
| `ITINV_AGENT_API_KEY` | Да | empty | Inventory API key |
| `ITINV_AGENT_INTERVAL_SEC` | Нет | `3600` | Full snapshot interval |
| `ITINV_AGENT_HEARTBEAT_SEC` | Нет | `300` | Heartbeat interval |
| `ITINV_AGENT_HEARTBEAT_JITTER_SEC` | Нет | `60` | Heartbeat jitter |
| `ITINV_SCAN_ENABLED` | Нет | `1` | Enable scan sidecar |
| `SCAN_AGENT_SERVER_BASE` | Да | runtime default | Scan endpoint |
| `SCAN_AGENT_API_KEY` | Да | empty | Scan API key |
| `SCAN_AGENT_POLL_INTERVAL_SEC` | Нет | `60` | Scan poll interval |
| `ITINV_OUTLOOK_SEARCH_ROOTS` | Нет | `D:\` | Extra PST/OST search roots |
| `INSTALLDIR` | Нет | `C:\Program Files\IT-Invent\Agent` | Custom install path |

## 5. Post-install validation

Проверь установку:

```powershell
Test-Path "C:\Program Files\IT-Invent\Agent\ITInventAgent.exe"
Test-Path "C:\Program Files\IT-Invent\Agent\ITInventAgentMsiHelper.exe"
Get-Content "C:\ProgramData\IT-Invent\Agent\.env"
Get-ScheduledTask -TaskName "IT-Invent Agent"
Get-ScheduledTask -TaskName "IT-Invent Agent" | % Settings | Format-List ExecutionTimeLimit, MultipleInstances, StartWhenAvailable
Get-ScheduledTask -TaskName "IT-Invent Agent" | % Triggers | Select Enabled, @{n='RepetitionInterval';e={$_.Repetition.Interval}}, @{n='RepetitionDuration';e={$_.Repetition.Duration}}
Get-Content "C:\ProgramData\IT-Invent\Agent\Logs\itinvent_agent.log" -Tail 100
```

Ожидаемое:

- EXE существует
- helper существует
- `.env` существует в `C:\ProgramData\IT-Invent\Agent`
- задача `IT-Invent Agent` создана под `SYSTEM`
- `ExecutionTimeLimit : PT0S`
- `MultipleInstances : IgnoreNew`
- `StartWhenAvailable : True`
- `RepetitionInterval : PT1H`
- `RepetitionDuration : P3650D`

## 6. Как проверить on-demand behavior

Подтверди, что file scan не запускается сам:

1. Сразу после установки не должно быть самостоятельного `run_scan_once()`.
2. В `C:\ProgramData\IT-Invent\Agent\.env` должны быть:

```env
SCAN_AGENT_SCAN_ON_START=0
SCAN_AGENT_WATCHDOG_ENABLED=0
```

3. Scan должен выполняться только после серверной задачи `scan_now`.

## 7. Repair и uninstall

Repair:

```powershell
New-Item -ItemType Directory -Force -Path C:\Temp | Out-Null
msiexec /fa "C:\Path\IT-Invent Agent-1.2.3-win64.msi" /qn /norestart /l*v "C:\Temp\itinvent_agent_repair.log"
```

Тихое удаление:

```powershell
New-Item -ItemType Directory -Force -Path C:\Temp | Out-Null
msiexec /x "C:\Path\IT-Invent Agent-1.2.3-win64.msi" /qn /norestart /l*v "C:\Temp\itinvent_agent_uninstall.log"
```

Uninstall должен:

- удалить `IT-Invent Agent`
- удалить `ITInventOutlookProbe`, если он был
- остановить процессы `ITInventAgent.exe` и `ITInventOutlookProbe.exe`
- удалить `C:\ProgramData\IT-Invent\Agent`
- очистить machine-level `SCAN_AGENT_SCAN_ON_START` и `SCAN_AGENT_WATCHDOG_ENABLED`

Проверка после uninstall:

```powershell
Get-Process ITInventAgent -ErrorAction SilentlyContinue
Get-Process ITInventOutlookProbe -ErrorAction SilentlyContinue
Get-ScheduledTask -TaskName "IT-Invent Agent" -ErrorAction SilentlyContinue
Test-Path "C:\Program Files\IT-Invent\Agent"
Test-Path "C:\ProgramData\IT-Invent\Agent"
```

## 8. Troubleshooting

MSI log:

```powershell
Get-Content "C:\Temp\itinvent_agent_install.log" -Tail 200
```

MSI helper log:

```powershell
Get-Content "C:\Windows\Temp\itinvent_agent_msi_helper.log" -Tail 200
```

Agent log:

```powershell
Get-Content "C:\ProgramData\IT-Invent\Agent\Logs\itinvent_agent.log" -Tail 200
```

Если задача не создалась:

```powershell
Get-ChildItem "C:\Program Files\IT-Invent\Agent\scripts"
```

Fallback ручной регистрации:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Program Files\IT-Invent\Agent\scripts\install_agent_task.ps1" `
  -ExecutablePath "C:\Program Files\IT-Invent\Agent\ITInventAgent.exe" `
  -EnvFilePath "C:\ProgramData\IT-Invent\Agent\.env" `
  -StartAfterRegister
```

Если сервер недоступен:

- проверь `ITINV_AGENT_SERVER_URL`
- проверь `SCAN_AGENT_SERVER_BASE`
- проверь API keys
- проверь сетевую доступность endpoints

Если TLS падает на несуществующем `ITINV_AGENT_CA_BUNDLE`:

- агент должен записать warning в лог
- и продолжить работу на стандартной TLS verification
