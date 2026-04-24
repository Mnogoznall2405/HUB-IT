"""App-database-backed inventory storage helpers."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import delete, select

from backend.appdb.db import app_session, ensure_app_schema_initialized
from backend.appdb.models import AppInventoryChangeEvent, AppInventoryHost


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_mac(value: Any) -> str:
    return str(value or "").replace("-", "").replace(":", "").replace(".", "").strip().upper()


def _payload_host_key(payload: dict[str, Any]) -> str:
    normalized_mac = _normalize_mac(payload.get("mac_address"))
    if normalized_mac:
        return normalized_mac
    return str(payload.get("hostname") or "").strip().lower()


class AppInventoryStore:
    """Inventory snapshot/change store backed by app-db tables."""

    def __init__(self, *, database_url: str | None = None) -> None:
        self._database_url = ensure_app_schema_initialized(database_url) if database_url else None

    @staticmethod
    def _decode_json(payload_json: str, default: Any) -> Any:
        try:
            return json.loads(str(payload_json or "null"))
        except Exception:
            return default

    @classmethod
    def _row_payload(cls, row: AppInventoryHost) -> dict[str, Any]:
        payload = cls._decode_json(row.payload_json, {})
        if not isinstance(payload, dict):
            payload = {}

        if not payload.get("mac_address"):
            payload["mac_address"] = str(row.mac_address or "")
        if row.hostname is not None:
            payload["hostname"] = str(row.hostname)
        if row.user_login is not None:
            payload["user_login"] = str(row.user_login)
        if row.user_full_name is not None:
            payload["user_full_name"] = str(row.user_full_name)
        if row.ip_primary is not None:
            payload["ip_primary"] = str(row.ip_primary)
        if row.report_type is not None:
            payload["report_type"] = str(row.report_type)
        if row.last_seen_at is not None:
            payload["last_seen_at"] = int(row.last_seen_at)
        if row.last_full_snapshot_at is not None:
            payload["last_full_snapshot_at"] = int(row.last_full_snapshot_at)
        return payload

    def get_host(self, mac_address: str) -> Optional[dict[str, Any]]:
        host_key = _normalize_mac(mac_address)
        if not host_key:
            return None
        with app_session(self._database_url) as session:
            row = session.get(AppInventoryHost, host_key)
            if row is None:
                return None
            return self._row_payload(row)

    def list_hosts(self) -> list[dict[str, Any]]:
        with app_session(self._database_url) as session:
            rows = session.scalars(select(AppInventoryHost).order_by(AppInventoryHost.mac_address.asc())).all()
            return [self._row_payload(row) for row in rows]

    def upsert_host(self, payload: dict[str, Any]) -> None:
        host_key = _payload_host_key(payload)
        if not host_key:
            return
        now = _utcnow()
        with app_session(self._database_url) as session:
            row = session.get(AppInventoryHost, host_key)
            if row is None:
                row = AppInventoryHost(mac_address=host_key)
                session.add(row)
            row.hostname = str(payload.get("hostname") or "").strip() or None
            row.user_login = str(payload.get("user_login") or "").strip() or None
            row.user_full_name = str(payload.get("user_full_name") or "").strip() or None
            row.ip_primary = str(payload.get("ip_primary") or "").strip() or None
            row.report_type = str(payload.get("report_type") or "full_snapshot").strip() or "full_snapshot"
            row.last_seen_at = int(payload.get("last_seen_at")) if payload.get("last_seen_at") not in (None, "") else None
            row.last_full_snapshot_at = (
                int(payload.get("last_full_snapshot_at")) if payload.get("last_full_snapshot_at") not in (None, "") else None
            )
            row.payload_json = json.dumps(payload, ensure_ascii=False)
            row.updated_at = now

    def touch_host_presence(
        self,
        mac_address: str,
        *,
        last_seen_at: int,
        report_type: str,
        hostname: str | None = None,
        user_login: str | None = None,
        user_full_name: str | None = None,
        ip_primary: str | None = None,
    ) -> bool:
        host_key = _normalize_mac(mac_address)
        if not host_key:
            return False
        now = _utcnow()
        with app_session(self._database_url) as session:
            row = session.get(AppInventoryHost, host_key)
            if row is None:
                return False
            row.last_seen_at = int(last_seen_at)
            row.report_type = str(report_type or "heartbeat").strip() or "heartbeat"
            normalized_hostname = str(hostname or "").strip()
            normalized_user_login = str(user_login or "").strip()
            normalized_user_full_name = str(user_full_name or "").strip()
            normalized_ip_primary = str(ip_primary or "").strip()
            if normalized_hostname:
                row.hostname = normalized_hostname
            if normalized_user_login:
                row.user_login = normalized_user_login
            if normalized_user_full_name:
                row.user_full_name = normalized_user_full_name
            if normalized_ip_primary:
                row.ip_primary = normalized_ip_primary
            row.updated_at = now
            return True

    def list_change_events(self) -> list[dict[str, Any]]:
        with app_session(self._database_url) as session:
            rows = session.scalars(
                select(AppInventoryChangeEvent).order_by(
                    AppInventoryChangeEvent.detected_at.desc(),
                    AppInventoryChangeEvent.event_id.desc(),
                )
            ).all()

        result: list[dict[str, Any]] = []
        for row in rows:
            event = {
                "event_id": str(row.event_id),
                "detected_at": int(row.detected_at),
                "mac_address": str(row.mac_address or ""),
                "hostname": str(row.hostname or ""),
                "change_types": self._decode_json(row.change_types_json, []),
                "diff": self._decode_json(row.diff_json, {}),
                "report_type": str(row.report_type or "full_snapshot"),
                "before_signature": self._decode_json(row.before_json, {}),
                "after_signature": self._decode_json(row.after_json, {}),
            }
            result.append(event)
        return result

    def append_change_event(self, event: dict[str, Any]) -> None:
        event_id = str(event.get("event_id") or "").strip()
        if not event_id:
            return
        with app_session(self._database_url) as session:
            row = session.get(AppInventoryChangeEvent, event_id)
            if row is None:
                row = AppInventoryChangeEvent(event_id=event_id)
                session.add(row)
            row.mac_address = str(event.get("mac_address") or "").strip() or None
            row.hostname = str(event.get("hostname") or "").strip() or None
            row.detected_at = int(event.get("detected_at") or 0)
            row.report_type = str(event.get("report_type") or "full_snapshot").strip() or "full_snapshot"
            row.change_types_json = json.dumps(event.get("change_types") or [], ensure_ascii=False)
            row.diff_json = json.dumps(event.get("diff") or {}, ensure_ascii=False)
            row.before_json = json.dumps(event.get("before_signature") or {}, ensure_ascii=False)
            row.after_json = json.dumps(event.get("after_signature") or {}, ensure_ascii=False)
            row.created_at = _utcnow()

    def prune_change_events(self, cutoff_ts: int) -> int:
        with app_session(self._database_url) as session:
            rows = session.scalars(
                select(AppInventoryChangeEvent.event_id).where(AppInventoryChangeEvent.detected_at < int(cutoff_ts))
            ).all()
            if not rows:
                return 0
            session.execute(delete(AppInventoryChangeEvent).where(AppInventoryChangeEvent.detected_at < int(cutoff_ts)))
            return len(rows)

    def replace_from_legacy(self, snapshot: dict[str, Any], changes: list[dict[str, Any]]) -> None:
        with app_session(self._database_url) as session:
            session.execute(delete(AppInventoryHost))
            session.execute(delete(AppInventoryChangeEvent))

            now = _utcnow()
            for item in snapshot.values():
                if not isinstance(item, dict):
                    continue
                host_key = _payload_host_key(item)
                if not host_key:
                    continue
                session.add(
                    AppInventoryHost(
                        mac_address=host_key,
                        hostname=str(item.get("hostname") or "").strip() or None,
                        user_login=str(item.get("user_login") or "").strip() or None,
                        user_full_name=str(item.get("user_full_name") or "").strip() or None,
                        ip_primary=str(item.get("ip_primary") or "").strip() or None,
                        report_type=str(item.get("report_type") or "full_snapshot").strip() or "full_snapshot",
                        last_seen_at=int(item.get("last_seen_at")) if item.get("last_seen_at") not in (None, "") else None,
                        last_full_snapshot_at=int(item.get("last_full_snapshot_at")) if item.get("last_full_snapshot_at") not in (None, "") else None,
                        payload_json=json.dumps(item, ensure_ascii=False),
                        updated_at=now,
                    )
                )

            for event in changes:
                event_id = str((event or {}).get("event_id") or "").strip()
                if not event_id:
                    continue
                session.add(
                    AppInventoryChangeEvent(
                        event_id=event_id,
                        mac_address=str((event or {}).get("mac_address") or "").strip() or None,
                        hostname=str((event or {}).get("hostname") or "").strip() or None,
                        detected_at=int((event or {}).get("detected_at") or 0),
                        report_type=str((event or {}).get("report_type") or "full_snapshot").strip() or "full_snapshot",
                        change_types_json=json.dumps((event or {}).get("change_types") or [], ensure_ascii=False),
                        diff_json=json.dumps((event or {}).get("diff") or {}, ensure_ascii=False),
                        before_json=json.dumps((event or {}).get("before_signature") or {}, ensure_ascii=False),
                        after_json=json.dumps((event or {}).get("after_signature") or {}, ensure_ascii=False),
                        created_at=now,
                    )
                )
