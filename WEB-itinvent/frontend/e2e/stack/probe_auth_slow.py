"""Time each piece of the auth dependency in-process against the V3 stand DB."""
import os
import sys
import time
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parents[3]
STATE_DIR = WEB_ROOT / "frontend" / "e2e" / "stack" / ".state-v3"
APP_DB = STATE_DIR / "app.sqlite3"
CHAT_DB = STATE_DIR / "chat.sqlite3"

os.environ.update({
    "APP_ENV": "development",
    "APP_DATABASE_URL": f"sqlite:///{APP_DB.as_posix()}",
    "CHAT_DATABASE_URL": f"sqlite:///{CHAT_DB.as_posix()}",
    "JWT_SECRET_KEY": "e2e-local-jwt-secret-not-for-production",
    "AUTH_COOKIE_SECURE": "false",
    "REDIS_URL": "",
    "REDIS_PASSWORD": "",
    "MAIL_CREDENTIALS_KEY": "tuu66l0sZCwQ7WhBoftdwXdG1McfKY4Yu6FuI592hKU=",
    "HUB_DATA_DIR": str(STATE_DIR / "hub_data"),
    "SQL_SERVER_DRIVER": "HUB_IT_E2E_DISABLED_DRIVER",
    "SQL_SERVER_HOST": "127.0.0.1",
})
sys.path.insert(0, str(WEB_ROOT))

import json
import urllib.request

def t(label, fn):
    t0 = time.perf_counter()
    try:
        r = fn()
        print(f"{label}: {(time.perf_counter()-t0)*1000:.0f}ms -> {type(r).__name__}")
        return r
    except Exception as e:
        print(f"{label}: {(time.perf_counter()-t0)*1000:.0f}ms EXC {type(e).__name__}: {str(e)[:80]}")
        return None

# grab a real access token cookie via login
req = urllib.request.Request(
    "http://localhost:18013/api/v1/auth/login", method="POST",
    data=json.dumps({"username": "e2e_admin", "password": "e2e-local-admin-pass"}).encode(),
    headers={"Content-Type": "application/json"})
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
resp = opener.open(req, timeout=30)
cookie = resp.headers.get("set-cookie", "")
token = [p.split("=", 1)[1] for p in cookie.split(";") if p.strip().startswith("itinvent_access_token=")]
raw = resp.read()

from backend.utils.security import decode_access_token
from backend.services.user_service import user_service
from backend.services.session_service import session_service
from backend.services.trusted_device_service import trusted_device_service
from backend.services.auth_runtime_store_service import auth_runtime_store_service
from backend.services.app_settings_service import app_settings_service

# decode token from the cookie header string
all_cookies = resp.headers.get_all("set-cookie") or []
token = ""
for c in all_cookies:
    for part in c.split(";"):
        part = part.strip()
        if part.startswith("itinvent_access_token="):
            token = part.split("=", 1)[1]
print("token len", len(token))

td = t("decode_access_token", lambda: decode_access_token(token, expected_token_type="access"))
uid = td.user_id if td else None
print("uid", uid, "sid", getattr(td, "session_id", None))

t("is_jti_revoked", lambda: auth_runtime_store_service.is_jti_revoked(td.jti))
u = t("user_service.get_by_id", lambda: user_service.get_by_id(uid))
t("session_active_for_user", lambda: session_service.is_session_active_for_user(td.session_id, uid))
t("is_token_device_valid", lambda: trusted_device_service.is_token_device_valid(user_id=uid, token_device_id=td.device_id))
t("touch_session_nowait", lambda: session_service.touch_session_nowait(td.session_id))
t("to_public_user", lambda: user_service.to_public_user(u))
pub = user_service.to_public_user(u)
from backend.api.deps import effective_public_permissions, ensure_admin_ip_allowed
t("effective_public_permissions", lambda: effective_public_permissions(pub))
t("ensure_admin_ip_allowed", lambda: ensure_admin_ip_allowed(pub, client_ip="127.0.0.1", via_forwarded_header=False, entrypoint="session", status_code=403, detail="x"))
t("admin_login_allowed_ips", lambda: app_settings_service.get_admin_login_allowed_ips())
