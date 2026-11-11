"""Lazy exports for backend services.

Avoid importing every service module at package import time.
Several service modules initialize storage and other runtime dependencies
while importing, so eager imports can stall unrelated module loads.
"""

from __future__ import annotations

from importlib import import_module

_SERVICE_EXPORTS = {
    "user_service": ".user_service",
    "session_service": ".session_service",
    "settings_service": ".settings_service",
    "app_settings_service": ".app_settings_service",
    "env_settings_service": ".env_settings_service",
    "user_db_selection_service": ".user_db_selection_service",
    "network_service": ".network_service",
    "authorization_service": ".authorization_service",
    "kb_service": ".kb_service",
    "hub_service": ".hub_service",
    "transfer_act_reminder_service": ".transfer_act_reminder_service",
    "session_auth_context_service": ".session_auth_context_service",
    "auth_runtime_store_service": ".auth_runtime_store_service",
    "auth_security_service": ".auth_security_service",
    "twofa_service": ".twofa_service",
    "trusted_device_service": ".trusted_device_service",
    "security_email_service": ".security_email_service",
}

__all__ = list(_SERVICE_EXPORTS)


def __getattr__(name: str):
    module_path = _SERVICE_EXPORTS.get(name)
    if module_path is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = import_module(module_path, __name__)
    value = getattr(module, name)
    globals()[name] = value
    return value
