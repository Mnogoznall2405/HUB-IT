"""Networks/Monitoring separation through real HTTP routes on isolated SQLite."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from backend.api import deps
from backend.api.v1 import monitoring, networks
from backend.main import app
from backend.models.auth import User
from backend.services import network_service as registry_module
from backend.services.network_monitor_service import NetworkMonitorService
from backend.services.network_monitor_store import MonitoringStore
from backend.services.secret_crypto_service import _build_fernet


class Probe:
    counter = 0

    async def read(self, target, community, *, full=True):
        self.counter += 1_000_000
        return {"snmp_status": "ok", "error": None, "full": full,
                "ping": {"status": "online", "latency_ms": 12, "loss_pct": 0},
                "device": {"sys_name": "isolated-router", "uptime_ticks": self.counter},
                "interfaces": [{"name": "ether1", "snmp_index": 1, "admin": 1, "oper": 1, "type": 6,
                                "speed_bps": 1_000_000_000, "rx_octets": self.counter, "tx_octets": self.counter // 2}]}


@pytest.fixture
def visibility_env(prebuilt_app_db, monkeypatch):
    monkeypatch.setenv("MAIL_CREDENTIALS_KEY", Fernet.generate_key().decode())
    _build_fernet.cache_clear()
    url = f"sqlite:///{prebuilt_app_db.as_posix()}"
    registry = registry_module.NetworkService(database_url=url)
    monkeypatch.setattr(registry_module, "network_service", registry)
    monkeypatch.setattr(networks, "network_service", registry)
    service = NetworkMonitorService(MonitoringStore(url), Probe())
    now = [datetime(2026, 10, 16, 6, 0, tzinfo=timezone.utc)]
    service.clock = lambda: now[0]
    app.dependency_overrides[deps.get_current_active_user] = lambda: User(id=10, username="isolated-admin", role="admin", is_active=True)
    app.dependency_overrides[monitoring.service] = lambda: service
    client = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
    branch = registry.ensure_branch(city_code="test", branch_code="visibility-test", name="Тестовый филиал")
    cards = []
    for code, vendor in (("Monitoring router", "MikroTik"), ("Existing router", "MikroTik"), ("Existing panel", "")):
        response = client.post("/api/v1/networks/devices", json={"branch_id": branch["id"], "device_code": code,
                               "device_type": "router" if vendor else "patch_panel", "vendor": vendor,
                               "site_code": "test-site", "mgmt_ip": f"192.0.2.{len(cards) + 1}"})
        assert response.status_code == 200, response.text
        cards.append(response.json())
    yield client, registry, service, now, branch, cards
    client.close()
    app.dependency_overrides.pop(deps.get_current_active_user, None)
    app.dependency_overrides.pop(monitoring.service, None)
    _build_fernet.cache_clear()


def mark_monitoring_only(registry, device_id):
    # Simulate the separately approved data marking operation on this test DB.
    with registry._connect() as connection:
        connection.execute("UPDATE network_devices SET monitoring_only=1 WHERE id=?", (device_id,))
        connection.commit()


def test_network_lists_and_counters_hide_only_explicitly_marked_equipment(visibility_env):
    client, registry, service, now, branch, cards = visibility_env
    hidden, ordinary, panel = cards
    prefix = f"/api/v1/networks/branches/{branch['id']}"
    for card in (hidden, ordinary):
        result = client.post("/api/v1/networks/ports", json={"device_id": card["id"], "port_name": "ether1", "endpoint_name_raw": "test endpoint"})
        assert result.status_code == 200, result.text
    before = client.get(prefix + "/overview").json()
    assert before["metrics"]["devices_count"] == 3
    assert before["metrics"]["ports_count"] == 2
    assert {row["id"] for row in client.get(prefix + "/devices").json()["devices"]} == {row["id"] for row in cards}

    mark_monitoring_only(registry, hidden["id"])
    expected = {ordinary["id"], panel["id"]}
    assert {row["id"] for row in client.get(prefix + "/devices").json()["devices"]} == expected
    summary = client.get(prefix + "/overview").json()
    assert summary["metrics"]["devices_count"] == 2
    assert summary["metrics"]["ports_count"] == summary["metrics"]["occupied_ports"] == 1
    assert summary["sites"][0]["devices_count"] == 2
    assert summary["sites"][0]["ports_count"] == 1
    for key in ("sockets_count", "maps_count", "map_points_count"):
        assert summary["metrics"][key] == before["metrics"][key]
    branches = client.get("/api/v1/networks/branches", params={"city": "test"}).json()["branches"]
    assert branches[0]["devices_count"] == 2
    assert branches[0]["ports_count"] == branches[0]["occupied_ports"] == 1
    assert client.get(f"/api/v1/networks/devices/{hidden['id']}/ports").json()["ports"] == []
    assert len(client.get(f"/api/v1/networks/devices/{ordinary['id']}/ports").json()["ports"]) == 1
    assert [row["device_id"] for row in client.get(prefix + "/ports").json()["ports"]] == [ordinary["id"]]
    assert {row["id"] for row in client.get("/api/v1/monitoring/catalog").json()} == {row["id"] for row in cards}


def test_hidden_router_keeps_polling_history_editing_and_reenrollment(visibility_env):
    client, registry, service, now, branch, cards = visibility_env
    device_id = cards[0]["id"]
    profile = client.post("/api/v1/monitoring/profiles", json={"name": "Isolated SNMP", "community": "test-community"})
    assert profile.status_code == 201, profile.text
    payload = {"network_device_id": device_id, "name": "Можайск", "address": "192.0.2.1", "profile_id": profile.json()["id"]}
    created = client.post("/api/v1/monitoring/targets", json=payload)
    assert created.status_code == 201, created.text
    target = created.json()
    path = f"/api/v1/monitoring/targets/{target['id']}"
    for step in range(2):
        now[0] += timedelta(minutes=1)
        assert client.post(path + "/probe").status_code == 200
    history = deepcopy(client.get(path + "/history").json())
    assert history["has_data"]
    mark_monitoring_only(registry, device_id)
    assert client.get(path + "/history").json() == history
    assert client.get("/api/v1/monitoring/overview").json()["targets"][0]["id"] == target["id"]
    assert client.put(path, json={**payload, "name": "Можайск — новое имя"}).status_code == 200
    now[0] += timedelta(minutes=1)
    assert client.post(path + "/probe").status_code == 200
    assert client.get(path + "/history").json()["has_data"]
    # Visibility persists across service instances and after removal from monitoring.
    restarted = registry_module.NetworkService(database_url=registry._database_url)
    assert device_id not in {row["id"] for row in restarted.list_devices(branch["id"])}
    assert client.delete(path).status_code == 204
    assert device_id not in {row["id"] for row in client.get(f"/api/v1/networks/branches/{branch['id']}/devices").json()["devices"]}
    readded = client.post("/api/v1/monitoring/targets", json=payload)
    assert readded.status_code == 201, readded.text
    assert readded.json()["id"] != target["id"]
