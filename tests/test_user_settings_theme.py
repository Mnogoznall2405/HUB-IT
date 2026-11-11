from pathlib import Path

from backend.services.settings_service import SettingsService


def test_user_settings_accept_system_theme_and_reject_unknown_value(tmp_path: Path):
    service = SettingsService(file_path=tmp_path / "web_user_settings.json")

    updated = service.update_user_settings(17, {"theme_mode": "system"})
    assert updated["theme_mode"] == "system"
    assert service.get_user_settings(17)["theme_mode"] == "system"

    unchanged = service.update_user_settings(17, {"theme_mode": "automatic-magic"})
    assert unchanged["theme_mode"] == "system"


def test_theme_defaults_to_system_and_keeps_an_explicit_choice(tmp_path: Path):
    """R39: a user who never chose a theme follows the OS; a saved choice is not touched."""
    service = SettingsService(file_path=tmp_path / "web_user_settings.json")

    assert service.get_user_settings(31)["theme_mode"] == "system"

    service.update_user_settings(32, {"theme_mode": "light"})
    assert service.get_user_settings(32)["theme_mode"] == "light"
    service.update_user_settings(33, {"theme_mode": "dark"})
    assert service.get_user_settings(33)["theme_mode"] == "dark"
    # an unrelated setting must not reset the stored theme to the default
    service.update_user_settings(32, {"font_scale": 1.1})
    assert service.get_user_settings(32)["theme_mode"] == "light"


def test_settings_response_model_default_theme_is_system():
    from backend.api.v1.settings import UserSettingsResponse

    assert UserSettingsResponse().theme_mode == "system"


def test_mobile_bottom_nav_accepts_native_module_paths(tmp_path: Path):
    service = SettingsService(file_path=tmp_path / "web_user_settings.json")

    native_paths = ["/feed", "/docflow", "/warehouse-1c", "/company-structure"]
    updated = service.update_user_settings(17, {"mobile_bottom_nav_items": native_paths})
    assert updated["mobile_bottom_nav_items"] == native_paths
    assert service.get_user_settings(17)["mobile_bottom_nav_items"] == native_paths

    reverted = service.update_user_settings(17, {"mobile_bottom_nav_items": ["/unknown-screen"]})
    assert reverted["mobile_bottom_nav_items"] == []
