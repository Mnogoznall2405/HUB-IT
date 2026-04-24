from __future__ import annotations

import importlib
import asyncio
import time
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

mfu_module = importlib.import_module("backend.services.mfu_monitor_service")


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'mfu_app.db').as_posix()}"


def test_mfu_monitor_supports_app_db_runtime_persistence(temp_dir):
    database_url = _sqlite_url(temp_dir)
    monitor = mfu_module.MfuRuntimeMonitor(database_url=database_url)

    runtime_snapshot = {
        "ping": {
            "status": "online",
            "latency_ms": 12,
            "checked_at": "2026-03-27T10:00:00+00:00",
            "last_online_at": "2026-03-27T10:00:00+00:00",
        },
        "snmp": {
            "status": "online",
            "checked_at": "2026-03-27T10:05:00+00:00",
            "last_success_at": "2026-03-27T10:05:00+00:00",
            "best_percent": 70,
            "page_total": 1500,
            "page_checked_at": "2026-03-27T10:05:00+00:00",
            "page_oid": "1.3.6.1.2.1.test",
            "supplies": [],
            "trays": [],
            "device_info": {"model": "MFU-1"},
            "timeout_total": 1,
            "timeout_streak": 0,
            "next_retry_at": None,
        },
    }

    monitor._persist_runtime_state_for_key(
        key="printer-1",
        ip_address="10.0.0.50",
        timeout_total=1,
        timeout_streak=0,
        next_retry_at=None,
        runtime_snapshot=runtime_snapshot,
    )
    monitor._upsert_page_snapshot(
        device_key="printer-1",
        page_total=1500,
        page_oid="1.3.6.1.2.1.test",
        snmp_checked_at="2026-03-27T10:05:00+00:00",
    )
    monitor._upsert_page_snapshot(
        device_key="printer-1",
        page_total=1400,
        page_oid=None,
        snmp_checked_at="2026-03-27T10:05:00+00:00",
    )
    monitor._upsert_page_snapshot(
        device_key="printer-1",
        page_total=1800,
        page_oid="1.3.6.1.2.1.test.next",
        snmp_checked_at="2026-03-27T11:05:00+00:00",
    )

    baseline = monitor._get_or_create_page_baseline("printer-1")
    snapshots = monitor.get_page_snapshots(device_key="printer-1")

    assert baseline
    assert len(snapshots) == 1
    assert snapshots[0]["page_total"] == 1800
    assert snapshots[0]["page_oid"] == "1.3.6.1.2.1.test.next"
    assert snapshots[0]["snmp_checked_at"] == "2026-03-27T11:05:00+00:00"

    reloaded = mfu_module.MfuRuntimeMonitor(database_url=database_url)
    assert "printer-1" in reloaded._runtime_state_seed
    assert reloaded._runtime_state_seed["printer-1"]["timeout_total"] == 1


def test_mfu_device_info_probe_honors_explicit_snmp_version(temp_dir, monkeypatch):
    monitor = mfu_module.MfuRuntimeMonitor(database_url=_sqlite_url(temp_dir))
    calls = []

    async def fake_snmp_get(ip_address, oid, **kwargs):
        calls.append(kwargs.get("snmp_version"))
        if oid == "1.3.6.1.2.1.1.1.0":
            return "Canon MFU"
        return None

    monkeypatch.setattr(monitor, "_snmp_get_async", fake_snmp_get)

    result = asyncio.run(
        monitor._probe_device_info_async(
            "10.0.0.50",
            deadline=time.monotonic() + 5,
            snmp_version=0,
        )
    )

    assert result == {"sys_descr": "Canon MFU"}
    assert calls
    assert set(calls) == {0}


def test_mfu_custom_metrics_can_match_ip_without_model(temp_dir, monkeypatch):
    monitor = mfu_module.MfuRuntimeMonitor(database_url=_sqlite_url(temp_dir))
    monitor._custom_providers = [
        {
            "match_ip": "10.0.0.51",
            "custom_metrics": {
                "serial": "1.3.6.1.2.1.test.1",
            },
        }
    ]
    calls = []

    async def fake_snmp_get(ip_address, oid, **kwargs):
        calls.append((ip_address, oid, kwargs.get("snmp_version")))
        return "SN123"

    monkeypatch.setattr(monitor, "_snmp_get_async", fake_snmp_get)

    result = asyncio.run(
        monitor._probe_custom_metrics_async(
            "10.0.0.51",
            search_model="unknown",
            deadline=time.monotonic() + 5,
            snmp_version=0,
        )
    )

    assert result == {"serial": "SN123"}
    assert calls == [("10.0.0.51", "1.3.6.1.2.1.test.1", 0)]


