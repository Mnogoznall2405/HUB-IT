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
