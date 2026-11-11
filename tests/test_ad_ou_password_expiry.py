from __future__ import annotations

import sys
from collections.abc import Callable
from datetime import datetime, timezone, timedelta
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import ad_users as ad_users_api
from backend.models.auth import User
from backend.services.authorization_service import PERM_PASSWORDS_READ
from backend.services.ad_expiry_cache import ad_expiry_cache


@pytest.fixture(autouse=True)
def _clear_ad_expiry_cache():
    ad_expiry_cache.invalidate_all()
    yield
    ad_expiry_cache.invalidate_all()


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
    def __init__(self, ou_entries=None, user_entries=None, page_size=1000):
        self.ou_entries = ou_entries or []
        self.user_entries = user_entries or []
        self.page_size = max(1, int(page_size or 1000))
        self.calls = []
        self.unbound = False
        self.result = {}

    def search(self, **kwargs):
        self.calls.append(kwargs)
        search_filter = kwargs.get("search_filter", "")
        if "organizationalUnit" in search_filter:
            self.entries = list(self.ou_entries)
            self.result = {}
            return True

        paged_cookie = kwargs.get("paged_cookie")
        page_size = int(kwargs.get("paged_size") or self.page_size)
        if paged_cookie is None:
            offset = 0
        else:
            offset = int(paged_cookie.decode("ascii")) if isinstance(paged_cookie, bytes) else int(paged_cookie)
        end = offset + page_size
        page = self.user_entries[offset:end]
        self.entries = list(page)
        if end < len(self.user_entries):
            self.result = {
                "controls": {
                    "1.2.840.113556.1.4.319": {
                        "value": {"cookie": str(end).encode("ascii")},
                    }
                }
            }
        else:
            self.result = {}
        return True

    def unbind(self):
        self.unbound = True


def _make_user(*, permissions: list[str] | None = None) -> User:
    return User(
        id=31,
        username="passwords-user",
        email="passwords-user@example.com",
        full_name="Passwords User",
        role="viewer",
        permissions=permissions or [],
        use_custom_permissions=True,
        custom_permissions=permissions or [],
        is_active=True,
    )


def _client_for(user_factory: Callable[[], User]) -> TestClient:
    app = FastAPI()
    app.include_router(ad_users_api.router, prefix="/ad-users")
    app.dependency_overrides[deps.get_current_active_user] = user_factory
    return TestClient(app)


def _patch_branch_context(monkeypatch, ad_module):
    monkeypatch.setattr(ad_module, "_load_branch_mapping_context", lambda: {
        "branch_map": {},
        "custom_branches": {},
        "all_branches": {},
    })


def _patch_fixed_now(monkeypatch, ad_module, now: datetime):
    original = ad_module.calculate_password_expiration_status

    def fixed_status(pwd_last_set_raw, **kwargs):
        kwargs.pop("now_utc", None)
        kwargs.pop("max_age_days", None)
        return original(pwd_last_set_raw, now_utc=now, max_age_days=40)

    monkeypatch.setattr(ad_module, "calculate_password_expiration_status", fixed_status)


def test_list_ad_organizational_units_returns_children(monkeypatch):
    from backend.services import ad_users_service as ad_module

    conn = _FakeConnection(
        ou_entries=[
            _Entry(
                distinguishedName="OU=Users standart,DC=example,DC=local",
                name="Users standart",
                ou="Users standart",
            ),
            _Entry(
                distinguishedName="OU=IT,DC=example,DC=local",
                name="IT",
                ou="IT",
            ),
        ]
    )
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    monkeypatch.setattr(ad_module, "_resolve_ad_search_base", lambda: "DC=example,DC=local")

    result = ad_module.list_ad_organizational_units()

    assert result["status"] == "ok"
    assert len(result["items"]) == 2
    assert result["items"][0]["label"] in {"IT", "Users standart"}
    assert all(item["has_children"] is True for item in result["items"])
    assert conn.calls[0]["search_base"] == "DC=example,DC=local"
    assert conn.unbound is True


def test_list_ad_organizational_units_with_parent_dn(monkeypatch):
    from backend.services import ad_users_service as ad_module

    conn = _FakeConnection(
        ou_entries=[
            _Entry(
                distinguishedName="OU=Users Objects,OU=Users standart,DC=example,DC=local",
                name="Users Objects",
                ou="Users Objects",
            ),
        ]
    )
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)

    parent = "OU=Users standart,DC=example,DC=local"
    result = ad_module.list_ad_organizational_units(parent_dn=parent)

    assert result["status"] == "ok"
    assert result["parent_dn"] == parent
    assert conn.calls[0]["search_base"] == parent
    assert result["items"][0]["label"] == "Users Objects"


