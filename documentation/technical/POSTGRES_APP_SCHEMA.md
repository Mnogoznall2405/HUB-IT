# PostgreSQL — App runtime store (HUB-IT)

Справочник по **собственной** БД платформы HUB-IT (`APP_DATABASE_URL`; в `.env` часто `APP_DATABASE_URL=${CHAT_DATABASE_URL}`).  
Это **не** **Equipment catalog (ITINVENT)** (SQL Server). Scan Center runtime — отдельный URL `SCAN_DATABASE_URL` / schema `scan` (см. [SCAN_POSTGRES_MIGRATION.md](./SCAN_POSTGRES_MIGRATION.md)); legacy fallback — SQLite.

**Язык домена:** [CONTEXT.md](../../CONTEXT.md)  
**Колонки, PK, FK, индексы (live):** [POSTGRES_APP_SCHEMA_DDL.md](./POSTGRES_APP_SCHEMA_DDL.md)  
**Миграции:** `WEB-itinvent/backend/alembic/versions/`  
**Модели:** `WEB-itinvent/backend/appdb/models.py`, `tickets_models.py`, `chat/models.py`

Секции ниже между маркерами `pg-schema-docs:auto` **пересобираются автоматически** после `alembic upgrade` и dev-инициализации PostgreSQL (`scripts/pg_schema_docs.py`). Отключить: `SKIP_PG_SCHEMA_DOCS=1`.

<!-- pg-schema-docs:auto:begin -->

## Снимок БД (авто)

_Обновлено: 2026-11-18 10:11 UTC_ · инстанс `127.0.0.1:55432/chat_case_cfbbe35dd07e4d3cb97844b92cd556c0` · скрипт `scripts/pg_schema_docs.py`

| Схема | Таблиц | Кратко |
|-------|--------|--------|
| **`app`** | **7** | Auth, Hub, tickets, inventory, почта, сети, AI, JSON-store |
| **`chat`** | **33** | Мессенджер, outbox, push |
| **`system`** | **3** | Alembic, auth runtime, MFU, session Exchange, чекпоинты |

Полные колонки: [POSTGRES_APP_SCHEMA_DDL.md](./POSTGRES_APP_SCHEMA_DDL.md).

Документация пересобирается автоматически после `alembic upgrade` (см. `WEB-itinvent/backend/alembic/env.py`). Отключить: `SKIP_PG_SCHEMA_DOCS=1`.

> **Chat:** на инстансе 33 табл.; в коде ещё ожидаются: `migration_checkpoints`.

## Схема `app` (7 таблиц)

### Auth и пользователи

| Таблица | Назначение |
|---------|------------|
| `app_settings` | Глобальные key-value настройки приложения |
| `sessions` | Сессии входа (cookie, idle, status) |
| `trusted_devices` | WebAuthn / доверенные устройства |
| `user_2fa_backup_codes` | Резервные коды 2FA |
| `user_db_selection` | Выбор ITINVENT-БД по `telegram_id` (бот) |
| `user_settings` | UI: тема, шрифт, закреплённая БД ITINVENT |
| `users` | Учётные записи web: role, permissions, Telegram, почта по умолчанию |

## Схема `chat` (33 таблиц)

### Таблицы

| Таблица | Назначение |
|---------|------------|
| `chat_attachment_previews` | — |
| `chat_call_participants` | — |
| `chat_calls` | — |
| `chat_conversation_user_state` | Состояние диалога у пользователя |
| `chat_conversations` | Диалог (direct / group) |
| `chat_event_outbox` | Очередь chat-событий (realtime / fan-out) |
| `chat_folder_conversations` | — |
| `chat_folders` | — |
| `chat_group_admin_audit` | — |
| `chat_group_invites` | — |
| `chat_group_join_requests` | — |
| `chat_group_join_settings` | — |
| `chat_group_limits` | — |
| `chat_group_permissions` | — |
| `chat_group_restrictions` | — |
| `chat_group_settings` | — |
| `chat_members` | Участники |
| `chat_message_attachments` | Файлы |
| `chat_message_mentions` | — |
| `chat_message_pins` | — |
| `chat_message_reactions` | Реакции |
| `chat_message_reads` | Прочитано |
| `chat_message_reports` | — |
| `chat_messages` | Сообщения (в т.ч. task preview) |
| `chat_poll_votes` | — |
| `chat_push_outbox` | Очередь push-уведомлений |
| `chat_push_subscriptions` | Web Push подписки |
| `chat_realtime_events` | — |
| `chat_realtime_presence` | — |
| `chat_scheduled_messages` | — |
| `chat_sticker_packs` | — |
| `chat_stickers` | — |
| `chat_user_sticker_packs` | — |

