"""WsSessionLease — in-socket re-auth (D5, variant б+)."""
from __future__ import annotations

import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from jose import jwt

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

import backend.chat.ws_auth as ws_auth  # noqa: E402
from backend.config import config  # noqa: E402
from backend.utils.security import create_access_token, create_ws_ticket  # noqa: E402


@pytest.fixture(autouse=True)
def live_session(monkeypatch):
    monkeypatch.setattr(ws_auth.session_service, "is_session_active", lambda sid: True)
    monkeypatch.setattr(
        ws_auth.session_service, "is_session_active_for_user", lambda sid, uid: True, raising=False
    )
    monkeypatch.setattr(ws_auth.session_service, "touch_session", lambda sid: None)
    monkeypatch.setattr(ws_auth.auth_runtime_store_service, "is_jti_revoked", lambda jti: False)


def _access(user_id=7, session_id="sess-1", seconds=900):
    return create_access_token(
        {"sub": f"user{user_id}", "user_id": user_id, "session_id": session_id},
        expires_delta=timedelta(seconds=seconds),
    )


def test_valid_token_stays_ok():
    lease = ws_auth.WsSessionLease(_access(), user_id=7)
    assert lease.revalidate() == "ok"


def test_expired_token_enters_grace_then_dead(monkeypatch):
    lease = ws_auth.WsSessionLease(_access(seconds=-60), user_id=7)
    assert lease.revalidate() == "grace"
    assert lease.revalidate() == "grace"
    lease.grace_deadline = time.monotonic() - 1
    assert lease.revalidate() == "dead"


def test_undecodable_token_is_dead():
    lease = ws_auth.WsSessionLease("not-a-jwt", user_id=7)
    assert lease.revalidate() == "dead"


def test_revoked_jti_is_dead_immediately(monkeypatch):
    monkeypatch.setattr(ws_auth.auth_runtime_store_service, "is_jti_revoked", lambda jti: True)
    lease = ws_auth.WsSessionLease(_access(seconds=-60), user_id=7)
    assert lease.revalidate() == "dead"


def test_inactive_session_is_dead_immediately(monkeypatch):
    monkeypatch.setattr(ws_auth.session_service, "is_session_active", lambda sid: False)
    monkeypatch.setattr(
        ws_auth.session_service, "is_session_active_for_user", lambda sid, uid: False, raising=False
    )
    lease = ws_auth.WsSessionLease(_access(seconds=-60), user_id=7)
    assert lease.revalidate() == "dead"


def test_fresh_access_token_rebinds_the_lease():
    lease = ws_auth.WsSessionLease(_access(seconds=-60), user_id=7)
    assert lease.revalidate() == "grace"
    assert lease.apply_auth_payload({"access_token": _access(seconds=900)}) is True
    assert lease.revalidate() == "ok"


def test_foreign_access_token_is_rejected():
    lease = ws_auth.WsSessionLease(_access(seconds=-60), user_id=7)
    assert lease.apply_auth_payload({"access_token": _access(user_id=99)}) is False
    assert lease.revalidate() == "grace"


def test_ws_ticket_extends_the_lease():
    lease = ws_auth.WsSessionLease(_access(seconds=-60), user_id=7)
    assert lease.revalidate() == "grace"
    ticket = create_ws_ticket(
        {"sub": "user7", "user_id": 7, "session_id": "sess-1"},
        expires_delta=timedelta(seconds=300),
    )
    assert lease.apply_auth_payload({"ws_ticket": ticket}) is True
    # The bound access token is still expired but proof extended the lease.
    assert lease.revalidate() == "ok"


def test_ws_ticket_of_another_user_is_rejected():
    lease = ws_auth.WsSessionLease(_access(seconds=-60), user_id=7)
    ticket = create_ws_ticket(
        {"sub": "user99", "user_id": 99, "session_id": "sess-9"},
        expires_delta=timedelta(seconds=300),
    )
    assert lease.apply_auth_payload({"ws_ticket": ticket}) is False


def test_expired_ws_ticket_is_rejected():
    lease = ws_auth.WsSessionLease(_access(seconds=-60), user_id=7)
    ticket = create_ws_ticket(
        {"sub": "user7", "user_id": 7, "session_id": "sess-1"},
        expires_delta=timedelta(seconds=-5),
    )
    assert lease.apply_auth_payload({"ws_ticket": ticket}) is False


def test_access_token_borrowing_another_users_session_is_rejected(monkeypatch):
    """user_id inside the token matches the lease, but the claimed session_id
    belongs to a different session owner (HIGH: sid theft binding)."""
    monkeypatch.setattr(
        ws_auth.session_service,
        "is_session_active_for_user",
        lambda sid, uid: (str(sid or ""), int(uid or 0)) == ("sess-1", 7),
        raising=False,
    )
    lease = ws_auth.WsSessionLease(_access(seconds=-60), user_id=7)
    forged = _access(user_id=7, session_id="sess-9")
    assert lease.apply_auth_payload({"access_token": forged}) is False
    assert lease.revalidate() == "grace"


def test_ws_ticket_bound_to_another_users_session_is_rejected(monkeypatch):
    monkeypatch.setattr(
        ws_auth.session_service,
        "is_session_active_for_user",
        lambda sid, uid: (str(sid or ""), int(uid or 0)) == ("sess-1", 7),
        raising=False,
    )
    lease = ws_auth.WsSessionLease(_access(seconds=-60), user_id=7)
    ticket = create_ws_ticket(
        {"sub": "user7", "user_id": 7, "session_id": "sess-9"},
        expires_delta=timedelta(seconds=300),
    )
    assert lease.apply_auth_payload({"ws_ticket": ticket}) is False


def test_sessionless_ws_ticket_is_rejected():
    lease = ws_auth.WsSessionLease(_access(seconds=-60), user_id=7)
    ticket = create_ws_ticket(
        {"sub": "user7", "user_id": 7},
        expires_delta=timedelta(seconds=300),
    )
    assert lease.apply_auth_payload({"ws_ticket": ticket}) is False


def _sessionless_access(user_id=7, seconds=900):
    return jwt.encode(
        {
            "sub": f"user{user_id}",
            "user_id": user_id,
            "token_type": "access",
            "exp": datetime.now(timezone.utc) + timedelta(seconds=seconds),
        },
        config.jwt.secret_key,
        algorithm=config.jwt.algorithm,
    )


def test_sessionless_access_token_is_dead_and_cannot_rebind():
    """A signed access JWT without session_id is never a valid lease token
    or rebind proof — sid-less access must die instead of falling back to
    the lease's stored session (CRIT-01)."""
    forged = _sessionless_access()

    sidless_lease = ws_auth.WsSessionLease(forged, user_id=7)
    assert sidless_lease.revalidate() == "dead"

    lease = ws_auth.WsSessionLease(_access(seconds=-60), user_id=7)
    assert lease.revalidate() == "grace"
    assert lease.apply_auth_payload({"access_token": forged}) is False
    assert lease.revalidate() == "grace"


def test_empty_payload_is_rejected():
    lease = ws_auth.WsSessionLease(_access(seconds=-60), user_id=7)
    assert lease.apply_auth_payload({}) is False
    assert lease.apply_auth_payload(None) is False