def test_get_ad_password_expiry_report_uses_ou_search_base(monkeypatch):
    from backend.services import ad_users_service as ad_module

    now = datetime(2026, 6, 17, tzinfo=timezone.utc)
    conn = _FakeConnection(
        user_entries=[
            _Entry(
                sAMAccountName="ivanov_ii",
                displayName="Иванов Иван",
                department="IT",
                title="Engineer",
                pwdLastSet=_ad_filetime(now - timedelta(days=39)),
                distinguishedName="CN=Иванов Иван,OU=Users Objects,OU=Users standart,DC=example,DC=local",
            ),
            _Entry(
                sAMAccountName="ivanov.ii",
                displayName="Иванов Иван Ящик",
                department="IT",
                title="Mailbox",
                pwdLastSet=_ad_filetime(now - timedelta(days=5)),
                distinguishedName="CN=Иванов Иван Ящик,OU=Users Objects,OU=Users standart,DC=example,DC=local",
            ),
            _Entry(
                sAMAccountName="svc_backup",
                displayName="",
                department="IT",
                title="",
                pwdLastSet=_ad_filetime(now - timedelta(days=10)),
                distinguishedName="CN=Service Backup,OU=Users Objects,OU=Users standart,DC=example,DC=local",
            ),
        ]
    )
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    _patch_branch_context(monkeypatch, ad_module)
    _patch_fixed_now(monkeypatch, ad_module, now)

    report = ad_module.get_ad_password_expiry_report(
        ou_dn="OU=Users Objects,OU=Users standart,DC=example,DC=local",
        mode="all",
    )

    assert report["status"] == "ok"
    assert report["total"] == 1
    assert report["users"][0]["login"] == "ivanov_ii"
    assert conn.calls[0]["search_base"] == "OU=Users Objects,OU=Users standart,DC=example,DC=local"
    assert "displayName=* *" not in conn.calls[0]["search_filter"]


def test_get_ad_password_expiry_report_expiring_includes_underscore_login_without_display_name(monkeypatch):
    from backend.services import ad_users_service as ad_module

    now = datetime(2026, 6, 17, tzinfo=timezone.utc)
    conn = _FakeConnection(
        user_entries=[
            _Entry(
                sAMAccountName="zalesova_ey",
                displayName="",
                department="Sales",
                title="Manager",
                pwdLastSet=_ad_filetime(now - timedelta(days=39)),
                distinguishedName="CN=Zalesova,OU=Users,DC=example,DC=local",
            ),
        ]
    )
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    _patch_branch_context(monkeypatch, ad_module)
    _patch_fixed_now(monkeypatch, ad_module, now)

    report = ad_module.get_ad_password_expiry_report(mode="expiring", days_threshold=7)

    assert report["total"] == 1
    assert report["users"][0]["login"] == "zalesova_ey"
    assert report["users"][0]["display_name"] == "zalesova_ey"


def test_get_ad_password_expiry_report_paged_search_loads_all_entries(monkeypatch):
    from backend.services import ad_users_service as ad_module

    now = datetime(2026, 6, 17, tzinfo=timezone.utc)
    user_entries = []
    for index in range(1001, 1006):
        user_entries.append(
            _Entry(
                sAMAccountName=f"user_{index}",
                displayName=f"User {index}",
                department="IT",
                title="Engineer",
                pwdLastSet=_ad_filetime(now - timedelta(days=39)),
                distinguishedName=f"CN=User {index},OU=Users,DC=example,DC=local",
            )
        )
    conn = _FakeConnection(user_entries=user_entries, page_size=2)
    monkeypatch.setattr(ad_module, "_AD_LDAP_PAGE_SIZE", 2)
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    _patch_branch_context(monkeypatch, ad_module)
    _patch_fixed_now(monkeypatch, ad_module, now)

    report = ad_module.get_ad_password_expiry_report(mode="expiring", days_threshold=7, force=True)

    assert report["total"] == 5
    assert report["ldap_entries_fetched"] == 5
    assert len(conn.calls) == 3


