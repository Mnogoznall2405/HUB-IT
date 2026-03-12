from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.env_settings_service import (  # noqa: E402
    TARGET_BACKEND,
    TARGET_FRONTEND,
    TARGET_TELEGRAM_BOT,
    EnvSettingsService,
)


def test_list_variables_includes_hyphenated_db_alias_and_frontend_targets(temp_dir):
    base = Path(temp_dir)
    env_path = base / ".env"
    env_path.write_text(
        "DB_MSK-ITINVENT_HOST=sql01\n"
        "VITE_API_URL=http://127.0.0.1:8001/api\n",
        encoding="utf-8",
    )

    service = EnvSettingsService(env_path=env_path, audit_db_path=base / "audit.db")
    items = {item["key"]: item for item in service.list_variables()}

    assert "DB_MSK-ITINVENT_HOST" in items
    assert TARGET_BACKEND in items["DB_MSK-ITINVENT_HOST"]["apply_targets"]
    assert TARGET_TELEGRAM_BOT in items["DB_MSK-ITINVENT_HOST"]["apply_targets"]
    assert items["VITE_API_URL"]["apply_targets"] == [TARGET_FRONTEND]
    assert items["VITE_API_URL"]["requires_frontend_build"] is True


def test_update_variables_returns_apply_plan_and_masks_sensitive_audit(temp_dir):
    base = Path(temp_dir)
    env_path = base / ".env"
    env_path.write_text(
        "JWT_SECRET_KEY=old-secret-value\n"
        "SESSION_IDLE_TIMEOUT_MINUTES=30\n",
        encoding="utf-8",
    )

    service = EnvSettingsService(env_path=env_path, audit_db_path=base / "audit.db")
    response = service.update_variables(
        {
            "JWT_SECRET_KEY": "new-secret-value",
            "SESSION_IDLE_TIMEOUT_MINUTES": "45",
        },
        actor_user_id=5,
        actor_username="admin",
    )

    apply_targets = {item["target"] for item in response["apply_plan"]}
    assert TARGET_BACKEND in apply_targets

    recent_changes = {item["key"]: item for item in response["recent_changes"]}
    assert recent_changes["JWT_SECRET_KEY"]["actor_username"] == "admin"
    assert "длина" in recent_changes["JWT_SECRET_KEY"]["old_value_masked"]
    assert "длина" in recent_changes["JWT_SECRET_KEY"]["new_value_masked"]
    assert recent_changes["SESSION_IDLE_TIMEOUT_MINUTES"]["old_value_masked"] == "30"
    assert recent_changes["SESSION_IDLE_TIMEOUT_MINUTES"]["new_value_masked"] == "45"


def test_update_variables_supports_empty_values(temp_dir):
    base = Path(temp_dir)
    env_path = base / ".env"
    env_path.write_text(
        "MAIL_PASSWORD=secret\n"
        "SMTP_FROM_NAME=IT Invent\n",
        encoding="utf-8",
    )

    service = EnvSettingsService(env_path=env_path, audit_db_path=base / "audit.db")
    service.update_variables(
        {"SMTP_FROM_NAME": ""},
        actor_user_id=1,
        actor_username="root",
    )

    written_text = env_path.read_text(encoding="utf-8")
    assert "SMTP_FROM_NAME=\n" in written_text


def test_list_variables_exposes_agent_specific_descriptions(temp_dir):
    base = Path(temp_dir)
    env_path = base / ".env"
    env_path.write_text(
        "SCAN_AGENT_SCAN_ON_START=0\n"
        "SCAN_AGENT_WATCHDOG_ENABLED=0\n"
        "ITINV_OUTLOOK_SEARCH_ROOTS=D:\\\n",
        encoding="utf-8",
    )

    service = EnvSettingsService(env_path=env_path, audit_db_path=base / "audit.db")
    items = {item["key"]: item for item in service.list_variables()}

    assert "scan_now" in items["SCAN_AGENT_SCAN_ON_START"]["description"]
    assert "D:\\" in items["ITINV_OUTLOOK_SEARCH_ROOTS"]["description"]
    assert "realtime watchdog" in items["SCAN_AGENT_WATCHDOG_ENABLED"]["description"]
