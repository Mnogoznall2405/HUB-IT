"""Portal-admin management of group conversations (separate from the member-facing rules).

A portal administrator may rescue and tidy a group *without* becoming a member and without
reading its content: assign the owner (typically when the owner is deactivated) and remove a
member. Every action is written to ``chat_group_admin_audit`` in the same transaction; when the
audit table is missing the action is refused so nothing happens unaudited. Ordinary chat paths
are not affected by any of this.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import TYPE_CHECKING, Any, Optional
from uuid import uuid4

from sqlalchemy import select

from backend.chat.chat_formatting import _display_user_name, _normalize_member_role, _utc_now
from backend.chat.db import chat_session
from backend.chat.models import (
    ChatConversation,
    ChatConversationUserState,
    ChatGroupAdminAudit,
    ChatMember,
)
from backend.chat.utils import normalize_text as _normalize_text

if TYPE_CHECKING:
    from backend.chat.service import ChatService

logger = logging.getLogger(__name__)

ACTION_ASSIGN_OWNER = "assign_owner"
ACTION_REMOVE_MEMBER = "remove_member"
ACTION_AUTO_ASSIGN_OWNER = "auto_assign_owner"
# Actions of the group's own owner and moderators (written by the member-facing services).
ACTION_MEMBERS_ADDED = "members_added"
ACTION_MEMBER_REMOVED = "member_removed"
ACTION_ROLE_CHANGED = "role_changed"
ACTION_OWNERSHIP_TRANSFERRED = "ownership_transferred"
ACTION_PROFILE_UPDATED = "profile_updated"
ACTION_OWNER_LEFT = "owner_left"
ACTION_INVITE_CREATED = "invite_created"
ACTION_INVITE_REVOKED = "invite_revoked"
ACTION_MEMBER_RESTRICTED = "member_restricted"
ACTION_RESTRICTION_LIFTED = "restriction_lifted"

_AUTO_SCAN_CAP = 500
_auto_run_lock = threading.Lock()

_TABLE_RECHECK_SEC = 30.0
_lock = threading.Lock()
_table_state: dict[str, Any] = {"available": None, "checked_at": 0.0}


def reset_runtime_state() -> None:
    with _lock:
        _table_state["available"] = None
        _table_state["checked_at"] = 0.0


def _audit_table_available(session) -> bool:
    now = time.monotonic()
    with _lock:
        available = _table_state["available"]
        checked_at = float(_table_state["checked_at"] or 0.0)
        if available is True or (available is False and now - checked_at < _TABLE_RECHECK_SEC):
            return bool(available)
    try:
        with session.begin_nested():
            session.execute(select(ChatGroupAdminAudit.id).limit(1)).first()
        result = True
    except Exception:
        result = False
    with _lock:
        _table_state["available"] = result
        _table_state["checked_at"] = now
    return result


def record_group_action(
    session,
    *,
    conversation_id: str,
    actor_user_id: int,
    action: str,
    target_user_id: Optional[int] = None,
    details: Optional[dict] = None,
) -> None:
    """Best-effort journal row for an owner/moderator action, in the caller transaction.

    Unlike portal-admin actions it never blocks the action: without the table (or on any error inside
    the savepoint) the row is skipped and the change goes through. Message text is never stored.
    """
    try:
        if not _audit_table_available(session):
            return
        with session.begin_nested():
            session.add(
                ChatGroupAdminAudit(
                    id=str(uuid4()),
                    conversation_id=_normalize_text(conversation_id),
                    actor_user_id=int(actor_user_id),
                    action=action,
                    target_user_id=int(target_user_id) if target_user_id else None,
                    details=json.dumps(details, ensure_ascii=False) if details else None,
                    created_at=_utc_now(),
                )
            )
    except Exception:
        logger.warning("chat_group_audit_skipped conversation_id=%s action=%s", conversation_id, action)


def _user_lookup():
    from backend.chat.service import user_service

    return user_service


class ChatGroupAdminService:
    def __init__(self, service: "ChatService") -> None:
        self._service = service

    # -- helpers -----------------------------------------------------------------------------

    def _require_admin(self, actor_user_id: int) -> dict:
        raw = _user_lookup().get_by_id(int(actor_user_id)) or {}
        if _normalize_text(raw.get("role")).lower() != "admin" or not bool(raw.get("is_active", True)):
            raise PermissionError("Portal administrator access denied")
        return raw

    def _record(
        self,
        session,
        *,
        conversation_id: str,
        actor_user_id: int,
        action: str,
        target_user_id: Optional[int],
        details: Optional[dict] = None,
    ) -> None:
        session.add(
            ChatGroupAdminAudit(
                id=str(uuid4()),
                conversation_id=_normalize_text(conversation_id),
                actor_user_id=int(actor_user_id),
                action=action,
                target_user_id=int(target_user_id) if target_user_id else None,
                details=json.dumps(details, ensure_ascii=False) if details else None,
                created_at=_utc_now(),
            )
        )

    def _group_view(self, session, conversation: ChatConversation) -> dict:
        """Structure only: members and roles. No messages and no previews."""
        rows = session.execute(
            select(ChatMember.user_id, ChatMember.member_role).where(
                ChatMember.conversation_id == conversation.id,
                ChatMember.left_at.is_(None),
            )
        ).all()
        users = _user_lookup()
        members: list[dict] = []
        owner_user_id = None
        for user_id, member_role in rows:
            raw = users.get_by_id(int(user_id)) or {}
            role = _normalize_member_role(member_role)
            if role == "owner":
                owner_user_id = int(user_id)
            members.append({
                "user_id": int(user_id),
                "full_name": _display_user_name(raw),
                "member_role": role,
                "is_active": bool(raw.get("is_active", True)) if raw else False,
            })
        owner_active = any(m["member_role"] == "owner" and m["is_active"] for m in members)
        return {
            "id": conversation.id,
            "title": _normalize_text(conversation.title),
            "member_count": len(members),
            "owner_user_id": owner_user_id,
            "owner_active": owner_active,
            "members": members,
        }

    def _load_group_for_write(self, session, conversation_id: str) -> ChatConversation:
        conversation = self._service._lock_conversation_for_write(session=session, conversation_id=conversation_id)
        if _normalize_text(conversation.kind) != "group":
            raise ValueError("Group conversation required")
        if not _audit_table_available(session):
            raise ValueError("Журнал действий администратора станет доступен после обновления базы данных")
        return conversation

    # -- read --------------------------------------------------------------------------------

    def list_groups_without_active_owner(self, *, actor_user_id: int, limit: int = 100) -> list[dict]:
        """Built from the owner side, so a stale group is found however many groups exist."""
        self._require_admin(actor_user_id)
        limit = max(1, int(limit))
        with chat_session() as session:
            owner_rows = session.execute(
                select(ChatMember.conversation_id, ChatMember.user_id)
                .join(ChatConversation, ChatConversation.id == ChatMember.conversation_id)
                .where(
                    ChatConversation.kind == "group",
                    ChatMember.member_role == "owner",
                    ChatMember.left_at.is_(None),
                )
            ).all()
            owners_by_conversation: dict[str, list[int]] = {}
            for conversation_id, user_id in owner_rows:
                owners_by_conversation.setdefault(str(conversation_id), []).append(int(user_id))

            users_map = _user_lookup().get_users_map_by_ids(
                {owner_id for owners in owners_by_conversation.values() for owner_id in owners}
            ) or {}
            inactive_owner_ids = {
                owner_id
                for owners in owners_by_conversation.values()
                for owner_id in owners
                if not users_map.get(owner_id) or not bool(users_map[owner_id].get("is_active", True))
            }
            candidate_ids = {
                conversation_id
                for conversation_id, owners in owners_by_conversation.items()
                if all(owner_id in inactive_owner_ids for owner_id in owners)
            }
            has_active_owner_row = (
                select(ChatMember.id)
                .where(
                    ChatMember.conversation_id == ChatConversation.id,
                    ChatMember.member_role == "owner",
                    ChatMember.left_at.is_(None),
                )
                .exists()
            )
            candidate_ids.update(
                str(row[0])
                for row in session.execute(
                    select(ChatConversation.id).where(
                        ChatConversation.kind == "group",
                        ~has_active_owner_row,
                    )
                ).all()
            )
            if not candidate_ids:
                return []
            groups = session.execute(
                select(ChatConversation.id, ChatConversation.title)
                .where(ChatConversation.id.in_(sorted(candidate_ids)))
                .order_by(ChatConversation.updated_at.desc())
                .limit(limit)
            ).all()
            return [
                {
                    "id": str(conversation_id),
                    "title": _normalize_text(title),
                    "owner_user_ids": owners_by_conversation.get(str(conversation_id), []),
                }
                for conversation_id, title in groups
            ]

    def list_group_activity(self, *, current_user_id: int, conversation_id: str, limit: int = 50) -> list[dict]:
        """Journal for the group owner and moderators (not for plain members)."""
        with chat_session() as session:
            conversation, _actor = self._service._require_group_manager(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            if not _audit_table_available(session):
                return []
            rows = session.execute(
                select(ChatGroupAdminAudit)
                .where(ChatGroupAdminAudit.conversation_id == conversation.id)
                .order_by(ChatGroupAdminAudit.created_at.desc())
                .limit(max(1, min(int(limit), 200)))
            ).scalars().all()
            user_ids = {int(row.actor_user_id) for row in rows} | {
                int(row.target_user_id) for row in rows if row.target_user_id
            }
            users_map = (_user_lookup().get_users_map_by_ids(user_ids) or {}) if user_ids else {}

            def _name(user_id: Optional[int]) -> str:
                if not user_id:
                    return ""
                return _display_user_name(users_map.get(int(user_id)) or {}) or f"№{int(user_id)}"

            return [
                {
                    "id": row.id,
                    "action": row.action,
                    "actor_user_id": int(row.actor_user_id),
                    "actor_name": _name(int(row.actor_user_id)),
                    "target_user_id": int(row.target_user_id) if row.target_user_id else None,
                    "target_name": _name(int(row.target_user_id)) if row.target_user_id else "",
                    "details": json.loads(row.details) if row.details else None,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                for row in rows
            ]

    def get_group_structure(self, *, actor_user_id: int, conversation_id: str) -> dict:
        self._require_admin(actor_user_id)
        with chat_session() as session:
            conversation = session.get(ChatConversation, _normalize_text(conversation_id))
            if conversation is None or _normalize_text(conversation.kind) != "group":
                raise LookupError("Conversation not found")
            return self._group_view(session, conversation)

    def list_audit(self, *, actor_user_id: int, conversation_id: str, limit: int = 50) -> list[dict]:
        self._require_admin(actor_user_id)
        with chat_session() as session:
            if not _audit_table_available(session):
                return []
            rows = session.execute(
                select(ChatGroupAdminAudit)
                .where(ChatGroupAdminAudit.conversation_id == _normalize_text(conversation_id))
                .order_by(ChatGroupAdminAudit.created_at.desc())
                .limit(max(1, min(int(limit), 200)))
            ).scalars().all()
            return [
                {
                    "id": row.id,
                    "actor_user_id": int(row.actor_user_id),
                    "action": row.action,
                    "target_user_id": int(row.target_user_id) if row.target_user_id else None,
                    "details": json.loads(row.details) if row.details else None,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                for row in rows
            ]

    # -- write -------------------------------------------------------------------------------

    def _apply_owner_change(
        self,
        session,
        *,
        conversation: ChatConversation,
        target_member: ChatMember,
        actor_user_id: int,
        body: str,
        action: str,
    ) -> tuple[bool, set[int]]:
        """Make ``target_member`` the sole owner (previous owners become moderators), post the system
        message and write the audit row in the caller's transaction."""
        next_owner_user_id = int(target_member.user_id)
        owners = session.execute(
            select(ChatMember).where(
                ChatMember.conversation_id == conversation.id,
                ChatMember.member_role == "owner",
                ChatMember.left_at.is_(None),
            )
        ).scalars().all()
        previous_owner_ids = sorted(
            int(item.user_id) for item in owners if int(item.user_id) != next_owner_user_id
        )
        if _normalize_member_role(target_member.member_role) == "owner" and not previous_owner_ids:
            return False, set()
        now = _utc_now()
        for previous in owners:
            if int(previous.user_id) != next_owner_user_id:
                previous.member_role = "moderator"
        target_member.member_role = "owner"
        session.flush()
        member_ids = self._service._conversation_member_ids(session, conversation.id)
        self._service._system_message_persistence.append_system_message(
            session=session,
            conversation=conversation,
            actor_user_id=int(actor_user_id),
            body=body,
            member_user_ids=member_ids,
            now=now,
            actor_is_member=False,
        )
        self._record(
            session,
            conversation_id=conversation.id,
            actor_user_id=int(actor_user_id),
            action=action,
            target_user_id=next_owner_user_id,
            details={"previous_owner_user_ids": previous_owner_ids},
        )
        session.flush()
        return True, {int(item) for item in member_ids}

    def assign_group_owner(self, *, actor_user_id: int, conversation_id: str, owner_user_id: int) -> dict:
        actor_raw = self._require_admin(actor_user_id)
        next_owner_user_id = int(owner_user_id)
        if next_owner_user_id <= 0:
            raise ValueError("owner_user_id is required")

        affected_user_ids: set[int] = set()
        changed = False
        with chat_session() as session:
            conversation = self._load_group_for_write(session, conversation_id)
            target_member = self._service._get_active_membership(
                session=session,
                conversation_id=conversation.id,
                user_id=next_owner_user_id,
            )
            if target_member is None:
                raise LookupError("New owner must be an active group member")
            target = self._service._require_active_user(next_owner_user_id)

            changed, affected_user_ids = self._apply_owner_change(
                session,
                conversation=conversation,
                target_member=target_member,
                actor_user_id=int(actor_user_id),
                body=(
                    f"Администратор портала {_display_user_name(actor_raw)} "
                    f"назначил(а) владельцем: {_display_user_name(target)}"
                ),
                action=ACTION_ASSIGN_OWNER,
            )
            view = self._group_view(session, conversation)

        if changed:
            self._service._invalidate_conversation_views_for_users(
                conversation_id=_normalize_text(conversation_id),
                user_ids=sorted(affected_user_ids),
            )
        return view

    @staticmethod
    def auto_owner_enabled() -> bool:
        return _normalize_text(os.getenv("CHAT_GROUP_AUTO_OWNER_ENABLED")).lower() in {"1", "true", "yes", "on"}

    def _pick_successor(self, session, conversation_id: str) -> Optional[int]:
        """An active moderator first, then the longest-standing active member; None if nobody fits."""
        rows = session.execute(
            select(ChatMember.user_id, ChatMember.member_role, ChatMember.joined_at).where(
                ChatMember.conversation_id == conversation_id,
                ChatMember.left_at.is_(None),
            )
        ).all()
        candidates = [
            (int(user_id), _normalize_member_role(role), joined_at)
            for user_id, role, joined_at in rows
            if _normalize_member_role(role) != "owner"
        ]
        if not candidates:
            return None
        users_map = _user_lookup().get_users_map_by_ids({item[0] for item in candidates}) or {}
        active = [
            item for item in candidates
            if users_map.get(item[0]) and bool(users_map[item[0]].get("is_active", True))
        ]
        if not active:
            return None
        active.sort(key=lambda item: (
            0 if item[1] == "moderator" else 1,
            item[2].isoformat() if item[2] is not None else "",
            item[0],
        ))
        return active[0][0]

    def auto_assign_owners(self, *, actor_user_id: int, dry_run: bool = True, batch_size: int = 25) -> dict:
        """Give a group without an active owner to its best active member.

        Dry run is always allowed and changes nothing. A real run needs CHAT_GROUP_AUTO_OWNER_ENABLED,
        handles at most ``batch_size`` groups, one run at a time per process, and re-checks every group
        under its write lock, so a repeated or concurrent run assigns each group once (idempotent).
        Every assignment is audited with the triggering administrator as actor.
        """
        self._require_admin(actor_user_id)
        batch_size = max(1, min(int(batch_size), 100))
        enabled = self.auto_owner_enabled()
        if not dry_run and not enabled:
            raise ValueError("Автоназначение владельцев выключено (CHAT_GROUP_AUTO_OWNER_ENABLED)")
        result: dict[str, Any] = {
            "dry_run": bool(dry_run),
            "enabled": enabled,
            "planned": [],
            "assigned": 0,
            "skipped_no_candidate": 0,
            "skipped_already_has_owner": 0,
            "failed": 0,
            "more_available": False,
        }
        if not _auto_run_lock.acquire(blocking=False):
            raise ValueError("Автоназначение уже выполняется, повторите позже")
        started = time.monotonic()
        try:
            groups = self.list_groups_without_active_owner(actor_user_id=actor_user_id, limit=_AUTO_SCAN_CAP)
            touched = 0
            for group in groups:
                if touched >= batch_size:
                    result["more_available"] = True
                    break
                conversation_id = str(group["id"])
                try:
                    outcome = self._auto_assign_one(
                        conversation_id=conversation_id,
                        title=group.get("title") or "",
                        actor_user_id=int(actor_user_id),
                        dry_run=bool(dry_run),
                    )
                except Exception:
                    logger.exception("chat_group_auto_owner_failed conversation_id=%s", conversation_id)
                    result["failed"] += 1
                    touched += 1
                    continue
                if outcome["status"] == "no_candidate":
                    result["skipped_no_candidate"] += 1
                    continue
                if outcome["status"] == "has_owner":
                    result["skipped_already_has_owner"] += 1
                    continue
                touched += 1
                if outcome["status"] == "assigned":
                    result["assigned"] += 1
                result["planned"].append(outcome["plan"])
        finally:
            _auto_run_lock.release()
        logger.info(
            "chat_group_auto_owner_run dry_run=%s assigned=%s planned=%s no_candidate=%s failed=%s ms=%.1f",
            dry_run,
            result["assigned"],
            len(result["planned"]),
            result["skipped_no_candidate"],
            result["failed"],
            (time.monotonic() - started) * 1000.0,
        )
        return result

    def _auto_assign_one(self, *, conversation_id: str, title: str, actor_user_id: int, dry_run: bool) -> dict:
        affected: set[int] = set()
        with chat_session() as session:
            if dry_run:
                conversation = session.get(ChatConversation, conversation_id)
                if conversation is None or _normalize_text(conversation.kind) != "group":
                    return {"status": "no_candidate"}
            else:
                conversation = self._load_group_for_write(session, conversation_id)
            view = self._group_view(session, conversation)
            if view["owner_active"]:
                return {"status": "has_owner"}
            successor_id = self._pick_successor(session, conversation.id)
            if successor_id is None:
                return {"status": "no_candidate"}
            names = {int(m["user_id"]): m["full_name"] for m in view["members"]}
            successor_name = names.get(int(successor_id), "")
            plan = {
                "conversation_id": conversation.id,
                "title": title or _normalize_text(conversation.title),
                "successor_user_id": int(successor_id),
                "successor_name": successor_name,
            }
            if dry_run:
                return {"status": "planned", "plan": plan}
            target_member = self._service._get_active_membership(
                session=session, conversation_id=conversation.id, user_id=int(successor_id)
            )
            if target_member is None:
                return {"status": "no_candidate"}
            changed, affected = self._apply_owner_change(
                session,
                conversation=conversation,
                target_member=target_member,
                actor_user_id=int(actor_user_id),
                body=f"Владелец беседы отключён: владельцем автоматически назначен(а) {successor_name}".strip(),
                action=ACTION_AUTO_ASSIGN_OWNER,
            )
        if changed:
            self._service._invalidate_conversation_views_for_users(
                conversation_id=conversation_id, user_ids=sorted(affected)
            )
        return {"status": "assigned", "plan": plan}

    def remove_group_member(self, *, actor_user_id: int, conversation_id: str, target_user_id: int) -> dict:
        actor_raw = self._require_admin(actor_user_id)
        normalized_target = int(target_user_id)
        if normalized_target <= 0:
            raise ValueError("target_user_id is required")

        affected_user_ids: set[int] = {normalized_target}
        changed = False
        with chat_session() as session:
            conversation = self._load_group_for_write(session, conversation_id)
            target_member = self._service._get_active_membership(
                session=session,
                conversation_id=conversation.id,
                user_id=normalized_target,
            )
            if target_member is not None:
                if _normalize_member_role(target_member.member_role) == "owner":
                    raise PermissionError("Assign a new owner before removing the current one")
                changed = True
                target = _user_lookup().get_by_id(normalized_target) or {}
                now = _utc_now()
                target_member.left_at = now
                session.flush()
                member_ids_after = self._service._conversation_member_ids(session, conversation.id)
                affected_user_ids.update(member_ids_after)
                self._service._system_message_persistence.append_system_message(
                    session=session,
                    conversation=conversation,
                    actor_user_id=int(actor_user_id),
                    body=(
                        f"Администратор портала {_display_user_name(actor_raw)} "
                        f"исключил(а) {_display_user_name(target)}"
                    ),
                    member_user_ids=member_ids_after,
                    now=now,
                    actor_is_member=False,
                )
                state = self._service._get_or_create_conversation_state(
                    session=session,
                    conversation_id=conversation.id,
                    current_user_id=normalized_target,
                )
                self._advance_state(state, conversation, now)
                self._record(
                    session,
                    conversation_id=conversation.id,
                    actor_user_id=int(actor_user_id),
                    action=ACTION_REMOVE_MEMBER,
                    target_user_id=normalized_target,
                )
                session.flush()
            view = self._group_view(session, conversation)

        if changed:
            self._service._invalidate_conversation_views_for_users(
                conversation_id=_normalize_text(conversation_id),
                user_ids=sorted(affected_user_ids),
                hard_drop_unread=True,
            )
        return {"group": view, "removed": changed, "removed_user_id": normalized_target}

    @staticmethod
    def _advance_state(state: ChatConversationUserState, conversation: ChatConversation, now) -> None:
        state.last_read_message_id = conversation.last_message_id
        state.last_read_seq = max(0, int(conversation.last_message_seq or 0))
        state.last_read_at = conversation.last_message_at
        state.unread_count = 0
        state.unread_mention_count = 0
        state.updated_at = now
