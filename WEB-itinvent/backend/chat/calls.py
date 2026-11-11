"""Voice/video calls of a conversation on top of LiveKit (self-hosted SFU).

The media goes through LiveKit; this module only keeps the call state in PostgreSQL (``chat_calls``,
``chat_call_participants``, Alembic 20261005_0126) and hands out LiveKit join tokens.

Design:
- one not-ended call per conversation: a partial unique index makes two parallel "start call" requests
  safe (the loser gets ``call_already_active``);
- every state transition (join / decline / leave / timeout) runs in one short transaction that first
  takes the call row lock (a touching ``UPDATE``, which is also a write lock on SQLite) and then
  re-reads the state, so repeated and concurrent requests are idempotent and cannot lose an update;
- the ring timeout (and a long-call safety net) is lazy: any read/join/leave of a stale call ends it.
  There are no background workers, so any number of processes is fine;
- nothing is published or serialized with user lookups inside a transaction: the service returns the
  events to publish and the route publishes them after the HTTP response is prepared;
- LiveKit secrets come from the environment only and are never logged.
"""
from __future__ import annotations

import logging
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from backend.chat.chat_formatting import _display_user_name
from backend.chat.db import chat_session
from backend.chat.livekit_token import build_livekit_token
from backend.chat.models import ChatCall, ChatCallParticipant, ChatConversation, ChatMember
from backend.chat.utils import normalize_text as _normalize_text
from backend.services.user_service import user_service

logger = logging.getLogger(__name__)

STATUS_RINGING = "ringing"
STATUS_ACTIVE = "active"
STATUS_ENDED = "ended"

STATE_INVITED = "invited"
STATE_JOINED = "joined"
STATE_DECLINED = "declined"
STATE_LEFT = "left"

REASON_COMPLETED = "completed"
REASON_DECLINED = "declined"
REASON_MISSED = "missed"
REASON_CANCELLED = "cancelled"

MEDIA_KINDS = ("audio", "video")
CALLABLE_CONVERSATION_KINDS = ("direct", "group")

ERROR_NOT_CONFIGURED = "calls_not_configured"
ERROR_ALREADY_ACTIVE = "call_already_active"
ERROR_CALL_ENDED = "call_ended"

