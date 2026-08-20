from __future__ import annotations

import os
from pathlib import Path
import sys

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.secret_crypto_service import SecretCryptoError, _as_fernet_key, _build_fernet


def test_production_placeholder_mail_credentials_key_is_rejected(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(SecretCryptoError, match="placeholder"):
        _as_fernet_key("change_me", "MAIL_CREDENTIALS_KEY")


def test_non_production_placeholder_mail_credentials_key_is_allowed(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    key = _as_fernet_key("change_me", "MAIL_CREDENTIALS_KEY")
    assert isinstance(key, bytes)
    assert len(key) == 44
    _build_fernet.cache_clear()
