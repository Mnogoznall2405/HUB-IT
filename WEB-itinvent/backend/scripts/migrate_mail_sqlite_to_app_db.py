#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, inspect, text


WEB_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = Path(__file__).resolve().parents[3]
for import_root in (WEB_ROOT, REPO_ROOT):
    if str(import_root) not in sys.path:
        sys.path.insert(0, str(import_root))

from backend.appdb.db import get_app_database_url  # noqa: E402
from backend.db_schema import schema_name  # noqa: E402
from local_store import get_local_store  # noqa: E402


@dataclass(frozen=True)
class MailTableSpec:
    name: str
    columns: tuple[str, ...]
    primary_key: tuple[str, ...]
    unique_key: tuple[str, ...] = ()


MAIL_TABLE_SPECS: tuple[MailTableSpec, ...] = (
    MailTableSpec(
        name="mail_it_templates",
        columns=(
            "id",
            "code",
            "title",
            "category",
            "subject_template",
            "body_template_md",
            "required_fields_json",
            "is_active",
            "created_by_user_id",
            "created_by_username",
            "updated_by_user_id",
            "updated_by_username",
            "created_at",
            "updated_at",
        ),
        primary_key=("id",),
        unique_key=("code",),
    ),
    MailTableSpec(
        name="mail_messages_log",
        columns=(
            "id",
            "user_id",
            "username",
            "direction",
            "folder_hint",
            "subject",
            "recipients_json",
            "sent_at",
            "status",
            "exchange_item_id",
            "error_text",
        ),
        primary_key=("id",),
    ),
    MailTableSpec(
        name="mail_restore_hints",
        columns=("user_id", "trash_exchange_id", "restore_folder", "source_exchange_id", "created_at"),
        primary_key=("user_id", "trash_exchange_id"),
    ),
    MailTableSpec(
        name="mail_draft_context",
        columns=(
            "draft_exchange_id",
            "user_id",
            "compose_mode",
            "reply_to_message_id",
            "forward_message_id",
            "compose_mailbox_id",
            "updated_at",
        ),
        primary_key=("draft_exchange_id",),
    ),
    MailTableSpec(
        name="mail_folder_favorites",
        columns=("user_id", "folder_id", "created_at"),
        primary_key=("user_id", "folder_id"),
    ),
    MailTableSpec(
        name="mail_visible_custom_folders",
        columns=("user_id", "folder_id", "created_at"),
        primary_key=("user_id", "folder_id"),
    ),
    MailTableSpec(
        name="mail_user_preferences",
        columns=("user_id", "prefs_json", "updated_at"),
        primary_key=("user_id",),
    ),
    MailTableSpec(
        name="user_mailboxes",
        columns=(
            "id",
            "user_id",
            "label",
            "mailbox_email",
            "mailbox_login",
            "mailbox_password_enc",
            "auth_mode",
            "is_primary",
            "is_active",
            "sort_order",
            "last_selected_at",
            "created_at",
            "updated_at",
        ),
        primary_key=("id",),
        unique_key=("user_id", "mailbox_email"),
    ),
)


def _normalize_path(value: str | None) -> Path:
    if value:
        return Path(value).expanduser().resolve()
    return Path(get_local_store().db_path).expanduser().resolve()


def _source_has_table(source: sqlite3.Connection, table_name: str) -> bool:
    row = source.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _target_has_table(engine, table_name: str, schema: str | None) -> bool:
    return bool(inspect(engine).has_table(table_name, schema=schema))


def _source_columns(source: sqlite3.Connection, table_name: str) -> set[str]:
    return {str(row["name"] or "").strip() for row in source.execute(f'PRAGMA table_info("{table_name}")').fetchall()}


def _qualified_table(engine, table_name: str, schema: str | None) -> str:
    preparer = engine.dialect.identifier_preparer
    quoted_table = preparer.quote(table_name)
    if not schema:
        return quoted_table
    return f"{preparer.quote_schema(schema)}.{quoted_table}"


def _where_clause(columns: tuple[str, ...]) -> str:
    return " AND ".join(f'"{column}" = :where_{column}' for column in columns)


def _select_existing_key(connection, qualified_table: str, spec: MailTableSpec, row: dict[str, Any]) -> tuple[str, ...] | None:
    for key_columns in (spec.primary_key, spec.unique_key):
        if not key_columns:
            continue
        params = {f"where_{column}": row.get(column) for column in key_columns}
        if any(value is None for value in params.values()):
            continue
        result = connection.execute(
            text(f"SELECT {', '.join(f'\"{column}\"' for column in spec.primary_key)} FROM {qualified_table} WHERE {_where_clause(key_columns)}"),
            params,
        ).first()
        if result is not None:
            return key_columns
    return None


