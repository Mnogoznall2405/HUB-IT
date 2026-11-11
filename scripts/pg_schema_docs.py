"""Generate PostgreSQL schema documentation from a live database."""
from __future__ import annotations

import os
import re
from collections import defaultdict
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

AUTO_BEGIN = "<!-- pg-schema-docs:auto:begin -->"
AUTO_END = "<!-- pg-schema-docs:auto:end -->"
HISTORY_BEGIN = "<!-- pg-schema-docs:history:begin -->"
HISTORY_END = "<!-- pg-schema-docs:history:end -->"

SCHEMA_ORDER = ("app", "chat", "system")
SKIP_SCHEMAS = frozenset({"information_schema", "pg_catalog", "pg_toast", "public"})

# Tables declared in chat/models.py (target set when chat migrations applied).
CHAT_MODEL_TABLES = (
    "chat_conversations",
    "chat_members",
    "chat_messages",
    "chat_message_attachments",
    "chat_message_reads",
    "chat_message_reactions",
    "chat_conversation_user_state",
    "chat_push_subscriptions",
    "chat_push_outbox",
    "chat_event_outbox",
    "migration_checkpoints",
)

TABLE_DESCRIPTIONS: dict[str, str] = {
    "users": "Учётные записи web: role, permissions, Telegram, почта по умолчанию",
    "sessions": "Сессии входа (cookie, idle, status)",
    "trusted_devices": "WebAuthn / доверенные устройства",
    "user_2fa_backup_codes": "Резервные коды 2FA",
    "user_settings": "UI: тема, шрифт, закреплённая БД ITINVENT",
    "user_mailboxes": "Дополнительные почтовые ящики",
    "departments": "Подразделения (scope доступа)",
    "department_memberships": "Связь user ↔ department",
    "user_db_selection": "Выбор ITINVENT-БД по `telegram_id` (бот)",
    "ad_user_branch_overrides": "Принудительный `branch_no` для AD-login",
    "app_settings": "Глобальные key-value настройки приложения",
    "hub_tasks": "**Hub task**",
    "hub_task_projects": "Проекты задач",
    "hub_task_objects": "Объекты (привязка к задачам)",
    "hub_task_reports": "Отчёты исполнителя",
    "hub_task_attachments": "Вложения к задаче",
    "hub_task_comments": "Комментарии",
    "hub_task_comment_reads": "Прочитанность комментариев",
    "hub_task_status_log": "История смены статуса",
    "hub_announcements": "**Hub announcement**",
    "hub_announcement_reads": "Прочтение / ACK объявлений",
    "hub_announcement_attachments": "Вложения объявлений",
    "hub_notifications": "**Hub notification**",
    "hub_notification_reads": "Прочитанность уведомлений",
    "task_delegate_user_links": "Делегирование задач (assistant)",
    "ticket_objects": "Объекты обслуживания",
    "ticket_employees": "Сотрудники в контуре tickets",
    "ticket_employee_documents": "Документы сотрудника",
    "ticket_requests": "**Ticket** — заявка",
    "ticket_items": "Позиции заявки",
    "ticket_comments": "Комментарии",
    "ticket_change_history": "Аудит изменений",
    "ticket_financial_ops": "Финансовые операции",
    "ticket_attachments": "Вложения",
    "ticket_import_jobs": "Импорт (job)",
    "ticket_import_raw_traces": "Сырой trace импорта",
    "ticket_notification_rules": "Правила уведомлений",
    "inventory_hosts": "**Inventory host** (MAC PK, snapshot JSON)",
    "inventory_change_events": "Диффы между снимками",
    "inventory_user_profiles": "Профили пользователей на хосте",
    "inventory_outlook_files": "PST/OST и архивы Outlook",
    "inventory_host_sql_contexts": "Кэш контекста из ITINVENT (branch, location, inv №)",
    "mail_it_templates": "Шаблоны IT-писем",
    "mail_messages_log": "Лог отправок",
    "mail_restore_hints": "Подсказки восстановления",
    "mail_draft_context": "Контекст черновика",
    "mail_folder_favorites": "Избранные папки",
    "mail_visible_custom_folders": "Видимые пользовательские папки",
    "mail_user_preferences": "Почтовые настройки пользователя",
    "network_branches": "Филиалы сетевого учёта",
    "network_branch_db_map": "Связь филиал ↔ ITINVENT db",
    "network_sites": "Площадки",
    "network_maps": "Карты",
    "network_map_points": "Точки на карте",
    "network_panels": "Панели",
    "network_devices": "Устройства",
    "network_ports": "Порты",
    "network_sockets": "Розетки",
    "network_socket_profiles": "Профили розеток",
    "network_import_jobs": "Импорт топологии",
    "network_audit_log": "Журнал изменений",
    "json_documents": "Один JSON-файл = одна строка (`file_name` PK)",
    "json_records": "Списковые JSON (много записей на файл)",
    "vcs_computers": "Видеоконференц-компьютеры",
    "equipment_transfer_act_reminders": "Напоминания по актам перемещения",
    "equipment_transfer_act_reminder_groups": "Группы напоминаний",
    "native_push_tokens": "FCM/APNs токены (мобильный web)",
    "ai_bots": "Конфигурация AI-ботов в чате",
    "ai_bot_conversations": "Привязка bot ↔ user ↔ conversation_id",
    "ai_bot_runs": "Запуски / стадии ответа",
    "ai_pending_actions": "Действия, ждущие подтверждения",
    "ai_kb_documents": "Документы KB для RAG",
    "ai_kb_chunks": "Чанки для поиска",
    "transfer_act_jobs": "Фоновые jobs по актам перемещения",
    "chat_conversations": "Диалог (direct / group)",
    "chat_members": "Участники",
    "chat_messages": "Сообщения (в т.ч. task preview)",
    "chat_message_attachments": "Файлы",
    "chat_message_reads": "Прочитано",
    "chat_message_reactions": "Реакции",
    "chat_conversation_user_state": "Состояние диалога у пользователя",
    "chat_push_subscriptions": "Web Push подписки",
    "chat_push_outbox": "Очередь push-уведомлений",
    "chat_event_outbox": "Очередь chat-событий (realtime / fan-out)",
    "alembic_version": "Текущая ревизия Alembic",
    "auth_runtime_items": "Временные ключи auth (challenge, rate limit, …)",
    "session_auth_context": "Exchange login + encrypted password для сессии",
    "env_settings_audit": "Аудит изменений env из UI",
    "mfu_page_baseline": "MFU: эталон счётчиков страниц",
    "mfu_page_snapshots": "MFU: снимки по датам",
    "mfu_runtime_state": "MFU: runtime / retry",
    "migration_checkpoints": "Чекпоинты миграций",
}

