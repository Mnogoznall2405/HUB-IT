from __future__ import annotations

from datetime import datetime, timedelta, timezone
import logging
import uuid
from typing import Any, Optional

from sqlalchemy import delete, select

from backend.appdb.db import app_session
from backend.appdb.models import AppUser2FABackupCode
from backend.config import config
from backend.services.auth_runtime_store_service import auth_runtime_store_service
from backend.services.authorization_service import authorization_service
from backend.services.secret_crypto_service import decrypt_secret, encrypt_secret
from backend.services.security_email_service import security_email_service
from backend.services.session_auth_context_service import normalize_exchange_login, session_auth_context_service
from backend.services.session_service import session_service, _build_device_label
from backend.services.trusted_device_service import trusted_device_service
from backend.services.twofa_service import TwoFactorServiceError, twofa_service
from backend.services.user_service import user_service
from backend.utils.request_network import is_twofa_required_for_zone, resolve_twofa_policy
from backend.utils.security import create_access_token, create_refresh_token

logger = logging.getLogger(__name__)


class AuthSecurityError(RuntimeError):
    """Domain error for staged auth flow."""


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _utc_iso() -> str:
    return _now_utc().isoformat()


def _ttl_seconds(delta: timedelta) -> int:
    return max(1, int(delta.total_seconds()))


