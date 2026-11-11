from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate built-in chat data from SQLite into PostgreSQL chat schema.")
    parser.add_argument("--source-db-path", required=True, help="Path to the source SQLite chat database file.")
    parser.add_argument("--target-database-url", help="Target PostgreSQL URL. Defaults to CHAT_DATABASE_URL / APP_DATABASE_URL env.")
    return parser.parse_args()


def _parse_dt(value: Any):
    text = str(value or "").strip()
    if not text:
        return None
    return datetime.fromisoformat(text)


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value in (None, ""):
        return False
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _fetch_rows_if_exists(conn: sqlite3.Connection, table_name: str):
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1",
        (table_name,),
    ).fetchone()
    if not exists:
        return []
    return conn.execute(f"SELECT * FROM {table_name}").fetchall()


def main() -> int:
    args = parse_args()
    project_root = Path(__file__).resolve().parents[1]
    web_root = project_root / "WEB-itinvent"
    source_db_path = Path(args.source_db_path).expanduser().resolve()

    if not source_db_path.exists():
        raise SystemExit(f"Source SQLite database does not exist: {source_db_path}")

    if args.target_database_url:
        os.environ["CHAT_DATABASE_URL"] = str(args.target_database_url).strip()
        os.environ.setdefault("CHAT_MODULE_ENABLED", "1")

    if str(web_root) not in sys.path:
        sys.path.insert(0, str(web_root))
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    from backend.config import reload_runtime_config

    reload_runtime_config()

    from backend.chat.db import chat_session, ensure_chat_configured, initialize_chat_schema
    from backend.chat.models import (
        ChatConversation,
        ChatConversationUserState,
        ChatMember,
        ChatMessage,
        ChatMessageAttachment,
        ChatMessageRead,
        ChatPushSubscription,
    )

    ensure_chat_configured()
    initialize_chat_schema()

    source = sqlite3.connect(str(source_db_path), timeout=30, check_same_thread=False)
    source.row_factory = sqlite3.Row

    conversation_rows = _fetch_rows_if_exists(source, "chat_conversations")
    member_rows = _fetch_rows_if_exists(source, "chat_members")
    message_rows = _fetch_rows_if_exists(source, "chat_messages")
    attachment_rows = _fetch_rows_if_exists(source, "chat_message_attachments")
    read_rows = _fetch_rows_if_exists(source, "chat_message_reads")
    user_state_rows = _fetch_rows_if_exists(source, "chat_conversation_user_state")
    push_rows = _fetch_rows_if_exists(source, "chat_push_subscriptions")

    with chat_session() as session:
        session.query(ChatPushSubscription).delete()
        session.query(ChatConversationUserState).delete()
        session.query(ChatMessageRead).delete()
        session.query(ChatMessageAttachment).delete()
        session.query(ChatMessage).delete()
        session.query(ChatMember).delete()
        session.query(ChatConversation).delete()

        for row in conversation_rows:
            payload = dict(row)
            session.add(ChatConversation(
                id=str(payload.get("id") or ""),
                kind=str(payload.get("kind") or "direct"),
                direct_key=(str(payload.get("direct_key") or "").strip() or None),
                title=(str(payload.get("title") or "").strip() or None),
                created_by_user_id=int(payload.get("created_by_user_id", 0) or 0),
                created_at=_parse_dt(payload.get("created_at")) or datetime.now().astimezone(),
                updated_at=_parse_dt(payload.get("updated_at")) or datetime.now().astimezone(),
                last_message_id=(str(payload.get("last_message_id") or "").strip() or None),
                last_message_at=_parse_dt(payload.get("last_message_at")),
                is_archived=_as_bool(payload.get("is_archived")),
            ))

        for row in member_rows:
            payload = dict(row)
            session.add(ChatMember(
                id=int(payload.get("id", 0) or 0),
                conversation_id=str(payload.get("conversation_id") or ""),
                user_id=int(payload.get("user_id", 0) or 0),
                member_role=str(payload.get("member_role") or "member"),
                joined_at=_parse_dt(payload.get("joined_at")) or datetime.now().astimezone(),
                left_at=_parse_dt(payload.get("left_at")),
            ))

        for row in message_rows:
            payload = dict(row)
            session.add(ChatMessage(
                id=str(payload.get("id") or ""),
                conversation_id=str(payload.get("conversation_id") or ""),
                sender_user_id=int(payload.get("sender_user_id", 0) or 0),
                kind=str(payload.get("kind") or "text"),
                body=str(payload.get("body") or ""),
                reply_to_message_id=(str(payload.get("reply_to_message_id") or "").strip() or None),
                task_id=(str(payload.get("task_id") or "").strip() or None),
                task_preview_json=(str(payload.get("task_preview_json") or "").strip() or None),
                created_at=_parse_dt(payload.get("created_at")) or datetime.now().astimezone(),
                edited_at=_parse_dt(payload.get("edited_at")),
            ))

        for row in attachment_rows:
            payload = dict(row)
            session.add(ChatMessageAttachment(
                id=str(payload.get("id") or ""),
                message_id=str(payload.get("message_id") or ""),
                conversation_id=str(payload.get("conversation_id") or ""),
                storage_name=str(payload.get("storage_name") or ""),
                file_name=str(payload.get("file_name") or ""),
                mime_type=(str(payload.get("mime_type") or "").strip() or None),
                file_size=int(payload.get("file_size", 0) or 0),
                uploaded_by_user_id=int(payload.get("uploaded_by_user_id", 0) or 0),
                created_at=_parse_dt(payload.get("created_at")) or datetime.now().astimezone(),
            ))

        for row in read_rows:
            payload = dict(row)
            session.add(ChatMessageRead(
                id=int(payload.get("id", 0) or 0),
                conversation_id=str(payload.get("conversation_id") or ""),
                user_id=int(payload.get("user_id", 0) or 0),
                message_id=str(payload.get("message_id") or ""),
                read_at=_parse_dt(payload.get("read_at")) or datetime.now().astimezone(),
            ))

        for row in user_state_rows:
            payload = dict(row)
            session.add(ChatConversationUserState(
                id=int(payload.get("id", 0) or 0),
                conversation_id=str(payload.get("conversation_id") or ""),
                user_id=int(payload.get("user_id", 0) or 0),
                last_read_message_id=(str(payload.get("last_read_message_id") or "").strip() or None),
                last_read_at=_parse_dt(payload.get("last_read_at")),
                is_pinned=_as_bool(payload.get("is_pinned")),
                is_muted=_as_bool(payload.get("is_muted")),
                is_archived=_as_bool(payload.get("is_archived")),
                opened_at=_parse_dt(payload.get("opened_at")),
                updated_at=_parse_dt(payload.get("updated_at")) or datetime.now().astimezone(),
            ))

        for row in push_rows:
            payload = dict(row)
            session.add(ChatPushSubscription(
                id=int(payload.get("id", 0) or 0),
                user_id=int(payload.get("user_id", 0) or 0),
                endpoint=str(payload.get("endpoint") or ""),
                p256dh_key=str(payload.get("p256dh_key") or ""),
                auth_key=str(payload.get("auth_key") or ""),
                expiration_time=int(payload.get("expiration_time")) if payload.get("expiration_time") not in (None, "") else None,
                user_agent=(str(payload.get("user_agent") or "").strip() or None),
                platform=(str(payload.get("platform") or "").strip() or None),
                browser_family=(str(payload.get("browser_family") or "").strip() or None),
                install_mode=(str(payload.get("install_mode") or "").strip() or None),
                is_active=_as_bool(payload.get("is_active")),
                failure_count=int(payload.get("failure_count", 0) or 0),
                created_at=_parse_dt(payload.get("created_at")) or datetime.now().astimezone(),
                updated_at=_parse_dt(payload.get("updated_at")) or datetime.now().astimezone(),
                last_seen_at=_parse_dt(payload.get("last_seen_at")),
                last_push_at=_parse_dt(payload.get("last_push_at")),
                last_error_at=_parse_dt(payload.get("last_error_at")),
                last_error_text=(str(payload.get("last_error_text") or "").strip() or None),
            ))

    source.close()

    print("Chat migration completed:")
    print(f"  conversations={len(conversation_rows)}")
    print(f"  members={len(member_rows)}")
    print(f"  messages={len(message_rows)}")
    print(f"  attachments={len(attachment_rows)}")
    print(f"  message_reads={len(read_rows)}")
    print(f"  conversation_user_state={len(user_state_rows)}")
    print(f"  push_subscriptions={len(push_rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
