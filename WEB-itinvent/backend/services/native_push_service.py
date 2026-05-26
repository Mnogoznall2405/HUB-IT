"""Native mobile push token storage and Firebase Cloud Messaging sender."""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from sqlalchemy import select

from backend.appdb.db import app_session, ensure_app_schema_initialized, is_app_database_configured
from backend.appdb.models import AppNativePushToken
from backend.config import config

logger = logging.getLogger(__name__)

FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
FCM_TOKEN_URI = "https://oauth2.googleapis.com/token"
FCM_ANDROID_CHANNEL_ID = "hubit_default"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _hash_token(token: str) -> str:
    return hashlib.sha256(_normalize_text(token).encode("utf-8")).hexdigest()


def _base64url_json(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _base64url_bytes(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _json_loads(raw: str | bytes, fallback: Any = None) -> Any:
    try:
        return json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else str(raw or ""))
    except Exception:
        return fallback


def _string_data(payload: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for key, value in (payload or {}).items():
        normalized_key = _normalize_text(key)
        if not normalized_key or value is None:
            continue
        if isinstance(value, (dict, list)):
            result[normalized_key] = json.dumps(value, ensure_ascii=False, default=str)
        else:
            result[normalized_key] = _normalize_text(value)
    return result


@dataclass
class NativePushSendResult:
    sent: int = 0
    disabled: int = 0
    failed: int = 0
    tokens: int = 0


class NativePushService:
    """Store FCM tokens and send native Android notifications."""

    def __init__(self) -> None:
        self._access_token: str = ""
        self._access_token_expires_at: float = 0.0

    def _service_account(self) -> dict[str, Any] | None:
        raw_json = _normalize_text(config.fcm_push.service_account_json)
        if raw_json:
            parsed = _json_loads(raw_json, None)
            return parsed if isinstance(parsed, dict) else None

        raw_file = _normalize_text(config.fcm_push.service_account_file)
        if raw_file:
            try:
                parsed = _json_loads(Path(raw_file).read_text(encoding="utf-8"), None)
                return parsed if isinstance(parsed, dict) else None
            except Exception:
                logger.warning("FCM service account file could not be read: %s", raw_file, exc_info=True)
                return None

        return None

    def _project_id(self, service_account: Optional[dict[str, Any]] = None) -> str:
        configured = _normalize_text(config.fcm_push.project_id)
        if configured:
            return configured
        if service_account:
            return _normalize_text(service_account.get("project_id"))
        return ""

    @property
    def configured(self) -> bool:
        service_account = self._service_account()
        return bool(service_account and self._project_id(service_account))

    @property
    def storage_available(self) -> bool:
        return is_app_database_configured()

    def get_runtime_status(self) -> dict[str, Any]:
        service_account = self._service_account()
        return {
            "enabled": bool(self.configured and self.storage_available),
            "configured": bool(self.configured),
            "storage_available": bool(self.storage_available),
            "project_id_present": bool(self._project_id(service_account)),
            "service_account_present": bool(service_account),
        }

    def upsert_token(
        self,
        *,
        user_id: int,
        token: str,
        platform: str = "android",
        device_id: Optional[str] = None,
        device_label: Optional[str] = None,
        app_version: Optional[str] = None,
    ) -> dict[str, Any]:
        normalized_token = _normalize_text(token)
        if not normalized_token:
            raise ValueError("FCM token is required")
        if not self.storage_available:
            raise RuntimeError("APP_DATABASE_URL is required for native push tokens")

        ensure_app_schema_initialized()
        token_hash = _hash_token(normalized_token)
        normalized_user_id = int(user_id)
        normalized_platform = _normalize_text(platform).lower() or "android"
        normalized_device_id = _normalize_text(device_id) or None
        normalized_device_label = _normalize_text(device_label) or None
        normalized_app_version = _normalize_text(app_version) or None
        now = _utc_now()

        with app_session() as session:
            row = session.execute(
                select(AppNativePushToken).where(AppNativePushToken.token_hash == token_hash)
            ).scalar_one_or_none()
            if row is None:
                row = AppNativePushToken(
                    user_id=normalized_user_id,
                    provider="fcm",
                    platform=normalized_platform,
                    token_hash=token_hash,
                    token_text=normalized_token,
                    created_at=now,
                    updated_at=now,
                )
                session.add(row)

            row.user_id = normalized_user_id
            row.provider = "fcm"
            row.platform = normalized_platform
            row.token_hash = token_hash
            row.token_text = normalized_token
            row.device_id = normalized_device_id
            row.device_label = normalized_device_label
            row.app_version = normalized_app_version
            row.is_active = True
            row.failure_count = 0
            row.updated_at = now
            row.last_seen_at = now
            row.revoked_at = None
            row.last_error_at = None
            row.last_error_text = None

            if normalized_device_id:
                stale_tokens = list(
                    session.execute(
                        select(AppNativePushToken).where(
                            AppNativePushToken.user_id == normalized_user_id,
                            AppNativePushToken.provider == "fcm",
                            AppNativePushToken.platform == normalized_platform,
                            AppNativePushToken.device_id == normalized_device_id,
                            AppNativePushToken.token_hash != token_hash,
                            AppNativePushToken.is_active.is_(True),
                        )
                    ).scalars()
                )
                for stale_token in stale_tokens:
                    stale_token.is_active = False
                    stale_token.revoked_at = now
                    stale_token.updated_at = now
                    stale_token.last_error_text = "Superseded by newer native push token on the same device"

        return {
            "ok": True,
            "registered": True,
            "push_enabled": bool(self.configured),
            "configured": bool(self.configured),
        }

    def delete_token(self, *, user_id: int, token: str) -> dict[str, Any]:
        normalized_token = _normalize_text(token)
        if not normalized_token:
            return {"ok": True, "registered": False, "removed": False, "push_enabled": bool(self.configured)}
        if not self.storage_available:
            return {"ok": True, "registered": False, "removed": False, "push_enabled": bool(self.configured)}

        ensure_app_schema_initialized()
        token_hash = _hash_token(normalized_token)
        removed = False
        now = _utc_now()
        with app_session() as session:
            row = session.execute(
                select(AppNativePushToken).where(
                    AppNativePushToken.user_id == int(user_id),
                    AppNativePushToken.token_hash == token_hash,
                    AppNativePushToken.provider == "fcm",
                )
            ).scalar_one_or_none()
            if row is not None:
                row.is_active = False
                row.revoked_at = now
                row.updated_at = now
                removed = True

        return {
            "ok": True,
            "registered": False,
            "removed": bool(removed),
            "push_enabled": bool(self.configured),
        }

    def _active_tokens(self, *, user_id: int) -> list[AppNativePushToken]:
        if not self.storage_available:
            return []
        ensure_app_schema_initialized()
        with app_session() as session:
            return list(
                session.execute(
                    select(AppNativePushToken).where(
                        AppNativePushToken.user_id == int(user_id),
                        AppNativePushToken.provider == "fcm",
                        AppNativePushToken.is_active.is_(True),
                    )
                ).scalars()
            )

    def _build_access_jwt(self, service_account: dict[str, Any]) -> str:
        client_email = _normalize_text(service_account.get("client_email"))
        private_key_pem = _normalize_text(service_account.get("private_key")).replace("\\n", "\n")
        token_uri = _normalize_text(service_account.get("token_uri")) or FCM_TOKEN_URI
        private_key_id = _normalize_text(service_account.get("private_key_id"))
        if not client_email or not private_key_pem:
            raise RuntimeError("FCM service account is incomplete")

        now = int(time.time())
        header = {"alg": "RS256", "typ": "JWT"}
        if private_key_id:
            header["kid"] = private_key_id
        claims = {
            "iss": client_email,
            "scope": FCM_SCOPE,
            "aud": token_uri,
            "iat": now,
            "exp": now + 3600,
        }
        signing_input = f"{_base64url_json(header)}.{_base64url_json(claims)}".encode("ascii")
        private_key = serialization.load_pem_private_key(private_key_pem.encode("utf-8"), password=None)
        signature = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
        return f"{signing_input.decode('ascii')}.{_base64url_bytes(signature)}"

    def _get_access_token(self, service_account: dict[str, Any]) -> str:
        now = time.time()
        if self._access_token and self._access_token_expires_at > (now + 300):
            return self._access_token

        token_uri = _normalize_text(service_account.get("token_uri")) or FCM_TOKEN_URI
        assertion = self._build_access_jwt(service_account)
        body = urllib.parse.urlencode({
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        }).encode("utf-8")
        request = urllib.request.Request(
            token_uri,
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=10) as response:  # nosec B310 - Google OAuth endpoint from config/service account.
            payload = _json_loads(response.read(), {})
        access_token = _normalize_text(payload.get("access_token"))
        expires_in = int(payload.get("expires_in") or 3600)
        if not access_token:
            raise RuntimeError("FCM access token response is empty")
        self._access_token = access_token
        self._access_token_expires_at = now + max(60, expires_in)
        return self._access_token

    def _send_fcm_message(
        self,
        *,
        service_account: dict[str, Any],
        project_id: str,
        token: str,
        title: str,
        body: str,
        data: dict[str, Any],
        tag: str,
    ) -> None:
        access_token = self._get_access_token(service_account)
        endpoint = f"https://fcm.googleapis.com/v1/projects/{urllib.parse.quote(project_id)}/messages:send"
        string_data = _string_data(data)
        message = {
            "message": {
                "token": token,
                "notification": {
                    "title": _normalize_text(title) or "HUB-IT",
                    "body": _normalize_text(body) or "Open HUB-IT to view details.",
                },
                "data": string_data,
                "android": {
                    "priority": "HIGH",
                    "notification": {
                        "channel_id": FCM_ANDROID_CHANNEL_ID,
                        "click_action": "OPEN_HUBIT",
                        "tag": _normalize_text(tag) or _normalize_text(string_data.get("channel")) or "hubit",
                    },
                },
            }
        }
        raw_payload = json.dumps(message, ensure_ascii=False, default=str).encode("utf-8")
        request = urllib.request.Request(
            endpoint,
            data=raw_payload,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json; charset=utf-8",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=10) as response:  # nosec B310 - Google FCM endpoint.
            response.read()

    def _mark_failed(self, token_id: int, *, disabled: bool, error_text: str) -> None:
        now = _utc_now()
        with app_session() as session:
            row = session.get(AppNativePushToken, int(token_id))
            if row is None:
                return
            row.failure_count = int(row.failure_count or 0) + 1
            row.last_error_at = now
            row.last_error_text = _normalize_text(error_text)[:2000]
            row.updated_at = now
            if disabled:
                row.is_active = False
                row.revoked_at = now

    def _mark_sent(self, token_id: int) -> None:
        now = _utc_now()
        with app_session() as session:
            row = session.get(AppNativePushToken, int(token_id))
            if row is None:
                return
            row.failure_count = 0
            row.last_seen_at = now
            row.last_push_at = now
            row.last_error_at = None
            row.last_error_text = None
            row.updated_at = now

    def send_notification(
        self,
        *,
        recipient_user_id: int,
        title: str,
        body: str,
        channel: str = "system",
        route: str = "/",
        tag: str = "",
        data: Optional[dict[str, Any]] = None,
        **_: Any,
    ) -> NativePushSendResult:
        tokens = self._active_tokens(user_id=int(recipient_user_id))
        result = NativePushSendResult(tokens=len(tokens))
        if not tokens or not self.configured:
            return result

        service_account = self._service_account()
        if not service_account:
            return result
        project_id = self._project_id(service_account)
        if not project_id:
            return result

        payload_data = {
            "route": _normalize_text(route) or "/",
            "channel": _normalize_text(channel) or "system",
            **({} if not isinstance(data, dict) else data),
        }

        for token_row in tokens:
            try:
                self._send_fcm_message(
                    service_account=service_account,
                    project_id=project_id,
                    token=token_row.token_text,
                    title=title,
                    body=body,
                    data=payload_data,
                    tag=tag,
                )
                self._mark_sent(int(token_row.id))
                result.sent += 1
            except urllib.error.HTTPError as exc:
                response_body = ""
                try:
                    response_body = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    response_body = _normalize_text(exc)
                disabled = int(getattr(exc, "code", 0) or 0) in {400, 404}
                self._mark_failed(int(token_row.id), disabled=disabled, error_text=response_body or _normalize_text(exc))
                if disabled:
                    result.disabled += 1
                else:
                    result.failed += 1
            except Exception as exc:
                self._mark_failed(int(token_row.id), disabled=False, error_text=_normalize_text(exc))
                result.failed += 1

        logger.info(
            "NATIVE_PUSH_SEND user_id=%s channel=%s tokens=%s sent=%s disabled=%s failed=%s route=%s",
            int(recipient_user_id),
            _normalize_text(channel) or "system",
            int(result.tokens),
            int(result.sent),
            int(result.disabled),
            int(result.failed),
            _normalize_text(route) or "/",
        )
        return result


native_push_service = NativePushService()