class AuthSecurityService:
    def _challenge_ttl(self) -> int:
        return max(60, int(config.security.twofa_challenge_ttl_sec or 600))

    def _access_ttl(self) -> timedelta:
        return timedelta(minutes=max(1, int(config.jwt.access_token_expire_minutes or 15)))

    def _refresh_ttl(self) -> timedelta:
        return timedelta(days=max(1, int(config.jwt.refresh_token_expire_days or 7)))

    def _build_public_user(
        self,
        user: dict,
        *,
        network_zone: str | None = None,
        twofa_policy: str | None = None,
        twofa_required_for_current_request: bool | None = None,
    ) -> dict:
        public_user = user_service.to_public_user(user)
        public_user["permissions"] = authorization_service.get_effective_permissions(
            public_user.get("role"),
            use_custom_permissions=bool(public_user.get("use_custom_permissions", False)),
            custom_permissions=public_user.get("custom_permissions"),
        )
        trusted_devices_count = user.get("trusted_devices_count")
        if trusted_devices_count in (None, ""):
            trusted_devices_count = trusted_device_service.count_active_devices(int(user.get("id") or 0))
        discoverable_trusted_devices_count = user.get("discoverable_trusted_devices_count")
        if discoverable_trusted_devices_count in (None, ""):
            discoverable_trusted_devices_count = trusted_device_service.count_discoverable_active_devices(
                int(user.get("id") or 0)
            )
        effective_policy = str(twofa_policy or resolve_twofa_policy()).strip().lower()
        effective_zone = str(network_zone or "external").strip().lower() or "external"
        if twofa_required_for_current_request is None:
            twofa_required_for_current_request = is_twofa_required_for_zone(effective_zone, policy=effective_policy)
        public_user["trusted_devices_count"] = int(trusted_devices_count or 0)
        public_user["discoverable_trusted_devices_count"] = int(discoverable_trusted_devices_count or 0)
        public_user["is_2fa_enabled"] = bool(user.get("is_2fa_enabled", False))
        public_user["network_zone"] = effective_zone
        public_user["twofa_policy"] = effective_policy
        public_user["twofa_enforced"] = bool(twofa_required_for_current_request)
        public_user["twofa_required_for_current_request"] = bool(twofa_required_for_current_request)
        return public_user

    def _login_methods(self, user: dict) -> tuple[list[str], bool]:
        device_count = trusted_device_service.count_active_devices(int(user.get("id") or 0))
        methods = ["totp", "backup_code"]
        if device_count > 0:
            methods.insert(0, "trusted_device")
        return methods, device_count > 0

    def create_login_challenge(
        self,
        *,
        user: dict,
        password: str,
        request_username: str,
        ip_address: str,
        user_agent: str,
        network_zone: str,
        twofa_policy: str | None = None,
        twofa_required_for_current_request: bool | None = None,
    ) -> dict[str, Any]:
        challenge_id = uuid.uuid4().hex
        methods, trusted_devices_available = self._login_methods(user)
        effective_policy = str(twofa_policy or resolve_twofa_policy()).strip().lower()
        effective_zone = str(network_zone or "external").strip().lower() or "external"
        if twofa_required_for_current_request is None:
            twofa_required_for_current_request = is_twofa_required_for_zone(effective_zone, policy=effective_policy)
        payload: dict[str, Any] = {
            "challenge_id": challenge_id,
            "user_id": int(user.get("id") or 0),
            "username": str(user.get("username") or "").strip(),
            "request_username": str(request_username or "").strip(),
            "role": str(user.get("role") or "viewer"),
            "auth_source": str(user.get("auth_source") or "local").strip().lower() or "local",
            "ip_address": str(ip_address or "").strip(),
            "user_agent": str(user_agent or "").strip(),
            "created_at": _utc_iso(),
            "network_zone": effective_zone,
            "twofa_policy": effective_policy,
            "twofa_required_for_current_request": bool(twofa_required_for_current_request),
            "available_second_factors": methods,
            "trusted_devices_available": trusted_devices_available,
        }
        normalized_password = str(password or "")
        if normalized_password:
            try:
                payload["password_enc"] = encrypt_secret(normalized_password)
            except Exception as exc:
                raise AuthSecurityError(f"Не удалось подготовить challenge для входа: {exc}") from exc
        auth_runtime_store_service.save_login_challenge(
            challenge_id,
            payload,
            ttl_seconds=self._challenge_ttl(),
        )
        return payload

    def get_login_challenge(self, challenge_id: str) -> dict[str, Any]:
        payload = auth_runtime_store_service.get_login_challenge(challenge_id)
        if not isinstance(payload, dict):
            raise AuthSecurityError("Сессия подтверждения истекла. Войдите снова")
        return payload

    def consume_login_challenge(self, challenge_id: str) -> dict[str, Any]:
        payload = auth_runtime_store_service.consume_login_challenge(challenge_id)
        if not isinstance(payload, dict):
            raise AuthSecurityError("Login confirmation session expired. Sign in again")
        return payload

    def _save_login_challenge(self, challenge_id: str, payload: dict[str, Any]) -> None:
        auth_runtime_store_service.save_login_challenge(
            challenge_id,
            payload,
            ttl_seconds=self._challenge_ttl(),
        )

    def delete_login_challenge(self, challenge_id: str) -> None:
        normalized = str(challenge_id or "").strip()
        if not normalized:
            return
        auth_runtime_store_service.delete_login_challenge(normalized)

    def start_login(
        self,
        *,
        user: dict,
        password: str,
        request_username: str,
        ip_address: str,
        user_agent: str,
        network_zone: str,
    ) -> dict[str, Any]:
        effective_policy = resolve_twofa_policy()
        twofa_required_for_current_request = is_twofa_required_for_zone(network_zone, policy=effective_policy)
        public_user = self._build_public_user(
            user,
            network_zone=network_zone,
            twofa_policy=effective_policy,
            twofa_required_for_current_request=twofa_required_for_current_request,
        )
        if twofa_required_for_current_request:
            challenge = self.create_login_challenge(
                user=user,
                password=password,
                request_username=request_username,
                ip_address=ip_address,
                user_agent=user_agent,
                network_zone=network_zone,
                twofa_policy=effective_policy,
                twofa_required_for_current_request=twofa_required_for_current_request,
            )
            if not bool(user.get("is_2fa_enabled", False)):
                return {
                    "status": "2fa_setup_required",
                    "user": None,
                    "session_id": None,
                    "login_challenge_id": challenge["challenge_id"],
                    "available_second_factors": [],
                    "trusted_devices_available": False,
                }
            return {
                "status": "2fa_required",
                "user": None,
                "session_id": None,
                "login_challenge_id": challenge["challenge_id"],
                "available_second_factors": list(challenge.get("available_second_factors") or []),
                "trusted_devices_available": bool(challenge.get("trusted_devices_available")),
            }
        return {
            "status": "authenticated",
            "user": public_user,
            "session_id": None,
            "login_challenge_id": None,
            "available_second_factors": [],
            "trusted_devices_available": False,
        }

    def complete_password_only_login(
        self,
        *,
        user: dict,
        password: str,
        request_username: str,
        ip_address: str,
        user_agent: str,
        network_zone: str,
    ) -> dict[str, Any]:
        effective_policy = resolve_twofa_policy()
        challenge = self.create_login_challenge(
            user=user,
            password=password,
            request_username=request_username,
            ip_address=ip_address,
            user_agent=user_agent,
            network_zone=network_zone,
            twofa_policy=effective_policy,
            twofa_required_for_current_request=False,
        )
        return self._complete_login(
            challenge=challenge,
            user=user,
            auth_method="password_only",
            device_id=None,
        )

    def start_totp_enrollment(self, challenge_id: str) -> dict[str, Any]:
        challenge = self.get_login_challenge(challenge_id)
        user = user_service.get_by_id(int(challenge.get("user_id") or 0))
        if not user:
            raise AuthSecurityError("Пользователь не найден")
        provisioning = twofa_service.build_provisioning(
            username=str(user.get("email") or user.get("username") or "").strip(),
            issuer=config.security.totp_issuer,
        )
        challenge["pending_totp_secret_enc"] = twofa_service.encrypt_secret(provisioning.secret)
        challenge["pending_totp_otpauth_uri"] = provisioning.otpauth_uri
        self._save_login_challenge(challenge_id, challenge)
        account_name = str(user.get("email") or user.get("username") or "").strip()
        return {
            "login_challenge_id": challenge_id,
            "otpauth_uri": provisioning.otpauth_uri,
            "issuer": str(config.security.totp_issuer or "HUB-IT").strip() or "HUB-IT",
            "account_name": account_name,
            "manual_entry_key": provisioning.secret,
            "qr_svg": provisioning.qr_svg,
        }

    def _replace_backup_codes(self, user_id: int, codes: list[str]) -> None:
        with app_session() as session:
            session.execute(delete(AppUser2FABackupCode).where(AppUser2FABackupCode.user_id == int(user_id)))
            for code in codes:
                session.add(
                    AppUser2FABackupCode(
                        user_id=int(user_id),
                        code_hash=twofa_service.hash_backup_code(code),
                        code_suffix=twofa_service.suffix_backup_code(code),
                    )
                )

    def regenerate_backup_codes(self, user_id: int) -> list[str]:
        user = user_service.get_by_id(int(user_id))
        if not user:
            raise AuthSecurityError("Пользователь не найден")
        if not bool(user.get("is_2fa_enabled", False)):
            raise AuthSecurityError("2FA ещё не включён")
        codes = twofa_service.generate_backup_codes()
        self._replace_backup_codes(int(user_id), codes)
        return codes

    def _consume_backup_code(self, user_id: int, backup_code: str) -> bool:
        with app_session() as session:
            rows = session.scalars(
                select(AppUser2FABackupCode).where(
                    AppUser2FABackupCode.user_id == int(user_id),
                    AppUser2FABackupCode.used_at.is_(None),
                )
            ).all()
            match = twofa_service.find_matching_backup_code(
                backup_code,
                [
                    {"id": int(row.id), "code_hash": row.code_hash, "code_suffix": row.code_suffix}
                    for row in rows
                ],
            )
            if not match:
                return False
            for row in rows:
                if int(row.id) == int(match.get("id") or 0):
                    row.used_at = _now_utc()
                    return True
        return False

    def finalize_totp_enrollment(self, challenge_id: str, *, totp_code: str) -> dict[str, Any]:
        challenge = self.consume_login_challenge(challenge_id)
        user = user_service.get_by_id(int(challenge.get("user_id") or 0))
        if not user:
            raise AuthSecurityError("Пользователь не найден")
        encrypted_secret = str(challenge.get("pending_totp_secret_enc") or "").strip()
        if not encrypted_secret:
            raise AuthSecurityError("Сначала начните настройку 2FA")
        try:
            secret = twofa_service.decrypt_secret(encrypted_secret)
        except Exception as exc:
            raise AuthSecurityError(f"Не удалось прочитать TOTP-секрет: {exc}") from exc
        if not twofa_service.verify_totp(secret=secret, code=totp_code):
            raise AuthSecurityError("Неверный код подтверждения")
        codes = twofa_service.generate_backup_codes()
        user_service.update_user(
            int(user.get("id") or 0),
            totp_secret_enc=encrypted_secret,
            is_2fa_enabled=True,
            twofa_enabled_at=_utc_iso(),
        )
        self._replace_backup_codes(int(user.get("id") or 0), codes)
        updated_user = user_service.get_by_id(int(user.get("id") or 0)) or user
        result = self._complete_login(
            challenge=challenge,
            user=updated_user,
            auth_method="totp_setup",
            device_id=None,
        )
        result["backup_codes"] = codes
        return result

    def verify_login_second_factor(
        self,
        challenge_id: str,
        *,
        totp_code: str | None = None,
        backup_code: str | None = None,
    ) -> dict[str, Any]:
        challenge = self.consume_login_challenge(challenge_id)
        user = user_service.get_by_id(int(challenge.get("user_id") or 0))
        if not user:
            raise AuthSecurityError("Пользователь не найден")
        if not bool(user.get("is_2fa_enabled", False)):
            raise AuthSecurityError("2FA ещё не включён")
        auth_method = ""
        if str(totp_code or "").strip():
            secret_enc = str(user.get("totp_secret_enc") or "").strip()
            if not secret_enc:
                raise AuthSecurityError("У пользователя не настроен TOTP")
            try:
                secret = twofa_service.decrypt_secret(secret_enc)
            except Exception as exc:
                raise AuthSecurityError(f"Не удалось прочитать TOTP-секрет: {exc}") from exc
            if not twofa_service.verify_totp(secret=secret, code=str(totp_code or "")):
                raise AuthSecurityError("Неверный код подтверждения")
            auth_method = "totp"
        elif str(backup_code or "").strip():
            if not self._consume_backup_code(int(user.get("id") or 0), str(backup_code or "")):
                raise AuthSecurityError("Неверный backup-код")
            auth_method = "backup_code"
        else:
            raise AuthSecurityError("Укажите код приложения или backup-код")
        return self._complete_login(challenge=challenge, user=user, auth_method=auth_method, device_id=None)

    def issue_tokens(self, *, user: dict, session_id: str, device_id: str) -> dict[str, Any]:
        access_ttl = self._access_ttl()
        refresh_ttl = self._refresh_ttl()
        access_token = create_access_token(
            {
                "sub": user["username"],
                "user_id": user["id"],
                "role": user.get("role", "viewer"),
                "session_id": session_id,
                "telegram_id": user.get("telegram_id"),
                "device_id": device_id,
            },
            expires_delta=access_ttl,
        )
        refresh_token = create_refresh_token(
            {
                "sub": user["username"],
                "user_id": user["id"],
                "role": user.get("role", "viewer"),
                "session_id": session_id,
                "telegram_id": user.get("telegram_id"),
                "device_id": device_id,
            },
            expires_delta=refresh_ttl,
        )
        from backend.utils.security import decode_access_token

        refresh_token_data = decode_access_token(refresh_token, expected_token_type="refresh")
        if refresh_token_data is None or not refresh_token_data.jti:
            raise AuthSecurityError("Не удалось выпустить refresh-токен")
        auth_runtime_store_service.save_refresh_token(
            refresh_token_data.jti,
            {
                "user_id": int(user.get("id") or 0),
                "session_id": session_id,
                "device_id": device_id,
            },
            ttl_seconds=_ttl_seconds(refresh_ttl),
        )
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "access_ttl_seconds": _ttl_seconds(access_ttl),
            "refresh_ttl_seconds": _ttl_seconds(refresh_ttl),
        }

    def _complete_login(
        self,
        *,
        challenge: dict[str, Any],
        user: dict,
        auth_method: str,
        device_id: str | None,
    ) -> dict[str, Any]:
        session_id = uuid.uuid4().hex
        session_expires = _now_utc() + self._refresh_ttl()
        session_service.create_session(
            session_id=session_id,
            user_id=int(user.get("id") or 0),
            username=str(user.get("username") or ""),
            role=str(user.get("role") or "viewer"),
            ip_address=str(challenge.get("ip_address") or ""),
            user_agent=str(challenge.get("user_agent") or ""),
            expires_at=session_expires.isoformat(),
        )
        auth_source = str(user.get("auth_source") or "local").strip().lower() or "local"
        password_enc = str(challenge.get("password_enc") or "").strip()
        if auth_source == "ldap" and password_enc:
            try:
                session_auth_context_service.store_session_context(
                    session_id=session_id,
                    user_id=int(user.get("id") or 0),
                    auth_source="ldap",
                    exchange_login=normalize_exchange_login(challenge.get("request_username") or user.get("username")),
                    password=decrypt_secret(password_enc),
                    expires_at=session_expires,
                )
            except Exception as exc:
                session_service.close_session(session_id)
                raise AuthSecurityError(f"Failed to initialize mail session context: {exc}") from exc
        final_device_id = str(device_id or f"session:{session_id}")
        tokens = self.issue_tokens(user=user, session_id=session_id, device_id=final_device_id)
        self.delete_login_challenge(str(challenge.get("challenge_id") or ""))
        try:
            security_email_service.send_new_login_alert(
                recipient_email=user.get("email"),
                username=str(user.get("username") or ""),
                ip_address=str(challenge.get("ip_address") or ""),
                device_label=_build_device_label(str(challenge.get("user_agent") or "")),
                auth_method=auth_method,
                login_at=_now_utc(),
            )
        except Exception:
            logger.warning("Security email dispatch failed for %s", user.get("username"), exc_info=True)
        return {
            "status": "authenticated",
            "user": self._build_public_user(
                user,
                network_zone=str(challenge.get("network_zone") or "external"),
                twofa_policy=str(challenge.get("twofa_policy") or resolve_twofa_policy()),
                twofa_required_for_current_request=bool(challenge.get("twofa_required_for_current_request", False)),
            ),
            "session_id": session_id,
            "login_challenge_id": None,
            "available_second_factors": [],
            "trusted_devices_available": False,
            **tokens,
        }

    def finalize_trusted_device_login(self, challenge_id: str, *, device: dict[str, Any]) -> dict[str, Any]:
        challenge = self.consume_login_challenge(challenge_id)
        user = user_service.get_by_id(int(challenge.get("user_id") or 0))
        if not user:
            raise AuthSecurityError("Пользователь не найден")
        trusted_device_service.mark_device_used(str(device.get("id") or ""))
        return self._complete_login(
            challenge=challenge,
            user=user,
            auth_method="trusted_device",
            device_id=f"trusted:{str(device.get('id') or '').strip()}",
        )

    def complete_passkey_login(
        self,
        *,
        user: dict,
        device: dict[str, Any],
        ip_address: str,
        user_agent: str,
        network_zone: str,
        request_username: str | None = None,
    ) -> dict[str, Any]:
        effective_policy = resolve_twofa_policy()
        effective_zone = str(network_zone or "external").strip().lower() or "external"
        twofa_required_for_current_request = is_twofa_required_for_zone(effective_zone, policy=effective_policy)
        trusted_device_service.mark_device_used(str(device.get("id") or ""))
        return self._complete_login(
            challenge={
                "challenge_id": None,
                "user_id": int(user.get("id") or 0),
                "username": str(user.get("username") or "").strip(),
                "request_username": str(request_username or user.get("username") or "").strip(),
                "role": str(user.get("role") or "viewer"),
                "auth_source": str(user.get("auth_source") or "local").strip().lower() or "local",
                "ip_address": str(ip_address or "").strip(),
                "user_agent": str(user_agent or "").strip(),
                "created_at": _utc_iso(),
                "network_zone": effective_zone,
                "twofa_policy": effective_policy,
                "twofa_required_for_current_request": bool(twofa_required_for_current_request),
            },
            user=user,
            auth_method="passkey",
            device_id=f"trusted:{str(device.get('id') or '').strip()}",
        )

    def refresh_session_tokens(
        self,
        *,
        user: dict,
        session_id: str,
        device_id: str,
        network_zone: str = "external",
        twofa_policy: str | None = None,
    ) -> dict[str, Any]:
        if not session_service.is_session_active(session_id):
            raise AuthSecurityError("Сессия больше не активна")
        session_service.touch_session(session_id)
        effective_policy = str(twofa_policy or resolve_twofa_policy()).strip().lower()
        return {
            "user": self._build_public_user(
                user,
                network_zone=network_zone,
                twofa_policy=effective_policy,
                twofa_required_for_current_request=is_twofa_required_for_zone(network_zone, policy=effective_policy),
            ),
            "session_id": session_id,
            **self.issue_tokens(user=user, session_id=session_id, device_id=device_id),
        }

    def reset_user_twofa(self, *, user_id: int) -> dict[str, Any]:
        user = user_service.get_by_id(int(user_id))
        if not user:
            raise AuthSecurityError("Пользователь не найден")
        user_service.update_user(
            int(user_id),
            totp_secret_enc="",
            is_2fa_enabled=False,
            twofa_enabled_at=None,
        )
        with app_session() as session:
            session.execute(delete(AppUser2FABackupCode).where(AppUser2FABackupCode.user_id == int(user_id)))
        revoked_devices = trusted_device_service.revoke_all_user_devices(int(user_id))
        active_sessions = [
            item
            for item in session_service.list_sessions(active_only=True)
            if int(item.get("user_id", 0) or 0) == int(user_id)
        ]
        for item in active_sessions:
            session_id = str(item.get("session_id") or "").strip()
            if session_id:
                session_service.close_session(session_id)
                session_auth_context_service.delete_session_context(session_id)
        return {
            "success": True,
            "user_id": int(user_id),
            "revoked_devices": revoked_devices,
            "closed_sessions": len(active_sessions),
        }


auth_security_service = AuthSecurityService()
