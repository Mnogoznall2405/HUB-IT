"""Second uvicorn worker on the SAME .state-v3 DB (no wipe, no seed).

Used for the 1-vs-N workers comparison: backend #1 keeps owning state setup,
this process just serves the API against the existing SQLite files.
Run: python e2e/stack/local_worker.py  (env E2E_WORKER_PORT, default 18014)
"""
import os
import sys
from pathlib import Path

STACK_DIR = Path(__file__).resolve().parent
STATE_DIR = STACK_DIR / ".state-v3"
PORT = int(os.environ.get("E2E_WORKER_PORT", "18014"))

os.environ.update(
    {
        "APP_ENV": "development",
        "APP_DATABASE_URL": f"sqlite:///{(STATE_DIR / 'app.sqlite3').as_posix()}",
        "CHAT_DATABASE_URL": f"sqlite:///{(STATE_DIR / 'chat.sqlite3').as_posix()}",
        "CHAT_MODULE_ENABLED": "1",
        "CHAT_REALTIME_TRANSPORT": "local",
        "HUBIT_RUNTIME_ROLE": "embedded",
        "JWT_SECRET_KEY": "e2e-local-jwt-secret-not-for-production",
        "AUTH_COOKIE_SECURE": "false",
        "AUTH_2FA_ENFORCED": "0",
        "AUTH_2FA_POLICY": "off",
        "AUTH_2FA_INTERNAL_CIDRS": "10.0.0.0/8,127.0.0.0/8,::1/128",
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
        "MY_FILES_INLINE_WORKER_ENABLED": "0",
        "WINDOWS_SSO_ENABLED": "0",
        "CORS_ORIGINS": "http://127.0.0.1:5184",
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
        "TASK_EMAIL_AUTODISPATCH_ENABLED": "0",
        "AUTH_NEW_LOGIN_EMAIL_ENABLED": "0",
        "REDIS_URL": "",
        "MAIL_CREDENTIALS_KEY": "gQZ2l2zH2p3K9mJ8xN4vB7cD1fG5hJ6kL8mN0pQ3rS4tU5vW6xY7zA1bC2dE3fG4hI=",
        "MY_FILES_SHARE_TOKEN_KEY": "sH7jK2lM4nP6qR8sT0uV2wX4yZ6aB8cD0eF2gH4iJ6kL8mN0pQ2rS4tU6vW8xY0zA=",
    }
)

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
import uvicorn  # noqa: E402

uvicorn.run("backend.main:app", host="127.0.0.1", port=PORT, log_level="warning")
