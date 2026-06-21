from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.ad_app_user_import_service import (
    AdAppUserImportService,
    _is_importable_person_ad_user,
    _should_deactivate_ldap_user,
    load_ad_app_user_sync_state,
)


def _fetch_payload(
    users: list[dict],
    *,
    raw_logins: set[str] | None = None,
    ldap_ok: bool = True,
) -> dict:
    raw = set(raw_logins) if raw_logins is not None else {
        str(item.get("login") or "").strip().lower()
        for item in users
        if str(item.get("login") or "").strip()
    }
    return {
        "ldap_ok": ldap_ok,
        "raw_count": len(raw),
        "raw_logins": raw,
        "users": users,
    }


class FakeUserService:
    def __init__(self, users: list[dict] | None = None) -> None:
        self._users = list(users or [])
        self._next_id = max([int(item.get("id") or 0) for item in self._users], default=0) + 1

    @staticmethod
    def is_system_hidden_user(user: dict | None) -> bool:
        return str((user or {}).get("username") or "").startswith("bot:")

    def list_users(self) -> list[dict]:
        return [dict(item) for item in self._users]

    def get_by_username(self, username: str) -> dict | None:
        normalized = str(username or "").strip().lower()
        for user in self._users:
            if str(user.get("username") or "").strip().lower() == normalized:
                return dict(user)
        return None

    def create_user(self, **kwargs) -> dict:
        created = {
            "id": self._next_id,
            "username": str(kwargs.get("username") or "").strip().lower(),
            "email": kwargs.get("email"),
            "full_name": kwargs.get("full_name"),
            "department": kwargs.get("department"),
            "job_title": kwargs.get("job_title"),
            "is_active": bool(kwargs.get("is_active", True)),
            "role": kwargs.get("role") or "viewer",
            "auth_source": kwargs.get("auth_source") or "local",
        }
        self._next_id += 1
        self._users.append(created)
        return dict(created)

    def update_user(self, user_id: int, **kwargs) -> dict | None:
        for user in self._users:
            if int(user.get("id") or 0) != int(user_id):
                continue
            user.update({key: value for key, value in kwargs.items() if value is not None or key == "is_active"})
            if "is_active" in kwargs:
                user["is_active"] = bool(kwargs["is_active"])
            return dict(user)
        return None


@pytest.fixture
def sync_state_path(tmp_path, monkeypatch):
    state_file = tmp_path / "ad_app_user_sync_state.json"
    monkeypatch.setattr(
        "backend.services.ad_app_user_import_service._sync_state_path",
        lambda: state_file,
    )
    return state_file


def test_sync_all_from_ad_creates_updates_deactivates_and_protects_admin(sync_state_path, monkeypatch):
    monkeypatch.setenv("LDAP_APP_USER_IMPORT_PERSON_ONLY", "1")
    ad_users = [
        {"login": "petrov_ii", "display_name": "Петров Иван", "department": "IT", "title": "", "mail": "new@example.com", "user_principal_name": "petrov_ii@zsgp.corp"},
        {"login": "sidorov_aa", "display_name": "Сидоров Алексей", "department": "IT", "title": "", "mail": "active@example.com", "user_principal_name": "sidorov_aa@zsgp.corp"},
    ]
    fake_users = FakeUserService([
        {"id": 1, "username": "sidorov_aa", "full_name": "Сидоров Алексей", "auth_source": "ldap", "role": "viewer", "is_active": True},
        {"id": 2, "username": "gone_user", "full_name": "Gone User", "auth_source": "ldap", "role": "viewer", "is_active": True},
        {"id": 3, "username": "ldap.admin", "full_name": "LDAP Admin", "auth_source": "ldap", "role": "admin", "is_active": True},
        {"id": 4, "username": "local.user", "full_name": "Local User", "auth_source": "local", "role": "viewer", "is_active": True},
    ])
    fake_departments = MagicMock()
    session_mock = MagicMock()
    session_mock.close_user_sessions.return_value = 2
    import backend.services.session_service as session_module
    monkeypatch.setattr(session_module, "session_service", session_mock)

    service = AdAppUserImportService(
        ad_fetcher=lambda: ad_users,
        users=fake_users,
        departments=fake_departments,
    )

    result = service.sync_all_from_ad()

    assert result["status"] == "success"
    assert result["created"] == 1
    assert result["updated"] == 1
    assert result["deactivated"] == 1
    assert result["protected_admins"] == 1
    assert result["sessions_closed"] == 2
    assert fake_users.get_by_username("petrov_ii") is not None
    assert fake_users.get_by_username("gone_user")["is_active"] is False
    assert fake_users.get_by_username("ldap.admin")["is_active"] is True
    assert fake_users.get_by_username("local.user")["is_active"] is True
    session_mock.close_user_sessions.assert_called_once_with(2)

    saved = json.loads(sync_state_path.read_text(encoding="utf-8"))
    assert saved["status"] == "success"
    assert saved["result"]["deactivated"] == 1


