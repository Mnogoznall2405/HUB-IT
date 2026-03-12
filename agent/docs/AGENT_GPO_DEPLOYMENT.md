# Развёртывание IT-Invent Agent через GPO

## 1. Подготовка MSI

```powershell
python agent/setup.py bdist_msi
```

Публикуй MSI по UNC-пути и давай `Domain Computers` права на чтение.

## 2. Установка MSI через GPO

`Computer Configuration -> Policies -> Software Settings -> Software installation`

- `New -> Package`
- укажи UNC путь к MSI
- режим `Assigned`

## 3. Конфиг агента

Рекомендуемый конфиг для пилота и прода:

- `ITINV_AGENT_SERVER_URL`
- `ITINV_AGENT_API_KEY`
- `ITINV_AGENT_INTERVAL_SEC`
- `ITINV_AGENT_HEARTBEAT_SEC`
- `ITINV_AGENT_HEARTBEAT_JITTER_SEC`
- `SCAN_AGENT_SERVER_BASE`
- `SCAN_AGENT_API_KEY`
- `SCAN_AGENT_SCAN_ON_START=0`
- `SCAN_AGENT_WATCHDOG_ENABLED=0`
- `ITINV_OUTLOOK_SEARCH_ROOTS=D:\`

Если нужен realtime/startup scan, включай его явно через env.

## 4. Автозапуск

Используй только задачу под `SYSTEM` с корректными settings. Голый `Register-ScheduledTask` без repetition и без `ExecutionTimeLimit=PT0S` не подходит.

Параметры задачи:

- `Name`: `IT-Invent Agent`
- `User`: `NT AUTHORITY\SYSTEM`
- `Trigger`: `At startup`
- `RepetitionInterval`: `PT1H`
- `RepetitionDuration`: `P3650D`
- `ExecutionTimeLimit`: `PT0S`
- `MultipleInstances`: `IgnoreNew`
- `StartWhenAvailable`: `True`
- `Program`: `C:\Program Files\IT-Invent\Agent\ITInventAgent.exe`

## 5. Проверка на клиенте

```powershell
Test-Path "C:\Program Files\IT-Invent\Agent\ITInventAgent.exe"
Get-ScheduledTask -TaskName "IT-Invent Agent"
Get-ScheduledTask -TaskName "IT-Invent Agent" | % Settings | Format-List ExecutionTimeLimit, MultipleInstances, StartWhenAvailable
Get-Content "C:\ProgramData\IT-Invent\Logs\itinvent_agent.log" -Tail 80
```
