"""Import Active Directory users into web application users."""
from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

from ldap3 import ALL, SUBTREE, Connection, Server

from backend.config import config
from backend.services.department_service import department_service
from backend.services.session_auth_context_service import normalize_exchange_login
from backend.services.user_service import UserService, user_service

logger = logging.getLogger(__name__)

_SYNC_STATE_FILE = "ad_app_user_sync_state.json"
_sync_lock = threading.Lock()


AD_IMPORT_STATUS_NEW = "new"
AD_IMPORT_STATUS_EXISTS_LDAP = "exists_ldap"
AD_IMPORT_STATUS_LOCAL_CONFLICT = "local_conflict"
AD_IMPORT_WARNING_MISSING_MAIL = "missing_mail"
AD_IMPORT_WARNING_MISSING_DEPARTMENT = "missing_department"
_MIN_APP_USERNAME_LENGTH = 3
_MAX_APP_USERNAME_LENGTH = 50


def _person_accounts_only_enabled() -> bool:
    return str(os.getenv("LDAP_APP_USER_IMPORT_PERSON_ONLY", "1")).strip().lower() in {"1", "true", "yes", "on"}


def _is_valid_app_username(login: Any) -> bool:
    length = len(_normalize_login(login))
    return _MIN_APP_USERNAME_LENGTH <= length <= _MAX_APP_USERNAME_LENGTH


def _is_excluded_non_person_login(login: Any) -> bool:
    """Exclude service/mailbox/invalid logins without checking displayName."""
    login_value = _normalize_login(login)
    if not login_value or not _is_valid_app_username(login_value):
        return True
    if not _person_accounts_only_enabled():
        return False

    from backend.services.ad_users_service import _SERVICE_ACCOUNT_PATTERNS, _detect_account_type

    if _detect_account_type(login_value) == "mailbox":
        return True
    return bool(_SERVICE_ACCOUNT_PATTERNS.match(login_value))


def _is_importable_person_ad_user(login: Any, display_name: Any) -> bool:
    """Match real employee AD accounts; exclude service/mailbox-style entries."""
    login_value = _normalize_login(login)
    display_name_value = _clean_text(display_name)
    if _is_excluded_non_person_login(login_value):
        return False
    if not _person_accounts_only_enabled():
        return True

    from backend.services.ad_users_service import _matches_expiring_person_account

    return _matches_expiring_person_account(login_value, display_name_value)


def _should_deactivate_ldap_user(
    login: str,
    *,
    importable_logins: set[str],
    raw_ad_logins: set[str],
) -> bool:
    """Deactivate when gone from AD or still present but clearly non-person."""
    if login in importable_logins:
        return False
    if login not in raw_ad_logins:
        return True
    return _is_excluded_non_person_login(login)


def _empty_ad_fetch_result(*, ldap_ok: bool = False, error: str | None = None) -> dict[str, Any]:
    return {
        "ldap_ok": ldap_ok,
        "raw_count": 0,
        "raw_logins": set(),
        "users": [],
        "error": error,
    }


def _normalize_ad_fetch_result(data: Any) -> dict[str, Any]:
    if isinstance(data, dict):
        raw_logins = {
            _normalize_login(login)
            for login in (data.get("raw_logins") or [])
            if _normalize_login(login)
        }
        users = list(data.get("users") or [])
        if not raw_logins:
            raw_logins = {
                _normalize_login(item.get("login"))
                for item in users
                if _normalize_login(item.get("login"))
            }
        raw_count = int(data.get("raw_count") or len(raw_logins))
        return {
            "ldap_ok": bool(data.get("ldap_ok", True)),
            "raw_count": raw_count,
            "raw_logins": raw_logins,
            "users": users,
            "error": data.get("error"),
        }

    if isinstance(data, list):
        raw_logins = {
            _normalize_login(item.get("login"))
            for item in data
            if _normalize_login(item.get("login"))
        }
        return {
            "ldap_ok": True,
            "raw_count": len(raw_logins),
            "raw_logins": raw_logins,
            "users": data,
            "error": None,
        }

    return _empty_ad_fetch_result(ldap_ok=False, error="invalid fetch result")


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8").strip()
        except UnicodeDecodeError:
            return value.decode("cp1251", errors="ignore").strip()
    return str(value).strip()


