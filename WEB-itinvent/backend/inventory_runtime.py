from __future__ import annotations

import hashlib
import logging
import os
import re
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel

from backend.appdb.db import ensure_app_schema_initialized, get_app_database_url, is_app_database_configured
from backend.appdb.inventory_store import AppInventoryStore
from local_store import get_local_store

logger = logging.getLogger(__name__)


def _env_positive_int(name: str, default: int, minimum: int) -> int:
    raw = str(os.getenv(name, str(default)) or "").strip()
    try:
        return max(int(raw), int(minimum))
    except Exception:
        return max(int(default), int(minimum))


DEFAULT_AGENT_API_KEY = "gT2CfK1S-TlCsIY0gDcYtGEGaI9esB72HTfZfq666w27F_REx_ygD_HGYiGU8C-8"
INVENTORY_FILE = "agent_inventory_cache.json"
CHANGES_FILE = "agent_inventory_changes.json"
HISTORY_RETENTION_DAYS = 90
CHANGES_WINDOW_DAYS = 30

ONLINE_MAX_AGE_SECONDS = 12 * 60
STALE_MAX_AGE_SECONDS = 60 * 60
OUTLOOK_ALLOWED_STATUS = {"ok", "warning", "critical", "unknown"}
OUTLOOK_ALLOWED_CONFIDENCE = {"high", "medium", "low"}
OUTLOOK_ALLOWED_SOURCE = {"user_helper_com", "system_scan", "none"}
INVENTORY_HEARTBEAT_DEFER_WINDOW_SECONDS = _env_positive_int(
    "ITINV_INVENTORY_HEARTBEAT_DEFER_WINDOW_SECONDS",
    default=_env_positive_int(
        "ITINV_INVENTORY_HEARTBEAT_WRITE_INTERVAL_SECONDS",
        default=600,
        minimum=15,
    ),
    minimum=15,
)

_DEFAULT_KEY_WARNED = False


def configure_runtime_hooks(**overrides: Any) -> None:
    for key, value in overrides.items():
        if value is not None:
            globals()[key] = value


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
    timestamp: int


def _api_key_fingerprint(value: Optional[str]) -> str:
    raw = str(value or "").strip()
    if not raw:
        return "none"
    digest = hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()
    return digest[:12]


def _load_agent_api_keys() -> List[str]:
    global _DEFAULT_KEY_WARNED
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
    elif not keys:
        keys.append(DEFAULT_AGENT_API_KEY)
        if not _DEFAULT_KEY_WARNED:
            logger.warning(
                "Inventory API is using built-in default key fallback. Configure ITINV_AGENT_API_KEYS for explicit key management."
            )
            _DEFAULT_KEY_WARNED = True
    return keys


def _is_valid_agent_api_key(candidate: Optional[str]) -> bool:
    token = str(candidate or "").strip()
    if not token:
        return False
    return token in _load_agent_api_keys()


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


def _normalize_report_type(value: Optional[str]) -> str:
    normalized = str(value or "").strip().lower()
    if normalized == "heartbeat":
        return "heartbeat"
    return "full_snapshot"


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


def _dedupe_strings(values: List[Any]) -> List[str]:
    out: List[str] = []
    seen = set()
    for raw in values or []:
        value = _normalize_text(raw)
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


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
        active_size_bytes = max(
            active_size_bytes,
            max(max(0, _to_int(row.get("size_bytes"), 0)) for row in active_stores if isinstance(row, dict)),
        )
    record["outlook"] = outlook
    record["outlook_status"] = _normalize_text(outlook.get("status")).lower() or "unknown"
    record["outlook_confidence"] = _normalize_text(outlook.get("confidence")).lower() or "low"
    record["outlook_active_size_bytes"] = active_size_bytes
    record["outlook_active_path"] = _normalize_text((active_store or {}).get("path"))
    record["outlook_active_stores_count"] = len([row for row in active_stores if isinstance(row, dict)])
    record["outlook_total_size_bytes"] = max(0, _to_int(outlook.get("total_outlook_size_bytes"), 0))
    record["outlook_archives_count"] = len([row for row in archives if isinstance(row, dict)])


def _merge_payload(previous: Any, incoming: Dict[str, Any]) -> Dict[str, Any]:
    merged: Dict[str, Any] = dict(previous) if isinstance(previous, dict) else {}
    for key, value in incoming.items():
        if value is not None:
            merged[key] = value
    if "outlook" in incoming:
        merged["outlook"] = _normalize_outlook_payload(incoming.get("outlook"))
    _ensure_identity_fields(merged)
    _ensure_runtime_fields(merged)
    _enrich_outlook_fields(merged)
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


def _load_inventory_snapshot() -> Dict[str, Dict[str, Any]]:
    app_store = _get_inventory_app_store()
    if app_store is not None:
        snapshot: Dict[str, Dict[str, Any]] = {}
        for row in app_store.list_hosts():
            if isinstance(row, dict):
                snapshot[_inventory_record_key(row)] = row
        return snapshot

    store = get_local_store()
    payload = store.load_json(INVENTORY_FILE, default_content={})
    return payload if isinstance(payload, dict) else {}


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


