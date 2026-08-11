# Hub + Chat Session Load Test

## Goal

Проверить, где система начинает «висеть» при многих одновременных онлайн-сессиях:

- Hub HTTP (`dashboard`, `tasks`, `notifications/poll`, unread counts)
- Chat HTTP (`conversations`, `thread-bootstrap`, `messages`)
- Chat WebSocket (долгое соединение, subscribe, ping, опционально send)

Базовый целевой профиль: **50 virtual users**, затем 100+.

## Prerequisites

1. Staging / отдельный backend, не production без явного ок.
2. PostgreSQL app + chat DB (не SQLite fallback).
3. Зависимости клиента нагрузки: `httpx`, `websockets` (есть через backend/`uvicorn[standard]`).
4. Админ с правом `settings.users.manage` для сидера учёток.
5. Желательно Redis для realtime (`realtime_mode=redis` в `/api/v1/chat/health`).

## 1) Seed test users

Создаёт `loadtest01..loadtestN`, общий group chat и пишет credentials в `tmp/` (gitignored).

На сервере приложения предпочтительно `--direct` (без LDAP/admin API login):

```powershell
python scripts/seed_hub_chat_loadtest_users.py `
  --direct `
  --count 50 `
  --prefix loadtest `
  --password "LoadTest!2026" `
  --out tmp/hub-chat-load-users.json `
  --meta-out tmp/hub-chat-load-meta.json
```

Через admin API (нужен local admin или LDAP-учётка, которая реально логинится):

```powershell
python scripts/seed_hub_chat_loadtest_users.py `
  --api-base http://127.0.0.1:8001/api/v1 `
  --admin-username admin `
  --admin-password <ADMIN_PASSWORD> `
  --count 50 `
  --out tmp/hub-chat-load-users.json `
  --meta-out tmp/hub-chat-load-meta.json
```

Для 100 пользователей добавьте `--count 100`.

Пример формата (без сидера): `scripts/fixtures/hub-chat-load-users.example.json`.

Сидер печатает `conversation_id` — передайте его в load-тест.

## 1b) Seed Hub tasks for those users

Чтобы `/hub/dashboard` и `/hub/tasks` грузили непустые списки:

```powershell
python scripts/seed_hub_chat_loadtest_tasks.py `
  --direct `
  --meta tmp/hub-chat-load-meta.json `
  --tasks-per-user 10 `
  --replace
```

Скрипт создаёт задачи с префиксом `LoadTest ` (assignee/creator/observer, разные статусы и due dates).  
`--replace` удаляет прошлые LoadTest-задачи перед повторным сидом.

## 2) Run 50 VU (read-mostly + WS hold)

```powershell
$meta = Get-Content tmp/hub-chat-load-meta.json -Raw | ConvertFrom-Json

python scripts/loadtest_hub_chat_sessions.py `
  --api-base http://127.0.0.1:8001/api/v1 `
  --users-file tmp/hub-chat-load-users.json `
  --virtual-users 50 `
  --duration-sec 900 `
  --think-time-sec 2.5 `
  --conversation-id $meta.conversation_id `
  --report-json tmp/hub-chat-load-report-50.json
```

## 3) Scale up

```powershell
python scripts/loadtest_hub_chat_sessions.py `
  --api-base http://127.0.0.1:8001/api/v1 `
  --users-file tmp/hub-chat-load-users.json `
  --virtual-users 100 `
  --duration-sec 900 `
  --think-time-sec 2.5 `
  --conversation-id $meta.conversation_id `
  --report-json tmp/hub-chat-load-report-100.json
```

## 4) Optional writes (group + DM)

Сначала засидьте личные диалоги:

```powershell
python scripts/seed_hub_chat_loadtest_dms.py `
  --direct `
  --meta tmp/hub-chat-load-meta.json `
  --pairing adjacent `
  --seed-messages 2
```

Только на staging. Включает WS `send_message` в группу и DM + HTTP mark-read
у ролей `active_chat` / `busy_hub`:

```powershell
python scripts/loadtest_hub_chat_sessions.py `
  --api-base http://127.0.0.1:8001/api/v1 `
  --users-file tmp/hub-chat-load-users.json `
  --meta-file tmp/hub-chat-load-meta.json `
  --virtual-users 50 `
  --duration-sec 600 `
  --enable-writes `
  --write-targets both `
  --auto-rss `
  --report-json tmp/hub-chat-load-report-50-writes.json
```

`--write-targets`: `group` | `dm` | `both`.

## VU roles

Распределение по `worker_id % 10`:

| Role | Share | Behavior |
|------|-------|----------|
| `busy_hub` | ~10% | dashboard + tasks + unread + poll + chat list/bootstrap |
| `active_chat` | ~30% | chat list/bootstrap/messages + WS subscribe (+ writes if enabled) |
| `idle` | ~60% | держит WS, лёгкий hub/chat poll |

