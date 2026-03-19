# Развёртывание IT-Invent Agent через GPO / SCCM / Intune

## 1. Подготовка MSI

```powershell
python agent/setup.py bdist_msi
```

Артефакт по умолчанию появляется в `dist\`.

Опубликуй MSI по UNC-пути и дай `Domain Computers` права на чтение.

## 2. Что MSI делает сам

После установки MSI автоматически:

- ставит агент в `C:\Program Files\IT-Invent\Agent`
- пишет runtime `.env` в `C:\ProgramData\IT-Invent\Agent\.env`
- мигрирует legacy `.env` из install directory, если он найден
- создаёт Scheduled Task `IT-Invent Agent`
- запускает задачу сразу после установки
- форсирует:
  - `SCAN_AGENT_SCAN_ON_START=0`
  - `SCAN_AGENT_WATCHDOG_ENABLED=0`

Дополнительный post-install шаг через `install_agent_task.ps1` больше не обязателен.

## 3. Silent install для массового развёртывания

Рекомендуемый полный пример:

```powershell
New-Item -ItemType Directory -Force -Path C:\Temp | Out-Null
msiexec /i "\\server\share\IT-Invent Agent-1.2.3-win64.msi" /qn /norestart /l*v "C:\Temp\itinvent_agent_install.log" `
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

Минимально рекомендуемые обязательные параметры:

- `ITINV_AGENT_SERVER_URL`
- `ITINV_AGENT_API_KEY`
- `SCAN_AGENT_SERVER_BASE`
- `SCAN_AGENT_API_KEY`

## 4. Supported MSI properties

| Property | Required | Default | Example | Purpose |
| --- | --- | --- | --- | --- |
| `ITINV_AGENT_SERVER_URL` | Да | runtime default | `https://hubit.zsgp.ru/api/v1/inventory` | Inventory endpoint |
| `ITINV_AGENT_API_KEY` | Да | empty | `YOUR_SECURE_AGENT_KEY` | Inventory API key |
| `ITINV_AGENT_INTERVAL_SEC` | Нет | `3600` | `3600` | Snapshot interval |
| `ITINV_AGENT_HEARTBEAT_SEC` | Нет | `300` | `300` | Heartbeat interval |
| `ITINV_AGENT_HEARTBEAT_JITTER_SEC` | Нет | `60` | `60` | Heartbeat jitter |
| `ITINV_SCAN_ENABLED` | Нет | `1` | `1` | Enable scan sidecar |
| `SCAN_AGENT_SERVER_BASE` | Да | runtime default | `https://hubit.zsgp.ru/api/v1/scan` | Scan endpoint |
| `SCAN_AGENT_API_KEY` | Да | empty | `YOUR_SECURE_AGENT_KEY` | Scan API key |
| `SCAN_AGENT_POLL_INTERVAL_SEC` | Нет | `60` | `60` | Scan poll interval |
| `ITINV_OUTLOOK_SEARCH_ROOTS` | Нет | `D:\` | `D:\` | Extra PST/OST roots |
| `INSTALLDIR` | Нет | `C:\Program Files\IT-Invent\Agent` | `D:\Apps\IT-Invent\Agent` | Custom install path |

## 5. GPO / SCCM / Intune notes

### GPO

Используй:

`Computer Configuration -> Policies -> Software Settings -> Software installation`

Шаги:

1. `New -> Package`
2. Укажи UNC-путь к MSI
3. Выбери `Assigned`

Если нужно прокинуть MSI properties, используй deployment script или другой orchestration-слой, потому что стандартный GPO MSI assignment плохо подходит для длинной строки `msiexec` с параметрами.

### SCCM / MECM / Intune

Для этих систем предпочитай явную команду `msiexec /i ... /qn ...`, а не только "голый" MSI, чтобы контролировать API URLs, keys и logging.

## 6. Логирование установки

Рекомендуемый путь лога:

```powershell
C:\Temp\itinvent_agent_install.log
```

Проверка:

```powershell
Get-Content "C:\Temp\itinvent_agent_install.log" -Tail 200
```

Дополнительно helper пишет:

```powershell
Get-Content "C:\Windows\Temp\itinvent_agent_msi_helper.log" -Tail 200
```

## 7. Post-install validation checklist

На клиенте проверь:

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

- задача создана под `NT AUTHORITY\SYSTEM`
- `ExecutionTimeLimit : PT0S`
- `MultipleInstances : IgnoreNew`
- `StartWhenAvailable : True`
- `RepetitionInterval : PT1H`
- `RepetitionDuration : P3650D`
- `.env` существует в `C:\ProgramData\IT-Invent\Agent`
- в `.env` есть `SCAN_AGENT_SCAN_ON_START=0` и `SCAN_AGENT_WATCHDOG_ENABLED=0`

## 8. Проверка on-demand scan

После установки scan не должен стартовать сам.

Проверяем:

1. В `C:\ProgramData\IT-Invent\Agent\.env` зафиксированы `0/0`.
2. В логах нет самопроизвольного scan сразу после install.
3. Сканирование начинается только после серверной задачи `scan_now`.

## 9. Repair и uninstall

Repair:

```powershell
New-Item -ItemType Directory -Force -Path C:\Temp | Out-Null
msiexec /fa "\\server\share\IT-Invent Agent-1.2.3-win64.msi" /qn /norestart /l*v "C:\Temp\itinvent_agent_repair.log"
```

Тихое удаление:

```powershell
New-Item -ItemType Directory -Force -Path C:\Temp | Out-Null
msiexec /x "\\server\share\IT-Invent Agent-1.2.3-win64.msi" /qn /norestart /l*v "C:\Temp\itinvent_agent_uninstall.log"
```

Uninstall должен:

- убрать Scheduled Task
- остановить `ITInventAgent.exe` и `ITInventOutlookProbe.exe`
- удалить `C:\ProgramData\IT-Invent\Agent`
- удалить install directory через MSI
- очистить installer-created scan env vars

Проверка:

```powershell
Get-Process ITInventAgent -ErrorAction SilentlyContinue
Get-Process ITInventOutlookProbe -ErrorAction SilentlyContinue
Get-ScheduledTask -TaskName "IT-Invent Agent" -ErrorAction SilentlyContinue
Test-Path "C:\Program Files\IT-Invent\Agent"
Test-Path "C:\ProgramData\IT-Invent\Agent"
```

## 10. Troubleshooting

Если задача не создалась:

- проверь MSI log
- проверь наличие:

```powershell
Get-ChildItem "C:\Program Files\IT-Invent\Agent\scripts"
```

- при необходимости выполни fallback вручную:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Program Files\IT-Invent\Agent\scripts\install_agent_task.ps1" `
  -ExecutablePath "C:\Program Files\IT-Invent\Agent\ITInventAgent.exe" `
  -EnvFilePath "C:\ProgramData\IT-Invent\Agent\.env" `
  -StartAfterRegister
```

Если после старой установки на машине были machine env values `1/1`, это не должно мешать:

- MSI принудительно переписывает их в `0/0`
- это сделано специально, чтобы scan не стартовал автоматически

Если TLS падает на stale `ITINV_AGENT_CA_BUNDLE`:

- проверь актуальность пути
- при несуществующем пути агент должен перейти на стандартную TLS verification
