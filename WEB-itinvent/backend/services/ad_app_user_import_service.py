"""Import Active Directory users into web application users."""
from __future__ import annotations

import logging
import os
from typing import Any, Callable, Iterable

from ldap3 import ALL, SUBTREE, Connection, Server

from backend.config import config
from backend.services.department_service import department_service
from backend.services.session_auth_context_service import normalize_exchange_login
from backend.services.user_service import user_service

logger = logging.getLogger(__name__)


AD_IMPORT_STATUS_NEW = "new"
AD_IMPORT_STATUS_EXISTS_LDAP = "exists_ldap"
AD_IMPORT_STATUS_LOCAL_CONFLICT = "local_conflict"
AD_IMPORT_WARNING_MISSING_MAIL = "missing_mail"
AD_IMPORT_WARNING_MISSING_DEPARTMENT = "missing_department"


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


def _build_base_dn() -> str:
    base_dn = os.getenv("LDAP_BASE_DN", "").strip()
    if base_dn:
        return base_dn
    domain = os.getenv("LDAP_DOMAIN", config.app.ldap_domain) or "zsgp.corp"
    return ",".join(f"dc={part}" for part in str(domain).split(".") if part)


def fetch_ad_import_users() -> list[dict[str, Any]]:
    """Fetch active AD users for web-account import using paged LDAP search."""
    server_host = os.getenv("LDAP_SERVER", config.app.ldap_server)
    if not server_host:
        logger.warning("LDAP_SERVER not set. Skipping AD app-user import query.")
        return []

    sync_user = os.getenv("LDAP_SYNC_USER", "")
    sync_password = os.getenv("LDAP_SYNC_PASSWORD", "")
    server = Server(server_host, get_info=ALL)

    try:
        if sync_user and sync_password:
            conn = Connection(server, user=sync_user, password=sync_password, auto_bind=True)
        else:
            conn = Connection(server, auto_bind=True)
    except Exception as exc:
        logger.error("Failed to bind to LDAP for AD app-user import: %s", exc)
        return []

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
            if not login or not display_name:
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
        return []
    finally:
        conn.unbind()

    users = list(users_by_login.values())
    users.sort(key=lambda row: (str(row.get("department") or "").casefold(), str(row.get("display_name") or "").casefold()))
    return users


class AdAppUserImportService:
    def __init__(
        self,
        *,
        ad_fetcher: Callable[[], list[dict[str, Any]]] = fetch_ad_import_users,
        users=user_service,
        departments=department_service,
    ) -> None:
        self._ad_fetcher = ad_fetcher
        self._users = users
        self._departments = departments

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
            for ad_user in self._ad_fetcher()
        ]
        candidates.sort(key=lambda row: (row["import_status"] == AD_IMPORT_STATUS_LOCAL_CONFLICT, row["department"].casefold(), row["display_name"].casefold()))
        return candidates

    def import_user(self, login: str) -> dict[str, Any]:
        result = self.sync_to_app([login])
        if result["created_users"]:
            return result["created_users"][0]
        if result["updated_users"]:
            return result["updated_users"][0]
        if result["skipped_conflicts"]:
            raise ValueError("AD login conflicts with an existing local web user")
        if result["not_found"]:
            raise ValueError("AD user not found")
        raise ValueError("AD user was not imported")

    def _upsert_ad_user(self, ad_user: dict[str, Any]) -> tuple[str, dict[str, Any] | None, list[str]]:
        login = _normalize_login(ad_user.get("login"))
        if not login:
            return "not_found", None, []

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

    def sync_to_app(self, logins: Iterable[Any]) -> dict[str, Any]:
        requested_logins = _dedupe_logins(logins)
        ad_by_login = {
            _normalize_login(user.get("login")): user
            for user in self._ad_fetcher()
            if _normalize_login(user.get("login"))
        }
        result: dict[str, Any] = {
            "created": 0,
            "updated": 0,
            "skipped_conflicts": 0,
            "missing_mail": 0,
            "missing_department": 0,
            "not_found": 0,
            "total_requested": len(requested_logins),
            "created_users": [],
            "updated_users": [],
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

            action, user, warnings = self._upsert_ad_user(ad_user)
            if action == AD_IMPORT_STATUS_LOCAL_CONFLICT:
                result["skipped_conflicts"] += 1
                result["conflicts"].append({
                    "login": login,
                    "existing_user_id": int((user or {}).get("id") or 0),
                    "auth_source": str((user or {}).get("auth_source") or "local"),
                })
                continue

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
                result["updated"] += 1
                result["updated_users"].append(user)

        return result


ad_app_user_import_service = AdAppUserImportService()