def build_inventory_dedupe_key(payload: Dict[str, Any]) -> str:
    normalized_mac = _normalize_mac(payload.get("mac_address"))
    timestamp = _to_int(payload.get("timestamp"), default=0)
    report_type = _normalize_report_type(payload.get("report_type"))
    return f"{normalized_mac}:{timestamp}:{report_type}"


def process_inventory_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    incoming_payload = dict(payload or {})
    _ensure_identity_fields(incoming_payload)

    report_type = _normalize_report_type(incoming_payload.get("report_type"))
    now_ts = int(time.time())
    current_ts = _to_int(incoming_payload.get("timestamp") or now_ts, default=now_ts)
    last_seen_at = _to_int(incoming_payload.get("last_seen_at") or current_ts, default=current_ts)

    mac_key = _normalize_text(incoming_payload.get("mac_address"))
    if not mac_key:
        raise ValueError("mac_address is required")

    app_store = _get_inventory_app_store()
    current_data = None if app_store is not None else _load_inventory_snapshot()
    previous_record = app_store.get_host(mac_key) if app_store is not None else current_data.get(mac_key)

    if report_type == "heartbeat" and app_store is not None and isinstance(previous_record, dict):
        previous_persisted_ts = _to_int(previous_record.get("timestamp"), default=0)
        if previous_persisted_ts > 0 and (current_ts - previous_persisted_ts) < INVENTORY_HEARTBEAT_DEFER_WINDOW_SECONDS:
            retry_after_sec = max(1, INVENTORY_HEARTBEAT_DEFER_WINDOW_SECONDS - max(0, current_ts - previous_persisted_ts))
            touched = _touch_inventory_host_presence(
                mac_address=mac_key,
                last_seen_at=last_seen_at,
                report_type=report_type,
                hostname=incoming_payload.get("hostname"),
                user_login=incoming_payload.get("user_login") or incoming_payload.get("current_user"),
                user_full_name=incoming_payload.get("user_full_name"),
                ip_primary=incoming_payload.get("ip_primary"),
            )
            if touched:
                return {
                    "success": True,
                    "deferred": True,
                    "message": "Inventory heartbeat deferred",
                    "retry_after_sec": retry_after_sec,
                }

    merged = _merge_payload(previous_record, incoming_payload)
    merged["report_type"] = report_type
    merged["timestamp"] = current_ts
    merged["last_seen_at"] = last_seen_at

    new_change_events: List[Dict[str, Any]] = []

    if report_type == "full_snapshot":
        merged["last_full_snapshot_at"] = current_ts
        _add_hardware_change_event(new_change_events, previous_record, merged, current_ts)
    elif not merged.get("last_full_snapshot_at"):
        merged["last_full_snapshot_at"] = current_ts

    if not _save_inventory_host(merged, current_data=current_data):
        logger.error("Failed to save inventory snapshot")
        raise RuntimeError("Failed to save data")

    if app_store is not None:
        if new_change_events and not _append_change_events(new_change_events):
            logger.warning("Failed to append inventory change history")
    else:
        changes = _prune_old_changes(_load_changes(), current_ts)
        if new_change_events:
            changes.extend(new_change_events)
        if not _save_change_events(changes):
            logger.warning("Failed to save inventory change history")

    return {
        "success": True,
        "deferred": False,
        "message": "Inventory updated successfully",
        "retry_after_sec": 0,
    }


__all__ = [
    "CHANGES_FILE",
    "CHANGES_WINDOW_DAYS",
    "DEFAULT_AGENT_API_KEY",
    "HISTORY_RETENTION_DAYS",
    "INVENTORY_FILE",
    "INVENTORY_HEARTBEAT_DEFER_WINDOW_SECONDS",
    "ONLINE_MAX_AGE_SECONDS",
    "OUTLOOK_ALLOWED_STATUS",
    "InventoryPayload",
    "STALE_MAX_AGE_SECONDS",
    "_add_hardware_change_event",
    "_api_key_fingerprint",
    "_append_change_events",
    "_build_changes_index",
    "_build_hardware_signature",
    "_build_signature_diff",
    "_dedupe_strings",
    "_enrich_outlook_fields",
    "_enrich_status",
    "_ensure_identity_fields",
    "_ensure_runtime_fields",
    "_event_host_key",
    "_extract_first_ipv4",
    "_extract_mac_candidates",
    "_get_inventory_host",
    "_inventory_database_url",
    "_is_valid_agent_api_key",
    "_load_agent_api_keys",
    "_load_changes",
    "_load_inventory_snapshot",
    "_merge_payload",
    "_model_dump",
    "_normalize_mac",
    "_normalize_outlook_payload",
    "_normalize_person_name",
    "_normalize_report_type",
    "_normalize_text",
    "_prune_old_changes",
    "_save_change_events",
    "_save_inventory_host",
    "_to_float",
    "_to_int",
    "_touch_inventory_host_presence",
    "build_inventory_dedupe_key",
    "configure_runtime_hooks",
    "process_inventory_payload",
]
