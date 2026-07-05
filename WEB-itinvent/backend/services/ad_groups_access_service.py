"""AD security groups access matrix for Groups OU branches (SPb, Tyumen)."""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ldap3 import SUBTREE

from backend.services.ad_users_service import (
    _AD_LDAP_PAGE_SIZE,
    _AD_PAGED_RESULTS_OID,
    _open_ad_connection,
    _ou_path_from_dn,
    _parse_cn_from_dn,
    _resolve_ad_search_base,
)

logger = logging.getLogger(__name__)

_SNAPSHOT_FILE = "ad_groups_access_snapshot.json"
_SYNC_STATE_FILE = "ad_groups_access_sync_state.json"
_SECURITY_GROUP_FLAG = 0x80000000
_AD_MATCHING_RULE_IN_CHAIN = "1.2.840.113556.1.4.1941"
_USER_ENABLED_FILTER = (
    "(&(objectCategory=person)(objectClass=user)"
    "(!(userAccountControl:1.2.840.113556.1.4.803:=2)))"
)
_DEFAULT_BRANCHES = ("SPb", "Tyumen")
_DEFAULT_ACCESS_LEVEL_RULES = {
    r"^RO[_-]": "read",
    r"^RW[_-]": "write",
    r"[_-]R$": "read",
    r"[_-]RW$": "write",
    r"[_-]W$": "write",
    r"[_-]F$": "full",
    r"^Read[_-]": "read",
    r"^Write[_-]": "write",
}

_sync_lock = threading.Lock()
_snapshot_cache: dict[str, Any] = {"mtime": None, "payload": None}

_GROUP_LIST_FIELDS = ("dn", "cn", "branch", "folder_label", "folder_path", "access_level", "member_count", "description")


def _project_data_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "data"


def _snapshot_path() -> Path:
    return _project_data_dir() / _SNAPSHOT_FILE


def _sync_state_path() -> Path:
    return _project_data_dir() / _SYNC_STATE_FILE


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _env_flag(name: str, default: str = "1") -> bool:
    return str(os.getenv(name, default)).strip().lower() in {"1", "true", "yes", "on"}


def _configured_branches() -> list[str]:
    raw = str(os.getenv("AD_GROUPS_ACCESS_BRANCHES", ",".join(_DEFAULT_BRANCHES)) or "").strip()
    branches = [part.strip() for part in raw.split(",") if part.strip()]
    return branches or list(_DEFAULT_BRANCHES)


def _access_level_rules() -> list[tuple[re.Pattern[str], str]]:
    raw = str(os.getenv("AD_GROUPS_ACCESS_LEVEL_RULES", "") or "").strip()
    mapping = dict(_DEFAULT_ACCESS_LEVEL_RULES)
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                mapping.update({str(key): str(value) for key, value in parsed.items()})
        except json.JSONDecodeError:
            logger.warning("Invalid AD_GROUPS_ACCESS_LEVEL_RULES JSON, using defaults")
    rules: list[tuple[re.Pattern[str], str]] = []
    for pattern, level in mapping.items():
        try:
            rules.append((re.compile(str(pattern), re.IGNORECASE), str(level)))
        except re.error:
            logger.warning("Invalid access-level regex ignored: %s", pattern)
    return rules


def parse_access_level(cn: str) -> str:
    name = str(cn or "").strip()
    if not name:
        return "member"
    for pattern, level in _access_level_rules():
        if pattern.search(name):
            return level
    return "member"


def parse_folder_label(cn: str) -> str:
    name = str(cn or "").strip()
    if not name:
        return ""
    for pattern, _level in _access_level_rules():
        match = pattern.search(name)
        if match:
            remainder = name[match.end() :].lstrip("_- ")
            if remainder:
                return remainder
            prefix = name[: match.start()].rstrip("_- ")
            if prefix:
                return prefix
    return name


def _is_security_group(group_type: Any) -> bool:
    try:
        value = int(group_type)
    except (TypeError, ValueError):
        return True
    return bool(value & _SECURITY_GROUP_FLAG)


def _entry_value(entry: Any, attr: str) -> Any:
    try:
        attribute = getattr(entry, attr, None)
        if attribute is None:
            return ""
        value = getattr(attribute, "value", None)
        if value is None:
            values = getattr(attribute, "values", None)
            return list(values) if values is not None else ""
        return value
    except Exception:
        return ""


