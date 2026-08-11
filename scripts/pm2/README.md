# PM2 Runbook

Frontend остаётся на `IIS` и не переводится под `pm2 serve`.

PM2 используется только для Python-процессов:

- `scripts/pm2/ecosystem.backend.config.js`
- `scripts/pm2/ecosystem.backend.scale.config.js`
- `scripts/pm2/ecosystem.chat.scale.config.js` — два Chat API с PostgreSQL realtime
- `scripts/pm2/ecosystem.inventory.config.js`
- `scripts/pm2/ecosystem.scan.config.js`
- `scripts/pm2/ecosystem.bot.config.js`
- `scripts/pm2/ecosystem.all.config.js`
- `scripts/pm2/restart-backend.ps1` — штатный рестарт backend (+ безопасный reload scan)
- `scripts/pm2/enable-chat-postgres.ps1` — валидация, включение и откат двух Chat-узлов
- `scripts/pm2/restart-chat-scale.ps1` — последовательный restart уже включённых Chat-узлов
- `scripts/pm2/restart-scan.ps1` — **stop + orphan cleanup + start** для scan (не голый `pm2 restart`)
- `scripts/pm2/clear-pm2-orphans.ps1` — зачистка orphan python после `pm2 kill`/`stop` на Windows
- `scripts/pm2/start-all.ps1` / `restart-all.ps1` / `stop-all.ps1` — вызывают orphan cleanup
- `scripts/pm2/health-check.ps1`

Если все 4 процесса запущены на одной машине, можно стартовать их одной командой:

```powershell
pm2 start scripts\pm2\ecosystem.all.config.js
pm2 logs --lines 100
```

Более безопасный локальный вариант, который сначала удаляет старые процессы и потом поднимает все заново:

```powershell
powershell -File scripts\pm2\start-all.ps1
```

Пакетный перезапуск:

```powershell
powershell -File scripts\pm2\restart-all.ps1
```

Пакетная остановка:

```powershell
powershell -File scripts\pm2\stop-all.ps1
```

Быстрая проверка процессов и health endpoint:

```powershell
powershell -File scripts\pm2\health-check.ps1
```

Chat production baseline (single node, no Redis required):

```powershell
pm2 start scripts\pm2\ecosystem.backend.config.js
powershell -File scripts\pm2\health-check.ps1
```

The single `itinvent-chat` process owns port `8002`. Local realtime is safe only
while one Chat API node is running; do not put two local-mode nodes behind IIS.

Windows / no-Redis baseline for AI chat:

- `itinvent-chat-push-worker` processes only `chat_push_outbox` (Web Push);
- `itinvent-mail-notification-worker` polls mail notifications once per cluster and sends them through the shared Web Push subscription table;
- cross-process AI realtime uses DB-backed `chat_event_outbox` dispatched by `itinvent-backend`;
- `backend-chat-runtime` is healthy in local mode only when `event_dispatcher_active=True`, even if Redis is not configured;
- if `event_dispatcher_active=False`, websocket delivery for AI and degraded cross-process chat realtime must be treated as broken.

AI chat worker:

```powershell
pm2 start scripts\pm2\ecosystem.backend.config.js --only itinvent-ai-chat-worker
pm2 restart itinvent-ai-chat-worker
pm2 logs itinvent-ai-chat-worker --lines 100
powershell -File scripts\pm2\health-check.ps1
```

Notes for AI runtime:

- `itinvent-ai-chat-worker` now claims runs atomically, so accidental duplicate workers must not process the same run twice;
- recommended starting point is one `itinvent-ai-chat-worker` process with `AI_CHAT_WORKER_CONCURRENCY=2`;
- restart `itinvent-ai-chat-worker` after OpenRouter or AI-bot config changes;
- `health-check.ps1` includes the worker in the PM2 snapshot and should stay green together with `itinvent-backend`;
- `itinvent-ai-chat-worker` is not a websocket owner; browser realtime is published only by `itinvent-backend` through `chat_event_outbox`.

Prepared dual-node Chat API baseline for group chats and `100+` online. It uses
the existing PostgreSQL database for cross-node realtime, so Redis is not needed.
Repository changes do not activate it automatically.