def _insert_row(connection, qualified_table: str, spec: MailTableSpec, row: dict[str, Any]) -> None:
    column_sql = ", ".join(f'"{column}"' for column in spec.columns)
    value_sql = ", ".join(f":{column}" for column in spec.columns)
    connection.execute(
        text(f"INSERT INTO {qualified_table} ({column_sql}) VALUES ({value_sql})"),
        {column: row.get(column) for column in spec.columns},
    )


def _update_row(connection, qualified_table: str, spec: MailTableSpec, row: dict[str, Any], key_columns: tuple[str, ...]) -> None:
    immutable_columns = set(key_columns) | set(spec.primary_key)
    update_columns = [column for column in spec.columns if column not in immutable_columns]
    if not update_columns:
        return
    set_sql = ", ".join(f'"{column}" = :{column}' for column in update_columns)
    params = {column: row.get(column) for column in spec.columns}
    params.update({f"where_{column}": row.get(column) for column in key_columns})
    connection.execute(
        text(f"UPDATE {qualified_table} SET {set_sql} WHERE {_where_clause(key_columns)}"),
        params,
    )


def _read_source_rows(source: sqlite3.Connection, spec: MailTableSpec) -> list[dict[str, Any]]:
    if not _source_has_table(source, spec.name):
        return []
    existing_columns = _source_columns(source, spec.name)
    missing_columns = [column for column in spec.columns if column not in existing_columns]
    if missing_columns:
        raise RuntimeError(f"Source table {spec.name} is missing columns: {', '.join(missing_columns)}")
    column_sql = ", ".join(f'"{column}"' for column in spec.columns)
    rows = source.execute(f'SELECT {column_sql} FROM "{spec.name}"').fetchall()
    return [dict(row) for row in rows]


def migrate_mail_sqlite_to_app_db(
    *,
    sqlite_path: str | Path | None = None,
    database_url: str | None = None,
    execute: bool = False,
) -> dict[str, dict[str, int]]:
    source_path = _normalize_path(str(sqlite_path) if sqlite_path else None)
    if not source_path.exists():
        raise FileNotFoundError(f"SQLite source database not found: {source_path}")

    target_url = get_app_database_url(database_url)
    if not target_url:
        raise RuntimeError("APP_DATABASE_URL is not configured")

    engine = create_engine(target_url, future=True, pool_pre_ping=True)
    schema = schema_name("app", target_url)
    if engine.dialect.name != "postgresql":
        schema = None

    summary: dict[str, dict[str, int]] = {}
    source = sqlite3.connect(str(source_path))
    source.row_factory = sqlite3.Row
    try:
        with engine.begin() as target:
            for spec in MAIL_TABLE_SPECS:
                rows = _read_source_rows(source, spec)
                if not rows:
                    summary[spec.name] = {"read": 0, "inserted": 0, "updated": 0}
                    continue
                if not _target_has_table(engine, spec.name, schema):
                    raise RuntimeError(f"Target APP_DATABASE_URL is missing table: {spec.name}")
                qualified_table = _qualified_table(engine, spec.name, schema)
                inserted = 0
                updated = 0
                for row in rows:
                    existing_key = _select_existing_key(target, qualified_table, spec, row)
                    if execute:
                        if existing_key:
                            _update_row(target, qualified_table, spec, row, existing_key)
                            updated += 1
                        else:
                            _insert_row(target, qualified_table, spec, row)
                            inserted += 1
                    else:
                        if existing_key:
                            updated += 1
                        else:
                            inserted += 1
                summary[spec.name] = {"read": len(rows), "inserted": inserted, "updated": updated}
    finally:
        source.close()
    return summary


def _print_summary(summary: dict[str, dict[str, int]], *, execute: bool) -> None:
    mode = "execute" if execute else "dry-run"
    print(f"Mail SQLite migration {mode} summary:")
    for table_name, counts in summary.items():
        print(
            f"- {table_name}: read={counts['read']} "
            f"inserted={counts['inserted']} updated={counts['updated']}"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Migrate mail runtime tables from local SQLite to APP_DATABASE_URL.")
    parser.add_argument("--sqlite-path", default=None, help="Source local SQLite path. Defaults to local_store db_path.")
    parser.add_argument("--database-url", default=None, help="Target APP_DATABASE_URL. Defaults to env/config APP_DATABASE_URL.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Count rows and planned upserts without writing.")
    mode.add_argument("--execute", action="store_true", help="Write rows to APP_DATABASE_URL.")
    args = parser.parse_args(argv)

    execute = bool(args.execute)
    summary = migrate_mail_sqlite_to_app_db(
        sqlite_path=args.sqlite_path,
        database_url=args.database_url or os.getenv("APP_DATABASE_URL"),
        execute=execute,
    )
    _print_summary(summary, execute=execute)
    if not execute:
        print("No rows were written. Re-run with --execute to apply.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
