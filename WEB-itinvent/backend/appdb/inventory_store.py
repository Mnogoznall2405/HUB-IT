"""App-database-backed inventory storage helpers."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import delete, func, or_, select

from backend.appdb.db import app_session, ensure_app_schema_initialized
from backend.appdb.models import (
    AppInventoryChangeEvent,
    AppInventoryHost,
    AppInventoryHostSqlContext,
    AppInventoryOutlookFile,
    AppInventoryUserProfile,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_mac(value: Any) -> str:
    return str(value or "").replace("-", "").replace(":", "").replace(".", "").strip().upper()


def _payload_host_key(payload: dict[str, Any]) -> str:
    normalized_mac = _normalize_mac(payload.get("mac_address"))
    if normalized_mac:
        return normalized_mac
    return str(payload.get("hostname") or "").strip().lower()


def _normalize_text(value: Any) -> str:
    return str(value or "").replace("\x00", "").strip()


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _first_value(raw: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in raw:
            return raw.get(key)
    return None


def _normalize_profile_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_sizes = payload.get("user_profile_sizes") if isinstance(payload.get("user_profile_sizes"), dict) else {}
    raw_profiles = raw_sizes.get("profiles") if isinstance(raw_sizes.get("profiles"), list) else []
    rows: list[dict[str, Any]] = []
    for raw in raw_profiles:
        if not isinstance(raw, dict):
            continue
        user_name = _normalize_text(_first_value(raw, "user_name", "userName"))
        profile_path = _normalize_text(_first_value(raw, "profile_path", "profilePath"))
        if not user_name and not profile_path:
            continue
        rows.append(
            {
                "user_name": user_name or None,
                "profile_path": profile_path or None,
                "total_size_bytes": max(0, _to_int(_first_value(raw, "total_size_bytes", "totalSizeBytes"), 0)),
                "files_count": max(0, _to_int(_first_value(raw, "files_count", "filesCount"), 0)),
                "dirs_count": max(0, _to_int(_first_value(raw, "dirs_count", "dirsCount"), 0)),
                "errors_count": max(0, _to_int(_first_value(raw, "errors_count", "errorsCount"), 0)),
                "partial": bool(raw.get("partial")),
            }
        )
    return rows


def _normalize_outlook_file_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    outlook = payload.get("outlook") if isinstance(payload.get("outlook"), dict) else {}
    candidates: list[tuple[str, dict[str, Any]]] = []
    active_store = outlook.get("active_store") if isinstance(outlook.get("active_store"), dict) else None
    if active_store:
        candidates.append(("active", active_store))
    active_stores = outlook.get("active_stores") if isinstance(outlook.get("active_stores"), list) else []
    for raw in active_stores:
        if isinstance(raw, dict):
            candidates.append(("active", raw))
    active_candidate = outlook.get("active_candidate") if isinstance(outlook.get("active_candidate"), dict) else None
    if active_candidate:
        candidates.append(("candidate", active_candidate))
    archives = outlook.get("archives") if isinstance(outlook.get("archives"), list) else []
    for raw in archives:
        if isinstance(raw, dict):
            candidates.append(("archive", raw))

    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for kind, raw in candidates:
        path = _normalize_text(raw.get("path"))
        if not path:
            continue
        key = (kind, path.lower())
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "kind": kind,
                "file_path": path,
                "file_type": _normalize_text(raw.get("type")).lower() or None,
                "size_bytes": max(0, _to_int(raw.get("size_bytes"), 0)),
                "last_modified_at": _to_int(raw.get("last_modified_at"), 0) or None,
            }
        )
    return rows


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

    def list_hosts(self, host_keys: set[str] | list[str] | None = None) -> list[dict[str, Any]]:
        with app_session(self._database_url) as session:
            stmt = select(AppInventoryHost).order_by(AppInventoryHost.mac_address.asc())
            if host_keys is not None:
                normalized_keys = [_normalize_mac(item) or str(item or "").strip().lower() for item in host_keys]
                normalized_keys = [item for item in normalized_keys if item]
                if not normalized_keys:
                    return []
                stmt = stmt.where(AppInventoryHost.mac_address.in_(normalized_keys))
            rows = session.scalars(stmt).all()
            return [self._row_payload(row) for row in rows]

    def search_host_keys(self, query: str, search_fields: set[str]) -> set[str] | None:
        needle = _normalize_text(query).lower()
        if not needle:
            return None
        fields = set(search_fields or set())
        if "network" in fields:
            return None
        pattern = f"%{needle}%"
        keys: set[str] = set()
        with app_session(self._database_url) as session:
            if "identity" in fields or "user" in fields:
                host_conditions = []
                if "identity" in fields:
                    host_conditions.extend(
                        [
                            func.lower(AppInventoryHost.hostname).like(pattern),
                            func.lower(AppInventoryHost.mac_address).like(pattern),
                            func.lower(AppInventoryHost.ip_primary).like(pattern),
                        ]
                    )
                if "user" in fields:
                    host_conditions.extend(
                        [
                            func.lower(AppInventoryHost.user_login).like(pattern),
                            func.lower(AppInventoryHost.user_full_name).like(pattern),
                        ]
                    )
                if host_conditions:
                    keys.update(
                        str(item or "")
                        for item in session.scalars(
                            select(AppInventoryHost.mac_address).where(or_(*host_conditions))
                        ).all()
                    )
            if "profiles" in fields:
                keys.update(
                    str(item or "")
                    for item in session.scalars(
                        select(AppInventoryUserProfile.mac_address).where(
                            or_(
                                func.lower(AppInventoryUserProfile.user_name).like(pattern),
                                func.lower(AppInventoryUserProfile.profile_path).like(pattern),
                            )
                        )
                    ).all()
                )
            if "outlook" in fields:
                keys.update(
                    str(item or "")
                    for item in session.scalars(
                        select(AppInventoryOutlookFile.mac_address).where(
                            or_(
                                func.lower(AppInventoryOutlookFile.file_path).like(pattern),
                                func.lower(AppInventoryOutlookFile.file_type).like(pattern),
                                func.lower(AppInventoryOutlookFile.kind).like(pattern),
                            )
                        )
                    ).all()
                )
            if "location" in fields or "database" in fields:
                context_conditions = []
                if "location" in fields:
                    context_conditions.extend(
                        [
                            func.lower(AppInventoryHostSqlContext.branch_name).like(pattern),
                            func.lower(AppInventoryHostSqlContext.location_name).like(pattern),
                        ]
                    )
                if "database" in fields:
                    context_conditions.append(func.lower(AppInventoryHostSqlContext.db_id).like(pattern))
                if context_conditions:
                    keys.update(
                        str(item or "")
                        for item in session.scalars(
                            select(AppInventoryHostSqlContext.mac_address).where(or_(*context_conditions))
                        ).all()
                    )
        return {item for item in keys if item}

    def get_sql_context(self, *, mac_address: str, hostname: str, db_id: str) -> Optional[dict[str, Any]]:
        normalized_mac = _normalize_mac(mac_address)
        normalized_hostname = _normalize_text(hostname).lower()
        normalized_db_id = _normalize_text(db_id)
        if not normalized_db_id or (not normalized_mac and not normalized_hostname):
            return None
        with app_session(self._database_url) as session:
            stmt = select(AppInventoryHostSqlContext).where(AppInventoryHostSqlContext.db_id == normalized_db_id)
            if normalized_mac:
                stmt = stmt.where(AppInventoryHostSqlContext.mac_address == normalized_mac)
            else:
                stmt = stmt.where(AppInventoryHostSqlContext.hostname == normalized_hostname)
            row = session.scalars(stmt.order_by(AppInventoryHostSqlContext.updated_at.desc())).first()
            if row is None:
                return None
            return {
                "branch_no": row.branch_no,
                "branch_name": row.branch_name,
                "location_name": row.location_name,
                "employee_name": row.employee_name,
                "inv_no": row.inventory_inv_no,
                "model_name": row.inventory_model_name,
                "ip_address": row.ip_address,
            }

    def upsert_sql_context(self, *, mac_address: str, hostname: str, db_id: str, context: dict[str, Any]) -> None:
        normalized_mac = _normalize_mac(mac_address)
        normalized_hostname = _normalize_text(hostname).lower()
        normalized_db_id = _normalize_text(db_id)
        if not normalized_db_id or (not normalized_mac and not normalized_hostname) or not isinstance(context, dict):
            return
        now = _utcnow()
        with app_session(self._database_url) as session:
            row = session.scalars(
                select(AppInventoryHostSqlContext).where(
                    AppInventoryHostSqlContext.mac_address == normalized_mac,
                    AppInventoryHostSqlContext.hostname == normalized_hostname,
                    AppInventoryHostSqlContext.db_id == normalized_db_id,
                )
            ).first()
            if row is None:
                row = AppInventoryHostSqlContext(
                    mac_address=normalized_mac,
                    hostname=normalized_hostname,
                    db_id=normalized_db_id,
                )
                session.add(row)
            row.branch_no = _normalize_text(context.get("branch_no")) or None
            row.branch_name = _normalize_text(context.get("branch_name")) or None
            row.location_name = _normalize_text(context.get("location_name")) or None
            row.employee_name = _normalize_text(context.get("employee_name")) or None
            row.inventory_inv_no = _normalize_text(context.get("inv_no") or context.get("inventory_inv_no")) or None
            row.inventory_model_name = _normalize_text(context.get("model_name") or context.get("inventory_model_name")) or None
            row.ip_address = _normalize_text(context.get("ip_address")) or None
            row.updated_at = now

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
            if row.report_type != "heartbeat":
                self._replace_search_indexes(session, host_key, payload, now)

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
            session.execute(delete(AppInventoryUserProfile))
            session.execute(delete(AppInventoryOutlookFile))
            session.execute(delete(AppInventoryHostSqlContext))

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
                self._replace_search_indexes(session, host_key, item, now)

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

    def _replace_search_indexes(self, session, host_key: str, payload: dict[str, Any], now: datetime) -> None:
        session.execute(delete(AppInventoryUserProfile).where(AppInventoryUserProfile.mac_address == host_key))
        session.execute(delete(AppInventoryOutlookFile).where(AppInventoryOutlookFile.mac_address == host_key))
        for row in _normalize_profile_rows(payload):
            session.add(
                AppInventoryUserProfile(
                    mac_address=host_key,
                    user_name=row["user_name"],
                    profile_path=row["profile_path"],
                    total_size_bytes=row["total_size_bytes"],
                    files_count=row["files_count"],
                    dirs_count=row["dirs_count"],
                    errors_count=row["errors_count"],
                    partial=row["partial"],
                    updated_at=now,
                )
            )
        for row in _normalize_outlook_file_rows(payload):
            session.add(
                AppInventoryOutlookFile(
                    mac_address=host_key,
                    kind=row["kind"],
                    file_path=row["file_path"],
                    file_type=row["file_type"],
                    size_bytes=row["size_bytes"],
                    last_modified_at=row["last_modified_at"],
                    updated_at=now,
                )
            )
