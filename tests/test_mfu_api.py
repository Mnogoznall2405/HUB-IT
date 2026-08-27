from __future__ import annotations

import importlib
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest


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


def test_public_runtime_drops_snmp_community_without_mutating_snapshot() -> None:
    snapshot = {
        "ping": {"status": "online"},
        "snmp": {
            "status": "ok",
            "version": "2c",
            "used_community": "private-value",
            "supplies": [{"name": "Black", "percent": 50}],
        },
    }

    public_runtime = mfu_api._sanitize_runtime_for_public_api(snapshot)

    assert public_runtime["ping"] == {"status": "online"}
    assert public_runtime["snmp"]["version"] == "2c"
    assert public_runtime["snmp"]["supplies"] == [{"name": "Black", "percent": 50}]
    assert "used_community" not in public_runtime["snmp"]
    assert snapshot["snmp"]["used_community"] == "private-value"


@pytest.mark.asyncio
async def test_devices_response_omits_credentials_and_debug(monkeypatch) -> None:
    with mfu_api._mfu_devices_cache_lock:
        mfu_api._mfu_devices_cache.clear()
    monkeypatch.setattr(
        mfu_api,
        "get_all_equipment_flat",
        lambda **_kwargs: [{
            "ID": 17,
            "INV_NO": "10017",
            "TYPE_NAME": "МФУ",
            "MODEL_NAME": "Canon MF443",
            "IP_ADDRESS": "10.20.30.40",
        }],
    )
    monkeypatch.setattr(mfu_api.mfu_runtime_monitor, "register_devices", AsyncMock(return_value=None))
    monkeypatch.setattr(
        mfu_api.mfu_runtime_monitor,
        "get_snapshot",
        AsyncMock(return_value={
            "ping": {"status": "online"},
            "snmp": {"status": "ok", "version": "2c", "used_community": "private-value"},
        }),
    )
    monkeypatch.setattr(mfu_api, "_build_mfu_events_index", lambda **_kwargs: {})

    payload = await mfu_api.get_mfu_devices(
        period_days=365,
        recent_limit=8,
        limit=1,
        db_id="main",
        _=object(),
    )

    device = payload["grouped"]["Не указано"]["Не указано"][0]
    assert "used_community" not in device["runtime"]["snmp"]
    assert "debug" not in payload
    assert payload["meta"] == {
        "source_limit": 1,
        "raw_rows_count": 1,
        "matched_mfu_count": 1,
        "source_maybe_truncated": True,
    }


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
