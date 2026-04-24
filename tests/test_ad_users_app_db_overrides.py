from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services import ad_users_service as ad_module


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'ad_overrides.db').as_posix()}"


def test_ad_branch_overrides_support_app_db_storage(temp_dir, monkeypatch):
    monkeypatch.setattr("backend.appdb.db.config.app_db.database_url", _sqlite_url(temp_dir), raising=False)

    assert ad_module.set_ad_user_branch("User.One", 17) is True
    assert ad_module._load_custom_branch_mappings() == {"user.one": 17}

    assert ad_module.set_ad_user_branch("User.One", None) is True
    assert ad_module._load_custom_branch_mappings() == {}