def test_mfu_snmp_cycle_retries_offline_devices_with_throttle(temp_dir, monkeypatch):
    monkeypatch.setattr(mfu_module, "_SNMP_AVAILABLE", True)
    monitor = mfu_module.MfuRuntimeMonitor(database_url=_sqlite_url(temp_dir))
    monitor.snmp_enabled = True
    monitor.snmp_offline_retry_sec = 900
    monitor.snmp_probe_timeout_sec = 3
    probes = []

    async def fake_probe(ip_address, device_key=None, search_model=None):
        probes.append((ip_address, device_key))
        return {
            "status": "no_data",
            "supplies": [],
            "best_percent": None,
            "page_total": None,
            "page_oid": None,
            "used_community": "public",
            "version": "v1",
            "query_mode": "test",
        }

    async def fake_device_info(*args, **kwargs):
        return None

    async def fake_trays(*args, **kwargs):
        return []

    async def fake_custom_metrics(*args, **kwargs):
        return {}

    monkeypatch.setattr(monitor, "_probe_snmp_async", fake_probe)
    monkeypatch.setattr(monitor, "_probe_device_info_async", fake_device_info)
    monkeypatch.setattr(monitor, "_probe_trays_async", fake_trays)
    monkeypatch.setattr(monitor, "_probe_custom_metrics_async", fake_custom_metrics)

    async def scenario():
        await monitor.register_devices([{"key": "printer-offline", "ip": "10.0.0.52"}])
        monitor._runtime_cache["printer-offline"]["ping"]["status"] = "offline"
        await monitor._run_snmp_cycle()
        assert probes == [("10.0.0.52", "printer-offline")]

        probes.clear()
        monitor._runtime_cache["printer-offline"]["snmp"]["last_success_at"] = None
        monitor._runtime_cache["printer-offline"]["snmp"]["checked_at"] = mfu_module._utc_now_iso()
        await monitor._run_snmp_cycle()
        assert probes == []

    asyncio.run(scenario())


def test_mfu_no_data_result_sets_backoff(temp_dir):
    monitor = mfu_module.MfuRuntimeMonitor(database_url=_sqlite_url(temp_dir))
    monitor.snmp_no_data_backoff_sec = 3600

    async def scenario():
        await monitor.register_devices([{"key": "printer-no-data", "ip": "10.0.0.53"}])
        await monitor._apply_snmp_result(
            "printer-no-data",
            {
                "status": "no_data",
                "supplies": [],
                "best_percent": None,
                "page_total": None,
                "page_oid": None,
                "used_community": "public",
                "version": "v2c",
                "query_mode": "budget_exhausted",
            },
        )
        retry_at = monitor._runtime_cache["printer-no-data"]["snmp"]["no_data_retry_at"]
        assert retry_at
        retry_dt = datetime.fromisoformat(retry_at.replace("Z", "+00:00")).astimezone(timezone.utc)
        assert retry_dt > datetime.now(timezone.utc)

    asyncio.run(scenario())


def test_mfu_snmp_cycle_skips_no_data_backoff(temp_dir, monkeypatch):
    monkeypatch.setattr(mfu_module, "_SNMP_AVAILABLE", True)
    monitor = mfu_module.MfuRuntimeMonitor(database_url=_sqlite_url(temp_dir))
    monitor.snmp_enabled = True
    probes = []

    async def fake_probe(*args, **kwargs):
        probes.append(args)
        return {"status": "ok", "supplies": []}

    monkeypatch.setattr(monitor, "_probe_snmp_async", fake_probe)

    async def scenario():
        await monitor.register_devices([{"key": "printer-backoff", "ip": "10.0.0.54"}])
        monitor._runtime_cache["printer-backoff"]["ping"]["status"] = "online"
        retry_at = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        monitor._known_devices["printer-backoff"]["snmp_no_data_until"] = retry_at
        monitor._runtime_cache["printer-backoff"]["snmp"]["no_data_retry_at"] = retry_at
        await monitor._run_snmp_cycle()
        assert probes == []

    asyncio.run(scenario())


def test_mfu_snmp_cycle_uses_inventory_model_hint(temp_dir, monkeypatch):
    monkeypatch.setattr(mfu_module, "_SNMP_AVAILABLE", True)
    monitor = mfu_module.MfuRuntimeMonitor(database_url=_sqlite_url(temp_dir))
    monitor.snmp_enabled = True
    seen = {}

    async def fake_probe(ip_address, device_key=None, search_model=None):
        seen["search_model"] = search_model
        return {
            "status": "no_data",
            "supplies": [],
            "best_percent": None,
            "page_total": None,
            "page_oid": None,
            "used_community": "public",
            "version": "v2c",
            "query_mode": "test",
        }

    async def fake_device_info(*args, **kwargs):
        return None

    async def fake_trays(*args, **kwargs):
        return []

    async def fake_custom_metrics(*args, **kwargs):
        return {}

    monkeypatch.setattr(monitor, "_probe_snmp_async", fake_probe)
    monkeypatch.setattr(monitor, "_probe_device_info_async", fake_device_info)
    monkeypatch.setattr(monitor, "_probe_trays_async", fake_trays)
    monkeypatch.setattr(monitor, "_probe_custom_metrics_async", fake_custom_metrics)

    async def scenario():
        await monitor.register_devices(
            [
                {
                    "key": "printer-hint",
                    "ip": "10.0.0.55",
                    "model_name": "Canon MF443",
                    "manufacturer": "Canon",
                    "type_name": "MFP",
                }
            ]
        )
        monitor._runtime_cache["printer-hint"]["ping"]["status"] = "online"
        await monitor._run_snmp_cycle()
        assert "Canon MF443" in seen["search_model"]
        assert "Canon" in seen["search_model"]

    asyncio.run(scenario())
