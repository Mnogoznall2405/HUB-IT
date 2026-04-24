from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

network_service_module = importlib.import_module("backend.services.network_service")


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'network_app.db').as_posix()}"


def test_network_service_supports_app_db_backend(temp_dir, monkeypatch):
    store = SimpleNamespace(db_path=str(Path(temp_dir) / "legacy_network.sqlite3"))
    monkeypatch.setattr(network_service_module, "get_local_store", lambda: store)

    service = network_service_module.NetworkService(database_url=_sqlite_url(temp_dir))

    created = service.create_branch_with_profile(
        city_code="tmn",
        branch_code="tmn-p19",
        name="Первомайская 19",
        panel_count=2,
        ports_per_panel=4,
        default_site_code="p19",
        db_id="main-db",
        actor_user_id=1,
        actor_role="admin",
    )

    branch = created["branch"]
    profile = created["profile"]
    assert branch["branch_code"] == "tmn-p19"
    assert profile["branch_id"] == branch["id"]

    branches = service.list_branches("tmn")
    assert len(branches) == 1
    assert branches[0]["db_id"] == "main-db"

    device = service.create_device(
        branch_id=int(branch["id"]),
        payload={
            "device_code": "sw-1",
            "device_type": "switch",
            "site_code": "p19",
            "site_name": "Первомайская 19",
        },
        actor_user_id=1,
        actor_role="admin",
    )
    assert device["device_code"] == "sw-1"

    port = service.create_port(
        device_id=int(device["id"]),
        payload={
            "port_name": "Gi0/1",
            "patch_panel_port": "1/1",
            "endpoint_name_raw": "Desk 1",
            "endpoint_ip_raw": "10.10.10.5",
            "endpoint_mac_raw": "AA-BB-CC-DD-EE-FF",
        },
        actor_user_id=1,
        actor_role="admin",
    )
    assert port["port_name"] == "Gi0/1"

    sockets = service.list_sockets(int(branch["id"]))
    assert sockets
    assert any(item["socket_code"] == "1/1" for item in sockets)

    ports = service.list_ports(int(device["id"]))
    assert len(ports) == 1
    assert ports[0]["port_name"] == "Gi0/1"

    uploaded_map = service.upload_map(
        branch_id=int(branch["id"]),
        file_name="layout.png",
        mime_type="image/png",
        file_bytes=b"fake-image-bytes",
        site_code="p19",
        site_name="Первомайская 19",
        title="Основная схема",
        floor_label="1 этаж",
        source_path=None,
        actor_user_id=1,
        actor_role="admin",
    )
    assert uploaded_map["file_name"] == "layout.png"

    maps = service.list_maps(int(branch["id"]))
    assert len(maps) == 1
    assert maps[0]["file_name"] == "layout.png"
