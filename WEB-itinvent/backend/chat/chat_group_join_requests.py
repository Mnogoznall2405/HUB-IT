"""Join requests of group invite links (``chat_group_join_requests``, ``chat_group_join_settings``).

A manager switches a group to "join by approval": a person who opens the invite link then leaves a
request instead of entering, and the owner and moderators approve or reject it. A request is one row
per (group, person): repeating it changes nothing, and a rejected person is not let back through the
link (a manager adds them by hand, as with people who left). Both tables arrive with an explicit
release migration; until then the switch answers 400, the link keeps working as before and the chat
is otherwise unaffected.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional
from uuid import uuid4

from sqlalchemy import func, select

from backend.chat.chat_formatting import _display_user_name
from backend.chat.chat_group_admin import (
    ACTION_JOIN_POLICY_CHANGED,
    ACTION_JOIN_REQUEST_APPROVED,
    ACTION_JOIN_REQUEST_REJECTED,
    record_group_action,
)
from backend.chat.db import chat_session
from backend.chat.models import ChatGroupJoinRequest, ChatGroupJoinSettings, ChatMember, utcnow
from backend.chat.utils import normalize_text as _normalize_text

if TYPE_CHECKING:
    from backend.chat.service import ChatService

DECISIONS = ("approve", "reject")
MAX_OPEN_REQUESTS_LISTED = 100
TABLE_MISSING_MESSAGE = "Заявки на вступление станут доступны после обновления базы данных"
MANAGERS_ONLY_MESSAGE = "Заявки разбирают только владелец и модераторы группы"
REJECTED_MESSAGE = "Ваша заявка в эту группу отклонена: попросите владельца или модератора добавить вас"

_TABLE_RECHECK_SEC = 30.0
_lock = threading.Lock()
_table_state: dict = {"available": None, "checked_at": 0.0}


def reset_runtime_state() -> None:
    """Forget the cached table probe (used after migrations and in tests)."""
    with _lock:
        _table_state["available"] = None
        _table_state["checked_at"] = 0.0


def join_tables_available(session) -> bool:
    now = time.monotonic()
    with _lock:
        available = _table_state["available"]
        checked_at = float(_table_state["checked_at"] or 0.0)
        if available is True or (available is False and now - checked_at < _TABLE_RECHECK_SEC):
            return bool(available)
    try:
        # A savepoint keeps the surrounding transaction usable if a table is missing.
        with session.begin_nested():
            session.execute(select(ChatGroupJoinSettings.conversation_id).limit(1)).first()
            session.execute(select(ChatGroupJoinRequest.id).limit(1)).first()
        result = True
    except Exception:
        result = False
    with _lock:
        _table_state["available"] = result
        _table_state["checked_at"] = now
    return result


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value is not None else None


def approval_required(session, conversation_id: str) -> bool:
    """Whether the invite link of the group leads to a request; False while the tables are missing."""
    if not join_tables_available(session):
        return False
    row = session.get(ChatGroupJoinSettings, _normalize_text(conversation_id))
    return bool(row is not None and row.approval_required)


def find_request(session, conversation_id: str, user_id: int) -> Optional[ChatGroupJoinRequest]:
    if not join_tables_available(session):
        return None
    return session.execute(
        select(ChatGroupJoinRequest).where(
            ChatGroupJoinRequest.conversation_id == _normalize_text(conversation_id),
            ChatGroupJoinRequest.user_id == int(user_id),
        )
    ).scalar_one_or_none()


def submit_request(session, conversation_id: str, user_id: int) -> ChatGroupJoinRequest:
    """Leave (or find) the person's request; a rejected person gets a refusal instead."""
    existing = find_request(session, conversation_id, user_id)
    if existing is not None:
        if existing.status == "rejected":
            raise PermissionError(REJECTED_MESSAGE)
        if existing.status == "pending":
            return existing
        # An approved request of someone who is no longer a member starts over.
        existing.status = "pending"
        existing.created_at = utcnow()
        existing.resolved_by_user_id = None
        existing.resolved_at = None
        session.flush()
        return existing
    request = ChatGroupJoinRequest(
        id=str(uuid4()),
        conversation_id=_normalize_text(conversation_id),
        user_id=int(user_id),
        status="pending",
        created_at=utcnow(),
    )
    session.add(request)
    session.flush()
    return request


