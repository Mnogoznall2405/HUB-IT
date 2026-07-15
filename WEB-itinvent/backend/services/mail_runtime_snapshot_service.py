"""PostgreSQL-backed snapshot store shared by mail worker and API processes."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select

from backend.appdb.db import app_session, is_app_database_configured
from backend.appdb.models import AppMailRuntimeSnapshot


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_scope(value: Any, default: str) -> str:
    return str(value or "").strip() or default


class MailRuntimeSnapshotService:
    def __init__(self, database_url: str | None = None) -> None:
        self._database_url = str(database_url or "").strip() or None
        self._enabled = bool(self._database_url) or is_app_database_configured()

    def _find(self, session, *, user_id: int, mailbox_id: str, snapshot_type: str, context_key: str):
        return session.scalar(
            select(AppMailRuntimeSnapshot).where(
                AppMailRuntimeSnapshot.user_id == int(user_id),
                AppMailRuntimeSnapshot.mailbox_id == mailbox_id,
                AppMailRuntimeSnapshot.snapshot_type == snapshot_type,
                AppMailRuntimeSnapshot.context_key == context_key,
            )
        )

    def read(
        self,
        *,
        user_id: int,
        mailbox_id: str | None,
        snapshot_type: str,
        context_key: str = "default",
    ) -> dict[str, Any]:
        if not self._enabled:
            return {"state": "unknown", "source": "app_snapshot", "payload": None, "as_of": None, "last_error": "app database unavailable"}
        mailbox_scope = _normalize_scope(mailbox_id, "aggregate")
        context_scope = _normalize_scope(context_key, "default")
        with app_session(self._database_url) as session:
            row = self._find(
                session,
                user_id=int(user_id),
                mailbox_id=mailbox_scope,
                snapshot_type=snapshot_type,
                context_key=context_scope,
            )
            if row is None:
                return {"state": "unknown", "source": "app_snapshot", "payload": None, "as_of": None, "last_error": ""}
            try:
                payload = json.loads(str(row.payload_json or "{}"))
            except (TypeError, ValueError, json.JSONDecodeError):
                payload = None
            now = _utcnow()
            expires_at = row.expires_at
            if expires_at is not None and expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            state = "ok"
            if str(row.status or "ok") == "error":
                state = "error"
            elif expires_at is not None and expires_at < now:
                state = "stale"
            return {
                "state": state,
                "source": "app_snapshot",
                "payload": payload,
                "as_of": row.as_of.isoformat() if row.as_of else None,
                "expires_at": row.expires_at.isoformat() if row.expires_at else None,
                "last_error": str(row.last_error or ""),
            }

    def write_success(
        self,
        *,
        user_id: int,
        mailbox_id: str | None,
        snapshot_type: str,
        payload: dict[str, Any],
        context_key: str = "default",
        ttl_seconds: int = 90,
    ) -> dict[str, Any]:
        if not self._enabled:
            return {"state": "unknown", "source": "app_snapshot", "payload": payload}
        mailbox_scope = _normalize_scope(mailbox_id, "aggregate")
        context_scope = _normalize_scope(context_key, "default")
        now = _utcnow()
        with app_session(self._database_url) as session:
            self._write_success_row(
                session,
                user_id=int(user_id),
                mailbox_id=mailbox_scope,
                snapshot_type=snapshot_type,
                context_key=context_scope,
                payload=payload,
                ttl_seconds=ttl_seconds,
                now=now,
            )
        return {"state": "ok", "source": "app_snapshot", "payload": payload, "as_of": now.isoformat()}

    def _write_success_row(
        self,
        session,
        *,
        user_id: int,
        mailbox_id: str,
        snapshot_type: str,
        context_key: str,
        payload: dict[str, Any],
        ttl_seconds: int,
        now: datetime,
    ) -> None:
        values = {
            "user_id": int(user_id),
            "mailbox_id": mailbox_id,
            "snapshot_type": snapshot_type,
            "context_key": context_key,
            "payload_json": json.dumps(payload or {}, ensure_ascii=False, separators=(",", ":")),
            "status": "ok",
            "last_error": "",
            "as_of": now,
            "expires_at": now + timedelta(seconds=max(1, int(ttl_seconds or 90))),
            "created_at": now,
            "updated_at": now,
        }
        if self._execute_atomic_upsert(
            session,
            values=values,
            update_fields=("payload_json", "status", "last_error", "as_of", "expires_at", "updated_at"),
        ):
            return

        row = self._find(session, user_id=user_id, mailbox_id=mailbox_id, snapshot_type=snapshot_type, context_key=context_key)
        if row is None:
            row = AppMailRuntimeSnapshot(**values)
            session.add(row)
            return
        for field_name in ("payload_json", "status", "last_error", "as_of", "expires_at", "updated_at"):
            setattr(row, field_name, values[field_name])

    @staticmethod
    def _execute_atomic_upsert(session, *, values: dict[str, Any], update_fields: tuple[str, ...]) -> bool:
        dialect_name = str(session.get_bind().dialect.name or "").lower()
        if dialect_name == "postgresql":
            from sqlalchemy.dialects.postgresql import insert
        elif dialect_name == "sqlite":
            from sqlalchemy.dialects.sqlite import insert
        else:
            return False

        table = AppMailRuntimeSnapshot.__table__
        statement = insert(table).values(**values)
        statement = statement.on_conflict_do_update(
            index_elements=[
                table.c.user_id,
                table.c.mailbox_id,
                table.c.snapshot_type,
                table.c.context_key,
            ],
            set_={field_name: getattr(statement.excluded, field_name) for field_name in update_fields},
        )
        session.execute(statement)
        return True

    def _write_error_row(
        self,
        session,
        *,
        user_id: int,
        mailbox_id: str,
        snapshot_type: str,
        context_key: str,
        error: Any,
        now: datetime,
    ) -> None:
        values = {
            "user_id": int(user_id),
            "mailbox_id": mailbox_id,
            "snapshot_type": snapshot_type,
            "context_key": context_key,
            "payload_json": "{}",
            "status": "error",
            "last_error": str(error or "unknown mail error")[:4000],
            "as_of": None,
            "expires_at": None,
            "created_at": now,
            "updated_at": now,
        }
        if self._execute_atomic_upsert(
            session,
            values=values,
            update_fields=("status", "last_error", "updated_at"),
        ):
            return

        row = self._find(
            session,
            user_id=int(user_id),
            mailbox_id=mailbox_id,
            snapshot_type=snapshot_type,
            context_key=context_key,
        )
        if row is None:
            session.add(AppMailRuntimeSnapshot(**values))
            return
        row.status = "error"
        row.last_error = values["last_error"]
        row.updated_at = now

    def write_notification_cycle(self, *, user_id: int, feed: dict[str, Any], ttl_seconds: int = 90) -> None:
        if not self._enabled:
            return
        now = _utcnow()
        with app_session(self._database_url) as session:
            self._write_success_row(
                session,
                user_id=int(user_id),
                mailbox_id="aggregate",
                snapshot_type="unread",
                context_key="default",
                payload={"unread_count": int(feed.get("total_unread", 0) or 0)},
                ttl_seconds=ttl_seconds,
                now=now,
            )
            self._write_success_row(
                session,
                user_id=int(user_id),
                mailbox_id="aggregate",
                snapshot_type="notification_feed",
                context_key="default",
                payload=feed,
                ttl_seconds=ttl_seconds,
                now=now,
            )

    @staticmethod
    def _matches_read_target(item: Any, *, message_id: str, conversation_id: str) -> bool:
        if not isinstance(item, dict):
            return False
        normalized_message_id = str(message_id or "").strip()
        normalized_conversation_id = str(conversation_id or "").strip()
        if normalized_message_id and str(item.get("id") or item.get("message_id") or "").strip() == normalized_message_id:
            return True
        return bool(
            normalized_conversation_id
            and str(item.get("conversation_id") or "").strip() == normalized_conversation_id
        )

    @staticmethod
    def _adjust_unread(value: Any, delta: int) -> int:
        return max(0, int(value or 0) + int(delta or 0))

    def _apply_read_state_to_payload(
        self,
        *,
        snapshot_type: str,
        payload: dict[str, Any],
        unread_delta: int,
        is_read: bool,
        message_id: str,
        conversation_id: str,
        folder: str,
        mailbox_id: str,
    ) -> dict[str, Any]:
        next_payload = dict(payload or {})
        normalized_type = str(snapshot_type or "").strip()
        normalized_folder = str(folder or "").strip() or "inbox"

        if normalized_type == "unread":
            next_payload["unread_count"] = self._adjust_unread(next_payload.get("unread_count"), unread_delta)
            return next_payload

        if normalized_type == "notification_feed":
            next_payload["total_unread"] = self._adjust_unread(next_payload.get("total_unread"), unread_delta)
            next_payload["items"] = [
                ({**item, "is_read": bool(is_read)} if self._matches_read_target(
                    item,
                    message_id=message_id,
                    conversation_id=conversation_id,
                ) else item)
                for item in (next_payload.get("items") if isinstance(next_payload.get("items"), list) else [])
            ]
            return next_payload

        if normalized_type != "bootstrap":
            return next_payload

        if "unread_count" in next_payload:
            next_payload["unread_count"] = self._adjust_unread(next_payload.get("unread_count"), unread_delta)

        folder_summary = next_payload.get("folder_summary")
        if isinstance(folder_summary, dict) and isinstance(folder_summary.get(normalized_folder), dict):
            next_folder_summary = dict(folder_summary)
            next_folder = dict(next_folder_summary[normalized_folder])
            next_folder["unread"] = self._adjust_unread(next_folder.get("unread"), unread_delta)
            next_folder_summary[normalized_folder] = next_folder
            next_payload["folder_summary"] = next_folder_summary

        messages = next_payload.get("messages")
        if isinstance(messages, dict) and isinstance(messages.get("items"), list):
            next_messages = dict(messages)
            next_messages["items"] = [
                ({**item, "is_read": bool(is_read)} if self._matches_read_target(
                    item,
                    message_id=message_id,
                    conversation_id=conversation_id,
                ) else item)
                for item in messages["items"]
            ]
            next_payload["messages"] = next_messages

        normalized_mailbox_id = str(mailbox_id or "").strip()
        mailboxes = next_payload.get("mailboxes")
        if normalized_mailbox_id and isinstance(mailboxes, list):
            next_payload["mailboxes"] = [
                {
                    **item,
                    "unread_count": self._adjust_unread(item.get("unread_count"), unread_delta),
                }
                if isinstance(item, dict)
                and str(item.get("id") or item.get("mailbox_id") or "").strip() == normalized_mailbox_id
                and "unread_count" in item
                else item
                for item in mailboxes
            ]
        return next_payload

    def apply_read_state(
        self,
        *,
        user_id: int,
        mailbox_id: str | None,
        unread_delta: int,
        is_read: bool,
        message_id: str = "",
        conversation_id: str = "",
        folder: str = "inbox",
        ttl_seconds: int = 90,
    ) -> int:
        """Write a confirmed Exchange read-state mutation through shared snapshots."""
        if not self._enabled or int(unread_delta or 0) == 0:
            return 0
        mailbox_scope = _normalize_scope(mailbox_id, "aggregate")
        mailbox_scopes = {"aggregate", mailbox_scope}
        now = _utcnow()
        with app_session(self._database_url) as session:
            statement = select(AppMailRuntimeSnapshot).where(
                AppMailRuntimeSnapshot.user_id == int(user_id),
                AppMailRuntimeSnapshot.mailbox_id.in_(mailbox_scopes),
                AppMailRuntimeSnapshot.snapshot_type.in_(("unread", "notification_feed", "bootstrap")),
            )
            if str(session.get_bind().dialect.name or "").lower() == "postgresql":
                statement = statement.with_for_update()
            rows = list(session.scalars(statement).all())
            updated = 0
            for row in rows:
                try:
                    payload = json.loads(str(row.payload_json or "{}"))
                except (TypeError, ValueError, json.JSONDecodeError):
                    continue
                if not isinstance(payload, dict):
                    continue
                next_payload = self._apply_read_state_to_payload(
                    snapshot_type=str(row.snapshot_type or ""),
                    payload=payload,
                    unread_delta=int(unread_delta),
                    is_read=bool(is_read),
                    message_id=message_id,
                    conversation_id=conversation_id,
                    folder=folder,
                    mailbox_id=mailbox_scope,
                )
                row.payload_json = json.dumps(next_payload, ensure_ascii=False, separators=(",", ":"))
                row.updated_at = now
                updated += 1
            return updated

    def apply_preferences(self, *, user_id: int, preferences: dict[str, Any]) -> int:
        """Write confirmed user preferences through every cached bootstrap payload."""
        if not self._enabled or not isinstance(preferences, dict):
            return 0
        now = _utcnow()
        with app_session(self._database_url) as session:
            statement = select(AppMailRuntimeSnapshot).where(
                AppMailRuntimeSnapshot.user_id == int(user_id),
                AppMailRuntimeSnapshot.snapshot_type == "bootstrap",
            )
            if str(session.get_bind().dialect.name or "").lower() == "postgresql":
                statement = statement.with_for_update()
            rows = list(session.scalars(statement).all())
            updated = 0
            for row in rows:
                try:
                    payload = json.loads(str(row.payload_json or "{}"))
                except (TypeError, ValueError, json.JSONDecodeError):
                    continue
                if not isinstance(payload, dict):
                    continue
                payload["preferences"] = dict(preferences)
                row.payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                row.updated_at = now
                updated += 1
            return updated

    def record_error(
        self,
        *,
        user_id: int,
        mailbox_id: str | None,
        snapshot_type: str,
        error: Any,
        context_key: str = "default",
    ) -> None:
        if not self._enabled:
            return
        mailbox_scope = _normalize_scope(mailbox_id, "aggregate")
        context_scope = _normalize_scope(context_key, "default")
        now = _utcnow()
        with app_session(self._database_url) as session:
            self._write_error_row(
                session,
                user_id=int(user_id),
                mailbox_id=mailbox_scope,
                snapshot_type=snapshot_type,
                context_key=context_scope,
                error=error,
                now=now,
            )

    def record_notification_cycle_error(self, *, user_id: int, error: Any) -> None:
        if not self._enabled:
            return
        now = _utcnow()
        with app_session(self._database_url) as session:
            for snapshot_type in ("unread", "notification_feed"):
                self._write_error_row(
                    session,
                    user_id=int(user_id),
                    mailbox_id="aggregate",
                    snapshot_type=snapshot_type,
                    context_key="default",
                    error=error,
                    now=now,
                )

    def persist_notification_results(self, *, results: list[dict[str, Any]], ttl_seconds: int = 90) -> None:
        """Persist a whole worker batch in one transaction."""
        if not self._enabled or not results:
            return
        now = _utcnow()
        with app_session(self._database_url) as session:
            for result in results:
                user_id = int(result.get("user_id") or 0)
                if user_id <= 0:
                    continue
                error = result.get("error")
                if error is not None:
                    for snapshot_type in ("unread", "notification_feed"):
                        self._write_error_row(
                            session,
                            user_id=user_id,
                            mailbox_id="aggregate",
                            snapshot_type=snapshot_type,
                            context_key="default",
                            error=error,
                            now=now,
                        )
                    continue
                feed = result.get("feed") if isinstance(result.get("feed"), dict) else {}
                self._write_success_row(
                    session,
                    user_id=user_id,
                    mailbox_id="aggregate",
                    snapshot_type="unread",
                    context_key="default",
                    payload={"unread_count": int(feed.get("total_unread", 0) or 0)},
                    ttl_seconds=ttl_seconds,
                    now=now,
                )
                self._write_success_row(
                    session,
                    user_id=user_id,
                    mailbox_id="aggregate",
                    snapshot_type="notification_feed",
                    context_key="default",
                    payload=feed,
                    ttl_seconds=ttl_seconds,
                    now=now,
                )


mail_runtime_snapshot_service = MailRuntimeSnapshotService()
