"""Shared derivation for the loopback docflow gateway authentication token."""
from __future__ import annotations

import hashlib
import hmac
import os


def docflow_gateway_token() -> str:
    explicit = str(os.getenv("DOCFLOW_GATEWAY_TOKEN", "") or "").strip()
    if len(explicit) >= 32:
        return explicit
    credential_key = str(os.getenv("DOCFLOW_CREDENTIALS_KEY", "") or "").strip()
    if len(credential_key) < 32:
        return ""
    return hmac.new(
        credential_key.encode("utf-8"),
        b"hub-it:docflow-gateway:v1",
        hashlib.sha256,
    ).hexdigest()
