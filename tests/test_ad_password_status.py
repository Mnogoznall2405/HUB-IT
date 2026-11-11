from __future__ import annotations

import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def _ad_filetime(value: datetime) -> int:
    from backend.services.ad_users_service import epoch_diff

    return int(value.astimezone(timezone.utc).timestamp() * 10000000 + epoch_diff)


class _Attr:
    def __init__(self, value):
        self.value = value
        self.raw_values = [str(value).encode("ascii")] if isinstance(value, int) else []


class _Entry:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, _Attr(value))


class _FakeConnection:
    def __init__(self, entries):
        self.entries = entries
        self.calls = []
        self.unbound = False

    def search(self, **kwargs):
        self.calls.append(kwargs)
        return True

    def unbind(self):
        self.unbound = True


def test_calculate_password_expiration_status_counts_age_and_remaining_days(monkeypatch):
    from backend.services.ad_users_service import calculate_password_expiration_status

    now = datetime(2026, 5, 15, 12, 0, tzinfo=timezone.utc)
    raw_today = _ad_filetime(now)
    raw_39_days = _ad_filetime(now - timedelta(days=39))
    raw_expired = _ad_filetime(now - timedelta(days=41, hours=1))

    assert calculate_password_expiration_status(raw_today, now_utc=now, max_age_days=40) | {} == {
        "pwd_last_set": raw_today,
        "pwd_last_set_date": now.isoformat(),
        "expiration_date": (now + timedelta(days=40)).isoformat(),
        "password_age_days": 0,
        "days_to_expire": 40,
        "expired": False,
        "expired_days": 0,
        "must_change_now": False,
        "policy_days": 40,
    }

    status_39 = calculate_password_expiration_status(raw_39_days, now_utc=now, max_age_days=40)
    assert status_39["password_age_days"] == 39
    assert status_39["days_to_expire"] == 1
    assert status_39["must_change_now"] is False

    status_expired = calculate_password_expiration_status(raw_expired, now_utc=now, max_age_days=40)
    assert status_expired["password_age_days"] == 41
    assert status_expired["days_to_expire"] == 0
    assert status_expired["expired"] is True
    assert status_expired["must_change_now"] is True
    assert status_expired["expired_days"] == 2


def test_calculate_password_expiration_status_handles_must_change_now():
    from backend.services.ad_users_service import calculate_password_expiration_status

    status = calculate_password_expiration_status(0, now_utc=datetime(2026, 5, 15, tzinfo=timezone.utc), max_age_days=40)

    assert status["pwd_last_set_date"] is None
    assert status["expiration_date"] is None
    assert status["password_age_days"] is None
    assert status["days_to_expire"] == 0
    assert status["must_change_now"] is True


def test_lookup_ad_user_password_status_returns_exact_login_match(monkeypatch):
    from backend.services import ad_users_service as ad_module

    conn = _FakeConnection([
        _Entry(
            sAMAccountName="kozlovskii.me",
            displayName="Козловский Максим",
            department="IT",
            title="Engineer",
            mail="kozlovskii.me@example.local",
            pwdLastSet=_ad_filetime(datetime(2026, 5, 1, tzinfo=timezone.utc)),
        )
    ])
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    monkeypatch.setattr(ad_module, "_resolve_ad_search_base", lambda: "OU=Users,DC=example,DC=local")

    result = ad_module.lookup_ad_user_password_status("kozlovskii.me")

    assert result["status"] == "matched"
    assert result["user"]["login"] == "kozlovskii.me"
    assert result["user"]["display_name"] == "Козловский Максим"
    assert "pwd_last_set" not in result["user"]
    assert conn.unbound is True


def test_lookup_ad_user_password_status_reports_ambiguous_names(monkeypatch):
    from backend.services import ad_users_service as ad_module

    conn = _FakeConnection([
        _Entry(sAMAccountName="kozlovskii.me", displayName="Козловский Максим", pwdLastSet=0),
        _Entry(sAMAccountName="kozlovskii.mv", displayName="Козловский Максим Викторович", pwdLastSet=0),
    ])
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    monkeypatch.setattr(ad_module, "_resolve_ad_search_base", lambda: "OU=Users,DC=example,DC=local")

    result = ad_module.lookup_ad_user_password_status("Козловский")

    assert result["status"] == "ambiguous"
    assert [item["login"] for item in result["candidates"]] == ["kozlovskii.me", "kozlovskii.mv"]


def test_ad_password_status_tool_returns_safe_payload(monkeypatch):
    from backend.ai_chat.tools.ad import AdUserPasswordStatusTool
    from backend.ai_chat.tools.context import AD_TOOL_USER_PASSWORD_STATUS, AiToolExecutionContext

    monkeypatch.setattr(
        "backend.ai_chat.tools.ad.lookup_ad_user_password_status",
        lambda query, limit=5: {
            "status": "matched",
            "query": query,
            "policy_days": 40,
            "user": {
                "login": "kozlovskii.me",
                "display_name": "Козловский Максим",
                "pwd_last_set_date": "2026-05-01T00:00:00+00:00",
                "password_age_days": 14,
                "days_to_expire": 26,
                "expiration_date": "2026-06-10T00:00:00+00:00",
            },
        },
    )
    context = AiToolExecutionContext(
        bot_id="bot",
        bot_title="Bot",
        conversation_id="conv",
        run_id="run",
        user_id=1,
        user_payload={"id": 1, "role": "viewer"},
        effective_database_id=None,
        enabled_tools=[AD_TOOL_USER_PASSWORD_STATUS],
        tool_settings={},
    )

    result = AdUserPasswordStatusTool().execute(context=context, args={"query": "Козловский Максим"})

    assert result.ok is True
    assert result.data["status"] == "matched"
    assert "pwd_last_set" not in result.data["user"]
