# IT-Invent Agent

Основной entrypoint агента: `agent.py`.

MSI собирается так:

```powershell
python agent/setup.py bdist_msi
```

Совместимый старый entrypoint тоже работает:

```powershell
python setup.py bdist_msi
```

## Технические отчёты

Подробные внутренние отчёты по агентам:

- [AGENT_SYSTEM_COLLECTION_REPORT.md](./docs/AGENT_SYSTEM_COLLECTION_REPORT.md)
- [AGENT_SCAN_INSTALL_REPORT.md](./docs/AGENT_SCAN_INSTALL_REPORT.md)

## Что теперь делает MSI сам

После установки MSI автоматически:

- копирует бинарные файлы в `C:\Program Files\IT-Invent\Agent`
- пишет runtime-конфиг в `C:\ProgramData\IT-Invent\Agent\.env`
- мигрирует legacy `.env` из `C:\Program Files\IT-Invent\Agent\.env`, если он существует
- регистрирует Scheduled Task `IT-Invent Agent`
- форсирует on-demand scan:
  - `SCAN_AGENT_SCAN_ON_START=0`
  - `SCAN_AGENT_WATCHDOG_ENABLED=0`
- сразу запускает задачу после установки

MSI custom actions больше не используют `ITInventAgent.exe` как helper. Для install/uninstall внутри MSI используется отдельный internal helper `ITInventAgentMsiHelper.exe`.

Ручной вызов `agent/scripts/install_agent_task.ps1` больше не обязателен. Скрипт остаётся fallback/admin tool.

## Runtime layout

Канонический runtime root после MSI:

```text
C:\ProgramData\IT-Invent\Agent
```

Канонические пути:

```text
C:\ProgramData\IT-Invent\Agent\.env
C:\ProgramData\IT-Invent\Agent\Logs\itinvent_agent.log
C:\ProgramData\IT-Invent\Agent\Spool
C:\ProgramData\IT-Invent\Agent\ScanAgent
```

`C:\Program Files\IT-Invent\Agent` используется только для binaries и MSI-owned files.

Основной агент автоматически чистит свой лог при старте:

- хранит только `3` файла всего: `itinvent_agent.log`, `itinvent_agent.log.1`, `itinvent_agent.log.2`
- scan-agent (`scan_agent.log`) этой политикой не затрагивается

## Silent install keys

Поддерживаемые публичные MSI properties:

