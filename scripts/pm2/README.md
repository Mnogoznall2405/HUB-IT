# PM2 Runbook

Frontend остаётся на `IIS` и не переводится под `pm2 serve`.

Команды ниже могут менять production-состояние. Выполнять их только после явного разрешения, read-only проверки точной цели, фиксации ожидаемого эффекта и подготовки rollback/post-check. Команды с `-Mode Enable*`, restart/stop/start и изменением `.env`/IIS особенно нельзя запускать «для проверки».

PM2 используется только для Python-процессов:

- `scripts/pm2/ecosystem.backend.config.js`
- `scripts/pm2/ecosystem.backend.scale.config.js`
- `scripts/pm2/ecosystem.chat.scale.config.js` — два Chat API с PostgreSQL realtime
- `scripts/pm2/ecosystem.inventory.config.js`
- `scripts/pm2/ecosystem.scan.config.js`
- `scripts/pm2/ecosystem.bot.config.js`
- `scripts/pm2/ecosystem.all.config.js`
- `scripts/pm2/restart-backend.ps1` — штатный рестарт backend (+ безопасный reload scan)
- `scripts/pm2/restart-my-files-worker.ps1` — отдельный restart `itinvent-my-files-worker` после проверки отсутствия недавней обработки файлов; `-WhatIf` выполняет только preflight. Нужен при изменении общего файлового сервиса, в том числе учёта/очистки архивов ONLYOFFICE; другие процессы не перезапускает.
- `scripts/pm2/enable-chat-postgres.ps1` — валидация, включение и откат двух Chat-узлов
- `scripts/pm2/restart-chat-scale.ps1` — последовательный restart уже включённых Chat-узлов
- `scripts/pm2/restart-scan.ps1` — **stop + orphan cleanup + start** для scan (не голый `pm2 restart`)
- `scripts/pm2/clear-pm2-orphans.ps1` — зачистка orphan python после `pm2 kill`/`stop` на Windows
- `scripts/pm2/start-all.ps1` / `restart-all.ps1` / `stop-all.ps1` — вызывают orphan cleanup
- `scripts/pm2/health-check.ps1`
- `scripts/pm2/pm2-boot-resurrect.ps1` — восстановление сохранённого списка процессов после перезагрузки сервера
- `scripts/pm2/register-pm2-autostart.ps1` — регистрация/снятие задачи планировщика `HUB-IT PM2 Autostart`

Если основные ecosystem-контуры backend, inventory, scan и bot запускаются на одной машине, их можно стартовать одной командой:

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

Автозапуск при перезагрузке сервера:

```powershell
# Только проверка состояния задачи, ничего не меняет.
powershell -File scripts\pm2\register-pm2-autostart.ps1

# Регистрация (идемпотентно, можно повторять для обновления задачи).
powershell -File scripts\pm2\register-pm2-autostart.ps1 -Mode Enable
```

Задача `HUB-IT PM2 Autostart` срабатывает `AtStartup` от учётной записи, под которой её
зарегистрировали, с `LogonType S4U` — то есть без интерактивного входа и без хранения
пароля. Действие — `pm2-boot-resurrect.ps1` (идемпотентен, можно запускать вручную в любой момент):

1. явно задаёт `PM2_HOME=<профиль>\.pm2` — у S4U нет `HOMEPATH`, и без этого PM2 уходит в пустой `C:\etc\.pm2`;
2. пауза 30 с, затем `pm2 resurrect` по `dump.pm2`, если ни один процесс не online;
3. **дозапускает из `ecosystem.all.config.js` всё, чего нет в PM2** (устаревший или отсутствующий dump не приводит к «пустому» хабу);
4. staged-старт тяжёлых воркеров после готовности chat-нод;
5. если все ожидаемые процессы online — `pm2 save`, иначе exit 1, и планировщик повторяет задачу (RestartCount 2 / 2 мин).

Результат — `scripts\pm2\_boot_resurrect.log` (предыдущий запуск — `_boot_resurrect.prev.log`).

