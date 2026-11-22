"""Пробник: mobile-логин возвращает bearer-пару в JSON (как ждёт HubApiClient)."""
import json
import urllib.request

req = urllib.request.Request(
    "http://127.0.0.1:18001/api/v1/auth/login",
    data=json.dumps({"username": "e2e_admin", "password": "e2e-local-admin-pass"}).encode(),
    headers={
        "Content-Type": "application/json",
        "X-Auth-Client": "mobile",
        "X-Client-Device-ID": "parity-probe-1",
    },
)
d = json.load(urllib.request.urlopen(req, timeout=20))
safe = {k: (str(v)[:40] + "..." if isinstance(v, str) and len(v) > 40 else v) for k, v in d.items()}
print(json.dumps(safe, ensure_ascii=False, indent=1))
