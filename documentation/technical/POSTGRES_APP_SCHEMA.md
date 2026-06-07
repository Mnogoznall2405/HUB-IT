# PostgreSQL — App runtime store (HUB-IT)

Справочник по **собственной** БД платформы HUB-IT (`APP_DATABASE_URL`; в `.env` часто `APP_DATABASE_URL=${CHAT_DATABASE_URL}`).  
Это **не** **Equipment catalog (ITINVENT)** (SQL Server) и **не** SQLite **Scan server**.

**Язык домена:** [CONTEXT.md](../../CONTEXT.md)  
**Колонки, PK, FK, индексы (live):** [POSTGRES_APP_SCHEMA_DDL.md](./POSTGRES_APP_SCHEMA_DDL.md)  
**Миграции:** `WEB-itinvent/backend/alembic/versions/`  
**Модели:** `WEB-itinvent/backend/appdb/models.py`, `tickets_models.py`, `chat/models.py`

Секции ниже между маркерами `pg-schema-docs:auto` **пересобираются автоматически** после `alembic upgrade` и dev-инициализации PostgreSQL (`scripts/pg_schema_docs.py`). Отключить: `SKIP_PG_SCHEMA_DOCS=1`.

<!-- pg-schema-docs:auto:begin -->

## Снимок БД (авто)

_Обновлено: 2026-06-07 22:09 UTC_ · инстанс `127.0.0.1:5432/hubit_chat` · скрипт `scripts/pg_schema_docs.py`

| Схема | Таблиц | Кратко |
|-------|--------|--------|
| **`app`** | **83** | Auth, Hub, tickets, inventory, почта, сети, AI, JSON-store |
| **`chat`** | **1** | Мессенджер, outbox, push |
| **`system`** | **8** | Alembic, auth runtime, MFU, session Exchange, чекпоинты |

Полные колонки: [POSTGRES_APP_SCHEMA_DDL.md](./POSTGRES_APP_SCHEMA_DDL.md).

Документация пересобирается автоматически после `alembic upgrade` (см. `WEB-itinvent/backend/alembic/env.py`). Отключить: `SKIP_PG_SCHEMA_DOCS=1`.

> **Chat:** на инстансе 1 табл.; в коде ещё ожидаются: `chat_conversations, chat_members, chat_messages, chat_message_attachments, chat_message_reads, chat_message_reactions, chat_conversation_user_state, chat_push_subscriptions, chat_push_outbox, migration_checkpoints`.

## Схема `app` (83 таблиц)

### Auth и пользователи

| Таблица | Назначение |
|---------|------------|
| `ad_user_branch_overrides` | Принудительный `branch_no` для AD-login |
| `app_settings` | Глобальные key-value настройки приложения |
| `department_memberships` | Связь user ↔ department |
| `departments` | Подразделения (scope доступа) |
| `sessions` | Сессии входа (cookie, idle, status) |
| `trusted_devices` | WebAuthn / доверенные устройства |
| `user_2fa_backup_codes` | Резервные коды 2FA |
| `user_db_selection` | Выбор ITINVENT-БД по `telegram_id` (бот) |
| `user_mailboxes` | Дополнительные почтовые ящики |
| `user_settings` | UI: тема, шрифт, закреплённая БД ITINVENT |
| `users` | Учётные записи web: role, permissions, Telegram, почта по умолчанию |

### Hub

| Таблица | Назначение |
|---------|------------|
| `hub_announcement_attachments` | Вложения объявлений |
| `hub_announcement_reads` | Прочтение / ACK объявлений |
| `hub_announcements` | **Hub announcement** |
| `hub_notification_reads` | Прочитанность уведомлений |
| `hub_notifications` | **Hub notification** |
| `hub_task_attachments` | Вложения к задаче |
| `hub_task_comment_reads` | Прочитанность комментариев |
| `hub_task_comments` | Комментарии |
| `hub_task_objects` | Объекты (привязка к задачам) |
| `hub_task_projects` | Проекты задач |
| `hub_task_reports` | Отчёты исполнителя |
| `hub_task_status_log` | История смены статуса |
| `hub_tasks` | **Hub task** |
| `task_delegate_user_links` | Делегирование задач (assistant) |

### Tickets

| Таблица | Назначение |
|---------|------------|
| `ticket_attachments` | Вложения |
| `ticket_change_history` | Аудит изменений |
| `ticket_comments` | Комментарии |
| `ticket_employee_documents` | Документы сотрудника |
| `ticket_employees` | Сотрудники в контуре tickets |
| `ticket_financial_ops` | Финансовые операции |
| `ticket_import_jobs` | Импорт (job) |
| `ticket_import_raw_traces` | Сырой trace импорта |
| `ticket_items` | Позиции заявки |
| `ticket_notification_rules` | Правила уведомлений |
| `ticket_objects` | Объекты обслуживания |
| `ticket_requests` | **Ticket** — заявка |

### Inventory

| Таблица | Назначение |
|---------|------------|
| `inventory_change_events` | Диффы между снимками |
| `inventory_host_sql_contexts` | Кэш контекста из ITINVENT (branch, location, inv №) |
| `inventory_hosts` | **Inventory host** (MAC PK, snapshot JSON) |
| `inventory_outlook_files` | PST/OST и архивы Outlook |
| `inventory_user_profiles` | Профили пользователей на хосте |

