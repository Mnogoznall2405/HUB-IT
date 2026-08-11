from __future__ import annotations

import importlib
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

mfu_api = importlib.import_module("backend.api.v1.mfu")


def test_normalize_device_row_exposes_hostname_from_network_name() -> None:
    device = mfu_api._normalize_device_row(
        {
            "ID": 17,
            "INV_NO": "10017",
            "TYPE_NAME": "МФУ",
            "network_name": "  MFU-OFFICE-01  ",
        },
        "main",
    )

    assert device["hostname"] == "MFU-OFFICE-01"


def test_resolve_device_hostname_falls_back_to_snmp_sys_name() -> None:
    hostname = mfu_api._resolve_device_hostname(
        {"hostname": ""},
        {"snmp": {"device_info": {"sys_name": "  PRINTER-SNMP-01  "}}},
    )

    assert hostname == "PRINTER-SNMP-01"


def test_resolve_device_hostname_prefers_inventory_name() -> None:
    hostname = mfu_api._resolve_device_hostname(
        {"hostname": "PRINTER-INVENTORY-01"},
        {"snmp": {"device_info": {"sys_name": "PRINTER-SNMP-01"}}},
    )

    assert hostname == "PRINTER-INVENTORY-01"
