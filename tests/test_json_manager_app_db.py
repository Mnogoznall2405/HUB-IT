from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.json_db.manager import JSONDataManager


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'json_manager_app.db').as_posix()}"


def test_json_data_manager_supports_app_db_backend(temp_dir):
    manager = JSONDataManager(data_dir=Path(temp_dir) / "data", database_url=_sqlite_url(temp_dir))

    assert manager.save_json("unfound_equipment.json", [{"serial_number": "SN-1", "employee_name": "Petrov"}]) is True
    assert manager.append_to_json("unfound_equipment.json", {"serial_number": "SN-2", "employee_name": "Sidorov"}) is True

    updated = manager.update_json_array(
        "unfound_equipment.json",
        lambda row: str(row.get("serial_number")) == "SN-1",
        lambda row: {**row, "employee_name": "Ivanov"},
    )
    assert updated == 1

    unfound = manager.load_json("unfound_equipment.json", default_content=[])
    assert isinstance(unfound, list)
    assert [item["serial_number"] for item in unfound] == ["SN-1", "SN-2"]
    assert unfound[0]["employee_name"] == "Ivanov"

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
    assert "unfound_equipment.json" in files
    assert "cartridge_database.json" in files
    assert "kb_articles.json" in files