def test_sync_all_from_ad_skips_local_conflict(sync_state_path, monkeypatch):
    monkeypatch.setenv("LDAP_APP_USER_IMPORT_PERSON_ONLY", "1")
    ad_users = [
        {"login": "ivanov_ii", "display_name": "Иванов Иван", "department": "IT", "title": "", "mail": "", "user_principal_name": ""},
    ]
    fake_users = FakeUserService([
        {"id": 10, "username": "ivanov_ii", "full_name": "Local", "auth_source": "local", "role": "viewer", "is_active": True},
    ])
    fake_departments = MagicMock()
    service = AdAppUserImportService(
        ad_fetcher=lambda: ad_users,
        users=fake_users,
        departments=fake_departments,
    )

    result = service.sync_all_from_ad()

    assert result["skipped_conflicts"] == 1
    assert fake_users.get_by_username("ivanov_ii")["auth_source"] == "local"


def test_sync_all_from_ad_reactivates_inactive_user(sync_state_path, monkeypatch):
    monkeypatch.setenv("LDAP_APP_USER_IMPORT_PERSON_ONLY", "1")
    ad_users = [
        {"login": "kozlov_aa", "display_name": "Козлов Алексей", "department": "IT", "title": "", "mail": "back@example.com", "user_principal_name": ""},
    ]
    fake_users = FakeUserService([
        {"id": 5, "username": "kozlov_aa", "full_name": "Козлов Алексей", "auth_source": "ldap", "role": "viewer", "is_active": False},
    ])
    service = AdAppUserImportService(
        ad_fetcher=lambda: ad_users,
        users=fake_users,
        departments=MagicMock(),
    )

    result = service.sync_all_from_ad()

    assert result["reactivated"] == 1
    assert fake_users.get_by_username("kozlov_aa")["is_active"] is True


def test_is_importable_person_ad_user_filters_service_and_mailbox(monkeypatch):
    monkeypatch.setenv("LDAP_APP_USER_IMPORT_PERSON_ONLY", "1")
    assert _is_importable_person_ad_user("svc_backup", "Backup Service") is False
    assert _is_importable_person_ad_user("ivanov.ii", "Иванов Иван") is False
    assert _is_importable_person_ad_user("ivanov_ii", "Иванов Иван") is True
    assert _is_importable_person_ad_user("administrator_ii", "Administrator Ivan") is True


def test_should_deactivate_ldap_user_keeps_ad_user_with_bad_display_name(monkeypatch):
    monkeypatch.setenv("LDAP_APP_USER_IMPORT_PERSON_ONLY", "1")
    login = "petrov_ii"
    assert _should_deactivate_ldap_user(
        login,
        importable_logins=set(),
        raw_ad_logins={login},
    ) is False


def test_should_deactivate_ldap_user_deactivates_missing_and_service(monkeypatch):
    monkeypatch.setenv("LDAP_APP_USER_IMPORT_PERSON_ONLY", "1")
    assert _should_deactivate_ldap_user("gone_user", importable_logins=set(), raw_ad_logins=set()) is True
    assert _should_deactivate_ldap_user("1c", importable_logins=set(), raw_ad_logins={"1c"}) is True


def test_sync_all_from_ad_deactivates_service_account_still_in_ad(sync_state_path, monkeypatch):
    monkeypatch.setenv("LDAP_APP_USER_IMPORT_PERSON_ONLY", "1")
    fake_users = FakeUserService([
        {"id": 7, "username": "1c", "full_name": "1C", "auth_source": "ldap", "role": "viewer", "is_active": True},
    ])
    service = AdAppUserImportService(
        ad_fetcher=lambda: _fetch_payload([], raw_logins={"1c", "smirnov_ii"}),
        users=fake_users,
        departments=MagicMock(),
    )

    result = service.sync_all_from_ad()

    assert result["status"] == "warning"
    assert result["deactivated"] == 1
    assert fake_users.get_by_username("1c")["is_active"] is False


def test_sync_all_from_ad_keeps_ldap_user_with_bad_display_name_in_ad(sync_state_path, monkeypatch):
    monkeypatch.setenv("LDAP_APP_USER_IMPORT_PERSON_ONLY", "1")
    fake_users = FakeUserService([
        {"id": 8, "username": "petrov_ii", "full_name": "Petrov", "auth_source": "ldap", "role": "viewer", "is_active": True},
    ])
    service = AdAppUserImportService(
        ad_fetcher=lambda: _fetch_payload([], raw_logins={"petrov_ii"}),
        users=fake_users,
        departments=MagicMock(),
    )

    result = service.sync_all_from_ad()

    assert result["deactivated"] == 0
    assert fake_users.get_by_username("petrov_ii")["is_active"] is True


