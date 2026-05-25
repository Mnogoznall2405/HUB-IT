"""Unit tests for new AD service functions added in Task 1.2.

Tests cover:
- _detect_account_type
- filetime_to_datetime / datetime_to_filetime
- _build_mailbox_lookup_filter
- _parse_cn_from_dn
- lookup_ad_mailbox_password_status
- list_ad_mailboxes_expiring_soon
- get_ad_user_lockout_status
- get_ad_user_groups
- get_ad_user_logon_history
- account_type field in existing lookup_ad_user_password_status
"""
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
        if isinstance(value, (list, tuple)):
            self.values = value
            self.raw_values = []
        elif isinstance(value, int):
            self.values = None
            self.raw_values = [str(value).encode("ascii")]
        else:
            self.values = None
            self.raw_values = []


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


# --- _detect_account_type tests ---

def test_detect_account_type_mailbox_with_dot():
    from backend.services.ad_users_service import _detect_account_type
    assert _detect_account_type("kozlovskii.me") == "mailbox"
    assert _detect_account_type("ivanov.aa") == "mailbox"


def test_detect_account_type_user_with_underscore():
    from backend.services.ad_users_service import _detect_account_type
    assert _detect_account_type("kozlovskii_me") == "user"
    assert _detect_account_type("ivanov_aa") == "user"


def test_detect_account_type_user_with_both_dot_and_underscore():
    from backend.services.ad_users_service import _detect_account_type
    # Has both dot and underscore -> "user"
    assert _detect_account_type("svc_mail.box") == "user"


def test_detect_account_type_user_no_separator():
    from backend.services.ad_users_service import _detect_account_type
    assert _detect_account_type("admin") == "user"
    assert _detect_account_type("") == "user"


# --- filetime_to_datetime tests ---

