"""WsSessionLease — in-socket re-auth (D5, variant б+)."""
from __future__ import annotations

import sys
import time
from datetime import timedelta
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

import backend.chat.ws_auth as ws_auth  # noqa: E402
from backend.utils.security import create_access_token, create_ws_ticket  # noqa: E402


@pytest.fixture(autouse=True)
def live_session(monkeypatch):
    monkeypatch.setattr(ws_auth.session_service, "is_session_active", lambda sid: True)
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


def test_empty_payload_is_rejected():
    lease = ws_auth.WsSessionLease(_access(seconds=-60), user_id=7)
    assert lease.apply_auth_payload({}) is False
    assert lease.apply_auth_payload(None) is False