def _first_attr(attrs: dict[str, Any], name: str) -> str:
    value = attrs.get(name)
    if isinstance(value, list):
        return _clean_text(value[0]) if value else ""
    return _clean_text(value)


def _normalize_login(value: Any) -> str:
    return _clean_text(value).lower()


def _dedupe_logins(logins: Iterable[Any]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for login in logins or []:
        normalized = _normalize_login(login)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        out.append(normalized)
    return out


def _sync_state_path() -> Path:
    project_root = Path(__file__).resolve().parents[3]
    return project_root / "data" / _SYNC_STATE_FILE


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_ad_app_user_sync_state() -> dict[str, Any]:
    path = _sync_state_path()
    if not path.is_file():
        return {"status": "never", "last_sync_at": None, "result": None, "error": None}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Failed to read AD app-user sync state: %s", exc)
        return {"status": "error", "last_sync_at": None, "result": None, "error": str(exc)}
    if not isinstance(payload, dict):
        return {"status": "never", "last_sync_at": None, "result": None, "error": None}
    return {
        "status": str(payload.get("status") or "never"),
        "last_sync_at": payload.get("last_sync_at"),
        "result": payload.get("result"),
        "error": payload.get("error"),
    }


def _save_ad_app_user_sync_state(*, status: str, result: dict[str, Any] | None = None, error: str | None = None) -> None:
    path = _sync_state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "status": status,
        "last_sync_at": _utc_now_iso(),
        "result": _sanitize_sync_result_for_storage(result),
        "error": error,
    }
    temp_path = path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)


