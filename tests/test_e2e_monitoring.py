"""Monitoring HTTP scenarios on an isolated app DB; only network IO is replaced."""
from __future__ import annotations

import asyncio
import time
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select, text

from backend.api import deps
from backend.api.v1 import monitoring
from backend.appdb.monitoring_models import (MonitoringAggregate, MonitoringEvent, MonitoringInterface,
                                           MonitoringProfile, MonitoringSample, MonitoringTarget)
from backend.main import app
from backend.models.auth import User
from backend.services.network_monitor_service import NetworkMonitorService
from backend.services.network_monitor_store import MonitoringStore
from backend.services.secret_crypto_service import _build_fernet


def snapshot(counter=0, speed=1_000_000_000, uptime=100000, oper=1):
    return {"snmp_status": "ok", "error": None, "full": True,
            "ping": {"status": "online", "latency_ms": 43, "loss_pct": 0},
            "device": {"sys_name": "Repeated identity", "serial": "same-serial", "uptime_ticks": uptime,
                       "hardware_uptime_ticks": uptime, "cpu_pct": 20, "memory_pct": 45, "temperature_c": 30},
            "interfaces": [{"name": "ether1_wan", "snmp_index": 2, "admin": 1, "oper": oper, "type": 6,
                            "mac": "test-mac", "speed_bps": speed, "rx_octets": counter, "tx_octets": counter // 2,
                            "rx_errors": 0, "tx_errors": 0, "rx_discards": 0, "tx_discards": 0},
                           {"name": "ether8", "snmp_index": 9, "admin": 2, "oper": 2, "type": 6, "speed_bps": 0}]}


class Device:
    def __init__(self):
        self.value = snapshot()

    async def read(self, target, community, *, full=True):
        return {**deepcopy(self.value), "full": full}


@pytest.fixture
def environment(prebuilt_app_db, monkeypatch):
    monkeypatch.setenv("MAIL_CREDENTIALS_KEY", Fernet.generate_key().decode())
    _build_fernet.cache_clear()
    store = MonitoringStore(f"sqlite:///{prebuilt_app_db.as_posix()}")
    device = Device()
    svc = NetworkMonitorService(store, device)
    now = [datetime(2026, 10, 15, 6, 0, tzinfo=timezone.utc)]
    svc.clock = lambda: now[0]
    monkeypatch.setattr(svc, "catalog", lambda: [{"id": 1, "name": "Router A"}, {"id": 2, "name": "Router B"}])
    user = {"value": User(id=10, username="monitor-admin", role="admin", is_active=True)}
    app.dependency_overrides[deps.get_current_active_user] = lambda: user["value"]
    app.dependency_overrides[monitoring.service] = lambda: svc
    client = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
    yield client, svc, device, now, user
    app.dependency_overrides.pop(deps.get_current_active_user, None)
    app.dependency_overrides.pop(monitoring.service, None)
    _build_fernet.cache_clear()


def create_target(client, device_id=1, address="10.105.42.1"):
    profile = client.post("/api/v1/monitoring/profiles", json={"name": "Test read profile", "community": "test-only-community"})
    assert profile.status_code == 201, profile.text
    result = client.post("/api/v1/monitoring/targets", json={"network_device_id": device_id, "name": f"Router {device_id}",
        "address": address, "profile_id": profile.json()["id"]})
    assert result.status_code == 201, result.text
    return result.json()


def test_latency_ten_second_history_survives_reload_and_keeps_unknown_samples(environment):
    client, svc, device, now, _ = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    start = now[0]
    for second, status, latency in ((0, "online", 7), (10, "online", 19), (20, "unknown", None), (30, "offline", None), (40, "online", 11)):
        now[0] = start + timedelta(seconds=second)
        device.value = {"protocol": "icmp", "ping": {"status": status, "latency_ms": latency, "sent": 3 if status != "unknown" else None, "received": 3 if status == "online" else 0}}
        assert client.post(path + "/probe").status_code == 200
    assert client.post(path + "/probe").status_code == 200
    now[0] += timedelta(seconds=5)
    device.value = {"protocol": "snmp", "snmp_status": "ok", "device": {"cpu_pct": 3}, "interfaces": []}
    assert client.post(path + "/probe").status_code == 200
    svc.store = MonitoringStore(svc.store.database_url)  # Simulates restart; no memory cache survives.
    response = client.get(path + "/latency-history", params={"hours": 1})
    assert response.status_code == 200
    history = response.json()
    assert history["resolution_seconds"] == 10
    points = {p["at"]: p for p in history["points"]}
    for second, expected in ((0, 7), (10, 19), (20, None), (30, None), (40, 11)):
        point = points[(start + timedelta(seconds=second)).isoformat()]
        assert point.get("latency_ms") == expected
        assert point["source_resolution_seconds"] == 10
    with svc.store.session() as session:
        minute = session.scalar(select(MonitoringSample).where(MonitoringSample.target_id == target["id"], MonitoringSample.interface_id == ""))
        assert len(minute.values["_icmp_10s"]) == 5
        assert minute.values["icmp_checks"] == 5


def test_latency_history_stays_bounded_during_frequent_manual_probes(environment):
    client, svc, device, now, _ = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    start = now[0]
    for second in range(60):
        now[0] = start + timedelta(seconds=second)
        device.value = {"protocol": "icmp", "ping": {"status": "online", "latency_ms": second, "sent": 3, "received": 3}}
        assert client.post(path + "/probe").status_code == 200
    with svc.store.session() as session:
        samples = list(session.scalars(select(MonitoringSample).where(MonitoringSample.target_id == target["id"], MonitoringSample.interface_id == "")))
        assert len(samples) == 1 and len(samples[0].values["_icmp_10s"]) == 6
        assert samples[0].values["icmp_checks"] == 60
    history = client.get(path + "/latency-history", params={"hours": 1}).json()
    observed = [p["latency_ms"] for p in history["points"] if p.get("observed_at")]
    assert observed == [9, 19, 29, 39, 49, 59]


