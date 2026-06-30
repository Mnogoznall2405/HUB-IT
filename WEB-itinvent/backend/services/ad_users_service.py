import os
import logging
import math
import re
from datetime import datetime, timezone, timedelta
from typing import Any, List, Dict, Literal

from ldap3 import Server, Connection, ALL, SUBTREE, LEVEL
from ldap3.utils.conv import escape_filter_chars
from sqlalchemy import select
from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppAdUserBranchOverride
from backend.config import config
from backend.database.connection import get_db
from backend.services.ad_expiry_cache import ad_expiry_cache, cache_metadata
from local_store import get_local_store

logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

# 100-nanosecond intervals from Jan 1, 1601 to Jan 1, 1970
epoch_diff = 116444736000000000
AD_PASSWORD_MAX_AGE_DAYS_DEFAULT = 40
AD_UF_DONT_EXPIRE_PASSWD = 0x10000

# Built-in AD groups to exclude from user group listings by default
_BUILTIN_GROUPS = frozenset({
    "Domain Users",
    "Domain Computers",
    "Users",
    "Пользователи домена",
})

_AD_USER_ENABLED_FILTER = (
    "(&(objectCategory=person)(objectClass=user)"
    "(!(userAccountControl:1.2.840.113556.1.4.803:=2)))"
)

_AD_USER_PASSWORD_ATTRIBUTES = [
    "sAMAccountName",
    "displayName",
    "department",
    "title",
    "pwdLastSet",
    "userAccountControl",
    "distinguishedName",
]

_AD_LDAP_PAGE_SIZE = 1000
_AD_PAGED_RESULTS_OID = "1.2.840.113556.1.4.319"

_SERVICE_ACCOUNT_PATTERNS = re.compile(
    r"^(healthmailbox|svc[_\-]|admin(?:[_\-.]|$)|1c|1bit|bcpexec|corp[\.\-]admin|aid$|"
    r"scan[_\-]|backup|test[_\-]|service|system|sql|exchange|smtp|ftp|www|http|"
    r"ldap[_\-]|bdd[\.\-]|personal$|usa$|lnk\.|lrk\.)",
    re.IGNORECASE,
)


def get_ad_password_max_age_days() -> int:
    try:
        value = int(str(os.getenv("AD_PASSWORD_MAX_AGE_DAYS", "")).strip() or AD_PASSWORD_MAX_AGE_DAYS_DEFAULT)
    except (TypeError, ValueError):
        return AD_PASSWORD_MAX_AGE_DAYS_DEFAULT
    return value if value > 0 else AD_PASSWORD_MAX_AGE_DAYS_DEFAULT


def _detect_account_type(sam_account_name: str) -> str:
    """Determine if sAMAccountName is a mailbox (dot) or user (underscore) account.

    Returns "mailbox" if the name contains a dot and no underscore, "user" otherwise.
    """
    name = str(sam_account_name or "").strip()
    if "." in name and "_" not in name:
        return "mailbox"
    return "user"


def filetime_to_datetime(filetime: int | str | None) -> datetime | None:
    """Convert a Windows FILETIME (100ns intervals since 1601-01-01) to a Python UTC datetime.

    Returns None if the value is 0 or invalid.
    """
    try:
        value = int(filetime or 0)
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    try:
        timestamp = (value - epoch_diff) / 10_000_000
        return datetime.fromtimestamp(timestamp, timezone.utc)
    except (OSError, OverflowError, ValueError):
        return None


def datetime_to_filetime(dt: datetime) -> int:
    """Convert a Python datetime to a Windows FILETIME integer.

    Inverse of filetime_to_datetime (within 1-second precision).
    """
    timestamp = dt.timestamp()
    return int(timestamp * 10_000_000) + epoch_diff