def _entry_members(entry: Any) -> list[str]:
    raw = _entry_value(entry, "member")
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    if isinstance(raw, str) and raw.strip():
        return [raw.strip()]
    return []


def _is_computer_dn(dn: str) -> bool:
    cn = _parse_cn_from_dn(dn)
    return cn.endswith("$")


def _paged_search(conn, *, search_base: str, search_filter: str, attributes: list[str]) -> list[Any]:
    entries: list[Any] = []
    cookie: bytes | None = None
    while True:
        conn.search(
            search_base=search_base,
            search_filter=search_filter,
            attributes=attributes,
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


def _discover_groups_base_dn(conn) -> str | None:
    configured = str(os.getenv("AD_GROUPS_ACCESS_BASE_DN", "") or "").strip()
    if configured:
        return configured
    base_dn = _resolve_ad_search_base()
    conn.search(
        search_base=base_dn,
        search_filter="(|(ou=Groups)(name=Groups))",
        attributes=["distinguishedName", "ou", "name"],
        search_scope=SUBTREE,
        size_limit=20,
    )
    candidates: list[str] = []
    for entry in conn.entries:
        dn = str(_entry_value(entry, "distinguishedName") or "").strip()
        if not dn:
            continue
        if ",OU=MailObjects," in dn.upper():
            continue
        candidates.append(dn)
    if not candidates:
        return None
    candidates.sort(key=lambda value: value.upper().count("OU="))
    return candidates[0]


def _resolve_branch_dn(conn, groups_base_dn: str, branch: str) -> str | None:
    conn.search(
        search_base=groups_base_dn,
        search_filter=f"(&(objectClass=organizationalUnit)(|(ou={branch})(name={branch})))",
        attributes=["distinguishedName"],
        search_scope=SUBTREE,
        size_limit=5,
    )
    for entry in conn.entries:
        dn = str(_entry_value(entry, "distinguishedName") or "").strip()
        if dn:
            return dn
    return None


def _folder_path_for_group(dn: str, *, branch: str) -> str:
    path = _ou_path_from_dn(dn)
    if not path:
        return parse_folder_label(_parse_cn_from_dn(dn))
    parts = [part.strip() for part in path.split("/") if part.strip()]
    filtered: list[str] = []
    for part in parts:
        if part.casefold() == "groups":
            continue
        if part.casefold() == branch.casefold():
            continue
        filtered.append(part)
    label = parse_folder_label(_parse_cn_from_dn(dn))
    if label and (not filtered or filtered[-1] != label):
        filtered.append(label)
    return " / ".join(filtered) if filtered else label


def _expand_nested_members(
    group_dn: str,
    *,
    direct_members: dict[str, list[str]],
    group_dns: set[str],
    cache: dict[str, set[str]],
    visiting: set[str] | None = None,
) -> set[str]:
    if group_dn in cache:
        return set(cache[group_dn])
    active_visiting = set(visiting or set())
    if group_dn in active_visiting:
        return set()
    active_visiting.add(group_dn)
    resolved: set[str] = set()
    for member_dn in direct_members.get(group_dn, []):
        if member_dn in group_dns:
            resolved.update(
                _expand_nested_members(
                    member_dn,
                    direct_members=direct_members,
                    group_dns=group_dns,
                    cache=cache,
                    visiting=active_visiting,
                )
            )
        elif not _is_computer_dn(member_dn):
            resolved.add(member_dn)
    cache[group_dn] = set(resolved)
    active_visiting.discard(group_dn)
    return set(resolved)


def _resolve_users_by_dn(conn, user_dns: set[str]) -> dict[str, dict[str, str]]:
    if not user_dns:
        return {}
    dns_list = sorted(user_dns)
    resolved: dict[str, dict[str, str]] = {}
    chunk_size = 40
    for offset in range(0, len(dns_list), chunk_size):
        chunk = dns_list[offset : offset + chunk_size]
        filter_parts = "".join(f"(distinguishedName={dn})" for dn in chunk)
        conn.search(
            search_base=_resolve_ad_search_base(),
            search_filter=f"(&{_USER_ENABLED_FILTER}(|{filter_parts}))",
            attributes=["distinguishedName", "sAMAccountName", "displayName"],
            search_scope=SUBTREE,
            size_limit=0,
        )
        for entry in conn.entries:
            dn = str(_entry_value(entry, "distinguishedName") or "").strip()
            login = str(_entry_value(entry, "sAMAccountName") or "").strip()
            if not dn or not login:
                continue
            resolved[dn] = {
                "login": login,
                "display_name": str(_entry_value(entry, "displayName") or "").strip() or login,
            }
    return resolved


def _fetch_transitive_users_for_group(conn, group_dn: str) -> list[str]:
    conn.search(
        search_base=_resolve_ad_search_base(),
        search_filter=f"(&{_USER_ENABLED_FILTER}(memberOf:{_AD_MATCHING_RULE_IN_CHAIN}:={group_dn}))",
        attributes=["distinguishedName"],
        search_scope=SUBTREE,
        size_limit=0,
    )
    return [
        str(_entry_value(entry, "distinguishedName") or "").strip()
        for entry in conn.entries
        if str(_entry_value(entry, "distinguishedName") or "").strip()
    ]


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)


