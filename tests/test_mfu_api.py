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


def _device(type_name: str, model_name: str, manufacturer: str = "HP", ip_address: str = "172.16.179.11") -> dict:
    return mfu_api._normalize_device_row(
        {
            "ID": 1,
            "INV_NO": "102550",
            "TYPE_NAME": type_name,
            "MODEL_NAME": model_name,
            "MANUFACTURER": manufacturer,
            "IP_ADDRESS": ip_address,
        },
        "SPB-ITINVENT",
    )


def test_mfu_page_excludes_hpe_switch_with_ip() -> None:
    device = _device("Коммутатор", "HPE 1950-48G-2SFP+ 2XGT JG961A", manufacturer="HPE")
    assert mfu_api._is_mfu_device(device) is False


def test_mfu_page_excludes_hp_probook_laptop_with_ip() -> None:
    device = _device("Ноутбук", "HP ProBook 450 G8", manufacturer="HP", ip_address="10.105.5.10")
    assert mfu_api._is_mfu_device(device) is False


def test_mfu_page_keeps_xerox_mfu() -> None:
    device = _device("МФУ", "Xerox VersaLink C7020 MFP", manufacturer="Xerox")
    assert mfu_api._is_mfu_device(device) is True


def test_mfu_page_keeps_hp_designjet_plotter() -> None:
    device = _device("Плоттер", "HP DesignJet T525 24-in Printer", manufacturer="HP")
    assert mfu_api._is_mfu_device(device) is True