class ChatGroupJoinRequests:
    def __init__(self, service: "ChatService") -> None:
        self._service = service

    def _require_manager(self, session, conversation, current_user_id: int) -> None:
        try:
            self._service._require_group_manager(
                session=session,
                conversation_id=conversation.id,
                current_user_id=current_user_id,
            )
        except PermissionError as exc:
            raise PermissionError(MANAGERS_ONLY_MESSAGE) from exc

    def list_requests(self, *, current_user_id: int, conversation_id: str) -> dict[str, Any]:
        with chat_session() as session:
            conversation = self._service._require_membership(
                session=session,
                conversation_id=conversation_id,
                current_user_id=int(current_user_id),
            )
            if _normalize_text(conversation.kind) != "group":
                raise ValueError("Заявки доступны только в группах")
            self._require_manager(session, conversation, int(current_user_id))
            if not join_tables_available(session):
                return {"items": [], "open_count": 0, "approval_required": False}
            rows = session.execute(
                select(ChatGroupJoinRequest)
                .where(
                    ChatGroupJoinRequest.conversation_id == conversation.id,
                    ChatGroupJoinRequest.status == "pending",
                )
                .order_by(ChatGroupJoinRequest.created_at.asc())
                .limit(MAX_OPEN_REQUESTS_LISTED)
            ).scalars().all()
            open_count = int(
                session.execute(
                    select(func.count(ChatGroupJoinRequest.id)).where(
                        ChatGroupJoinRequest.conversation_id == conversation.id,
                        ChatGroupJoinRequest.status == "pending",
                    )
                ).scalar_one()
                or 0
            )
            users = (
                self._service._get_users_map(presence_map={}, user_ids={int(row.user_id) for row in rows})
                if rows
                else {}
            )
            items = []
            for row in rows:
                user = users.get(int(row.user_id)) or {}
                items.append(
                    {
                        "id": row.id,
                        "user_id": int(row.user_id),
                        "user_name": (
                            _normalize_text(user.get("full_name"))
                            or _normalize_text(user.get("username"))
                            or f"Пользователь {row.user_id}"
                        ),
                        "created_at": _iso(row.created_at),
                    }
                )
            return {
                "items": items,
                "open_count": open_count,
                "approval_required": approval_required(session, conversation.id),
            }

    def set_approval_required(
        self, *, current_user_id: int, conversation_id: str, approval_required: bool
    ) -> dict[str, Any]:
        with chat_session() as session:
            self._service._require_membership(
                session=session, conversation_id=conversation_id, current_user_id=int(current_user_id)
            )
            conversation = self._service._lock_conversation_for_write(
                session=session, conversation_id=conversation_id
            )
            if _normalize_text(conversation.kind) != "group":
                raise ValueError("Заявки доступны только в группах")
            self._require_manager(session, conversation, int(current_user_id))
            if not join_tables_available(session):
                raise ValueError(TABLE_MISSING_MESSAGE)
            now = utcnow()
            row = session.get(ChatGroupJoinSettings, conversation.id)
            changed = row is None or bool(row.approval_required) != bool(approval_required)
            if row is None:
                session.add(
                    ChatGroupJoinSettings(
                        conversation_id=conversation.id,
                        approval_required=bool(approval_required),
                        updated_by_user_id=int(current_user_id),
                        updated_at=now,
                    )
                )
            else:
                row.approval_required = bool(approval_required)
                row.updated_by_user_id = int(current_user_id)
                row.updated_at = now
            if changed:
                record_group_action(
                    session,
                    conversation_id=conversation.id,
                    actor_user_id=int(current_user_id),
                    action=ACTION_JOIN_POLICY_CHANGED,
                    details={"approval_required": bool(approval_required)},
                )
            session.flush()
            return {"approval_required": bool(approval_required)}

    def resolve_request(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        request_id: str,
        decision: str,
    ) -> dict[str, Any]:
        normalized = _normalize_text(decision).lower()
        if normalized not in DECISIONS:
            raise ValueError("Недопустимое решение по заявке")
        added = False
        affected_user_ids: set[int] = set()
        with chat_session() as session:
            self._service._require_membership(
                session=session, conversation_id=conversation_id, current_user_id=int(current_user_id)
            )
            conversation = self._service._lock_conversation_for_write(
                session=session, conversation_id=conversation_id
            )
            self._require_manager(session, conversation, int(current_user_id))
            if not join_tables_available(session):
                raise ValueError(TABLE_MISSING_MESSAGE)
            request = session.get(ChatGroupJoinRequest, _normalize_text(request_id))
            if request is None or request.conversation_id != conversation.id:
                raise LookupError("Join request not found")
            if request.status != "pending":
                # Someone else decided first: report the outcome instead of repeating it.
                return {"id": request.id, "status": request.status, "added": False}
            now = utcnow()
            request.resolved_by_user_id = int(current_user_id)
            request.resolved_at = now
            if normalized == "reject":
                request.status = "rejected"
                record_group_action(
                    session,
                    conversation_id=conversation.id,
                    actor_user_id=int(current_user_id),
                    action=ACTION_JOIN_REQUEST_REJECTED,
                    target_user_id=int(request.user_id),
                )
                session.flush()
                return {"id": request.id, "status": "rejected", "added": False}

            member = session.execute(
                select(ChatMember).where(
                    ChatMember.conversation_id == conversation.id,
                    ChatMember.user_id == int(request.user_id),
                )
            ).scalar_one_or_none()
            if member is None:
                member_ids = self._service._conversation_member_ids(session, conversation.id)
                if len(member_ids) + 1 > self._service.group_max_members:
                    raise ValueError(f"Group member limit exceeded ({self._service.group_max_members})")
                user = self._service._require_active_user(int(request.user_id))
                self._service._group_invite_service.add_member_from_link(
                    session=session,
                    conversation=conversation,
                    user_id=int(request.user_id),
                    user=user,
                    body=f"{_display_user_name(user)} принят(а) в группу по заявке",
                    now=now,
                    affected_user_ids=affected_user_ids,
                )
                added = True
            elif member.left_at is not None:
                raise PermissionError("Этот человек уже выходил из группы: добавьте его вручную")
            request.status = "approved"
            record_group_action(
                session,
                conversation_id=conversation.id,
                actor_user_id=int(current_user_id),
                action=ACTION_JOIN_REQUEST_APPROVED,
                target_user_id=int(request.user_id),
            )
            session.flush()
            result = {"id": request.id, "status": "approved", "added": added}
            conversation_key = conversation.id
        if added:
            self._service._invalidate_conversation_views_for_users(
                conversation_id=_normalize_text(conversation_key),
                user_ids=sorted(affected_user_ids),
            )
        return result