def _save_sync_state(*, status: str, error: str | None = None, summary: dict[str, Any] | None = None) -> None:
    payload = {
        "status": status,
        "last_sync_at": _utc_now_iso(),
        "error": error,
        "summary": summary or {},
    }
    _atomic_write_json(_sync_state_path(), payload)


def load_sync_state() -> dict[str, Any]:
    path = _sync_state_path()
    if not path.is_file():
        return {"status": "never", "last_sync_at": None, "error": None, "summary": {}}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"status": "error", "last_sync_at": None, "error": str(exc), "summary": {}}
    if not isinstance(payload, dict):
        return {"status": "never", "last_sync_at": None, "error": None, "summary": {}}
    return {
        "status": str(payload.get("status") or "never"),
        "last_sync_at": payload.get("last_sync_at"),
        "error": payload.get("error"),
        "summary": payload.get("summary") if isinstance(payload.get("summary"), dict) else {},
    }


def _invalidate_snapshot_cache() -> None:
    _snapshot_cache["mtime"] = None
    _snapshot_cache["payload"] = None


def load_snapshot() -> dict[str, Any]:
    path = _snapshot_path()
    if not path.is_file():
        _invalidate_snapshot_cache()
        return {}
    try:
        mtime = path.stat().st_mtime
    except OSError as exc:
        logger.warning("Failed to stat groups access snapshot: %s", exc)
        return {}
    if _snapshot_cache["mtime"] == mtime and isinstance(_snapshot_cache["payload"], dict):
        return _snapshot_cache["payload"]
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Failed to read groups access snapshot: %s", exc)
        _invalidate_snapshot_cache()
        return {}
    normalized = payload if isinstance(payload, dict) else {}
    _snapshot_cache["mtime"] = mtime
    _snapshot_cache["payload"] = normalized
    return normalized