def test_latency_delta_replaces_tail_and_preserves_legacy_precision(environment):
    client, svc, device, now, _ = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    assert client.post(path + "/probe").status_code == 200
    start = now[0]
    # A legacy minute must not be expanded into six fabricated measurements.
    with svc.store.session() as session:
        minute = session.scalar(select(MonitoringSample).where(MonitoringSample.target_id == target["id"], MonitoringSample.interface_id == ""))
        minute.values = {k: v for k, v in minute.values.items() if not k.startswith("_")}
    for second, latency in ((60, 7), (70, 13), (80, 23)):
        now[0] = start + timedelta(seconds=second)
        device.value = {"protocol": "icmp", "ping": {"status": "online", "latency_ms": latency, "sent": 3, "received": 3}}
        assert client.post(path + "/probe").status_code == 200
    full = client.get(path + "/latency-history", params={"hours": 1}).json()
    legacy = [p for p in full["points"] if start <= datetime.fromisoformat(p["at"]) < start + timedelta(minutes=1)]
    assert len(legacy) == 1 and legacy[0]["latency_ms"] == 43
    assert legacy[0]["source_resolution_seconds"] == 60
    cutoff = start + timedelta(seconds=60)
    delta = client.get(path + "/latency-history", params={"hours": 1, "after": cutoff.isoformat()}).json()
    assert delta["replace_from"] == cutoff.isoformat()
    assert all(datetime.fromisoformat(p["at"]) >= cutoff for p in delta["points"])
    assert [p["latency_ms"] for p in delta["points"]] == [7, 13, 23]
    assert delta["window_start"] < delta["replace_from"]


def test_latency_history_bounds_validation_and_access(environment):
    client, svc, device, now, user = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    assert client.post(path + "/probe").status_code == 200
    day = client.get(path + "/latency-history", params={"hours": 24}).json()
    assert day["resolution_seconds"] == 10 and len(day["points"]) <= 8641
    week = client.get(path + "/latency-history", params={"hours": 168}).json()
    assert week["resolution_seconds"] >= 60 and len(week["points"]) <= 1401
    assert client.get(path + "/latency-history", params={"after": "2026-10-15T06:00:00"}).status_code == 400
    assert client.get(path + "/latency-history", params={"start": now[0].isoformat()}).status_code == 400
    assert client.get("/api/v1/monitoring/targets/missing/latency-history").status_code == 404
    user["value"] = User(id=11, username="no-monitoring", role="operator", is_active=True, use_custom_permissions=True, custom_permissions=[])
    assert client.get(path + "/latency-history", params={"hours": 24}).status_code == 403


def test_independent_protocols_merge_minute_and_rollups_without_duplicate_packets(environment):
    client, svc, device, now, _ = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    start = now[0]
    device.value = {**snapshot(), "protocol": "snmp"}
    device.value.pop("ping")
    assert client.post(path + "/probe").status_code == 200
    for seconds, received, latency in ((10, 3, 20), (20, 0, None), (30, 2, 80)):
        now[0] = start + timedelta(seconds=seconds)
        device.value = {"protocol": "icmp", "ping": {"status": "online" if received else "offline",
                        "sent": 3, "received": received, "loss_pct": 100 * (3 - received) / 3, "latency_ms": latency}}
        response = client.post(path + "/probe")
        assert response.status_code == 200
    # Retrying exactly the same observation must not count its packets twice.
    assert client.post(path + "/probe").status_code == 200
    current = client.get(path).json()["current"]
    assert current["status"] == "online" and current["device"]["cpu_pct"] == 20
    assert current["last_success_at"] == start.isoformat()
    with svc.store.session() as session:
        row = session.scalar(select(MonitoringSample).where(MonitoringSample.target_id == target["id"], MonitoringSample.interface_id == ""))
        assert row.values["icmp_sent_packets"] == 9
        assert row.values["icmp_received_packets"] == 5
    history = client.get(path + "/history", params={"hours": 1}).json()
    point = next(p for p in history["points"] if p["at"] == start.isoformat())
    assert point["loss_pct"] == pytest.approx(100 * 4 / 9)
    assert point["latency_ms"] == pytest.approx(44)
    assert point["ping_up"] == pytest.approx(2 / 3)
    assert point["snmp_up"] == 1
    with svc.store.session() as session:
        for rollup in session.scalars(select(MonitoringAggregate).where(MonitoringAggregate.target_id == target["id"], MonitoringAggregate.interface_id == "")):
            assert rollup.values["icmp_sent_packets"]["sum"] == 9
            assert rollup.values["latency_ms"]["min"] == 20
            assert rollup.values["latency_ms"]["max"] == 80


def test_fast_icmp_preserves_failure_confirmation_and_collector_errors_are_unknown(environment):
    client, svc, device, now, _ = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    start = now[0]
    for seconds in range(0, 61, 10):
        now[0] = start + timedelta(seconds=seconds)
        if seconds % 30 == 0:
            device.value = {"protocol": "snmp", "snmp_status": "error", "error": "timeout"}
            assert client.post(path + "/probe").status_code == 200
        device.value = {"protocol": "icmp", "ping": {"status": "offline", "sent": 3, "received": 0, "loss_pct": 100}}
        current = client.post(path + "/probe").json()["current"]
        if seconds < 60:
            assert current["status"] != "offline"
    assert current["status"] == "offline" and current["failures"] == 3
    now[0] += timedelta(seconds=10)
    device.value = {"protocol": "icmp", "ping": {"status": "unknown", "loss_pct": None, "error": "collector_timeout"}}
    unknown = client.post(path + "/probe").json()["current"]
    assert unknown["status"] == "unknown"
    assert unknown["failures"] == 3
    assert len([e for e in client.get(path).json()["events"] if e["kind"] == "unreachable"]) == 1


def test_older_other_protocol_result_does_not_erase_newer_ping(environment):
    client, svc, device, now, _ = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    start = now[0]
    now[0] += timedelta(seconds=10)
    device.value = {"protocol": "icmp", "ping": {"status": "online", "sent": 3, "received": 3, "loss_pct": 0, "latency_ms": 7}}
    assert client.post(path + "/probe").status_code == 200
    first = client.get(path + "/history", params={"hours": 1}).json()
    assert not any(p.get("cpu_pct") is not None for p in first["points"])
    now[0] = start + timedelta(seconds=5)
    device.value = {**snapshot(), "protocol": "snmp"}
    device.value.pop("ping")
    merged = client.post(path + "/probe").json()["current"]
    assert merged["device"]["cpu_pct"] == 20
    assert merged["ping"]["latency_ms"] == 7
    assert merged["checked_at"] == (start + timedelta(seconds=10)).isoformat()
    assert any(p.get("cpu_pct") == 20 for p in client.get(path + "/history", params={"hours": 1}).json()["points"])
    now[0] = start + timedelta(seconds=4)
    device.value["device"]["cpu_pct"] = 99
    assert client.post(path + "/probe").json()["current"]["device"]["cpu_pct"] == 20


