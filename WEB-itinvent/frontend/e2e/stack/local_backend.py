"""Local E2E backend: real ``backend.main:app`` on a throwaway SQLite DB.

Started by Playwright ``webServer`` when ``E2E_LOCAL=1``. Everything the app
needs is created here before uvicorn boots: environment, schema, seed users
and the ticket dictionaries the UI lists. Nothing reaches the production
database — app/chat runtime state lives in ``e2e/stack/.state/`` and is wiped
on every run.

Seed users (test-only credentials, never real accounts):
    e2e_admin / e2e-local-admin-pass   (role=admin)
    e2e_user  / e2e-local-user-pass    (role=operator)
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import sys
from pathlib import Path

STACK_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = STACK_DIR.parent.parent
WEB_ROOT = FRONTEND_DIR.parent
STATE_NAME = os.environ.get("E2E_STATE_NAME", ".state")
if not STATE_NAME.startswith(".state") or Path(STATE_NAME).name != STATE_NAME:
    raise RuntimeError("E2E state must be a .state directory immediately below stack/")
STATE_DIR = STACK_DIR / STATE_NAME
APP_DB = STATE_DIR / "app.sqlite3"
CHAT_DB = STATE_DIR / "chat.sqlite3"

BACKEND_PORT = int(os.environ.get("E2E_BACKEND_PORT", "18001"))

# Environment must be set before any backend import — config and services
# snapshot os.environ at import time. Explicit assignment (not setdefault):
# a developer's root .env must not leak real endpoints into the test stack.
os.environ.update(
    {
        "APP_ENV": "development",
        "APP_DATABASE_URL": f"sqlite:///{APP_DB.as_posix()}",
        "CHAT_DATABASE_URL": f"sqlite:///{CHAT_DB.as_posix()}",
        "CHAT_MODULE_ENABLED": "1",
        "CHAT_REALTIME_TRANSPORT": "local",
        "CHAT_SURFACE": "full",
        "HUBIT_RUNTIME_ROLE": "embedded",
        "JWT_SECRET_KEY": "e2e-local-jwt-secret-not-for-production",
        "AUTH_COOKIE_SECURE": "false",
        # Background loops that would otherwise reach for LDAP / SQL Server /
        # external services — none of that exists in the test stack.
        "LDAP_SYNC_BACKGROUND_ENABLED": "0",
        "LDAP_APP_USER_SYNC_ENABLED": "0",
        "AD_GROUPS_ACCESS_SYNC_ENABLED": "0",
        "ADDRESS_BOOK_SYNC_ENABLED": "0",
        "WAREHOUSE_1C_CATALOG_SYNC_ENABLED": "0",
        "TASK_DUE_NOTIFICATION_BACKGROUND_ENABLED": "0",
        "DOCFLOW_NOTIFICATION_BACKGROUND_ENABLED": "0",
        "ANNOUNCEMENT_PUBLISH_BACKGROUND_ENABLED": "0",
        "MFU_RUNTIME_MONITOR_ENABLED": "0",
        "MONITORING_BACKGROUND_ENABLED": "0",
        "MONITORING_RETENTION_APPLY": "0",
        "MAIL_MODULE_ENABLED": "0",
        "MAIL_NOTIFICATION_BACKGROUND_ENABLED": "0",
        "MY_FILES_INLINE_WORKER_ENABLED": "1" if os.environ.get("E2E_FILES_WORKER") == "1" else "0",
        "WINDOWS_SSO_ENABLED": "0",
        # The seed users have no second factor; the browser login flow is the
        # contract under test, not the 2FA enrollment wizard. The root .env
        # ships AUTH_2FA_POLICY=external_only and loopback is outside the
        # internal CIDRs, so both the flag and the policy must be off.
        "AUTH_2FA_ENFORCED": "0",
        "AUTH_2FA_POLICY": "off",
        # Loopback counts as the internal network zone: skips the per-IP
        # login rate limit (5/min) that a multi-spec run would hit.
        "AUTH_2FA_INTERNAL_CIDRS": "10.0.0.0/8,127.0.0.0/8,::1/128",
        # Browser uploads send Origin: http://127.0.0.1:5174 (the Playwright
        # baseURL host) — my_files upload rejects origins outside cors_origins,
        # and the root .env points at production hosts.
        "CORS_ORIGINS": f"http://127.0.0.1:{os.environ.get('E2E_FRONTEND_PORT', '5174')},http://localhost:{os.environ.get('E2E_FRONTEND_PORT', '5174')}",
        # File writes must stay inside .state — otherwise uploads and chat
        # attachments land in the developer's real data/ directory.
        "HUB_DATA_DIR": str(STATE_DIR / "hub_data"),
        "MY_FILES_STORAGE_DIR": str(STATE_DIR / "my_files"),
        "MY_FILES_SPOOL_DIR": str(STATE_DIR / "my_files_spool"),
        "MY_FILES_PREVIEWS_DIR": str(STATE_DIR / "my_files_previews"),
        "SQL_SERVER_HOST": "127.0.0.1",
        "SQL_SERVER_DATABASE": "HUB_IT_E2E_UNAVAILABLE",
        "SQL_SERVER_USERNAME": "",
        "SQL_SERVER_PASSWORD": "",
        "SQL_SERVER_DRIVER": "HUB_IT_E2E_DISABLED_DRIVER",
        "WAREHOUSE_1C_PROCESS_BRIDGE_ENABLED": "0",
        "BUH20_1C_USER": "",
        "BUH20_1C_PASSWORD": "",
        "TASK_EMAIL_AUTODISPATCH_ENABLED": "0",
        "AUTH_NEW_LOGIN_EMAIL_ENABLED": "0",
        "REDIS_URL": "",
        "REDIS_PASSWORD": "",
        "RATE_LIMIT_STORAGE_URL": "",
    }
)

for database_id in ('ITINVENT', 'MSK-ITINVENT', 'OBJ-ITINVENT', 'SPB-ITINVENT'):
    os.environ.update({
        f'DB_{database_id}_HOST': '127.0.0.1',
        f'DB_{database_id}_DATABASE': 'HUB_IT_E2E_UNAVAILABLE',
        f'DB_{database_id}_USERNAME': '',
        f'DB_{database_id}_PASSWORD': '',
    })

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def _seed() -> None:
    """Fresh schema + deterministic fixtures for the browser flows."""
    shutil.rmtree(STATE_DIR, ignore_errors=True)
    if APP_DB.exists() or CHAT_DB.exists():
        raise RuntimeError("E2E SQLite files are busy; choose an unused E2E_STATE_NAME")
    STATE_DIR.mkdir(parents=True, exist_ok=True)

    for database_path in (APP_DB, CHAT_DB):
        with sqlite3.connect(database_path) as connection:
            journal_mode = connection.execute('PRAGMA journal_mode=WAL').fetchone()[0]
            if str(journal_mode).lower() != 'wal':
                raise RuntimeError(f'E2E database did not enable WAL: {database_path.name}')

    if str(WEB_ROOT.parent) not in sys.path:
        sys.path.insert(0, str(WEB_ROOT.parent))
    from local_store import get_local_store
    get_local_store(data_dir=STATE_DIR / 'local_store')

    from backend.appdb.db import app_session, initialize_app_schema
    from backend.appdb.tickets_models import TicketEmployee, TicketObject
    from backend.chat.db import initialize_chat_schema
    from backend.services.user_service import user_service

    initialize_app_schema()
    initialize_chat_schema()

    for username, password, role, full_name in (
        ("e2e_admin", "e2e-local-admin-pass", "admin", "E2E Админ"),
        ("e2e_user", "e2e-local-user-pass", "operator", "E2E Пользователь"),
        # Fresh account: no about_onboarding_completed_at — drives the
        # /about onboarding gate and its return-path flow in auth-guards.
        ("e2e_fresh", "e2e-local-fresh-pass", "operator", "E2E Новый"),
    ):
        if user_service.get_by_username(username) is None:
            user_service.create_user(
                username,
                password=password,
                role=role,
                full_name=full_name,
                email=f"{username}@example.com",
            )

    assert user_service.authenticate("e2e_admin", "e2e-local-admin-pass"), (
        "seeded user cannot authenticate — user_service did not persist to the app DB"
    )

    # Admin logins are restricted to an IP allowlist stored in app settings;
    # the shipped default only covers the production admin host. Allow the
    # loopback addresses the test stack actually sees.
    from backend.services.app_settings_service import app_settings_service

    allowed = app_settings_service.get_admin_login_allowed_ips()
    for ip in ("127.0.0.1", "::1"):
        if ip not in allowed:
            allowed.append(ip)
    app_settings_service.update_settings({"admin_login_allowed_ips": allowed})

    from datetime import datetime, timezone
    from sqlalchemy import select

    from backend.appdb.models import AppUser

    now = datetime.now(timezone.utc)
    with app_session() as session:
        # create_user leaves about_onboarding_completed_at NULL, and the SPA
        # force-redirects such users to /about until onboarding is done.
        # e2e_fresh intentionally keeps NULL — it plays the first-login user.
        for row in session.scalars(select(AppUser)).all():
            if row.username != "e2e_fresh" and row.about_onboarding_completed_at is None:
                row.about_onboarding_completed_at = now

        if session.query(TicketObject).count() == 0:
            session.add_all(
                [
                    TicketObject(
                        code="MSK", name="Москва", region="Центр",
                        is_active=True, created_at=now, updated_at=now,
                    ),
                    TicketEmployee(
                        full_name="Иванов Иван Иванович", date_of_birth_enc="",
                        status="active", created_at=now, updated_at=now,
                    ),
                ]
            )


def main() -> None:
    _seed()
    if os.environ.get("E2E_AI_RELIABILITY") == "1":
        from ai_reliability_seed import seed_ai_reliability
        seed_ai_reliability(STATE_DIR)
    if os.environ.get("E2E_MONITORING_SEED") == "1":
        from monitoring_seed import seed_monitoring
        seed_monitoring()

    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host="127.0.0.1",
        port=BACKEND_PORT,
        log_level="warning",
        loop="asyncio",
    )


if __name__ == "__main__":
    main()
