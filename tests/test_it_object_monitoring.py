"""Object card «Мониторинг» tab through the real FastAPI app: only devices of that object, only for those with the section."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from cryptography.fernet import Fernet
from fastapi import Request
from fastapi.testclient import TestClient
from pydantic import SecretStr

from backend.api import deps
from backend.api.v1 import monitoring as monitoring_api
from backend.api.v1 import it_objects as it_objects_api
from backend.main import app
from backend.models.auth import User
from backend.services import network_monitor_service as monitor_module
from backend.services.it_objects_service import ItObjectsService
from backend.services.network_monitor_service import NetworkMonitorService
from backend.services.network_monitor_store import MonitoringStore
from backend.services.secret_crypto_service import _build_fernet
from tests.test_it_objects import ADMIN, BASE, COLLEAGUE, OBJECT_REF, OTHER_REF, OWNER, USERS, BRANCHES, _as, _assign_owner

MONITORING = "/api/v1/monitoring"


@pytest.fixture
def environment(prebuilt_app_db, monkeypatch):
    database_url = f"sqlite:///{prebuilt_app_db.as_posix()}"
    objects = ItObjectsService(database_url=database_url, source_db_id="OBJ-ITINVENT", branch_reader=lambda db_id: list(BRANCHES))
    store = MonitoringStore(database_url)
    monitoring = NetworkMonitorService(store, object())
    monitoring.clock = lambda: datetime(2026, 10, 30, 6, 0, tzinfo=timezone.utc)
    monkeypatch.setenv("MAIL_CREDENTIALS_KEY", Fernet.generate_key().decode())
    _build_fernet.cache_clear()
    profile = store.save_profile({"name": "Test read profile", "community": SecretStr("test-only-community")})

    async def current_user(request: Request) -> User:
        return User(**USERS[int(request.headers["X-Test-User"])])

    app.dependency_overrides[deps.get_current_active_user] = current_user
    monkeypatch.setattr(it_objects_api, "get_it_objects_service", lambda: objects)
    app.dependency_overrides[monitoring_api.service] = lambda: monitoring
    monkeypatch.setattr(monitor_module, "network_monitor_service", monitoring)
    monkeypatch.setattr(it_objects_api.user_service, "get_by_id", lambda user_id: dict(USERS[int(user_id)]) if int(user_id) in USERS else None)
    try:
        yield TestClient(app, base_url="https://testserver", raise_server_exceptions=False), store, profile["id"]
    finally:
        app.dependency_overrides.pop(deps.get_current_active_user, None)
        app.dependency_overrides.pop(monitoring_api.service, None)
        _build_fernet.cache_clear()


def _add_target(store, profile_id, name, address, object_ref):
    saved = store.save_target(
        {"name": name, "address": address, "profile_id": profile_id, "port": 161, "enabled": True,
         "settings": {}, "object_ref": object_ref}
    )
    return saved["id"]


def test_object_monitoring_lists_only_its_devices_and_needs_the_monitoring_section(environment):
    client, store, profile_id = environment
    _add_target(store, profile_id, "Router alpha", "10.0.0.1", OBJECT_REF)
    _add_target(store, profile_id, "Router beta", "10.0.0.2", OTHER_REF)
    _add_target(store, profile_id, "Router nobody", "10.0.0.3", None)
    assert _assign_owner(client).status_code == 200

    owner = client.get(f"{BASE}/{OBJECT_REF}/monitoring", headers=_as(OWNER))
    assert owner.status_code == 200, owner.text
    assert [item["name"] for item in owner.json()["targets"]] == ["Router alpha"]
    assert owner.json()["targets"][0]["object_ref"] == OBJECT_REF

    assert client.get(f"{BASE}/{OBJECT_REF}/monitoring", headers=_as(COLLEAGUE)).status_code == 403
    assert client.get(f"{BASE}/{OBJECT_REF}/monitoring", headers=_as(ADMIN)).status_code == 403

    grant = client.put(
        f"{BASE}/{OBJECT_REF}/grants", json={"user_id": COLLEAGUE, "section": "monitoring", "level": "view"}, headers=_as(OWNER)
    )
    assert grant.status_code == 200, grant.text
    granted = client.get(f"{BASE}/{OBJECT_REF}/monitoring", headers=_as(COLLEAGUE))
    assert [item["name"] for item in granted.json()["targets"]] == ["Router alpha"]
    # the grant is for that object only
    assert client.get(f"{BASE}/{OTHER_REF}/monitoring", headers=_as(COLLEAGUE)).status_code == 403


def test_assigning_a_device_to_an_object_survives_an_update_from_an_older_client(environment):
    client, store, profile_id = environment
    target_id = _add_target(store, profile_id, "Router alpha", "10.0.0.1", None)
    body = {"name": "Router alpha", "address": "10.0.0.1", "profile_id": profile_id}

    assigned = client.put(f"{MONITORING}/targets/{target_id}", json={**body, "object_ref": OBJECT_REF}, headers=_as(ADMIN))
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["object_ref"] == OBJECT_REF

    # an older client does not send the field: the device must stay on its object
    renamed = client.put(f"{MONITORING}/targets/{target_id}", json={**body, "name": "Router alpha 2"}, headers=_as(ADMIN))
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["object_ref"] == OBJECT_REF

    detached = client.put(f"{MONITORING}/targets/{target_id}", json={**body, "object_ref": None}, headers=_as(ADMIN))
    assert detached.json()["object_ref"] is None


def test_object_ref_migration_up_and_down():
    import runpy
    from pathlib import Path

    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    versions = Path(__file__).resolve().parents[1] / "WEB-itinvent" / "backend" / "alembic" / "versions"
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        connection.execute(sa.text("create table monitoring_targets (id varchar(36) primary key, name varchar(160))"))

        def run(name: str) -> None:
            operation = runpy.run_path(str(versions / "20261030_0153_monitoring_target_object_ref.py"))[name]
            operation.__globals__["op"] = operations
            operation.__globals__["_scope"] = lambda: "app"
            operation()

        def columns() -> set[str]:
            return {column["name"] for column in sa.inspect(connection).get_columns("monitoring_targets")}

        run("upgrade")
        run("upgrade")  # added "if missing": a second run is a no-op
        assert "object_ref" in columns()
        run("downgrade")
        assert "object_ref" not in columns() and "name" in columns()


def test_object_manager_attaches_free_devices_and_detaches_only_their_own(environment):
    client, store, profile_id = environment
    free = _add_target(store, profile_id, "Router free", "10.0.0.1", None)
    mine = _add_target(store, profile_id, "Router mine", "10.0.0.2", OBJECT_REF)
    other = _add_target(store, profile_id, "Router other", "10.0.0.3", OTHER_REF)
    assert _assign_owner(client).status_code == 200
    base = f"{BASE}/{OBJECT_REF}/monitoring"

    listed = client.get(f"{base}/free-devices", headers=_as(OWNER))
    assert [item["name"] for item in listed.json()["items"]] == ["Router free"]

    assert client.put(f"{base}/devices/{free}", headers=_as(OWNER)).status_code == 200
    assert client.put(f"{base}/devices/{free}", headers=_as(OWNER)).status_code == 200  # repeat is harmless
    assert [item["name"] for item in client.get(base, headers=_as(OWNER)).json()["targets"]] == ["Router free", "Router mine"]

    # a device of another object can be neither taken nor released from here
    assert client.put(f"{base}/devices/{other}", headers=_as(OWNER)).status_code == 409
    assert client.delete(f"{base}/devices/{other}", headers=_as(OWNER)).status_code == 409
    assert client.put(f"{base}/devices/no-such-device", headers=_as(OWNER)).status_code == 404

    assert client.delete(f"{base}/devices/{mine}", headers=_as(OWNER)).status_code == 200
    assert client.delete(f"{base}/devices/{mine}", headers=_as(OWNER)).status_code == 200
    assert [item["name"] for item in client.get(f"{base}/free-devices", headers=_as(OWNER)).json()["items"]] == ["Router mine"]

    # view-only access reads the tab but cannot change it
    client.put(f"{BASE}/{OBJECT_REF}/grants", json={"user_id": COLLEAGUE, "section": "monitoring", "level": "view"}, headers=_as(OWNER))
    assert client.get(base, headers=_as(COLLEAGUE)).status_code == 200
    assert client.get(f"{base}/free-devices", headers=_as(COLLEAGUE)).status_code == 403
    assert client.put(f"{base}/devices/{mine}", headers=_as(COLLEAGUE)).status_code == 403
    assert client.delete(f"{base}/devices/{free}", headers=_as(COLLEAGUE)).status_code == 403


def test_object_member_reads_device_details_without_global_monitoring_access_and_only_for_that_object(environment):
    client, store, profile_id = environment
    mine = _add_target(store, profile_id, "Router mine", "10.0.0.2", OBJECT_REF)
    other = _add_target(store, profile_id, "Router other", "10.0.0.3", OTHER_REF)
    assert _assign_owner(client).status_code == 200
    scoped = f"{BASE}/{OBJECT_REF}/monitoring/targets"

    # the owner has no global monitoring.read permission (role "operator"), yet reads the device of the object
    detail = client.get(f"{scoped}/{mine}", headers=_as(OWNER))
    assert detail.status_code == 200, detail.text
    assert detail.json()["name"] == "Router mine" and "events" in detail.json()
    assert client.get(f"{scoped}/{mine}/history", params={"hours": 1}, headers=_as(OWNER)).status_code == 200
    assert client.get(f"{scoped}/{mine}/latency-history", params={"hours": 1}, headers=_as(OWNER)).status_code == 200
    assert client.get(f"{MONITORING}/targets/{mine}", headers=_as(OWNER)).status_code == 403  # the global API stays closed

    # a device of another object, an unknown device and a person without the section are all refused
    assert client.get(f"{scoped}/{other}", headers=_as(OWNER)).status_code == 404
    assert client.get(f"{scoped}/{other}/history", headers=_as(OWNER)).status_code == 404
    assert client.get(f"{scoped}/no-such", headers=_as(OWNER)).status_code == 404
    assert client.get(f"{scoped}/{mine}", headers=_as(COLLEAGUE)).status_code == 403
