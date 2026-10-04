# Chat Backend Architecture

See [ADR-0003](../../docs/adr/0003-chat-backend-module-layout.md) for the decision record.

## Layer map

```text
api/v1/chat/*          HTTP/WS transport (thin routers)
ChatService (facade)   Lifecycle, wiring, cache invalidation hooks
Chat*Service           Domain orchestration (groups, uploads, notifications, folders, presence)
Chat*ReadStore         Read-path SQL (conversations, thread)
chat_*                 Pure helpers (constants, formatting, serialization, delivery, cache)
message_persistence    Write transactions (text/file/forward/task/system)
upload_*, attachment_media, realtime   Infra (existing)
```

## Module index

| Module | Responsibility |
|--------|----------------|
| `service.py` | Singleton facade `chat_service`; delegates to submodules |
| `chat_conversation_read_store.py` | List/summary/detail/assets/attachments reads |
| `chat_thread_read_store.py` | Messages, bootstrap, search, read receipts |
| `chat_group_service.py` | Direct/group/notes CRUD |
| `chat_membership.py` | Membership, locks, system messages, reply resolution |
| `chat_serialization.py` | `_build_*` / `_serialize_*` payloads |
| `chat_upload_orchestrator.py` | Upload sessions + `_prepare_uploads` |
| `chat_forward_materializer.py` | Forward pre-processing |
| `chat_notification_orchestrator.py` | Hub/push notification side effects |
| `chat_presence_service.py` | Presence, users map, read receipts |
| `chat_folder_service.py` | User folder CRUD |
| `chat_cache.py` | Runtime cache + request meta |
| `chat_constants.py` | Limits, MIME allowlists, mention regex |
| `chat_formatting.py` | `_iso`, previews, safe names, probes |
| `chat_delivery_state.py` | Unread counters, sender seen, conversation state |
| `realtime_publisher.py` | Publish helpers for HTTP handlers (`_common.py` re-exports) |
| `ws_commands.py` | WebSocket command dispatch (`subscribe`, `send_message`, `mark_read`, `client_state`, …) |
| `desktop_presence.py` | Distributed «HUB Desktop активен» markers for push routing |
| `link_preview_service.py` | SSRF-safe link preview fetch + OG meta parse |

## API transport layer

| Router | Role |
|--------|------|
| `api/v1/chat/ws.py` | Auth, session revalidation, rate limit, delegate to `ws_commands` |
| `api/v1/chat/link_preview.py` | Thin HTTP route → `link_preview_service` |
| `api/v1/chat/_common.py` | Re-exports from `realtime_publisher` (backward compat for tests) |

## WebSocket session and PostgreSQL relay guarantees

- A per-connection watchdog revalidates the session independently of inbound
  commands and is cancelled when the endpoint exits. Timer checks do not touch
  the session idle deadline; command checks retain their existing activity policy.
  Revoked/expired credentials close with `4401`; an unavailable validation store
  closes with `1011` so clients can reconnect without treating it as logout.
- Relay publishers take a transaction-scoped `SHARE ROW EXCLUSIVE` table lock
  before allocating relay IDs. This serializes write commits across processes,
  allowing listeners to safely advance their `id > cursor` watermark. Readers
  remain concurrent. Every relay publisher must run the updated implementation;
  mixed old publishers can still produce commit-order gaps between themselves.
  Batches amortize the lock cost; measure publish p95/p99 and throughput on an
  isolated PostgreSQL instance before sizing production capacity.
- Production publisher/presence reconnects only validate required migrated
  tables and columns. Apply the existing Chat Alembic migrations before starting
  runtime. The existing non-production schema bootstrap remains available when
  the application is explicitly configured for development.

## HUB Desktop активен — веб молчит

Решение пользователя: пока HUB Desktop пользователя активен, браузер о сообщениях чата молчит.

- **Признак.** Пользователь *desktop-активен*, если у него есть живое chat-WS-соединение от HUB
  Desktop (WebView2) и окно Desktop было в foreground последние `CHAT_DESKTOP_ACTIVE_WINDOW_SEC`
  (по умолчанию 120, минимум 60).