## Scenario per VU

1. `POST /auth/login`
2. WebSocket connect `/chat/ws` + `chat.subscribe_inbox`
3. Loop:
   - Hub: dashboard / tasks / unread / notifications poll
   - Chat HTTP: conversations (+ thread bootstrap/messages for active roles)
   - WS: subscribe conversation, periodic `chat.ping`, optional send
4. Think-time между циклами

## What to watch / куда смотреть после прогона

Скрипт сам пишет два артефакта:

| Файл | Что внутри |
|------|------------|
| `tmp/hub-chat-load-report-*.json` | timings, SLO, `slow_samples` (с `correlation_id`), `error_by_stage`, `server_metrics`, `chat_health`, `diagnosis` |
| `tmp/hub-chat-load-report-*.json.diagnosis.md` | человекочитаемый разбор: bottlenecks, hotspots, pools, likely causes |

В конце прогона в консоли блок **Diagnosis (куда смотреть)**.

```powershell
# Быстрый chat snapshot во время/после прогона
powershell -ExecutionPolicy Bypass -File scripts\chat\chat_perf_snapshot.ps1

# Server-side HTTP metrics (только loopback, если REQUEST_METRICS_LOCALHOST_OPEN=1)
Invoke-RestMethod http://127.0.0.1:8001/api/v1/system/request-metrics/local?limit=50"&"sort_by=p95_ms |
  ConvertTo-Json -Depth 6

# Медленные запросы backend по correlation_id из diagnosis
Select-String -Path "$env:USERPROFILE\.pm2\logs\itinvent-backend-error.log" -Pattern 'http.slow'
```

Рекомендуемый smoke с диагностикой:

```powershell
$meta = Get-Content tmp/hub-chat-load-meta.json -Raw | ConvertFrom-Json
python scripts/loadtest_hub_chat_sessions.py `
  --api-base http://127.0.0.1:8001/api/v1 `
  --users-file tmp/hub-chat-load-users.json `
  --virtual-users 50 `
  --duration-sec 180 `
  --auto-rss `
  --slow-sample-ms 800 `
  --conversation-id $meta.conversation_id `
  --report-json tmp/hub-chat-load-report-50-diag.json
```

Откройте `tmp/hub-chat-load-report-50-diag.json.diagnosis.md` — там ranked client stages + server hotspots.

Смотреть:

- client bottlenecks в `.diagnosis.md` (какой stage реально тормозит)
- `GET /api/v1/system/request-metrics/local` → `hotspots`, `pools.app/chat`
- `GET /api/v1/chat/health` → `local_connection_count`, `realtime_mode`, `route_metrics` p95
- `slow_samples[].correlation_id` → строка `http.slow ... correlation_id=...` в PM2 error log
- backend RSS (`--auto-rss` или `--rss-pid <pid>`)
- reconnect storm в отчёте (`ws.reconnects`)

## Expected SLO (baseline)

Скрипт печатает PASS/FAIL:

- error rate `< 1%`
- hub dashboard/tasks p95 `<= 2.0s`
- chat conversations p95 `<= 1.5s`
- thread bootstrap p95 `<= 2.0s`
- WS connect p95 `<= 3.0s`
- WS ping p95 `<= 1.0s`
- при `--enable-writes`: send p95 `<= 2.5s`
- RSS не должен расти непрерывно (`growth <= 256 MB` за прогон)

## Likely hang points

1. `CHAT_DB_POOL_SIZE` saturation  
2. WS fan-out в общем треде без Redis / при multi-worker  
3. reconnect + HTTP poll storm после массовых disconnect  
4. PG `max_connections` (app + chat pools × workers)  
5. IIS/proxy idle timeout на WebSocket  

## Notes

- Учётки должны быть `auth_source=local` и проходить password-only login.
- При политике `TWOFA_POLICY=external_only` скрипт по умолчанию шлёт `X-Forwarded-For: 10.10.20.50`
  (localhost считается trusted proxy → зона `internal` → без 2FA). Переопределение: `--client-ip`.
- Для `http://` логина скрипт использует `X-Auth-Client: mobile`, чтобы получить Bearer token в JSON
  (web-cookies помечены `Secure` и не уходят по plain HTTP).
- Role `viewer` уже имеет `chat.read` / `chat.write` / `tasks.read` / `dashboard.read`.
- Сначала 50 VU read-mostly, потом 100, потом writes.
- Не коммитьте `tmp/hub-chat-load-users.json` с реальными паролями.
- LDAP-админ для API-сидера не обязателен: используйте `--direct` на app-сервере.
- Наблюдение с 50 VU / 3 мин (smoke): error rate ~1% на стартовом login/WS storm;
  `hub/dashboard` и `thread-bootstrap` p95 уходят в ~5s — первые кандидаты на узкое место.
