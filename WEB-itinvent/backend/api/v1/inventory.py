import logging
import ipaddress
import re
import sqlite3
import time
import os
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field

from backend.api.deps import ensure_user_permission, get_current_database_id, require_permission
from backend.api.v1.database import get_all_db_configs
from backend.appdb.db import ensure_app_schema_initialized, get_app_database_url, get_app_engine, is_app_database_configured
from backend.appdb.inventory_store import AppInventoryStore
from backend.appdb.sql_compat import SqlAlchemyCompatConnection
from backend.config import config
from backend.db_schema import schema_name
from backend import inventory_runtime
from backend.models.auth import User
from backend.services.user_db_selection_service import user_db_selection_service
from backend.services.authorization_service import (
    PERM_COMPUTERS_MANAGE,
    PERM_COMPUTERS_READ,
    PERM_COMPUTERS_READ_ALL,
)
from local_store import get_local_store

router = APIRouter()
logger = logging.getLogger(__name__)


def _env_positive_int(name: str, default: int, minimum: int) -> int:
    raw = str(os.getenv(name, str(default)) or "").strip()
    try:
        return max(int(raw), int(minimum))
    except Exception:
        return max(int(default), int(minimum))

INVENTORY_FILE = "agent_inventory_cache.json"
CHANGES_FILE = "agent_inventory_changes.json"
HISTORY_RETENTION_DAYS = 90
CHANGES_WINDOW_DAYS = 30

ONLINE_MAX_AGE_SECONDS = 12 * 60
STALE_MAX_AGE_SECONDS = 60 * 60
OUTLOOK_ALLOWED_STATUS = {"ok", "warning", "critical", "unknown"}
OUTLOOK_ALLOWED_CONFIDENCE = {"high", "medium", "low"}
OUTLOOK_ALLOWED_SOURCE = {"user_helper_com", "system_scan", "none"}
COMPUTER_SEARCH_FIELDS = {"identity", "user", "profiles", "outlook", "network", "location", "database"}
COMPUTER_SEARCH_DEFAULT_FIELDS = set(COMPUTER_SEARCH_FIELDS)
COMPUTER_SEARCH_DYNAMIC_FIELDS = {"network", "location", "database"}

# Native clients intentionally receive only the fields rendered by the native
# Computers UI.  Full agent/profile/change payloads remain available to the
# protected web endpoint, but must not cross the mobile transport boundary.
_MOBILE_COMPUTER_LIST_FIELDS = (
    "mac_address",
    "hostname",
    "status",
    "age_seconds",
    "current_user",
    "user_login",
    "user_full_name",
    "branch_name",
    "location_name",
    "is_unassigned",
    "ip_primary",
    "has_hardware_changes",
    "changes_count_30d",
)
_MOBILE_COMPUTER_DETAIL_FIELDS = _MOBILE_COMPUTER_LIST_FIELDS + (
    "last_seen_at",
    "database_name",
    "inventory_inv_no",
    "inventory_model_name",
    "ip_list",
    "cpu_load_percent",
    "ram_used_percent",
    "uptime_seconds",
    "last_reboot_at",
    "cpu_model",
    "ram_gb",
    "system_serial",
    "outlook_status",
    "outlook_total_size_bytes",
    "outlook_archives_count",
)
_MOBILE_DISK_FIELDS = (
    "name",
    "display_name",
    "mountpoint",
    "device",
    "total_gb",
    "free_gb",
    "size_gb",
    "health_status",
    "media_type",
)
_MOBILE_NETWORK_DEVICE_FIELDS = (
    "name",
    "connection_status",
    "link_speed",
    "ipv4",
)
DEFAULT_INVENTORY_NETWORK_SCOPE_MAP = "10.105.6.0/24=ITINVENT|г.Тюмень, Велижанский тракт 6"
INVENTORY_HEARTBEAT_DEFER_WINDOW_SECONDS = _env_positive_int(
    "ITINV_INVENTORY_HEARTBEAT_DEFER_WINDOW_SECONDS",
    default=_env_positive_int(
        "ITINV_INVENTORY_HEARTBEAT_WRITE_INTERVAL_SECONDS",
        default=600,
        minimum=15,
    ),
    minimum=15,
)
_NETWORK_LOOKUP_TABLES = {
    "network_branches",
    "network_sites",
    "network_devices",
    "network_ports",
    "network_sockets",
}


def _parse_inventory_network_scope_map(raw: Any) -> List[Tuple[Any, str, str]]:
    rules: List[Tuple[Any, str, str]] = []
    for item in str(raw or "").split(";"):
        cidr, separator, target = item.strip().partition("=")
        if not separator:
            continue
        database_id, _, branch_name = target.partition("|")
        try:
            network = ipaddress.ip_network(cidr.strip(), strict=False)
        except ValueError:
            continue
        normalized_database_id = database_id.strip()
        if normalized_database_id:
            rules.append((network, normalized_database_id, branch_name.strip()))
    return rules


INVENTORY_NETWORK_SCOPE_RULES = _parse_inventory_network_scope_map(
    os.getenv("ITINV_INVENTORY_NETWORK_SCOPE_MAP", DEFAULT_INVENTORY_NETWORK_SCOPE_MAP)
)


def _query_bool(value: Any, default: bool = False) -> bool:
    """Resolve FastAPI Query() placeholders when endpoint functions are called directly in tests."""
    if isinstance(value, bool):
        return value
    default_value = getattr(value, "default", default)
    if isinstance(default_value, bool):
        return default_value
    return bool(default)


def _inventory_database_url() -> Optional[str]:
    if not is_app_database_configured():
        return None
    database_url = get_app_database_url()
    if not database_url:
        return None
    return ensure_app_schema_initialized(database_url)


def _get_inventory_app_store() -> Optional[AppInventoryStore]:
    database_url = _inventory_database_url()
    if not database_url:
        return None
    return AppInventoryStore(database_url=database_url)


def _inventory_record_key(record: Dict[str, Any]) -> str:
    mac_address = _normalize_text(record.get("mac_address"))
    if mac_address:
        return mac_address
    return _normalize_text(record.get("hostname")).lower()


def _load_inventory_snapshot(
    host_keys: Optional[set[str]] = None,
    *,
    include_hidden: bool = False,
    hidden_only: bool = False,
) -> Dict[str, Dict[str, Any]]:
    app_store = _get_inventory_app_store()
    if app_store is not None:
        snapshot: Dict[str, Dict[str, Any]] = {}
        for row in app_store.list_hosts(
            host_keys=host_keys,
            include_hidden=include_hidden or hidden_only,
            hidden_only=hidden_only,
        ):
            if isinstance(row, dict):
                snapshot[_inventory_record_key(row)] = row
        return snapshot

    store = get_local_store()
    payload = store.load_json(INVENTORY_FILE, default_content={})
    if not isinstance(payload, dict):
        return {}
    if host_keys is None:
        filtered = payload
    else:
        normalized_keys = {_normalize_mac(item) or _normalize_text(item).lower() for item in host_keys if _normalize_text(item)}
        if not normalized_keys:
            return {}
        filtered = {
            key: value
            for key, value in payload.items()
            if isinstance(value, dict)
            and ((_normalize_mac(value.get("mac_address")) in normalized_keys) or (_normalize_text(value.get("hostname")).lower() in normalized_keys))
        }
    # JSON fallback has no hidden_* columns; include_hidden/hidden_only only apply to app-db.
    if hidden_only:
        return {
            key: value
            for key, value in filtered.items()
            if isinstance(value, dict) and value.get("hidden_at") not in (None, "", 0)
        }
    if not include_hidden:
        return {
            key: value
            for key, value in filtered.items()
            if not (isinstance(value, dict) and value.get("hidden_at") not in (None, "", 0))
        }
    return filtered


def _get_inventory_host(mac_address: str) -> Optional[Dict[str, Any]]:
    app_store = _get_inventory_app_store()
    if app_store is not None:
        return app_store.get_host(mac_address)

    store = get_local_store()
    payload = store.load_json(INVENTORY_FILE, default_content={})
    if not isinstance(payload, dict):
        return None
    return payload.get(_normalize_text(mac_address))


def _save_inventory_host(record: Dict[str, Any], current_data: Optional[Dict[str, Dict[str, Any]]] = None) -> bool:
    app_store = _get_inventory_app_store()
    if app_store is not None:
        app_store.upsert_host(record)
        return True

    store = get_local_store()
    payload = current_data if isinstance(current_data, dict) else store.load_json(INVENTORY_FILE, default_content={})
    if not isinstance(payload, dict):
        payload = {}
    payload[_normalize_text(record.get("mac_address"))] = record
    return bool(store.save_json(INVENTORY_FILE, payload))


def _touch_inventory_host_presence(
    *,
    mac_address: str,
    last_seen_at: int,
    report_type: str,
    hostname: str = "",
    user_login: str = "",
    user_full_name: str = "",
    ip_primary: str = "",
) -> bool:
    app_store = _get_inventory_app_store()
    if app_store is None:
        return False
    return bool(
        app_store.touch_host_presence(
            mac_address,
            last_seen_at=int(last_seen_at),
            report_type=str(report_type or "heartbeat").strip() or "heartbeat",
            hostname=_normalize_text(hostname),
            user_login=_normalize_text(user_login),
            user_full_name=_normalize_text(user_full_name),
            ip_primary=_normalize_text(ip_primary),
        )
    )


def _save_change_events(changes: List[Dict[str, Any]]) -> bool:
    app_store = _get_inventory_app_store()
    if app_store is not None:
        cutoff = int(time.time()) - HISTORY_RETENTION_DAYS * 24 * 60 * 60
        app_store.prune_change_events(cutoff)
        for event in sorted(changes, key=lambda item: _to_int(item.get("detected_at"), 0)):
            if isinstance(event, dict):
                app_store.append_change_event(event)
        return True

    store = get_local_store()
    return bool(store.save_json(CHANGES_FILE, changes))


def _append_change_events(changes: List[Dict[str, Any]]) -> bool:
    app_store = _get_inventory_app_store()
    if app_store is None:
        return False
    cutoff = int(time.time()) - HISTORY_RETENTION_DAYS * 24 * 60 * 60
    app_store.prune_change_events(cutoff)
    for event in sorted(changes, key=lambda item: _to_int(item.get("detected_at"), 0)):
        if isinstance(event, dict):
            app_store.append_change_event(event)
    return True