```powershell
# Safe default: validate only, no .env or PM2 mutation.
powershell -File scripts\pm2\enable-chat-postgres.ps1

# Run only after the IIS upstream for both Chat ports is prepared.
powershell -File scripts\pm2\enable-chat-postgres.ps1 -Mode EnableDual
Invoke-WebRequest http://127.0.0.1:8002/health/ready
Invoke-WebRequest http://127.0.0.1:8004/health/ready

# Rolling restart after scale-out is already active.
powershell -File scripts\pm2\restart-chat-scale.ps1

# Print current PostgreSQL use and the configured dual-chat connection envelope.
python scripts\check_postgres_connection_budget.py --reserve 20

# Explicit rollback to the single node on port 8002.
powershell -File scripts\pm2\enable-chat-postgres.ps1 -Mode RollbackSingle
```

Notes:

- `ecosystem.chat.scale.config.js` starts `itinvent-chat-a` on `8002` and `itinvent-chat-b` on `8004`;
- each Chat instance has a unique `CHAT_REALTIME_NODE_ID`, `CHAT_REALTIME_TRANSPORT=postgres` and `CHAT_REALTIME_REQUIRED=1`;
- readiness remains HTTP `503` until the dedicated PostgreSQL `LISTEN` connection is subscribed;
- events contain only compact realtime envelopes; durable messages remain in PostgreSQL tables/outbox;
- each node has `12` pooled Chat DB connections plus three dedicated PostgreSQL connections (publisher, `LISTEN`, presence); the two-node realtime budget stays within `30`;
- `restart-chat-scale.ps1` validates the configured PostgreSQL envelope before a rollout and stops the rolling restart if fewer than 20 live connections remain free;
- exactly one `itinvent-preview-worker` (Chat, Hub tasks, mail, document flow and My Files) and one `itinvent-chat-push-worker` are shared by both API nodes;
- `itinvent-preview-worker` is the only application process that generates file-preview artifacts: Office-to-PDF documents, My Files copies, Chat image thumbnails and video posters;
- do not run the old single `itinvent-chat` or `ecosystem.backend.scale.config.js` on port `8002` at the same time;
- production activation also requires an IIS WebSocket upstream across `8002` and `8004`;
- `enable-chat-postgres.ps1` restores the original `.env` and single node automatically if either scaled node fails readiness.

IIS ARR farm staging (run from elevated PowerShell only after both Chat nodes
are ready):

```powershell
# Default is validation only. It checks both fail-closed readiness endpoints.
powershell -File scripts\iis\configure-chat-arr-farm.ps1

# Creates an applicationHost.config backup, then configures the farm.
powershell -File scripts\iis\configure-chat-arr-farm.ps1 -Mode Enable

# Use the backup name printed by the Enable command.
powershell -File scripts\iis\configure-chat-arr-farm.ps1 `
  -Mode Rollback -BackupName hubit-chat-arr-YYYYMMDD-HHMMSS
```

The `itinvent-chat` farm contains `127.0.0.1:8002` and `localhost:8004`, uses
weighted round robin, `/health/ready`, no affinity and no ARR cache. HTTP/1.1,
keep-alive and a one-hour proxy timeout preserve WebSocket connections. The
script changes only server-level `applicationHost.config`; it does not edit or
publish `web.config`. Routing the existing `Chat API Reverse Proxy` rule to
`http://itinvent-chat/api/v1/chat{R:1}` remains an explicit deployment step.