def test_protocol_overlap_keeps_both_results_and_manual_probe_is_busy(environment):
    import asyncio
    import threading
    from concurrent.futures import ThreadPoolExecutor

    client, svc, device, now, _ = environment
    target = create_target(client)
    entered, release = threading.Event(), threading.Event()

    async def snmp(*args, **kwargs):
        entered.set()
        assert await asyncio.to_thread(release.wait, 10)
        value = snapshot()
        value.pop("ping")
        return value

    async def ping(*args):
        return {"status": "online", "sent": 3, "received": 3, "loss_pct": 0, "latency_ms": 11}

    svc.probe.read_snmp, svc.probe.ping = snmp, ping
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(lambda: asyncio.run(svc.collect(target["id"], protocol="snmp", detail=False)))
        assert entered.wait(10)
        try:
            state = asyncio.run(svc.collect(target["id"], protocol="icmp", detail=False))
            assert state["current"]["ping"]["latency_ms"] == 11
            assert client.post(f"/api/v1/monitoring/targets/{target['id']}/probe").status_code == 409
        finally:
            release.set()
        assert pending.result(timeout=10)["current"]["device"]["cpu_pct"] == 20
    result = client.get(f"/api/v1/monitoring/targets/{target['id']}").json()
    assert result["current"]["ping"]["latency_ms"] == 11
    assert result["current"]["snmp_status"] == "ok"


