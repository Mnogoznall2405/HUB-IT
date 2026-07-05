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
| `ws_commands.py` | WebSocket command dispatch (`subscribe`, `send_message`, `mark_read`, …) |
| `link_preview_service.py` | SSRF-safe link preview fetch + OG meta parse |

## API transport layer

| Router | Role |
|--------|------|
| `api/v1/chat/ws.py` | Auth, session revalidation, rate limit, delegate to `ws_commands` |
| `api/v1/chat/link_preview.py` | Thin HTTP route → `link_preview_service` |
| `api/v1/chat/_common.py` | Re-exports from `realtime_publisher` (backward compat for tests) |

## Regression gate

```powershell
powershell -ExecutionPolicy Bypass -File scripts/pytest-chat-backend-gate.ps1
```

## Extension rules

1. New read queries → new `Chat*ReadStore` method + thin `ChatService` wrapper.
2. New write flows → `message_persistence` or focused `Chat*Service`.
3. Do not add business logic to `api/v1/chat/*` handlers.
4. Every extract PR must pass the gate above.