- **Пулы PostgreSQL задаются в одном месте — `scripts/pm2/db-pools.js`.** Размеры `APP_DB_*`/`CHAT_DB_*` процессов нельзя писать в `ecosystem.*.config.js` (тест `test_pool_sizes_are_defined_only_in_db_pools_js` это ловит): конфиги берут их через `dbPool(name)`, а `postgres_connection_budget.js` и `scripts/check_postgres_connection_budget.py` считают потолок по тому же файлу, запас `RESERVE` тоже там. `max_connections` в репозитории не хранится: он на DB-06 (сейчас 300 в `/etc/postgresql/16/main/conf.d/hubit.conf`, значение 100 в `postgresql.conf` перекрыто), живое значение читает `python scripts\check_postgres_connection_budget.py`. После правки чисел запускать его: `projected_ok` должен остаться `True`.
- **Источник истины автозапуска — `ecosystem.all.config.js`.** Новый постоянный процесс добавлять в один из подключённых в него ecosystem-файлов (backend/inventory/scan/voice/bot/chat.scale). Процессы, запускаемые отдельным конфигом (например `itinvent-ai-sandbox-control`), попадают в автозапуск только через `dump.pm2`: после их старта обязателен `pm2 save`.
- `register-pm2-autostart.ps1 -Mode Enable` также отключает устаревшую SYSTEM-задачу `HUB-IT PM2 resurrect` (`resurrect-if-empty.ps1`): она конкурирует за `\\.\pipe\rpc.sock` и стартовала бы процессы от SYSTEM.
- Отключение без удаления: `register-pm2-autostart.ps1 -Mode Disable`; полный откат — `-Mode Remove`.
- Post-check после реальной перезагрузки: `pm2 list`, `scripts\pm2\_boot_resurrect.log`, `health-check.ps1`.
- **Сторож `HUB-IT PM2 Watchdog`** (`pm2-watchdog.ps1`, регистрация — `register-pm2-watchdog.ps1 -Mode Enable|Disable|Remove|Status`): каждые 3 мин (S4U, `-Hidden`, окно консоли не появляется) проверяет `pm2 jlist`; если ни один процесс не online (демон убит или поднялся пустым, например при обновлении приложения, из чьей сессии его запускали), вызывает `pm2-boot-resurrect.ps1 -DelaySeconds 0`. Первые 10 мин после загрузки не вмешивается, при нечитаемом `jlist` ничего не делает. Лог — `scripts\pm2\_watchdog.log`. Рестарты PM2 запускать не из терминала Claude/IDE, а через планировщик, иначе демон привязан к этой сессии.
- **Замирание ВМ (host stall).** Если сторож не запускался `-StallGapSeconds` (240 с) и больше, ВМ/хранилище было заморожено: ошибки health сразу после этого считаются последствием, счётчики сбрасываются, а восстановление откладывается на `-StallGraceMinutes` (3 мин). Запуски, поставленные планировщиком в очередь на время заморозки и сработавшие раньше `-BurstGapSeconds` (20 с) после предыдущего, в счётчики не входят. Если не online ни одного процесса, это реальная авария, и восстановление идёт по обычным правилам. Решение принимает `Get-HubitProbeClassification` (`runtime-operations.ps1`); в `_watchdog.log` ищите `host stall detected` и `health failures not counted`.
- Ограничение S4U: процессы не смогут обращаться к сетевым ресурсам под учётными данными пользователя (UNC-шары, интегрированная Windows-аутентификация). Текущие сервисы используют явные UID/PWD — подходит. Если понадобятся такие ресурсы — пересоздать задачу с хранением пароля (`schtasks /create /ru ... /rp ...`).

Chat production baseline — **dual node** (`itinvent-chat-a` на `8002` +
`itinvent-chat-b` на `8004`, PostgreSQL realtime, IIS ферма `itinvent-chat`).
Это фактическое production-состояние с 2026-09-23:

```powershell
powershell -File scripts\pm2\health-check.ps1   # проверяет оба узла и ферму ARR
powershell -File scripts\pm2\restart-chat-scale.ps1  # единственный штатный рестарт чата
```

Режим определяется автоматически: `CHAT_REALTIME_TRANSPORT=postgres` в `.env` +
наличие `ecosystem.chat.scale.config.js` → dual (`chat-runtime-mode.ps1`).
`ecosystem.all.config.js` сам подменяет `itinvent-chat` парой узлов, а
`start-all.ps1` / `restart-all.ps1` / `stop-all.ps1` работают со списком процессов
по режиму; `-ChatMode single|dual` — принудительно, `-WhatIf` — печать плана без
выполнения. `restart-chat.ps1` в dual-режиме отказывает — использовать
`restart-chat-scale.ps1`.

Устаревший single-node вариант (rollback после `enable-chat-postgres.ps1 -Mode RollbackSingle`):

```powershell
pm2 start scripts\pm2\ecosystem.backend.config.js
powershell -File scripts\pm2\health-check.ps1
```

