from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.session_auth_context_service import SessionAuthContextService


def _service(tmp_path) -> SessionAuthContextService:
    url = f"sqlite+pysqlite:///{(tmp_path / 'ctx.db').as_posix()}"
    return SessionAuthContextService(file_path=tmp_path / "ctx.json", database_url=url)


def _store(service, session_id, user_id=1, *, ttl=3600):
    service.store_session_context(
        session_id=session_id,
        user_id=user_id,
        auth_source="ldap",
        exchange_login="user",
        password="pw-" + session_id,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=ttl),
    )


def test_second_instance_does_not_drop_session_stored_by_first(tmp_path):
    # Two workers/requests with their own service object over one DB: B must not erase A.
    a = _service(tmp_path)
    b = _service(tmp_path)
    _store(a, "session-a")
    _store(b, "session-b")
    assert a.resolve_session_password("session-a", user_id=1) == "pw-session-a"
    assert a.resolve_session_password("session-b", user_id=1) == "pw-session-b"


def test_expired_lookup_removes_only_that_session(tmp_path):
    service = _service(tmp_path)
    _store(service, "live")
    _store(service, "stale", ttl=-5)
    assert service.get_session_context("stale") is None
    assert service.get_session_context("live", user_id=1) is not None
    assert service.get_session_context("live", user_id=2) is None


def _age(service, session_id, seconds):
    from sqlalchemy import update

    from backend.appdb.db import app_session
    from backend.appdb.models import AppSessionAuthContext

    moment = datetime.now(timezone.utc) - timedelta(seconds=seconds)
    with app_session(service._database_url) as session:
        session.execute(
            update(AppSessionAuthContext)
            .where(AppSessionAuthContext.session_id == session_id)
            .values(created_at=moment, updated_at=moment)
        )


def test_prune_spares_session_created_after_the_active_snapshot(tmp_path):
    service = _service(tmp_path)
    _store(service, "known")
    _age(service, "known", 600)
    _store(service, "logged-in-during-prune")  # not in the snapshot, but brand new
    service.prune_active_sessions({"known"})
    assert service.get_session_context("logged-in-during-prune") is not None
    service.prune_active_sessions([])  # empty snapshot: every settled context goes
    assert service.get_session_context("known") is None
    assert service.get_session_context("logged-in-during-prune") is not None


def test_prune_keeps_only_active_unexpired_and_latest_picks_newest(tmp_path):
    service = _service(tmp_path)
    _store(service, "old")
    _store(service, "new")
    _store(service, "other-user", user_id=2)
    for sid in ("old", "new", "other-user"):
        _age(service, sid, 600)
    service.prune_active_sessions({"new", "other-user"})
    assert service.get_session_context("old") is None
    latest = service.get_latest_active_context_for_user(1, active_session_ids={"new"})
    assert latest and latest["session_id"] == "new"
    service.delete_session_context("new")
    assert service.get_latest_active_context_for_user(1) is None
    assert service.get_session_context("other-user", user_id=2) is not None
