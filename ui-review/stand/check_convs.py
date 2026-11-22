"""Verify seeded conversations are visible to e2e_admin (mobile-style bearer)."""
import json
import urllib.request

API = "http://127.0.0.1:18001/api/v1"


def req(path, method="GET", payload=None, token=None, headers=None):
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    if token:
        h["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(
        API + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers=h, method=method,
    )
    return json.load(urllib.request.urlopen(r, timeout=20))


login = req("/auth/login", "POST",
            {"username": "e2e_admin", "password": "e2e-local-admin-pass"},
            headers={"X-Auth-Client": "mobile", "X-Client-Device-ID": "parity-probe-2"})
token = login["access_token"]

convs = req("/chat/conversations", token=token)
items = convs.get("items", convs if isinstance(convs, list) else [])
for c in items:
    print(c.get("id"), "|", c.get("kind") or c.get("type"), "|",
          c.get("title") or c.get("name"), "|", c.get("last_message_preview") or c.get("last_message", ""))