def _open_network_lookup_connection():
    database_url = _inventory_database_url()
    if database_url:
        return SqlAlchemyCompatConnection(
            get_app_engine(database_url),
            table_names=_NETWORK_LOOKUP_TABLES,
            schema=schema_name("app", database_url),
        )

    store = get_local_store()
    conn = sqlite3.connect(str(store.db_path), timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def _api_key_fingerprint(value: Optional[str]) -> str:
    raw = str(value or "").strip()
    if not raw:
        return "none"
    digest = hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()
    return digest[:12]


def _load_agent_api_keys() -> List[str]:
    keys: List[str] = []
    ring_raw = str(os.getenv("ITINV_AGENT_API_KEYS", "") or "").strip()
    if ring_raw:
        for row in ring_raw.split(","):
            key = str(row or "").strip()
            if key and key not in keys:
                keys.append(key)

    legacy_key = str(os.getenv("ITINV_AGENT_API_KEY", "") or "").strip()
    if legacy_key and legacy_key not in keys:
        keys.append(legacy_key)
    return keys


def _is_valid_agent_api_key(candidate: Optional[str]) -> bool:
    token = str(candidate or "").strip()
    if not token:
        return False
    keys = _load_agent_api_keys()
    return token in keys


class InventoryPayload(BaseModel):
    hostname: str
    system_serial: Optional[str] = "Unknown"
    mac_address: str
    current_user: Optional[str] = ""
    user_login: Optional[str] = ""
    user_full_name: Optional[str] = ""
    ip_primary: Optional[str] = ""
    ip_list: Optional[List[str]] = None
    cpu_model: Optional[str] = "Unknown"
    ram_gb: Optional[float] = None
    monitors: Optional[List[Dict[str, Any]]] = None
    logical_disks: Optional[List[Dict[str, Any]]] = None
    storage: Optional[List[Dict[str, Any]]] = None
    report_type: Optional[str] = "full_snapshot"
    last_seen_at: Optional[int] = None
    last_full_snapshot_at: Optional[int] = None
    os_info: Optional[Dict[str, Any]] = None
    network: Optional[Dict[str, Any]] = None
    health: Optional[Dict[str, Any]] = None
    uptime_seconds: Optional[int] = None
    cpu_load_percent: Optional[float] = None
    ram_used_percent: Optional[float] = None
    last_reboot_at: Optional[int] = None
    security: Optional[Dict[str, Any]] = None
    updates: Optional[Dict[str, Any]] = None
    outlook: Optional[Dict[str, Any]] = None
    user_profile_sizes: Optional[Dict[str, Any]] = None
    agent_runtime: Optional[Dict[str, Any]] = None
    ops_health: Optional[Dict[str, Any]] = None
    software_inventory: Optional[Dict[str, Any]] = None
    timestamp: int


def _normalize_report_type(value: Optional[str]) -> str:
    normalized = str(value or "").strip().lower()
    if normalized == "heartbeat":
        return "heartbeat"
    return "full_snapshot"


def _model_dump(payload: InventoryPayload) -> Dict[str, Any]:
    if hasattr(payload, "model_dump"):
        return payload.model_dump(exclude_unset=True)
    return payload.dict(exclude_unset=True)


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _to_float(value: Any, default: Optional[float] = None) -> Optional[float]:
    try:
        return float(value)
    except Exception:
        return default


def _normalize_text(value: Any) -> str:
    return str(value or "").replace("\x00", "").strip()


def _cyrillic_score(value: str) -> int:
    text = _normalize_text(value)
    cyr_count = len(re.findall(r"[А-Яа-яЁё]", text))
    mojibake_count = len(re.findall(r"[ЉЊЋЌЍЎџ®§«»ўЄЁ©…†‡‰™‹›№]", text))
    return cyr_count - (mojibake_count * 2)


def _repair_cp866_mojibake(value: Any) -> str:
    text = _normalize_text(value)
    if not text:
        return ""
    if not re.search(r"[ЉЊЋЌЍЎџ®§«»ўЄЁ©…†‡‰™‹›№]", text):
        return text
    try:
        candidate = text.encode("cp1251").decode("cp866")
    except Exception:
        return text
    if _cyrillic_score(candidate) >= _cyrillic_score(text) + 3:
        return candidate
    return text


def _normalize_person_name(value: Any) -> str:
    return _repair_cp866_mojibake(value)


def _normalize_mac(value: Any) -> str:
    return re.sub(r"[^0-9A-Fa-f]", "", _normalize_text(value)).upper()


def _normalize_login(value: Any) -> str:
    return _normalize_text(value)


def _extract_mac_candidates(value: Any) -> List[str]:
    text = _normalize_text(value)
    if not text:
        return []
    matches = re.findall(
        r"(?:[0-9A-Fa-f]{2}(?:[:-])){5}[0-9A-Fa-f]{2}|[0-9A-Fa-f]{12}|[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}",
        text,
    )
    out: List[str] = []
    for raw in matches:
        normalized = _normalize_mac(raw)
        if len(normalized) != 12:
            continue
        if normalized not in out:
            out.append(normalized)
    return out


def _extract_first_ipv4(value: Any) -> str:
    text = _normalize_text(value)
    if not text:
        return ""
    match = re.search(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", text)
    return match.group(0) if match else ""


def _extract_ipv4_candidates(value: Any) -> List[str]:
    text = _normalize_text(value)
    if not text:
        return []
    out: List[str] = []
    for raw in re.findall(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", text):
        if raw not in out:
            out.append(raw)
    return out


def _dedupe_strings(values: List[Any]) -> List[str]:
    out: List[str] = []
    seen = set()
    for raw in values or []:
        value = _normalize_text(raw)
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _project_mobile_computer(record: Dict[str, Any], *, detail: bool) -> Dict[str, Any]:
    """Return the bounded, path-free Computers contract used by native clients."""
    source = record if isinstance(record, dict) else {}
    allowed_fields = _MOBILE_COMPUTER_DETAIL_FIELDS if detail else _MOBILE_COMPUTER_LIST_FIELDS
    projected = {field: source.get(field) for field in allowed_fields if field in source}

    for collection_name in ("logical_disks", "storage"):
        rows = source.get(collection_name) if isinstance(source.get(collection_name), list) else []
        projected[collection_name] = [
            {field: row.get(field) for field in _MOBILE_DISK_FIELDS if field in row}
            for row in rows[:32]
            if isinstance(row, dict)
        ]

    if detail:
        projected["ip_list"] = _dedupe_strings(
            source.get("ip_list") if isinstance(source.get("ip_list"), list) else []
        )[:16]
        network = source.get("network") if isinstance(source.get("network"), dict) else {}
        devices = network.get("devices") if isinstance(network.get("devices"), list) else []
        projected_devices = []
        for row in devices[:32]:
            if not isinstance(row, dict):
                continue
            projected_devices.append(
                {
                    "name": _normalize_text(row.get("name") or row.get("description")),
                    "connection_status": row.get("connection_status"),
                    "link_speed": row.get("link_speed"),
                    "ipv4": _dedupe_strings(row.get("ipv4") if isinstance(row.get("ipv4"), list) else [])[:8],
                }
            )
        projected["network"] = {"devices": projected_devices}

    return projected


def _extract_ip_fields(record: Dict[str, Any]) -> Tuple[str, List[str]]:
    candidate_list = record.get("ip_list")
    if not isinstance(candidate_list, list):
        candidate_list = []

    if not candidate_list:
        network = record.get("network") if isinstance(record.get("network"), dict) else {}
        network_ipv4 = network.get("active_ipv4") if isinstance(network.get("active_ipv4"), list) else []
        candidate_list = list(network_ipv4)

    ip_list = _dedupe_strings(candidate_list)
    ip_primary = _normalize_text(record.get("ip_primary"))
    if not ip_primary and ip_list:
        ip_primary = ip_list[0]
    if ip_primary and ip_primary not in ip_list:
        ip_list.insert(0, ip_primary)
    return ip_primary, ip_list


def _resolve_inventory_network_scope(record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    ip_primary, ip_list = _extract_ip_fields(record)
    candidates = _dedupe_strings([ip_primary, *ip_list])
    for raw_ip in candidates:
        try:
            ip_value = ipaddress.ip_address(raw_ip)
        except ValueError:
            continue
        for network, database_id, branch_name in INVENTORY_NETWORK_SCOPE_RULES:
            if ip_value in network:
                return {
                    "database_id": database_id,
                    "branch_name": branch_name,
                    "ip_address": raw_ip,
                }
    return None


def _network_link_payload(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "branch_id": row["branch_id"],
        "branch_name": row["branch_name"],
        "site_name": row["site_name"],
        "device_code": row["device_code"],
        "device_model": row["device_model"],
        "port_name": row["port_name"],
        "socket_code": row["socket_code"],
        "endpoint_ip_raw": row["endpoint_ip_raw"],
        "endpoint_mac_raw": row["endpoint_mac_raw"],
    }


def _ensure_identity_fields(record: Dict[str, Any]) -> None:
    user_login = _normalize_login(record.get("user_login") or record.get("current_user"))
    user_full_name = _normalize_person_name(record.get("user_full_name"))
    record["user_login"] = user_login
    record["current_user"] = user_login
    record["user_full_name"] = user_full_name

    ip_primary, ip_list = _extract_ip_fields(record)
    record["ip_primary"] = ip_primary
    record["ip_list"] = ip_list


def _ensure_runtime_fields(record: Dict[str, Any]) -> None:
    health = record.get("health") if isinstance(record.get("health"), dict) else {}

    cpu_value = _to_float(record.get("cpu_load_percent"), default=None)
    if cpu_value is None:
        cpu_value = _to_float(health.get("cpu_load_percent"), default=None)
    if cpu_value is not None:
        cpu_value = round(cpu_value, 1)
        record["cpu_load_percent"] = cpu_value
        health["cpu_load_percent"] = cpu_value

    ram_value = _to_float(record.get("ram_used_percent"), default=None)
    if ram_value is None:
        ram_value = _to_float(health.get("ram_used_percent"), default=None)
    if ram_value is not None:
        ram_value = round(ram_value, 1)
        record["ram_used_percent"] = ram_value
        health["ram_used_percent"] = ram_value

    uptime_value = _to_int(record.get("uptime_seconds"), default=-1)
    if uptime_value < 0:
        uptime_value = _to_int(health.get("uptime_seconds"), default=-1)
    if uptime_value >= 0:
        record["uptime_seconds"] = uptime_value
        health["uptime_seconds"] = uptime_value

    last_reboot_at = _to_int(
        record.get("last_reboot_at") or health.get("last_reboot_at") or health.get("boot_time"),
        default=0,
    )
    if last_reboot_at > 0:
        record["last_reboot_at"] = last_reboot_at
        health["boot_time"] = last_reboot_at
        health["last_reboot_at"] = last_reboot_at
        if not _normalize_text(health.get("last_reboot_iso")):
            health["last_reboot_iso"] = datetime.fromtimestamp(last_reboot_at).isoformat()

    record["health"] = health


def _normalize_outlook_store(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    path = _normalize_text(raw.get("path"))
    if not path:
        return None
    store_type = _normalize_text(raw.get("type")).lower()
    if not store_type:
        suffix = os.path.splitext(path)[1].lower()
        if suffix == ".ost":
            store_type = "ost"
        elif suffix == ".pst":
            store_type = "pst"
        else:
            store_type = suffix.lstrip(".")
    return {
        "path": path,
        "type": store_type,
        "size_bytes": max(0, _to_int(raw.get("size_bytes"), 0)),
        "last_modified_at": max(0, _to_int(raw.get("last_modified_at"), 0)),
    }


def _normalize_outlook_payload(raw: Any) -> Dict[str, Any]:
    base: Dict[str, Any] = {
        "collected_at": _to_int(time.time(), 0),
        "source": "none",
        "confidence": "low",
        "status": "unknown",
        "threshold_warning_bytes": 45 * (1024 ** 3),
        "threshold_critical_bytes": 49 * (1024 ** 3),
        "active_store": None,
        "active_stores": [],
        "active_candidate": None,
        "archives": [],
        "largest_file_path": "",
        "largest_file_size_bytes": 0,
        "total_outlook_size_bytes": 0,
    }
    if not isinstance(raw, dict):
        return base

    source = _normalize_text(raw.get("source")).lower()
    confidence = _normalize_text(raw.get("confidence")).lower()
    status = _normalize_text(raw.get("status")).lower()
    if source not in OUTLOOK_ALLOWED_SOURCE:
        source = "none"
    if confidence not in OUTLOOK_ALLOWED_CONFIDENCE:
        confidence = "low"
    if status not in OUTLOOK_ALLOWED_STATUS:
        status = "unknown"

    warning_bytes = max(1, _to_int(raw.get("threshold_warning_bytes"), base["threshold_warning_bytes"]))
    critical_bytes = max(warning_bytes, _to_int(raw.get("threshold_critical_bytes"), base["threshold_critical_bytes"]))

    active_store = _normalize_outlook_store(raw.get("active_store"))
    active_stores: List[Dict[str, Any]] = []
    active_stores_raw = raw.get("active_stores")
    if isinstance(active_stores_raw, list):
        for row in active_stores_raw:
            normalized = _normalize_outlook_store(row)
            if normalized:
                active_stores.append(normalized)
    if active_store:
        active_stores.insert(0, active_store)
    if active_stores:
        deduped_active_stores: List[Dict[str, Any]] = []
        seen_paths = set()
        for row in active_stores:
            row_path = _normalize_text(row.get("path")).lower()
            if not row_path or row_path in seen_paths:
                continue
            seen_paths.add(row_path)
            deduped_active_stores.append(row)
        active_stores = deduped_active_stores
    active_store = active_stores[0] if active_stores else None
    active_candidate = _normalize_outlook_store(raw.get("active_candidate"))

    archives: List[Dict[str, Any]] = []
    archives_raw = raw.get("archives")
    if isinstance(archives_raw, list):
        for row in archives_raw:
            normalized = _normalize_outlook_store(row)
            if normalized:
                archives.append(normalized)

    active_size = 0
    if active_stores:
        active_size = max(max(0, _to_int(row.get("size_bytes"), 0)) for row in active_stores)
    if confidence in {"high", "medium"} and active_size > 0:
        if active_size >= critical_bytes:
            status = "critical"
        elif active_size >= warning_bytes:
            status = "warning"
        else:
            status = "ok"
    else:
        status = "unknown"

    return {
        "collected_at": max(0, _to_int(raw.get("collected_at"), base["collected_at"])),
        "source": source,
        "confidence": confidence,
        "status": status,
        "threshold_warning_bytes": warning_bytes,
        "threshold_critical_bytes": critical_bytes,
        "active_store": active_store,
        "active_stores": active_stores,
        "active_candidate": active_candidate,
        "archives": archives,
        "largest_file_path": _normalize_text(raw.get("largest_file_path")),
        "largest_file_size_bytes": max(0, _to_int(raw.get("largest_file_size_bytes"), 0)),
        "total_outlook_size_bytes": max(0, _to_int(raw.get("total_outlook_size_bytes"), 0)),
    }


def _enrich_outlook_fields(record: Dict[str, Any]) -> None:
    outlook = _normalize_outlook_payload(record.get("outlook"))
    active_stores = outlook.get("active_stores") if isinstance(outlook.get("active_stores"), list) else []
    active_store = outlook.get("active_store") if isinstance(outlook.get("active_store"), dict) else None
    if not active_store and active_stores:
        first_active = active_stores[0]
        if isinstance(first_active, dict):
            active_store = first_active
    archives = outlook.get("archives") if isinstance(outlook.get("archives"), list) else []
    active_size_bytes = max(0, _to_int((active_store or {}).get("size_bytes"), 0))
    if active_stores:
        active_size_bytes = max(active_size_bytes, max(max(0, _to_int(row.get("size_bytes"), 0)) for row in active_stores if isinstance(row, dict)))
    record["outlook"] = outlook
    record["outlook_status"] = _normalize_text(outlook.get("status")).lower() or "unknown"
    record["outlook_confidence"] = _normalize_text(outlook.get("confidence")).lower() or "low"
    record["outlook_active_size_bytes"] = active_size_bytes
    record["outlook_active_path"] = _normalize_text((active_store or {}).get("path"))
    record["outlook_active_stores_count"] = len([row for row in active_stores if isinstance(row, dict)])
    record["outlook_total_size_bytes"] = max(0, _to_int(outlook.get("total_outlook_size_bytes"), 0))
    record["outlook_archives_count"] = len([row for row in archives if isinstance(row, dict)])


def _normalize_user_profile_folder(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    name = _normalize_text(raw.get("name"))
    path = _normalize_text(raw.get("path"))
    if not name and not path:
        return None
    return {
        "name": name,
        "path": path,
        "size_bytes": max(0, _to_int(raw.get("size_bytes"), 0)),
        "files_count": max(0, _to_int(raw.get("files_count"), 0)),
        "dirs_count": max(0, _to_int(raw.get("dirs_count"), 0)),
        "errors_count": max(0, _to_int(raw.get("errors_count"), 0)),
        "partial": bool(raw.get("partial")),
        "partial_reason": _normalize_text(raw.get("partial_reason")),
        "partial_reasons": _normalize_user_profile_partial_reasons(raw.get("partial_reasons")),
    }


def _normalize_user_profile_partial_reasons(raw: Any) -> List[str]:
    values = raw if isinstance(raw, list) else [raw]
    result: List[str] = []
    for value in values:
        reason = _normalize_text(value).lower()
        if reason in {"timeout", "entry_limit", "total_timeout"} and reason not in result:
            result.append(reason)
    return result


def _normalize_user_profile_size(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    user_name = _normalize_text(raw.get("user_name"))
    profile_path = _normalize_text(raw.get("profile_path"))
    if not user_name and not profile_path:
        return None
    folders = []
    for row in raw.get("top_level_folders") if isinstance(raw.get("top_level_folders"), list) else []:
        normalized = _normalize_user_profile_folder(row)
        if normalized:
            folders.append(normalized)
    return {
        "user_name": user_name,
        "profile_path": profile_path,
        "total_size_bytes": max(0, _to_int(raw.get("total_size_bytes"), 0)),
        "top_level_folders": folders,
        "files_count": max(0, _to_int(raw.get("files_count"), 0)),
        "dirs_count": max(0, _to_int(raw.get("dirs_count"), 0)),
        "errors_count": max(0, _to_int(raw.get("errors_count"), 0)),
        "duration_ms": max(0, _to_int(raw.get("duration_ms"), 0)),
        "partial": bool(raw.get("partial")),
        "partial_reason": _normalize_text(raw.get("partial_reason")),
        "partial_reasons": _normalize_user_profile_partial_reasons(raw.get("partial_reasons")),
    }


def _normalize_user_profile_sizes(raw: Any) -> Dict[str, Any]:
    raw_dict = raw if isinstance(raw, dict) else {}
    profiles = []
    if isinstance(raw_dict.get("profiles"), list):
        for row in raw_dict.get("profiles") or []:
            normalized = _normalize_user_profile_size(row)
            if normalized:
                profiles.append(normalized)
    total_size = sum(max(0, _to_int(row.get("total_size_bytes"), 0)) for row in profiles)
    partial_reasons = _normalize_user_profile_partial_reasons(raw_dict.get("partial_reasons"))
    for row in profiles:
        for reason in _normalize_user_profile_partial_reasons(row.get("partial_reasons")):
            if reason not in partial_reasons:
                partial_reasons.append(reason)
    raw_limits = raw_dict.get("limits") if isinstance(raw_dict.get("limits"), dict) else {}
    return {
        "cache_version": max(0, _to_int(raw_dict.get("cache_version"), 0)),
        "collected_at": max(0, _to_int(raw_dict.get("collected_at"), 0)),
        "profiles_count": len(profiles),
        "total_size_bytes": total_size,
        "profiles": profiles,
        "partial": bool(raw_dict.get("partial")) or any(bool(row.get("partial")) for row in profiles),
        "partial_reasons": partial_reasons,
        "duration_ms": max(0, _to_int(raw_dict.get("duration_ms"), 0)),
        "limits": {
            "profile_budget_sec": max(0, _to_int(raw_limits.get("profile_budget_sec"), 0)),
            "total_budget_sec": max(0, _to_int(raw_limits.get("total_budget_sec"), 0)),
            "max_entries_per_profile": max(0, _to_int(raw_limits.get("max_entries_per_profile"), 0)),
            "max_profiles": max(0, _to_int(raw_limits.get("max_profiles"), 0)),
        },
    }


def _enrich_user_profile_size_fields(record: Dict[str, Any]) -> None:
    user_profile_sizes = _normalize_user_profile_sizes(record.get("user_profile_sizes"))
    record["user_profile_sizes"] = user_profile_sizes
    record["user_profile_sizes_total_bytes"] = max(0, _to_int(user_profile_sizes.get("total_size_bytes"), 0))
    record["user_profile_sizes_profiles_count"] = max(0, _to_int(user_profile_sizes.get("profiles_count"), 0))
    record["user_profile_sizes_partial"] = bool(user_profile_sizes.get("partial"))


def _merge_payload(previous: Any, incoming: Dict[str, Any]) -> Dict[str, Any]:
    merged: Dict[str, Any] = dict(previous) if isinstance(previous, dict) else {}
    for key, value in incoming.items():
        if value is not None:
            merged[key] = value
    if "outlook" in incoming:
        merged["outlook"] = _normalize_outlook_payload(incoming.get("outlook"))
    if "user_profile_sizes" in incoming:
        merged["user_profile_sizes"] = _normalize_user_profile_sizes(incoming.get("user_profile_sizes"))
    _ensure_identity_fields(merged)
    _ensure_runtime_fields(merged)
    _enrich_outlook_fields(merged)
    _enrich_user_profile_size_fields(merged)
    return merged


def _enrich_status(record: Dict[str, Any], now_ts: int) -> Dict[str, Any]:
    result = dict(record)
    last_seen_raw = result.get("last_seen_at") or result.get("timestamp")
    last_seen_at = _to_int(last_seen_raw, default=0)

    if last_seen_at <= 0:
        result["status"] = "unknown"
        result["age_seconds"] = None
        result["last_seen_at"] = None
        return result

    age_seconds = max(0, now_ts - last_seen_at)
    if age_seconds <= ONLINE_MAX_AGE_SECONDS:
        status_value = "online"
    elif age_seconds <= STALE_MAX_AGE_SECONDS:
        status_value = "stale"
    else:
        status_value = "offline"

    result["status"] = status_value
    result["age_seconds"] = age_seconds
    result["last_seen_at"] = last_seen_at
    return result


def _signature_monitors(record: Dict[str, Any]) -> List[str]:
    values: List[str] = []
    rows = record.get("monitors") if isinstance(record.get("monitors"), list) else []
    for row in rows:
        if not isinstance(row, dict):
            continue
        serial = _normalize_text(row.get("serial_number"))
        manufacturer = _normalize_text(row.get("manufacturer")).lower()
        product = _normalize_text(row.get("product_code")).lower()
        token = f"{serial.lower()}|{manufacturer}|{product}"
        if token.strip("|"):
            values.append(token)
    return sorted(set(values))


def _signature_storage(record: Dict[str, Any]) -> List[str]:
    values: List[str] = []
    rows = record.get("storage") if isinstance(record.get("storage"), list) else []
    for row in rows:
        if not isinstance(row, dict):
            continue
        serial = _normalize_text(row.get("serial_number"))
        model = _normalize_text(row.get("model")).lower()
        bus = _normalize_text(row.get("bus_type")).lower()
        token = f"{serial.lower()}|{model}|{bus}"
        if token.strip("|"):
            values.append(token)
    return sorted(set(values))


def _signature_system(record: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "system_serial": _normalize_text(record.get("system_serial")),
        "cpu_model": _normalize_text(record.get("cpu_model")),
        "ram_gb": float(record.get("ram_gb") or 0),
    }


def _build_hardware_signature(record: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "system": _signature_system(record),
        "monitors": _signature_monitors(record),
        "storage": _signature_storage(record),
    }


def _build_signature_diff(before_sig: Dict[str, Any], after_sig: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    diff: Dict[str, Dict[str, Any]] = {}
    for key in ("system", "monitors", "storage"):
        before_value = before_sig.get(key)
        after_value = after_sig.get(key)
        if before_value != after_value:
            diff[key] = {"before": before_value, "after": after_value}
    return diff


def _load_changes(store: Any = None) -> List[Dict[str, Any]]:
    app_store = _get_inventory_app_store() if store is None else None
    if app_store is not None:
        payload = app_store.list_change_events()
        return [row for row in payload if isinstance(row, dict)]

    if store is None:
        store = get_local_store()
    payload = store.load_json(CHANGES_FILE, default_content=[])
    if not isinstance(payload, list):
        return []
    return [row for row in payload if isinstance(row, dict)]


def _prune_old_changes(rows: List[Dict[str, Any]], now_ts: int) -> List[Dict[str, Any]]:
    cutoff = now_ts - HISTORY_RETENTION_DAYS * 24 * 60 * 60
    out = []
    for row in rows:
        ts = _to_int(row.get("detected_at"), default=0)
        if ts <= 0:
            continue
        if ts >= cutoff:
            out.append(row)
    return out


def _event_host_key(mac_address: str, hostname: str) -> str:
    normalized_mac = _normalize_mac(mac_address)
    if normalized_mac:
        return f"mac:{normalized_mac}"
    normalized_host = _normalize_text(hostname).lower()
    return f"host:{normalized_host}"


def _add_hardware_change_event(
    changes: List[Dict[str, Any]],
    previous_record: Optional[Dict[str, Any]],
    merged_record: Dict[str, Any],
    current_ts: int,
) -> None:
    if not isinstance(previous_record, dict):
        merged_record["_hardware_signature"] = _build_hardware_signature(merged_record)
        return

    previous_sig = previous_record.get("_hardware_signature")
    if not isinstance(previous_sig, dict):
        previous_sig = _build_hardware_signature(previous_record)

    current_sig = _build_hardware_signature(merged_record)
    merged_record["_hardware_signature"] = current_sig

    diff = _build_signature_diff(previous_sig, current_sig)
    if not diff:
        return

    mac_address = _normalize_text(merged_record.get("mac_address"))
    hostname = _normalize_text(merged_record.get("hostname"))
    change_types = sorted(diff.keys())

    event = {
        "event_id": f"{_event_host_key(mac_address, hostname)}:{current_ts}",
        "detected_at": current_ts,
        "mac_address": mac_address,
        "hostname": hostname,
        "change_types": change_types,
        "diff": diff,
        "before_signature": previous_sig,
        "after_signature": current_sig,
        "report_type": _normalize_text(merged_record.get("report_type")) or "full_snapshot",
    }
    changes.append(event)


def _build_changes_index(changes: List[Dict[str, Any]], now_ts: int) -> Dict[str, Dict[str, Any]]:
    since_30d = now_ts - CHANGES_WINDOW_DAYS * 24 * 60 * 60
    index: Dict[str, Dict[str, Any]] = {}

    sorted_changes = sorted(changes, key=lambda item: _to_int(item.get("detected_at"), 0), reverse=True)
    for event in sorted_changes:
        ts = _to_int(event.get("detected_at"), 0)
        if ts <= 0:
            continue
        key = _event_host_key(_normalize_text(event.get("mac_address")), _normalize_text(event.get("hostname")))
        entry = index.setdefault(
            key,
            {
                "last_change_at": None,
                "changes_count_30d": 0,
                "recent_changes": [],
            },
        )
        if entry["last_change_at"] is None:
            entry["last_change_at"] = ts
        if ts >= since_30d:
            entry["changes_count_30d"] += 1
        if len(entry["recent_changes"]) < 5:
            entry["recent_changes"].append(event)

    return index


def _resolve_sql_context(mac_address: str, hostname: str, db_id: Optional[str]) -> Optional[Dict[str, Any]]:
    try:
        from backend.database import queries

        return queries.resolve_pc_context_by_mac_or_hostname(
            mac_address=mac_address,
            hostname=hostname,
            db_id=db_id,
        )
    except Exception as exc:
        logger.debug("SQL context resolution skipped: %s", exc)
        return None


def _resolve_sql_context_cached(
    app_store: Optional[AppInventoryStore],
    mac_address: str,
    hostname: str,
    db_id: Optional[str],
) -> Optional[Dict[str, Any]]:
    normalized_db_id = _normalize_text(db_id)
    if not normalized_db_id:
        return None
    cached: Optional[Dict[str, Any]] = None
    if app_store is not None:
        try:
            cached = app_store.get_sql_context(mac_address=mac_address, hostname=hostname, db_id=normalized_db_id)
            if isinstance(cached, dict) and (_normalize_text(cached.get("inv_no")) or _normalize_text(cached.get("model_name"))):
                return cached
        except Exception as exc:
            logger.debug("Inventory SQL context cache read skipped: %s", exc)
            cached = None

    resolved = _resolve_sql_context(mac_address, hostname, normalized_db_id)
    if not isinstance(resolved, dict) and isinstance(cached, dict):
        return cached
    if app_store is not None and isinstance(resolved, dict):
        try:
            app_store.upsert_sql_context(
                mac_address=mac_address,
                hostname=hostname,
                db_id=normalized_db_id,
                context=resolved,
            )
        except Exception as exc:
            logger.debug("Inventory SQL context cache write skipped: %s", exc)
    return resolved


def _normalize_scope(value: Any) -> Literal["selected", "all"]:
    scope = _normalize_text(value).lower()
    if scope == "all":
        return "all"
    return "selected"


def _get_available_db_ids() -> List[str]:
    ids: List[str] = []
    try:
        for item in get_all_db_configs():
            db_id = _normalize_text(item.get("id"))
            if db_id and db_id not in ids:
                ids.append(db_id)
    except Exception:
        pass
    default_db_id = _normalize_text(config.database.database)
    if default_db_id and default_db_id not in ids:
        ids.append(default_db_id)
    return ids


def _get_database_name_map() -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    try:
        for item in get_all_db_configs():
            db_id = _normalize_text(item.get("id"))
            if not db_id:
                continue
            mapping[db_id] = _normalize_text(item.get("name")) or db_id
    except Exception:
        pass
    default_db_id = _normalize_text(config.database.database)
    if default_db_id and default_db_id not in mapping:
        mapping[default_db_id] = default_db_id
    return mapping


def _get_accessible_db_ids(current_user: User) -> List[str]:
    all_db_ids = _get_available_db_ids()
    assigned_database = _normalize_text(getattr(current_user, "assigned_database", ""))
    if not assigned_database:
        assigned_database = _normalize_text(
            user_db_selection_service.get_assigned_database(getattr(current_user, "telegram_id", None))
        )
    is_admin = _normalize_text(getattr(current_user, "role", "")).lower() == "admin"
    if assigned_database and not is_admin:
        return [assigned_database]
    return all_db_ids


def _resolve_network_link(
    conn: Optional[sqlite3.Connection],
    mac_address: str,
    ip_list: List[str],
) -> Optional[Dict[str, Any]]:
    if conn is None:
        return None

    normalized_mac = _normalize_mac(mac_address)
    normalized_ips = _dedupe_strings(ip_list)
    conditions: List[str] = []
    params: List[Any] = []

    if normalized_mac:
        conditions.append(
            "UPPER(REPLACE(REPLACE(COALESCE(ns.mac_address, p.endpoint_mac_raw, ''), ':', ''), '-', '')) = ?"
        )
        params.append(normalized_mac)

    for ip in normalized_ips:
        conditions.append("COALESCE(p.endpoint_ip_raw, '') LIKE ?")
        params.append(f"%{ip}%")

    if not conditions:
        return None

    mac_case_expr = "1"
    if normalized_mac:
        mac_case_expr = (
            "CASE WHEN UPPER(REPLACE(REPLACE(COALESCE(ns.mac_address, p.endpoint_mac_raw, ''), ':', ''), '-', '')) = ? "
            "THEN 0 ELSE 1 END"
        )
        params.append(normalized_mac)

    query = f"""
        SELECT
            b.id as branch_id,
            b.name as branch_name,
            s.name as site_name,
            d.device_code,
            d.model as device_model,
            p.port_name,
            COALESCE(ns.socket_code, p.patch_panel_port) as socket_code,
            p.endpoint_ip_raw,
            COALESCE(ns.mac_address, p.endpoint_mac_raw) as endpoint_mac_raw
        FROM network_ports p
        JOIN network_devices d ON d.id = p.device_id
        LEFT JOIN network_branches b ON b.id = d.branch_id
        LEFT JOIN network_sites s ON s.id = d.site_id
        LEFT JOIN network_sockets ns ON ns.port_id = p.id
        WHERE {' OR '.join(conditions)}
        ORDER BY {mac_case_expr}, p.is_occupied DESC, p.updated_at DESC
        LIMIT 1
    """

    try:
        row = conn.execute(query, params).fetchone()
    except Exception:
        return None

    if row is not None:
        return _network_link_payload(row)

    # Fallback for rows where multiple MAC addresses are stored in one endpoint_mac_raw cell.
    if normalized_mac:
        try:
            fallback_rows = conn.execute(
                """
                SELECT
                    b.id as branch_id,
                    b.name as branch_name,
                    s.name as site_name,
                    d.device_code,
                    d.model as device_model,
                    p.port_name,
                    COALESCE(ns.socket_code, p.patch_panel_port) as socket_code,
                    p.endpoint_ip_raw,
                    COALESCE(ns.mac_address, p.endpoint_mac_raw) as endpoint_mac_raw,
                    ns.mac_address as socket_mac_raw,
                    p.endpoint_mac_raw as port_mac_raw
                FROM network_ports p
                JOIN network_devices d ON d.id = p.device_id
                LEFT JOIN network_branches b ON b.id = d.branch_id
                LEFT JOIN network_sites s ON s.id = d.site_id
                LEFT JOIN network_sockets ns ON ns.port_id = p.id
                WHERE COALESCE(ns.mac_address, '') <> '' OR COALESCE(p.endpoint_mac_raw, '') <> ''
                ORDER BY p.is_occupied DESC, p.updated_at DESC
                LIMIT 4000
                """
            ).fetchall()
        except Exception:
            fallback_rows = []

        for candidate in fallback_rows:
            mac_tokens = _extract_mac_candidates(candidate["socket_mac_raw"]) + _extract_mac_candidates(candidate["port_mac_raw"])
            if normalized_mac in mac_tokens:
                return _network_link_payload(candidate)

    return None


def _load_network_lookup_index(conn: Optional[Any]) -> Optional[Dict[str, Dict[str, Dict[str, Any]]]]:
    if conn is None:
        return None
    try:
        rows = conn.execute(
            """
            SELECT
                b.id as branch_id,
                b.name as branch_name,
                s.name as site_name,
                d.device_code,
                d.model as device_model,
                p.port_name,
                COALESCE(ns.socket_code, p.patch_panel_port) as socket_code,
                p.endpoint_ip_raw,
                COALESCE(ns.mac_address, p.endpoint_mac_raw) as endpoint_mac_raw,
                ns.mac_address as socket_mac_raw,
                p.endpoint_mac_raw as port_mac_raw
            FROM network_ports p
            JOIN network_devices d ON d.id = p.device_id
            LEFT JOIN network_branches b ON b.id = d.branch_id
            LEFT JOIN network_sites s ON s.id = d.site_id
            LEFT JOIN network_sockets ns ON ns.port_id = p.id
            WHERE COALESCE(ns.mac_address, '') <> ''
               OR COALESCE(p.endpoint_mac_raw, '') <> ''
               OR COALESCE(p.endpoint_ip_raw, '') <> ''
            ORDER BY p.is_occupied DESC, p.updated_at DESC
            LIMIT 4000
            """
        ).fetchall()
    except Exception:
        return None

    by_mac: Dict[str, Dict[str, Any]] = {}
    by_ip: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        payload = _network_link_payload(row)
        mac_values = (
            _extract_mac_candidates(row["socket_mac_raw"])
            + _extract_mac_candidates(row["port_mac_raw"])
            + _extract_mac_candidates(row["endpoint_mac_raw"])
        )
        for mac in mac_values:
            by_mac.setdefault(mac, payload)
        for ip in _extract_ipv4_candidates(row["endpoint_ip_raw"]):
            by_ip.setdefault(ip, payload)
    return {"mac": by_mac, "ip": by_ip}


def _resolve_network_link_from_index(
    network_index: Optional[Dict[str, Dict[str, Dict[str, Any]]]],
    *,
    mac_address: str,
    ip_list: List[str],
) -> Optional[Dict[str, Any]]:
    if not isinstance(network_index, dict):
        return None
    normalized_mac = _normalize_mac(mac_address)
    if normalized_mac:
        match = (network_index.get("mac") or {}).get(normalized_mac)
        if isinstance(match, dict):
            return match
    for ip in _dedupe_strings(ip_list):
        match = (network_index.get("ip") or {}).get(ip)
        if isinstance(match, dict):
            return match
    return None


def _parse_computer_search_fields(raw: Any) -> set[str]:
    if raw is None:
        return set(COMPUTER_SEARCH_DEFAULT_FIELDS)
    if isinstance(raw, (list, tuple, set)):
        tokens = []
        for item in raw:
            tokens.extend(str(item or "").split(","))
    else:
        tokens = str(raw or "").split(",")
    fields = {item.strip().lower() for item in tokens if item and item.strip()}
    fields = {item for item in fields if item in COMPUTER_SEARCH_FIELDS}
    return fields or set(COMPUTER_SEARCH_DEFAULT_FIELDS)


def _profile_search_text(item: Dict[str, Any]) -> str:
    raw_sizes = item.get("user_profile_sizes") if isinstance(item.get("user_profile_sizes"), dict) else {}
    raw_profiles = raw_sizes.get("profiles") if isinstance(raw_sizes.get("profiles"), list) else []
    parts: list[str] = []
    for profile in raw_profiles:
        if not isinstance(profile, dict):
            continue
        parts.extend(
            [
                _normalize_text(profile.get("user_name") or profile.get("userName")),
                _normalize_text(profile.get("profile_path") or profile.get("profilePath")),
            ]
        )
        folders = profile.get("top_level_folders") or profile.get("topLevelFolders")
        if isinstance(folders, list):
            for folder in folders:
                if isinstance(folder, dict):
                    parts.append(_normalize_text(folder.get("name")))
                    parts.append(_normalize_text(folder.get("path")))
    return " ".join(parts)


def _outlook_search_text(item: Dict[str, Any]) -> str:
    outlook = item.get("outlook") if isinstance(item.get("outlook"), dict) else {}
    parts = [
        _normalize_text(item.get("outlook_active_path")),
        _normalize_text(item.get("outlook_status")),
        _normalize_text(outlook.get("largest_file_path")),
    ]
    for key in ("active_store", "active_candidate"):
        row = outlook.get(key) if isinstance(outlook.get(key), dict) else {}
        parts.append(_normalize_text(row.get("path")))
        parts.append(_normalize_text(row.get("type")))
    for key in ("active_stores", "archives"):
        rows = outlook.get(key) if isinstance(outlook.get(key), list) else []
        for row in rows:
            if isinstance(row, dict):
                parts.append(_normalize_text(row.get("path")))
                parts.append(_normalize_text(row.get("type")))
    return " ".join(parts)


def _record_search_text(item: Dict[str, Any], search_fields: set[str]) -> str:
    network_link = item.get("network_link") if isinstance(item.get("network_link"), dict) else {}
    parts: list[str] = []
    if "identity" in search_fields:
        parts.extend(
            [
                _normalize_text(item.get("hostname")),
                _normalize_text(item.get("mac_address")),
                _normalize_text(item.get("ip_primary")),
                " ".join(_dedupe_strings(item.get("ip_list") if isinstance(item.get("ip_list"), list) else [])),
            ]
        )
    if "user" in search_fields:
        parts.extend(
            [
                _normalize_text(item.get("user_full_name")),
                _normalize_text(item.get("user_login")),
                _normalize_text(item.get("current_user")),
            ]
        )
    if "profiles" in search_fields:
        parts.append(_profile_search_text(item))
    if "outlook" in search_fields:
        parts.append(_outlook_search_text(item))
    if "network" in search_fields:
        parts.extend(
            [
                _normalize_text(network_link.get("device_code")),
                _normalize_text(network_link.get("port_name")),
                _normalize_text(network_link.get("socket_code")),
                _normalize_text(network_link.get("site_name")),
                _normalize_text(network_link.get("endpoint_ip_raw")),
                _normalize_text(network_link.get("endpoint_mac_raw")),
            ]
        )
    if "location" in search_fields:
        parts.extend(
            [
                _normalize_text(item.get("branch_name")),
                _normalize_text(item.get("location_name")),
            ]
        )
    if "database" in search_fields:
        parts.extend(
            [
                _normalize_text(item.get("database_name")),
                _normalize_text(item.get("database_id")),
            ]
        )
    return " ".join(parts).lower()


def _apply_search_filter(records: List[Dict[str, Any]], query_text: str, search_fields: Optional[set[str]] = None) -> List[Dict[str, Any]]:
    needle = _normalize_text(query_text).lower()
    if not needle:
        return records
    fields = search_fields or set(COMPUTER_SEARCH_DEFAULT_FIELDS)
    return [item for item in records if needle in _record_search_text(item, fields)]


def _resolve_computer_db_candidates(
    *,
    current_user: User,
    db_id_selected: Optional[str],
    scope: str,
) -> List[str]:
    requested_scope = _normalize_scope(scope)
    if requested_scope == "all":
        ensure_user_permission(current_user, PERM_COMPUTERS_READ_ALL)

    accessible_db_ids = _get_accessible_db_ids(current_user)
    if requested_scope == "all":
        db_candidates = list(accessible_db_ids)
    else:
        selected_db = _normalize_text(db_id_selected) or _normalize_text(config.database.database)
        db_candidates = [selected_db]

    db_candidates = [_normalize_text(item) for item in db_candidates if _normalize_text(item)]
    if not db_candidates:
        fallback_db = _normalize_text(config.database.database)
        if fallback_db:
            db_candidates = [fallback_db]
    return db_candidates


def _enrich_outlook_fields_light(record: Dict[str, Any]) -> None:
    outlook = _normalize_outlook_payload(record.get("outlook"))
    active_store = outlook.get("active_store") if isinstance(outlook.get("active_store"), dict) else None
    active_stores = outlook.get("active_stores") if isinstance(outlook.get("active_stores"), list) else []
    archives = outlook.get("archives") if isinstance(outlook.get("archives"), list) else []
    active_size_bytes = max(0, _to_int((active_store or {}).get("size_bytes"), 0))
    if active_stores:
        active_size_bytes = max(
            active_size_bytes,
            max(max(0, _to_int(row.get("size_bytes"), 0)) for row in active_stores if isinstance(row, dict)),
        )
    record["outlook_status"] = _normalize_text(outlook.get("status")).lower() or "unknown"
    record["outlook_confidence"] = _normalize_text(outlook.get("confidence")).lower() or "low"
    record["outlook_active_size_bytes"] = max(0, _to_int(record.get("outlook_active_size_bytes"), active_size_bytes))
    record["outlook_active_path"] = _normalize_text(record.get("outlook_active_path") or (active_store or {}).get("path"))
    record["outlook_active_stores_count"] = len([row for row in active_stores if isinstance(row, dict)])
    record["outlook_total_size_bytes"] = max(0, _to_int(record.get("outlook_total_size_bytes") or outlook.get("total_outlook_size_bytes"), 0))
    record["outlook_archives_count"] = len([row for row in archives if isinstance(row, dict)])


def _trim_computer_list_record(
    record: Dict[str, Any],
    *,
    include_profile_rows: bool = False,
) -> Dict[str, Any]:
    outlook_raw = record.get("outlook") if isinstance(record.get("outlook"), dict) else {}
    profile_sizes = record.get("user_profile_sizes") if isinstance(record.get("user_profile_sizes"), dict) else {}
    storage_rows = record.get("storage") if isinstance(record.get("storage"), list) else []
    logical_disks = record.get("logical_disks") if isinstance(record.get("logical_disks"), list) else []
    network_raw = record.get("network") if isinstance(record.get("network"), dict) else {}
    problem_storage = 0
    slim_storage: List[Dict[str, Any]] = []
    for disk in storage_rows:
        if not isinstance(disk, dict):
            continue
        status_text = _normalize_text(disk.get("health_status")).lower()
        if any(token in status_text for token in ("warning", "critical", "fail", "degrad", "unhealthy")):
            problem_storage += 1
        slim_storage.append(
            {
                "name": disk.get("name") or disk.get("model") or disk.get("device"),
                "health_status": disk.get("health_status"),
                "size_gb": disk.get("size_gb"),
                "media_type": disk.get("media_type"),
            }
        )
    slim_logical: List[Dict[str, Any]] = []
    for disk in logical_disks:
        if not isinstance(disk, dict):
            continue
        slim_logical.append(
            {
                "mountpoint": disk.get("mountpoint") or disk.get("device"),
                "device": disk.get("device"),
                "fstype": disk.get("fstype"),
                "total_gb": disk.get("total_gb") or disk.get("size_gb"),
                "free_gb": disk.get("free_gb"),
                "used_percent": disk.get("used_percent") or disk.get("percent"),
                "percent": disk.get("percent") or disk.get("used_percent"),
            }
        )
    network_link = record.get("network_link") if isinstance(record.get("network_link"), dict) else None
    active_store = outlook_raw.get("active_store") if isinstance(outlook_raw.get("active_store"), dict) else None
    trimmed = {
        "mac_address": record.get("mac_address"),
        "hostname": record.get("hostname"),
        "status": record.get("status"),
        "age_seconds": record.get("age_seconds"),
        "last_seen_at": record.get("last_seen_at"),
        "timestamp": record.get("timestamp"),
        "ip_primary": record.get("ip_primary"),
        "ip_list": record.get("ip_list") if isinstance(record.get("ip_list"), list) else [],
        "user_login": record.get("user_login"),
        "user_full_name": record.get("user_full_name"),
        "current_user": record.get("current_user"),
        "branch_name": record.get("branch_name"),
        "location_name": record.get("location_name"),
        "database_id": record.get("database_id"),
        "database_name": record.get("database_name"),
        "inventory_inv_no": record.get("inventory_inv_no"),
        "inventory_model_name": record.get("inventory_model_name"),
        "is_unassigned": record.get("is_unassigned"),
        "assignment_source": record.get("assignment_source"),
        "branch_source": record.get("branch_source"),
        "has_hardware_changes": record.get("has_hardware_changes"),
        "changes_count_30d": record.get("changes_count_30d"),
        "last_change_at": record.get("last_change_at"),
        "cpu_model": record.get("cpu_model"),
        "cpu_load_percent": record.get("cpu_load_percent"),
        "ram_gb": record.get("ram_gb"),
        "ram_used_percent": record.get("ram_used_percent"),
        "uptime_seconds": record.get("uptime_seconds"),
        "last_reboot_at": record.get("last_reboot_at"),
        "outlook_status": record.get("outlook_status"),
        "outlook_confidence": record.get("outlook_confidence"),
        "outlook_active_size_bytes": record.get("outlook_active_size_bytes"),
        "outlook_active_path": record.get("outlook_active_path"),
        "outlook_active_stores_count": record.get("outlook_active_stores_count"),
        "outlook_total_size_bytes": record.get("outlook_total_size_bytes"),
        "outlook_archives_count": record.get("outlook_archives_count"),
        "storage_problem_count": problem_storage,
        "storage": slim_storage,
        "logical_disks": slim_logical,
        "network_link": network_link,
        "network": {"active_ipv4": network_raw.get("active_ipv4")},
        "outlook": {
            "status": record.get("outlook_status"),
            "confidence": record.get("outlook_confidence"),
            "active_store": active_store,
            "total_outlook_size_bytes": record.get("outlook_total_size_bytes"),
        },
        "is_hidden": bool(record.get("is_hidden") or record.get("hidden_at")),
        "hidden_at": record.get("hidden_at"),
        "hidden_by": record.get("hidden_by"),
        "hidden_reason": record.get("hidden_reason"),
    }
    if include_profile_rows:
        trimmed["user_profile_sizes"] = profile_sizes
    else:
        trimmed["user_profile_sizes"] = {
            "collected_at": profile_sizes.get("collected_at"),
            "profiles_count": profile_sizes.get("profiles_count") or record.get("user_profile_sizes_profiles_count"),
            "total_size_bytes": profile_sizes.get("total_size_bytes") or record.get("user_profile_sizes_total_bytes"),
            "partial": profile_sizes.get("partial") or record.get("user_profile_sizes_partial"),
        }
    return trimmed


def _is_rfc1918_172(ip_text: str) -> bool:
    text = _normalize_text(ip_text)
    if not text or ":" in text:
        return False
    parts = text.split(".")
    if len(parts) != 4:
        return False
    try:
        octets = [int(part) for part in parts]
    except Exception:
        return False
    if any(octet < 0 or octet > 255 for octet in octets):
        return False
    # 172.16.0.0/12
    return octets[0] == 172 and 16 <= octets[1] <= 31


def _is_vm_only_172_host(record: Dict[str, Any]) -> bool:
    """True when host has IPv4 and every address is in 172.16.0.0/12 (typical Hyper-V guest)."""
    ip_list = record.get("ip_list") if isinstance(record.get("ip_list"), list) else []
    candidates = [_normalize_text(item) for item in ip_list if _normalize_text(item)]
    if not candidates:
        primary = _normalize_text(record.get("ip_primary"))
        if primary:
            candidates = [primary]
    ipv4 = [item for item in candidates if item and ":" not in item and item != "127.0.0.1"]
    if not ipv4:
        return False
    return all(_is_rfc1918_172(item) for item in ipv4)


def _heavy_enrich_computer_records(
    records: List[Dict[str, Any]],
    *,
    changes_index: Dict[str, Dict[str, Any]],
    attach_network: Any,
    include_profile_rows: bool = False,
) -> None:
    for record in records:
        _enrich_outlook_fields(record)
        _enrich_user_profile_size_fields(record)
        change_key = _event_host_key(_normalize_text(record.get("mac_address")), _normalize_text(record.get("hostname")))
        change_meta = changes_index.get(change_key, {})
        record["recent_changes"] = change_meta.get("recent_changes") or []
    attach_network(records)
    for index, record in enumerate(records):
        records[index] = _trim_computer_list_record(
            record,
            include_profile_rows=include_profile_rows,
        )


def _search_network_mac_keys(
    network_index: Optional[Dict[str, Dict[str, Dict[str, Any]]]],
    query_text: str,
) -> set[str]:
    needle = _normalize_text(query_text).lower()
    if not needle or not isinstance(network_index, dict):
        return set()
    result: set[str] = set()
    for mac_key, payload in (network_index.get("mac") or {}).items():
        if not isinstance(payload, dict):
            continue
        haystack = " ".join(
            [
                _normalize_text(payload.get("device_code")),
                _normalize_text(payload.get("port_name")),
                _normalize_text(payload.get("socket_code")),
                _normalize_text(payload.get("site_name")),
                _normalize_text(payload.get("endpoint_ip_raw")),
                _normalize_text(payload.get("endpoint_mac_raw")),
            ]
        ).lower()
        if needle in haystack:
            normalized = _normalize_mac(mac_key) or _normalize_text(mac_key)
            if normalized:
                result.add(normalized)
    return result


def _computer_sort_key(item: Dict[str, Any], normalized_sort_by: str) -> Any:
    if normalized_sort_by in {
        "age",
        "age_seconds",
        "last_seen_at",
        "last_change_at",
        "changes_count_30d",
        "outlook_active_size_bytes",
        "outlook_total_size_bytes",
        "outlook_archives_count",
    }:
        return _to_int(item.get(normalized_sort_by), default=0)
    if normalized_sort_by == "status":
        order = {"online": 0, "stale": 1, "offline": 2, "unknown": 3}
        return order.get(_normalize_text(item.get("status")).lower(), 9)
    if normalized_sort_by == "outlook_status":
        order = {"critical": 0, "warning": 1, "unknown": 2, "ok": 3}
        return order.get(_normalize_text(item.get("outlook_status")).lower(), 9)
    if normalized_sort_by == "branch":
        return _normalize_text(item.get("branch_name")).lower()
    if normalized_sort_by == "user":
        return (
            _normalize_text(item.get("user_full_name")).lower(),
            _normalize_text(item.get("user_login")).lower(),
        )
    return _normalize_text(item.get(normalized_sort_by)).lower()


def _resolve_scoped_host_keys(
    *,
    app_store: Optional[AppInventoryStore],
    q: Optional[str],
    fields: set[str],
) -> Optional[set[str]]:
    needle = _normalize_text(q).lower()
    if not needle or app_store is None or fields & COMPUTER_SEARCH_DYNAMIC_FIELDS:
        return None
    try:
        return app_store.search_host_keys(needle, fields, db_ids=None)
    except Exception as exc:
        logger.debug("Inventory indexed host search skipped: %s", exc)
        return None


def _collect_scoped_computer_records(
    *,
    current_user: User,
    db_id_selected: Optional[str],
    scope: str,
    branch: Optional[str],
    status_filter: Optional[str],
    outlook_status: Optional[str],
    q: Optional[str],
    search_fields: Any = None,
    sort_by: str = "hostname",
    sort_dir: str = "asc",
    changed_only: bool = False,
    include_hidden: bool = False,
    hidden_only: bool = False,
    hide_vm_172: bool = False,
) -> List[Dict[str, Any]]:
    fields = _parse_computer_search_fields(search_fields)
    app_store = _get_inventory_app_store()
    requested_scope = _normalize_scope(scope)
    db_candidates = _resolve_computer_db_candidates(
        current_user=current_user,
        db_id_selected=db_id_selected,
        scope=scope,
    )

    scoped_keys = _resolve_scoped_host_keys(
        app_store=app_store,
        q=q,
        fields=fields,
    )
    if scoped_keys is not None and len(scoped_keys) == 0:
        return []

    current_data = _load_inventory_snapshot(
        host_keys=scoped_keys,
        include_hidden=include_hidden or hidden_only,
        hidden_only=hidden_only,
    )
    if not isinstance(current_data, dict):
        current_data = {}

    now_ts = int(time.time())
    changes = _prune_old_changes(_load_changes(), now_ts)
    changes_index = _build_changes_index(changes, now_ts)
    database_name_map = _get_database_name_map()

    sql_cache: Dict[str, Optional[Dict[str, Any]]] = {}
    prefetched_sql_contexts: Dict[tuple[str, str, str], Dict[str, Any]] = {}
    context_db_ids = list(db_candidates)
    if app_store is not None and requested_scope == "selected":
        for database_id in _get_accessible_db_ids(current_user):
            normalized_database_id = _normalize_text(database_id)
            if normalized_database_id and normalized_database_id not in context_db_ids:
                context_db_ids.append(normalized_database_id)
    if app_store is not None and current_data and context_db_ids:
        try:
            prefetched_sql_contexts = app_store.list_sql_contexts(
                hosts=[item for item in current_data.values() if isinstance(item, dict)],
                db_ids=context_db_ids,
            )
        except Exception as exc:
            logger.debug("Inventory SQL context prefetch skipped: %s", exc)
            prefetched_sql_contexts = {}
    allow_sync_context_resolution = app_store is None or (
        not prefetched_sql_contexts and len(current_data) <= 10
    )

    def _get_prefetched_sql_context(mac_address: str, hostname: str, db_id: str) -> Optional[Dict[str, Any]]:
        normalized_mac = _normalize_mac(mac_address)
        normalized_hostname = _normalize_text(hostname).lower()
        normalized_db_id = _normalize_text(db_id)
        for key in (
            (normalized_mac, normalized_hostname, normalized_db_id),
            (normalized_mac, "", normalized_db_id),
            ("", normalized_hostname, normalized_db_id),
        ):
            cached_context = prefetched_sql_contexts.get(key)
            if isinstance(cached_context, dict):
                return dict(cached_context)
        return None

    records: List[Dict[str, Any]] = []
    try:
        for item in current_data.values():
            if not isinstance(item, dict):
                continue

            record = _enrich_status(item, now_ts)
            _ensure_identity_fields(record)
            _ensure_runtime_fields(record)
            _enrich_outlook_fields_light(record)

            mac_address = _normalize_text(record.get("mac_address"))
            hostname = _normalize_text(record.get("hostname"))
            cache_key = f"{_normalize_mac(mac_address)}|{hostname.lower()}|{','.join(context_db_ids)}"
            if cache_key not in sql_cache:
                selected_context: Optional[Dict[str, Any]] = None
                any_context: Optional[Dict[str, Any]] = None
                for candidate_db in context_db_ids:
                    context = _get_prefetched_sql_context(mac_address, hostname, candidate_db)
                    if not isinstance(context, dict) and allow_sync_context_resolution:
                        context = _resolve_sql_context_cached(app_store, mac_address, hostname, candidate_db)
                    if not isinstance(context, dict):
                        continue
                    enriched_context = dict(context)
                    enriched_context["database_id"] = candidate_db
                    enriched_context["database_name"] = database_name_map.get(candidate_db, candidate_db)
                    enriched_context["assignment_source"] = "sql"
                    if any_context is None:
                        any_context = enriched_context
                    if candidate_db in db_candidates and selected_context is None:
                        selected_context = enriched_context

                resolved_context = any_context if requested_scope == "all" else selected_context
                assigned_elsewhere = requested_scope == "selected" and selected_context is None and any_context is not None
                network_scope = _resolve_inventory_network_scope(record)
                if resolved_context is None and not assigned_elsewhere and isinstance(network_scope, dict):
                    network_database_id = _normalize_text(network_scope.get("database_id"))
                    if requested_scope == "all" or network_database_id in db_candidates:
                        resolved_context = {
                            "branch_name": _normalize_text(network_scope.get("branch_name")),
                            "ip_address": _normalize_text(network_scope.get("ip_address")),
                            "database_id": network_database_id,
                            "database_name": database_name_map.get(network_database_id, network_database_id),
                            "assignment_source": "network_scope",
                        }
                    else:
                        assigned_elsewhere = True

                if assigned_elsewhere or (resolved_context is None and app_store is None):
                    sql_cache[cache_key] = {"_excluded": True}
                else:
                    sql_cache[cache_key] = resolved_context

            sql_context = sql_cache.get(cache_key)
            if isinstance(sql_context, dict) and sql_context.get("_excluded"):
                continue

            if isinstance(sql_context, dict):
                assignment_source = _normalize_text(sql_context.get("assignment_source")) or "sql"
                record["branch_no"] = sql_context.get("branch_no")
                record["branch_name"] = _normalize_text(sql_context.get("branch_name"))
                record["location_name"] = _normalize_text(sql_context.get("location_name"))
                record["branch_source"] = assignment_source
                record["assignment_source"] = assignment_source
                record["is_unassigned"] = False
                record["inventory_inv_no"] = _normalize_text(sql_context.get("inv_no"))
                record["inventory_model_name"] = _normalize_text(sql_context.get("model_name"))
                record["database_id"] = _normalize_text(sql_context.get("database_id"))
                record["database_name"] = _normalize_text(sql_context.get("database_name")) or record["database_id"]
                if not record.get("user_full_name"):
                    record["user_full_name"] = _normalize_person_name(sql_context.get("employee_name"))
            else:
                record["branch_no"] = None
                record["branch_name"] = "Без привязки"
                record["location_name"] = ""
                record["branch_source"] = "unassigned"
                record["assignment_source"] = "unassigned"
                record["is_unassigned"] = True
                record["inventory_inv_no"] = ""
                record["inventory_model_name"] = ""
                record["database_id"] = ""
                record["database_name"] = "Без привязки"

            ip_primary = _normalize_text(record.get("ip_primary"))
            ip_list = record.get("ip_list") if isinstance(record.get("ip_list"), list) else []
            if not ip_primary and isinstance(sql_context, dict):
                ip_primary = _extract_first_ipv4(sql_context.get("ip_address"))
            if ip_primary and ip_primary not in ip_list:
                ip_list = [ip_primary] + [item for item in ip_list if _normalize_text(item) and _normalize_text(item) != ip_primary]
            record["ip_primary"] = ip_primary
            record["ip_list"] = _dedupe_strings(ip_list)

            change_key = _event_host_key(mac_address, hostname)
            change_meta = changes_index.get(change_key, {})
            record["last_change_at"] = change_meta.get("last_change_at")
            record["changes_count_30d"] = int(change_meta.get("changes_count_30d") or 0)
            record["has_hardware_changes"] = record["changes_count_30d"] > 0
            record.pop("_hardware_signature", None)
            records.append(record)
    finally:
        pass

    if branch:
        branch_value = _normalize_text(branch).lower()
        records = [item for item in records if _normalize_text(item.get("branch_name")).lower() == branch_value]

    if status_filter:
        target_status = _normalize_text(status_filter).lower()
        records = [item for item in records if _normalize_text(item.get("status")).lower() == target_status]

    if outlook_status:
        target_outlook_status = _normalize_text(outlook_status).lower()
        if target_outlook_status in OUTLOOK_ALLOWED_STATUS:
            records = [item for item in records if _normalize_text(item.get("outlook_status")).lower() == target_outlook_status]

    if changed_only:
        records = [item for item in records if bool(item.get("has_hardware_changes"))]

    if hide_vm_172:
        records = [item for item in records if not _is_vm_only_172_host(item)]

    if _normalize_text(q) and "network" not in fields:
        records = _apply_search_filter(records, q, fields)

    normalized_sort_by = _normalize_text(sort_by).lower() or "hostname"
    reverse = _normalize_text(sort_dir).lower() == "desc"
    records.sort(key=lambda item: _computer_sort_key(item, normalized_sort_by), reverse=reverse)
    return records


def _computer_summary(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    status_counts = {"online": 0, "stale": 0, "offline": 0, "unknown": 0}
    branch_counts: Dict[str, int] = {}
    outlook_counts = {"ok": 0, "warning": 0, "critical": 0, "unknown": 0}
    unassigned_count = 0
    for item in records:
        status_key = _normalize_text(item.get("status")).lower() or "unknown"
        if status_key not in status_counts:
            status_key = "unknown"
        status_counts[status_key] += 1
        branch_name = _normalize_text(item.get("branch_name")) or "Без филиала"
        branch_counts[branch_name] = branch_counts.get(branch_name, 0) + 1
        outlook_key = _normalize_text(item.get("outlook_status")).lower() or "unknown"
        if outlook_key not in outlook_counts:
            outlook_key = "unknown"
        outlook_counts[outlook_key] += 1
        if bool(item.get("is_unassigned")):
            unassigned_count += 1
    return {
        "total": len(records),
        "unassigned": unassigned_count,
        "statuses": status_counts,
        "branches": branch_counts,
        "outlook": outlook_counts,
    }


@router.post("")
def receive_inventory(
    payload: InventoryPayload,
    x_api_key: Optional[str] = Header(None),
):
    """
    Receive inventory data from PC agents.
    """
    if not _is_valid_agent_api_key(x_api_key):
        logger.warning("Inventory rejected unknown agent key fingerprint=%s", _api_key_fingerprint(x_api_key))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API Key",
        )

    inventory_runtime.configure_runtime_hooks(
        is_app_database_configured=is_app_database_configured,
        get_app_database_url=get_app_database_url,
        ensure_app_schema_initialized=ensure_app_schema_initialized,
        AppInventoryStore=AppInventoryStore,
        get_local_store=get_local_store,
    )
    try:
        return inventory_runtime.process_inventory_payload(_model_dump(payload))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc


@router.get("/changes")
def get_inventory_changes(
    limit: int = Query(50, ge=1, le=200),
):
    now_ts = int(time.time())
    changes = _prune_old_changes(_load_changes(), now_ts)
    sorted_changes = sorted(changes, key=lambda item: _to_int(item.get("detected_at"), 0), reverse=True)

    def _unique_hosts_since(seconds_back: int) -> int:
        threshold = now_ts - seconds_back
        keys = {
            _event_host_key(_normalize_text(item.get("mac_address")), _normalize_text(item.get("hostname")))
            for item in sorted_changes
            if _to_int(item.get("detected_at"), 0) >= threshold
        }
        return len(keys)

    daily_map: Dict[str, int] = {}
    for item in sorted_changes:
        ts = _to_int(item.get("detected_at"), 0)
        if ts <= 0:
            continue
        if ts < now_ts - CHANGES_WINDOW_DAYS * 24 * 60 * 60:
            continue
        day_key = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
        daily_map[day_key] = daily_map.get(day_key, 0) + 1

    daily_rows: List[Dict[str, Any]] = []
    start_day = datetime.fromtimestamp(now_ts, tz=timezone.utc).date() - timedelta(days=CHANGES_WINDOW_DAYS - 1)
    for offset in range(CHANGES_WINDOW_DAYS):
        current_day = start_day + timedelta(days=offset)
        day_key = current_day.strftime("%Y-%m-%d")
        daily_rows.append({"date": day_key, "count": int(daily_map.get(day_key, 0))})

    return {
        "totals": {
            "changed_24h": _unique_hosts_since(24 * 60 * 60),
            "changed_7d": _unique_hosts_since(7 * 24 * 60 * 60),
            "changed_30d": _unique_hosts_since(30 * 24 * 60 * 60),
        },
        "daily": daily_rows,
        "latest_events": sorted_changes[: int(limit)],
    }


def _build_computers_search_payload(
    *,
    current_user: User,
    db_id_selected: Optional[str],
    scope: str,
    branch: Optional[str],
    status_filter: Optional[str],
    outlook_status: Optional[str],
    q: Optional[str],
    search_fields: Any = None,
    sort_by: str = "hostname",
    sort_dir: str = "asc",
    changed_only: bool = False,
    include_hidden: bool = False,
    hidden_only: bool = False,
    hide_vm_172: bool = False,
    limit: Optional[int] = None,
    offset: int = 0,
    include_summary: bool = False,
) -> Dict[str, Any]:
    fields = _parse_computer_search_fields(search_fields)
    records = _collect_scoped_computer_records(
        current_user=current_user,
        db_id_selected=db_id_selected,
        scope=scope,
        branch=branch,
        status_filter=status_filter,
        outlook_status=outlook_status,
        q=q,
        search_fields=search_fields,
        sort_by=sort_by,
        sort_dir=sort_dir,
        changed_only=changed_only,
        include_hidden=include_hidden,
        hidden_only=hidden_only,
        hide_vm_172=hide_vm_172,
    )

    needle = _normalize_text(q).lower()
    if needle and "network" in fields:
        network_cache: Dict[str, Optional[Dict[str, Any]]] = {}
        network_conn: Optional[Any] = None
        network_index: Optional[Dict[str, Dict[str, Dict[str, Any]]]] = None

        def _attach_network_fields(items: List[Dict[str, Any]]) -> None:
            nonlocal network_conn, network_index
            if not items:
                return
            if network_conn is None:
                try:
                    network_conn = _open_network_lookup_connection()
                except Exception:
                    network_conn = None
            if network_index is None and network_conn is not None:
                network_index = _load_network_lookup_index(network_conn)
            for record in items:
                mac_address = _normalize_text(record.get("mac_address"))
                record_ip_list = record.get("ip_list") if isinstance(record.get("ip_list"), list) else []
                network_key = f"{_normalize_mac(mac_address)}|{','.join(_dedupe_strings(record_ip_list))}"
                if network_key not in network_cache:
                    indexed_link = _resolve_network_link_from_index(
                        network_index,
                        mac_address=mac_address,
                        ip_list=record_ip_list,
                    )
                    if indexed_link is not None:
                        network_cache[network_key] = indexed_link
                    elif network_index is not None:
                        network_cache[network_key] = None
                    else:
                        network_cache[network_key] = _resolve_network_link(
                            network_conn,
                            mac_address=mac_address,
                            ip_list=record_ip_list,
                        )
                record["network_link"] = network_cache.get(network_key)

        try:
            _attach_network_fields(records)
            records = _apply_search_filter(records, q, fields)
        finally:
            if network_conn is not None:
                try:
                    network_conn.close()
                except Exception:
                    pass

    total = len(records)
    safe_offset = max(0, int(offset or 0))
    if limit is None:
        page_items = list(records)
        safe_limit = len(records)
    else:
        safe_limit = max(1, min(500, int(limit or 50)))
        page_items = list(records[safe_offset:safe_offset + safe_limit])

    if page_items:
        now_ts = int(time.time())
        changes = _prune_old_changes(_load_changes(), now_ts)
        changes_index = _build_changes_index(changes, now_ts)
        network_cache: Dict[str, Optional[Dict[str, Any]]] = {}
        network_conn: Optional[Any] = None
        network_index: Optional[Dict[str, Dict[str, Dict[str, Any]]]] = None

        def _attach_network_fields(items: List[Dict[str, Any]]) -> None:
            nonlocal network_conn, network_index
            if not items:
                return
            if network_conn is None:
                try:
                    network_conn = _open_network_lookup_connection()
                except Exception:
                    network_conn = None
            if network_index is None and network_conn is not None:
                network_index = _load_network_lookup_index(network_conn)
            for record in items:
                mac_address = _normalize_text(record.get("mac_address"))
                record_ip_list = record.get("ip_list") if isinstance(record.get("ip_list"), list) else []
                if "network_link" not in record:
                    network_key = f"{_normalize_mac(mac_address)}|{','.join(_dedupe_strings(record_ip_list))}"
                    if network_key not in network_cache:
                        indexed_link = _resolve_network_link_from_index(
                            network_index,
                            mac_address=mac_address,
                            ip_list=record_ip_list,
                        )
                        if indexed_link is not None:
                            network_cache[network_key] = indexed_link
                        elif network_index is not None:
                            network_cache[network_key] = None
                        else:
                            network_cache[network_key] = _resolve_network_link(
                                network_conn,
                                mac_address=mac_address,
                                ip_list=record_ip_list,
                            )
                    record["network_link"] = network_cache.get(network_key)
                ip_primary = _normalize_text(record.get("ip_primary"))
                ip_list = record.get("ip_list") if isinstance(record.get("ip_list"), list) else []
                if not ip_primary and isinstance(record.get("network_link"), dict):
                    ip_primary = _extract_first_ipv4(record["network_link"].get("endpoint_ip_raw"))
                if ip_primary and ip_primary not in ip_list:
                    ip_list = [ip_primary] + [item for item in ip_list if _normalize_text(item) and _normalize_text(item) != ip_primary]
                record["ip_primary"] = ip_primary
                record["ip_list"] = _dedupe_strings(ip_list)

        try:
            _heavy_enrich_computer_records(
                page_items,
                changes_index=changes_index,
                attach_network=_attach_network_fields,
                include_profile_rows=bool(_normalize_text(q) and "profiles" in fields),
            )
        finally:
            if network_conn is not None:
                try:
                    network_conn.close()
                except Exception:
                    pass

    next_offset = safe_offset + len(page_items)
    payload = {
        "items": page_items,
        "total": total,
        "limit": safe_limit,
        "offset": safe_offset,
        "has_more": next_offset < total,
        "next_offset": next_offset if next_offset < total else None,
    }
    if include_summary:
        payload["summary"] = _computer_summary(records)
    return payload


def _build_computer_detail_payload(
    *,
    current_user: User,
    mac_address: str,
    db_id_selected: Optional[str],
    scope: str,
) -> Dict[str, Any]:
    normalized_mac = _normalize_mac(mac_address) or _normalize_text(mac_address)
    if not normalized_mac:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Computer not found")

    requested_scope = _normalize_scope(scope)
    if requested_scope == "all":
        ensure_user_permission(current_user, PERM_COMPUTERS_READ_ALL)

    db_candidates = _resolve_computer_db_candidates(
        current_user=current_user,
        db_id_selected=db_id_selected,
        scope=scope,
    )
    app_store = _get_inventory_app_store()
    database_name_map = _get_database_name_map()

    snapshot = _load_inventory_snapshot(host_keys={normalized_mac}, include_hidden=True)
    raw = None
    for item in snapshot.values():
        if isinstance(item, dict):
            raw = item
            break
    if raw is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Computer not found")

    now_ts = int(time.time())
    record = _enrich_status(dict(raw), now_ts)
    _ensure_identity_fields(record)
    _ensure_runtime_fields(record)

    mac_value = _normalize_text(record.get("mac_address"))
    hostname = _normalize_text(record.get("hostname"))
    context_db_ids = list(db_candidates)
    if app_store is not None and requested_scope == "selected":
        for database_id in _get_accessible_db_ids(current_user):
            normalized_database_id = _normalize_text(database_id)
            if normalized_database_id and normalized_database_id not in context_db_ids:
                context_db_ids.append(normalized_database_id)

    contexts: Dict[tuple[str, str, str], Dict[str, Any]] = {}
    if app_store is not None:
        try:
            contexts = app_store.list_sql_contexts(hosts=[record], db_ids=context_db_ids)
        except Exception:
            contexts = {}

    selected_context: Optional[Dict[str, Any]] = None
    any_context: Optional[Dict[str, Any]] = None
    normalized_hostname = hostname.lower()
    normalized_mac_value = _normalize_mac(mac_value)
    for candidate_db in context_db_ids:
        context = None
        for key in (
            (normalized_mac_value, normalized_hostname, candidate_db),
            (normalized_mac_value, "", candidate_db),
            ("", normalized_hostname, candidate_db),
        ):
            if isinstance(contexts.get(key), dict):
                context = dict(contexts[key])
                break
        if not isinstance(context, dict) and app_store is None:
            context = _resolve_sql_context_cached(None, mac_value, hostname, candidate_db)
        if not isinstance(context, dict):
            continue
        context["database_id"] = candidate_db
        context["database_name"] = database_name_map.get(candidate_db, candidate_db)
        context["assignment_source"] = "sql"
        if any_context is None:
            any_context = context
        if candidate_db in db_candidates and selected_context is None:
            selected_context = context

    sql_context = any_context if requested_scope == "all" else selected_context
    assigned_elsewhere = requested_scope == "selected" and selected_context is None and any_context is not None
    network_scope = _resolve_inventory_network_scope(record)
    if sql_context is None and not assigned_elsewhere and isinstance(network_scope, dict):
        network_database_id = _normalize_text(network_scope.get("database_id"))
        if requested_scope == "all" or network_database_id in db_candidates:
            sql_context = {
                "branch_name": _normalize_text(network_scope.get("branch_name")),
                "ip_address": _normalize_text(network_scope.get("ip_address")),
                "database_id": network_database_id,
                "database_name": database_name_map.get(network_database_id, network_database_id),
                "assignment_source": "network_scope",
            }
        else:
            assigned_elsewhere = True

    if assigned_elsewhere or (sql_context is None and app_store is None):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Computer not found")

    if isinstance(sql_context, dict):
        assignment_source = _normalize_text(sql_context.get("assignment_source")) or "sql"
        record["branch_no"] = sql_context.get("branch_no")
        record["branch_name"] = _normalize_text(sql_context.get("branch_name"))
        record["location_name"] = _normalize_text(sql_context.get("location_name"))
        record["branch_source"] = assignment_source
        record["assignment_source"] = assignment_source
        record["is_unassigned"] = False
        record["inventory_inv_no"] = _normalize_text(sql_context.get("inv_no"))
        record["inventory_model_name"] = _normalize_text(sql_context.get("model_name"))
        record["database_id"] = _normalize_text(sql_context.get("database_id"))
        record["database_name"] = _normalize_text(sql_context.get("database_name")) or record["database_id"]
        if not record.get("user_full_name"):
            record["user_full_name"] = _normalize_person_name(sql_context.get("employee_name"))
    else:
        record["branch_no"] = None
        record["branch_name"] = "Без привязки"
        record["location_name"] = ""
        record["branch_source"] = "unassigned"
        record["assignment_source"] = "unassigned"
        record["is_unassigned"] = True
        record["inventory_inv_no"] = ""
        record["inventory_model_name"] = ""
        record["database_id"] = ""
        record["database_name"] = "Без привязки"

    ip_primary = _normalize_text(record.get("ip_primary"))
    ip_list = record.get("ip_list") if isinstance(record.get("ip_list"), list) else []
    if not ip_primary and isinstance(sql_context, dict):
        ip_primary = _extract_first_ipv4(sql_context.get("ip_address"))
    if ip_primary and ip_primary not in ip_list:
        ip_list = [ip_primary] + [item for item in ip_list if _normalize_text(item) and _normalize_text(item) != ip_primary]
    record["ip_primary"] = ip_primary
    record["ip_list"] = _dedupe_strings(ip_list)

    changes = _prune_old_changes(_load_changes(), now_ts)
    changes_index = _build_changes_index(changes, now_ts)
    change_key = _event_host_key(mac_value, hostname)
    change_meta = changes_index.get(change_key, {})
    record["last_change_at"] = change_meta.get("last_change_at")
    record["changes_count_30d"] = int(change_meta.get("changes_count_30d") or 0)
    record["has_hardware_changes"] = record["changes_count_30d"] > 0

    page_items = [record]
    network_cache: Dict[str, Optional[Dict[str, Any]]] = {}
    network_conn: Optional[Any] = None
    network_index: Optional[Dict[str, Dict[str, Dict[str, Any]]]] = None

    def _attach_network_fields(items: List[Dict[str, Any]]) -> None:
        nonlocal network_conn, network_index
        if network_conn is None:
            try:
                network_conn = _open_network_lookup_connection()
            except Exception:
                network_conn = None
        if network_index is None and network_conn is not None:
            network_index = _load_network_lookup_index(network_conn)
        for row in items:
            mac_item = _normalize_text(row.get("mac_address"))
            record_ip_list = row.get("ip_list") if isinstance(row.get("ip_list"), list) else []
            network_key = f"{_normalize_mac(mac_item)}|{','.join(_dedupe_strings(record_ip_list))}"
            if network_key not in network_cache:
                indexed_link = _resolve_network_link_from_index(
                    network_index,
                    mac_address=mac_item,
                    ip_list=record_ip_list,
                )
                if indexed_link is not None:
                    network_cache[network_key] = indexed_link
                elif network_index is not None:
                    network_cache[network_key] = None
                else:
                    network_cache[network_key] = _resolve_network_link(
                        network_conn,
                        mac_address=mac_item,
                        ip_list=record_ip_list,
                    )
            row["network_link"] = network_cache.get(network_key)

    try:
        for row in page_items:
            _enrich_outlook_fields(row)
            _enrich_user_profile_size_fields(row)
            row["recent_changes"] = change_meta.get("recent_changes") or []
        _attach_network_fields(page_items)
    finally:
        if network_conn is not None:
            try:
                network_conn.close()
            except Exception:
                pass
    return page_items[0]


@router.get("/computers/summary")
def get_computers_summary(
    current_user: User = Depends(require_permission(PERM_COMPUTERS_READ)),
    db_id_selected: Optional[str] = Depends(get_current_database_id),
    scope: str = Query("selected"),
    branch: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    outlook_status: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    search_fields: str = Query("", min_length=0),
    changed_only: bool = Query(False),
    include_hidden: bool = Query(False),
    hidden_only: bool = Query(False),
    hide_vm_172: bool = Query(False),
):
    """Return aggregate counts for computers matching the current filters."""
    include_hidden = _query_bool(include_hidden, False)
    hidden_only = _query_bool(hidden_only, False)
    hide_vm_172 = _query_bool(hide_vm_172, False)
    changed_only = _query_bool(changed_only, False)
    records = _collect_scoped_computer_records(
        current_user=current_user,
        db_id_selected=db_id_selected,
        scope=scope,
        branch=branch,
        status_filter=status_filter,
        outlook_status=outlook_status,
        q=q,
        search_fields=search_fields,
        changed_only=changed_only,
        include_hidden=include_hidden,
        hidden_only=hidden_only,
        hide_vm_172=hide_vm_172,
    )
    fields = _parse_computer_search_fields(search_fields)
    needle = _normalize_text(q).lower()
    if needle and "network" in fields:
        network_conn: Optional[Any] = None
        try:
            network_conn = _open_network_lookup_connection()
            network_index = _load_network_lookup_index(network_conn) if network_conn is not None else None
            network_cache: Dict[str, Optional[Dict[str, Any]]] = {}

            def _attach_network_fields(items: List[Dict[str, Any]]) -> None:
                for row in items:
                    mac_value = _normalize_text(row.get("mac_address"))
                    record_ip_list = row.get("ip_list") if isinstance(row.get("ip_list"), list) else []
                    network_key = f"{_normalize_mac(mac_value)}|{','.join(_dedupe_strings(record_ip_list))}"
                    if network_key not in network_cache:
                        network_cache[network_key] = _resolve_network_link_from_index(
                            network_index,
                            mac_address=mac_value,
                            ip_list=record_ip_list,
                        ) or _resolve_network_link(
                            network_conn,
                            mac_address=mac_value,
                            ip_list=record_ip_list,
                        )
                    row["network_link"] = network_cache.get(network_key)

            _attach_network_fields(records)
            records = _apply_search_filter(records, q, fields)
        finally:
            if network_conn is not None:
                try:
                    network_conn.close()
                except Exception:
                    pass
    return _computer_summary(records)


@router.get("/computers/search")
def search_computers(
    current_user: User = Depends(require_permission(PERM_COMPUTERS_READ)),
    db_id_selected: Optional[str] = Depends(get_current_database_id),
    scope: str = Query("selected"),
    branch: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    outlook_status: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    search_fields: str = Query("", min_length=0),
    sort_by: str = Query("hostname"),
    sort_dir: str = Query("asc"),
    changed_only: bool = Query(False),
    include_hidden: bool = Query(False),
    hidden_only: bool = Query(False),
    hide_vm_172: bool = Query(False),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    include_summary: bool = Query(False),
    mobile_safe: bool = Query(False),
):
    """Return paginated collected computers with fielded server-side search."""
    payload = _build_computers_search_payload(
        current_user=current_user,
        db_id_selected=db_id_selected,
        scope=scope,
        branch=branch,
        status_filter=status_filter,
        outlook_status=outlook_status,
        q=q,
        search_fields=search_fields,
        sort_by=sort_by,
        sort_dir=sort_dir,
        changed_only=_query_bool(changed_only, False),
        include_hidden=_query_bool(include_hidden, False),
        hidden_only=_query_bool(hidden_only, False),
        hide_vm_172=_query_bool(hide_vm_172, False),
        limit=limit,
        offset=offset,
        include_summary=_query_bool(include_summary, False),
    )
    if _query_bool(mobile_safe, False):
        payload["items"] = [
            _project_mobile_computer(item, detail=False)
            for item in payload.get("items", [])
            if isinstance(item, dict)
        ]
    return payload


@router.get("/computers")
def get_computers(
    current_user: User = Depends(require_permission(PERM_COMPUTERS_READ)),
    db_id_selected: Optional[str] = Depends(get_current_database_id),
    scope: str = Query("selected"),
    branch: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    outlook_status: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    search_fields: str = Query("", min_length=0),
    sort_by: str = Query("hostname"),
    sort_dir: str = Query("asc"),
    changed_only: bool = Query(False),
    include_hidden: bool = Query(False),
    hidden_only: bool = Query(False),
    hide_vm_172: bool = Query(False),
):
    """
    Return all collected computers from the active inventory store.
    """
    payload = _build_computers_search_payload(
        current_user=current_user,
        db_id_selected=db_id_selected,
        scope=scope,
        branch=branch,
        status_filter=status_filter,
        outlook_status=outlook_status,
        q=q,
        search_fields=search_fields,
        sort_by=sort_by,
        sort_dir=sort_dir,
        changed_only=_query_bool(changed_only, False),
        include_hidden=_query_bool(include_hidden, False),
        hidden_only=_query_bool(hidden_only, False),
        hide_vm_172=_query_bool(hide_vm_172, False),
        limit=None,
        offset=0,
        include_summary=False,
    )
    return payload["items"]


@router.get("/computers/{mac_address}")
def get_computer_detail(
    mac_address: str,
    current_user: User = Depends(require_permission(PERM_COMPUTERS_READ)),
    db_id_selected: Optional[str] = Depends(get_current_database_id),
    scope: str = Query("selected"),
    mobile_safe: bool = Query(False),
):
    """Return full inventory payload for a single computer."""
    payload = _build_computer_detail_payload(
        current_user=current_user,
        mac_address=mac_address,
        db_id_selected=db_id_selected,
        scope=scope,
    )
    if _query_bool(mobile_safe, False):
        return _project_mobile_computer(payload, detail=True)
    return payload


@router.post("/computers/{mac_address}/hide")
def hide_computer(
    mac_address: str,
    current_user: User = Depends(require_permission(PERM_COMPUTERS_MANAGE)),
    reason: Optional[str] = Query(None),
):
    """Soft-hide an inventory host for a Computers manager."""
    ensure_user_permission(current_user, PERM_COMPUTERS_MANAGE)
    app_store = _get_inventory_app_store()
    if app_store is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Inventory app database is not configured",
        )
    hidden_by = _normalize_text(getattr(current_user, "username", None) or getattr(current_user, "login", None))
    result = app_store.set_host_hidden(
        mac_address,
        hidden=True,
        hidden_by=hidden_by or None,
        hidden_reason=_normalize_text(reason) or None,
    )
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Computer not found")
    return {
        "ok": True,
        "mac_address": result.get("mac_address") or mac_address,
        "is_hidden": True,
        "hidden_at": result.get("hidden_at"),
        "hidden_by": result.get("hidden_by"),
        "hidden_reason": result.get("hidden_reason"),
    }


@router.post("/computers/{mac_address}/unhide")
def unhide_computer(
    mac_address: str,
    current_user: User = Depends(require_permission(PERM_COMPUTERS_MANAGE)),
):
    """Restore a soft-hidden inventory host to the default list."""
    ensure_user_permission(current_user, PERM_COMPUTERS_MANAGE)
    app_store = _get_inventory_app_store()
    if app_store is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Inventory app database is not configured",
        )
    result = app_store.set_host_hidden(mac_address, hidden=False)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Computer not found")
    return {
        "ok": True,
        "mac_address": result.get("mac_address") or mac_address,
        "is_hidden": False,
        "hidden_at": None,
        "hidden_by": None,
        "hidden_reason": None,
    }
