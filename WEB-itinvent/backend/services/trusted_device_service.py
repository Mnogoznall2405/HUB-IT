from __future__ import annotations

import base64
import json
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import select

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppTrustedDevice
from backend.config import config

logger = logging.getLogger(__name__)


class TrustedDeviceServiceError(RuntimeError):
    """Domain error for trusted device operations."""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    normalized = _normalize_text(value)
    padded = normalized + "=" * ((4 - len(normalized) % 4) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def _json_list(value: Any) -> list[str]:
    try:
        parsed = json.loads(str(value or "[]"))
    except Exception:
        parsed = []
    if not isinstance(parsed, list):
        return []
    return [str(item or "").strip() for item in parsed if str(item or "").strip()]


class TrustedDeviceService:
    """Trusted device persistence and WebAuthn helpers."""

    def __init__(self, *, database_url: str | None = None) -> None:
        self._database_url = str(database_url or "").strip() or None
        self._use_app_db = bool(self._database_url) or is_app_database_configured()
        if self._use_app_db:
            initialize_app_schema(self._database_url)

    def _resolve_db_url(self) -> str | None:
        return self._database_url

    def _device_ttl(self) -> timedelta:
        return timedelta(days=max(1, int(config.security.trusted_device_ttl_days or 90)))

    def _new_expiration(self, now: datetime | None = None) -> datetime:
        return (now or _utc_now()) + self._device_ttl()

    @staticmethod
    def _is_expired(expires_at: datetime | None, *, now: datetime | None = None) -> bool:
        normalized = _coerce_datetime(expires_at)
        return normalized is not None and normalized <= (now or _utc_now())

    def _audit(self, action: str, *, user_id: int | None = None, device_id: str | None = None, reason: str = "") -> None:
        logger.info(
            "Trusted device audit action=%s user_id=%s device_id=%s reason=%s",
            str(action or "").strip() or "unknown",
            int(user_id or 0) or None,
            str(device_id or "").strip() or None,
            str(reason or "").strip(),
        )

    def audit_event(
        self,
        action: str,
        *,
        user_id: int | None = None,
        device_id: str | None = None,
        reason: str = "",
    ) -> None:
        self._audit(action, user_id=user_id, device_id=device_id, reason=reason)

    def _expire_row_if_needed(self, row: AppTrustedDevice | None, *, now: datetime | None = None) -> bool:
        if row is None or not bool(row.is_active):
            return False
        current_now = now or _utc_now()
        if row.expires_at is None:
            row.expires_at = self._new_expiration(current_now)
            return False
        if not self._is_expired(row.expires_at, now=current_now):
            return False
        row.is_active = False
        row.revoked_at = row.revoked_at or current_now
        self._audit("expired", user_id=int(row.user_id or 0), device_id=str(row.id or ""), reason="ttl")
        return True

    def list_devices(self, user_id: int, *, active_only: bool = True) -> list[dict[str, Any]]:
        with app_session(self._resolve_db_url()) as session:
            stmt = select(AppTrustedDevice).where(AppTrustedDevice.user_id == int(user_id))
            if active_only:
                stmt = stmt.where(AppTrustedDevice.is_active.is_(True))
            rows = session.scalars(stmt.order_by(AppTrustedDevice.created_at.desc())).all()
            now = _utc_now()
            items: list[dict[str, Any]] = []
            for row in rows:
                self._expire_row_if_needed(row, now=now)
                item = self._row_to_dict(row)
                if item is None:
                    continue
                if active_only and not bool(item.get("is_active")):
                    continue
                items.append(item)
            return items

    def get_device(self, device_id: str) -> dict[str, Any] | None:
        normalized = _normalize_text(device_id)
        if not normalized:
            return None
        with app_session(self._resolve_db_url()) as session:
            row = session.get(AppTrustedDevice, normalized)
            self._expire_row_if_needed(row)
            return self._row_to_dict(row) if row is not None else None

    def count_active_devices(self, user_id: int) -> int:
        return len(self.list_devices(user_id, active_only=True))

    def count_discoverable_active_devices(self, user_id: int) -> int:
        return sum(
            1
            for item in self.list_devices(user_id, active_only=True)
            if bool(item.get("is_discoverable"))
        )

    def revoke_device(self, *, user_id: int, device_id: str) -> dict[str, Any] | None:
        normalized = _normalize_text(device_id)
        if not normalized:
            return None
        with app_session(self._resolve_db_url()) as session:
            row = session.get(AppTrustedDevice, normalized)
            if row is None or int(row.user_id) != int(user_id):
                return None
            row.is_active = False
            row.revoked_at = _utc_now()
            self._audit("revoke", user_id=int(user_id), device_id=normalized, reason="user_request")
            return self._row_to_dict(row)

    def revoke_all_user_devices(self, user_id: int) -> int:
        updated = 0
        with app_session(self._resolve_db_url()) as session:
            rows = session.scalars(
                select(AppTrustedDevice).where(
                    AppTrustedDevice.user_id == int(user_id),
                    AppTrustedDevice.is_active.is_(True),
                )
            ).all()
            for row in rows:
                row.is_active = False
                row.revoked_at = _utc_now()
                self._audit("revoke", user_id=int(user_id), device_id=str(row.id or ""), reason="bulk_revoke")
                updated += 1
        return updated

    def mark_device_used(self, device_id: str) -> None:
        normalized = _normalize_text(device_id)
        if not normalized:
            return
        with app_session(self._resolve_db_url()) as session:
            row = session.get(AppTrustedDevice, normalized)
            if row is None:
                return
            now = _utc_now()
            if self._expire_row_if_needed(row, now=now):
                return
            row.last_used_at = now
            row.expires_at = self._new_expiration(now)
            self._audit("auth_success", user_id=int(row.user_id or 0), device_id=normalized)

    def update_sign_count(self, device_id: str, sign_count: int) -> None:
        normalized = _normalize_text(device_id)
        if not normalized:
            return
        with app_session(self._resolve_db_url()) as session:
            row = session.get(AppTrustedDevice, normalized)
            if row is None:
                return
            now = _utc_now()
            if self._expire_row_if_needed(row, now=now):
                return
            row.sign_count = max(0, int(sign_count or 0))
            row.last_used_at = now
            row.expires_at = self._new_expiration(now)

    def register_device(
        self,
        *,
        user_id: int,
        label: str,
        credential_id: str,
        public_key_b64: str,
        sign_count: int,
        transports: list[str] | None,
        aaguid: str | None,
        rp_id: str,
        origin: str,
        is_discoverable: bool = False,
    ) -> dict[str, Any]:
        device_id = uuid.uuid4().hex
        with app_session(self._resolve_db_url()) as session:
            row = AppTrustedDevice(
                id=device_id,
                user_id=int(user_id),
                label=_normalize_text(label) or "Доверенное устройство",
                credential_id=_normalize_text(credential_id),
                public_key_b64=_normalize_text(public_key_b64),
                sign_count=max(0, int(sign_count or 0)),
                transports_json=json.dumps([str(item).strip() for item in (transports or []) if str(item).strip()], ensure_ascii=False),
                aaguid=_normalize_text(aaguid) or None,
                rp_id=_normalize_text(rp_id),
                origin=_normalize_text(origin),
                is_discoverable=bool(is_discoverable),
                last_used_at=_utc_now(),
                created_at=_utc_now(),
                expires_at=self._new_expiration(),
                revoked_at=None,
                is_active=True,
            )
            session.add(row)
            session.flush()
            self._audit("registration", user_id=int(user_id), device_id=device_id)
            return self._row_to_dict(row)

    def find_device_by_credential(
        self,
        credential_id: str,
        *,
        user_id: int | None = None,
        discoverable_only: bool = False,
    ) -> dict[str, Any] | None:
        normalized = _normalize_text(credential_id)
        if not normalized:
            return None
        with app_session(self._resolve_db_url()) as session:
            stmt = select(AppTrustedDevice).where(
                AppTrustedDevice.credential_id == normalized,
                AppTrustedDevice.is_active.is_(True),
            )
            if user_id is not None:
                stmt = stmt.where(AppTrustedDevice.user_id == int(user_id))
            if discoverable_only:
                stmt = stmt.where(AppTrustedDevice.is_discoverable.is_(True))
            row = session.scalars(stmt.limit(1)).first()
            if self._expire_row_if_needed(row):
                return None
            return self._row_to_dict(row) if row is not None else None

    def is_token_device_valid(self, *, user_id: int, token_device_id: str | None) -> bool:
        normalized = _normalize_text(token_device_id)
        if not normalized or not normalized.startswith("trusted:"):
            return True
        device_id = normalized.split(":", 1)[1].strip()
        if not device_id:
            return False
        device = self.get_device(device_id)
        return bool(device and int(device.get("user_id", 0)) == int(user_id) and device.get("is_active"))

    def build_registration_options(
        self,
        *,
        user_id: int,
        username: str,
        display_name: str,
        rp_id: str,
        rp_name: str,
        exclude_devices: Iterable[dict[str, Any]] | None = None,
        platform_only: bool = False,
    ) -> dict[str, Any]:
        challenge = _b64url_encode(secrets.token_bytes(32))
        user_handle = _b64url_encode(str(user_id).encode("utf-8"))
        exclude_credentials = [
            {
                "type": "public-key",
                "id": str(item.get("credential_id") or ""),
                "transports": list(item.get("transports") or []),
            }
            for item in (exclude_devices or [])
            if _normalize_text(item.get("credential_id"))
        ]
        authenticator_selection: dict[str, Any] = {
            "residentKey": "required",
            "userVerification": "required",
        }
        if platform_only:
            authenticator_selection.update(
                {
                    "authenticatorAttachment": "platform",
                }
            )
        return {
            "challenge": challenge,
            "rp": {
                "name": _normalize_text(rp_name) or "HUB-IT",
                "id": _normalize_text(rp_id),
            },
            "user": {
                "id": user_handle,
                "name": _normalize_text(username),
                "displayName": _normalize_text(display_name) or _normalize_text(username),
            },
            "pubKeyCredParams": [
                {"type": "public-key", "alg": -7},
                {"type": "public-key", "alg": -257},
            ],
            "timeout": 60000,
            "attestation": "none",
            "authenticatorSelection": authenticator_selection,
            "excludeCredentials": exclude_credentials,
        }

    def build_authentication_options(
        self,
        *,
        rp_id: str,
        devices: Iterable[dict[str, Any]],
    ) -> dict[str, Any]:
        challenge = _b64url_encode(secrets.token_bytes(32))
        allow_credentials = [
            {
                "type": "public-key",
                "id": str(item.get("credential_id") or ""),
                "transports": list(item.get("transports") or []),
            }
            for item in (devices or [])
            if _normalize_text(item.get("credential_id"))
        ]
        return {
            "challenge": challenge,
            "rpId": _normalize_text(rp_id),
            "timeout": 60000,
            "userVerification": "preferred",
            "allowCredentials": allow_credentials,
        }

    def build_discoverable_authentication_options(
        self,
        *,
        rp_id: str,
    ) -> dict[str, Any]:
        return {
            "challenge": _b64url_encode(secrets.token_bytes(32)),
            "rpId": _normalize_text(rp_id),
            "timeout": 12000,
            "userVerification": "required",
        }

    def verify_registration_response(
        self,
        *,
        credential: dict[str, Any],
        expected_challenge: str,
        expected_origin: str,
        expected_rp_id: str,
        require_user_verification: bool = False,
    ) -> dict[str, Any]:
        try:
            from webauthn import verify_registration_response
        except Exception as exc:  # pragma: no cover - runtime dependency
            raise TrustedDeviceServiceError("webauthn package is not installed") from exc

        try:
            verification = verify_registration_response(
                credential=credential,
                expected_challenge=_b64url_decode(expected_challenge),
                expected_origin=_normalize_text(expected_origin),
                expected_rp_id=_normalize_text(expected_rp_id),
                require_user_verification=bool(require_user_verification),
            )
        except Exception as exc:
            raise TrustedDeviceServiceError(str(exc)) from exc
        credential_id = getattr(verification, "credential_id", b"")
        public_key = getattr(verification, "credential_public_key", b"")
        sign_count = int(getattr(verification, "sign_count", 0) or 0)
        aaguid = getattr(verification, "aaguid", None)
        return {
            "credential_id": _b64url_encode(credential_id if isinstance(credential_id, (bytes, bytearray)) else bytes(credential_id)),
            "public_key_b64": base64.b64encode(public_key if isinstance(public_key, (bytes, bytearray)) else bytes(public_key)).decode("ascii"),
            "sign_count": sign_count,
            "aaguid": str(aaguid) if aaguid is not None else None,
        }

    def verify_authentication_response(
        self,
        *,
        credential: dict[str, Any],
        expected_challenge: str,
        expected_origin: str,
        expected_rp_id: str,
        device: dict[str, Any],
        require_user_verification: bool = False,
    ) -> dict[str, Any]:
        try:
            from webauthn import verify_authentication_response
        except Exception as exc:  # pragma: no cover - runtime dependency
            raise TrustedDeviceServiceError("webauthn package is not installed") from exc

        public_key_raw = base64.b64decode(str(device.get("public_key_b64") or "").encode("ascii"))
        sign_count = int(device.get("sign_count", 0) or 0)
        try:
            verification = verify_authentication_response(
                credential=credential,
                expected_challenge=_b64url_decode(expected_challenge),
                expected_origin=_normalize_text(expected_origin),
                expected_rp_id=_normalize_text(expected_rp_id),
                credential_public_key=public_key_raw,
                credential_current_sign_count=sign_count,
                require_user_verification=bool(require_user_verification),
            )
        except Exception as exc:
            raise TrustedDeviceServiceError(str(exc)) from exc
        new_sign_count = int(getattr(verification, "new_sign_count", sign_count) or sign_count)
        credential_id = _normalize_text((credential or {}).get("id"))
        return {
            "device_id": str(device.get("id") or ""),
            "credential_id": credential_id,
            "new_sign_count": new_sign_count,
        }

    @staticmethod
    def _row_to_dict(row: AppTrustedDevice | None) -> dict[str, Any] | None:
        if row is None:
            return None
        return {
            "id": str(row.id or ""),
            "user_id": int(row.user_id),
            "label": _normalize_text(row.label),
            "credential_id": _normalize_text(row.credential_id),
            "public_key_b64": _normalize_text(row.public_key_b64),
            "sign_count": int(row.sign_count or 0),
            "transports": _json_list(row.transports_json),
            "aaguid": _normalize_text(row.aaguid) or None,
            "rp_id": _normalize_text(row.rp_id),
            "origin": _normalize_text(row.origin),
            "is_discoverable": bool(row.is_discoverable),
            "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "expires_at": row.expires_at.isoformat() if row.expires_at else None,
            "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
            "is_active": bool(row.is_active),
            "is_expired": TrustedDeviceService._is_expired(row.expires_at),
        }


trusted_device_service = TrustedDeviceService()