def calculate_password_expiration_status(
    pwd_last_set_raw: int | str | None,
    *,
    now_utc: datetime | None = None,
    max_age_days: int | None = None,
) -> dict[str, Any]:
    """Convert AD pwdLastSet to a safe password-age status payload."""
    try:
        raw_value = int(pwd_last_set_raw or 0)
    except (TypeError, ValueError):
        raw_value = 0
    policy_days = int(max_age_days or get_ad_password_max_age_days())
    now = (now_utc or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if raw_value <= 0:
        return {
            "pwd_last_set": raw_value,
            "pwd_last_set_date": None,
            "expiration_date": None,
            "password_age_days": None,
            "days_to_expire": 0,
            "expired": True,
            "expired_days": None,
            "must_change_now": True,
            "policy_days": policy_days,
        }

    timestamp = (raw_value - epoch_diff) / 10000000
    try:
        pwd_last_set_date = datetime.fromtimestamp(timestamp, timezone.utc)
    except (OSError, OverflowError, ValueError):
        # Invalid FILETIME value (e.g., too small to represent a valid date)
        return {
            "pwd_last_set": raw_value,
            "pwd_last_set_date": None,
            "expiration_date": None,
            "password_age_days": None,
            "days_to_expire": 0,
            "expired": True,
            "expired_days": None,
            "must_change_now": True,
            "policy_days": policy_days,
        }
    expiration_date = pwd_last_set_date + timedelta(days=policy_days)
    age_seconds = max(0.0, (now - pwd_last_set_date).total_seconds())
    remaining_seconds = (expiration_date - now).total_seconds()
    expired = remaining_seconds < 0
    return {
        "pwd_last_set": raw_value,
        "pwd_last_set_date": pwd_last_set_date.isoformat(),
        "expiration_date": expiration_date.isoformat(),
        "password_age_days": int(age_seconds // 86400),
        "days_to_expire": max(0, int(math.ceil(remaining_seconds / 86400))) if remaining_seconds > 0 else 0,
        "expired": expired,
        "expired_days": int(math.ceil(abs(remaining_seconds) / 86400)) if expired else 0,
        "must_change_now": expired,
        "policy_days": policy_days,
    }


def _resolve_ad_search_base() -> str:
    base_dn = os.getenv("LDAP_BASE_DN", "")
    if not base_dn:
        domain = os.getenv("LDAP_DOMAIN", config.app.ldap_domain)
        if domain:
            base_dn = ",".join(f"dc={part}" for part in domain.split("."))
        else:
            base_dn = "dc=zsgp,dc=corp"
    # Search from the domain root to cover all OUs (Users standart, IT, service accounts, etc.)
    return base_dn


def _open_ad_connection() -> Connection | None:
    server_host = os.getenv("LDAP_SERVER", config.app.ldap_server)
    if not server_host:
        logger.warning("LDAP_SERVER not set. Skipping AD query.")
        return None

    sync_user = os.getenv("LDAP_SYNC_USER", "")
    sync_password = os.getenv("LDAP_SYNC_PASSWORD", "")
    server = Server(server_host, get_info=ALL)
    if sync_user and sync_password:
        return Connection(server, user=sync_user, password=sync_password, auto_bind=True)
    try:
        return Connection(server, auto_bind=True)
    except Exception as e:
        logger.error(f"Failed to bind anonymously. Set LDAP_SYNC_USER and LDAP_SYNC_PASSWORD: {e}")
        return None


def _resolve_search_base(ou_dn: str | None) -> str:
    normalized = str(ou_dn or "").strip()
    return normalized or _resolve_ad_search_base()


def _build_ad_users_search_filter(*, expiring_only: bool = False) -> str:
    # Password-expiry reports always filter in Python; keep one enabled-user LDAP filter.
    del expiring_only
    return _AD_USER_ENABLED_FILTER


def _paged_search_entries(
    conn: Connection,
    *,
    search_base: str,
    search_filter: str,
    attributes: list[str] | None = None,
) -> list[Any]:
    attribute_list = attributes or _AD_USER_PASSWORD_ATTRIBUTES
    entries: list[Any] = []
    cookie: bytes | None = None
    while True:
        conn.search(
            search_base=search_base,
            search_filter=search_filter,
            attributes=attribute_list,
            search_scope=SUBTREE,
            size_limit=0,
            paged_size=_AD_LDAP_PAGE_SIZE,
            paged_cookie=cookie,
        )
        entries.extend(list(getattr(conn, "entries", []) or []))
        result = getattr(conn, "result", None) or {}
        controls = result.get("controls") or {}
        page_control = controls.get(_AD_PAGED_RESULTS_OID) or controls.get(_AD_PAGED_RESULTS_OID.encode("ascii"))
        if not page_control:
            break
        cookie = page_control.get("value", {}).get("cookie")
        if not cookie:
            break
    return entries


def _search_ad_users(
    search_base: str,
    *,
    expiring_only: bool = False,
    search_filter: str | None = None,
    attributes: list[str] | None = None,
) -> tuple[list[Any], str | None]:
    conn = _open_ad_connection()
    if conn is None:
        return [], "LDAP connection is not configured or bind failed."
    resolved_filter = str(search_filter or "").strip() or _build_ad_users_search_filter(expiring_only=expiring_only)
    try:
        entries = _paged_search_entries(
            conn,
            search_base=search_base,
            search_filter=resolved_filter,
            attributes=attributes,
        )
        logger.info(
            "AD user search completed base=%s filter=%s entries=%s paged=true",
            search_base,
            resolved_filter[:120],
            len(entries),
        )
        return entries, None
    except Exception as exc:
        logger.error("AD user search failed: %s", exc)
        return [], str(exc)
    finally:
        try:
            conn.unbind()
        except Exception:
            pass


def _merge_entries_by_login(entries: list[Any]) -> list[Any]:
    merged: dict[str, Any] = {}
    fallback: list[Any] = []
    for entry in entries:
        login = _entry_value(entry, "sAMAccountName").lower()
        if login:
            merged[login] = entry
        else:
            fallback.append(entry)
    return [*merged.values(), *fallback]


def _ou_label_from_entry(entry: Any) -> str:
    label = _entry_value(entry, "ou") or _entry_value(entry, "name")
    if label:
        return label
    dn = _entry_value(entry, "distinguishedName")
    if not dn:
        return ""
    first_segment = dn.split(",", 1)[0]
    if "=" in first_segment:
        return first_segment.split("=", 1)[1]
    return first_segment


def _ou_path_from_dn(dn: str) -> str:
    parts: list[str] = []
    for segment in str(dn or "").split(","):
        if segment.upper().startswith("OU="):
            parts.append(segment[3:])
    return " / ".join(reversed(parts))


def _load_branch_mapping_context() -> dict[str, Any]:
    branch_map: dict[str, dict[str, Any]] = {}
    try:
        db = get_db("OBJ-ITINVENT")
        query = """
            SELECT
                o.OWNER_LOGIN,
                b.BRANCH_NO,
                b.BRANCH_NAME
            FROM OWNERS o
            LEFT JOIN (
                SELECT EMPL_NO, MAX(BRANCH_NO) as BRANCH_NO
                FROM ITEMS
                WHERE EMPL_NO IS NOT NULL AND BRANCH_NO IS NOT NULL AND BRANCH_NO > 0
                GROUP BY EMPL_NO
            ) as i ON i.EMPL_NO = o.OWNER_NO
            LEFT JOIN BRANCHES b ON b.BRANCH_NO = i.BRANCH_NO
            WHERE o.OWNER_LOGIN IS NOT NULL AND b.BRANCH_NAME IS NOT NULL
        """
        res = db.execute_query(query)
        for row in res:
            login = str(row["OWNER_LOGIN"]).lower().strip()
            branch_map[login] = {
                "branch_no": row["BRANCH_NO"],
                "branch_name": decode_cp1251(row["BRANCH_NAME"]) or "Неотсортированные",
            }
    except Exception as exc:
        logger.error("Failed to fetch branch mappings from DB: %s", exc)

    try:
        custom_branches = _load_custom_branch_mappings()
    except Exception as exc:
        logger.error("Failed to load custom branch mappings from internal store: %s", exc)
        custom_branches = {}

    all_branches: dict[int, str] = {}
    try:
        from backend.database.equipment_db import get_all_branches

        branches_list = get_all_branches("OBJ-ITINVENT")
        for branch in branches_list:
            branch_no = branch.get("BRANCH_NO") or branch.get("branch_no")
            branch_name = branch.get("BRANCH_NAME") or branch.get("branch_name")
            if branch_name and isinstance(branch_name, str):
                branch_name = decode_cp1251(branch_name)
            if branch_no:
                all_branches[int(branch_no)] = branch_name or "Неотсортированные"
    except Exception as exc:
        logger.error("Failed to fetch all branches for mapping: %s", exc)

    return {
        "branch_map": branch_map,
        "custom_branches": custom_branches,
        "all_branches": all_branches,
    }


def _resolve_branch_for_login(login_lower: str, branch_context: dict[str, Any]) -> tuple[Any, str]:
    custom_branches = branch_context.get("custom_branches") or {}
    branch_map = branch_context.get("branch_map") or {}
    all_branches = branch_context.get("all_branches") or {}

    local_branch_no = custom_branches.get(login_lower)
    if local_branch_no:
        return local_branch_no, all_branches.get(local_branch_no, "Неотсортированные")

    mapped_branch = branch_map.get(login_lower, {})
    return mapped_branch.get("branch_no"), mapped_branch.get("branch_name", "Неотсортированные")


def _entry_user_account_control_raw(entry: Any) -> int:
    try:
        attr = getattr(entry, "userAccountControl")
    except Exception:
        attr = None
    if attr is None:
        return 0
    raw_values = getattr(attr, "raw_values", None)
    if raw_values:
        try:
            return int(raw_values[0])
        except (TypeError, ValueError):
            pass
    value = getattr(attr, "value", None)
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _entry_password_never_expires(entry: Any) -> bool:
    return bool(_entry_user_account_control_raw(entry) & AD_UF_DONT_EXPIRE_PASSWD)


def _apply_password_never_expires(
    password_status: dict[str, Any],
    *,
    never_expires: bool,
    pwd_last_set_raw: int,
) -> dict[str, Any]:
    if never_expires and pwd_last_set_raw > 0:
        password_status.update({
            "password_never_expires": True,
            "expiration_date": None,
            "days_to_expire": None,
            "expired": False,
            "expired_days": 0,
            "must_change_now": False,
        })
    else:
        password_status["password_never_expires"] = False
    return password_status


def _user_record_from_entry(
    entry: Any,
    branch_context: dict[str, Any],
    *,
    include_pwd_last_set: bool = False,
) -> dict[str, Any] | None:
    display_name = _entry_value(entry, "displayName")
    login = _entry_value(entry, "sAMAccountName")
    if not display_name and not login:
        return None

    pwd_last_set_raw = _entry_pwd_last_set_raw(entry)
    password_status = calculate_password_expiration_status(pwd_last_set_raw)
    password_status = _apply_password_never_expires(
        password_status,
        never_expires=_entry_password_never_expires(entry),
        pwd_last_set_raw=pwd_last_set_raw,
    )
    if not include_pwd_last_set:
        password_status.pop("pwd_last_set", None)

    login_lower = str(login).lower().strip()
    branch_no, branch_name = _resolve_branch_for_login(login_lower, branch_context)
    distinguished_name = _entry_value(entry, "distinguishedName")

    return {
        "login": login,
        "display_name": display_name,
        "department": _entry_value(entry, "department"),
        "title": _entry_value(entry, "title"),
        **password_status,
        "branch_name": branch_name,
        "branch_no": branch_no,
        "ou_path": _ou_path_from_dn(distinguished_name) if distinguished_name else "",
    }


def _is_person_password_account(login: str, display_name: str) -> bool:
    login_value = str(login or "").strip()
    display_name_value = str(display_name or "").strip()
    if not login_value:
        return False
    if _SERVICE_ACCOUNT_PATTERNS.match(login_value):
        return False
    if _detect_account_type(login_value) == "mailbox":
        return False
    if "_" in login_value:
        return True
    if not display_name_value:
        return False
    if len(display_name_value.split()) < 2:
        return False
    if not display_name_value[0].isalpha():
        return False
    name_parts = display_name_value.split()
    if len(name_parts) > 6:
        return False
    first_word = name_parts[0]
    if not first_word or not first_word[0].isupper():
        return False
    return True


def _matches_expiring_person_account(login: str, display_name: str) -> bool:
    """Backward-compatible alias for person-account heuristics."""
    return _is_person_password_account(login, display_name)


def _matches_search_query(user: dict[str, Any], query: str) -> bool:
    normalized_query = _normalize_lookup_text(query)
    if not normalized_query:
        return True
    haystacks = [
        _normalize_lookup_text(user.get("login")),
        _normalize_lookup_text(user.get("display_name")),
        _normalize_lookup_text(user.get("department")),
    ]
    if any(normalized_query in haystack for haystack in haystacks if haystack):
        return True
    tokens = _lookup_tokens(query)
    if not tokens:
        return True
    display_name = _normalize_lookup_text(user.get("display_name"))
    login = _normalize_lookup_text(user.get("login"))
    return any(token in display_name or token in login for token in tokens)


def _fetch_organizational_units_from_ldap(*, parent_dn: str | None = None) -> dict[str, Any]:
    conn = _open_ad_connection()
    if conn is None:
        return {
            "status": "error",
            "error": "LDAP connection is not configured or bind failed.",
            "parent_dn": str(parent_dn or "").strip() or None,
            "items": [],
        }

    search_base = _resolve_search_base(parent_dn)
    try:
        conn.search(
            search_base=search_base,
            search_filter="(objectClass=organizationalUnit)",
            attributes=["distinguishedName", "name", "ou"],
            search_scope=LEVEL,
        )
        entries = list(getattr(conn, "entries", []) or [])
        items: list[dict[str, Any]] = []
        for entry in entries:
            dn = _entry_value(entry, "distinguishedName")
            if not dn:
                continue
            label = _ou_label_from_entry(entry) or dn
            items.append({
                "dn": dn,
                "label": label,
                "has_children": True,
            })
        items.sort(key=lambda item: str(item.get("label") or "").casefold())
        return {
            "status": "ok",
            "parent_dn": str(parent_dn or "").strip() or None,
            "items": items,
        }
    except Exception as exc:
        logger.error("AD organizational unit lookup failed: %s", exc)
        return {
            "status": "error",
            "error": str(exc),
            "parent_dn": str(parent_dn or "").strip() or None,
            "items": [],
        }
    finally:
        try:
            conn.unbind()
        except Exception:
            pass


def list_ad_organizational_units(*, parent_dn: str | None = None, force: bool = False) -> dict[str, Any]:
    normalized_parent = str(parent_dn or "").strip() or None

    if not force:
        cached = ad_expiry_cache.get_ou_children(normalized_parent)
        if cached is not None:
            return {
                "status": "ok",
                "parent_dn": normalized_parent,
                "items": list(cached.value),
                **cache_metadata(cached, from_cache=True),
            }

    cache_key = ad_expiry_cache.build_ou_key(normalized_parent)

    def load_fresh() -> dict[str, Any]:
        payload = _fetch_organizational_units_from_ldap(parent_dn=normalized_parent)
        if payload.get("status") != "ok":
            return payload
        stored = ad_expiry_cache.set_ou_children(normalized_parent, payload["items"])
        return {
            **payload,
            **cache_metadata(stored, from_cache=False),
        }

    if force:
        return load_fresh()

    def singleflight_loader():
        result = load_fresh()
        if result.get("status") != "ok":
            raise RuntimeError(str(result.get("error") or "OU lookup failed"))
        stored = ad_expiry_cache.get_ou_children(normalized_parent)
        if stored is None:
            raise RuntimeError("OU cache entry missing after load")
        return stored

    try:
        cached = ad_expiry_cache.run_singleflight(cache_key, singleflight_loader)
    except RuntimeError as exc:
        return {
            "status": "error",
            "error": str(exc),
            "parent_dn": normalized_parent,
            "items": [],
        }

    return {
        "status": "ok",
        "parent_dn": normalized_parent,
        "items": list(cached.value),
        **cache_metadata(cached, from_cache=True),
    }


def _build_password_expiry_users(
    entries: list[Any],
    *,
    normalized_mode: str,
    threshold: int,
    branch_context: dict[str, Any],
) -> list[dict[str, Any]]:
    users: list[dict[str, Any]] = []
    for entry in entries:
        record = _user_record_from_entry(entry, branch_context, include_pwd_last_set=False)
        if not record:
            continue
        login_value = str(record.get("login") or "").strip()
        display_name_value = str(record.get("display_name") or "").strip()
        if not _is_person_password_account(login_value, display_name_value):
            continue
        if not display_name_value:
            record["display_name"] = login_value
        if normalized_mode == "expiring":
            days_to_expire = int(record.get("days_to_expire") or 0)
            expired = bool(record.get("expired"))
            must_change = bool(record.get("must_change_now"))
            pwd_never_expires = bool(record.get("password_never_expires"))
            if pwd_never_expires:
                continue
            if not (days_to_expire <= threshold or expired or must_change):
                continue
        users.append(record)

    urgency_sort_key = lambda user: (
        0 if user.get("must_change_now") or user.get("expired") else 1,
        1 if user.get("password_never_expires") else 0,
        int(user.get("days_to_expire") or 0),
        str(user.get("display_name") or ""),
    )

    if normalized_mode == "expiring":
        users.sort(key=urgency_sort_key)
    else:
        users.sort(key=lambda user: (
            urgency_sort_key(user),
            user.get("branch_name") == "Неотсортированные",
            user.get("branch_name"),
        ))
    return users


def _fetch_password_expiry_users_from_ldap(
    *,
    ou_dn: str | None,
    normalized_mode: str,
    threshold: int,
) -> tuple[list[dict[str, Any]], int, str | None, dict[str, Any]]:
    search_base = _resolve_search_base(ou_dn)
    policy_days = get_ad_password_max_age_days()
    entries, error = _search_ad_users(search_base)
    if error:
        return [], policy_days, error, {"ldap_entries_fetched": 0, "ldap_paged": True}
    branch_context = _load_branch_mapping_context()
    users = _build_password_expiry_users(
        entries,
        normalized_mode=normalized_mode,
        threshold=threshold,
        branch_context=branch_context,
    )
    ldap_meta = {"ldap_entries_fetched": len(entries), "ldap_paged": True}
    return users, policy_days, None, ldap_meta


def _supplement_password_expiry_users_for_query(
    users_snapshot: list[dict[str, Any]],
    *,
    ou_dn: str | None,
    normalized_mode: str,
    threshold: int,
    q: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    normalized_q = str(q or "").strip()
    if len(normalized_q) < 2:
        return list(users_snapshot), {}
    search_base = _resolve_search_base(ou_dn)
    targeted_entries, error = _search_ad_users(
        search_base,
        search_filter=_build_user_lookup_filter(normalized_q),
    )
    if error or not targeted_entries:
        return list(users_snapshot), {}
    branch_context = _load_branch_mapping_context()
    supplemental_users = _build_password_expiry_users(
        targeted_entries,
        normalized_mode=normalized_mode,
        threshold=threshold,
        branch_context=branch_context,
    )
    by_login = {
        str(user.get("login") or "").lower(): user
        for user in users_snapshot
        if str(user.get("login") or "").strip()
    }
    added = 0
    for user in supplemental_users:
        login_key = str(user.get("login") or "").lower()
        if login_key and login_key not in by_login:
            by_login[login_key] = user
            added += 1
    return list(by_login.values()), {
        "ldap_targeted_entries_fetched": len(targeted_entries),
        "ldap_targeted_users_added": added,
    }


def get_ad_password_expiry_report(
    *,
    ou_dn: str | None = None,
    mode: Literal["all", "expiring"] | str = "all",
    days_threshold: int = 7,
    q: str = "",
    force: bool = False,
) -> dict[str, Any]:
    normalized_mode = str(mode or "all").strip().lower()
    if normalized_mode not in {"all", "expiring"}:
        normalized_mode = "all"
    threshold = max(1, int(days_threshold or 7))
    normalized_ou = str(ou_dn or "").strip() or None
    policy_days = get_ad_password_max_age_days()
    cache_key = ad_expiry_cache.build_report_key(
        ou_dn=normalized_ou,
        mode=normalized_mode,
        days_threshold=threshold,
    )

    def build_response(
        users_snapshot: list[dict[str, Any]],
        snapshot_policy_days: int,
        *,
        cached_hit,
        from_cache: bool,
        ldap_meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        merged_users, targeted_meta = _supplement_password_expiry_users_for_query(
            users_snapshot,
            ou_dn=normalized_ou,
            normalized_mode=normalized_mode,
            threshold=threshold,
            q=q,
        )
        filtered_users = [
            user for user in merged_users
            if _matches_search_query(user, q)
        ]
        payload = {
            "status": "ok",
            "ou_dn": normalized_ou,
            "mode": normalized_mode,
            "threshold_days": threshold if normalized_mode == "expiring" else None,
            "policy_days": snapshot_policy_days,
            "total": len(filtered_users),
            "users": filtered_users,
        }
        if ldap_meta:
            payload.update(ldap_meta)
        if targeted_meta:
            payload.update(targeted_meta)
        if cached_hit is not None:
            payload.update(cache_metadata(cached_hit, from_cache=from_cache))
        return payload

    if not force:
        cached = ad_expiry_cache.get_report_snapshot(cache_key)
        if cached is not None:
            snapshot = cached.value
            return build_response(
                list(snapshot.get("users") or []),
                int(snapshot.get("policy_days") or policy_days),
                cached_hit=cached,
                from_cache=True,
            )

    def loader():
        users_snapshot, snapshot_policy_days, error, ldap_meta = _fetch_password_expiry_users_from_ldap(
            ou_dn=normalized_ou,
            normalized_mode=normalized_mode,
            threshold=threshold,
        )
        if error:
            return {
                "status": "error",
                "error": error,
                "ou_dn": normalized_ou,
                "mode": normalized_mode,
                "threshold_days": threshold if normalized_mode == "expiring" else None,
                "policy_days": snapshot_policy_days,
                "total": 0,
                "users": [],
            }
        stored = ad_expiry_cache.set_report_snapshot(
            cache_key,
            {"users": users_snapshot, "policy_days": snapshot_policy_days},
        )
        return build_response(
            users_snapshot,
            snapshot_policy_days,
            cached_hit=stored,
            from_cache=False,
            ldap_meta=ldap_meta,
        )

    if force:
        return loader()

    def singleflight_loader():
        result = loader()
        if result.get("status") == "error":
            raise RuntimeError(str(result.get("error") or "AD password expiry lookup failed"))
        stored = ad_expiry_cache.get_report_snapshot(cache_key)
        if stored is None:
            raise RuntimeError("AD password expiry cache entry missing after load")
        return stored

    try:
        cached = ad_expiry_cache.run_singleflight(cache_key, singleflight_loader)
    except RuntimeError as exc:
        return {
            "status": "error",
            "error": str(exc),
            "ou_dn": normalized_ou,
            "mode": normalized_mode,
            "threshold_days": threshold if normalized_mode == "expiring" else None,
            "policy_days": policy_days,
            "total": 0,
            "users": [],
        }

    snapshot = cached.value
    return build_response(
        list(snapshot.get("users") or []),
        int(snapshot.get("policy_days") or policy_days),
        cached_hit=cached,
        from_cache=True,
    )


def _entry_value(entry: Any, attr_name: str) -> str:
    try:
        attr = getattr(entry, attr_name)
    except Exception:
        attr = None
    if attr is None:
        return ""
    value = getattr(attr, "value", None)
    if value is None:
        return ""
    return str(value)


def _entry_pwd_last_set_raw(entry: Any) -> int:
    try:
        attr = getattr(entry, "pwdLastSet")
    except Exception:
        attr = None
    if attr is None:
        return 0
    raw_values = getattr(attr, "raw_values", None)
    if raw_values:
        try:
            return int(raw_values[0])
        except (TypeError, ValueError):
            pass
    value = getattr(attr, "value", None)
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _entry_password_status(entry: Any, *, include_raw: bool = False) -> dict[str, Any] | None:
    display_name = _entry_value(entry, "displayName")
    login = _entry_value(entry, "sAMAccountName")
    if not display_name and not login:
        return None
    status = calculate_password_expiration_status(_entry_pwd_last_set_raw(entry))
    if not include_raw:
        status.pop("pwd_last_set", None)
    return {
        "login": login,
        "display_name": display_name,
        "account_type": _detect_account_type(login),
        "department": _entry_value(entry, "department"),
        "title": _entry_value(entry, "title"),
        "mail": _entry_value(entry, "mail"),
        **status,
    }


def _normalize_lookup_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").casefold().replace("ё", "е")).strip()


def _lookup_tokens(query: object) -> list[str]:
    normalized = _normalize_lookup_text(query)
    return [item for item in re.findall(r"[\w.@-]{2,}", normalized, flags=re.UNICODE) if item]


def _lookup_stems(tokens: list[str]) -> list[str]:
    stems: list[str] = []
    for token in tokens:
        stem = token[:6] if len(token) >= 8 else token[:5] if len(token) >= 6 else token
        if len(stem) >= 3 and stem not in stems:
            stems.append(stem)
    return stems


def _build_user_lookup_filter(query: str) -> str:
    escaped_query = escape_filter_chars(query.strip())
    compact_query = escape_filter_chars(re.sub(r"\s+", "", query.strip()))
    # Title-case variant for Cyrillic (AD may be case-sensitive for non-ASCII displayName).
    title_query = escape_filter_chars(query.strip().title())
    upper_query = escape_filter_chars(query.strip().upper())
    clauses = [
        # ANR (Ambiguous Name Resolution) — AD built-in case-insensitive multi-field search.
        f"(anr={escaped_query})",
        f"(sAMAccountName={escaped_query})",
        f"(sAMAccountName=*{escaped_query}*)",
        f"(displayName=*{escaped_query}*)",
        f"(mail=*{escaped_query}*)",
    ]
    # Add title-case and upper-case variants for Cyrillic case-sensitivity workaround.
    if title_query and title_query != escaped_query:
        clauses.append(f"(displayName=*{title_query}*)")
    if upper_query and upper_query != escaped_query and upper_query != title_query:
        clauses.append(f"(displayName=*{upper_query}*)")
    if compact_query and compact_query != escaped_query:
        clauses.append(f"(sAMAccountName=*{compact_query}*)")
    token_clauses = []
    for token in _lookup_tokens(query)[:4]:
        escaped_token = escape_filter_chars(token)
        escaped_token_title = escape_filter_chars(token.title())
        token_clauses.extend([
            f"(displayName=*{escaped_token}*)",
            f"(sAMAccountName=*{escaped_token}*)",
            f"(mail=*{escaped_token}*)",
        ])
        # Title-case token for Cyrillic.
        if escaped_token_title != escaped_token:
            token_clauses.append(f"(displayName=*{escaped_token_title}*)")
    stems = _lookup_stems(_lookup_tokens(query))
    if stems:
        # Build stem conjunction with both lowercase and title-case variants.
        stem_clauses_lower = "(&" + "".join(f"(displayName=*{escape_filter_chars(stem)}*)" for stem in stems[:4]) + ")"
        stem_clauses_title = "(&" + "".join(f"(displayName=*{escape_filter_chars(stem.title())}*)" for stem in stems[:4]) + ")"
        clauses.append(stem_clauses_lower)
        if stem_clauses_title != stem_clauses_lower:
            clauses.append(stem_clauses_title)
    clauses.extend(token_clauses)
    return (
        "(&"
        "(objectCategory=person)"
        "(objectClass=user)"
        "(!(userAccountControl:1.2.840.113556.1.4.803:=2))"
        "(|" + "".join(clauses) + ")"
        ")"
    )


def _build_mailbox_lookup_filter(query: str) -> str:
    """LDAP filter targeting only mailbox accounts (dot in sAMAccountName)."""
    escaped = escape_filter_chars(query.strip())
    return (
        "(&"
        "(objectCategory=person)"
        "(objectClass=user)"
        "(!(userAccountControl:1.2.840.113556.1.4.803:=2))"
        "(sAMAccountName=*.*)"
        "(|"
        f"(anr={escaped})"
        f"(sAMAccountName=*{escaped}*)"
        f"(displayName=*{escaped}*)"
        f"(mail=*{escaped}*)"
        ")"
        ")"
    )


def _candidate_score(query: str, candidate: dict[str, Any]) -> int:
    normalized_query = _normalize_lookup_text(query)
    login = _normalize_lookup_text(candidate.get("login"))
    display_name = _normalize_lookup_text(candidate.get("display_name"))
    mail = _normalize_lookup_text(candidate.get("mail"))
    compact_query = normalized_query.replace(" ", "")
    tokens = _lookup_tokens(query)
    stems = _lookup_stems(tokens)
    if normalized_query and normalized_query in {login, mail}:
        return 100
    if compact_query and compact_query == login.replace(" ", ""):
        return 98
    if normalized_query and normalized_query == display_name:
        return 95
    if tokens and all(token in display_name for token in tokens):
        return 88
    if stems and all(stem in display_name for stem in stems):
        return 82
    if tokens and any(token in login or token in mail for token in tokens):
        return 72
    if tokens and any(token in display_name for token in tokens):
        return 60
    return 0


def lookup_ad_user_password_status(query: str, *, limit: int = 5) -> dict[str, Any]:
    """Find one AD user by login/name and return a safe password status payload for AI chat."""
    normalized_query = str(query or "").strip()
    if not normalized_query:
        return {"status": "error", "error": "User query is required.", "query": normalized_query}

    conn = _open_ad_connection()
    if conn is None:
        return {"status": "error", "error": "LDAP connection is not configured or bind failed.", "query": normalized_query}

    attributes = ["sAMAccountName", "displayName", "department", "title", "mail", "pwdLastSet"]
    try:
        conn.search(
            search_base=_resolve_ad_search_base(),
            search_filter=_build_user_lookup_filter(normalized_query),
            attributes=attributes,
            search_scope=SUBTREE,
            size_limit=max(1, int(limit or 5)) * 4,
        )
        entries = list(getattr(conn, "entries", []) or [])
    except Exception as e:
        logger.error(f"AD user password lookup failed: {e}")
        return {"status": "error", "error": str(e), "query": normalized_query}
    finally:
        try:
            conn.unbind()
        except Exception:
            pass

    candidates: list[dict[str, Any]] = []
    for entry in entries:
        payload = _entry_password_status(entry, include_raw=False)
        if payload:
            payload["_score"] = _candidate_score(normalized_query, payload)
            candidates.append(payload)
    candidates = [item for item in candidates if int(item.get("_score") or 0) > 0]
    candidates.sort(key=lambda item: (-int(item.get("_score") or 0), _normalize_lookup_text(item.get("display_name")), _normalize_lookup_text(item.get("login"))))

    safe_candidates = [
        {key: value for key, value in item.items() if key != "_score"}
        for item in candidates[: max(1, int(limit or 5))]
    ]
    if not safe_candidates:
        return {"status": "not_found", "query": normalized_query, "policy_days": get_ad_password_max_age_days(), "candidates": []}
    top_score = int(candidates[0].get("_score") or 0)
    second_score = int(candidates[1].get("_score") or 0) if len(candidates) > 1 else 0
    # Consider it a confident match if:
    # - only one candidate, OR
    # - top score >= 95 (exact/near-exact match), OR
    # - top score >= 80 AND the gap to second candidate is >= 15 (clear winner among fuzzy matches)
    is_confident_match = (
        len(safe_candidates) == 1
        or top_score >= 95
        or (top_score >= 80 and (top_score - second_score) >= 15)
    )
    if is_confident_match:
        return {
            "status": "matched",
            "query": normalized_query,
            "policy_days": get_ad_password_max_age_days(),
            "user": safe_candidates[0],
        }
    return {
        "status": "ambiguous",
        "query": normalized_query,
        "policy_days": get_ad_password_max_age_days(),
        "candidates": safe_candidates,
    }


def list_ad_users_expiring_soon(*, days_threshold: int = 3, limit: int = 50) -> dict[str, Any]:
    """
    Find all AD users whose password expires within the given number of days.
    Returns a list of users sorted by days_to_expire ascending (most urgent first).
    Excludes service accounts, health mailboxes, and disabled users.
    """
    threshold = max(1, int(days_threshold or 3))
    safe_limit = max(1, min(int(limit or 50), 200))
    report = get_ad_password_expiry_report(mode="expiring", days_threshold=threshold)
    if report.get("status") != "ok":
        return {
            "status": "error",
            "error": report.get("error") or "AD password expiry lookup failed.",
        }
    users = list(report.get("users") or [])[:safe_limit]
    return {
        "status": "ok",
        "policy_days": report.get("policy_days"),
        "threshold_days": threshold,
        "total_found": int(report.get("total") or 0),
        "users": users,
    }


def lookup_ad_mailbox_password_status(query: str, *, limit: int = 5) -> dict[str, Any]:
    """Find AD mailbox accounts (dot-separated sAMAccountName) and return password status."""
    normalized_query = str(query or "").strip()
    if not normalized_query:
        return {"status": "error", "error": "Query is required.", "query": normalized_query}

    conn = _open_ad_connection()
    if conn is None:
        return {"status": "error", "error": "LDAP connection is not configured or bind failed.", "query": normalized_query}

    attributes = ["sAMAccountName", "displayName", "department", "title", "mail", "pwdLastSet"]
    try:
        conn.search(
            search_base=_resolve_ad_search_base(),
            search_filter=_build_mailbox_lookup_filter(normalized_query),
            attributes=attributes,
            search_scope=SUBTREE,
            size_limit=max(1, int(limit or 5)) * 4,
        )
        entries = list(getattr(conn, "entries", []) or [])
    except Exception as e:
        logger.error(f"AD mailbox password lookup failed: {e}")
        return {"status": "error", "error": str(e), "query": normalized_query}
    finally:
        try:
            conn.unbind()
        except Exception:
            pass

    candidates: list[dict[str, Any]] = []
    for entry in entries:
        payload = _entry_password_status(entry, include_raw=False)
        if payload:
            payload["_score"] = _candidate_score(normalized_query, payload)
            candidates.append(payload)
    candidates = [item for item in candidates if int(item.get("_score") or 0) > 0]
    candidates.sort(key=lambda item: (-int(item.get("_score") or 0), _normalize_lookup_text(item.get("display_name")), _normalize_lookup_text(item.get("login"))))

    safe_candidates = [
        {key: value for key, value in item.items() if key != "_score"}
        for item in candidates[: max(1, int(limit or 5))]
    ]
    if not safe_candidates:
        return {"status": "not_found", "query": normalized_query, "policy_days": get_ad_password_max_age_days(), "candidates": []}
    top_score = int(candidates[0].get("_score") or 0)
    second_score = int(candidates[1].get("_score") or 0) if len(candidates) > 1 else 0
    is_confident_match = (
        len(safe_candidates) == 1
        or top_score >= 95
        or (top_score >= 80 and (top_score - second_score) >= 15)
    )
    if is_confident_match:
        return {
            "status": "matched",
            "query": normalized_query,
            "policy_days": get_ad_password_max_age_days(),
            "mailbox": safe_candidates[0],
        }
    return {
        "status": "ambiguous",
        "query": normalized_query,
        "policy_days": get_ad_password_max_age_days(),
        "candidates": safe_candidates,
    }


def list_ad_mailboxes_expiring_soon(*, days_threshold: int = 3, limit: int = 50) -> dict[str, Any]:
    """Find AD mailbox accounts (dot-separated sAMAccountName) with expiring passwords.

    Filters to include only accounts whose sAMAccountName contains a dot separator.
    Excludes service accounts, health mailboxes, and disabled accounts.
    """
    threshold = max(1, min(int(days_threshold or 3), 30))
    safe_limit = max(1, min(int(limit or 50), 200))

    conn = _open_ad_connection()
    if conn is None:
        return {"status": "error", "error": "LDAP connection is not configured or bind failed."}

    attributes = ["sAMAccountName", "displayName", "department", "title", "mail", "pwdLastSet"]
    # Search enabled mailbox accounts (dot in sAMAccountName) with a real pwdLastSet
    search_filter = (
        "(&"
        "(objectCategory=person)"
        "(objectClass=user)"
        "(!(userAccountControl:1.2.840.113556.1.4.803:=2))"
        "(pwdLastSet>=1)"
        "(sAMAccountName=*.*)"
        ")"
    )
    try:
        conn.search(
            search_base=_resolve_ad_search_base(),
            search_filter=search_filter,
            attributes=attributes,
            search_scope=SUBTREE,
            size_limit=0,
        )
        entries = list(getattr(conn, "entries", []) or [])
    except Exception as e:
        logger.error(f"AD mailbox expiring passwords lookup failed: {e}")
        return {"status": "error", "error": str(e)}
    finally:
        try:
            conn.unbind()
        except Exception:
            pass

    policy_days = get_ad_password_max_age_days()
    expiring_mailboxes: list[dict[str, Any]] = []

    _service_patterns = re.compile(
        r"^(healthmailbox|svc[_\-]|admin|1c|1bit|bcpexec|corp[\.\-]admin|aid$|"
        r"scan[_\-]|backup|test[_\-]|service|system|sql|exchange|smtp|ftp|www|http|"
        r"ldap[_\-]|bdd[\.\-]|personal$|usa$|lnk\.|lrk\.)",
        re.IGNORECASE,
    )

    for entry in entries:
        payload = _entry_password_status(entry, include_raw=False)
        if not payload:
            continue
        login = str(payload.get("login") or "").strip()
        display_name = str(payload.get("display_name") or "").strip()
        # Must have a dot in login (mailbox convention)
        if "." not in login:
            continue
        # Skip service accounts
        if _service_patterns.match(login):
            continue
        # Skip entries without a proper display name (at least 2 words)
        if len(display_name.split()) < 2:
            continue
        # Skip display names starting with special chars
        if display_name and not display_name[0].isalpha():
            continue
        name_parts = display_name.split()
        if len(name_parts) < 2 or len(name_parts) > 5:
            continue
        first_word = name_parts[0]
        if len(first_word) < 3 or not first_word[0].isupper():
            continue
        days_to_expire = int(payload.get("days_to_expire") or 0)
        expired = bool(payload.get("expired"))
        must_change = bool(payload.get("must_change_now"))
        if days_to_expire <= threshold or expired or must_change:
            expiring_mailboxes.append(payload)

    expiring_mailboxes.sort(key=lambda u: (
        0 if u.get("must_change_now") else 1,
        int(u.get("days_to_expire") or 0),
        str(u.get("display_name") or ""),
    ))

    return {
        "status": "ok",
        "policy_days": policy_days,
        "threshold_days": threshold,
        "total_found": len(expiring_mailboxes),
        "mailboxes": expiring_mailboxes[:safe_limit],
    }


def get_ad_user_lockout_status(query: str) -> dict[str, Any]:
    """Check AD account lockout status: lockoutTime, badPwdCount."""
    normalized_query = str(query or "").strip()
    if not normalized_query:
        return {"status": "error", "error": "User query is required.", "query": normalized_query}

    conn = _open_ad_connection()
    if conn is None:
        return {"status": "error", "error": "LDAP connection is not configured or bind failed.", "query": normalized_query}

    attributes = [
        "sAMAccountName", "displayName", "lockoutTime", "badPwdCount",
        "userAccountControl",
    ]
    try:
        conn.search(
            search_base=_resolve_ad_search_base(),
            search_filter=_build_user_lookup_filter(normalized_query),
            attributes=attributes,
            search_scope=SUBTREE,
            size_limit=20,
        )
        entries = list(getattr(conn, "entries", []) or [])
    except Exception as e:
        logger.error(f"AD lockout status lookup failed: {e}")
        return {"status": "error", "error": str(e), "query": normalized_query}
    finally:
        try:
            conn.unbind()
        except Exception:
            pass

    if not entries:
        return {"status": "not_found", "query": normalized_query}

    # Score and pick best match
    best_entry = None
    best_score = 0
    for entry in entries:
        login = _entry_value(entry, "sAMAccountName")
        display_name = _entry_value(entry, "displayName")
        candidate = {"login": login, "display_name": display_name, "mail": ""}
        score = _candidate_score(normalized_query, candidate)
        if score > best_score:
            best_score = score
            best_entry = entry

    if best_entry is None or best_score == 0:
        return {"status": "not_found", "query": normalized_query}

    login = _entry_value(best_entry, "sAMAccountName")
    display_name = _entry_value(best_entry, "displayName")

    # Parse lockoutTime
    lockout_time_raw = 0
    try:
        attr = getattr(best_entry, "lockoutTime", None)
        if attr is not None:
            raw_values = getattr(attr, "raw_values", None)
            if raw_values:
                lockout_time_raw = int(raw_values[0])
            else:
                lockout_time_raw = int(getattr(attr, "value", 0) or 0)
    except (TypeError, ValueError):
        lockout_time_raw = 0

    lockout_time_dt = filetime_to_datetime(lockout_time_raw)
    is_locked = lockout_time_dt is not None and lockout_time_raw > 0

    # Calculate lockout duration
    lockout_duration_minutes: int | None = None
    if is_locked and lockout_time_dt:
        now = datetime.now(timezone.utc)
        duration = now - lockout_time_dt
        lockout_duration_minutes = max(0, int(duration.total_seconds() // 60))

    # Parse badPwdCount
    bad_pwd_count = 0
    try:
        attr = getattr(best_entry, "badPwdCount", None)
        if attr is not None:
            bad_pwd_count = int(getattr(attr, "value", 0) or 0)
    except (TypeError, ValueError):
        bad_pwd_count = 0

    return {
        "status": "ok",
        "query": normalized_query,
        "login": login,
        "display_name": display_name,
        "account_type": _detect_account_type(login),
        "is_locked": is_locked,
        "lockout_time": lockout_time_dt.isoformat() if lockout_time_dt else None,
        "lockout_duration_minutes": lockout_duration_minutes,
        "bad_password_count": bad_pwd_count,
    }


def _parse_cn_from_dn(dn: str) -> str:
    """Extract the CN (Common Name) value from a Distinguished Name string."""
    if not dn:
        return ""
    # DN format: CN=GroupName,OU=...,DC=...
    match = re.match(r"^CN=([^,]+)", dn, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return ""


def get_ad_user_groups(query: str, *, include_builtin: bool = False) -> dict[str, Any]:
    """Get AD group membership for a user. Reads the memberOf attribute."""
    normalized_query = str(query or "").strip()
    if not normalized_query:
        return {"status": "error", "error": "User query is required.", "query": normalized_query}

    conn = _open_ad_connection()
    if conn is None:
        return {"status": "error", "error": "LDAP connection is not configured or bind failed.", "query": normalized_query}

    attributes = ["sAMAccountName", "displayName", "memberOf"]
    try:
        conn.search(
            search_base=_resolve_ad_search_base(),
            search_filter=_build_user_lookup_filter(normalized_query),
            attributes=attributes,
            search_scope=SUBTREE,
            size_limit=20,
        )
        entries = list(getattr(conn, "entries", []) or [])
    except Exception as e:
        logger.error(f"AD user groups lookup failed: {e}")
        return {"status": "error", "error": str(e), "query": normalized_query}
    finally:
        try:
            conn.unbind()
        except Exception:
            pass

    if not entries:
        return {"status": "not_found", "query": normalized_query}

    # Score and pick best match
    best_entry = None
    best_score = 0
    for entry in entries:
        login = _entry_value(entry, "sAMAccountName")
        display_name = _entry_value(entry, "displayName")
        candidate = {"login": login, "display_name": display_name, "mail": ""}
        score = _candidate_score(normalized_query, candidate)
        if score > best_score:
            best_score = score
            best_entry = entry

    if best_entry is None or best_score == 0:
        return {"status": "not_found", "query": normalized_query}

    login = _entry_value(best_entry, "sAMAccountName")
    display_name = _entry_value(best_entry, "displayName")

    # Parse memberOf attribute (list of DN strings)
    member_of_dns: list[str] = []
    try:
        attr = getattr(best_entry, "memberOf", None)
        if attr is not None:
            values = getattr(attr, "values", None) or getattr(attr, "value", None)
            if values is not None:
                if isinstance(values, (list, tuple)):
                    member_of_dns = [str(v) for v in values]
                elif isinstance(values, str):
                    member_of_dns = [values]
    except Exception:
        member_of_dns = []

    # Parse CN from each DN
    all_groups = [_parse_cn_from_dn(dn) for dn in member_of_dns]
    all_groups = [g for g in all_groups if g]  # filter empty

    # Filter built-in groups unless explicitly requested
    if include_builtin:
        groups = sorted(all_groups)
    else:
        groups = sorted(g for g in all_groups if g not in _BUILTIN_GROUPS)

    return {
        "status": "ok",
        "query": normalized_query,
        "login": login,
        "display_name": display_name,
        "account_type": _detect_account_type(login),
        "groups": groups,
        "group_count": len(groups),
    }


def get_ad_user_logon_history(query: str) -> dict[str, Any]:
    """Get AD user logon history: lastLogon, lastLogonTimestamp, logonCount."""
    normalized_query = str(query or "").strip()
    if not normalized_query:
        return {"status": "error", "error": "User query is required.", "query": normalized_query}

    conn = _open_ad_connection()
    if conn is None:
        return {"status": "error", "error": "LDAP connection is not configured or bind failed.", "query": normalized_query}

    attributes = [
        "sAMAccountName", "displayName", "lastLogon", "lastLogonTimestamp",
        "logonCount", "pwdLastSet",
    ]
    try:
        conn.search(
            search_base=_resolve_ad_search_base(),
            search_filter=_build_user_lookup_filter(normalized_query),
            attributes=attributes,
            search_scope=SUBTREE,
            size_limit=20,
        )
        entries = list(getattr(conn, "entries", []) or [])
    except Exception as e:
        logger.error(f"AD logon history lookup failed: {e}")
        return {"status": "error", "error": str(e), "query": normalized_query}
    finally:
        try:
            conn.unbind()
        except Exception:
            pass

    if not entries:
        return {"status": "not_found", "query": normalized_query}

    # Score and pick best match
    best_entry = None
    best_score = 0
    for entry in entries:
        login = _entry_value(entry, "sAMAccountName")
        display_name = _entry_value(entry, "displayName")
        candidate = {"login": login, "display_name": display_name, "mail": ""}
        score = _candidate_score(normalized_query, candidate)
        if score > best_score:
            best_score = score
            best_entry = entry

    if best_entry is None or best_score == 0:
        return {"status": "not_found", "query": normalized_query}

    login = _entry_value(best_entry, "sAMAccountName")
    display_name = _entry_value(best_entry, "displayName")

    # Helper to read a FILETIME attribute
    def _read_filetime_attr(entry_obj: Any, attr_name: str) -> int:
        try:
            attr = getattr(entry_obj, attr_name, None)
            if attr is None:
                return 0
            raw_values = getattr(attr, "raw_values", None)
            if raw_values:
                return int(raw_values[0])
            return int(getattr(attr, "value", 0) or 0)
        except (TypeError, ValueError):
            return 0

    last_logon_raw = _read_filetime_attr(best_entry, "lastLogon")
    last_logon_timestamp_raw = _read_filetime_attr(best_entry, "lastLogonTimestamp")
    pwd_last_set_raw = _read_filetime_attr(best_entry, "pwdLastSet")

    last_logon_dt = filetime_to_datetime(last_logon_raw)
    last_logon_timestamp_dt = filetime_to_datetime(last_logon_timestamp_raw)
    pwd_last_set_dt = filetime_to_datetime(pwd_last_set_raw)

    # Return the most recent of lastLogon and lastLogonTimestamp
    last_logon_effective: datetime | None = None
    if last_logon_dt and last_logon_timestamp_dt:
        last_logon_effective = max(last_logon_dt, last_logon_timestamp_dt)
    elif last_logon_dt:
        last_logon_effective = last_logon_dt
    elif last_logon_timestamp_dt:
        last_logon_effective = last_logon_timestamp_dt

    # Parse logonCount
    logon_count = 0
    try:
        attr = getattr(best_entry, "logonCount", None)
        if attr is not None:
            logon_count = int(getattr(attr, "value", 0) or 0)
    except (TypeError, ValueError):
        logon_count = 0

    # Build note if user never logged in
    note: str | None = None
    if last_logon_effective is None:
        note = "Пользователь ни разу не входил в систему"

    return {
        "status": "ok",
        "query": normalized_query,
        "login": login,
        "display_name": display_name,
        "account_type": _detect_account_type(login),
        "last_logon": last_logon_effective.isoformat() if last_logon_effective else None,
        "last_logon_timestamp": last_logon_timestamp_dt.isoformat() if last_logon_timestamp_dt else None,
        "logon_count": logon_count,
        "last_password_change": pwd_last_set_dt.isoformat() if pwd_last_set_dt else None,
        "note": note,
    }


def _load_custom_branch_mappings() -> dict[str, int]:
    if is_app_database_configured():
        initialize_app_schema()
        with app_session() as session:
            rows = session.scalars(select(AppAdUserBranchOverride).order_by(AppAdUserBranchOverride.login.asc())).all()
            return {
                str(row.login or "").strip().lower(): int(row.branch_no)
                for row in rows
                if str(row.login or "").strip()
            }
    store = get_local_store()
    data = store.load_json('ad_user_branches.json', default_content={})
    if not isinstance(data, dict):
        return {}
    out: dict[str, int] = {}
    for key, value in data.items():
        normalized_login = str(key or "").strip().lower()
        if not normalized_login:
            continue
        try:
            out[normalized_login] = int(value)
        except (TypeError, ValueError):
            continue
    return out

def decode_cp1251(val):
    if not val: return None
    try:
        if isinstance(val, str):
            return val.encode('latin1').decode('cp1251')
    except:
        pass
    return str(val)

def get_ad_users_password_status() -> List[Dict]:
    """Fetch active users from AD and calculate password expiration days."""
    report = get_ad_password_expiry_report(mode="all")
    if report.get("status") != "ok":
        return []
    return list(report.get("users") or [])

def set_ad_user_branch(login: str, branch_no: int | None) -> bool:
    """Manually set or update a user's branch in the local store."""
    login_lower = str(login).lower().strip()
    if not login_lower:
        return False
        
    try:
        if is_app_database_configured():
            initialize_app_schema()
            with app_session() as session:
                row = session.get(AppAdUserBranchOverride, login_lower)
                if branch_no is None or branch_no == 0:
                    if row is not None:
                        session.delete(row)
                else:
                    if row is None:
                        row = AppAdUserBranchOverride(login=login_lower)
                        session.add(row)
                    row.branch_no = int(branch_no)
                    row.updated_at = datetime.now(timezone.utc)
        else:
            store = get_local_store()
            custom_branches = store.load_json('ad_user_branches.json', default_content={})

            if branch_no is None or branch_no == 0:
                if login_lower in custom_branches:
                    del custom_branches[login_lower]
            else:
                custom_branches[login_lower] = branch_no

            store.save_json('ad_user_branches.json', custom_branches)

        return True
    except Exception as e:
        logger.error(f"Failed to save local branch mapping for AD user {login}: {e}")
        return False


def import_ad_user_to_app_user(login: str) -> dict:
    """Create or update an LDAP web user from AD attributes."""
    from backend.services.ad_app_user_import_service import ad_app_user_import_service

    return ad_app_user_import_service.import_user(login)
