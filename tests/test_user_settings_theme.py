from pathlib import Path

from backend.services.settings_service import SettingsService


def test_user_settings_accept_system_theme_and_reject_unknown_value(tmp_path: Path):
    service = SettingsService(file_path=tmp_path / "web_user_settings.json")

    updated = service.update_user_settings(17, {"theme_mode": "system"})
    assert updated["theme_mode"] == "system"
    assert service.get_user_settings(17)["theme_mode"] == "system"

    unchanged = service.update_user_settings(17, {"theme_mode": "automatic-magic"})
    assert unchanged["theme_mode"] == "system"
