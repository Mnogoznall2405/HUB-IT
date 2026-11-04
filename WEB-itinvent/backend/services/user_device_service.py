"""Owner-scoped device management. Device deletion preserves authentication history."""
from datetime import datetime, timezone
import logging

from sqlalchemy import select

from backend.appdb.db import app_session
from backend.appdb.models import AppMobileBiometricCredential, AppSessionRecord, AppUser
from backend.services.session_service import session_service
from backend.services.session_auth_context_service import session_auth_context_service

logger = logging.getLogger(__name__)


class UserDeviceNotFoundError(ValueError):
    pass


class UserDeviceService:
    def __init__(self, database_url=None):
        self.database_url = database_url

    @staticmethod
    def _key(row):
        return row.get("client_device_key_hash") or f"session:{row['session_id']}"

    def list_devices(self, *, user_id: int, current_session_id: str) -> list[dict]:
        rows = session_service.list_sessions_by_user_ids({user_id}, active_only=True)
        groups = {}
        for row in rows:
            key = self._key(row)
            group = groups.setdefault(key, {
                "id": f"s:{row['session_id']}",
                "label": row.get("device_label") or "Неизвестное устройство",
                "is_current": False, "biometric_enabled": False,
                "last_seen_at": row.get("last_seen_at"), "sessions": [],
            })
            current = row["session_id"] == current_session_id
            if current:
                group["id"] = f"s:{row['session_id']}"
                group["is_current"] = True
            group["sessions"].append({
                "session_id": row["session_id"], "created_at": row["created_at"],
                "last_seen_at": row["last_seen_at"], "ip_address": row.get("ip_address") or "",
                "device_label": row.get("device_label") or "Неизвестное устройство", "is_current": current,
            })
        with app_session(self.database_url) as db:
            credentials = db.scalars(select(AppMobileBiometricCredential).where(
                AppMobileBiometricCredential.user_id == user_id,
                AppMobileBiometricCredential.is_active.is_(True),
                AppMobileBiometricCredential.revoked_at.is_(None),
            )).all()
            for credential in credentials:
                group = groups.setdefault(credential.client_device_key_hash, {
                    "id": f"b:{credential.id}", "label": "Приложение Android",
                    "is_current": False, "sessions": [],
                    "last_seen_at": (credential.last_used_at or credential.created_at).isoformat(),
                })
                group["biometric_enabled"] = True
                group["label"] = "Приложение Android"
        return sorted(groups.values(), reverse=True, key=lambda item: (
            item["is_current"],
            datetime.fromisoformat(item["last_seen_at"]).timestamp() if item["last_seen_at"] else 0,
        ))

    def revoke(self, *, user_id: int, current_session_id: str, device_id: str | None = None,
               session_id: str | None = None, others: bool = False) -> dict:
        closed_ids = []
        affected_ids = []
        revoked = 0
        now = datetime.now(timezone.utc)
        with app_session(self.database_url) as db:
            # Same lock as create_session: renewal cannot recreate a removed
            # device after the credential has been revoked in this transaction.
            db.get(AppUser, user_id, with_for_update=True)
            current = db.get(AppSessionRecord, current_session_id)
            if current is None or current.user_id != user_id or not current.is_active:
                raise UserDeviceNotFoundError("Current session is no longer active")
            sessions = db.scalars(select(AppSessionRecord).where(AppSessionRecord.user_id == user_id)).all()
            credentials = db.scalars(select(AppMobileBiometricCredential).where(
                AppMobileBiometricCredential.user_id == user_id,
            )).all()
            target_hash = None
            target_session = None
            if session_id is not None:
                target_session = next((row for row in sessions if row.session_id == session_id), None)
                if target_session is None:
                    raise UserDeviceNotFoundError("Session not found")
            elif not others:
                kind, _, identifier = str(device_id or "").partition(":")
                if kind == "s":
                    target_session = next((row for row in sessions if row.session_id == identifier), None)
                    if target_session is not None:
                        target_hash = target_session.client_device_key_hash
                elif kind == "b":
                    credential = next((row for row in credentials if row.id == identifier), None)
                    if credential is not None:
                        target_hash = credential.client_device_key_hash
                if target_session is None and target_hash is None:
                    raise UserDeviceNotFoundError("Device not found")

            def selected(row):
                if others:
                    return row.session_id != current_session_id and (
                        not current.client_device_key_hash or row.client_device_key_hash != current.client_device_key_hash
                    )
                if session_id is not None or not target_hash:
                    return row is target_session
                return row.client_device_key_hash == target_hash

            for row in sessions:
                if not selected(row):
                    continue
                affected_ids.append(row.session_id)
                if row.is_active:
                    row.is_active = False
                    row.status = "terminated"
                    row.closed_at = now
                    row.closed_reason = "terminated"
                    closed_ids.append(row.session_id)
            if session_id is None:
                for credential in credentials:
                    matches = (credential.client_device_key_hash != current.client_device_key_hash) if others else (
                        target_hash is not None and credential.client_device_key_hash == target_hash
                    )
                    if matches and credential.is_active:
                        credential.is_active = False
                        credential.revoked_at = now
                        revoked += 1
        # No mail/context storage I/O while the DB transaction is open.
        for affected_id in affected_ids:
            session_service._cache_invalidate(affected_id)
        for affected_id in affected_ids:
            session_auth_context_service.delete_session_context(affected_id)
        logger.info("Own device action user_id=%s action=%s closed_sessions=%s revoked_biometrics=%s",
                    user_id, "others" if others else "session" if session_id else "device", len(closed_ids), revoked)
        return {"success": True, "closed_sessions": len(closed_ids),
                "revoked_biometric_credentials": revoked,
                "current_session_closed": current_session_id in closed_ids}


user_device_service = UserDeviceService()
