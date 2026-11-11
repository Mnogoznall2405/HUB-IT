from __future__ import annotations

import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.chat import chat_presence_service as presence_module  # noqa: E402
from backend.chat.chat_presence_service import ChatPresenceService  # noqa: E402


def _make_presence_service() -> ChatPresenceService:
    # Fake host with only what _get_presence_map touches: no DB, Redis or network.
    host = SimpleNamespace(
        _cache_lock=threading.RLock(),
        _presence_cache={},
        _PRESENCE_CACHE_TTL_SEC=15,
        _build_presence_payload=lambda **kwargs: {
            "is_online": bool(kwargs["is_online"]),
            "last_seen_at": kwargs["last_seen_at"],
        },
    )
    return ChatPresenceService(host)  # type: ignore[arg-type]


def test_presence_map_empty_ids_never_scans_all_sessions(monkeypatch):
    # Regression guard E2E would miss: an empty id list silently triggered a full
    # session-table scan (a perf cliff, with identical user-visible output).
    calls = []

    # Record instead of raising: the service swallows exceptions from session_service.
    def _forbidden(*args, **kwargs):
        calls.append((args, kwargs))
        return []

    monkeypatch.setattr(presence_module.session_service, "list_sessions", _forbidden)
    monkeypatch.setattr(presence_module.session_service, "list_sessions_by_user_ids", _forbidden)
    service = _make_presence_service()

    assert service._get_presence_map(user_ids=[]) == {}
    assert service._get_presence_map(user_ids=None) == {}
    assert service._get_presence_map(user_ids={0, -5}) == {}
    assert calls == []
    assert service._service._presence_cache == {}


def test_presence_map_with_ids_uses_targeted_lookup(monkeypatch):
    calls = []

    def _by_ids(user_ids, active_only=False):
        calls.append(sorted(user_ids))
        return [
            {
                "user_id": 7,
                "status": "active",
                "last_seen_at": (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat(),
            }
        ]

    monkeypatch.setattr(presence_module.session_service, "list_sessions_by_user_ids", _by_ids)
    monkeypatch.setattr(
        presence_module.session_service,
        "list_sessions",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("global scan not expected")),
    )
    service = _make_presence_service()

    result = service._get_presence_map(user_ids=[7, 0])

    assert calls == [[7]]
    assert result[7]["is_online"] is True
