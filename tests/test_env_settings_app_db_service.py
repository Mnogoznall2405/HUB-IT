from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.env_settings_service import EnvSettingsService


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'env_settings_app.db').as_posix()}"


def test_env_settings_service_supports_app_db_backend(temp_dir):
    base = Path(temp_dir)
    env_path = base / ".env"
    env_path.write_text(
        "JWT_SECRET_KEY=old-secret-value\n"
        "SESSION_IDLE_TIMEOUT_MINUTES=30\n",
        encoding="utf-8",
    )

    service = EnvSettingsService(
        env_path=env_path,
        audit_db_path=base / "legacy_audit.sqlite3",
        database_url=_sqlite_url(temp_dir),
    )

    response = service.update_variables(
        {
            "JWT_SECRET_KEY": "new-secret-value",
            "SESSION_IDLE_TIMEOUT_MINUTES": "45",
        },
        actor_user_id=5,
        actor_username="admin",
    )

    assert response["updated"] == 2
    recent = {item["key"]: item for item in service.get_recent_changes(limit=10)}
    assert recent["SESSION_IDLE_TIMEOUT_MINUTES"]["new_value_masked"] == "45"
    assert recent["JWT_SECRET_KEY"]["new_value_masked"] != "new-secret-value"
