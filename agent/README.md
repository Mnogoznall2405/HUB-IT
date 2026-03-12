# IT-Invent Agent Workspace

Основной entrypoint агента: `agent.py`.

Сборка MSI:

```powershell
python agent/setup.py bdist_msi
```

Совместимый старый путь:

```powershell
python setup.py bdist_msi
```

## Что делает агент

- отправляет inventory в `/api/v1/inventory`;
- поднимает scan sidecar в том же процессе;
- хранит логи и runtime state в `%ProgramData%\IT-Invent`;
- собирает Outlook `PST/OST` через файловый fallback scan.

## Outlook fallback scan

Поиск Outlook stores идёт в два этапа:

- быстрый поиск в стандартных user-profile путях под `C:\Users`;
- дополнительный рекурсивный поиск по `ITINV_OUTLOOK_SEARCH_ROOTS`.

По умолчанию:

```env
ITINV_OUTLOOK_SEARCH_ROOTS=D:\
```

Пустое значение отключает extra-root поиск:

```env
ITINV_OUTLOOK_SEARCH_ROOTS=
```

## Scan-контур

По умолчанию scan-контур работает в on-demand режиме:

- `SCAN_AGENT_SCAN_ON_START=0`
- `SCAN_AGENT_WATCHDOG_ENABLED=0`

То есть новые файлы не сканируются сами по себе. Scan запускается серверной задачей `scan_now`, либо локально через `--once`.

## Полезные переменные

- `ITINV_AGENT_SERVER_URL`
- `ITINV_AGENT_API_KEY`
- `ITINV_AGENT_INTERVAL_SEC`
- `ITINV_AGENT_HEARTBEAT_SEC`
- `ITINV_AGENT_HEARTBEAT_JITTER_SEC`
- `ITINV_OUTLOOK_REFRESH_SEC`
- `ITINV_OUTLOOK_SEARCH_ROOTS`
- `SCAN_AGENT_SERVER_BASE`
- `SCAN_AGENT_API_KEY`
- `SCAN_AGENT_SCAN_ON_START`
- `SCAN_AGENT_WATCHDOG_ENABLED`

## Scheduled Task

`agent/scripts/install_agent_task.ps1` и `scripts/install_agent_task.ps1` создают задачу:

- `ExecutionTimeLimit=PT0S`
- `StartWhenAvailable=True`
- `MultipleInstances=IgnoreNew`
- `AtStartup` + repetition `PT1H/P3650D`

Проверка после установки:

```powershell
Get-ScheduledTask -TaskName "IT-Invent Agent" | % Settings | Format-List ExecutionTimeLimit, MultipleInstances, StartWhenAvailable
Get-ScheduledTask -TaskName "IT-Invent Agent" | % Triggers | Select Enabled, @{n='RepetitionInterval';e={$_.Repetition.Interval}}, @{n='RepetitionDuration';e={$_.Repetition.Duration}}
```
