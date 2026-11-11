from __future__ import annotations

from contextvars import ContextVar, Token


_request_session_id: ContextVar[str | None] = ContextVar("itinvent_request_session_id", default=None)


def get_request_session_id() -> str | None:
    value = str(_request_session_id.get() or "").strip()
    return value or None


def push_request_session_id(session_id: str | None) -> Token:
    normalized = str(session_id or "").strip() or None
    return _request_session_id.set(normalized)


def pop_request_session_id(token: Token) -> None:
    _request_session_id.reset(token)