def build_snapshot(*, use_transitive_ldap: bool = False) -> dict[str, Any]:
    conn = _open_ad_connection()
    if conn is None:
        raise RuntimeError("LDAP connection is not configured or bind failed")

    try:
        groups_base_dn = _discover_groups_base_dn(conn)
        if not groups_base_dn:
            raise RuntimeError("Groups OU was not found in Active Directory")

        branches = _configured_branches()
        groups: list[dict[str, Any]] = []
        group_members: dict[str, list[dict[str, Any]]] = {}
        users_index: dict[str, dict[str, Any]] = {}
        all_user_dns: set[str] = set()

        for branch in branches:
            branch_dn = _resolve_branch_dn(conn, groups_base_dn, branch)
            if not branch_dn:
                logger.warning("Branch OU not found for %s", branch)
                continue

            entries = _paged_search(
                conn,
                search_base=branch_dn,
                search_filter="(&(objectCategory=group)(objectClass=group))",
                attributes=["cn", "distinguishedName", "description", "member", "groupType"],
            )
            direct_members: dict[str, list[str]] = {}
            branch_group_dns: set[str] = set()
            raw_groups: list[dict[str, Any]] = []

            for entry in entries:
                dn = str(_entry_value(entry, "distinguishedName") or "").strip()
                cn = str(_entry_value(entry, "cn") or "").strip()
                if not dn or not cn:
                    continue
                if not _is_security_group(_entry_value(entry, "groupType")):
                    continue
                branch_group_dns.add(dn)
                direct_members[dn] = _entry_members(entry)
                raw_groups.append(
                    {
                        "dn": dn,
                        "cn": cn,
                        "branch": branch,
                        "folder_label": parse_folder_label(cn),
                        "folder_path": _folder_path_for_group(dn, branch=branch),
                        "access_level": parse_access_level(cn),
                        "description": str(_entry_value(entry, "description") or "").strip(),
                    }
                )

            expansion_cache: dict[str, set[str]] = {}
            for item in raw_groups:
                group_dn = item["dn"]
                if use_transitive_ldap:
                    member_dns = set(_fetch_transitive_users_for_group(conn, group_dn))
                else:
                    member_dns = _expand_nested_members(
                        group_dn,
                        direct_members=direct_members,
                        group_dns=branch_group_dns,
                        cache=expansion_cache,
                    )
                all_user_dns.update(member_dns)
                item["member_dns"] = sorted(member_dns)
                groups.append(item)

        user_profiles = _resolve_users_by_dn(conn, all_user_dns)

        for item in groups:
            members: list[dict[str, Any]] = []
            for member_dn in item.pop("member_dns", []):
                profile = user_profiles.get(member_dn)
                if not profile:
                    continue
                login = profile["login"]
                member_payload = {
                    "login": login,
                    "display_name": profile["display_name"],
                    "via": "direct",
                }
                members.append(member_payload)
                user_entry = users_index.setdefault(
                    login,
                    {
                        "login": login,
                        "display_name": profile["display_name"],
                        "branch": item["branch"],
                        "access": [],
                    },
                )
                if not user_entry.get("display_name"):
                    user_entry["display_name"] = profile["display_name"]
                user_entry["access"].append(
                    {
                        "group_dn": item["dn"],
                        "folder_label": item["folder_label"],
                        "folder_path": item["folder_path"],
                        "branch": item["branch"],
                        "access_level": item["access_level"],
                        "via": "direct",
                    }
                )
            members.sort(key=lambda row: str(row.get("login") or "").casefold())
            item["member_count"] = len(members)
            group_members[item["dn"]] = members

        users = sorted(users_index.values(), key=lambda row: str(row.get("login") or "").casefold())
        for user in users:
            user["access"].sort(
                key=lambda row: (
                    str(row.get("branch") or "").casefold(),
                    str(row.get("folder_path") or "").casefold(),
                    str(row.get("access_level") or "").casefold(),
                )
            )

        groups.sort(
            key=lambda row: (
                str(row.get("branch") or "").casefold(),
                str(row.get("folder_path") or "").casefold(),
                str(row.get("access_level") or "").casefold(),
            )
        )

        return {
            "synced_at": _utc_now_iso(),
            "base_dn": groups_base_dn,
            "branches": branches,
            "groups": groups,
            "group_members": group_members,
            "users": users,
            "matrix_summary": {
                "group_count": len(groups),
                "user_count": len(users),
            },
        }
    finally:
        try:
            conn.unbind()
        except Exception:
            pass


def sync_snapshot(*, force: bool = False) -> dict[str, Any]:
    del force
    if not _env_flag("AD_GROUPS_ACCESS_ENABLED", "1"):
        return {"status": "disabled", "message": "AD groups access sync is disabled"}

    if not _sync_lock.acquire(blocking=False):
        return {"status": "already_running", "message": "Sync is already running"}

    try:
        snapshot = build_snapshot()
        _atomic_write_json(_snapshot_path(), snapshot)
        _invalidate_snapshot_cache()
        summary = dict(snapshot.get("matrix_summary") or {})
        _save_sync_state(status="ok", summary=summary)
        return {"status": "ok", "summary": summary, "synced_at": snapshot.get("synced_at")}
    except Exception as exc:
        logger.exception("AD groups access sync failed")
        _save_sync_state(status="error", error=str(exc))
        return {"status": "error", "message": str(exc)}
    finally:
        _sync_lock.release()


def get_status() -> dict[str, Any]:
    state = load_sync_state()
    snapshot = load_snapshot()
    summary = snapshot.get("matrix_summary") if isinstance(snapshot.get("matrix_summary"), dict) else {}
    return {
        "status": state.get("status"),
        "last_sync_at": state.get("last_sync_at") or snapshot.get("synced_at"),
        "error": state.get("error"),
        "summary": summary or state.get("summary") or {},
        "branches": snapshot.get("branches") or _configured_branches(),
        "base_dn": snapshot.get("base_dn"),
    }


