# ADR-0003: Модульная архитектура Chat backend

## Status

Accepted (2026-06-27)

## Context

`backend/chat/service.py` вырос до ~6400 LOC и совмещает transport-adjacent orchestration, read queries, serialization, membership, uploads, notifications и folders. Часть логики уже вынесена (`message_persistence`, `upload_sessions`, `attachment_media`, `notification_*`, `realtime`), но singleton `ChatService` остаётся монолитом. API-слой (`api/v1/chat/_common.py`, `ws.py`) также содержит publish/WS-протокол inline.

## Decision

### Слои

```text
api/v1/chat/*     → HTTP/WS transport (thin handlers)
ChatService       → facade / lifecycle / cache invalidation / side-effect hooks
Chat*Service      → domain write orchestration (groups, uploads, notifications, folders)
Chat*ReadStore    → read queries (conversations, thread)
chat_*            → pure modules (serialization, formatting, constants, delivery, membership)
message_persistence, upload_*, attachment_media, realtime → persistence & infra (уже есть)
```

### Именование

| Префикс | Слой | Пример |
|---------|------|--------|
| `Chat*Service` | Domain service с side effects | `ChatGroupService` |
| `Chat*ReadStore` | Read-only queries | `ChatThreadReadStore` |
| `chat_*` | Pure helpers / infra | `chat_serialization`, `chat_cache` |
| `ChatService` | Facade singleton | `chat_service` |

### Правила

1. Публичный API для внешних пакетов (`api`, `ai_chat`, `task_discussion`) — только `chat_service`, `chat_realtime`, workers.
2. `domain` не импортирует `api`.
3. Read stores принимают `ChatService` ref для cache/serialize hooks на переходный период.
4. Новые фичи — новые focused modules; не раздувать `service.py`.
5. Каждый extract-PR: characterization/regression tests + `scripts/pytest-chat-backend-gate.ps1`.

## Consequences

- `service.py` целевой размер: 800–1200 LOC (facade + lifecycle).
- `ChatConversationReadStore` и `ChatThreadReadStore` владеют read-path SQL.
- Дубли delivery helpers консолидируются в `chat_delivery_state.py`.
- API publish/WS protocol переезжает в `backend/chat/realtime_publisher.py` и `ws_commands.py`.
- Документация: `documentation/technical/CHAT_BACKEND_ARCHITECTURE.md`.
