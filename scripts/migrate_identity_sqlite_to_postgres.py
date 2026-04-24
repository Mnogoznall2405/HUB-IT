from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate internal identity/settings data from local SQLite store to PostgreSQL.")
    parser.add_argument("--database-url", help="Target APP_DATABASE_URL. If omitted, current APP_DATABASE_URL env is used.")
    parser.add_argument("--data-dir", help="Source local_store data directory. Defaults to <repo>/data.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_root = Path(__file__).resolve().parents[1]
    web_root = project_root / "WEB-itinvent"

    if args.database_url:
        os.environ["APP_DATABASE_URL"] = str(args.database_url).strip()

    if str(web_root) not in sys.path:
        sys.path.insert(0, str(web_root))
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    from backend.appdb.db import app_session, initialize_app_schema, ensure_app_database_configured
    from backend.appdb.models import (
        AppGlobalSetting,
        AppSessionRecord,
        AppUser,
        AppUserDatabaseSelection,
        AppUserSetting,
    )
    from local_store import SQLiteLocalStore

    def parse_dt(value):
        text = str(value or "").strip()
        if not text:
            return None
        return datetime.fromisoformat(text)

    ensure_app_database_configured()
    initialize_app_schema()

    data_dir = Path(args.data_dir) if args.data_dir else project_root / "data"
    store = SQLiteLocalStore(data_dir=data_dir)

    users = store.load_json("web_users.json", default_content=[])
    sessions = store.load_json("web_sessions.json", default_content=[])
    user_settings = store.load_json("web_user_settings.json", default_content={})
    app_settings = store.load_json("web_app_settings.json", default_content={})
    db_selection = store.load_json("user_db_selection.json", default_content={})

    if not isinstance(users, list):
        users = []
    if not isinstance(sessions, list):
        sessions = []
    if not isinstance(user_settings, dict):
        user_settings = {}
    if not isinstance(app_settings, dict):
        app_settings = {}
    if not isinstance(db_selection, dict):
        db_selection = {}

    with app_session() as session:
        session.query(AppUserDatabaseSelection).delete()
        session.query(AppGlobalSetting).delete()
        session.query(AppUserSetting).delete()
        session.query(AppSessionRecord).delete()
        session.query(AppUser).delete()

        for payload in users:
            try:
                custom_permissions_json = json.dumps(payload.get("custom_permissions") or [], ensure_ascii=False)
            except Exception:
                custom_permissions_json = "[]"
            session.add(AppUser(
                id=int(payload.get("id", 0) or 0),
                username=str(payload.get("username") or ""),
                email=payload.get("email"),
                full_name=payload.get("full_name"),
                is_active=bool(payload.get("is_active", True)),
                role=str(payload.get("role") or "viewer"),
                use_custom_permissions=bool(payload.get("use_custom_permissions", False)),
                custom_permissions_json=custom_permissions_json,
                auth_source=str(payload.get("auth_source") or "local"),
                telegram_id=int(payload.get("telegram_id")) if payload.get("telegram_id") not in (None, "") else None,
                assigned_database=(str(payload.get("assigned_database") or "").strip() or None),
                mailbox_email=(str(payload.get("mailbox_email") or "").strip() or None),
                mailbox_login=(str(payload.get("mailbox_login") or "").strip() or None),
                mailbox_password_enc=str(payload.get("mailbox_password_enc") or ""),
                mail_signature_html=(str(payload.get("mail_signature_html") or "").strip() or None),
                mail_updated_at=parse_dt(payload.get("mail_updated_at")),
                password_hash=str(payload.get("password_hash") or ""),
                password_salt=str(payload.get("password_salt") or ""),
                created_at=parse_dt(payload.get("created_at")) or datetime.now().astimezone(),
                updated_at=parse_dt(payload.get("updated_at")) or datetime.now().astimezone(),
            ))

        for payload in sessions:
            session.add(AppSessionRecord(
                session_id=str(payload.get("session_id") or ""),
                user_id=int(payload.get("user_id", 0) or 0),
                username=str(payload.get("username") or ""),
                role=str(payload.get("role") or "viewer"),
                ip_address=str(payload.get("ip_address") or ""),
                user_agent=str(payload.get("user_agent") or ""),
                created_at=parse_dt(payload.get("created_at")) or datetime.now().astimezone(),
                last_seen_at=parse_dt(payload.get("last_seen_at")) or datetime.now().astimezone(),
                expires_at=parse_dt(payload.get("expires_at")) or datetime.now().astimezone(),
                idle_expires_at=parse_dt(payload.get("idle_expires_at")),
                is_active=bool(payload.get("is_active", True)),
                status=str(payload.get("status") or "active"),
                closed_at=parse_dt(payload.get("closed_at")),
                closed_reason=(str(payload.get("closed_reason") or "").strip() or None),
                device_label=(str(payload.get("device_label") or "").strip() or None),
            ))

        for key, payload in user_settings.items():
            try:
                user_id = int(key)
            except (TypeError, ValueError):
                continue
            if not isinstance(payload, dict):
                payload = {}
            session.add(AppUserSetting(
                user_id=user_id,
                pinned_database=(str(payload.get("pinned_database") or "").strip() or None),
                theme_mode=str(payload.get("theme_mode") or "light"),
                font_family=str(payload.get("font_family") or "Inter"),
                font_scale=float(payload.get("font_scale") or 1.0),
            ))

        for key, value in app_settings.items():
            normalized_key = str(key).strip()
            if not normalized_key:
                continue
            session.add(AppGlobalSetting(
                key=normalized_key,
                value_json=json.dumps(value, ensure_ascii=False),
            ))

        for key, value in db_selection.items():
            try:
                telegram_id = int(key)
            except (TypeError, ValueError):
                continue
            database_id = str(value or "").strip()
            if not database_id:
                continue
            session.add(AppUserDatabaseSelection(
                telegram_id=telegram_id,
                database_id=database_id,
            ))

    print("Identity/settings migration completed:")
    print(f"  users={len(users)}")
    print(f"  sessions={len(sessions)}")
    print(f"  user_settings={len(user_settings)}")
    print(f"  app_settings={len(app_settings)}")
    print(f"  user_db_selection={len(db_selection)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
