from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api.v1 import vcs as vcs_module


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
