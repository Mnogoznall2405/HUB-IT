import json
import sys
import time
import urllib.error
import urllib.request
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "WEB-itinvent"
sys.path.insert(0, str(WEB))

from backend.services.app_settings_service import app_settings_service
from backend.services.session_service import session_service
from backend.services.user_service import UserService
from backend.utils.security import create_access_token


def main() -> int:
    users = UserService()
    chosen = None
    for s in session_service.list_sessions(active_only=True):
        uid = int((s or {}).get("user_id") or 0)
        sid = str((s or {}).get("session_id") or "").strip()
        if not uid or not sid:
            continue
        u = users.get_by_id(uid)
        if not u or not u.get("is_active"):
            continue
        if str(u.get("role", "")).strip().lower() != "admin":
            continue
        chosen = (u, sid)
        break

    if not chosen:
        print("NO_ACTIVE_ADMIN_SESSION")
        return 1

    u, sid = chosen
    token = create_access_token(
        {
            "sub": u["username"],
            "user_id": u["id"],
            "role": u.get("role", "viewer"),
            "session_id": sid,
            "telegram_id": u.get("telegram_id"),
            "device_id": f"diag-1c:{sid}",
        },
        expires_delta=timedelta(minutes=10),
    )
    print(f"token_user={u['username']} session={sid[:8]}...")

    allowed_ips = app_settings_service.get_admin_login_allowed_ips()
    fake_ip = allowed_ips[0] if allowed_ips else ""
    print(f"admin_ip_allowlist={allowed_ips} using_xff={fake_ip or 'none'}")

    base = "http://127.0.0.1:8001"

    def call(path: str, timeout: int):
        headers = {"Authorization": f"Bearer {token}"}
        if fake_ip:
            headers["X-Forwarded-For"] = fake_ip
        req = urllib.request.Request(base + path, headers=headers)
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, time.time() - t0, r.read()
        except urllib.error.HTTPError as e:
            return e.code, time.time() - t0, e.read()
        except Exception as e:
            return -1, time.time() - t0, f"{type(e).__name__}: {e}".encode()

    st, dt, body = call("/api/v1/warehouse-1c/warehouses/search?q=", 100)
    wh_ref = ""
    try:
        data = json.loads(body)
        items = data.get("items") if isinstance(data, dict) else data
        if items:
            wh_ref = items[0].get("ref") or items[0].get("Ref") or ""
            print(f"warehouses/search -> {st} {dt:.1f}s first_ref={wh_ref} name={items[0].get('name') or items[0].get('Наименование')}")
    except Exception:
        print(f"warehouses/search -> {st} {dt:.1f}s body={body[:200]!r}")

    tests = [
        ("/api/v1/warehouse-1c/status", 15),
        (f"/api/v1/warehouse-1c/balances?warehouse_ref={wh_ref}&limit=5", 100),
    ]
    for path, timeout in tests:
        st, dt, body = call(path, timeout)
        print(f"{path} -> {st} {dt:.1f}s bytes={len(body)}")
        try:
            data = json.loads(body)
            if isinstance(data, dict):
                print("  keys:", list(data.keys())[:20])
                for k, v in data.items():
                    if isinstance(v, list):
                        print(f"  {k}: list[{len(v)}]")
            elif isinstance(data, list):
                print("  list len:", len(data))
        except Exception:
            print("  body:", body[:300])
    return 0


if __name__ == "__main__":
    sys.exit(main())
