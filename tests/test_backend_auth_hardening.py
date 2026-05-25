from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

import backend.config as backend_config_module
from backend.config import Config, ConfigurationError


def _clear_auth_env(monkeypatch) -> None:
    for key in (
        "APP_ENV",
        "ENVIRONMENT",
        "JWT_SECRET_KEY",
        "JWT_SECRET_KEYS",
        "JWT_PREVIOUS_SECRET_KEYS",
        "AUTH_COOKIE_SECURE",
        "AUTH_NEW_LOGIN_EMAIL_ENABLED",
    ):
        monkeypatch.delenv(key, raising=False)


def test_production_rejects_placeholder_jwt_secret(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("JWT_SECRET_KEYS", "NEW_SECRET,OLD_SECRET")
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "true")

    with pytest.raises(ConfigurationError, match="JWT_SECRET"):
        Config.from_env()


def test_production_rejects_insecure_auth_cookie(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("JWT_SECRET_KEYS", f"{'a' * 64},{'b' * 64}")
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "false")

    with pytest.raises(ConfigurationError, match="AUTH_COOKIE_SECURE"):
        Config.from_env()


def test_development_keeps_legacy_auth_defaults(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "false")

    loaded = Config.from_env()

    assert loaded.app.environment == "development"
    assert loaded.app.auth_cookie_secure is False
    assert loaded.jwt.secret_key == "your-secret-key-change-in-production"
    assert loaded.security.new_login_email_enabled is False


def test_new_login_email_notifications_are_disabled_by_default(monkeypatch):
    _clear_auth_env(monkeypatch)

    loaded = Config.from_env()

    assert loaded.security.new_login_email_enabled is False


def test_new_login_email_notifications_require_explicit_enable(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("AUTH_NEW_LOGIN_EMAIL_ENABLED", "1")

    loaded = Config.from_env()

    assert loaded.security.new_login_email_enabled is True


def _runtime_module_for_test(monkeypatch):
    monkeypatch.setattr(backend_config_module.config.app, "environment", "test", raising=False)
    return importlib.import_module("backend.services.auth_runtime_store_service")


def test_auth_runtime_store_rejects_missing_app_db_in_production(monkeypatch):
    runtime_module = _runtime_module_for_test(monkeypatch)
    monkeypatch.setattr(runtime_module.config.app, "environment", "production", raising=False)
    monkeypatch.setattr(runtime_module, "is_app_database_configured", lambda: False)

    with pytest.raises(runtime_module.AuthRuntimeConfigurationError, match="APP_DATABASE_URL"):
        runtime_module.AuthRuntimeStoreService()


def test_auth_runtime_store_rejects_unreachable_app_db_in_production(monkeypatch):
    runtime_module = _runtime_module_for_test(monkeypatch)
    monkeypatch.setattr(runtime_module.config.app, "environment", "production", raising=False)
    monkeypatch.setattr(runtime_module, "is_app_database_configured", lambda: True)

    def fail_initialize(_database_url=None):
        raise RuntimeError("db unavailable")

    monkeypatch.setattr(runtime_module, "initialize_app_schema", fail_initialize)

    with pytest.raises(runtime_module.AuthRuntimeConfigurationError, match="reachable"):
        runtime_module.AuthRuntimeStoreService()


def test_auth_runtime_store_allows_memory_fallback_in_development(monkeypatch):
    runtime_module = _runtime_module_for_test(monkeypatch)
    monkeypatch.setattr(runtime_module.config.app, "environment", "development", raising=False)
    monkeypatch.setattr(runtime_module, "is_app_database_configured", lambda: False)

    service = runtime_module.AuthRuntimeStoreService()

    assert service.backend_name == "memory"


def _user_service_module_for_test(monkeypatch):
    monkeypatch.setattr(backend_config_module.config.app, "environment", "test", raising=False)
    local_store_module = importlib.import_module("local_store")
    monkeypatch.setattr(local_store_module, "_STORE_SINGLETON", None, raising=False)
    module = importlib.import_module("backend.services.user_service")
    return importlib.reload(module)


def test_user_service_rejects_default_users_in_production(temp_dir, monkeypatch):
    user_module = _user_service_module_for_test(monkeypatch)
    monkeypatch.setattr(user_module.config.app, "environment", "production", raising=False)
    monkeypatch.setattr(user_module, "is_app_database_configured", lambda: False)

    with pytest.raises(user_module.UserBootstrapConfigurationError, match="empty in production"):
        user_module.UserService(file_path=Path(temp_dir) / "web_users.json")


def test_user_service_rejects_unreadable_users_store_in_production(temp_dir, monkeypatch):
    user_module = _user_service_module_for_test(monkeypatch)
    monkeypatch.setattr(user_module.config.app, "environment", "production", raising=False)
    monkeypatch.setattr(user_module, "is_app_database_configured", lambda: False)

    def fail_load(_self):
        raise RuntimeError("store unavailable")

    monkeypatch.setattr(user_module.UserService, "_load_users", fail_load)

    with pytest.raises(user_module.UserBootstrapConfigurationError, match="cannot be loaded"):
        user_module.UserService(file_path=Path(temp_dir) / "web_users.json")


def test_user_service_keeps_default_users_in_development(temp_dir, monkeypatch):
    user_module = _user_service_module_for_test(monkeypatch)
    monkeypatch.setattr(user_module.config.app, "environment", "development", raising=False)
    monkeypatch.setattr(user_module, "is_app_database_configured", lambda: False)

    service = user_module.UserService(file_path=Path(temp_dir) / "web_users.json")

    assert service.authenticate("admin", "admin")["username"] == "admin"
