# PM2 Runbook

Frontend остаётся на `IIS` и не переводится под `pm2 serve`.

PM2 используется только для Python-процессов:

- `scripts/pm2/ecosystem.backend.config.js`
- `scripts/pm2/ecosystem.backend.scale.config.js`
- `scripts/pm2/ecosystem.inventory.config.js`
- `scripts/pm2/ecosystem.scan.config.js`
- `scripts/pm2/ecosystem.bot.config.js`
- `scripts/pm2/ecosystem.all.config.js`
- `scripts/pm2/start-all.ps1`
- `scripts/pm2/restart-all.ps1`
- `scripts/pm2/stop-all.ps1`
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

Chat production baseline with Redis-backed realtime:

```powershell
pm2 start scripts\pm2\ecosystem.backend.config.js
powershell -File scripts\pm2\health-check.ps1
```

Expected `backend-chat-runtime` result for Redis mode:

- `mode=redis`
- `redis_configured=True`
- `redis_available=True`
- `pubsub_subscribed=True`

If `redis_configured=True`, but `mode=local_fallback`, backend is healthy, but chat realtime still works only inside the local process.

Windows / no-Redis baseline for AI chat:

- `itinvent-chat-push-worker` processes only `chat_push_outbox` (Web Push);
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

Prepared dual-node baseline for group chats and `100+` online:

```powershell
pm2 start scripts\pm2\ecosystem.backend.scale.config.js
powershell -File scripts\pm2\health-check.ps1 -BackendUrl http://127.0.0.1:8001/health -BackendSecondaryUrl http://127.0.0.1:8002/health
```

Notes:

- `ecosystem.backend.scale.config.js` starts `itinvent-backend-a` on `8001` and `itinvent-backend-b` on `8002`;
- each backend instance gets its own `CHAT_REALTIME_NODE_ID`;
- one `itinvent-chat-push-worker` stays shared and must not be duplicated per backend instance;
- for real production scale-out, place a reverse proxy/upstream in front of the backend ports.

Если backend, inventory, scan и bot разнесены по разным хостам, одной командой с одного PM2-инстанса их не поднять.
В этом случае на каждом хосте запускается только свой локальный ecosystem-файл.

Основные команды:

```powershell
pm2 start scripts\pm2\ecosystem.backend.config.js --only itinvent-backend
pm2 restart itinvent-backend
pm2 logs itinvent-backend --lines 100
```

```powershell
pm2 start scripts\pm2\ecosystem.backend.scale.config.js
pm2 restart itinvent-backend-a
pm2 restart itinvent-backend-b
pm2 restart itinvent-chat-push-worker
pm2 logs itinvent-backend-a --lines 100
pm2 logs itinvent-backend-b --lines 100
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