APP_DOMAIN_RULES: list[tuple[str, Callable[[str], bool]]] = [
    (
        "Auth и пользователи",
        lambda t: t
        in {
            "users",
            "sessions",
            "trusted_devices",
            "user_2fa_backup_codes",
            "user_settings",
            "user_mailboxes",
            "departments",
            "department_memberships",
            "user_db_selection",
            "ad_user_branch_overrides",
            "app_settings",
        },
    ),
    ("Hub", lambda t: t.startswith("hub_") or t == "task_delegate_user_links"),
    ("Tickets", lambda t: t.startswith("ticket_")),
    ("Inventory", lambda t: t.startswith("inventory_")),
    ("Почта", lambda t: t.startswith("mail_")),
    ("Сети (network audit)", lambda t: t.startswith("network_")),
    ("JSON-store", lambda t: t.startswith("json_")),
    (
        "AI и фоновые jobs",
        lambda t: t.startswith("ai_") or t == "transfer_act_jobs",
    ),
    (
        "Прочее",
        lambda t: t
        in {
            "vcs_computers",
            "equipment_transfer_act_reminders",
            "equipment_transfer_act_reminder_groups",
            "native_push_tokens",
        },
    ),
]

SYSTEM_DOMAIN_RULES: list[tuple[str, Callable[[str], bool]]] = [
    ("Служебные", lambda _t: True),
]


