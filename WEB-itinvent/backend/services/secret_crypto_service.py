"""
Encryption helpers for sensitive per-user credentials.
"""
from __future__ import annotations

import base64
import hashlib
import os
from functools import lru_cache


class SecretCryptoError(RuntimeError):
    """Raised when crypto operations cannot be performed."""


_PRODUCTION_PLACEHOLDER_KEYS = frozenset({
    "change_me",
    "changeme",
    "change-me",
    "placeholder",
    "your_key_here",
    "secret",
    "password",
    "mail_credentials_key",
})


def _reject_production_placeholder(raw_key: str, env_var: str) -> None:
    app_env = str(os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or "").strip().lower()
    if app_env not in {"production", "prod"}:
        return
    if str(raw_key or "").strip().lower() in _PRODUCTION_PLACEHOLDER_KEYS:
        raise SecretCryptoError(f"{env_var} uses a placeholder value")


def _as_fernet_key(raw_key: str, env_var: str) -> bytes:
    """
    Accept either:
    - canonical Fernet key (urlsafe base64, 32-byte payload)
    - arbitrary passphrase (derived via SHA-256 to Fernet key)
    """
    value = str(raw_key or "").strip()
    if not value:
        raise SecretCryptoError(f"{env_var} is not configured")
    _reject_production_placeholder(value, env_var)

    try:
        decoded = base64.urlsafe_b64decode(value.encode("utf-8"))
        if len(decoded) == 32:
            return value.encode("utf-8")
    except Exception:
        pass

    digest = hashlib.sha256(value.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


@lru_cache(maxsize=8)
def _build_fernet(env_var: str = "MAIL_CREDENTIALS_KEY"):
    try:
        from cryptography.fernet import Fernet
    except Exception as exc:  # pragma: no cover
        raise SecretCryptoError("cryptography package is not installed") from exc

    raw = os.getenv(env_var, "")
    key = _as_fernet_key(raw, env_var)
    return Fernet(key)


def encrypt_secret(value: str | None) -> str:
    plain = str(value or "")
    if not plain:
        return ""
    token = _build_fernet().encrypt(plain.encode("utf-8"))
    return token.decode("utf-8")


def decrypt_secret(token: str | None) -> str:
    encoded = str(token or "").strip()
    if not encoded:
        return ""
    try:
        plain = _build_fernet().decrypt(encoded.encode("utf-8"))
    except Exception as exc:
        raise SecretCryptoError("Failed to decrypt secret value") from exc
    return plain.decode("utf-8")


def _encrypt_with_env_key(value: str | None, env_var: str) -> str:
    plain = str(value or "")
    if not plain:
        return ""
    token = _build_fernet(env_var).encrypt(plain.encode("utf-8"))
    return token.decode("utf-8")


def _decrypt_with_env_key(token: str | None, env_var: str) -> str:
    encoded = str(token or "").strip()
    if not encoded:
        return ""
    try:
        plain = _build_fernet(env_var).decrypt(encoded.encode("utf-8"))
    except Exception as exc:
        raise SecretCryptoError("Failed to decrypt secret value") from exc
    return plain.decode("utf-8")


def encrypt_password_vault_secret(value: str | None) -> str:
    return _encrypt_with_env_key(value, "PASSWORD_VAULT_KEY")


def _password_vault_key_env_vars() -> list[str]:
    names = ["PASSWORD_VAULT_KEY", "PASSWORD_VAULT_KEY_LEGACY"]
    result: list[str] = []
    seen: set[str] = set()
    for env_var in names:
        normalized = str(env_var or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def decrypt_password_vault_secret(token: str | None) -> str:
    encoded = str(token or "").strip()
    if not encoded:
        return ""
    last_error: Exception | None = None
    for env_var in _password_vault_key_env_vars():
        raw = os.getenv(env_var, "")
        if not str(raw or "").strip():
            continue
        try:
            return _decrypt_with_env_key(encoded, env_var)
        except SecretCryptoError as exc:
            last_error = exc
            continue
    if last_error is not None:
        raise SecretCryptoError("Failed to decrypt secret value") from last_error
    raise SecretCryptoError("PASSWORD_VAULT_KEY is not configured")


def encrypt_my_files_share_token(value: str | None) -> str:
    return _encrypt_with_env_key(value, "MY_FILES_SHARE_TOKEN_KEY")


def decrypt_my_files_share_token(token: str | None) -> str:
    return _decrypt_with_env_key(token, "MY_FILES_SHARE_TOKEN_KEY")


def encrypt_docflow_secret(value: str | None) -> str:
    """Encrypt a personal 1C secret with Fernet or user-scoped Windows DPAPI."""
    plain = str(value or "")
    if not plain:
        return ""
    if str(os.getenv("DOCFLOW_CREDENTIALS_KEY", "") or "").strip():
        return "fernet:v1:" + _encrypt_with_env_key(plain, "DOCFLOW_CREDENTIALS_KEY")
    if os.name == "nt":
        try:
            import win32crypt  # type: ignore

            protected = win32crypt.CryptProtectData(
                plain.encode("utf-8"),
                "HUB-IT 1C Docflow credentials",
                None,
                None,
                None,
                0,
            )
            return "dpapi-user:v1:" + base64.urlsafe_b64encode(protected).decode("ascii")
        except Exception as exc:
            raise SecretCryptoError("Failed to protect docflow secret with Windows DPAPI") from exc
    raise SecretCryptoError("DOCFLOW_CREDENTIALS_KEY is not configured")


def decrypt_docflow_secret(token: str | None) -> str:
    """Decrypt versioned Fernet/DPAPI values and legacy unprefixed Fernet values."""
    encoded = str(token or "").strip()
    if not encoded:
        return ""
    if encoded.startswith("dpapi-user:v1:"):
        if os.name != "nt":
            raise SecretCryptoError("Windows DPAPI docflow secret cannot be decrypted on this host")
        try:
            import win32crypt  # type: ignore

            protected = base64.urlsafe_b64decode(encoded.removeprefix("dpapi-user:v1:").encode("ascii"))
            _description, plain = win32crypt.CryptUnprotectData(protected, None, None, None, 0)
            return plain.decode("utf-8")
        except Exception as exc:
            raise SecretCryptoError("Failed to decrypt Windows DPAPI docflow secret") from exc

    if encoded.startswith("fernet:v1:"):
        encoded = encoded.removeprefix("fernet:v1:")
    last_error: Exception | None = None
    for env_var in ("DOCFLOW_CREDENTIALS_KEY", "DOCFLOW_CREDENTIALS_KEY_LEGACY"):
        if not str(os.getenv(env_var, "") or "").strip():
            continue
        try:
            return _decrypt_with_env_key(encoded, env_var)
        except SecretCryptoError as exc:
            last_error = exc
    if last_error is not None:
        raise SecretCryptoError("Failed to decrypt docflow secret") from last_error
    raise SecretCryptoError("DOCFLOW_CREDENTIALS_KEY is not configured")

