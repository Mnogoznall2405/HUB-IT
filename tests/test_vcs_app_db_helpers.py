from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import vcs as vcs_module
from backend.models.auth import User


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'vcs_app.db').as_posix()}"


def test_vcs_helpers_support_app_db_storage(temp_dir, monkeypatch):
    monkeypatch.setattr("backend.appdb.db.config.app_db.database_url", _sqlite_url(temp_dir), raising=False)

    computers = [
        {
            "id": "vcs-1",
            "name": "Terminal 1",
            "ip_address": "10.0.0.10",
            "location": "Hall",
            "created_at": "2026-03-27T10:00:00+00:00",
            "updated_at": "2026-03-27T10:00:00+00:00",
        }
    ]
    assert vcs_module._save_all_computers(computers) is True
    assert vcs_module._get_all_computers() == computers

    config_payload = {"password_hex_encrypted": "enc-value"}
    info_payload = {"content": "VCS info"}

    assert vcs_module._save_vcs_config(config_payload) is True
    assert vcs_module._save_vcs_info(info_payload) is True
    assert vcs_module._get_vcs_config() == config_payload
    assert vcs_module._get_vcs_info() == info_payload


def _make_user(*, role: str = "operator", permissions: list[str] | None = None) -> User:
    return User(
        id=1,
        username="operator",
        email="operator@example.com",
        full_name="Operator",
        is_active=True,
        role=role,
        permissions=permissions or [],
    )


