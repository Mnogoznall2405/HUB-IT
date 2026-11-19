from __future__ import annotations

import os
from pathlib import Path
import sys

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.secret_crypto_service import (
    SecretCryptoError,
    _as_fernet_key,
    _build_fernet,
    decrypt_secret,
    encrypt_secret,
)


@pytest.fixture(autouse=True)
def _clear_fernet_cache():
    _build_fernet.cache_clear()
    yield
    _build_fernet.cache_clear()


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


def test_decrypt_secret_falls_back_to_legacy_key_after_rotation(monkeypatch):
    from cryptography.fernet import Fernet

    old_key = Fernet.generate_key().decode("ascii")
    new_key = Fernet.generate_key().decode("ascii")

    # Ciphertext written before the rotation under the old key.
    monkeypatch.setenv("MAIL_CREDENTIALS_KEY", old_key)
    monkeypatch.delenv("MAIL_CREDENTIALS_KEY_LEGACY", raising=False)
    legacy_token = encrypt_secret("mailbox-password")

    # After rotation: primary is new, legacy keeps old ciphertexts readable.
    monkeypatch.setenv("MAIL_CREDENTIALS_KEY", new_key)
    monkeypatch.setenv("MAIL_CREDENTIALS_KEY_LEGACY", old_key)
    _build_fernet.cache_clear()
    assert decrypt_secret(legacy_token) == "mailbox-password"

    fresh_token = encrypt_secret("fresh-secret")
    assert decrypt_secret(fresh_token) == "fresh-secret"


def test_decrypt_secret_fails_closed_without_legacy_key(monkeypatch):
    from cryptography.fernet import Fernet

    monkeypatch.setenv("MAIL_CREDENTIALS_KEY", Fernet.generate_key().decode("ascii"))
    monkeypatch.delenv("MAIL_CREDENTIALS_KEY_LEGACY", raising=False)
    _build_fernet.cache_clear()
    token = encrypt_secret("secret")

    monkeypatch.setenv("MAIL_CREDENTIALS_KEY", Fernet.generate_key().decode("ascii"))
    _build_fernet.cache_clear()
    with pytest.raises(SecretCryptoError, match="Failed to decrypt"):
        decrypt_secret(token)


def test_decrypt_secret_requires_a_configured_key(monkeypatch):
    monkeypatch.delenv("MAIL_CREDENTIALS_KEY", raising=False)
    monkeypatch.delenv("MAIL_CREDENTIALS_KEY_LEGACY", raising=False)
    with pytest.raises(SecretCryptoError, match="not configured"):
        decrypt_secret("gAAAAA")


def test_production_rejects_passphrase_derivation_by_default(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("SECRET_CRYPTO_ALLOW_PASSPHRASE_DERIVATION", raising=False)
    monkeypatch.delenv("MAIL_CREDENTIALS_KEY_ALLOW_PASSPHRASE", raising=False)
    with pytest.raises(SecretCryptoError, match="canonical Fernet key"):
        _as_fernet_key("some-arbitrary-passphrase!!", "MAIL_CREDENTIALS_KEY")


def test_production_passphrase_opt_out_via_global_flag(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("MAIL_CREDENTIALS_KEY_ALLOW_PASSPHRASE", raising=False)
    monkeypatch.setenv("SECRET_CRYPTO_ALLOW_PASSPHRASE_DERIVATION", "1")
    key = _as_fernet_key("some-arbitrary-passphrase!!", "MAIL_CREDENTIALS_KEY")
    assert len(key) == 44


def test_production_passphrase_opt_out_via_per_key_flag(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("SECRET_CRYPTO_ALLOW_PASSPHRASE_DERIVATION", raising=False)
    monkeypatch.setenv("MAIL_CREDENTIALS_KEY_ALLOW_PASSPHRASE", "1")
    key = _as_fernet_key("some-arbitrary-passphrase!!", "MAIL_CREDENTIALS_KEY")
    assert len(key) == 44


def test_production_passphrase_rejected_for_other_key_when_opt_out_scoped(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("SECRET_CRYPTO_ALLOW_PASSPHRASE_DERIVATION", raising=False)
    monkeypatch.setenv("MAIL_CREDENTIALS_KEY_ALLOW_PASSPHRASE", "1")
    with pytest.raises(SecretCryptoError, match="canonical Fernet key"):
        _as_fernet_key("some-arbitrary-passphrase!!", "MY_FILES_SHARE_TOKEN_KEY")


def test_production_canonical_fernet_key_still_accepted(monkeypatch):
    from cryptography.fernet import Fernet

    monkeypatch.setenv("APP_ENV", "production")
    raw = Fernet.generate_key().decode("ascii")
    assert _as_fernet_key(raw, "MAIL_CREDENTIALS_KEY") == raw.encode("ascii")