### Почта

| Таблица | Назначение |
|---------|------------|
| `mail_draft_context` | Контекст черновика |
| `mail_folder_favorites` | Избранные папки |
| `mail_it_templates` | Шаблоны IT-писем |
| `mail_messages_log` | Лог отправок |
| `mail_restore_hints` | Подсказки восстановления |
| `mail_user_preferences` | Почтовые настройки пользователя |
| `mail_visible_custom_folders` | Видимые пользовательские папки |

### Сети (network audit)

| Таблица | Назначение |
|---------|------------|
| `network_audit_log` | Журнал изменений |
| `network_branch_db_map` | Связь филиал ↔ ITINVENT db |
| `network_branches` | Филиалы сетевого учёта |
| `network_devices` | Устройства |
| `network_import_jobs` | Импорт топологии |
| `network_map_points` | Точки на карте |
| `network_maps` | Карты |
| `network_panels` | Панели |
| `network_ports` | Порты |
| `network_sites` | Площадки |
| `network_socket_profiles` | Профили розеток |
| `network_sockets` | Розетки |

### JSON-store

| Таблица | Назначение |
|---------|------------|
| `json_documents` | Один JSON-файл = одна строка (`file_name` PK) |
| `json_records` | Списковые JSON (много записей на файл) |

### AI и фоновые jobs

| Таблица | Назначение |
|---------|------------|
| `ai_bot_conversations` | Привязка bot ↔ user ↔ conversation_id |
| `ai_bot_runs` | Запуски / стадии ответа |
| `ai_bots` | Конфигурация AI-ботов в чате |
| `ai_kb_chunks` | Чанки для поиска |
| `ai_kb_documents` | Документы KB для RAG |
| `ai_pending_actions` | Действия, ждущие подтверждения |
| `transfer_act_jobs` | Фоновые jobs по актам перемещения |

### Прочее

| Таблица | Назначение |
|---------|------------|
| `equipment_transfer_act_reminder_groups` | Группы напоминаний |
| `equipment_transfer_act_reminders` | Напоминания по актам перемещения |
| `native_push_tokens` | FCM/APNs токены (мобильный web) |
| `vcs_computers` | Видеоконференц-компьютеры |

### Без категории

| Таблица | Назначение |
|---------|------------|
| `equipment_recent_cards` | — |
| `my_file_audit` | — |
| `my_file_blobs` | — |
| `my_file_download_grants` | — |
| `my_file_previews` | — |
| `my_files` | — |
| `password_vault_audit` | — |
| `password_vault_entries` | — |
| `password_vault_groups` | — |

## Схема `chat` (1 таблиц)

### Таблицы

| Таблица | Назначение |
|---------|------------|
| `chat_event_outbox` | Очередь chat-событий (realtime / fan-out) |

### В коде, но не на инстансе

| Таблица | Назначение |
|---------|------------|
| `chat_conversations` | Диалог (direct / group) |
| `chat_members` | Участники |
| `chat_messages` | Сообщения (в т.ч. task preview) |
| `chat_message_attachments` | Файлы |
| `chat_message_reads` | Прочитано |
| `chat_message_reactions` | Реакции |
| `chat_conversation_user_state` | Состояние диалога у пользователя |
| `chat_push_subscriptions` | Web Push подписки |
| `chat_push_outbox` | Очередь push-уведомлений |
| `migration_checkpoints` | Чекпоинты миграций |

Логические FK: `user_id` → `app.users.id` (не всегда жёсткий FK в миграциях).

## Схема `system` (8 таблиц)

### Служебные

| Таблица | Назначение |
|---------|------------|
| `alembic_version` | Текущая ревизия Alembic |
| `auth_runtime_items` | Временные ключи auth (challenge, rate limit, …) |
| `env_settings_audit` | Аудит изменений env из UI |
| `mfu_page_baseline` | MFU: эталон счётчиков страниц |
| `mfu_page_snapshots` | MFU: снимки по датам |
| `mfu_runtime_state` | MFU: runtime / retry |
| `migration_checkpoints` | Чекпоинты миграций |
| `session_auth_context` | Exchange login + encrypted password для сессии |

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
            ├── app.hub_tasks (assignee / controller / creator)
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
| **Scan branch label** | SQLite Scan server | строка `branch`, не FK в PG |

---

## Вне этого PostgreSQL

| Хранилище | Технология | Документ |
|-----------|------------|----------|
| Equipment catalog | SQL Server | `WEB-itinvent/backend/database/` |
| Shared JSON ledger | `data/*.json` | [data/README.md](../../data/README.md) |
| Scan runtime | SQLite | [SCAN_ARCHITECTURE.md](./SCAN_ARCHITECTURE.md) |

---

## История

<!-- pg-schema-docs:history:begin -->

- **2026-06-07:** авто-синхронизация с `127.0.0.1:5432/hubit_chat` (`app` 83, `chat` 1, `system` 8).

<!-- pg-schema-docs:history:end -->

- **2026-05-26:** включена авто-пересборка после миграций (`pg_schema_docs.py` + Alembic hook).