def default_repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def load_dotenv(repo_root: Path | None = None) -> None:
    root = repo_root or default_repo_root()
    env_path = root / ".env"
    if not env_path.is_file():
        return
    values: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        values[key.strip()] = val.strip()
    for key, val in list(values.items()):
        expanded = re.sub(
            r"\$\{([^}]+)\}",
            lambda m: values.get(m.group(1), m.group(0)),
            val,
        )
        os.environ.setdefault(key, expanded)


def resolve_database_url(database_url: str | None = None) -> str:
    if database_url:
        return str(database_url).strip()
    load_dotenv()
    url = (os.getenv("APP_DATABASE_URL") or os.getenv("CHAT_DATABASE_URL") or "").strip()
    if not url:
        raise ValueError("APP_DATABASE_URL / CHAT_DATABASE_URL is not set")
    return url


def mask_database_url(url: str) -> str:
    return re.sub(r":([^:@/]+)@", ":***@", url)


def database_label(url: str) -> str:
    parsed = urlparse(url.replace("postgresql+psycopg", "postgresql", 1))
    host = parsed.hostname or "?"
    port = parsed.port or 5432
    db = (parsed.path or "/").lstrip("/") or "?"
    return f"{host}:{port}/{db}"


def _pg_type(col: dict[str, Any]) -> str:
    t = col.get("type")
    if t is None:
        return "unknown"
    impl = str(t)
    if "VARCHAR" in impl or "String" in impl:
        length = getattr(t, "length", None)
        return f"varchar({length})" if length else "varchar"
    if "INTEGER" in impl or "Integer" in impl:
        return "integer"
    if "BIGINT" in impl or "BigInteger" in impl:
        return "bigint"
    if "BOOLEAN" in impl or "Boolean" in impl:
        return "boolean"
    if "TEXT" in impl or "Text" in impl:
        return "text"
    if "TIMESTAMP" in impl or "DateTime" in impl:
        return "timestamptz" if getattr(t, "timezone", False) else "timestamp"
    if "FLOAT" in impl or "Float" in impl:
        return "double precision"
    return impl.split("(")[0].lower() if "(" in impl else str(t).lower()


def _describe_table(table: str) -> str:
    return TABLE_DESCRIPTIONS.get(table, "—")


def _group_tables(tables: list[str], rules: list[tuple[str, Callable[[str], bool]]]) -> list[tuple[str, list[str]]]:
    remaining = list(tables)
    groups: list[tuple[str, list[str]]] = []
    for title, matcher in rules:
        matched = sorted(t for t in remaining if matcher(t))
        if not matched:
            continue
        groups.append((title, matched))
        remaining = [t for t in remaining if t not in matched]
    if remaining:
        groups.append(("Без категории", sorted(remaining)))
    return groups


def _schema_summary(schema: str, count: int) -> str:
    summaries = {
        "app": "Auth, Hub, tickets, inventory, почта, сети, AI, JSON-store",
        "chat": "Мессенджер, outbox, push",
        "system": "Alembic, auth runtime, MFU, session Exchange, чекпоинты",
    }
    return summaries.get(schema, "—")


def introspect_schemas(engine) -> dict[str, list[str]]:
    from sqlalchemy import inspect

    insp = inspect(engine)
    schema_names = [
        s
        for s in insp.get_schema_names()
        if s not in SKIP_SCHEMAS and not s.startswith("pg_")
    ]
    result: dict[str, list[str]] = {}
    ordered = [s for s in SCHEMA_ORDER if s in schema_names] + [
        s for s in sorted(schema_names) if s not in SCHEMA_ORDER
    ]
    for schema in ordered:
        tables = sorted(insp.get_table_names(schema=schema))
        if tables:
            result[schema] = tables
    return result