@pytest.mark.asyncio
async def test_cancelled_collector_keeps_lease_until_inflight_write_finishes(environment, monkeypatch):
    import asyncio
    import threading
    from backend.services.network_monitor_service import MonitoringBusy

    client, svc, device, now, _ = environment
    target = create_target(client)
    entered, release = threading.Event(), threading.Event()
    original = svc.store.record

    async def ping(*args):
        return {"status": "online", "sent": 3, "received": 3, "loss_pct": 0, "latency_ms": 17}

    def record(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return original(*args, **kwargs)

    svc.probe.ping = ping
    monkeypatch.setattr(svc.store, "record", record)
    task = asyncio.create_task(svc.collect(target["id"], protocol="icmp", detail=False))
    assert await asyncio.to_thread(entered.wait, 5)
    task.cancel()
    try:
        await asyncio.sleep(0.05)
        assert not task.done()
        with pytest.raises(MonitoringBusy):
            await svc.collect(target["id"], protocol="icmp", detail=False)
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert svc.store.detail(target["id"])["current"]["ping"]["latency_ms"] == 17


def test_unknown_collection_breaks_unconfirmed_failure_streak(environment):
    client, svc, device, now, _ = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    start = now[0]
    for second in (0, 30, 40, 60, 90):
        now[0] = start + timedelta(seconds=second)
        device.value = {"protocol": "snmp", "snmp_status": "error", "error": "timeout"}
        assert client.post(path + "/probe").status_code == 200
        device.value = {"protocol": "icmp", "ping": {"status": "unknown" if second == 40 else "offline", "loss_pct": None if second == 40 else 100}}
        current = client.post(path + "/probe").json()["current"]
        assert current["status"] != "offline"
    assert not [e for e in client.get(path).json()["events"] if e["kind"] == "unreachable"]


@pytest.mark.parametrize("encoding", ["identity", "gzip"])
def test_history_encoded_response_preserves_json_and_timing_headers(environment, encoding):
    client, svc, device, now, _ = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    assert client.post(path + "/probe").status_code == 200
    response = client.get(path + "/history", params={"hours": 1}, headers={"Accept-Encoding": encoding})
    assert response.status_code == 200 and response.json()["has_data"]
    assert any(p.get("latency_ms") == 43 for p in response.json()["points"])
    assert response.headers.get("content-encoding") == ("gzip" if encoding == "gzip" else None)
    assert "monitoring_store;dur=" in response.headers["server-timing"]


def test_lost_protocol_lease_never_records_probe_result(environment, monkeypatch):
    from contextlib import contextmanager
    from backend.services import network_monitor_service as orchestration

    client, svc, device, now, _ = environment
    target = create_target(client)

    @contextmanager
    def lost(*args):
        yield lambda: False

    monkeypatch.setattr(orchestration, "monitoring_lease", lost)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    assert client.post(path + "/probe").status_code == 409
    assert client.get(path).json()["current"] == {}
    assert client.get(path + "/history").json()["has_data"] is False


def test_new_collector_preserves_legacy_minute_without_inventing_packet_counts(environment):
    client, svc, device, now, _ = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    start = now[0]
    assert client.post(path + "/probe").status_code == 200
    with svc.store.session() as session:
        imported = session.scalar(select(MonitoringSample).where(MonitoringSample.target_id == target["id"], MonitoringSample.interface_id == ""))
        imported.id = "imported-minute-with-another-id"
    now[0] += timedelta(seconds=10)
    device.value = {"protocol": "icmp", "ping": {"status": "online", "sent": 3, "received": 3, "loss_pct": 0, "latency_ms": 11}}
    assert client.post(path + "/probe").json()["current"]["ping"]["latency_ms"] == 11
    with svc.store.session() as session:
        old = session.scalar(select(MonitoringSample).where(MonitoringSample.target_id == target["id"], MonitoringSample.interface_id == ""))
        assert old.values["latency_ms"] == 43 and "icmp_sent_packets" not in old.values
    now[0] = start + timedelta(seconds=60)
    assert client.post(path + "/probe").status_code == 200
    points = client.get(path + "/history", params={"hours": 1}).json()["points"]
    assert any(p.get("icmp_sent_packets") == 3 and p.get("latency_ms") == 11 for p in points)


def test_delete_target_removes_its_history_and_preserves_other_equipment(environment):
    client, svc, device, now, user = environment
    removed = create_target(client)
    kept = create_target(client, 2, "10.105.42.2")
    for target in (removed, kept):
        path = f"/api/v1/monitoring/targets/{target['id']}"
        assert client.post(path + "/probe").status_code == 200
    now[0] += timedelta(minutes=1)
    device.value = snapshot(7_500_000, uptime=106000)
    for target in (removed, kept):
        assert client.post(f"/api/v1/monitoring/targets/{target['id']}/probe").status_code == 200
    # Both devices get real incidents through the normal polling boundary.
    device.value = {"snmp_status": "error", "error": "timeout", "ping": {"status": "offline", "loss_pct": 100}}
    for _ in range(3):
        now[0] += timedelta(minutes=1)
        for target in (removed, kept):
            assert client.post(f"/api/v1/monitoring/targets/{target['id']}/probe").status_code == 200
    path = f"/api/v1/monitoring/targets/{removed['id']}"
    assert client.get(path + "/history").json()["has_data"]
    assert client.get("/api/v1/monitoring/events", params={"target_id": removed["id"]}).json()
    with svc.store.session() as session:
        before_kept = {model.__tablename__: session.scalar(select(func.count()).select_from(model).where(model.target_id == kept["id"]))
                       for model in (MonitoringSample, MonitoringAggregate, MonitoringEvent, MonitoringInterface)}
        assert all(before_kept.values())
        profile_count = session.scalar(select(func.count()).select_from(MonitoringProfile))
    assert client.delete(path).status_code == 204
    assert [t["id"] for t in client.get("/api/v1/monitoring/overview").json()["targets"]] == [kept["id"]]
    for url in (path, path + "/history", "/api/v1/monitoring/events?target_id=" + removed["id"]):
        assert client.get(url).status_code == 404
    assert client.post(path + "/probe").status_code == 404
    assert client.delete(path).status_code == 404
    assert client.delete("/api/v1/monitoring/targets/missing").status_code == 404
    with svc.store.session() as session:
        assert session.get(MonitoringTarget, removed["id"]) is None
        for model in (MonitoringSample, MonitoringAggregate, MonitoringEvent, MonitoringInterface):
            assert session.scalar(select(func.count()).select_from(model).where(model.target_id == removed["id"])) == 0
            assert session.scalar(select(func.count()).select_from(model).where(model.target_id == kept["id"])) == before_kept[model.__tablename__]
        assert session.scalar(select(func.count()).select_from(MonitoringProfile)) == profile_count
    # Registry association can be enrolled again, starting a new empty history.
    fresh = create_target(client)
    assert fresh["id"] != removed["id"]
    assert client.get(f"/api/v1/monitoring/targets/{fresh['id']}/history").json()["has_data"] is False


def test_delete_during_inflight_probe_does_not_recreate_history(environment):
    import asyncio
    import threading
    from concurrent.futures import ThreadPoolExecutor
    client, svc, device, now, user = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    assert client.post(path + "/probe").status_code == 200
    entered, release = threading.Event(), threading.Event()

    async def blocked(*args, **kwargs):
        entered.set()
        assert await asyncio.to_thread(release.wait, 10)
        return snapshot(7_500_000, uptime=106000)

    svc.probe.read = blocked
    now[0] += timedelta(minutes=1)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(client.post, path + "/probe")
        assert entered.wait(10)
        try:
            assert client.delete(path).status_code == 204
        finally:
            release.set()
        assert pending.result(timeout=10).status_code == 404
    assert client.get("/api/v1/monitoring/overview").json()["targets"] == []
    with svc.store.session() as session:
        assert session.get(MonitoringTarget, target["id"]) is None
        for model in (MonitoringSample, MonitoringAggregate, MonitoringEvent, MonitoringInterface):
            assert session.scalar(select(func.count()).select_from(model)) == 0


def test_failed_delete_rolls_back_all_history(environment):
    client, svc, device, now, user = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    assert client.post(path + "/probe").status_code == 200
    now[0] += timedelta(minutes=1)
    device.value = snapshot(7_500_000, uptime=106000)
    assert client.post(path + "/probe").status_code == 200
    history = client.get(path + "/history").json()
    models = (MonitoringSample, MonitoringAggregate, MonitoringEvent, MonitoringInterface)
    with svc.store.session() as session:
        counts = [session.scalar(select(func.count()).select_from(model)) for model in models]
        # A real DB failure at the last DELETE proves the prior child DELETEs
        # roll back too. This trigger exists only in this test's SQLite copy.
        session.execute(text("CREATE TRIGGER test_block_monitoring_delete BEFORE DELETE ON monitoring_targets BEGIN SELECT RAISE(ABORT, 'test deletion blocked'); END"))
    assert client.delete(path).status_code == 409
    assert client.get(path).status_code == 200
    assert client.get(path + "/history").json() == history
    with svc.store.session() as session:
        assert [session.scalar(select(func.count()).select_from(model)) for model in models] == counts


def test_outage_time_survives_confirmation_restart_and_recovery(environment):
    client, svc, device, now, user = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    assert client.post(path + "/probe").status_code == 200
    first_failure = now[0] + timedelta(minutes=1)
    device.value = {"snmp_status": "error", "error": "timeout", "ping": {"status": "offline", "loss_pct": 100}}
    for minute in (1, 2, 3):
        now[0] = first_failure + timedelta(minutes=minute - 1)
        if minute == 2:
            restarted = NetworkMonitorService(svc.store, device)
            restarted.clock = svc.clock
            restarted.catalog = svc.catalog
            app.dependency_overrides[monitoring.service] = lambda: restarted
        assert client.post(path + "/probe").status_code == 200
    row = client.get("/api/v1/monitoring/overview").json()["targets"][0]
    assert row["current"]["status"] == "offline"
    assert row["current"]["availability"]["ever_reachable"] is True
    assert row["current"]["availability"]["unreachable_since"] == first_failure.isoformat()
    assert row["outages"][0]["opened_at"] == first_failure.isoformat()
    assert row["outages"][0]["closed_at"] is None
    now[0] = first_failure + timedelta(minutes=18)
    # ICMP recovery closes the connection outage even while SNMP is still unavailable.
    device.value["ping"] = {"status": "online", "loss_pct": 0, "latency_ms": 20}
    recovered = client.post(path + "/probe").json()
    assert "unreachable_since" not in recovered["current"]["availability"]
    row = client.get(path).json()
    assert len(row["outages"]) == 1
    assert row["outages"][0]["closed_at"] == now[0].isoformat()
    assert row["outages"][0]["kind"] == "unreachable"
    # A never reachable target has an observation start, not a fabricated previous connection.
    other = create_target(client, 2, "10.105.42.2")
    device.value["ping"]["status"] = "offline"
    for minute in range(3):
        now[0] += timedelta(minutes=1)
        assert client.post(f"/api/v1/monitoring/targets/{other['id']}/probe").status_code == 200
    fresh = client.get(f"/api/v1/monitoring/targets/{other['id']}").json()
    assert fresh["current"]["availability"]["initial_state_known"] is True
    assert fresh["current"]["availability"]["ever_reachable"] is False
    assert fresh["current"]["availability"]["observed_since"] == fresh["outages"][0]["opened_at"]


def test_overview_distinguishes_wan_outage_from_snmp_error_and_preserves_last_episode(environment):
    client, svc, device, now, user = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    detail = client.post(path + "/probe").json()
    interface = next(i for i in detail["interfaces"] if i["name"] == "ether1_wan")
    assert client.put(path + f"/interfaces/{interface['id']}", json={"role": "wan", "critical": True}).status_code == 200
    now[0] += timedelta(minutes=1)
    started = now[0]
    device.value = snapshot(1000, uptime=106000, oper=2)
    assert client.post(path + "/probe").status_code == 200
    now[0] += timedelta(minutes=1)
    assert client.post(path + "/probe").status_code == 200
    row = client.get("/api/v1/monitoring/overview").json()["targets"][0]
    assert row["current"]["status"] == "online"
    assert row["outages"][0]["kind"] == "link"
    assert row["outages"][0]["interface_name"] == "ether1_wan"
    assert row["outages"][0]["interface_role"] == "wan"
    assert row["outages"][0]["opened_at"] == started.isoformat()
    now[0] += timedelta(minutes=1)
    device.value = snapshot(2000, uptime=118000, oper=1)
    assert client.post(path + "/probe").status_code == 200
    restored = now[0].isoformat()
    for _ in range(2):
        now[0] += timedelta(minutes=1)
        device.value = {"snmp_status": "error", "error": "timeout", "ping": {"status": "online", "loss_pct": 0}}
        assert client.post(path + "/probe").status_code == 200
    row = client.get("/api/v1/monitoring/overview").json()["targets"][0]
    assert row["current"]["snmp_status"] == "error"
    assert [(e["kind"], e["closed_at"]) for e in row["outages"]] == [("link", restored)]


def test_existing_outage_without_observation_metadata_keeps_unknown_beginning(environment):
    client, svc, device, now, user = environment
    target = create_target(client)
    # Seed the shape written by the previous release: HTTP cannot create a legacy JSON shape.
    from backend.appdb.monitoring_models import MonitoringEvent, MonitoringTarget
    opened = now[0] - timedelta(hours=1)
    with svc.store.session() as session:
        row = session.get(MonitoringTarget, target["id"])
        row.current = {"checked_at": (now[0] - timedelta(minutes=1)).isoformat(), "failures": 3,
                       "status": "offline", "snmp_status": "error", "last_success_at": None}
        session.add(MonitoringEvent(id="legacy-outage", target_id=target["id"], interface_id="", kind="unreachable",
                    title="Устройство недоступно из HUB", severity="critical", opened_at=opened))
    device.value = {"snmp_status": "error", "error": "timeout", "ping": {"status": "offline", "loss_pct": 100}}
    assert client.post(f"/api/v1/monitoring/targets/{target['id']}/probe").status_code == 200
    current = client.get("/api/v1/monitoring/overview").json()["targets"][0]
    assert current["current"]["availability"]["initial_state_known"] is False
    assert current["current"]["availability"]["observed_since"] is None
    assert current["current"]["availability"]["unreachable_since"] == opened.isoformat()
    assert len(current["outages"]) == 1
    assert current["outages"][0]["opened_at"] == opened.isoformat()


def test_overview_expects_collector_when_it_runs_in_the_standalone_worker(environment, monkeypatch):
    client, *_ = environment
    monkeypatch.delenv("MONITORING_WORKER_EXTERNAL", raising=False)
    monkeypatch.setenv("MONITORING_BACKGROUND_ENABLED", "0")
    assert client.get("/api/v1/monitoring/overview").json()["worker"]["enabled"] is False

    # The API runs with the loop off; the worker process owns it, so the page must still watch the heartbeat.
    monkeypatch.setenv("MONITORING_WORKER_EXTERNAL", "1")
    assert client.get("/api/v1/monitoring/overview").json()["worker"]["enabled"] is True


def test_individual_section_permission_and_write_only_profile(environment):
    client, svc, device, now, user = environment
    target = create_target(client)
    profiles = client.get("/api/v1/monitoring/profiles")
    assert profiles.status_code == 200
    assert "test-only-community" not in profiles.text
    assert "community_enc" not in profiles.text
    with svc.store.session() as session:
        encrypted = session.scalar(select(MonitoringProfile.community_enc))
        assert encrypted != "test-only-community"
    user["value"] = User(id=11, username="operator", role="operator", is_active=True)
    assert client.get("/api/v1/monitoring/overview").status_code == 403
    user["value"] = User(id=11, username="reader", role="viewer", is_active=True,
                         use_custom_permissions=True, custom_permissions=["monitoring.read"])
    assert client.get("/api/v1/monitoring/overview").status_code == 200
    assert client.get(f"/api/v1/monitoring/targets/{target['id']}").status_code == 200
    assert client.get("/api/v1/monitoring/profiles").status_code == 403
    assert client.post(f"/api/v1/monitoring/targets/{target['id']}/probe").status_code == 403
    assert client.delete(f"/api/v1/monitoring/targets/{target['id']}").status_code == 403
    assert client.get(f"/api/v1/monitoring/targets/{target['id']}").status_code == 200
    override = app.dependency_overrides.pop(deps.get_current_active_user)
    try:
        assert client.delete(f"/api/v1/monitoring/targets/{target['id']}").status_code == 401
    finally:
        app.dependency_overrides[deps.get_current_active_user] = override
    user["value"] = User(id=11, username="reader", role="viewer", is_active=True)
    assert client.get(f"/api/v1/monitoring/targets/{target['id']}/history").status_code == 403


def test_interface_chart_counter_reset_and_separate_devices(environment):
    client, svc, device, now, user = environment
    a = create_target(client)
    b = create_target(client, 2, "10.105.42.2")
    for target in (a, b):
        response = client.post(f"/api/v1/monitoring/targets/{target['id']}/probe")
        assert response.status_code == 200, response.text
        assert len(response.json()["interfaces"]) == 2
    detail = client.get(f"/api/v1/monitoring/targets/{a['id']}").json()
    interface_id = next(i["id"] for i in detail["interfaces"] if i["name"] == "ether1_wan")
    now[0] += timedelta(seconds=60)
    device.value = snapshot(7_500_000, uptime=106000)
    result = client.post(f"/api/v1/monitoring/targets/{a['id']}/probe")
    assert result.status_code == 200, result.text
    history = client.get(f"/api/v1/monitoring/targets/{a['id']}/history", params={"interface_id": interface_id, "hours": 1})
    assert history.status_code == 200
    points = history.json()["points"]
    assert [p["rx_bps"] for p in points if p.get("rx_bps") is not None] == [1_000_000]
    now[0] += timedelta(seconds=60)
    device.value = snapshot(100, uptime=500)
    assert client.post(f"/api/v1/monitoring/targets/{a['id']}/probe").status_code == 200
    points = client.get(f"/api/v1/monitoring/targets/{a['id']}/history", params={"interface_id": interface_id, "hours": 1}).json()["points"]
    assert points[-1].get("rx_bps") is None
    assert len(client.get("/api/v1/monitoring/overview").json()["targets"]) == 2
    assert client.get(f"/api/v1/monitoring/targets/{b['id']}/history", params={"interface_id": interface_id}).status_code == 404


def test_speed_loss_recovery_no_duplicate_events_or_false_disabled_port_alarm(environment):
    client, svc, device, now, user = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    detail = client.post(path + "/probe").json()
    wan = next(i for i in detail["interfaces"] if i["name"] == "ether1_wan")
    configured = client.put(path + f"/interfaces/{wan['id']}", json={"critical": True, "role": "wan", "expected_link_bps": 1_000_000_000})
    assert configured.status_code == 200, configured.text
    for minute in (1, 2, 3):
        now[0] += timedelta(seconds=60)
        device.value = snapshot(minute * 1000, speed=100_000_000, uptime=100000 + minute * 6000)
        assert client.post(path + "/probe").status_code == 200
    events = client.get("/api/v1/monitoring/events").json()
    assert len(events) == 1
    assert events[0]["kind"] == "speed" and events[0]["closed_at"] is None
    # Recreate the service: pending rules, identity and open episodes live in DB.
    restarted = NetworkMonitorService(svc.store, device)
    restarted.clock = svc.clock
    app.dependency_overrides[monitoring.service] = lambda: restarted
    now[0] += timedelta(seconds=60)
    device.value = snapshot(5000, uptime=130000)
    assert client.post(path + "/probe").status_code == 200
    events = client.get("/api/v1/monitoring/events").json()
    assert len(events) == 1 and events[0]["closed_at"] is not None


def test_snmp_outage_preserves_values_without_drawing_zero_and_poll_retry_is_idempotent(environment):
    client, svc, device, now, user = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    assert client.post(path + "/probe").status_code == 200
    # Same observation timestamp cannot insert a second sample or overwrite newer data.
    assert client.post(path + "/probe").status_code == 200
    with svc.store.session() as session:
        assert len(list(session.scalars(select(MonitoringSample).where(MonitoringSample.target_id == target["id"])))) == 2
    old_success = client.get(path).json()["current"]["last_success_at"]
    now[0] += timedelta(seconds=60)
    device.value = {"snmp_status": "error", "error": "timeout", "ping": {"status": "online", "latency_ms": 40, "loss_pct": 0}}
    current = client.post(path + "/probe").json()["current"]
    assert current["status"] == "online" and current["snmp_status"] == "error"
    assert current["last_success_at"] == old_success
    history = client.get(path + "/history", params={"hours": 1}).json()
    assert history["points"][-1].get("cpu_pct") is None


def test_invalid_targets_and_history_ranges_are_rejected(environment):
    client, svc, device, now, user = environment
    profile = client.post("/api/v1/monitoring/profiles", json={"name": "Read", "community": "test-only-community"}).json()
    for address in ("127.0.0.1", "169.254.169.254", "224.0.0.1", "not-an-address"):
        response = client.post("/api/v1/monitoring/targets", json={"network_device_id": 1, "name": "A", "address": address, "profile_id": profile["id"]})
        assert response.status_code == 422
    target = create_target(client)
    assert client.get(f"/api/v1/monitoring/targets/{target['id']}/history?hours=1000000").status_code == 422


def test_devices_connect_without_registry_card_and_edit_keeps_existing_card(environment):
    client, svc, device, now, user = environment
    profile = client.post("/api/v1/monitoring/profiles", json={"name": "Read", "community": "test-only-community"}).json()
    carded = create_target(client)
    created = []
    for name, address in (("zsgp_belushka", "172.16.250.12"), ("zsgp_fishing", "172.16.250.23")):
        response = client.post("/api/v1/monitoring/targets", json={"name": name, "address": address, "profile_id": profile["id"]})
        assert response.status_code == 201, response.text
        assert response.json()["network_device_id"] is None
        created.append(response.json())
    assert {row["name"] for row in client.get("/api/v1/monitoring/overview").json()["targets"]} >= {"zsgp_belushka", "zsgp_fishing"}
    assert client.post(f"/api/v1/monitoring/targets/{created[0]['id']}/probe").status_code == 200
    update = {key: carded[key] for key in ("name", "address", "port", "profile_id", "enabled", "settings")}
    update["name"] = "Router renamed"
    renamed = client.put(f"/api/v1/monitoring/targets/{carded['id']}", json=update)
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["network_device_id"] == carded["network_device_id"]
    unknown = client.post("/api/v1/monitoring/targets", json={"network_device_id": 999999, "name": "X", "address": "172.16.250.99", "profile_id": profile["id"]})
    assert unknown.status_code == 400


def test_existing_target_is_editable_after_its_registry_card_left_the_registry(environment, monkeypatch):
    client, svc, device, now, user = environment
    target = create_target(client)
    monkeypatch.setattr(svc, "catalog", lambda: [])
    update = {key: target[key] for key in ("network_device_id", "name", "address", "port", "profile_id", "enabled", "settings")}
    update["settings"] = {**update["settings"], "icmp_timeout_ms": 2000}
    saved = client.put(f"/api/v1/monitoring/targets/{target['id']}", json=update)
    assert saved.status_code == 200, saved.text
    assert saved.json()["settings"]["icmp_timeout_ms"] == 2000
    other = client.post("/api/v1/monitoring/targets", json={**update, "network_device_id": 424242, "address": "172.16.250.77"})
    assert other.status_code == 400


def test_ports_the_device_stopped_reporting_leave_the_card_only_after_a_complete_discovery(environment):
    client, svc, device, now, user = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"

    def names():
        return {item["name"] for item in client.get(path).json()["interfaces"]}

    assert client.post(path + "/probe").status_code == 200
    assert names() == {"ether1_wan", "ether8"}
    gone = {**snapshot(), "interfaces": snapshot()["interfaces"][:1]}
    now[0] += timedelta(seconds=60)
    device.value = gone  # an incomplete discovery carries no "discovered_at" and must not prune
    assert client.post(path + "/probe").status_code == 200
    assert names() == {"ether1_wan", "ether8"}
    now[0] += timedelta(seconds=60)
    device.value = {**gone, "discovered_at": now[0].isoformat()}
    assert client.post(path + "/probe").status_code == 200
    assert names() == {"ether1_wan"}
    now[0] += timedelta(seconds=60)
    device.value = {**snapshot(), "discovered_at": now[0].isoformat()}
    assert client.post(path + "/probe").status_code == 200
    assert names() == {"ether1_wan", "ether8"}


def test_one_registry_card_cannot_be_connected_twice_and_address_change_resets_baseline(environment):
    client, svc, device, now, user = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    assert client.post(path + "/probe").status_code == 200
    payload = {key: target[key] for key in ("network_device_id", "name", "address", "port", "profile_id", "enabled", "settings")}
    payload["address"] = "172.16.250.29"
    assert client.post("/api/v1/monitoring/targets", json=payload).status_code == 400
    updated = client.put(path, json=payload)
    assert updated.status_code == 200, updated.text
    assert updated.json()["current"] == {}
    now[0] += timedelta(seconds=60)
    device.value = snapshot(10000000, uptime=106000)
    detail = client.post(path + "/probe").json()
    wan = next(i for i in detail["interfaces"] if i["name"] == "ether1_wan")
    assert wan["current"]["rx_bps"] is None
    assert len(client.get("/api/v1/monitoring/overview").json()["targets"]) == 1


def test_validation_never_echoes_secret_or_raw_request(environment):
    client, svc, device, now, user = environment
    marker = "write-only-sensitive-value"
    response = client.post("/api/v1/monitoring/profiles", json={"name": " ", "community": marker * 20})
    assert response.status_code == 422
    assert marker not in response.text
    assert all("input" not in error for error in response.json()["detail"])


def test_rollup_peaks_volume_and_retention_guard(environment):
    client, svc, device, now, user = environment
    now[0] -= timedelta(days=8)
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    detail = client.post(path + "/probe").json()
    wan = next(i for i in detail["interfaces"] if i["name"] == "ether1_wan")
    now[0] += timedelta(seconds=60)
    device.value = snapshot(7_500_000, uptime=106000)
    assert client.post(path + "/probe").status_code == 200
    now[0] += timedelta(days=8)
    history = client.get(path + "/history", params={"hours": 720, "interface_id": wan["id"]}).json()
    assert len(history["points"]) <= 1402
    assert history["totals"]["rx_bytes"] == 7_500_000
    assert history["totals"]["rx_seconds"] == 60
    assert max(p.get("rx_bps_max", 0) or 0 for p in history["points"]) == 1_000_000
    assert history["points"][-1].get("rx_bps") is None
    dry = svc.store.retention(now[0])
    assert dry["dry_run"] and dry["raw_eligible"] == 4
    with svc.store.session() as session:
        assert session.scalar(select(func.count()).select_from(MonitoringSample)) == 4
        session.execute(delete(MonitoringAggregate).where(MonitoringAggregate.interface_id == wan["id"], MonitoringAggregate.resolution == 300))
    applied = svc.store.retention(now[0], apply=True)
    assert applied["raw_eligible"] == 2 and applied["raw_without_rollups"] == 2
    with svc.store.session() as session:
        assert session.scalar(select(func.count()).select_from(MonitoringSample)) == 2


def test_config_change_during_probe_discards_late_result_and_parallel_probe_is_busy(environment):
    import asyncio
    import threading
    from concurrent.futures import ThreadPoolExecutor
    client, svc, device, now, user = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    entered, release = threading.Event(), threading.Event()
    async def blocked(*args, **kwargs):
        entered.set()
        assert await asyncio.to_thread(release.wait, 10)
        return snapshot()
    svc.probe.read = blocked
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(client.post, path + "/probe")
        assert entered.wait(10)
        try:
            assert client.post(path + "/probe").status_code == 409
            payload = {key: target[key] for key in ("network_device_id", "name", "address", "port", "profile_id", "enabled", "settings")}
            payload["enabled"] = False
            assert client.put(path, json=payload).status_code == 200
        finally:
            release.set()
        assert pending.result(timeout=10).status_code == 200
    assert client.get(path).json()["current"] == {}
    with svc.store.session() as session:
        assert session.scalar(select(func.count()).select_from(MonitoringSample)) == 0


def test_custom_history_range_and_missing_schema_fail_closed(environment, tmp_path):
    from sqlalchemy import inspect
    from backend.appdb.db import get_app_engine
    client, svc, device, now, user = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    detail = client.post(path + "/probe").json()
    start = now[0]
    wan = next(i for i in detail["interfaces"] if i["name"] == "ether1_wan")
    now[0] += timedelta(seconds=60)
    device.value = snapshot(7_500_000, uptime=106000)
    assert client.post(path + "/probe").status_code == 200
    params = {"interface_id": wan["id"], "start": start.isoformat(), "end": now[0].isoformat()}
    result = client.get(path + "/history", params=params)
    assert result.status_code == 200, result.text
    assert result.json()["totals"]["rx_bytes"] == 7_500_000
    assert client.get(path + "/history", params={"start": start.isoformat()}).status_code == 400
    assert client.get(path + "/history", params={**params, "end": (start - timedelta(minutes=1)).isoformat()}).status_code == 400
    url = f"sqlite:///{(tmp_path / 'unmigrated.sqlite3').as_posix()}"
    svc.store = MonitoringStore(url)
    response = client.get("/api/v1/monitoring/overview")
    assert response.status_code == 503
    assert inspect(get_app_engine(url)).get_table_names() == []


def test_fast_state_flapping_invalidates_counter_baseline(environment):
    client, svc, device, now, user = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    detail = client.post(path + "/probe").json()
    wan = next(i for i in detail["interfaces"] if i["name"] == "ether1_wan")
    assert client.put(path + f"/interfaces/{wan['id']}", json={"critical": True}).status_code == 200
    for change in range(1, 7):
        now[0] += timedelta(seconds=30)
        value = snapshot(change * 100000, uptime=100000 + change * 3000, oper=2 if change % 2 else 1)
        value["full"] = False
        svc.store.record(svc.store.detail(target["id"]), value, now[0])
    events = client.get("/api/v1/monitoring/events", params={"target_id": target["id"]}).json()
    assert len([e for e in events if e["kind"] == "flapping" and not e["closed_at"]]) == 1
    now[0] += timedelta(seconds=60)
    device.value = snapshot(7_500_000, uptime=124000)
    result = client.post(path + "/probe").json()
    assert next(i for i in result["interfaces"] if i["id"] == wan["id"])["current"]["rx_bps"] is None


def test_only_the_port_shown_on_the_device_card_is_saved_on_every_poll(environment):
    client, svc, device, now, user = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"

    def rows():
        return {i["name"]: i["current"] for i in client.post(path + "/probe").json()["interfaces"]}

    first = rows()
    now[0] += timedelta(seconds=30)
    second = rows()
    # Nothing is pinned, so the WAN port is the one the card shows.
    assert second["ether1_wan"]["checked_at"] != first["ether1_wan"]["checked_at"]
    assert second["ether8"]["checked_at"] == first["ether8"]["checked_at"]

    detail = client.get(path).json()
    pinned = next(row for row in detail["interfaces"] if row["name"] == "ether8")
    assert client.put(path + f"/interfaces/{pinned['id']}", json={**pinned["settings"], "pinned": True}).status_code == 200
    now[0] += timedelta(seconds=30)
    third = rows()
    assert third["ether8"]["checked_at"] != second["ether8"]["checked_at"]
    assert third["ether1_wan"]["checked_at"] == second["ether1_wan"]["checked_at"]

    device.value = {**snapshot(oper=2), "protocol": "snmp"}  # A state change is saved at once.
    now[0] += timedelta(seconds=30)
    fourth = rows()
    assert fourth["ether1_wan"]["oper"] == 2
    assert fourth["ether1_wan"]["checked_at"] != third["ether1_wan"]["checked_at"]

    now[0] += timedelta(seconds=300)  # An unchanged port is saved again once the period has passed.
    assert rows()["ether1_wan"]["checked_at"] != fourth["ether1_wan"]["checked_at"]


@pytest.mark.asyncio
async def test_record_writes_are_capped_while_database_is_slow(environment, monkeypatch):
    client, svc, device, now, user = environment
    monkeypatch.setenv("MONITORING_RECORD_CONCURRENCY", "2")
    running, peak = 0, 0

    def slow_record(*args, **kwargs):
        nonlocal running, peak
        running += 1
        peak = max(peak, running)
        time.sleep(0.05)
        running -= 1
        return True

    monkeypatch.setattr(svc.store, "record", slow_record)
    await asyncio.gather(*(svc._record({}, {}, now[0]) for _ in range(8)))

    assert peak == 2


def test_pinned_interface_persists_switches_and_stays_selected_when_link_is_down(environment):
    client, svc, device, now, user = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    detail = client.post(path + "/probe").json()
    wan, disabled = (next(row for row in detail["interfaces"] if row["name"] == name) for name in ("ether1_wan", "ether8"))
    response = client.put(path + f"/interfaces/{disabled['id']}", json={**disabled["settings"], "pinned": True})
    assert response.status_code == 200, response.text
    assert response.json()["target_summary"]["interface_id"] == disabled["id"]
    assert response.json()["target_summary"]["pinned"] is True
    assert response.json()["settings"]["critical"] is False
    svc.store = MonitoringStore(svc.store.database_url)  # A new store reads the persisted choice.
    assert client.get("/api/v1/monitoring/overview").json()["targets"][0]["summary"]["interface_id"] == disabled["id"]
    assert client.post(path + "/probe").status_code == 200
    # A client saving thresholds without the new field must keep the pin.
    edited = client.put(path + f"/interfaces/{disabled['id']}", json={"errors_warn_pps": 7})
    assert edited.json()["settings"]["pinned"] is True
    assert edited.json()["target_summary"]["interface_id"] == disabled["id"]
    for _ in range(2):
        assert client.put(path + f"/interfaces/{wan['id']}", json={**wan["settings"], "pinned": True}).status_code == 200
    interfaces = client.get(path).json()["interfaces"]
    assert [row["id"] for row in interfaces if row["settings"].get("pinned")] == [wan["id"]]
    assert client.put(path + f"/interfaces/{wan['id']}", json={**wan["settings"], "pinned": False}).status_code == 200
    assert not any(row["settings"].get("pinned") for row in client.get(path).json()["interfaces"])
    assert client.get("/api/v1/monitoring/overview").json()["targets"][0]["summary"]["interface_id"] == wan["id"]


def test_parallel_pins_leave_one_persisted_interface(environment):
    import threading
    from concurrent.futures import ThreadPoolExecutor

    client, svc, device, now, user = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    ports = client.post(path + "/probe").json()["interfaces"]
    start = threading.Barrier(2)

    def pin(port):
        start.wait(timeout=10)
        return client.put(path + f"/interfaces/{port['id']}", json={**port["settings"], "pinned": True})

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(pin, ports))
    assert [result.status_code for result in results] == [200, 200]
    saved = [row for row in client.get(path).json()["interfaces"] if row["settings"].get("pinned")]
    assert len(saved) == 1
    assert client.get("/api/v1/monitoring/overview").json()["targets"][0]["summary"]["interface_id"] == saved[0]["id"]


