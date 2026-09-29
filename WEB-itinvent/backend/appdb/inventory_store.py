"""App-database-backed inventory storage helpers."""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import and_, delete, func, or_, select

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
        hidden_at = int(row.hidden_at) if getattr(row, "hidden_at", None) not in (None, "") else None
        payload["hidden_at"] = hidden_at
        payload["hidden_by"] = str(getattr(row, "hidden_by", None) or "").strip() or None
        payload["hidden_reason"] = str(getattr(row, "hidden_reason", None) or "").strip() or None
        payload["is_hidden"] = hidden_at is not None
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

    def list_hosts(
        self,
        host_keys: set[str] | list[str] | None = None,
        *,
        include_hidden: bool = False,
        hidden_only: bool = False,
    ) -> list[dict[str, Any]]:
        with app_session(self._database_url) as session:
            stmt = select(AppInventoryHost).order_by(AppInventoryHost.mac_address.asc())
            if host_keys is not None:
                normalized_keys = [_normalize_mac(item) or str(item or "").strip().lower() for item in host_keys]
                normalized_keys = [item for item in normalized_keys if item]
                if not normalized_keys:
                    return []
                stmt = stmt.where(AppInventoryHost.mac_address.in_(normalized_keys))
            if hidden_only:
                stmt = stmt.where(AppInventoryHost.hidden_at.is_not(None))
            elif not include_hidden:
                stmt = stmt.where(AppInventoryHost.hidden_at.is_(None))
            rows = session.scalars(stmt).all()
            return [self._row_payload(row) for row in rows]

    @staticmethod
    def _folded_search_expr(column):
        """lower() + ё→е: зеркало _fold_search_text для SQL LIKE-паттернов."""
        return func.replace(func.lower(column), "ё", "е")

    def search_host_keys(
        self,
        query: str,
        search_fields: set[str],
        db_ids: list[str] | None = None,
        include_payload: bool = False,
    ) -> set[str] | None:
        """Возвращает mac-ключи хостов по индексным LIKE-колонкам.

        Запрос разбивается на токены по пробелам (фолдинг: lower + ё→е) и
        трактуется как AND: ключи по каждому токену пересекаются — пересечение
        надмножеств остаётся надмножеством AND-ответа, точность даёт
        Python-фильтр на стороне API.
        """
        tokens = [
            token
            for token in re.split(r"\s+", _normalize_text(query).lower().replace("ё", "е"))
            if token
        ]
        if not tokens:
            return None
        fields = set(search_fields or set())
        if "network" in fields:
            return None
        with app_session(self._database_url) as session:
            result: set[str] | None = None
            for token in tokens:
                token_keys = self._search_token_host_keys(session, token, fields, include_payload)
                if token_keys is None:
                    return None
                result = token_keys if result is None else (result & token_keys)
                if not result:
                    return set()
        result = result or set()
        if db_ids:
            scoped = self.list_mac_addresses_for_db_ids(db_ids)
            if scoped:
                result = {item for item in result if item in scoped}
            else:
                return set()
        return result

    def _search_token_host_keys(
        self,
        session,
        token: str,
        fields: set[str],
        include_payload: bool,
    ) -> set[str] | None:
        # SQLite lower() — только ASCII: LIKE по кириллице надёжно не сматчится,
        # поэтому честно просим полный скан вместо пустого кандидат-набора.
        if session.bind.dialect.name == "sqlite" and any(ord(ch) > 127 for ch in token):
            return None
        folded = self._folded_search_expr
        pattern = f"%{token}%"
        escaped_pattern = (
            f"%{token.replace(chr(92), chr(92) * 2)}%"
            if "\\" in token
            else pattern
        )
        keys: set[str] = set()
        host_conditions = []
        if "identity" in fields:
            host_conditions.extend(
                [
                    folded(AppInventoryHost.hostname).like(pattern),
                    folded(AppInventoryHost.mac_address).like(pattern),
                    folded(AppInventoryHost.ip_primary).like(pattern),
                ]
            )
            # MAC без разделителей: 'aabbccddeeff' матчит 'AA:BB:CC:DD:EE:FF'.
            if len(token) >= 4 and re.fullmatch(r"[0-9a-f]+", token):
                host_conditions.append(
                    func.replace(
                        func.replace(func.lower(AppInventoryHost.mac_address), ":", ""),
                        "-",
                        "",
                    ).like(pattern)
                )
        if "user" in fields:
            host_conditions.extend(
                [
                    folded(AppInventoryHost.user_login).like(pattern),
                    folded(AppInventoryHost.user_full_name).like(pattern),
                ]
            )
        if include_payload and fields & {"identity", "user", "profiles", "outlook"}:
            # payload_json покрывает payload-поля: ip_list, current_user, папки профилей, производные outlook-пути
            host_conditions.append(folded(AppInventoryHost.payload_json).like(pattern))
            if escaped_pattern != pattern:
                host_conditions.append(func.lower(AppInventoryHost.payload_json).like(escaped_pattern))
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
                            folded(AppInventoryUserProfile.user_name).like(pattern),
                            folded(AppInventoryUserProfile.profile_path).like(pattern),
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
                            folded(AppInventoryOutlookFile.file_path).like(pattern),
                            folded(AppInventoryOutlookFile.file_type).like(pattern),
                            folded(AppInventoryOutlookFile.kind).like(pattern),
                        )
                    )
                ).all()
            )
        if "location" in fields or "database" in fields or "user" in fields:
            context_conditions = []
            if "location" in fields:
                context_conditions.extend(
                    [
                        folded(AppInventoryHostSqlContext.branch_name).like(pattern),
                        folded(AppInventoryHostSqlContext.location_name).like(pattern),
                    ]
                )
            if "database" in fields:
                context_conditions.append(folded(AppInventoryHostSqlContext.db_id).like(pattern))
            if "user" in fields:
                context_conditions.append(folded(AppInventoryHostSqlContext.employee_name).like(pattern))
            if context_conditions:
                keys.update(
                    str(item or "")
                    for item in session.scalars(
                        select(AppInventoryHostSqlContext.mac_address).where(or_(*context_conditions))
                    ).all()
                )
        return {item for item in keys if item}

    def list_mac_addresses_for_db_ids(
        self,
        db_ids: list[str],
        *,
        branch: str | None = None,
    ) -> set[str]:
        """Return MAC addresses linked to ITINVENT SQL contexts for the given databases."""
        normalized_db_ids = [_normalize_text(item) for item in db_ids or [] if _normalize_text(item)]
        if not normalized_db_ids:
            return set()
        branch_value = _normalize_text(branch).lower()
        with app_session(self._database_url) as session:
            stmt = select(AppInventoryHostSqlContext.mac_address).where(
                AppInventoryHostSqlContext.db_id.in_(normalized_db_ids)
            )
            if branch_value:
                stmt = stmt.where(func.lower(AppInventoryHostSqlContext.branch_name) == branch_value)
            rows = session.scalars(stmt.distinct()).all()
        return {str(item or "").strip() for item in rows if str(item or "").strip()}

    def list_unassigned_host_keys(self, db_ids: list[str] | None = None) -> set[str]:
        """Return host MACs that have no SQL context in the given databases."""
        normalized_db_ids = [_normalize_text(item) for item in db_ids or [] if _normalize_text(item)] if db_ids is not None else None
        with app_session(self._database_url) as session:
            ctx_macs = select(AppInventoryHostSqlContext.mac_address).where(
                AppInventoryHostSqlContext.mac_address != ""
            )
            ctx_hostnames = select(func.lower(AppInventoryHostSqlContext.hostname)).where(
                AppInventoryHostSqlContext.hostname != ""
            )
            if normalized_db_ids:
                ctx_macs = ctx_macs.where(AppInventoryHostSqlContext.db_id.in_(normalized_db_ids))
                ctx_hostnames = ctx_hostnames.where(AppInventoryHostSqlContext.db_id.in_(normalized_db_ids))
            stmt = select(AppInventoryHost.mac_address).where(
                AppInventoryHost.mac_address.notin_(ctx_macs),
                or_(
                    AppInventoryHost.hostname.is_(None),
                    func.lower(AppInventoryHost.hostname).notin_(ctx_hostnames),
                ),
            )
            rows = session.scalars(stmt).all()
        return {str(item or "").strip() for item in rows if str(item or "").strip()}

    def list_host_keys_for_context(
        self,
        db_ids: list[str],
        *,
        branch_name: str | None = None,
    ) -> set[str]:
        """Return host MACs having an SQL context in the given databases (optionally by branch)."""
        normalized_db_ids = [_normalize_text(item) for item in db_ids or [] if _normalize_text(item)]
        if not normalized_db_ids:
            return set()
        branch_value = _normalize_text(branch_name).lower()
        with app_session(self._database_url) as session:
            ctx_stmt = select(
                AppInventoryHostSqlContext.mac_address,
                AppInventoryHostSqlContext.hostname,
            ).where(AppInventoryHostSqlContext.db_id.in_(normalized_db_ids))
            # SQLite lower() — только ASCII: кириллическая ветка не сматчится,
            # поэтому там отдаём всех по db_ids (Python-фильтр сузит по ветке).
            if branch_value and session.bind.dialect.name != "sqlite":
                ctx_stmt = ctx_stmt.where(
                    func.lower(AppInventoryHostSqlContext.branch_name) == branch_value
                )
            ctx_rows = session.execute(ctx_stmt.distinct()).all()
            ctx_macs = {str(item[0] or "").strip() for item in ctx_rows}
            ctx_macs.discard("")
            ctx_hostnames = {str(item[1] or "").strip() for item in ctx_rows}
            ctx_hostnames.discard("")
            ctx_hostnames_lower = {item.lower() for item in ctx_hostnames}
            conditions = []
            if ctx_macs:
                conditions.append(AppInventoryHost.mac_address.in_(ctx_macs))
            if ctx_hostnames:
                conditions.append(
                    or_(
                        func.lower(AppInventoryHost.hostname).in_(ctx_hostnames_lower),
                        AppInventoryHost.hostname.in_(ctx_hostnames),
                    )
                )
            if not conditions:
                return set()
            stmt = select(AppInventoryHost.mac_address).where(or_(*conditions))
            rows = session.scalars(stmt).all()
        return {str(item or "").strip() for item in rows if str(item or "").strip()}

    def list_host_keys_by_status(
        self,
        status_value: str,
        *,
        now_ts: int,
        online_max_age_seconds: int,
        stale_max_age_seconds: int,
    ) -> set[str]:
        """Return host MACs whose last_seen_at matches the computed status bucket."""
        value = _normalize_text(status_value).lower()
        online_cutoff = int(now_ts) - int(online_max_age_seconds)
        stale_cutoff = int(now_ts) - int(stale_max_age_seconds)
        if value == "online":
            cond = AppInventoryHost.last_seen_at >= online_cutoff
        elif value == "stale":
            cond = and_(
                AppInventoryHost.last_seen_at >= stale_cutoff,
                AppInventoryHost.last_seen_at < online_cutoff,
            )
        elif value == "offline":
            cond = and_(
                AppInventoryHost.last_seen_at > 0,
                AppInventoryHost.last_seen_at < stale_cutoff,
            )
        elif value == "unknown":
            cond = or_(
                AppInventoryHost.last_seen_at.is_(None),
                AppInventoryHost.last_seen_at <= 0,
            )
        else:
            return set()
        # NULL-колонку включаем всегда: payload.timestamp может дать любой статус,
        # финальную проверку делает Python-фильтр по обогащённой записи.
        stmt = select(AppInventoryHost.mac_address).where(
            or_(cond, AppInventoryHost.last_seen_at.is_(None))
        )
        with app_session(self._database_url) as session:
            rows = session.scalars(stmt).all()
        return {str(item or "").strip() for item in rows if str(item or "").strip()}

    def list_changed_host_keys(self, since_ts: int) -> set[str]:
        """Return host MACs that have change events with detected_at >= since_ts."""
        with app_session(self._database_url) as session:
            rows = session.execute(
                select(AppInventoryChangeEvent.mac_address, AppInventoryChangeEvent.hostname)
                .where(AppInventoryChangeEvent.detected_at >= int(since_ts))
                .distinct()
            ).all()
            event_macs = {_normalize_mac(str(item[0] or "")) for item in rows}
            event_macs.discard("")
            event_hosts_raw = {str(item[1] or "").strip() for item in rows if not item[0]}
            event_hosts_raw.discard("")
            event_hosts_lower = {item.lower() for item in event_hosts_raw}
            conditions = []
            if event_macs:
                conditions.append(AppInventoryHost.mac_address.in_(event_macs))
            if event_hosts_raw:
                conditions.append(
                    or_(
                        func.lower(AppInventoryHost.hostname).in_(event_hosts_lower),
                        AppInventoryHost.hostname.in_(event_hosts_raw),
                    )
                )
            if not conditions:
                return set()
            stmt = select(AppInventoryHost.mac_address).where(or_(*conditions))
            matched = session.scalars(stmt).all()
        return {str(item or "").strip() for item in matched if str(item or "").strip()}

    def data_version_probe(self) -> tuple:
        """Light fingerprint of inventory tables for caching/ETag validation."""
        with app_session(self._database_url) as session:
            host_max, host_count, hidden_count = session.execute(
                select(
                    func.max(AppInventoryHost.updated_at),
                    func.count(),
                    func.count(AppInventoryHost.hidden_at),
                ).select_from(AppInventoryHost)
            ).one()
            ctx_max, ctx_count = session.execute(
                select(
                    func.max(AppInventoryHostSqlContext.updated_at),
                    func.count(),
                ).select_from(AppInventoryHostSqlContext)
            ).one()
            ev_max, ev_count = session.execute(
                select(
                    func.max(AppInventoryChangeEvent.detected_at),
                    func.count(),
                ).select_from(AppInventoryChangeEvent)
            ).one()
        return (
            str(host_max or ""),
            int(host_count or 0),
            int(hidden_count or 0),
            str(ctx_max or ""),
            int(ctx_count or 0),
            int(ev_max or 0),
            int(ev_count or 0),
        )

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

    def list_sql_contexts(
        self,
        *,
        hosts: list[dict[str, Any]],
        db_ids: list[str],
    ) -> dict[tuple[str, str, str], dict[str, Any]]:
        normalized_db_ids = [_normalize_text(item) for item in db_ids or [] if _normalize_text(item)]
        if not hosts or not normalized_db_ids:
            return {}

        macs: list[str] = []
        hostnames: list[str] = []
        for host in hosts:
            if not isinstance(host, dict):
                continue
            mac = _normalize_mac(host.get("mac_address"))
            hostname = _normalize_text(host.get("hostname")).lower()
            if mac and mac not in macs:
                macs.append(mac)
            if hostname and hostname not in hostnames:
                hostnames.append(hostname)
        if not macs and not hostnames:
            return {}

        filters = []
        if macs:
            filters.append(AppInventoryHostSqlContext.mac_address.in_(macs))
        if hostnames:
            filters.append(AppInventoryHostSqlContext.hostname.in_(hostnames))

        with app_session(self._database_url) as session:
            rows = session.scalars(
                select(AppInventoryHostSqlContext)
                .where(AppInventoryHostSqlContext.db_id.in_(normalized_db_ids))
                .where(or_(*filters))
                .order_by(AppInventoryHostSqlContext.updated_at.desc())
            ).all()

        contexts: dict[tuple[str, str, str], dict[str, Any]] = {}
        for row in rows:
            mac = _normalize_mac(row.mac_address)
            hostname = _normalize_text(row.hostname).lower()
            db_id = _normalize_text(row.db_id)
            if not db_id:
                continue
            payload = {
                "branch_no": row.branch_no,
                "branch_name": row.branch_name,
                "location_name": row.location_name,
                "employee_name": row.employee_name,
                "inv_no": row.inventory_inv_no,
                "model_name": row.inventory_model_name,
                "ip_address": row.ip_address,
            }
            for key in (
                (mac, hostname, db_id),
                (mac, "", db_id),
                ("", hostname, db_id),
            ):
                if (key[0] or key[1]) and key not in contexts:
                    contexts[key] = payload
        return contexts

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

    def upsert_host(self, payload: dict[str, Any]) -> bool:
        host_key = _payload_host_key(payload)
        if not host_key:
            return False
        stored_payload = dict(payload)
        incoming_timestamp = _to_int(stored_payload.get("timestamp"), 0)
        if stored_payload.get("last_seen_at") in (None, "") and incoming_timestamp > 0:
            stored_payload["last_seen_at"] = incoming_timestamp
        now = _utcnow()
        with app_session(self._database_url) as session:
            row = session.get(AppInventoryHost, host_key, with_for_update=True)
            if row is None:
                row = AppInventoryHost(mac_address=host_key)
                session.add(row)
            else:
                persisted_payload = self._row_payload(row)
                persisted_timestamp = _to_int(persisted_payload.get("timestamp"), 0)
                if persisted_timestamp > 0 and incoming_timestamp > 0 and incoming_timestamp < persisted_timestamp:
                    return False

                persisted_last_seen_at = _to_int(row.last_seen_at, 0)
                incoming_last_seen_at = _to_int(stored_payload.get("last_seen_at"), 0)
                if persisted_last_seen_at > incoming_last_seen_at:
                    stored_payload["last_seen_at"] = persisted_last_seen_at

                persisted_full_snapshot_at = _to_int(row.last_full_snapshot_at, 0)
                incoming_full_snapshot_at = _to_int(stored_payload.get("last_full_snapshot_at"), 0)
                if persisted_full_snapshot_at > incoming_full_snapshot_at:
                    stored_payload["last_full_snapshot_at"] = persisted_full_snapshot_at

            row.hostname = str(stored_payload.get("hostname") or "").strip() or None
            row.user_login = str(stored_payload.get("user_login") or "").strip() or None
            row.user_full_name = str(stored_payload.get("user_full_name") or "").strip() or None
            row.ip_primary = str(stored_payload.get("ip_primary") or "").strip() or None
            row.report_type = str(stored_payload.get("report_type") or "full_snapshot").strip() or "full_snapshot"
            row.last_seen_at = (
                int(stored_payload.get("last_seen_at"))
                if stored_payload.get("last_seen_at") not in (None, "")
                else None
            )
            row.last_full_snapshot_at = (
                int(stored_payload.get("last_full_snapshot_at"))
                if stored_payload.get("last_full_snapshot_at") not in (None, "")
                else None
            )
            row.payload_json = json.dumps(stored_payload, ensure_ascii=False)
            row.updated_at = now
            # Soft-hide flags are operator-owned; agent ingest must not clear them.
            if row.report_type != "heartbeat":
                self._replace_search_indexes(session, host_key, stored_payload, now)
        return True

    def set_host_hidden(
        self,
        mac_address: str,
        *,
        hidden: bool,
        hidden_by: str | None = None,
        hidden_reason: str | None = None,
        hidden_at: int | None = None,
    ) -> Optional[dict[str, Any]]:
        host_key = _normalize_mac(mac_address)
        if not host_key:
            return None
        with app_session(self._database_url) as session:
            row = session.get(AppInventoryHost, host_key)
            if row is None:
                return None
            if hidden:
                row.hidden_at = int(hidden_at if hidden_at is not None else time.time())
                row.hidden_by = str(hidden_by or "").strip() or None
                row.hidden_reason = str(hidden_reason or "").strip() or None
            else:
                row.hidden_at = None
                row.hidden_by = None
                row.hidden_reason = None
            row.updated_at = _utcnow()
            session.flush()
            return self._row_payload(row)

    def delete_host(self, mac_address: str) -> Optional[dict[str, Any]]:
        """Полностью удалить хост и связанные строки (профили, outlook,
        sql-контексты, события изменений). Агент может пересоздать хост
        следующим отчётом — для скрытия без удаления используется hidden."""
        host_key = _normalize_mac(mac_address)
        if not host_key:
            return None
        with app_session(self._database_url) as session:
            row = session.get(AppInventoryHost, host_key)
            if row is None:
                return None
            hostname = _normalize_text(row.hostname).lower()
            payload = self._row_payload(row)
            session.execute(
                delete(AppInventoryUserProfile).where(AppInventoryUserProfile.mac_address == host_key)
            )
            session.execute(
                delete(AppInventoryOutlookFile).where(AppInventoryOutlookFile.mac_address == host_key)
            )
            ctx_filters = [AppInventoryHostSqlContext.mac_address == host_key]
            if hostname:
                ctx_filters.append(AppInventoryHostSqlContext.hostname == hostname)
            session.execute(delete(AppInventoryHostSqlContext).where(or_(*ctx_filters)))
            event_filters = [AppInventoryChangeEvent.mac_address == host_key]
            if hostname:
                event_filters.append(func.lower(AppInventoryChangeEvent.hostname) == hostname)
            session.execute(delete(AppInventoryChangeEvent).where(or_(*event_filters)))
            session.delete(row)
            return payload

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
            row = session.get(AppInventoryHost, host_key, with_for_update=True)
            if row is None:
                return False
            incoming_last_seen_at = int(last_seen_at)
            persisted_last_seen_at = _to_int(row.last_seen_at, 0)
            if persisted_last_seen_at > incoming_last_seen_at:
                return True
            row.last_seen_at = incoming_last_seen_at
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

    def list_change_events(self, since_ts: int | None = None) -> list[dict[str, Any]]:
        with app_session(self._database_url) as session:
            stmt = select(AppInventoryChangeEvent)
            if since_ts is not None:
                stmt = stmt.where(AppInventoryChangeEvent.detected_at >= int(since_ts))
            rows = session.scalars(
                stmt.order_by(
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
