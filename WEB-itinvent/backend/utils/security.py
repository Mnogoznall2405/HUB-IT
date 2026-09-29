"""Security utilities for JWT token management."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
import uuid
from typing import Optional

from jose import JWTError, jwt
from pydantic import BaseModel

from backend.config import config


class Token(BaseModel):
    """JWT token response model."""

    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    """Data extracted from JWT token."""

    username: Optional[str] = None
    user_id: Optional[int] = None
    role: Optional[str] = None
    session_id: Optional[str] = None
    telegram_id: Optional[int] = None
    jti: Optional[str] = None
    device_id: Optional[str] = None
    token_type: Optional[str] = None
    expires_at: Optional[datetime] = None


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_exp(payload: dict) -> Optional[datetime]:
    exp_value = payload.get("exp")
    if exp_value in (None, ""):
        return None
    try:
        if isinstance(exp_value, datetime):
            parsed = exp_value
        else:
            parsed = datetime.fromtimestamp(float(exp_value), tz=timezone.utc)
    except Exception:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _encode_token(data: dict, *, token_type: str, expires_delta: timedelta) -> str:
    to_encode = data.copy()
    expire = _now_utc() + expires_delta
    to_encode.update(
        {
            "exp": expire,
            "jti": str(to_encode.get("jti") or uuid.uuid4().hex),
            "token_type": str(token_type or "access"),
        }
    )
    return jwt.encode(to_encode, config.jwt.secret_key, algorithm=config.jwt.algorithm)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    return _encode_token(
        data,
        token_type="access",
        expires_delta=expires_delta or timedelta(minutes=config.jwt.access_token_expire_minutes),
    )


def create_refresh_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    return _encode_token(
        data,
        token_type="refresh",
        expires_delta=expires_delta or timedelta(days=config.jwt.refresh_token_expire_days),
    )


def create_ws_ticket(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Short-lived token_type='ws_auth' proof for in-socket re-auth (D5/W8).

    Not an access token: it must never authorize REST — only prove fresh auth
    to an already-established websocket lease.
    """
    if expires_delta is None:
        ttl_sec = max(60, min(3600, int(str(
            os.getenv("CHAT_WS_TICKET_TTL_SEC", "300") or "300"
        ).strip() or "300")))
        expires_delta = timedelta(seconds=ttl_sec)
    return _encode_token(data, token_type="ws_auth", expires_delta=expires_delta)


def decode_access_token(
    token: str,
    *,
    expected_token_type: str | None = None,
    verify_exp: bool = True,
) -> Optional[TokenData]:
    """Decode and verify a JWT token.

    verify_exp=False is used by the WS auth lease to classify an expired-but-
    otherwise-valid token (expired → grace window) vs a dead one.
    """

    normalized = str(token or "").strip()
    if not normalized:
        return None

    secret_keys = [config.jwt.secret_key] + list(config.jwt.previous_secret_keys or [])
    for key in secret_keys:
        if not key:
            continue
        try:
            payload = jwt.decode(
                normalized, key, algorithms=[config.jwt.algorithm],
                options={"verify_exp": verify_exp},
            )
            token_type = str(payload.get("token_type") or "access").strip().lower() or "access"
            if expected_token_type and token_type != str(expected_token_type).strip().lower():
                return None
            username: str = payload.get("sub")
            if username is None:
                return None
            return TokenData(
                username=username,
                user_id=payload.get("user_id"),
                role=payload.get("role"),
                session_id=payload.get("session_id"),
                telegram_id=payload.get("telegram_id"),
                jti=str(payload.get("jti") or "").strip() or None,
                device_id=str(payload.get("device_id") or "").strip() or None,
                token_type=token_type,
                expires_at=_normalize_exp(payload),
            )
        except JWTError:
            continue
    return None


def token_ttl_seconds(token_data: TokenData | None, *, default_seconds: int = 60) -> int:
    if token_data is None or token_data.expires_at is None:
        return max(1, int(default_seconds or 1))
    ttl = int((token_data.expires_at - _now_utc()).total_seconds())
    return max(1, ttl)