### В коде, но не на инстансе

| Таблица | Назначение |
|---------|------------|
| `migration_checkpoints` | Чекпоинты миграций |

Логические FK: `user_id` → `app.users.id` (не всегда жёсткий FK в миграциях).

## Схема `system` (3 таблиц)

### Служебные

| Таблица | Назначение |
|---------|------------|
| `alembic_version` | Текущая ревизия Alembic |
| `auth_runtime_items` | Временные ключи auth (challenge, rate limit, …) |
| `migration_checkpoints` | Чекпоинты миграций |

<!-- pg-schema-docs:auto:end -->

---

## Подключение

| Переменная | Назначение |
|------------|------------|
| `APP_DATABASE_URL` | Основной PostgreSQL для app + (часто) тот же инстанс для chat/system |
| `CHAT_DATABASE_URL` | Переопределение, если чат вынесен на другой инстанс |
| `APP_SCHEMA` | Имя схемы приложения, по умолчанию `app` |
| `SKIP_PG_SCHEMA_DOCS` | `1` — не обновлять эту документацию после миграций |

На SQLite (dev) префиксы `app.` / `chat.` / `system.` могут отсутствовать — в production целевой вариант **три схемы**.

Ручная пересборка документации:

```powershell
python scripts/introspect_pg_schema.py
```

---

## Ключевые связи (логические)

```text
app.users ──┬── app.sessions
            ├── app.department_memberships ── app.departments
            ├── app.hub_tasks (assignees / controller / creator; assignee_user_id is the compatibility primary)
            ├── app.ticket_requests ── items / comments / attachments
            ├── app.inventory_hosts ── inventory_host_sql_contexts
            └── (chat) chat_members ── chat_conversations ── chat_messages  [если развёрнуто]

app.hub_tasks ── reports | comments | attachments | status_log
chat.chat_event_outbox ── доставка событий подписчикам / realtime
```

**Hub task** и **Ticket** — разные графы; общей таблицы задач нет.

---

## Филиал: где что хранится

| Понятие | Где | Поля |
|---------|-----|------|
| **ITINVENT branch** | SQL Server | `BRANCH_NO`, `BRANCH_NAME` |
| **Inventory SQL context** | `app.inventory_host_sql_contexts` | `branch_no`, `branch_name` |
| **Network branch** | `app.network_branches` | + `network_branch_db_map` |
| **Scan branch label** | Scan runtime (`SCAN_DATABASE_URL` / SQLite) | строка `branch`, не FK в app schema |

---

## Вне этого PostgreSQL

| Хранилище | Технология | Документ |
|-----------|------------|----------|
| Equipment catalog | SQL Server | `WEB-itinvent/backend/database/` |
| Shared JSON ledger | `data/*.json` | [data/README.md](../../data/README.md) |
| Scan runtime | PostgreSQL schema `scan` (`SCAN_DATABASE_URL`) или SQLite fallback | [SCAN_ARCHITECTURE.md](./SCAN_ARCHITECTURE.md), [SCAN_POSTGRES_MIGRATION.md](./SCAN_POSTGRES_MIGRATION.md) |

---

## История

<!-- pg-schema-docs:history:begin -->

- **2026-11-18:** авто-синхронизация с `127.0.0.1:55432/chat_case_cfbbe35dd07e4d3cb97844b92cd556c0` (`app` 7, `chat` 33, `system` 3).

<!-- pg-schema-docs:history:end -->

- **2026-05-26:** включена авто-пересборка после миграций (`pg_schema_docs.py` + Alembic hook).