def _normalize_query(value: str) -> str:
    return str(value or "").strip().casefold()


def search_user_access(*, query: str, branch: str | None = None, limit: int = 100) -> dict[str, Any]:
    snapshot = load_snapshot()
    normalized_query = _normalize_query(query)
    if not normalized_query:
        return {"items": [], "total": 0, "synced_at": snapshot.get("synced_at")}

    branch_filter = str(branch or "").strip()
    items: list[dict[str, Any]] = []
    for user in snapshot.get("users") or []:
        if not isinstance(user, dict):
            continue
        login = _normalize_query(user.get("login"))
        display_name = _normalize_query(user.get("display_name"))
        if normalized_query not in login and normalized_query not in display_name:
            if not any(token in login or token in display_name for token in normalized_query.split() if token):
                continue
        access_rows = [
            row for row in (user.get("access") or [])
            if isinstance(row, dict) and (not branch_filter or str(row.get("branch") or "") == branch_filter)
        ]
        if not access_rows:
            continue
        items.append(
            {
                "login": user.get("login"),
                "display_name": user.get("display_name"),
                "access": access_rows,
                "access_count": len(access_rows),
            }
        )

    items.sort(key=lambda row: str(row.get("login") or "").casefold())
    total = len(items)
    return {
        "items": items[: max(1, int(limit))],
        "total": total,
        "synced_at": snapshot.get("synced_at"),
    }


def _filter_groups_from_snapshot(
    snapshot: dict[str, Any],
    *,
    branch: str | None = None,
    folder_query: str = "",
) -> list[dict[str, Any]]:
    normalized_query = _normalize_query(folder_query)
    branch_filter = str(branch or "").strip()
    groups = [
        group for group in (snapshot.get("groups") or [])
        if isinstance(group, dict) and (not branch_filter or str(group.get("branch") or "") == branch_filter)
    ]
    if normalized_query:
        groups = [
            group for group in groups
            if normalized_query in _normalize_query(group.get("cn"))
            or normalized_query in _normalize_query(group.get("folder_label"))
            or normalized_query in _normalize_query(group.get("folder_path"))
            or normalized_query in _normalize_query(group.get("description"))
        ]
    groups.sort(
        key=lambda row: (
            str(row.get("branch") or "").casefold(),
            str(row.get("folder_path") or "").casefold(),
            str(row.get("access_level") or "").casefold(),
        )
    )
    return groups


def _project_group_item(group: dict[str, Any]) -> dict[str, Any]:
    return {field: group.get(field) for field in _GROUP_LIST_FIELDS if field in group}


def _build_sparse_cells(
    users: list[dict[str, Any]],
    *,
    group_dns: set[str],
) -> list[list[str]]:
    cells: list[list[str]] = []
    for user in users:
        if not isinstance(user, dict):
            continue
        login = str(user.get("login") or "").strip()
        if not login:
            continue
        for access_row in user.get("access") or []:
            if not isinstance(access_row, dict):
                continue
            group_dn = str(access_row.get("group_dn") or "").strip()
            if not group_dn or group_dn not in group_dns:
                continue
            cells.append([login, group_dn, str(access_row.get("access_level") or "member")])
    return cells


def _filter_users_for_groups(
    snapshot: dict[str, Any],
    *,
    group_dns: set[str],
    user_query: str = "",
) -> list[dict[str, Any]]:
    normalized_user_query = _normalize_query(user_query)
    users: list[dict[str, Any]] = []
    for user in snapshot.get("users") or []:
        if not isinstance(user, dict):
            continue
        if not _user_matches_query(user, normalized_user_query):
            continue
        access_rows = [
            row for row in (user.get("access") or [])
            if isinstance(row, dict) and str(row.get("group_dn") or "").strip() in group_dns
        ]
        if not access_rows:
            continue
        users.append(
            {
                "login": user.get("login"),
                "display_name": user.get("display_name"),
                "access": access_rows,
                "access_count": len(access_rows),
            }
        )
    users.sort(key=lambda row: str(row.get("login") or "").casefold())
    return users


