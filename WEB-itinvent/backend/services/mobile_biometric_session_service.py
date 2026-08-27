"""Durable, revocable APK session renewal unlocked by Android biometrics."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import hmac
import logging
import re
import secrets
import uuid
from typing import Any

from sqlalchemy import select

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppMobileBiometricCredential, AppUser
from backend.services.auth_runtime_store_service import auth_runtime_store_service
from backend.services.session_service import hash_client_device_id, normalize_client_device_id


logger = logging.getLogger(__name__)
_ENROLLMENT_NAMESPACE = "mobile_biometric_enrollment"
_ENROLLMENT_TTL_SECONDS = 5 * 60
_TOKEN_RE = re.compile(r"^mb1\.([0-9a-f]{32})\.([A-Za-z0-9_-]{40,128})$")


class MobileBiometricSessionError(RuntimeError):
    """A biometric device credential is invalid, revoked, or unavailable."""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _sha256(value: str) -> str:
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()


class MobileBiometricSessionService:
    """Persists only hashes; the renewable secret remains in Android SecureStore."""

    def __init__(self, *, database_url: str | None = None) -> None:
        self._database_url = str(database_url or "").strip() or None
        self._use_app_db = bool(self._database_url) or is_app_database_configured()
        if self._use_app_db:
            initialize_app_schema(self._database_url)

    def _require_device_hash(self, client_device_id: str | None) -> str:
        normalized = normalize_client_device_id(client_device_id)
        device_hash = hash_client_device_id(normalized)
        if not normalized or not device_hash:
            raise MobileBiometricSessionError("Mobile device identifier is invalid")
        return device_hash

    @staticmethod
    def _challenge_key(code: str) -> str:
        return _sha256(str(code or "").strip())

    def issue_enrollment_code(
        self,
        *,
        user_id: int,
        client_device_id: str,
        session_id: str | None,
    ) -> str:
        device_hash = self._require_device_hash(client_device_id)
        code = secrets.token_urlsafe(48)
        auth_runtime_store_service.set_json(
            _ENROLLMENT_NAMESPACE,
            self._challenge_key(code),
            {
                "user_id": int(user_id),
                "client_device_key_hash": device_hash,
                "session_id": str(session_id or "").strip() or None,
            },
            ttl_seconds=_ENROLLMENT_TTL_SECONDS,
        )
        return code

    def enroll(
        self,
        *,
        enrollment_code: str,
        user_id: int,
        client_device_id: str,
    ) -> str:
        device_hash = self._require_device_hash(client_device_id)
        challenge = auth_runtime_store_service.pop_json(
            _ENROLLMENT_NAMESPACE,
            self._challenge_key(enrollment_code),
        )
        if not isinstance(challenge, dict):
            raise MobileBiometricSessionError("Biometric enrollment has expired; sign in with 2FA again")
        if (
            int(challenge.get("user_id") or 0) != int(user_id)
            or not hmac.compare_digest(
                str(challenge.get("client_device_key_hash") or ""),
                device_hash,
            )
        ):
            raise MobileBiometricSessionError("Biometric enrollment does not belong to this device")

        now = _utc_now()
        with app_session(self._database_url) as session:
            user = session.get(AppUser, int(user_id), with_for_update=True)
            if user is None or not bool(user.is_active) or not bool(user.is_2fa_enabled):
                raise MobileBiometricSessionError("Active 2FA is required for biometric login")
            row = session.scalars(
                select(AppMobileBiometricCredential)
                .where(
                    AppMobileBiometricCredential.user_id == int(user_id),
                    AppMobileBiometricCredential.client_device_key_hash == device_hash,
                )
                .with_for_update()
            ).first()
            if row is None:
                credential_id = uuid.uuid4().hex
                row = AppMobileBiometricCredential(
                    id=credential_id,
                    user_id=int(user_id),
                    client_device_key_hash=device_hash,
                    token_hash="",
                    is_active=True,
                    created_at=now,
                )
                session.add(row)
            else:
                credential_id = str(row.id)
                row.is_active = True
                row.created_at = now
                row.last_used_at = None
                row.revoked_at = None
            secret = secrets.token_urlsafe(48)
            renewal_token = f"mb1.{credential_id}.{secret}"
            row.token_hash = _sha256(renewal_token)
        logger.info("Mobile biometric credential enrolled user_id=%s device_hash_prefix=%s", int(user_id), device_hash[:12])
        return renewal_token

    @staticmethod
    def _token_parts(renewal_token: str) -> tuple[str, str]:
        normalized = str(renewal_token or "").strip()
        match = _TOKEN_RE.fullmatch(normalized)
        if not match:
            raise MobileBiometricSessionError("Biometric session token is invalid")
        return match.group(1), _sha256(normalized)

    def authenticate(self, *, renewal_token: str, client_device_id: str) -> dict[str, Any]:
        credential_id, token_hash = self._token_parts(renewal_token)
        device_hash = self._require_device_hash(client_device_id)
        denied = False
        result: dict[str, Any] | None = None
        with app_session(self._database_url) as session:
            row = session.get(AppMobileBiometricCredential, credential_id, with_for_update=True)
            if (
                row is None
                or not bool(row.is_active)
                or row.revoked_at is not None
                or not hmac.compare_digest(str(row.token_hash or ""), token_hash)
                or not hmac.compare_digest(str(row.client_device_key_hash or ""), device_hash)
            ):
                raise MobileBiometricSessionError("Biometric session is invalid or revoked")
            user = session.get(AppUser, int(row.user_id), with_for_update=True)
            if user is None or not bool(user.is_active) or not bool(user.is_2fa_enabled):
                row.is_active = False
                row.revoked_at = _utc_now()
                denied = True
            else:
                row.last_used_at = _utc_now()
                result = {"credential_id": str(row.id), "user_id": int(row.user_id)}
        if denied or result is None:
            raise MobileBiometricSessionError("Biometric session is no longer allowed")
        return result

    def revoke_device(self, *, user_id: int, client_device_id: str) -> int:
        device_hash = self._require_device_hash(client_device_id)
        now = _utc_now()
        updated = 0
        with app_session(self._database_url) as session:
            rows = session.scalars(
                select(AppMobileBiometricCredential).where(
                    AppMobileBiometricCredential.user_id == int(user_id),
                    AppMobileBiometricCredential.client_device_key_hash == device_hash,
                    AppMobileBiometricCredential.is_active.is_(True),
                )
            ).all()
            for row in rows:
                row.is_active = False
                row.revoked_at = now
                updated += 1
        if updated:
            logger.info("Mobile biometric credential revoked user_id=%s device_hash_prefix=%s", int(user_id), device_hash[:12])
        return updated

    def has_active_credential_for_device(
        self,
        *,
        user_id: int,
        client_device_key_hash: str | None,
        db_session=None,
    ) -> bool:
        """True when this APK installation still has an active biometric renewal credential."""
        device_hash = str(client_device_key_hash or "").strip().lower()
        if not user_id or not device_hash or len(device_hash) != 64:
            return False

        def _lookup(session) -> bool:
            row = session.scalars(
                select(AppMobileBiometricCredential.id).where(
                    AppMobileBiometricCredential.user_id == int(user_id),
                    AppMobileBiometricCredential.client_device_key_hash == device_hash,
                    AppMobileBiometricCredential.is_active.is_(True),
                    AppMobileBiometricCredential.revoked_at.is_(None),
                ).limit(1)
            ).first()
            return row is not None

        if db_session is not None:
            return _lookup(db_session)
        if not self._use_app_db:
            return False
        with app_session(self._database_url) as session:
            return _lookup(session)

    def revoke_all_user_credentials(self, user_id: int) -> int:
        now = _utc_now()
        updated = 0
        with app_session(self._database_url) as session:
            rows = session.scalars(
                select(AppMobileBiometricCredential).where(
                    AppMobileBiometricCredential.user_id == int(user_id),
                    AppMobileBiometricCredential.is_active.is_(True),
                )
            ).all()
            for row in rows:
                row.is_active = False
                row.revoked_at = now
                updated += 1
        return updated


mobile_biometric_session_service = MobileBiometricSessionService()