The single `itinvent-chat` process owns port `8002`. Local realtime is safe only
while one Chat API node is running; do not put two local-mode nodes behind IIS.

Windows / no-Redis baseline for AI chat:

- `itinvent-chat-push-worker` processes only `chat_push_outbox` (Web Push);
- `itinvent-mail-notification-worker` polls mail notifications once per cluster and sends them through the shared Web Push subscription table;
- `itinvent-monitoring-worker` is the only owner of the network monitoring ICMP/SNMP loop (`start_monitoring_worker.py`, `MONITORING_BACKGROUND_ENABLED=1`, retention flag stays there); `itinvent-backend` runs with `MONITORING_BACKGROUND_ENABLED=0` and `MONITORING_WORKER_EXTERNAL=1`, so probing no longer blocks the API event loop. Restart it with `restart-monitoring-worker.ps1` after changes in `network_monitor_*.py` (a backend restart does not restart it); it is also in `ecosystem.all.config.js` (autostart), `start-all/restart-all/stop-all`, the watchdog worker set, boot staging and `health-check.ps1`. A second copy stays idle: the DB advisory lease allows one owner;
- cross-process AI realtime uses DB-backed `chat_event_outbox` dispatched by `itinvent-backend`;
- `backend-chat-runtime` is healthy in local mode only when `event_dispatcher_active=True`, even if Redis is not configured;
- if `event_dispatcher_active=False`, websocket delivery for AI and degraded cross-process chat realtime must be treated as broken.

AI chat worker:

```powershell
pm2 start scripts\pm2\ecosystem.backend.config.js --only itinvent-ai-chat-worker
powershell -File scripts\pm2\restart-ai-agents.ps1 -ChatWorkerOnly
pm2 logs itinvent-ai-chat-worker --lines 100
powershell -File scripts\pm2\health-check.ps1
```

Notes for AI runtime:

- `itinvent-ai-chat-worker` now claims runs atomically, so accidental duplicate workers must not process the same run twice;
- recommended starting point is one `itinvent-ai-chat-worker` process with `AI_CHAT_WORKER_CONCURRENCY=2`;
- restart `itinvent-ai-chat-worker` after OpenRouter or AI-bot config changes;
- `restart-ai-agents.ps1 -ChatWorkerOnly` restarts only the normal AI worker, verifies that its old PID exited, and leaves sandbox control running; without this switch the script restarts both AI processes;
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
- restart чата — только `restart-chat-scale.ps1`; `restart-chat.ps1` и `pm2 restart itinvent-chat*` в dual-режиме не использовать (скрипт откажет);
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
powershell -File scripts\pm2\restart-backend.ps1
pm2 logs itinvent-backend --lines 100
```

Прямой PM2-restart backend-процесса на Windows не использовать: безопасный lifecycle и проверка readiness находятся в `restart-backend.ps1`.

```powershell
powershell -File scripts\pm2\restart-chat-scale.ps1
pm2 logs itinvent-chat-a --lines 100
pm2 logs itinvent-chat-b --lines 100
```

```powershell
# первый старт; рестарт — pm2 stop + clear-pm2-orphans.ps1 + pm2 start (отдельного restart-скрипта нет)
pm2 start scripts\pm2\ecosystem.inventory.config.js --only itinvent-inventory
pm2 logs itinvent-inventory --lines 100
```

```powershell
powershell -File scripts\pm2\restart-scan.ps1   # stop + чистка сирот + start; голый pm2 restart не использовать
pm2 logs itinvent-scan --lines 100
```

```powershell
# первый старт; рестарт — pm2 stop itinvent-bot + clear-pm2-orphans.ps1 + pm2 start (отдельного restart-скрипта нет)
pm2 start scripts\pm2\ecosystem.bot.config.js --only itinvent-bot
pm2 logs itinvent-bot --lines 100
```

LiveKit (звонки чата, опционально):

- `scripts/pm2/ecosystem.livekit.config.js` описывает процесс `itinvent-livekit` (`tools/livekit/livekit-server.exe --config scripts/livekit/livekit.yaml`) и подключён в `ecosystem.all.config.js`. Процесс включается в ecosystem только если на хосте есть и бинарник, и боевой `scripts/livekit/livekit.yaml` (gitignored, создаётся из `livekit.example.yaml` с реальным ключом/секретом) — иначе `start-all.ps1` и `pm2-boot-resurrect.ps1` его не ждут.
- Отдельный старт: `pm2 start scripts\pm2\ecosystem.livekit.config.js`, затем `pm2 save`; откат: `pm2 delete itinvent-livekit; pm2 save`.
- `health-check.ps1` проверяет процесс и порт `7880` мягко (`warn`, не `fail`): звонки выключены по умолчанию. `pm2-boot-resurrect.ps1` не менялся — процесс лёгкий и не входит в staged-список тяжёлых воркеров.
- Полный порядок (файрвол, IIS `/livekit`, `.env`, откат и post-check) — [CHAT_CALLS_LIVEKIT.md](../../documentation/technical/CHAT_CALLS_LIVEKIT.md#развёртывание). Выполнять только по явному разрешению.

Для `VITE_*` переменных:

```powershell
cd WEB-itinvent\frontend
npm run build
```

Важно:

- не держите одновременно `PM2` и `NSSM/Windows Service` для одного и того же процесса;
- если менялись только backend/runtime-переменные, frontend пересобирать не нужно;
- если менялись только `VITE_*`, Python-процессы перезапускать не нужно.

## Миграции БД при релизе

Процессы production **не применяют** Alembic-миграции при старте (`appdb/db.py::_initialize_app_schema_uncached`, `chat/db.py::initialize_chat_schema` только сверяют версию). Если `system.alembic_version` отстаёт от head кода или неизвестна коду, процесс стартует и пишет в лог предупреждение:

```
schema_migration_check stage=schema_migration_check scope=<app|chat> status=<behind|unknown_revision|unreadable> current=<версия БД> expected=<head кода> action=apply_migrations_manually_at_release
```

Применение — отдельный шаг релиза, до перезапуска процессов с кодом, которому нужна схема:

1. Сверить версию БД и head кода (только чтение): `SELECT version_num FROM system.alembic_version;` и `python -m alembic -c backend/alembic.ini heads` (с `ALEMBIC_DATABASE_URL`).
2. Проверить фактическую схему chat (`chat.*` или legacy `public.chat_*`), объём, индексы, блокировки (см. AGENTS.md, «PostgreSQL»).
3. Выполнить явной командой, URL целевой БД задаётся явно:
   ```powershell
   cd WEB-itinvent
   $env:SKIP_PG_SCHEMA_DOCS='1'
   $env:ALEMBIC_DATABASE_URL = '<url целевой БД>'
   python -m alembic -c backend/alembic.ini upgrade head
   ```
4. Проверить `SELECT version_num FROM system.alembic_version;` и наличие объектов новых миграций.
5. Перезапустить процессы штатными скриптами (`restart-backend.ps1`, `restart-chat.ps1`); в логах не должно быть `schema_migration_check`.

Откат: `python -m alembic -c backend/alembic.ini downgrade <предыдущая версия>` — только после проверки, что `downgrade` миграции безопасен для данных. Миграция `20261002_0125` создаёт `chat_scheduled_messages`, если её нет (версия `0124` могла быть записана без таблицы); её `downgrade` ничего не удаляет. Миграция `20261020_0139` создаёт, если их нет, восемь таблиц app-схемы (`employee_absences`, `ai_bots`, `ai_bot_conversations`, `ai_bot_runs`, `ai_pending_actions`, `ai_kb_documents`, `ai_kb_chunks`, `transfer_act_jobs`) и недостающие индексы; существующие таблицы и данные не трогает, `downgrade` — намеренно no-op. Миграция `20261020_0140` добавляет недостающие в боевой БД индексы (`chat_members`, `chat_messages`, `ai_bots`) и unique на `chat_message_reactions`/`ai_user_memories` (unique — только если нет дубликатов). `APP_SCHEMA_DEV_AUTO_CREATE` по умолчанию `0`: без явной `1` старт не выполняет DDL.

## Hub notifications index (`20260804_0078`)

`idx_hub_notifications_entity` создаётся через `CREATE INDEX CONCURRENTLY` и обязателен для PostgreSQL Hub (`HubService` fail-fast). Порядок деплоя:

1. **Не обновлять / не перезапускать** `itinvent-backend` с кодом, который требует индекс, пока migration не применена и индекс не валиден.
2. Выполнить Alembic migration `20260804_0078`:
   ```powershell
   cd WEB-itinvent
   $env:SKIP_PG_SCHEMA_DOCS='1'
   # URL целевой БД задаётся явно: корневой .env alembic не читает
   $env:ALEMBIC_DATABASE_URL = $env:APP_DATABASE_URL
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

## Защита автозапуска и восстановление после зависания (2026-10-07)

