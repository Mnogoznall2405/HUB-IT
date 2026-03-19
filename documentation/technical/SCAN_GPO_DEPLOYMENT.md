# SCAN Agent + Server: Windows / GPO Deployment

Scan-контур по умолчанию работает в on-demand режиме.

Поддерживаемые install-скрипты дополнительно принудительно выставляют `SCAN_AGENT_SCAN_ON_START=0` и `SCAN_AGENT_WATCHDOG_ENABLED=0`, чтобы не унаследовать старые machine-scope значения `1/1`.

Обязательные machine-scope переменные:

- `SCAN_AGENT_SERVER_BASE=https://hubit.zsgp.ru/api/v1/scan`
- `SCAN_AGENT_API_KEY=...`
- `SCAN_AGENT_POLL_INTERVAL_SEC=60`
- `SCAN_AGENT_SCAN_ON_START=0`
- `SCAN_AGENT_WATCHDOG_ENABLED=0`

Если нужен старый realtime/startup режим, включай его явно:

- `SCAN_AGENT_SCAN_ON_START=1`
- `SCAN_AGENT_WATCHDOG_ENABLED=1`

После раскатки проверь:

- `%ProgramData%\IT-Invent\ScanAgent\scan_agent.log`
- `GET /api/v1/scan/agents`
- `scan_now` из UI
- task-mode settings: `ExecutionTimeLimit = PT0S`, `MultipleInstances = IgnoreNew`, repetition включён