def test_pin_checks_interface_ownership_and_manage_permission(environment):
    client, svc, device, now, user = environment
    first, second = create_target(client), create_target(client, 2, "10.105.42.2")
    path = f"/api/v1/monitoring/targets/{first['id']}"
    first_port = client.post(path + "/probe").json()["interfaces"][0]
    second_port = client.post(f"/api/v1/monitoring/targets/{second['id']}/probe").json()["interfaces"][0]
    assert client.put(path + f"/interfaces/{second_port['id']}", json={"pinned": True}).status_code == 404
    assert client.put(path + f"/interfaces/{first_port['id']}", json={"pinned": None}).status_code == 422
    user["value"] = User(id=11, username="monitor-reader", role="operator", is_active=True,
                         use_custom_permissions=True, custom_permissions=["monitoring.read"])
    assert client.get(path).status_code == 200
    assert client.put(path + f"/interfaces/{first_port['id']}", json={"pinned": True}).status_code == 403
    assert not any(row["settings"].get("pinned") for row in client.get(path).json()["interfaces"])


def test_overview_card_summary_contains_real_gap_aware_interface_history(environment):
    client, svc, device, now, user = environment
    target = create_target(client)
    path = f"/api/v1/monitoring/targets/{target['id']}"
    assert client.post(path + "/probe").status_code == 200
    now[0] += timedelta(seconds=60)
    device.value = snapshot(7_500_000, uptime=106000)
    assert client.post(path + "/probe").status_code == 200
    response = client.get("/api/v1/monitoring/overview")
    assert response.status_code == 200
    card = response.json()["targets"][0]
    assert card["summary"]["name"] == "ether1_wan"
    assert card["summary"]["rx_bps"] == 1_000_000
    points = card["summary"]["points"]
    assert 72 <= len(points) <= 74
    assert points[0]["rx_bps"] is None
    assert [p["rx_bps"] for p in points if p["rx_bps"] is not None] == [1_000_000]
    assert "test-only-community" not in response.text