EVENT_INVITE = "chat.call.invite"
EVENT_UPDATED = "chat.call.updated"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: Optional[datetime]) -> Optional[str]:
    normalized = _as_utc(value)
    return normalized.isoformat() if normalized else None


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(_normalize_text(os.getenv(name), str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def _env_flag(name: str) -> bool:
    return _normalize_text(os.getenv(name), "0").lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class CallsSettings:
    url: str
    api_key: str
    api_secret: str = field(repr=False)
    ring_timeout_sec: int = 45
    token_ttl_sec: int = 3600
    max_duration_sec: int = 21600


def get_calls_settings() -> Optional[CallsSettings]:
    """Settings when calls are enabled AND fully configured, otherwise None. Read on every call."""
    if not _env_flag("CALLS_ENABLED"):
        return None
    url = _normalize_text(os.getenv("LIVEKIT_URL"))
    api_key = _normalize_text(os.getenv("LIVEKIT_API_KEY"))
    api_secret = _normalize_text(os.getenv("LIVEKIT_API_SECRET"))
    if not (url and api_key and api_secret):
        return None
    return CallsSettings(
        url=url,
        api_key=api_key,
        api_secret=api_secret,
        ring_timeout_sec=_env_int("CALLS_RING_TIMEOUT_SEC", 45, 5, 600),
        token_ttl_sec=_env_int("CALLS_TOKEN_TTL_SEC", 3600, 60, 86400),
        # Safety net for a call nobody ended explicitly (crashed browsers): there is no LiveKit webhook.
        max_duration_sec=_env_int("CALLS_MAX_DURATION_SEC", 21600, 600, 172800),
    )


def calls_available() -> bool:
    return get_calls_settings() is not None


class CallsNotConfigured(RuntimeError):
    """Calls are switched off or LiveKit is not configured."""


@dataclass
class CallEvent:
    event_type: str
    conversation_id: str
    user_ids: list[int]
    payload: dict[str, Any]


@dataclass
class CallOutcome:
    """Result of one operation: the call to answer with and the events to publish afterwards."""

    call: Optional[dict[str, Any]] = None
    events: list[CallEvent] = field(default_factory=list)
    error: Optional[str] = None  # call_already_active | call_ended
    token: Optional[str] = None
    url: Optional[str] = None


class ChatCallService:
    # ------------------------------------------------------------------ public API (sync, threadpool)
    def create_call(self, *, current_user_id: int, conversation_id: str, media: str) -> CallOutcome:
        settings = self._require_settings()
        user_id = int(current_user_id)
        if media not in MEDIA_KINDS:
            raise ValueError("media must be 'audio' or 'video'")
        events_raw: list[tuple] = []
        error: Optional[str] = None
        current: Optional[dict[str, Any]] = None
        for attempt in (1, 2):
            events_raw, error, current = [], None, None
            try:
                with chat_session() as session:
                    now = _utc_now()
                    conversation = self._require_member(session, conversation_id, user_id)
                    kind = _normalize_text(conversation.kind)
                    if kind not in CALLABLE_CONVERSATION_KINDS:
                        raise ValueError("Calls are available in direct and group conversations only")
                    existing_id = session.execute(
                        select(ChatCall.id).where(
                            ChatCall.conversation_id == conversation.id,
                            ChatCall.status != STATUS_ENDED,
                        )
                    ).scalar_one_or_none()
                    if existing_id:
                        existing = self._lock_call(session, existing_id)
                        if existing is not None and self._expire_if_stale(session, existing, now, settings):
                            events_raw.append(self._updated_event(session, existing))
                        if existing is not None and existing.status != STATUS_ENDED:
                            current = self._snapshot(session, existing)
                            error = ERROR_ALREADY_ACTIVE
                    if error is None:
                        member_ids = self._member_ids(session, conversation.id)
                        invitees = sorted(item for item in member_ids if item != user_id)
                        if not invitees:
                            raise ValueError("There is nobody to call in this conversation")
                        call = ChatCall(
                            id=str(uuid.uuid4()),
                            conversation_id=conversation.id,
                            conversation_kind=kind,
                            media=media,
                            status=STATUS_RINGING,
                            initiator_user_id=user_id,
                            started_at=now,
                            updated_at=now,
                        )
                        session.add(call)
                        session.flush()
                        session.add(
                            ChatCallParticipant(call_id=call.id, user_id=user_id, state=STATE_JOINED, joined_at=now)
                        )
                        for invitee in invitees:
                            session.add(ChatCallParticipant(call_id=call.id, user_id=invitee, state=STATE_INVITED))
                        session.flush()
                        current = self._snapshot(session, call)
                        events_raw.append((EVENT_INVITE, current, invitees, True))
                        events_raw.append(self._updated_event_for(current))
                break
            except IntegrityError:
                # Lost the race against another "start call": the partial unique index refused us.
                if attempt == 2:
                    raise
                continue
        self._log("create", (current or {}).get("id", ""), user_id, current)
        return self._finish(
            current=current,
            error=error,
            events_raw=events_raw,
            token_user_id=user_id if error is None else None,
            settings=settings,
        )

    def join_call(self, *, current_user_id: int, call_id: str) -> CallOutcome:
        settings = self._require_settings()
        user_id = int(current_user_id)
        events_raw: list[tuple] = []
        error: Optional[str] = None
        with chat_session() as session:
            now = _utc_now()
            call = self._load_locked(session, call_id, user_id)
            expired = self._expire_if_stale(session, call, now, settings)
            if call.status == STATUS_ENDED:
                error = ERROR_CALL_ENDED
                if expired:
                    events_raw.append(self._updated_event(session, call))
            else:
                changed = False
                participant = self._participant(session, call.id, user_id)
                if participant is None:
                    session.add(ChatCallParticipant(call_id=call.id, user_id=user_id, state=STATE_JOINED, joined_at=now))
                    changed = True
                elif participant.state != STATE_JOINED:
                    participant.state = STATE_JOINED
                    participant.joined_at = now
                    participant.left_at = None
                    changed = True
                if call.status == STATUS_RINGING and user_id != int(call.initiator_user_id):
                    call.status = STATUS_ACTIVE
                    call.answered_at = now
                    changed = True
                if changed:
                    call.updated_at = now
                    session.flush()
                    events_raw.append(self._updated_event(session, call))
            current = self._snapshot(session, call)
        self._log("join", call_id, user_id, current)
        return self._finish(
            current=current, error=error, events_raw=events_raw,
            token_user_id=user_id if error is None else None, settings=settings,
        )

    def decline_call(self, *, current_user_id: int, call_id: str) -> CallOutcome:
        settings = self._require_settings()
        user_id = int(current_user_id)
        events_raw: list[tuple] = []
        with chat_session() as session:
            now = _utc_now()
            call = self._load_locked(session, call_id, user_id)
            changed = self._expire_if_stale(session, call, now, settings)
            if call.status != STATUS_ENDED:
                participant = self._participant(session, call.id, user_id)
                if participant is not None and participant.state == STATE_INVITED:
                    participant.state = STATE_DECLINED
                    changed = True
                    session.flush()
                    if call.status == STATUS_RINGING:
                        if _normalize_text(call.conversation_kind) == "direct":
                            self._end(session, call, REASON_DECLINED, now)
                        else:
                            states = [item.state for item in self._participants(session, call.id)]
                            if STATE_INVITED not in states:  # nobody left to answer
                                self._end(session, call, REASON_DECLINED, now)
                    call.updated_at = now
                    session.flush()
            if changed:
                events_raw.append(self._updated_event(session, call))
            current = self._snapshot(session, call)
        self._log("decline", call_id, user_id, current)
        return self._finish(current=current, error=None, events_raw=events_raw, token_user_id=None, settings=settings)

    def leave_call(self, *, current_user_id: int, call_id: str) -> CallOutcome:
        settings = self._require_settings()
        user_id = int(current_user_id)
        events_raw: list[tuple] = []
        with chat_session() as session:
            now = _utc_now()
            call = self._load_locked(session, call_id, user_id)
            changed = self._expire_if_stale(session, call, now, settings)
            if call.status != STATUS_ENDED:
                participant = self._participant(session, call.id, user_id)
                if participant is not None and participant.state == STATE_JOINED:
                    participant.state = STATE_LEFT
                    participant.left_at = now
                    changed = True
                    session.flush()
                    if call.status == STATUS_RINGING and user_id == int(call.initiator_user_id):
                        self._end(session, call, REASON_CANCELLED, now)
                    elif not any(item.state == STATE_JOINED for item in self._participants(session, call.id)):
                        self._end(session, call, REASON_COMPLETED, now)
                    call.updated_at = now
                    session.flush()
            if changed:
                events_raw.append(self._updated_event(session, call))
            current = self._snapshot(session, call)
        self._log("leave", call_id, user_id, current)
        return self._finish(current=current, error=None, events_raw=events_raw, token_user_id=None, settings=settings)

    def get_active_call(self, *, current_user_id: int, conversation_id: str) -> CallOutcome:
        settings = self._require_settings()
        user_id = int(current_user_id)
        events_raw: list[tuple] = []
        current: Optional[dict[str, Any]] = None
        with chat_session() as session:
            now = _utc_now()
            conversation = self._require_member(session, conversation_id, user_id)
            call_id = session.execute(
                select(ChatCall.id).where(
                    ChatCall.conversation_id == conversation.id,
                    ChatCall.status != STATUS_ENDED,
                )
            ).scalar_one_or_none()
            if call_id:
                call = self._lock_call(session, call_id)
                if call is not None:
                    if self._expire_if_stale(session, call, now, settings):
                        events_raw.append(self._updated_event(session, call))
                    if call.status != STATUS_ENDED:
                        current = self._snapshot(session, call)
        return self._finish(current=current, error=None, events_raw=events_raw, token_user_id=None, settings=settings)

    # ------------------------------------------------------------------ internals
    @staticmethod
    def _require_settings() -> CallsSettings:
        settings = get_calls_settings()
        if settings is None:
            raise CallsNotConfigured("Calls are not configured")
        return settings

    @staticmethod
    def _log(action: str, call_id: str, user_id: int, snapshot: Optional[dict[str, Any]]) -> None:
        logger.info(
            "chat_call stage=%s call_id=%s user_id=%s status=%s end_reason=%s",
            action, call_id, user_id,
            (snapshot or {}).get("status"), (snapshot or {}).get("end_reason"),
        )

    @staticmethod
    def _require_member(session, conversation_id: str, user_id: int) -> ChatConversation:
        conversation = session.get(ChatConversation, _normalize_text(conversation_id))
        if conversation is None or bool(conversation.is_archived):
            raise LookupError("Conversation not found")
        membership = session.execute(
            select(ChatMember.id).where(
                ChatMember.conversation_id == conversation.id,
                ChatMember.user_id == int(user_id),
                ChatMember.left_at.is_(None),
            )
        ).first()
        if membership is None:
            raise PermissionError("Conversation access denied")
        return conversation

    @staticmethod
    def _member_ids(session, conversation_id: str) -> list[int]:
        return sorted(
            int(item)
            for item in session.execute(
                select(ChatMember.user_id).where(
                    ChatMember.conversation_id == conversation_id,
                    ChatMember.left_at.is_(None),
                )
            ).scalars()
        )

    @staticmethod
    def _lock_call(session, call_id: str) -> Optional[ChatCall]:
        """Row lock + fresh state. The touching UPDATE is the lock on SQLite too (SELECT ... FOR UPDATE is
        a no-op there); on PostgreSQL it queues concurrent transitions and the re-read sees their result."""
        touched = session.execute(
            update(ChatCall).where(ChatCall.id == call_id).values(updated_at=_utc_now())
        ).rowcount
        if not touched:
            return None
        return session.execute(
            select(ChatCall)
            .where(ChatCall.id == call_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one()

    def _load_locked(self, session, call_id: str, user_id: int) -> ChatCall:
        normalized = _normalize_text(call_id)
        found = session.get(ChatCall, normalized) if normalized else None
        if found is None:
            raise LookupError("Call not found")
        self._require_member(session, found.conversation_id, user_id)
        call = self._lock_call(session, normalized)
        if call is None:
            raise LookupError("Call not found")
        return call

    @staticmethod
    def _participants(session, call_id: str) -> list[ChatCallParticipant]:
        return list(
            session.execute(
                select(ChatCallParticipant)
                .where(ChatCallParticipant.call_id == call_id)
                .order_by(ChatCallParticipant.id)
                .execution_options(populate_existing=True)
            ).scalars()
        )

    @staticmethod
    def _participant(session, call_id: str, user_id: int) -> Optional[ChatCallParticipant]:
        return session.execute(
            select(ChatCallParticipant)
            .where(ChatCallParticipant.call_id == call_id, ChatCallParticipant.user_id == int(user_id))
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()

    def _end(self, session, call: ChatCall, reason: str, now: datetime) -> None:
        call.status = STATUS_ENDED
        call.ended_at = now
        call.end_reason = reason
        call.updated_at = now
        for participant in self._participants(session, call.id):
            if participant.state == STATE_JOINED:
                participant.state = STATE_LEFT
                participant.left_at = now
        session.flush()

    def _expire_if_stale(self, session, call: ChatCall, now: datetime, settings: CallsSettings) -> bool:
        """Lazy timeouts (the call row is locked by the caller). True when the call was ended here."""
        if call.status == STATUS_RINGING:
            started = _as_utc(call.started_at) or now
            if now - started >= timedelta(seconds=settings.ring_timeout_sec):
                self._end(session, call, REASON_MISSED, now)
                return True
        elif call.status == STATUS_ACTIVE:
            since = _as_utc(call.answered_at) or _as_utc(call.started_at) or now
            if now - since >= timedelta(seconds=settings.max_duration_sec):
                self._end(session, call, REASON_COMPLETED, now)
                return True
        return False

    def _snapshot(self, session, call: ChatCall) -> dict[str, Any]:
        """Plain data (no ORM objects, no user lookups) that can leave the transaction."""
        session.flush()
        participants = self._participants(session, call.id)
        return {
            "id": call.id,
            "conversation_id": call.conversation_id,
            "media": call.media,
            "status": call.status,
            "initiator_user_id": int(call.initiator_user_id),
            "started_at": _iso(call.started_at),
            "answered_at": _iso(call.answered_at),
            "ended_at": _iso(call.ended_at),
            "end_reason": call.end_reason,
            "updated_at": _iso(call.updated_at),
            "participants": [{"user_id": int(item.user_id), "state": item.state} for item in participants],
            "_member_ids": self._member_ids(session, call.conversation_id),
        }

    @staticmethod
    def _updated_event_for(snapshot: dict[str, Any]) -> tuple:
        recipients = sorted({*snapshot["_member_ids"], *(item["user_id"] for item in snapshot["participants"])})
        return (EVENT_UPDATED, snapshot, recipients, False)

    def _updated_event(self, session, call: ChatCall) -> tuple:
        return self._updated_event_for(self._snapshot(session, call))

    # ------------------------------------------------------------------ rendering (outside transactions)
    def _finish(
        self,
        *,
        current: Optional[dict[str, Any]],
        error: Optional[str],
        events_raw: list[tuple],
        token_user_id: Optional[int],
        settings: CallsSettings,
    ) -> CallOutcome:
        user_ids: set[int] = set()
        for snapshot in [current, *(item[1] for item in events_raw)]:
            for participant in (snapshot or {}).get("participants", []):
                user_ids.add(int(participant["user_id"]))
        if token_user_id:
            user_ids.add(int(token_user_id))
        users = self._users_by_id(user_ids)

        def render(snapshot: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
            if snapshot is None:
                return None
            payload = {key: value for key, value in snapshot.items() if not key.startswith("_")}
            payload["participants"] = [
                {
                    "user_id": item["user_id"],
                    "display_name": _display_user_name(users.get(item["user_id"])),
                    "state": item["state"],
                }
                for item in snapshot["participants"]
            ]
            return payload

        events: list[CallEvent] = []
        for event_type, snapshot, recipients, with_initiator in events_raw:
            body: dict[str, Any] = {"call": render(snapshot)}
            if with_initiator:
                initiator_id = int(snapshot["initiator_user_id"])
                body["initiator"] = {
                    "user_id": initiator_id,
                    "display_name": _display_user_name(users.get(initiator_id)),
                }
            events.append(
                CallEvent(
                    event_type=event_type,
                    conversation_id=snapshot["conversation_id"],
                    user_ids=list(recipients),
                    payload=body,
                )
            )
        outcome = CallOutcome(call=render(current), events=events, error=error)
        if token_user_id and current is not None:
            outcome.token = build_livekit_token(
                api_key=settings.api_key,
                api_secret=settings.api_secret,
                identity=str(int(token_user_id)),
                name=_display_user_name(users.get(int(token_user_id))),
                room=current["id"],
                ttl_sec=settings.token_ttl_sec,
            )
            outcome.url = settings.url
        return outcome

    @staticmethod
    def _users_by_id(user_ids: set[int]) -> dict[int, dict]:
        if not user_ids:
            return {}
        try:
            return dict(user_service.get_users_map_by_ids(sorted(user_ids)) or {})
        except Exception:  # a failed name lookup must not break the call
            logger.warning("chat_call stage=user_lookup_failed", exc_info=True)
            return {}


chat_call_service = ChatCallService()