def render_ddl_markdown(engine, *, database_url: str) -> str:
    from sqlalchemy import inspect

    insp = inspect(engine)
    safe_url = mask_database_url(database_url)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines: list[str] = [
        "# PostgreSQL — DDL snapshot (live introspection)",
        "",
        f"_Сгенерировано: {now}_  ",
        f"_Источник: `APP_DATABASE_URL` → `{safe_url}` (`{database_label(database_url)}`)_",
        "",
        "Автообновляется после `alembic upgrade` и dev-инициализации PostgreSQL. "
        "Обзор: [POSTGRES_APP_SCHEMA.md](./POSTGRES_APP_SCHEMA.md).",
        "",
        "---",
        "",
    ]

    with engine.connect() as conn:
        dialect = conn.dialect.name
        if dialect != "postgresql":
            lines.append(f"> **Внимание:** подключение не PostgreSQL (`{dialect}`).\n")

    for schema, tables in introspect_schemas(engine).items():
        lines.append(f"## Schema `{schema}` ({len(tables)} tables)\n")
        for table in tables:
            lines.append(f"### `{schema}.{table}`\n")
            cols = insp.get_columns(table, schema=schema)
            pk = insp.get_pk_constraint(table, schema=schema) or {}
            pk_cols = pk.get("constrained_columns") or []
            fks = insp.get_foreign_keys(table, schema=schema) or []
            indexes = insp.get_indexes(table, schema=schema) or []

            lines.append("| Column | Type | Nullable | Default |")
            lines.append("|--------|------|----------|---------|")
            for col in cols:
                name = col["name"]
                pk_mark = " **PK**" if name in pk_cols else ""
                nullable = "yes" if col.get("nullable", True) else "no"
                default = col.get("default")
                default_s = (
                    str(default).replace("\n", " ")[:80] if default is not None else ""
                )
                lines.append(
                    f"| `{name}`{pk_mark} | {_pg_type(col)} | {nullable} | `{default_s}` |"
                )
            lines.append("")
            if pk_cols:
                lines.append(f"- **Primary key:** `{', '.join(pk_cols)}`")
            if fks:
                lines.append("- **Foreign keys:**")
                for fk in fks:
                    local = ", ".join(fk.get("constrained_columns") or [])
                    ref_schema = fk.get("referred_schema") or schema
                    ref_table = fk.get("referred_table") or "?"
                    ref_cols = ", ".join(fk.get("referred_columns") or [])
                    lines.append(
                        f"  - `{local}` → `{ref_schema}.{ref_table}` (`{ref_cols}`)"
                    )
            if indexes:
                lines.append("- **Indexes:**")
                for idx in indexes:
                    unique = " UNIQUE" if idx.get("unique") else ""
                    col_list = [c for c in (idx.get("column_names") or []) if c]
                    cols = ", ".join(col_list) or "(expression)"
                    lines.append(f"  - `{idx.get('name')}`{unique}: ({cols})")
            lines.append("\n---\n")
    return "\n".join(lines)


def render_overview_auto_block(
    schemas: dict[str, list[str]],
    *,
    database_url: str,
) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    db_label = database_label(database_url)
    lines: list[str] = [
        "## Снимок БД (авто)",
        "",
        f"_Обновлено: {now}_ · инстанс `{db_label}` · скрипт `scripts/pg_schema_docs.py`",
        "",
        "| Схема | Таблиц | Кратко |",
        "|-------|--------|--------|",
    ]
    for schema in SCHEMA_ORDER:
        if schema not in schemas:
            continue
        count = len(schemas[schema])
        lines.append(f"| **`{schema}`** | **{count}** | {_schema_summary(schema, count)} |")
    for schema, tables in schemas.items():
        if schema in SCHEMA_ORDER:
            continue
        lines.append(f"| **`{schema}`** | **{len(tables)}** | — |")

    lines.extend(
        [
            "",
            "Полные колонки: [POSTGRES_APP_SCHEMA_DDL.md](./POSTGRES_APP_SCHEMA_DDL.md).",
            "",
            "Документация пересобирается автоматически после `alembic upgrade` "
            "(см. `WEB-itinvent/backend/alembic/env.py`). Отключить: `SKIP_PG_SCHEMA_DOCS=1`.",
            "",
        ]
    )

    if "chat" in schemas:
        deployed = set(schemas["chat"])
        missing = [t for t in CHAT_MODEL_TABLES if t not in deployed]
        if missing:
            lines.append(
                f"> **Chat:** на инстансе {len(deployed)} табл.; "
                f"в коде ещё ожидаются: `{', '.join(missing)}`."
            )
            lines.append("")

    for schema, tables in schemas.items():
        if schema == "app":
            rules = APP_DOMAIN_RULES
        elif schema == "system":
            rules = SYSTEM_DOMAIN_RULES
        else:
            rules = [("Таблицы", lambda _t: True)]
        lines.append(f"## Схема `{schema}` ({len(tables)} таблиц)")
        lines.append("")
        for title, group_tables in _group_tables(tables, rules):
            lines.append(f"### {title}")
            lines.append("")
            lines.append("| Таблица | Назначение |")
            lines.append("|---------|------------|")
            for table in group_tables:
                lines.append(f"| `{table}` | {_describe_table(table)} |")
            lines.append("")

        if schema == "chat":
            missing = [t for t in CHAT_MODEL_TABLES if t not in tables]
            if missing:
                lines.append("### В коде, но не на инстансе")
                lines.append("")
                lines.append("| Таблица | Назначение |")
                lines.append("|---------|------------|")
                for table in missing:
                    lines.append(f"| `{table}` | {_describe_table(table)} |")
                lines.append("")
            lines.append(
                "Логические FK: `user_id` → `app.users.id` (не всегда жёсткий FK в миграциях)."
            )
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def _replace_marked_block(content: str, begin: str, end: str, body: str) -> str:
    if begin not in content or end not in content:
        raise ValueError(f"Markers not found: {begin!r} … {end!r}")
    start = content.index(begin) + len(begin)
    stop = content.index(end)
    return content[:start] + "\n\n" + body.rstrip() + "\n\n" + content[stop:]