- **Протокол.** Desktop (`lib/chatDesktopClientState.js`, только при готовом desktop bridge)
  шлёт WS-команду `chat.client_state` `{client_kind: "desktop", foreground: bool}` при подключении,
  при смене foreground (debounce 500 мс) и каждые 40 с в foreground. Payload валидирует
  `ChatWsClientStatePayload` (strict bool, `client_kind ∈ {desktop, browser}`); команда проходит
  общий WS rate limit. Старые клиенты без команды = не Desktop.
- **Хранение между процессами.** `ChatRealtimeManager.set_desktop_client_state` держит состояние на
  соединении и (не чаще окна/4 на соединение, сразу при смене состояния) пишет маркер в общий
  presence-store текущего транспорта (`backend/chat/desktop_presence.py`):
  `postgres` — строка в существующей `chat_realtime_presence` с `connection_id = desktop:<ws id>` и
  `expires_at` = конец окна (обычные presence-чтения такие строки исключают; новая таблица и
  миграция не нужны); `redis` — hash `CHAT_DESKTOP_PRESENCE_PREFIX:<user_id>`; `local` — только
  память процесса. Disconnect удаляет маркер (запись/удаление одного соединения упорядочены),
  остановка узла чистит строки узла, crash — маркер истекает сам.
- **Push.** `ChatPushService.send_chat_message_notification` (единая точка для узлов чата и
  `itinvent-chat-push-worker`) читает `desktop_active_remaining_sec`: при desktop-активности не
  отправляет браузерный Web Push (включая @mention), FCM mobile-hub — только при
  `CHAT_PUSH_SUPPRESS_MOBILE_WHEN_DESKTOP_ACTIVE=1`. Outbox-задача получает статус `suppressed`
  (`suppressed: desktop_active`). Ошибка чтения → fail-open. Аварийное отключение:
  `CHAT_PUSH_SUPPRESS_WEB_WHEN_DESKTOP_ACTIVE=0`.
- **Вкладки.** Сокеты пользователя получают volatile-событие `chat.desktop_presence`
  `{active, expires_in_ms}` (при записи маркера, при disconnect Desktop и при подключении новой
  вкладки, если Desktop уже активен). `resolveChatMessageNotificationPlan` вне Desktop runtime
  возвращает `suppress: 'desktop_active'` без звука; счётчики и бейджи обновляются как обычно.

## Task canvas realtime

Совместная доска задачи использует существующий Chat realtime runtime и не требует отдельного процесса:

- WebSocket: `/api/v1/chat/task-canvas/ws?task_id=<id>`;
- доменная проверка доступа и валидация сцен: `backend/task_canvas/realtime.py`;
- транспорт, комнаты, bounded outbound queues и межпроцессный relay: `backend/chat/realtime.py`;
- долговременное состояние и optimistic revision остаются в Hub REST API и `hub_task_canvases`.

Комнаты имеют вид `task-canvas:<task_id>`. Протокол передаёт presence/cursor как volatile-события, а сцены объединяются на клиентах через Excalidraw reconciliation. После reconnect клиент сначала получает сохранённый snapshot, затем запрашивает актуальную сцену у участников комнаты. Если realtime недоступен, доска продолжает работать через REST-автосохранение без курсоров.

## Повтор пересылки

`POST /chat/conversations/{conversation_id}/messages/forward` принимает необязательный
`client_message_id` длиной до 128 символов. Клиент сохраняет ключ для каждого элемента
текущего пакета и повторно использует его при потере ответа; уже подтверждённые элементы
не отправляет заново. Новый намеренный пакет получает новые ключи.

Проверка участия выполняется после блокировки conversation. Повтор с тем же ключом
для того же отправителя и conversation возвращает существующее сообщение без повторных
вложений и уведомлений. Используется существующее поле и ограничение уникальности
`client_message_id`; новая миграция не требуется. Старые клиенты без ключа сохраняют
прежнее поведение пересылки.

## Regression gate

```powershell
powershell -ExecutionPolicy Bypass -File scripts/pytest-chat-backend-gate.ps1
```

## Extension rules

1. New read queries → new `Chat*ReadStore` method + thin `ChatService` wrapper.
2. New write flows → `message_persistence` or focused `Chat*Service`.
3. Do not add business logic to `api/v1/chat/*` handlers.
4. Every extract PR must pass the gate above.
