"""Normalization of MFU/printer inventory rows, shared by the MFU router and AI tools (AR-01)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _read_first(row: Dict[str, Any], keys: List[str], default: Any = "") -> Any:
    for key in keys:
        if key in row and row.get(key) not in (None, ""):
            return row.get(key)
    return default


def _normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text if text else default


def normalize_device_row(row: Dict[str, Any], db_id: Optional[str]) -> Dict[str, Any]:
    item_id = _normalize_text(_read_first(row, ["ID", "id"]))
    inv_no = _normalize_text(_read_first(row, ["INV_NO", "inv_no"]))
    serial_no = _normalize_text(_read_first(row, ["SERIAL_NO", "serial_no"]))
    hw_serial_no = _normalize_text(_read_first(row, ["HW_SERIAL_NO", "hw_serial_no"]))
    type_name = _normalize_text(_read_first(row, ["TYPE_NAME", "type_name"]), "Не указано")
    model_name = _normalize_text(_read_first(row, ["MODEL_NAME", "model_name"]), "Не указано")
    manufacturer = _normalize_text(_read_first(row, ["MANUFACTURER", "manufacturer", "VENDOR_NAME", "vendor_name"]), "Не указано")
    branch_name = _normalize_text(_read_first(row, ["BRANCH_NAME", "branch_name"]), "Не указано")
    location_name = _normalize_text(_read_first(row, ["LOCATION_NAME", "location_name", "LOCATION", "location"]), "Не указано")
    status = _normalize_text(_read_first(row, ["STATUS", "status"]), "Не указано")
    ip_address = _normalize_text(_read_first(row, ["IP_ADDRESS", "ip_address"]))
    hostname = _normalize_text(
        _read_first(
            row,
            ["NETBIOS_NAME", "network_name", "NETWORK_NAME", "hostname", "HOSTNAME", "host_name", "HOST_NAME"],
        )
    )
    mac_address = _normalize_text(_read_first(row, ["MAC_ADDRESS", "mac_address"]))
    employee_name = _normalize_text(_read_first(row, ["EMPLOYEE_NAME", "employee_name"]))
    employee_dept = _normalize_text(_read_first(row, ["EMPLOYEE_DEPT", "employee_dept"]))

    unique_key_parts = [
        _normalize_text(db_id or "default", "default"),
        item_id or inv_no or serial_no or hw_serial_no or "unknown",
    ]
    unique_key = "|".join(unique_key_parts)

    return {
        "key": unique_key,
        "id": item_id,
        "inv_no": inv_no,
        "serial_no": serial_no,
        "hw_serial_no": hw_serial_no,
        "type_name": type_name,
        "model_name": model_name,
        "manufacturer": manufacturer,
        "branch_name": branch_name,
        "location_name": location_name,
        "status": status,
        "ip_address": ip_address,
        "hostname": hostname,
        "mac_address": mac_address,
        "employee_name": employee_name,
        "employee_dept": employee_dept,
    }
