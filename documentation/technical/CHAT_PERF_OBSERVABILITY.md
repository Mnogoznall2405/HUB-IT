# Chat — observability и go/no-go для perf (волна 3)

## Источники метрик

| Источник | Что смотреть |
|----------|--------------|
| `GET /api/v1/chat/health` | `route_metrics`, `read_cache_metrics`, pool/outbox/realtime |
| Логи `backend.chat.api` | `chat.thread_bootstrap took_ms=... cache_hit=...` |
| `scripts/chat/chat_perf_snapshot.ps1` | Снимок health + чеклист go/no-go |

### `route_metrics` (per route)

- `count` — число замеров в окне (до 512 samples per route)
- `avg_ms`, `p95_ms` — latency
- `cache_hits`, `cache_misses`, `cache_hit_rate_pct` — hit rate in-process + Redis read cache path

Ключевые routes: `thread_bootstrap`, `conversations`, `messages`, `thread_hydrate`, `send_message`.

### `read_cache_metrics`

- `available` — Redis read cache активен (REDIS_URL + shared buckets)
- `hits`, `misses`, `errors` — Redis layer stats

## Сбор в production (PR-A)

1. 1–2 недели периодически запускать `scripts/chat/chat_perf_snapshot.ps1` или смотреть health вручную.
2. Сохранять снимки при пиковой нагрузке (утро, после деплоя).
3. Коррелировать с PM2 worker count (multi-worker снижает in-process hit rate).

## Go / No-go чеклист

### Redis read cache (PR-C)

| Сигнал | Go | No-go |
|--------|-----|-------|
| `cache_hit_rate_pct` на `thread_bootstrap` / `conversations` стабильно &lt; 20% при 2+ PM2 workers | Включить/держать Redis layer | Не нужен — hit rate уже высокий |
| p95 растёт, cache_hit низкий, RPS стабильный | Redis + TTL tuning | — |
| Redis недоступен часто (`read_cache_metrics.errors` растёт) | Чинить Redis, fallback in-process OK | — |

### `CHAT_DB_POOL_SIZE` (PR-B)

| Сигнал | Go | No-go |
|--------|-----|-------|
| Логи pool wait / threadpool saturation | Увеличить pool (см. runbook ниже) | Не трогать без evidence |
| p95 SQL routes растёт, CPU DB низкий, connections idle | Pool не bottleneck | — |
| p95 растёт, DB connections maxed | Увеличить pool + max_overflow | — |

### Lightweight hydrate (PR-D)

| Сигнал | Go | No-go |
|--------|-----|-------|
| UX: нет галочек прочтения / реакций после bootstrap | Уже: `GET .../messages/hydrate` | — |
| `thread_hydrate` p95 &gt; 200ms при малом batch | Оптимизировать batch size | — |

## `CHAT_DB_POOL_SIZE` runbook (PR-B)

**Дефолт:** `5` (`CHAT_DB_MAX_OVERFLOW` default `10`).

**Где задано:** корневой `.env`, admin settings (`env_settings_service`).

**Как менять:**

1. Подтвердить bottleneck по метрикам (см. чеклист выше).
2. Увеличать шагами: `5 → 8 → 12` (не выше `workers × expected concurrent chat calls`).
3. После изменения: `scripts/pm2/restart-backend.ps1`, 24h наблюдение `route_metrics`.
4. Зафиксировать выбранное значение в комментарии `.env` на сервере.

**Формула ориентир:** `pool_size ≈ PM2_workers × 2` для chat-heavy нагрузки, но не более лимита PostgreSQL `max_connections`.

## Ops после изменений

```powershell
powershell -ExecutionPolicy Bypass -File scripts\pytest-chat-backend-gate.ps1
powershell -ExecutionPolicy Bypass -File scripts\pm2\restart-backend.ps1
powershell -ExecutionPolicy Bypass -File scripts\iis\publish_frontend_iis.ps1
```

## Связанные документы

- [CHAT_BACKEND_ARCHITECTURE.md](./CHAT_BACKEND_ARCHITECTURE.md)
- [POSTGRES_CHAT_WINDOWS_SETUP.md](./POSTGRES_CHAT_WINDOWS_SETUP.md)