ARR reference: [Define and configure an ARR server farm](https://learn.microsoft.com/en-us/iis/extensions/configuring-application-request-routing-arr/define-and-configure-an-application-request-routing-server-farm)
and [HTTP load balancing with ARR](https://learn.microsoft.com/en-us/iis/extensions/configuring-application-request-routing-arr/http-load-balancing-using-application-request-routing).

Если backend, inventory, scan и bot разнесены по разным хостам, одной командой с одного PM2-инстанса их не поднять.
В этом случае на каждом хосте запускается только свой локальный ecosystem-файл.

Если `itinvent-backend` крутится с `↺` тысячи и в логе `WinError 10048` на порту 8001:

```powershell
powershell -File scripts\pm2\restart-backend.ps1
```

Основные команды:

```powershell
pm2 start scripts\pm2\ecosystem.backend.config.js --only itinvent-backend
pm2 restart itinvent-backend
pm2 logs itinvent-backend --lines 100
```

```powershell
powershell -File scripts\pm2\restart-chat-scale.ps1
pm2 logs itinvent-chat-a --lines 100
pm2 logs itinvent-chat-b --lines 100
```

```powershell
pm2 start scripts\pm2\ecosystem.inventory.config.js --only itinvent-inventory
pm2 restart itinvent-inventory
pm2 logs itinvent-inventory --lines 100
```

```powershell
pm2 start scripts\pm2\ecosystem.scan.config.js --only itinvent-scan
pm2 restart itinvent-scan
pm2 logs itinvent-scan --lines 100
```

```powershell
pm2 start scripts\pm2\ecosystem.bot.config.js --only itinvent-bot
pm2 restart itinvent-bot
pm2 logs itinvent-bot --lines 100
```

Для `VITE_*` переменных:

```powershell
cd WEB-itinvent\frontend
npm run build
```

Важно:

- не держите одновременно `PM2` и `NSSM/Windows Service` для одного и того же процесса;
- если менялись только backend/runtime-переменные, frontend пересобирать не нужно;
- если менялись только `VITE_*`, Python-процессы перезапускать не нужно.

## Hub notifications index (`20260804_0078`)

`idx_hub_notifications_entity` создаётся через `CREATE INDEX CONCURRENTLY` и обязателен для PostgreSQL Hub (`HubService` fail-fast). Порядок деплоя:

1. **Не обновлять / не перезапускать** `itinvent-backend` с кодом, который требует индекс, пока migration не применена и индекс не валиден.
2. Выполнить Alembic migration `20260804_0078`:
   ```powershell
   cd WEB-itinvent
   $env:SKIP_PG_SCHEMA_DOCS='1'
   python -m alembic -c backend/alembic.ini upgrade head
   ```
3. Проверить валидность индекса:
   ```sql
   SELECT c.relname, i.indisvalid, i.indisready
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   JOIN pg_index i ON i.indexrelid = c.oid
   WHERE n.nspname = 'app' AND c.relname = 'idx_hub_notifications_entity';
   ```
4. Выполнить `ANALYZE app.hub_notifications;`
5. Только затем перезапустить backend:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\pm2\restart-backend.ps1
   ```

Если concurrent build оборвался и индекс `INVALID`:

```sql
DROP INDEX CONCURRENTLY IF EXISTS app.idx_hub_notifications_entity;
```

затем повторно `alembic upgrade head`. Backend без валидного обязательного индекса не поднимать.

## Hub notifications retention worker

Отдельный процесс `itinvent-hub-notifications-retention-worker` (см. `ecosystem.backend.config.js`).

- По умолчанию: `HUB_NOTIFICATIONS_CLEANUP_ENABLED=false`, `HUB_NOTIFICATIONS_CLEANUP_DRY_RUN=true` — удаление выключено.
- Production enable — отдельный config change **после** PR3c safety gate; не стартовать worker в prod до review.
- Требует индекс `idx_hub_notifications_retention` (Alembic `20260804_0079`) + `ANALYZE`.
- Defaults: `BATCH_SIZE=50`, `BATCH_PAUSE_MS=750`, `INTERVAL_SECONDS=86400`, `STARTUP_DELAY_SECONDS=120`.
- Удаляет только **прочитанные** уведомления старше retention (chat/task/announcement отдельно); unread по умолчанию не трогает.
- HTTP `POST /hub/notifications/retention/run-once`: dry-run всегда; execute запрещён при `ENABLED=false` и ограничен `HTTP_MAX_BATCH_SIZE` (≤25).
- Не обещает уменьшение файла таблицы на диске после DELETE/VACUUM — только reuse страниц PostgreSQL.
- Dry-run / один цикл:
  ```powershell
  cd WEB-itinvent
  python start_hub_notifications_retention_worker.py --once --dry-run
  ```