def test_sync_all_from_ad_skips_invalid_long_login(sync_state_path, monkeypatch):
    monkeypatch.setenv("LDAP_APP_USER_IMPORT_PERSON_ONLY", "1")
    long_login = "a" * 51
    ad_users = [
        {
            "login": long_login,
            "display_name": "Long Login User",
            "department": "IT",
            "title": "",
            "mail": "",
            "user_principal_name": "",
        },
    ]
    service = AdAppUserImportService(
        ad_fetcher=lambda: _fetch_payload(ad_users),
        users=FakeUserService(),
        departments=MagicMock(),
    )

    result = service.sync_all_from_ad()

    assert result["skipped_invalid_logins"] == 1
    assert service._users.get_by_username(long_login) is None


def test_sync_all_from_ad_skips_when_ldap_query_failed(sync_state_path):
    fake_users = FakeUserService([
        {"id": 2, "username": "gone.user", "full_name": "Gone User", "auth_source": "ldap", "role": "viewer", "is_active": True},
    ])
    service = AdAppUserImportService(
        ad_fetcher=lambda: _fetch_payload([], ldap_ok=False),
        users=fake_users,
        departments=MagicMock(),
    )

    result = service.sync_all_from_ad()

    assert result["status"] == "warning"
    assert result["deactivated"] == 0
    assert fake_users.get_by_username("gone.user")["is_active"] is True


def test_is_importable_person_ad_user_can_be_disabled(monkeypatch):
    monkeypatch.setenv("LDAP_APP_USER_IMPORT_PERSON_ONLY", "0")
    assert _is_importable_person_ad_user("svc_backup", "Backup Service") is True


def test_sync_all_from_ad_skips_invalid_short_logins(sync_state_path, monkeypatch):
    monkeypatch.setenv("LDAP_APP_USER_IMPORT_PERSON_ONLY", "1")
    ad_users = [
        {"login": "1c", "display_name": "1C", "department": "IT", "title": "", "mail": "", "user_principal_name": ""},
        {"login": "smirnov_ii", "display_name": "Смирнов Иван", "department": "IT", "title": "", "mail": "v@example.com", "user_principal_name": ""},
    ]
    service = AdAppUserImportService(
        ad_fetcher=lambda: ad_users,
        users=FakeUserService(),
        departments=MagicMock(),
    )

    result = service.sync_all_from_ad()

    assert result["status"] == "success"
    assert result["skipped_invalid_logins"] == 1
    assert result["created"] == 1
    assert service._users.get_by_username("1c") is None
    assert service._users.get_by_username("smirnov_ii") is not None


def test_sync_all_from_ad_skips_deactivation_when_ldap_empty(sync_state_path):
    fake_users = FakeUserService([
        {"id": 2, "username": "gone.user", "full_name": "Gone User", "auth_source": "ldap", "role": "viewer", "is_active": True},
    ])
    service = AdAppUserImportService(
        ad_fetcher=lambda: [],
        users=fake_users,
        departments=MagicMock(),
    )

    result = service.sync_all_from_ad()

    assert result["status"] == "warning"
    assert result["deactivated"] == 0
    assert fake_users.get_by_username("gone.user")["is_active"] is True


def test_sync_to_app_reactivates_inactive_user(monkeypatch):
    monkeypatch.setenv("LDAP_APP_USER_IMPORT_PERSON_ONLY", "1")
    ad_users = [
        {"login": "kozlov_aa", "display_name": "Козлов Алексей", "department": "IT", "title": "", "mail": "back@example.com", "user_principal_name": ""},
    ]
    fake_users = FakeUserService([
        {"id": 5, "username": "kozlov_aa", "full_name": "Козлов Алексей", "auth_source": "ldap", "role": "viewer", "is_active": False},
    ])
    service = AdAppUserImportService(
        ad_fetcher=lambda: ad_users,
        users=fake_users,
        departments=MagicMock(),
    )

    result = service.sync_to_app(["kozlov_aa"])

    assert result["reactivated"] == 1
    assert result["updated"] == 0
    assert fake_users.get_by_username("kozlov_aa")["is_active"] is True


def test_sync_all_from_ad_already_running():
    import threading

    lock = threading.Lock()
    lock.acquire()
    service = AdAppUserImportService(
        ad_fetcher=lambda: [],
        users=FakeUserService(),
        departments=MagicMock(),
        sync_lock=lock,
    )

    result = service.sync_all_from_ad()

    assert result["status"] == "already_running"


def test_load_ad_app_user_sync_state_default():
    payload = load_ad_app_user_sync_state()
    assert payload["status"] in {"never", "error", "success", "warning"}
