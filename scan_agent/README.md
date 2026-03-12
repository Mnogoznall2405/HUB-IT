# IT-Invent Scan Agent

Scan-контур по умолчанию работает в on-demand режиме:

- не делает scan сам на старте;
- не включает realtime watchdog;
- выполняет scan только по серверной команде `scan_now`;
- продолжает отправлять heartbeat и опрашивать задачи.

## Что сканирует

- `C:\Users\*\Desktop`
- `C:\Users\*\Documents`
- `C:\Users\*\Downloads`

## Запуск

```powershell
pip install -r scan_agent/requirements.txt
python scan_agent/agent.py --once
```

Постоянный режим:

```powershell
python scan_agent/agent.py
```

## Переменные окружения

- `SCAN_AGENT_SERVER_BASE` — URL scan backend
- `SCAN_AGENT_API_KEY` — API key агента
- `SCAN_AGENT_POLL_INTERVAL_SEC` — интервал heartbeat/poll, по умолчанию `60`
- `SCAN_AGENT_HTTP_TIMEOUT_SEC` — HTTP timeout, по умолчанию `20`
- `SCAN_AGENT_MAX_FILE_MB` — лимит размера файла, по умолчанию `50`
- `SCAN_AGENT_SCAN_ON_START` — `1|0`, по умолчанию `0`
- `SCAN_AGENT_WATCHDOG_ENABLED` — `1|0`, по умолчанию `0`
- `SCAN_AGENT_WATCHDOG_BATCH_SIZE` — размер батча watchdog queue, по умолчанию `200`
- `SCAN_AGENT_ROOTS_REFRESH_SEC` — refresh monitored roots, по умолчанию `300`
- `SCAN_AGENT_BRANCH` — опциональная метка филиала

Если нужен старый режим:

```powershell
$env:SCAN_AGENT_SCAN_ON_START = "1"
$env:SCAN_AGENT_WATCHDOG_ENABLED = "1"
```

## CLI

- `--once` — выполнить один локальный scan и завершиться
- `--heartbeat` — отправить heartbeat и завершиться
- `--no-watchdog` — отключить watchdog только для текущего запуска