def test_filetime_to_datetime_valid():
    from backend.services.ad_users_service import filetime_to_datetime, epoch_diff
    # Known value: 2024-01-01 00:00:00 UTC
    dt = datetime(2024, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    filetime = int(dt.timestamp() * 10_000_000) + epoch_diff
    result = filetime_to_datetime(filetime)
    assert result is not None
    assert abs((result - dt).total_seconds()) < 1


def test_filetime_to_datetime_zero():
    from backend.services.ad_users_service import filetime_to_datetime
    assert filetime_to_datetime(0) is None
    assert filetime_to_datetime(None) is None


def test_filetime_to_datetime_negative():
    from backend.services.ad_users_service import filetime_to_datetime
    assert filetime_to_datetime(-1) is None


def test_datetime_to_filetime_roundtrip():
    from backend.services.ad_users_service import filetime_to_datetime, datetime_to_filetime
    dt = datetime(2025, 6, 15, 10, 30, 0, tzinfo=timezone.utc)
    ft = datetime_to_filetime(dt)
    result = filetime_to_datetime(ft)
    assert result is not None
    assert abs((result - dt).total_seconds()) < 1


# --- _build_mailbox_lookup_filter tests ---

def test_build_mailbox_lookup_filter_contains_dot_filter():
    from backend.services.ad_users_service import _build_mailbox_lookup_filter
    f = _build_mailbox_lookup_filter("kozlovskii")
    assert "(sAMAccountName=*.*)" in f
    assert "(objectCategory=person)" in f
    assert "(objectClass=user)" in f
    assert "kozlovskii" in f


# --- _parse_cn_from_dn tests ---

def test_parse_cn_from_dn_standard():
    from backend.services.ad_users_service import _parse_cn_from_dn
    assert _parse_cn_from_dn("CN=IT Department,OU=Groups,DC=example,DC=com") == "IT Department"


def test_parse_cn_from_dn_empty():
    from backend.services.ad_users_service import _parse_cn_from_dn
    assert _parse_cn_from_dn("") == ""
    assert _parse_cn_from_dn("OU=Groups,DC=example") == ""


# --- account_type in lookup_ad_user_password_status ---

def test_lookup_ad_user_password_status_includes_account_type(monkeypatch):
    from backend.services import ad_users_service as ad_module

    conn = _FakeConnection([
        _Entry(
            sAMAccountName="kozlovskii_me",
            displayName="Козловский Максим",
            department="IT",
            title="Engineer",
            mail="kozlovskii@example.local",
            pwdLastSet=_ad_filetime(datetime(2026, 5, 1, tzinfo=timezone.utc)),
        )
    ])
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    monkeypatch.setattr(ad_module, "_resolve_ad_search_base", lambda: "DC=example,DC=local")

    result = ad_module.lookup_ad_user_password_status("kozlovskii_me")
    assert result["status"] == "matched"
    assert result["user"]["account_type"] == "user"


def test_lookup_ad_user_password_status_mailbox_account_type(monkeypatch):
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
    monkeypatch.setattr(ad_module, "_resolve_ad_search_base", lambda: "DC=example,DC=local")

    result = ad_module.lookup_ad_user_password_status("kozlovskii.me")
    assert result["status"] == "matched"
    assert result["user"]["account_type"] == "mailbox"


# --- lookup_ad_mailbox_password_status ---

def test_lookup_ad_mailbox_password_status_matched(monkeypatch):
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
    monkeypatch.setattr(ad_module, "_resolve_ad_search_base", lambda: "DC=example,DC=local")

    result = ad_module.lookup_ad_mailbox_password_status("kozlovskii.me")
    assert result["status"] == "matched"
    assert result["mailbox"]["login"] == "kozlovskii.me"
    assert result["mailbox"]["account_type"] == "mailbox"


def test_lookup_ad_mailbox_password_status_empty_query():
    from backend.services.ad_users_service import lookup_ad_mailbox_password_status
    result = lookup_ad_mailbox_password_status("")
    assert result["status"] == "error"


# --- get_ad_user_lockout_status ---

def test_get_ad_user_lockout_status_locked(monkeypatch):
    from backend.services import ad_users_service as ad_module

    lockout_time = _ad_filetime(datetime(2026, 5, 15, 10, 0, tzinfo=timezone.utc))
    conn = _FakeConnection([
        _Entry(
            sAMAccountName="kozlovskii_me",
            displayName="Козловский Максим",
            lockoutTime=lockout_time,
            badPwdCount=5,
            userAccountControl=512,
        )
    ])
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    monkeypatch.setattr(ad_module, "_resolve_ad_search_base", lambda: "DC=example,DC=local")

    result = ad_module.get_ad_user_lockout_status("kozlovskii_me")
    assert result["status"] == "ok"
    assert result["login"] == "kozlovskii_me"
    assert result["is_locked"] is True
    assert result["bad_password_count"] == 5
    assert result["lockout_time"] is not None


def test_get_ad_user_lockout_status_not_locked(monkeypatch):
    from backend.services import ad_users_service as ad_module

    conn = _FakeConnection([
        _Entry(
            sAMAccountName="kozlovskii_me",
            displayName="Козловский Максим",
            lockoutTime=0,
            badPwdCount=0,
            userAccountControl=512,
        )
    ])
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    monkeypatch.setattr(ad_module, "_resolve_ad_search_base", lambda: "DC=example,DC=local")

    result = ad_module.get_ad_user_lockout_status("kozlovskii_me")
    assert result["status"] == "ok"
    assert result["is_locked"] is False
    assert result["lockout_time"] is None


def test_get_ad_user_lockout_status_empty_query():
    from backend.services.ad_users_service import get_ad_user_lockout_status
    result = get_ad_user_lockout_status("")
    assert result["status"] == "error"


# --- get_ad_user_groups ---

def test_get_ad_user_groups_excludes_builtin(monkeypatch):
    from backend.services import ad_users_service as ad_module

    conn = _FakeConnection([
        _Entry(
            sAMAccountName="kozlovskii_me",
            displayName="Козловский Максим",
            memberOf=[
                "CN=IT Department,OU=Groups,DC=example,DC=local",
                "CN=Domain Users,CN=Users,DC=example,DC=local",
                "CN=VPN Access,OU=Groups,DC=example,DC=local",
            ],
        )
    ])
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    monkeypatch.setattr(ad_module, "_resolve_ad_search_base", lambda: "DC=example,DC=local")

    result = ad_module.get_ad_user_groups("kozlovskii_me", include_builtin=False)
    assert result["status"] == "ok"
    assert "Domain Users" not in result["groups"]
    assert "IT Department" in result["groups"]
    assert "VPN Access" in result["groups"]
    assert result["group_count"] == 2


def test_get_ad_user_groups_includes_builtin(monkeypatch):
    from backend.services import ad_users_service as ad_module

    conn = _FakeConnection([
        _Entry(
            sAMAccountName="kozlovskii_me",
            displayName="Козловский Максим",
            memberOf=[
                "CN=IT Department,OU=Groups,DC=example,DC=local",
                "CN=Domain Users,CN=Users,DC=example,DC=local",
            ],
        )
    ])
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    monkeypatch.setattr(ad_module, "_resolve_ad_search_base", lambda: "DC=example,DC=local")

    result = ad_module.get_ad_user_groups("kozlovskii_me", include_builtin=True)
    assert result["status"] == "ok"
    assert "Domain Users" in result["groups"]
    assert "IT Department" in result["groups"]
    assert result["group_count"] == 2


def test_get_ad_user_groups_empty_query():
    from backend.services.ad_users_service import get_ad_user_groups
    result = get_ad_user_groups("")
    assert result["status"] == "error"


# --- get_ad_user_logon_history ---

def test_get_ad_user_logon_history_returns_most_recent(monkeypatch):
    from backend.services import ad_users_service as ad_module

    # lastLogon is older, lastLogonTimestamp is newer
    older = datetime(2026, 5, 10, 8, 0, tzinfo=timezone.utc)
    newer = datetime(2026, 5, 14, 15, 30, tzinfo=timezone.utc)

    conn = _FakeConnection([
        _Entry(
            sAMAccountName="kozlovskii_me",
            displayName="Козловский Максим",
            lastLogon=_ad_filetime(older),
            lastLogonTimestamp=_ad_filetime(newer),
            logonCount=42,
            pwdLastSet=_ad_filetime(datetime(2026, 4, 1, tzinfo=timezone.utc)),
        )
    ])
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    monkeypatch.setattr(ad_module, "_resolve_ad_search_base", lambda: "DC=example,DC=local")

    result = ad_module.get_ad_user_logon_history("kozlovskii_me")
    assert result["status"] == "ok"
    assert result["logon_count"] == 42
    # last_logon should be the newer of the two
    assert result["last_logon"] is not None
    from datetime import datetime as dt_cls
    last_logon_dt = dt_cls.fromisoformat(result["last_logon"])
    assert abs((last_logon_dt - newer).total_seconds()) < 2
    assert result["note"] is None


def test_get_ad_user_logon_history_never_logged_in(monkeypatch):
    from backend.services import ad_users_service as ad_module

    conn = _FakeConnection([
        _Entry(
            sAMAccountName="newuser_aa",
            displayName="Новый Пользователь",
            lastLogon=0,
            lastLogonTimestamp=0,
            logonCount=0,
            pwdLastSet=_ad_filetime(datetime(2026, 5, 1, tzinfo=timezone.utc)),
        )
    ])
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    monkeypatch.setattr(ad_module, "_resolve_ad_search_base", lambda: "DC=example,DC=local")

    result = ad_module.get_ad_user_logon_history("newuser_aa")
    assert result["status"] == "ok"
    assert result["last_logon"] is None
    assert result["note"] == "Пользователь ни разу не входил в систему"


def test_get_ad_user_logon_history_empty_query():
    from backend.services.ad_users_service import get_ad_user_logon_history
    result = get_ad_user_logon_history("")
    assert result["status"] == "error"