- Ecosystem, окружение работающих процессов и `dump.pm2` проверяются на совпадение APP/CHAT pool-настроек. Boot применяет расхождения чат-узлов через rolling restart; расхождения остальных процессов требуют их штатной процедуры. `pm2 save` выполняется после readiness и проверки окружения. Нечитаемый PM2, пустой список приложений и неготовые API завершаются с кодом 1.
- При `APP_SCHEMA_DEV_AUTO_CREATE=0` PostgreSQL Chat, как и APP, только проверяет схему при старте даже с `APP_ENV=development`. В production проверка выполняется до любых legacy/public create-хелперов. SQLite/dev-fixtures и явные миграции сохраняют своё поведение.
- `pm2-watchdog.ps1 -CheckOnly` выполняет read-only проверку online/readiness/config. Задача проверяет раз в минуту; восстановление после 3 последовательных отказов (для online-узла чата `itinvent-chat`/`-a`/`-b` — после 6, параметр `-ChatFailureThreshold`: паузы хоста по 2–4 мин проходят сами, а рестарт посреди паузы добавляет второй простой), не чаще раза в 10 минут и максимум 2 раза за час на процесс. Boot/watchdog/rolling restart используют общий mutex. Backend recovery по штатному runbook также перезапускает Scan.
- Осиротевшие процессы. Если демон PM2 умер, не завершив детей (12.10.2026), их воркеры держат порты и singleton-локи, а копии нового демона падают в crash-loop. `pm2-watchdog.ps1` находит такие процессы: командная строка совпадает с `script`+`args` приложения из ecosystem, PID не принадлежит PM2, родитель мёртв (или PID родителя переиспользован). Каждое обнаружение пишется как `orphan detected` в `_watchdog.log`, список виден в `-CheckOnly` (`Orphans`). Остановка включена по умолчанию (с 12.10.2026): процесс снимается через `taskkill /T /F` (запись `orphan stopped`), если он виден дольше `-OrphanMinAgeMinutes` (6), PM2 держит запись об этом приложении и online-процессов не ноль; не больше одного за запуск. Режим «только отчёт»: переключатель `-ReportOnlyOrphans` или `HUBIT_WATCHDOG_STOP_ORPHANS=0`.
- Перед ремонтом сохраняется ограниченный снимок HTTP, pool/event-loop метрик, SQL-сессий/блокировок без текста запросов и диска: `output/pm2-incidents/*.json`. Ручной снимок: `python scripts/pm2/capture-runtime-diagnostics.py --output output/pm2-incidents/manual.json`. Это не заменяет метрики ESXi CPU Ready/datastore или Python stack trace в момент зависания.
- `restart-chat-scale.ps1 -NodeName itinvent-chat-a -SkipSharedWorkers` ремонтирует один узел. Узел возвращается в ARR только после readiness; при отказе остаётся отключённым. После исправления повторить ту же процедуру. Не включать неготовый узел вручную.
- APP/auth каждого dual chat-узла: `10 + 5`; chat write `6 + 1`, read `5`, realtime до `3`. Максимум двух узлов 60 соединений. Общий budget checker считает явные APP/CHAT-профили из действующего ecosystem и текущие подключения всех БД сервера; дополнительные контуры учитываются по текущему использованию. Полного максимума всех необъявленных пулов он не гарантирует.
- Session policy: dry-run `python scripts/pm2/postgres-session-policy.py`. Применение после согласования: `--apply --backup output/pm2-incidents/session-policy-before.json`; откат `--restore output/pm2-incidents/session-policy-before.json`. Меняются только defaults текущей роли в конкретной БД: TCP keepalive `60/15/4`, `idle_in_transaction_session_timeout=300000` (5 минут). Политика действует на новые подключения; обычные idle-соединения не закрываются. Существующие соединения получают её после переподключения/ротации пула. Для старых TCP-сессий политика не применяется задним числом. Незавершённая транзакция, простаивающая 5 минут, будет отменена; не держать внешние вызовы внутри транзакций.

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

## Ротация логов PM2

PM2 не ротирует логи сам (`pm2-logrotate` не установлен). Задача планировщика `HUB-IT PM2 Log Rotate` раз в сутки (04:30)
запускает `rotate-logs.ps1`: лог крупнее 200 МБ сжимается в `%USERPROFILE%\.pm2\logs\archive\*.gz` и обнуляется
(copytruncate, процессы не перезапускаются; строки, записанные за время сжатия, теряются). Архивы старше 14 дней удаляются.
Проверка без изменений: `powershell -File scripts\pm2\rotate-logs.ps1 -DryRun`.