def _sanitize_sync_result_for_storage(result: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(result, dict):
        return None
    sanitized = dict(result)
    for key in (
        "created_users",
        "updated_users",
        "reactivated_users",
        "deactivated_users",
        "warnings",
    ):
        sanitized.pop(key, None)
    return sanitized


def _build_base_dn() -> str:
    base_dn = os.getenv("LDAP_BASE_DN", "").strip()
    if base_dn:
        return base_dn
    domain = os.getenv("LDAP_DOMAIN", config.app.ldap_domain) or "zsgp.corp"
    return ",".join(f"dc={part}" for part in str(domain).split(".") if part)


def fetch_ad_users_for_import() -> dict[str, Any]:
    """Fetch active AD users for web-account import using paged LDAP search."""
    server_host = os.getenv("LDAP_SERVER", config.app.ldap_server)
    if not server_host:
        logger.warning("LDAP_SERVER not set. Skipping AD app-user import query.")
        return _empty_ad_fetch_result(error="LDAP_SERVER not set")

    sync_user = os.getenv("LDAP_SYNC_USER", "")
    sync_password = os.getenv("LDAP_SYNC_PASSWORD", "")
    server = Server(server_host, get_info=ALL)

    conn = None
    try:
        if sync_user and sync_password:
            conn = Connection(server, user=sync_user, password=sync_password, auto_bind=True)
        else:
            conn = Connection(server, auto_bind=True)
    except Exception as exc:
        logger.error("Failed to bind to LDAP for AD app-user import: %s", exc)
        return _empty_ad_fetch_result(error=str(exc))

    search_filter = (
        "(&(objectCategory=person)(objectClass=user)"
        "(!(userAccountControl:1.2.840.113556.1.4.803:=2))"
        "(sAMAccountName=*)(displayName=*))"
    )
    attributes = [
        "sAMAccountName",
        "displayName",
        "department",
        "title",
        "mail",
        "userPrincipalName",
    ]

    raw_logins: set[str] = set()
    users_by_login: dict[str, dict[str, Any]] = {}
    try:
        entries = conn.extend.standard.paged_search(
            search_base=_build_base_dn(),
            search_filter=search_filter,
            search_scope=SUBTREE,
            attributes=attributes,
            paged_size=500,
            generator=True,
        )
        for entry in entries:
            if entry.get("type") != "searchResEntry":
                continue
            attrs = entry.get("attributes") or {}
            login = _normalize_login(_first_attr(attrs, "sAMAccountName"))
            display_name = _clean_text(_first_attr(attrs, "displayName"))
            if login:
                raw_logins.add(login)
            if not login or not display_name:
                continue
            if not _is_importable_person_ad_user(login, display_name):
                continue
            users_by_login.setdefault(
                login,
                {
                    "login": login,
                    "display_name": display_name,
                    "department": _clean_text(_first_attr(attrs, "department")),
                    "title": _clean_text(_first_attr(attrs, "title")),
                    "mail": _clean_text(_first_attr(attrs, "mail")),
                    "user_principal_name": _clean_text(_first_attr(attrs, "userPrincipalName")),
                },
            )
    except Exception as exc:
        logger.error("AD app-user import search failed: %s", exc)
        return _empty_ad_fetch_result(error=str(exc))
    finally:
        if conn is not None:
            try:
                conn.unbind()
            except Exception:
                pass

    users = list(users_by_login.values())
    users.sort(key=lambda row: (str(row.get("department") or "").casefold(), str(row.get("display_name") or "").casefold()))
    return {
        "ldap_ok": True,
        "raw_count": len(raw_logins),
        "raw_logins": raw_logins,
        "users": users,
        "error": None,
    }


def fetch_ad_import_users() -> list[dict[str, Any]]:
    return fetch_ad_users_for_import()["users"]


class AdAppUserImportService:
    def __init__(
        self,
        *,
        ad_fetcher: Callable[[], Any] = fetch_ad_users_for_import,
        users: UserService = user_service,
        departments=department_service,
        sync_lock: threading.Lock | None = None,
    ) -> None:
        self._ad_fetcher = ad_fetcher
        self._users = users
        self._departments = departments
        self._sync_lock = sync_lock if sync_lock is not None else _sync_lock

    def _fetch_ad_users(self) -> dict[str, Any]:
        return _normalize_ad_fetch_result(self._ad_fetcher())

    @staticmethod
    def _mailbox_login(ad_user: dict[str, Any]) -> str:
        upn = _clean_text(ad_user.get("user_principal_name") or ad_user.get("userPrincipalName"))
        return upn.lower() if upn else normalize_exchange_login(_normalize_login(ad_user.get("login")))

    def _candidate_from_ad_user(self, ad_user: dict[str, Any], existing_by_username: dict[str, dict[str, Any]]) -> dict[str, Any]:
        login = _normalize_login(ad_user.get("login"))
        existing = existing_by_username.get(login)
        auth_source = str((existing or {}).get("auth_source") or "").strip().lower()
        if not existing:
            status = AD_IMPORT_STATUS_NEW
        elif auth_source == "ldap":
            status = AD_IMPORT_STATUS_EXISTS_LDAP
        else:
            status = AD_IMPORT_STATUS_LOCAL_CONFLICT

        mail = _clean_text(ad_user.get("mail"))
        department = _clean_text(ad_user.get("department"))
        warnings: list[str] = []
        if not mail:
            warnings.append(AD_IMPORT_WARNING_MISSING_MAIL)
        if not department:
            warnings.append(AD_IMPORT_WARNING_MISSING_DEPARTMENT)

        return {
            "login": login,
            "display_name": _clean_text(ad_user.get("display_name")) or login,
            "department": department,
            "title": _clean_text(ad_user.get("title")),
            "mail": mail,
            "user_principal_name": _clean_text(ad_user.get("user_principal_name")),
            "mailbox_login": self._mailbox_login(ad_user),
            "import_status": status,
            "warnings": warnings,
        }

    def list_import_candidates(self) -> list[dict[str, Any]]:
        existing_by_username = {
            _normalize_login(user.get("username")): user
            for user in self._users.list_users()
            if _normalize_login(user.get("username"))
        }
        candidates = [
            self._candidate_from_ad_user(ad_user, existing_by_username)
            for ad_user in self._fetch_ad_users()["users"]
        ]
        candidates.sort(key=lambda row: (row["import_status"] == AD_IMPORT_STATUS_LOCAL_CONFLICT, row["department"].casefold(), row["display_name"].casefold()))
        return candidates

    def import_user(self, login: str) -> dict[str, Any]:
        result = self.sync_to_app([login])
        if result["created_users"]:
            return result["created_users"][0]
        if result["updated_users"]:
            return result["updated_users"][0]
        if result.get("reactivated_users"):
            return result["reactivated_users"][0]
        if result["skipped_conflicts"]:
            raise ValueError("AD login conflicts with an existing local web user")
        if result.get("skipped_invalid_logins"):
            raise ValueError("AD login is too short or too long for a web user")
        if result.get("skipped_non_person"):
            raise ValueError("AD account is not importable (service or mailbox account)")
        if result["not_found"]:
            raise ValueError("AD user not found")
        raise ValueError("AD user was not imported")

    def _upsert_ad_user(self, ad_user: dict[str, Any]) -> tuple[str, dict[str, Any] | None, list[str]]:
        login = _normalize_login(ad_user.get("login"))
        if not login:
            return "not_found", None, []
        if not _is_valid_app_username(login):
            return "invalid_login", None, []
        if not _is_importable_person_ad_user(login, ad_user.get("display_name")):
            return "non_person_account", None, []

        existing = self._users.get_by_username(login)
        if existing and str(existing.get("auth_source") or "").strip().lower() != "ldap":
            return AD_IMPORT_STATUS_LOCAL_CONFLICT, existing, []

        display_name = _clean_text(ad_user.get("display_name")) or login
        department = _clean_text(ad_user.get("department")) or None
        job_title = _clean_text(ad_user.get("title")) or None
        email = _clean_text(ad_user.get("mail")) or None
        mailbox_email = email
        mailbox_login = self._mailbox_login(ad_user) or None
        warnings: list[str] = []
        if not email:
            warnings.append(AD_IMPORT_WARNING_MISSING_MAIL)
        if not department:
            warnings.append(AD_IMPORT_WARNING_MISSING_DEPARTMENT)

        if existing:
            user = self._users.update_user(
                int(existing["id"]),
                email=email,
                full_name=display_name,
                department=department,
                job_title=job_title,
                auth_source="ldap",
                is_active=True,
                mailbox_email=mailbox_email,
                mailbox_login=mailbox_login,
            ) or existing
            action = "updated"
        else:
            user = self._users.create_user(
                username=login,
                password=None,
                role="viewer",
                auth_source="ldap",
                email=email,
                full_name=display_name,
                department=department,
                job_title=job_title,
                is_active=True,
                mailbox_email=mailbox_email,
                mailbox_login=mailbox_login,
            )
            action = "created"

        self._departments.replace_user_ad_department(int(user["id"]), department)
        return action, user, warnings

    @staticmethod
    def _record_upsert_stats(
        result: dict[str, Any],
        *,
        login: str,
        action: str,
        user: dict[str, Any] | None,
        warnings: list[str],
        was_inactive: bool = False,
    ) -> None:
        if AD_IMPORT_WARNING_MISSING_MAIL in warnings:
            result["missing_mail"] += 1
        if AD_IMPORT_WARNING_MISSING_DEPARTMENT in warnings:
            result["missing_department"] += 1
        for warning in warnings:
            result["warnings"].append({"login": login, "warning": warning})

        if action == "created":
            result["created"] += 1
            result["created_users"].append(user)
        elif action == "updated":
            if was_inactive:
                result["reactivated"] = int(result.get("reactivated") or 0) + 1
                result.setdefault("reactivated_users", []).append(user)
            else:
                result["updated"] = int(result.get("updated") or 0) + 1
                result.setdefault("updated_users", []).append(user)

    def _deactivate_missing_ldap_users(
        self,
        result: dict[str, Any],
        *,
        importable_logins: set[str],
        raw_ad_logins: set[str],
    ) -> None:
        from backend.services.session_service import session_service

        for user in self._users.list_users():
            login = _normalize_login(user.get("username"))
            if not login:
                continue
            if self._users.is_system_hidden_user(user):
                continue
            if str(user.get("auth_source") or "").strip().lower() != "ldap":
                continue
            if not bool(user.get("is_active", True)):
                continue
            if not _should_deactivate_ldap_user(
                login,
                importable_logins=importable_logins,
                raw_ad_logins=raw_ad_logins,
            ):
                continue

            role = str(user.get("role") or "viewer").strip().lower()
            if role == "admin":
                result["protected_admins"] += 1
                result["protected_admin_logins"].append(login)
                logger.warning(
                    "AD app-user sync skipped deactivation for ldap admin missing from AD: %s",
                    login,
                )
                continue

            user_id = int(user.get("id") or 0)
            if user_id <= 0:
                continue
            updated = self._users.update_user(user_id, is_active=False)
            if not updated:
                continue
            closed_sessions = int(session_service.close_user_sessions(user_id) or 0)
            result["deactivated"] += 1
            result["deactivated_users"].append(updated)
            result["sessions_closed"] += closed_sessions
            result["deactivated_logins"].append(login)

    def sync_all_from_ad(self) -> dict[str, Any]:
        """Upsert all AD users and deactivate ldap users missing from LDAP."""
        if not self._sync_lock.acquire(blocking=False):
            return {
                "status": "already_running",
                "message": "AD app-user sync is already in progress",
            }

        result: dict[str, Any] = {
            "status": "success",
            "created": 0,
            "updated": 0,
            "reactivated": 0,
            "deactivated": 0,
            "skipped_conflicts": 0,
            "skipped_invalid_logins": 0,
            "skipped_non_person": 0,
            "protected_admins": 0,
            "sessions_closed": 0,
            "missing_mail": 0,
            "missing_department": 0,
            "total_ad_users": 0,
            "raw_ad_users": 0,
            "created_users": [],
            "updated_users": [],
            "reactivated_users": [],
            "deactivated_users": [],
            "conflicts": [],
            "deactivated_logins": [],
            "protected_admin_logins": [],
            "invalid_logins": [],
            "skipped_non_person_logins": [],
            "warnings": [],
        }

        try:
            fetch_result = self._fetch_ad_users()
            ad_users = fetch_result["users"]
            raw_ad_logins = set(fetch_result["raw_logins"])
            importable_logins = {
                _normalize_login(item.get("login"))
                for item in ad_users
                if _normalize_login(item.get("login"))
            }
            result["total_ad_users"] = len(importable_logins)
            result["raw_ad_users"] = int(fetch_result.get("raw_count") or len(raw_ad_logins))

            if not fetch_result.get("ldap_ok", False):
                result["status"] = "warning"
                result["message"] = (
                    "LDAP query failed; upsert and deactivation were skipped "
                    "to prevent accidental mass lockout"
                )
                logger.warning(
                    "AD app-user full sync skipped: LDAP query failed (%s)",
                    fetch_result.get("error"),
                )
                _save_ad_app_user_sync_state(status="warning", result=result)
                return result

            if result["raw_ad_users"] == 0:
                result["status"] = "warning"
                result["message"] = (
                    "LDAP returned no users; upsert and deactivation were skipped "
                    "to prevent accidental mass lockout"
                )
                logger.warning("AD app-user full sync skipped: empty LDAP result")
                _save_ad_app_user_sync_state(status="warning", result=result)
                return result

            if not importable_logins:
                result["status"] = "warning"
                result["message"] = (
                    f"LDAP returned {result['raw_ad_users']} accounts, "
                    "but none passed the person filter; deactivation still ran"
                )
                logger.warning(
                    "AD app-user full sync: no importable users out of %s raw AD accounts",
                    result["raw_ad_users"],
                )

            for ad_user in ad_users:
                login = _normalize_login(ad_user.get("login"))
                if not login:
                    continue
                existing = self._users.get_by_username(login)
                was_inactive = bool(existing and not bool(existing.get("is_active", True)))
                action, user, warnings = self._upsert_ad_user(ad_user)
                if action == AD_IMPORT_STATUS_LOCAL_CONFLICT:
                    result["skipped_conflicts"] += 1
                    result["conflicts"].append({
                        "login": login,
                        "existing_user_id": int((user or {}).get("id") or 0),
                        "auth_source": str((user or {}).get("auth_source") or "local"),
                    })
                    continue
                if action == "invalid_login":
                    result["skipped_invalid_logins"] += 1
                    result["invalid_logins"].append(login)
                    continue
                if action == "non_person_account":
                    result["skipped_non_person"] += 1
                    result["skipped_non_person_logins"].append(login)
                    continue
                self._record_upsert_stats(
                    result,
                    login=login,
                    action=action,
                    user=user,
                    warnings=warnings,
                    was_inactive=was_inactive,
                )

            self._deactivate_missing_ldap_users(
                result,
                importable_logins=importable_logins,
                raw_ad_logins=raw_ad_logins,
            )
            _save_ad_app_user_sync_state(status=str(result["status"]), result=result)
            logger.info(
                "AD app-user full sync completed: created=%s updated=%s reactivated=%s "
                "deactivated=%s protected_admins=%s sessions_closed=%s conflicts=%s",
                result["created"],
                result["updated"],
                result["reactivated"],
                result["deactivated"],
                result["protected_admins"],
                result["sessions_closed"],
                result["skipped_conflicts"],
            )
            return result
        except Exception as exc:
            logger.exception("AD app-user full sync failed")
            _save_ad_app_user_sync_state(status="error", result=result, error=str(exc))
            return {
                **result,
                "status": "error",
                "message": str(exc),
            }
        finally:
            self._sync_lock.release()

    def get_sync_status(self) -> dict[str, Any]:
        return load_ad_app_user_sync_state()

    def sync_to_app(self, logins: Iterable[Any]) -> dict[str, Any]:
        requested_logins = _dedupe_logins(logins)
        ad_by_login = {
            _normalize_login(user.get("login")): user
            for user in self._fetch_ad_users()["users"]
            if _normalize_login(user.get("login"))
        }
        result: dict[str, Any] = {
            "created": 0,
            "updated": 0,
            "reactivated": 0,
            "skipped_conflicts": 0,
            "skipped_invalid_logins": 0,
            "skipped_non_person": 0,
            "missing_mail": 0,
            "missing_department": 0,
            "not_found": 0,
            "total_requested": len(requested_logins),
            "created_users": [],
            "updated_users": [],
            "reactivated_users": [],
            "conflicts": [],
            "not_found_logins": [],
            "warnings": [],
        }

        for login in requested_logins:
            ad_user = ad_by_login.get(login)
            if not ad_user:
                result["not_found"] += 1
                result["not_found_logins"].append(login)
                continue

            existing_before = self._users.get_by_username(login)
            was_inactive = bool(existing_before and not bool(existing_before.get("is_active", True)))
            action, user, warnings = self._upsert_ad_user(ad_user)
            if action == AD_IMPORT_STATUS_LOCAL_CONFLICT:
                result["skipped_conflicts"] += 1
                result["conflicts"].append({
                    "login": login,
                    "existing_user_id": int((user or {}).get("id") or 0),
                    "auth_source": str((user or {}).get("auth_source") or "local"),
                })
                continue
            if action == "invalid_login":
                result["skipped_invalid_logins"] = int(result.get("skipped_invalid_logins") or 0) + 1
                result.setdefault("invalid_logins", []).append(login)
                continue
            if action == "non_person_account":
                result["skipped_non_person"] = int(result.get("skipped_non_person") or 0) + 1
                result.setdefault("skipped_non_person_logins", []).append(login)
                continue

            self._record_upsert_stats(
                result,
                login=login,
                action=action,
                user=user,
                warnings=warnings,
                was_inactive=was_inactive and action == "updated",
            )

        return result


ad_app_user_import_service = AdAppUserImportService()