def update_overview_markdown(
    schemas: dict[str, list[str]],
    *,
    repo_root: Path,
    database_url: str,
) -> Path:
    overview_path = repo_root / "documentation" / "technical" / "POSTGRES_APP_SCHEMA.md"
    content = overview_path.read_text(encoding="utf-8")
    auto_body = render_overview_auto_block(schemas, database_url=database_url)
    content = _replace_marked_block(content, AUTO_BEGIN, AUTO_END, auto_body)

    history_line = (
        f"- **{datetime.now(timezone.utc).strftime('%Y-%m-%d')}:** авто-синхронизация с `{database_label(database_url)}` "
        f"(`app` {len(schemas.get('app', []))}, `chat` {len(schemas.get('chat', []))}, "
        f"`system` {len(schemas.get('system', []))})."
    )
    if HISTORY_BEGIN in content and HISTORY_END in content:
        content = _replace_marked_block(content, HISTORY_BEGIN, HISTORY_END, history_line)
    overview_path.write_text(content, encoding="utf-8")
    return overview_path


def refresh_pg_schema_documentation(
    *,
    database_url: str | None = None,
    repo_root: Path | None = None,
    quiet: bool = False,
) -> dict[str, Path]:
    """Introspect PostgreSQL and refresh POSTGRES_APP_SCHEMA*.md files."""
    root = repo_root or default_repo_root()
    url = resolve_database_url(database_url)
    if not url.startswith("postgresql"):
        raise ValueError(f"Schema docs refresh requires PostgreSQL, got: {url[:32]}…")

    from sqlalchemy import create_engine

    engine = create_engine(url)
    schemas = introspect_schemas(engine)

    ddl_path = root / "documentation" / "technical" / "POSTGRES_APP_SCHEMA_DDL.md"
    ddl_path.parent.mkdir(parents=True, exist_ok=True)
    ddl_path.write_text(render_ddl_markdown(engine, database_url=url), encoding="utf-8")

    overview_path = update_overview_markdown(schemas, repo_root=root, database_url=url)

    if not quiet:
        counts = ", ".join(f"{k}={len(v)}" for k, v in schemas.items())
        print(f"Updated schema docs ({counts}) -> {overview_path.name}, {ddl_path.name}")

    return {"overview": overview_path, "ddl": ddl_path}


def should_skip_refresh() -> bool:
    return os.getenv("SKIP_PG_SCHEMA_DOCS", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def try_refresh_pg_schema_documentation(
    *,
    database_url: str | None = None,
    repo_root: Path | None = None,
    quiet: bool = True,
) -> bool:
    """Best-effort refresh; returns True on success."""
    if should_skip_refresh():
        return False
    try:
        refresh_pg_schema_documentation(
            database_url=database_url,
            repo_root=repo_root,
            quiet=quiet,
        )
        return True
    except Exception:
        return False
