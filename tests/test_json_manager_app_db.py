from __future__ import annotations

import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.json_db import manager as json_manager_module
from backend.json_db.manager import (
    JSONDataManager,
    JsonStorageConfigurationError,
    validate_json_runtime_storage,
)


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'json_manager_app.db').as_posix()}"


class _FakeLocalStore:
    db_path = Path("legacy-json-store.sqlite")

    def __init__(self):
        self.documents = {}

    def load_json(self, filename, default_content=None):
        return self.documents.get(filename, default_content)

    def save_json(self, filename, data):
        self.documents[filename] = data
        return True

    def append_to_json(self, filename, record):
        self.documents.setdefault(filename, []).append(record)
        return True

    def update_json_array(self, filename, predicate, updater):
        updated = 0
        rows = self.documents.get(filename, [])
        for index, row in enumerate(rows):
            if predicate(row):
                rows[index] = updater(row)
                updated += 1
        return updated

    def get_json_files(self):
        return sorted(self.documents)


def test_json_data_manager_rejects_legacy_sqlite_in_production(monkeypatch, temp_dir):
    monkeypatch.setattr(json_manager_module.config.app, "environment", "production", raising=False)
    monkeypatch.setattr(json_manager_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(
        json_manager_module,
        "get_local_store",
        lambda **_: pytest.fail("production must not open the legacy JSON SQLite store"),
    )

    with pytest.raises(JsonStorageConfigurationError, match="APP_DATABASE_URL"):
        validate_json_runtime_storage()

    with pytest.raises(JsonStorageConfigurationError, match="APP_DATABASE_URL"):
        JSONDataManager(data_dir=Path(temp_dir) / "legacy-json")


def test_json_data_manager_keeps_legacy_sqlite_in_development(monkeypatch, temp_dir):
    fake_store = _FakeLocalStore()
    monkeypatch.setattr(json_manager_module.config.app, "environment", "development", raising=False)
    monkeypatch.setattr(json_manager_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(json_manager_module, "get_local_store", lambda **_: fake_store)

    manager = JSONDataManager(data_dir=Path(temp_dir) / "legacy-json")

    assert manager.store is fake_store
    assert manager.save_json("legacy.json", [{"id": 1}]) is True
    assert manager.append_to_json("legacy.json", {"id": 2}) is True
    assert manager.load_json("legacy.json", default_content=[]) == [{"id": 1}, {"id": 2}]
    assert manager.get_json_files() == ["legacy.json"]


def test_json_data_manager_allows_explicit_app_db_in_production(monkeypatch, temp_dir):
    monkeypatch.setattr(json_manager_module.config.app, "environment", "production", raising=False)
    monkeypatch.setattr(json_manager_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(
        json_manager_module,
        "get_local_store",
        lambda **_: pytest.fail("explicit app-db URL must not open the legacy JSON SQLite store"),
    )

    manager = JSONDataManager(data_dir=Path(temp_dir) / "data", database_url=_sqlite_url(temp_dir))

    assert manager.save_json("production_app_db.json", {"ok": True}) is True
    assert manager.load_json("production_app_db.json", default_content={}) == {"ok": True}


def test_json_data_manager_supports_app_db_backend(temp_dir):
    manager = JSONDataManager(data_dir=Path(temp_dir) / "data", database_url=_sqlite_url(temp_dir))

    assert manager.save_json("equipment_transfers.json", [{"serial_number": "SN-1", "new_employee": "Petrov"}]) is True
    assert manager.append_to_json("equipment_transfers.json", {"serial_number": "SN-2", "new_employee": "Sidorov"}) is True

    updated = manager.update_json_array(
        "equipment_transfers.json",
        lambda row: str(row.get("serial_number")) == "SN-1",
        lambda row: {**row, "new_employee": "Ivanov"},
    )
    assert updated == 1

    transfers = manager.load_json("equipment_transfers.json", default_content=[])
    assert isinstance(transfers, list)
    assert [item["serial_number"] for item in transfers] == ["SN-1", "SN-2"]
    assert transfers[0]["new_employee"] == "Ivanov"

    cartridge_db = {
        "hp laserjet 400": {
            "oem_cartridge": "CF280A",
            "compatible_models": [{"model": "CF280A", "description": "Black", "color": "Черный"}],
            "is_color": False,
        }
    }
    assert manager.save_json("cartridge_database.json", cartridge_db) is True
    assert manager.load_json("cartridge_database.json", default_content={}) == cartridge_db

    kb_articles = [
        {"id": "a1", "title": "VPN", "status": "published"},
        {"id": "a2", "title": "Mail", "status": "draft"},
    ]
    assert manager.save_json("kb_articles.json", kb_articles) is True
    assert len(manager.load_json("kb_articles.json", default_content=[])) == 2

    files = manager.get_json_files()
    assert "equipment_transfers.json" in files
    assert "cartridge_database.json" in files
    assert "kb_articles.json" in files
