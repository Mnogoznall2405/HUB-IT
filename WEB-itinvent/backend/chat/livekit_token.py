"""LiveKit access tokens (JWT, HS256) built with the standard library only.

LiveKit authenticates a participant with a JWT signed by the API secret: ``iss`` is the API key,
``sub`` the participant identity and the ``video`` claim holds the room grant. The signing key must
never be logged or returned to a client.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any, Optional


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _json_segment(value: dict[str, Any]) -> str:
    return _b64url(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def build_livekit_token(
    *,
    api_key: str,
    api_secret: str,
    identity: str,
    name: str,
    room: str,
    ttl_sec: int,
    now: Optional[float] = None,
) -> str:
    """Return a signed join token for ``room`` valid for ``ttl_sec`` seconds."""
    if not api_key or not api_secret:
        raise ValueError("LiveKit API key and secret are required")
    if not identity or not room:
        raise ValueError("identity and room are required")
    if int(ttl_sec) <= 0:
        raise ValueError("ttl_sec must be positive")
    issued_at = int(time.time() if now is None else now)
    claims = {
        "iss": api_key,
        "sub": identity,
        "nbf": issued_at,
        "exp": issued_at + int(ttl_sec),
        "name": name,
        "video": {
            "roomJoin": True,
            "room": room,
            "canPublish": True,
            "canSubscribe": True,
            "canPublishData": False,
        },
    }
    signing_input = f"{_json_segment({'alg': 'HS256', 'typ': 'JWT'})}.{_json_segment(claims)}"
    signature = hmac.new(api_secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url(signature)}"