def _vcs_client(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(vcs_module.router, prefix="/vcs")
    app.dependency_overrides[deps.get_current_active_user] = lambda: user
    return TestClient(app)


def test_vcs_config_status_does_not_decrypt_or_return_password(monkeypatch):
    monkeypatch.setattr(vcs_module, "_get_vcs_config", lambda: {"password_hex_encrypted": "encrypted-value"})

    def fail_decrypt(_value):
        raise AssertionError("config status must not decrypt VCS password")

    monkeypatch.setattr(vcs_module, "decrypt_secret", fail_decrypt)

    response = _vcs_client(_make_user(permissions=["vcs.read"])).get("/vcs/config")

    assert response.status_code == 200
    assert response.json() == {"password_hex": "", "password_configured": True}


def test_vcs_config_update_does_not_echo_password(monkeypatch):
    saved_payload: dict = {}

    monkeypatch.setattr(vcs_module, "_get_vcs_config", lambda: {})
    monkeypatch.setattr(vcs_module, "encrypt_secret", lambda value: f"enc:{value}")
    monkeypatch.setattr(vcs_module, "_save_vcs_config", lambda payload: saved_payload.update(payload) or True)

    response = _vcs_client(_make_user(permissions=["vcs.manage"])).put(
        "/vcs/config",
        json={"password_hex": "0123456789abcdef"},
    )

    assert response.status_code == 200
    assert response.json() == {"password_hex": "", "password_configured": True}
    assert saved_payload == {"password_hex_encrypted": "enc:0123456789abcdef"}


def test_vcs_info_redacts_passwords_for_read_only_users(monkeypatch):
    content = json.dumps(
        [
            {
                "agent": "Vendor",
                "server": "10.0.0.10",
                "login": "operator",
                "password": "shared-password",
                "contact1": "help@example.com",
            }
        ]
    )
    monkeypatch.setattr(vcs_module, "_get_vcs_info", lambda: {"content": content})

    read_response = _vcs_client(_make_user(permissions=["vcs.read"])).get("/vcs/info")
    manage_response = _vcs_client(_make_user(permissions=["vcs.read", "vcs.manage"])).get("/vcs/info")

    assert read_response.status_code == 200
    read_rows = json.loads(read_response.json()["content"])
    assert "password" not in read_rows[0]
    assert "shared-password" not in read_response.text

    assert manage_response.status_code == 200
    manage_rows = json.loads(manage_response.json()["content"])
    assert manage_rows[0]["password"] == "shared-password"


def test_vcs_launch_token_is_one_time_and_keeps_password_out_of_token_response(monkeypatch):
    computer = {
        "id": "vcs-1",
        "name": "Meeting Room",
        "ip_address": "10.0.0.10:5901",
        "location": "HQ",
        "created_at": "2026-03-27T10:00:00+00:00",
        "updated_at": "2026-03-27T10:00:00+00:00",
    }

    class FakeRuntimeStore:
        def __init__(self):
            self.payloads = {}

        def set_json(self, namespace, key, payload, ttl_seconds=None):
            self.payloads[(namespace, key)] = payload

        def pop_json(self, namespace, key):
            return self.payloads.pop((namespace, key), None)

    runtime_store = FakeRuntimeStore()
    monkeypatch.setattr(vcs_module, "_get_all_computers", lambda: [computer])
    monkeypatch.setattr(vcs_module, "_decrypt_vcs_password_hex", lambda: "0123456789abcdef")
    monkeypatch.setattr(vcs_module, "auth_runtime_store_service", runtime_store)

    client = _vcs_client(_make_user(permissions=["vcs.read"]))
    token_response = client.post("/vcs/computers/vcs-1/launch-token")

    assert token_response.status_code == 200
    assert "0123456789abcdef" not in token_response.text
    token = token_response.json()["token"]

    file_response = client.get(f"/vcs/launch/{token}.vnc")
    assert file_response.status_code == 200
    assert "host=10.0.0.10" in file_response.text
    assert "port=5901" in file_response.text
    assert "password=0123456789abcdef" in file_response.text

    replay_response = client.get(f"/vcs/launch/{token}.vnc")
    assert replay_response.status_code == 404


def _seed(name: str, comp_id: str) -> dict:
    return {
        "id": comp_id,
        "name": name,
        "ip_address": "10.0.0.1",
        "location": "",
        "created_at": "2026-03-27T10:00:00+00:00",
        "updated_at": "2026-03-27T10:00:00+00:00",
    }


def test_vcs_changes_do_not_wipe_rows_added_by_another_process(temp_dir, monkeypatch):
    """Another worker added a row after this request read its snapshot (stale view)."""
    monkeypatch.setattr("backend.appdb.db.config.app_db.database_url", _sqlite_url(temp_dir), raising=False)
    real_get_all = vcs_module._get_all_computers
    other = _seed("Added elsewhere", "vcs-other")
    target = _seed("Target", "vcs-target")
    assert vcs_module._save_all_computers([other, target]) is True

    client = _vcs_client(_make_user(permissions=["vcs.read", "vcs.manage"]))
    # The request-time snapshot does not know about the row another worker inserted.
    monkeypatch.setattr(vcs_module, "_get_all_computers", lambda: [dict(target)])

    created = client.post("/vcs/computers", json={"name": "New", "ip_address": "10.0.0.9"})
    assert created.status_code == 200
    assert client.put("/vcs/computers/vcs-target", json={"location": "Hall"}).status_code == 200

    ids = {item["id"] for item in real_get_all()}
    assert {"vcs-other", "vcs-target", created.json()["id"]} <= ids
    assert next(i for i in real_get_all() if i["id"] == "vcs-target")["location"] == "Hall"

    assert client.delete("/vcs/computers/vcs-target").status_code == 200
    assert client.delete("/vcs/computers/vcs-target").status_code == 404
    ids_after = {item["id"] for item in real_get_all()}
    assert "vcs-other" in ids_after and created.json()["id"] in ids_after
    assert "vcs-target" not in ids_after


def test_vcs_json_mode_concurrent_changes_do_not_lose_rows(monkeypatch):
    """JSON mode rewrites the whole list: parallel request threads must not overwrite each other."""
    import threading
    import time

    class SlowStore:
        def __init__(self):
            self.data: list = []

        def load_json(self, key, default_content=None):
            snapshot = [dict(item) for item in self.data]
            time.sleep(0.02)  # a widening window between "read" and "write"
            return snapshot

        def save_json(self, key, data):
            self.data = [dict(item) for item in data]
            return True

    store = SlowStore()
    monkeypatch.setattr(vcs_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(vcs_module, "get_local_store", lambda: store)

    threads = [
        threading.Thread(target=vcs_module._create_computer, args=(_seed(f"T{i}", f"vcs-{i}"),))
        for i in range(8)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(item["id"] for item in store.data) == sorted(f"vcs-{i}" for i in range(8))

    deleters = [threading.Thread(target=vcs_module._delete_computer, args=(f"vcs-{i}",)) for i in range(4)]
    updaters = [
        threading.Thread(target=vcs_module._update_computer, args=(f"vcs-{i}", {"location": "L"}))
        for i in range(4, 8)
    ]
    for thread in deleters + updaters:
        thread.start()
    for thread in deleters + updaters:
        thread.join()
    assert sorted(item["id"] for item in store.data) == [f"vcs-{i}" for i in range(4, 8)]
    assert all(item["location"] == "L" for item in store.data)
