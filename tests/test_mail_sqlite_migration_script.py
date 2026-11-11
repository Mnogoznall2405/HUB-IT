from __future__ import annotations

import importlib.util
import sqlite3
import sys
from pathlib import Path

from sqlalchemy import create_engine, text


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = PROJECT_ROOT / "WEB-itinvent" / "backend" / "scripts" / "migrate_mail_sqlite_to_app_db.py"
spec = importlib.util.spec_from_file_location("migrate_mail_sqlite_to_app_db", SCRIPT_PATH)
migration_script = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = migration_script
spec.loader.exec_module(migration_script)


def _execute(conn, sql: str, params: tuple | None = None) -> None:
    if hasattr(conn, "exec_driver_sql"):
        conn.exec_driver_sql(sql, params or ())
    else:
        conn.execute(sql, params or ())


def _create_mail_user_preferences(conn) -> None:
    _execute(
        conn,
        """
        CREATE TABLE mail_user_preferences (
            user_id INTEGER PRIMARY KEY,
            prefs_json TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL
        )
        """
    )


def _create_user_mailboxes(conn) -> None:
    _execute(
        conn,
        """
        CREATE TABLE user_mailboxes (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            mailbox_email TEXT NOT NULL,
            mailbox_login TEXT NULL,
            mailbox_password_enc TEXT NOT NULL DEFAULT '',
            auth_mode TEXT NOT NULL DEFAULT 'stored_credentials',
            is_primary INTEGER NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            last_selected_at TEXT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (user_id, mailbox_email)
        )
        """
    )


def _seed_source(sqlite_path: Path) -> None:
    conn = sqlite3.connect(str(sqlite_path))
    try:
        _create_mail_user_preferences(conn)
        _create_user_mailboxes(conn)
        conn.execute(
            "INSERT INTO mail_user_preferences (user_id, prefs_json, updated_at) VALUES (?, ?, ?)",
            (7, '{"density":"compact"}', "2026-05-03T00:00:00+00:00"),
        )
        conn.execute(
            """
            INSERT INTO user_mailboxes
            (id, user_id, label, mailbox_email, mailbox_login, mailbox_password_enc, auth_mode,
             is_primary, is_active, sort_order, last_selected_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "mailbox-1",
                7,
                "Primary",
                "user@example.com",
                "user@example.com",
                "encrypted-secret",
                "stored_credentials",
                1,
                1,
                0,
                None,
                "2026-05-03T00:00:00+00:00",
                "2026-05-03T00:00:00+00:00",
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _seed_target(database_url: str) -> None:
    engine = create_engine(database_url, future=True)
    with engine.begin() as conn:
        _create_mail_user_preferences(conn)
        _create_user_mailboxes(conn)


def test_mail_sqlite_migration_dry_run_counts_without_writing(temp_dir):
    source_path = Path(temp_dir) / "legacy-mail.sqlite3"
    target_path = Path(temp_dir) / "target-mail.sqlite3"
    database_url = f"sqlite:///{target_path.as_posix()}"
    _seed_source(source_path)
    _seed_target(database_url)

    summary = migration_script.migrate_mail_sqlite_to_app_db(
        sqlite_path=source_path,
        database_url=database_url,
        execute=False,
    )

    assert summary["mail_user_preferences"] == {"read": 1, "inserted": 1, "updated": 0}
    assert summary["user_mailboxes"] == {"read": 1, "inserted": 1, "updated": 0}
    conn = sqlite3.connect(str(target_path))
    try:
        assert conn.execute("SELECT COUNT(*) FROM mail_user_preferences").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM user_mailboxes").fetchone()[0] == 0
    finally:
        conn.close()


def test_mail_sqlite_migration_execute_is_idempotent(temp_dir):
    source_path = Path(temp_dir) / "legacy-mail.sqlite3"
    target_path = Path(temp_dir) / "target-mail.sqlite3"
    database_url = f"sqlite:///{target_path.as_posix()}"
    _seed_source(source_path)
    _seed_target(database_url)

    first = migration_script.migrate_mail_sqlite_to_app_db(
        sqlite_path=source_path,
        database_url=database_url,
        execute=True,
    )
    second = migration_script.migrate_mail_sqlite_to_app_db(
        sqlite_path=source_path,
        database_url=database_url,
        execute=True,
    )

    assert first["mail_user_preferences"] == {"read": 1, "inserted": 1, "updated": 0}
    assert first["user_mailboxes"] == {"read": 1, "inserted": 1, "updated": 0}
    assert second["mail_user_preferences"] == {"read": 1, "inserted": 0, "updated": 1}
    assert second["user_mailboxes"] == {"read": 1, "inserted": 0, "updated": 1}
    conn = sqlite3.connect(str(target_path))
    try:
        assert conn.execute("SELECT COUNT(*) FROM mail_user_preferences").fetchone()[0] == 1
        mailbox = conn.execute("SELECT mailbox_password_enc FROM user_mailboxes").fetchone()
        assert mailbox[0] == "encrypted-secret"
    finally:
        conn.close()