def get_matrix_grid(
    *,
    branch: str | None = None,
    folder_query: str = "",
    user_query: str = "",
    group_limit: int = 250,
    user_limit: int = 500,
) -> dict[str, Any]:
    snapshot = load_snapshot()
    all_groups = [_project_group_item(group) for group in _filter_groups_from_snapshot(
        snapshot,
        branch=branch,
        folder_query=folder_query,
    )]
    safe_group_limit = max(1, min(int(group_limit or 250), 1000))
    safe_user_limit = max(1, min(int(user_limit or 500), 2000))
    groups = all_groups[:safe_group_limit]
    group_dns = {str(group.get("dn") or "").strip() for group in groups if str(group.get("dn") or "").strip()}
    all_users = _filter_users_for_groups(snapshot, group_dns=group_dns, user_query=user_query)
    users = all_users[:safe_user_limit]
    cells = _build_sparse_cells(users, group_dns=group_dns)
    users_light = [
        {
            "login": user.get("login"),
            "display_name": user.get("display_name"),
            "access_count": user.get("access_count"),
        }
        for user in users
    ]
    return {
        "synced_at": snapshot.get("synced_at"),
        "branch": str(branch or "").strip() or None,
        "groups": groups,
        "users": users_light,
        "cells": cells,
        "summary": {
            "group_count": len(all_groups),
            "user_count": len(all_users),
            "cell_count": len(cells),
            "returned_group_count": len(groups),
            "returned_user_count": len(users_light),
            "group_limit": safe_group_limit,
            "user_limit": safe_user_limit,
            "group_truncated": len(all_groups) > len(groups),
            "user_truncated": len(all_users) > len(users_light),
            "truncated": len(all_groups) > len(groups) or len(all_users) > len(users_light),
        },
    }


def _user_matches_query(user: dict[str, Any], normalized_query: str) -> bool:
    if not normalized_query:
        return True
    login = _normalize_query(user.get("login"))
    display_name = _normalize_query(user.get("display_name"))
    if normalized_query in login or normalized_query in display_name:
        return True
    return any(token in login or token in display_name for token in normalized_query.split() if token)


def get_export_dataset(
    *,
    branch: str | None = None,
    folder_query: str = "",
    user_query: str = "",
) -> dict[str, Any]:
    snapshot = load_snapshot()
    groups = _filter_groups_from_snapshot(snapshot, branch=branch, folder_query=folder_query)
    group_dns = {str(group.get("dn") or "").strip() for group in groups if str(group.get("dn") or "").strip()}
    users = _filter_users_for_groups(snapshot, group_dns=group_dns, user_query=user_query)
    return {
        "synced_at": snapshot.get("synced_at"),
        "branch": str(branch or "").strip() or None,
        "groups": groups,
        "users": users,
        "summary": {
            "group_count": len(groups),
            "user_count": len(users),
        },
    }


def get_matrix(*, branch: str | None = None, query: str = "", page: int = 1, limit: int = 50) -> dict[str, Any]:
    snapshot = load_snapshot()
    groups = _filter_groups_from_snapshot(snapshot, branch=branch, folder_query=query)
    page_number = max(1, int(page or 1))
    page_size = max(1, min(int(limit or 50), 5000))
    offset = (page_number - 1) * page_size
    page_items = groups[offset : offset + page_size]
    return {
        "items": page_items,
        "total": len(groups),
        "page": page_number,
        "limit": page_size,
        "synced_at": snapshot.get("synced_at"),
    }


def get_group_detail(*, group_dn: str) -> dict[str, Any]:
    normalized_dn = str(group_dn or "").strip()
    snapshot = load_snapshot()
    if not normalized_dn:
        return {"status": "error", "error": "group_dn is required"}

    group = next(
        (item for item in (snapshot.get("groups") or []) if isinstance(item, dict) and str(item.get("dn") or "") == normalized_dn),
        None,
    )
    if group is None:
        return {"status": "not_found", "group_dn": normalized_dn}

    members_map = snapshot.get("group_members") if isinstance(snapshot.get("group_members"), dict) else {}
    members = members_map.get(normalized_dn) if isinstance(members_map.get(normalized_dn), list) else []
    return {
        "status": "ok",
        "group": group,
        "members": members,
        "synced_at": snapshot.get("synced_at"),
    }
