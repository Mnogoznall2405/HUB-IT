from __future__ import annotations

import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services import ad_users_service as ad_module
from backend.services.ad_expiry_cache import ad_expiry_cache


class _Attr:
    def __init__(self, value):
        self.value = value
        self.raw_values = [str(value).encode("ascii")] if isinstance(value, int) else []


class _Entry:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, _Attr(value))


class _FakeConnection:
    def __init__(self, ou_entries=None, user_entries=None):
        self.ou_entries = ou_entries or []
        self.user_entries = user_entries or []
        self.calls = []
        self.unbound = False

    def search(self, **kwargs):
        self.calls.append(kwargs)
        search_filter = kwargs.get("search_filter", "")
        if "organizationalUnit" in search_filter:
            self.entries = list(self.ou_entries)
        else:
            self.entries = list(self.user_entries)
        return True

    def unbind(self):
        self.unbound = True


def _ad_filetime(value: datetime) -> int:
    from backend.services.ad_users_service import epoch_diff

    return int(value.astimezone(timezone.utc).timestamp() * 10000000 + epoch_diff)


@pytest.fixture(autouse=True)
def clear_ad_expiry_cache():
    ad_expiry_cache.invalidate_all()
    yield
    ad_expiry_cache.invalidate_all()


def _patch_branch_context(monkeypatch):
    monkeypatch.setattr(ad_module, "_load_branch_mapping_context", lambda: {
        "branch_map": {},
        "custom_branches": {},
        "all_branches": {},
    })


def _patch_fixed_now(monkeypatch, now: datetime):
    original = ad_module.calculate_password_expiration_status

    def fixed_status(pwd_last_set_raw, **kwargs):
        kwargs.pop("now_utc", None)
        kwargs.pop("max_age_days", None)
        return original(pwd_last_set_raw, now_utc=now, max_age_days=40)

    monkeypatch.setattr(ad_module, "calculate_password_expiration_status", fixed_status)


def test_password_expiry_report_uses_cache_on_second_call(monkeypatch):
    now = datetime(2026, 6, 17, tzinfo=timezone.utc)
    conn = _FakeConnection(
        user_entries=[
            _Entry(
                sAMAccountName="ivanov_ii",
                displayName="Иванов Иван",
                department="IT",
                title="Engineer",
                pwdLastSet=_ad_filetime(now - timedelta(days=39)),
                distinguishedName="CN=Иванов Иван,OU=Users,DC=example,DC=local",
            ),
        ]
    )
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    _patch_branch_context(monkeypatch)
    _patch_fixed_now(monkeypatch, now)

    first = ad_module.get_ad_password_expiry_report(mode="expiring", days_threshold=7)
    second = ad_module.get_ad_password_expiry_report(mode="expiring", days_threshold=7)

    assert first["status"] == "ok"
    assert second["status"] == "ok"
    assert second["from_cache"] is True
    assert second["cached_at"]
    assert len(conn.calls) == 1


def test_password_expiry_report_force_bypasses_cache(monkeypatch):
    now = datetime(2026, 6, 17, tzinfo=timezone.utc)
    conn = _FakeConnection(
        user_entries=[
            _Entry(
                sAMAccountName="ivanov_ii",
                displayName="Иванов Иван",
                department="IT",
                title="Engineer",
                pwdLastSet=_ad_filetime(now - timedelta(days=39)),
                distinguishedName="CN=Иванов Иван,OU=Users,DC=example,DC=local",
            ),
        ]
    )
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    _patch_branch_context(monkeypatch)
    _patch_fixed_now(monkeypatch, now)

    ad_module.get_ad_password_expiry_report(mode="expiring", days_threshold=7)
    forced = ad_module.get_ad_password_expiry_report(mode="expiring", days_threshold=7, force=True)

    assert forced["from_cache"] is False
    assert len(conn.calls) == 2


def test_password_expiry_report_query_filters_cached_snapshot(monkeypatch):
    now = datetime(2026, 6, 17, tzinfo=timezone.utc)
    conn = _FakeConnection(
        user_entries=[
            _Entry(
                sAMAccountName="ivanov_ii",
                displayName="Иванов Иван",
                department="IT",
                title="Engineer",
                pwdLastSet=_ad_filetime(now - timedelta(days=39)),
                distinguishedName="CN=Иванов Иван,OU=Users,DC=example,DC=local",
            ),
            _Entry(
                sAMAccountName="petrov_pp",
                displayName="Петров Пётр",
                department="Sales",
                title="Manager",
                pwdLastSet=_ad_filetime(now - timedelta(days=39)),
                distinguishedName="CN=Петров Пётр,OU=Users,DC=example,DC=local",
            ),
        ]
    )
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    _patch_branch_context(monkeypatch)
    _patch_fixed_now(monkeypatch, now)

    ad_module.get_ad_password_expiry_report(mode="expiring", days_threshold=7)
    filtered = ad_module.get_ad_password_expiry_report(mode="expiring", days_threshold=7, q="иванов")

    assert filtered["total"] == 1
    assert filtered["users"][0]["login"] == "ivanov_ii"
    assert filtered["from_cache"] is True
    assert len(conn.calls) == 1


def test_list_ad_organizational_units_uses_cache(monkeypatch):
    conn = _FakeConnection(
        ou_entries=[
            _Entry(
                distinguishedName="OU=Users standart,DC=example,DC=local",
                name="Users standart",
                ou="Users standart",
            ),
        ]
    )
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    monkeypatch.setattr(ad_module, "_resolve_ad_search_base", lambda: "DC=example,DC=local")

    first = ad_module.list_ad_organizational_units()
    second = ad_module.list_ad_organizational_units()

    assert first["status"] == "ok"
    assert second["from_cache"] is True
    assert len(conn.calls) == 1


def test_list_ad_organizational_units_force_refreshes_cache(monkeypatch):
    conn = _FakeConnection(
        ou_entries=[
            _Entry(
                distinguishedName="OU=Users standart,DC=example,DC=local",
                name="Users standart",
                ou="Users standart",
            ),
        ]
    )
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    monkeypatch.setattr(ad_module, "_resolve_ad_search_base", lambda: "DC=example,DC=local")

    ad_module.list_ad_organizational_units()
    forced = ad_module.list_ad_organizational_units(force=True)

    assert forced["from_cache"] is False
    assert len(conn.calls) == 2