| Property | Required | Default | Example | Purpose |
| --- | --- | --- | --- | --- |
| `ITINV_AGENT_SERVER_URL` | Да | runtime default | `https://hubit.zsgp.ru/api/v1/inventory` | URL inventory endpoint |
| `ITINV_AGENT_API_KEY` | Да | empty | `YOUR_SECURE_AGENT_KEY` | API key inventory-agent |
| `ITINV_AGENT_INTERVAL_SEC` | Нет | `3600` | `3600` | Full snapshot interval |
| `ITINV_AGENT_HEARTBEAT_SEC` | Нет | `300` | `300` | Heartbeat interval |
| `ITINV_AGENT_HEARTBEAT_JITTER_SEC` | Нет | `60` | `60` | Heartbeat jitter |
| `ITINV_SCAN_ENABLED` | Нет | `1` | `1` | Enables embedded scan sidecar |
| `SCAN_AGENT_SERVER_BASE` | Да | runtime default | `https://hubit.zsgp.ru/api/v1/scan` | URL scan endpoint |
| `SCAN_AGENT_API_KEY` | Да | empty | `YOUR_SECURE_AGENT_KEY` | API key scan-agent |
| `SCAN_AGENT_POLL_INTERVAL_SEC` | Нет | `60` | `60` | Scan task poll interval |
| `ITINV_OUTLOOK_SEARCH_ROOTS` | Нет | `D:\` | `D:\` | Extra Outlook PST/OST search roots |
| `INSTALLDIR` | Нет | `C:\Program Files\IT-Invent\Agent` | `D:\Apps\IT-Invent\Agent` | Custom install path |

Фиксированные значения v1, не выносятся в MSI properties:

- `TaskName = IT-Invent Agent`
- `RepeatMinutes = 60`
- `SCAN_AGENT_SCAN_ON_START = 0`
- `SCAN_AGENT_WATCHDOG_ENABLED = 0`

## Ready-to-copy команды

Тихая установка на встроенных значениях:

```powershell
msiexec /i "C:\Path\IT-Invent Agent-1.2.3-win64.msi" /qn /norestart
```

Тихая установка с логом:

```powershell
New-Item -ItemType Directory -Force -Path C:\Temp | Out-Null
msiexec /i "C:\Path\IT-Invent Agent-1.2.3-win64.msi" /qn /norestart /l*v "C:\Temp\itinvent_agent_install.log"
```

Минимально рекомендуемая тихая установка:

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

Тихое удаление:

```powershell
New-Item -ItemType Directory -Force -Path C:\Temp | Out-Null
msiexec /x "C:\Path\IT-Invent Agent-1.2.3-win64.msi" /qn /norestart /l*v "C:\Temp\itinvent_agent_uninstall.log"
```

Тихий repair:

```powershell
New-Item -ItemType Directory -Force -Path C:\Temp | Out-Null
msiexec /fa "C:\Path\IT-Invent Agent-1.2.3-win64.msi" /qn /norestart /l*v "C:\Temp\itinvent_agent_repair.log"
```

## Что проверить после установки

```powershell
Test-Path "C:\Program Files\IT-Invent\Agent\ITInventAgent.exe"
Test-Path "C:\Program Files\IT-Invent\Agent\ITInventAgentMsiHelper.exe"
Get-Content "C:\ProgramData\IT-Invent\Agent\.env"
Get-ScheduledTask -TaskName "IT-Invent Agent" | % Settings | Format-List ExecutionTimeLimit, MultipleInstances, StartWhenAvailable
Get-ScheduledTask -TaskName "IT-Invent Agent" | % Triggers | Select Enabled, @{n='RepetitionInterval';e={$_.Repetition.Interval}}, @{n='RepetitionDuration';e={$_.Repetition.Duration}}
Get-Content "C:\ProgramData\IT-Invent\Agent\Logs\itinvent_agent.log" -Tail 80
```

Ожидаемое:

- `ExecutionTimeLimit : PT0S`
- `MultipleInstances : IgnoreNew`
- `StartWhenAvailable : True`
- `RepetitionInterval : PT1H`
- `RepetitionDuration : P3650D`
- в `.env` есть `SCAN_AGENT_SCAN_ON_START=0` и `SCAN_AGENT_WATCHDOG_ENABLED=0`
- в логах есть heartbeat/inventory строки

## On-demand scan

После поддерживаемой установки scan не стартует сам:

- нет startup scan из-за старых machine-scope `1/1`
- realtime scan выключен по умолчанию
- file scan идёт только по серверной задаче `scan_now`

## Uninstall

MSI uninstall сам:

- удаляет Scheduled Task `IT-Invent Agent`
- удаляет `ITInventOutlookProbe`, если он был
- останавливает процессы `ITInventAgent.exe` и `ITInventOutlookProbe.exe`
- очищает installer-created machine env vars:
  - `SCAN_AGENT_SCAN_ON_START`
  - `SCAN_AGENT_WATCHDOG_ENABLED`
- удаляет runtime root `C:\ProgramData\IT-Invent\Agent`
- удаляет install directory через стандартный MSI file removal

После uninstall проверь:

```powershell
Get-Process ITInventAgent -ErrorAction SilentlyContinue
Get-Process ITInventOutlookProbe -ErrorAction SilentlyContinue
Get-ScheduledTask -TaskName "IT-Invent Agent" -ErrorAction SilentlyContinue
Test-Path "C:\Program Files\IT-Invent\Agent"
Test-Path "C:\ProgramData\IT-Invent\Agent"
```

## Troubleshooting

MSI install log:

```powershell
Get-Content "C:\Temp\itinvent_agent_install.log" -Tail 200
```

MSI uninstall log:

```powershell
Get-Content "C:\Temp\itinvent_agent_uninstall.log" -Tail 200
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

- проверь MSI log
- проверь, существует ли `C:\Program Files\IT-Invent\Agent\scripts\install_agent_task.ps1`
- вручную выполни fallback:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Program Files\IT-Invent\Agent\scripts\install_agent_task.ps1" `
  -ExecutablePath "C:\Program Files\IT-Invent\Agent\ITInventAgent.exe" `
  -EnvFilePath "C:\ProgramData\IT-Invent\Agent\.env" `
  -StartAfterRegister
```

Если сервер недоступен:

- агент продолжит писать локальные логи и inventory queue
- проверь `ITINV_AGENT_SERVER_URL`, `SCAN_AGENT_SERVER_BASE`, API keys и сетевую доступность

Если на машине раньше были старые `SCAN_AGENT_SCAN_ON_START=1` или `SCAN_AGENT_WATCHDOG_ENABLED=1`:

- MSI всё равно перепишет их в `0/0`
- это сделано специально, чтобы scan после установки не стартовал сам

Если TLS падает на неверном `ITINV_AGENT_CA_BUNDLE`:

- агент теперь логирует warning
- и откатывается на стандартную TLS verification, если путь к bundle не существует
