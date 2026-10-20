"""Every /api route answers an anonymous caller with 401/403 unless it is on the reviewed public list.

A new route that forgets its auth dependency shows up here as an unexpected 2xx/4xx. Extending PUBLIC_ROUTES is a
security review decision: each entry is public by design (sign-in flows, share-link tokens, key-gated agent ingest,
loopback-only metrics).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.main import app  # noqa: E402

PUBLIC_ROUTES = {
    # sign-in flows and pre-login bootstrap
    "GET /api/v1/auth/avatars/{filename}",
    "GET /api/v1/auth/login-mode",
    "GET /api/v1/auth/mobile-web-session/bootstrap",
    "GET /api/v1/auth/sso/callback",
    "POST /api/v1/auth/enable-2fa",
    "POST /api/v1/auth/login",
    "POST /api/v1/auth/mobile-biometric/session",
    "POST /api/v1/auth/mobile-web-session/consume",
    "POST /api/v1/auth/passkey-login/options",
    "POST /api/v1/auth/passkey-login/verify",
    "POST /api/v1/auth/safari-password-beacon",
    "POST /api/v1/auth/session-telemetry",
    "POST /api/v1/auth/trusted-devices/auth/options",
    "POST /api/v1/auth/trusted-devices/auth/verify",
    "POST /api/v1/auth/verify-2fa",
    "POST /api/v1/auth/verify-2fa-login",
    # share-link tokens (the token is the credential)
    "GET /api/v1/my-files/download-grant/{token}",
    "GET /api/v1/my-files/public-folders/{token}",
    "GET /api/v1/my-files/public-folders/{token}/files/{file_id}/preview",
    "GET /api/v1/my-files/public-folders/{token}/files/{file_id}/preview/content",
    "GET /api/v1/my-files/public/{token}",
    "GET /api/v1/my-files/public/{token}/download",
    "GET /api/v1/my-files/public/{token}/preview",
    "GET /api/v1/my-files/public/{token}/preview/content",
    "POST /api/v1/my-files/public-folders/{token}/archive-grant",
    "POST /api/v1/my-files/public-folders/{token}/files/{file_id}/download-grant",
    "GET /api/v1/vcs/launch/{token}.vnc",
    # key-gated machine endpoints (API key checked inside the handler)
    "POST /api/v1/inventory",
    "POST /api/v1/debug/client-log",
    # loopback-only (the test client is a loopback caller)
    "GET /api/v1/system/request-metrics/local",
    "POST /api/v1/system/request-metrics/local/reset",
}


def test_anonymous_callers_are_rejected_everywhere_except_the_reviewed_public_routes():
    client = TestClient(app, base_url="https://testserver", raise_server_exceptions=False)
    not_rejected: set[str] = set()
    for route in app.routes:
        methods = getattr(route, "methods", None)
        path = getattr(route, "path", None)
        if not methods or not path or not path.startswith("/api/"):
            continue
        url = re.sub(r"\{[^}]+\}", "1", path)
        for method in sorted(methods - {"HEAD", "OPTIONS"}):
            if client.request(method, url).status_code not in (401, 403):
                not_rejected.add(f"{method} {path}")

    unexpected = sorted(not_rejected - PUBLIC_ROUTES)
    assert not unexpected, f"routes answer anonymous callers without 401/403: {unexpected}"
    stale = sorted(PUBLIC_ROUTES - not_rejected)
    assert not stale, f"PUBLIC_ROUTES lists routes that are now protected or gone: {stale}"