def test_get_ad_password_expiry_report_query_uses_targeted_lookup(monkeypatch):
    from backend.services import ad_users_service as ad_module

    now = datetime(2026, 6, 17, tzinfo=timezone.utc)
    bulk_conn = _FakeConnection(user_entries=[])
    targeted_conn = _FakeConnection(
        user_entries=[
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
    connections = iter([bulk_conn, targeted_conn])
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: next(connections))
    _patch_branch_context(monkeypatch, ad_module)
    _patch_fixed_now(monkeypatch, ad_module, now)

    report = ad_module.get_ad_password_expiry_report(
        mode="expiring",
        days_threshold=7,
        q="petrov",
        force=True,
    )

    assert report["total"] == 1
    assert report["users"][0]["login"] == "petrov_pp"
    assert report["ldap_targeted_users_added"] == 1
    assert "(anr=" in targeted_conn.calls[0]["search_filter"]


def test_get_ad_password_expiry_report_expiring_mode_applies_threshold(monkeypatch):
    from backend.services import ad_users_service as ad_module

    now = datetime(2026, 6, 17, tzinfo=timezone.utc)
    conn = _FakeConnection(
        user_entries=[
            _Entry(
                sAMAccountName="petrov_pp",
                displayName="Петров Пётр",
                department="Sales",
                title="Manager",
                pwdLastSet=_ad_filetime(now - timedelta(days=39)),
                distinguishedName="CN=Петров Пётр,OU=Users,DC=example,DC=local",
            ),
            _Entry(
                sAMAccountName="sidorov.ss",
                displayName="Сидоров Сергей",
                department="Sales",
                title="Manager",
                pwdLastSet=_ad_filetime(now - timedelta(days=10)),
                distinguishedName="CN=Сидоров Сергей,OU=Users,DC=example,DC=local",
            ),
        ]
    )
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    _patch_branch_context(monkeypatch, ad_module)
    _patch_fixed_now(monkeypatch, ad_module, now)

    report = ad_module.get_ad_password_expiry_report(
        mode="expiring",
        days_threshold=3,
    )

    assert report["status"] == "ok"
    assert report["mode"] == "expiring"
    assert report["total"] == 1
    assert report["users"][0]["login"] == "petrov_pp"


def test_get_ad_password_expiry_report_includes_must_change_now(monkeypatch):
    from backend.services import ad_users_service as ad_module

    now = datetime(2026, 6, 17, tzinfo=timezone.utc)
    conn = _FakeConnection(
        user_entries=[
            _Entry(
                sAMAccountName="kozlov_kk",
                displayName="Козлов Константин",
                department="IT",
                title="Engineer",
                pwdLastSet=0,
                distinguishedName="CN=Козлов Константин,OU=Users,DC=example,DC=local",
            ),
        ]
    )
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    _patch_branch_context(monkeypatch, ad_module)
    _patch_fixed_now(monkeypatch, ad_module, now)

    report = ad_module.get_ad_password_expiry_report(mode="expiring", days_threshold=7)

    assert report["total"] == 1
    assert report["users"][0]["login"] == "kozlov_kk"
    assert report["users"][0]["must_change_now"] is True


def test_get_ad_password_expiry_report_marks_password_never_expires(monkeypatch):
    from backend.services import ad_users_service as ad_module

    now = datetime(2026, 6, 17, tzinfo=timezone.utc)
    never_expire_uac = 512 | ad_module.AD_UF_DONT_EXPIRE_PASSWD
    conn = _FakeConnection(
        user_entries=[
            _Entry(
                sAMAccountName="neverexp_u1",
                displayName="Never Expire User",
                department="IT",
                title="Engineer",
                pwdLastSet=_ad_filetime(now - timedelta(days=120)),
                userAccountControl=never_expire_uac,
                distinguishedName="CN=Never Expire User,OU=Users,DC=example,DC=local",
            ),
        ]
    )
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    _patch_branch_context(monkeypatch, ad_module)
    _patch_fixed_now(monkeypatch, ad_module, now)

    report = ad_module.get_ad_password_expiry_report(mode="all")

    assert report["total"] == 1
    user = report["users"][0]
    assert user["login"] == "neverexp_u1"
    assert user["password_never_expires"] is True
    assert user["expired"] is False
    assert user["expiration_date"] is None
    assert user["days_to_expire"] is None


def test_get_ad_password_expiry_report_expiring_excludes_never_expires(monkeypatch):
    from backend.services import ad_users_service as ad_module

    now = datetime(2026, 6, 17, tzinfo=timezone.utc)
    never_expire_uac = 512 | ad_module.AD_UF_DONT_EXPIRE_PASSWD
    conn = _FakeConnection(
        user_entries=[
            _Entry(
                sAMAccountName="service_acc",
                displayName="Сервисный аккаунт",
                department="IT",
                title="Service",
                pwdLastSet=_ad_filetime(now - timedelta(days=120)),
                userAccountControl=never_expire_uac,
                distinguishedName="CN=Service,OU=Users,DC=example,DC=local",
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
    _patch_branch_context(monkeypatch, ad_module)
    _patch_fixed_now(monkeypatch, ad_module, now)

    report = ad_module.get_ad_password_expiry_report(mode="expiring", days_threshold=7)

    assert report["total"] == 1
    assert report["users"][0]["login"] == "petrov_pp"


def test_get_ad_password_expiry_report_must_change_now_overrides_never_expires(monkeypatch):
    from backend.services import ad_users_service as ad_module

    now = datetime(2026, 6, 17, tzinfo=timezone.utc)
    never_expire_uac = 512 | ad_module.AD_UF_DONT_EXPIRE_PASSWD
    conn = _FakeConnection(
        user_entries=[
            _Entry(
                sAMAccountName="new_service",
                displayName="Новый сервис",
                department="IT",
                title="Service",
                pwdLastSet=0,
                userAccountControl=never_expire_uac,
                distinguishedName="CN=New Service,OU=Users,DC=example,DC=local",
            ),
        ]
    )
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    _patch_branch_context(monkeypatch, ad_module)
    _patch_fixed_now(monkeypatch, ad_module, now)

    report = ad_module.get_ad_password_expiry_report(mode="expiring", days_threshold=7)

    assert report["total"] == 1
    user = report["users"][0]
    assert user["must_change_now"] is True
    assert user["password_never_expires"] is False


def test_get_ad_password_expiry_report_filters_by_query(monkeypatch):
    from backend.services import ad_users_service as ad_module

    now = datetime(2026, 6, 17, tzinfo=timezone.utc)
    conn = _FakeConnection(
        user_entries=[
            _Entry(
                sAMAccountName="ivanov_ii",
                displayName="Иванов Иван",
                department="IT",
                title="Engineer",
                pwdLastSet=_ad_filetime(now - timedelta(days=10)),
                distinguishedName="CN=Иванов Иван,OU=Users,DC=example,DC=local",
            ),
            _Entry(
                sAMAccountName="petrov_pp",
                displayName="Петров Пётр",
                department="Sales",
                title="Manager",
                pwdLastSet=_ad_filetime(now - timedelta(days=10)),
                distinguishedName="CN=Петров Пётр,OU=Users,DC=example,DC=local",
            ),
        ]
    )
    monkeypatch.setattr(ad_module, "_open_ad_connection", lambda: conn)
    _patch_branch_context(monkeypatch, ad_module)
    _patch_fixed_now(monkeypatch, ad_module, now)

    report = ad_module.get_ad_password_expiry_report(mode="all", q="иванов")

    assert report["total"] == 1
    assert report["users"][0]["login"] == "ivanov_ii"


def test_password_expiry_api_requires_passwords_read(monkeypatch):
    denied = _client_for(lambda: _make_user(permissions=[]))
    allowed = _client_for(lambda: _make_user(permissions=[PERM_PASSWORDS_READ]))

    monkeypatch.setattr(
        ad_users_api,
        "get_ad_password_expiry_report",
        lambda **kwargs: {
            "status": "ok",
            "ou_dn": kwargs.get("ou_dn"),
            "mode": kwargs.get("mode"),
            "threshold_days": kwargs.get("days_threshold"),
            "policy_days": 40,
            "total": 0,
            "users": [],
        },
    )
    monkeypatch.setattr(
        ad_users_api,
        "list_ad_organizational_units",
        lambda **kwargs: {"status": "ok", "parent_dn": kwargs.get("parent_dn"), "items": []},
    )

    assert denied.get("/ad-users/password-expiry").status_code == 403
    assert allowed.get("/ad-users/password-expiry").status_code == 200
    assert denied.get("/ad-users/organizational-units").status_code == 403
    assert allowed.get("/ad-users/organizational-units").status_code == 200


def test_password_expiry_api_returns_503_on_ldap_error(monkeypatch):
    client = _client_for(lambda: _make_user(permissions=[PERM_PASSWORDS_READ]))
    monkeypatch.setattr(
        ad_users_api,
        "get_ad_password_expiry_report",
        lambda **kwargs: {"status": "error", "error": "LDAP bind failed"},
    )

    response = client.get("/ad-users/password-expiry")

    assert response.status_code == 503
    assert "LDAP bind failed" in response.json()["detail"]
