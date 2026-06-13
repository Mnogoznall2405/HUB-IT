"""Exchange mailbox quota snapshot import and query."""
from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import case, delete, desc, func, nulls_last, or_, select

from backend.appdb.db import AppDatabaseConfigurationError, app_session, ensure_app_schema_initialized, is_app_database_configured
from backend.appdb.models import AppMailboxQuotaRow, AppMailboxQuotaSnapshot
from backend.models.mailbox_quota import (
    MailboxQuotaDatabaseSummary,
    MailboxQuotaImportResponse,
    MailboxQuotaRowResponse,
    MailboxQuotaRowsPage,
    MailboxQuotaSnapshotImport,
    MailboxQuotaSnapshotStats,
    MailboxQuotaSnapshotSummary,
)

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _positive_int_env(name: str, default: int, minimum: int = 1) -> int:
    raw = str(os.getenv(name, str(default)) or "").strip()
    try:
        return max(int(raw), minimum)
    except Exception:
        return max(int(default), minimum)


class MailboxQuotaService:
    def __init__(self) -> None:
        self._retention_days = _positive_int_env("MAIL_QUOTA_SNAPSHOT_RETENTION_DAYS", 90, 1)
        self._default_quota_bytes = _positive_int_env("MAIL_QUOTA_DEFAULT_GB", 5, 1) * 1024 * 1024 * 1024

    def default_quota_bytes(self) -> int:
        return int(self._default_quota_bytes)

    @staticmethod
    def _effective_used_percent(
        *,
        used_bytes: Optional[int],
        quota_bytes: Optional[int],
        used_percent: Optional[float],
        default_quota_bytes: int,
    ) -> Optional[float]:
        if used_percent is not None:
            return float(used_percent)
        if used_bytes is None:
            return None
        effective_quota = quota_bytes if quota_bytes is not None else default_quota_bytes
        if effective_quota <= 0:
            return None
        return round(float(used_bytes) * 100.0 / float(effective_quota), 2)

    def _serialize_row(self, row: AppMailboxQuotaRow) -> MailboxQuotaRowResponse:
        uses_default = row.quota_bytes is None
        default_bytes = self.default_quota_bytes()
        effective_quota = row.quota_bytes if row.quota_bytes is not None else default_bytes
        used_percent = self._effective_used_percent(
            used_bytes=row.used_bytes,
            quota_bytes=row.quota_bytes,
            used_percent=row.used_percent,
            default_quota_bytes=default_bytes,
        )
        free_bytes = row.free_bytes
        if uses_default and row.used_bytes is not None:
            free_bytes = max(0, int(effective_quota) - int(row.used_bytes))

        return MailboxQuotaRowResponse(
            id=int(row.id),
            email=row.email,
            display_name=row.display_name or "",
            upn=row.upn or "",
            mailbox_type=row.mailbox_type or "",
            used_bytes=row.used_bytes,
            quota_bytes=effective_quota if uses_default else row.quota_bytes,
            free_bytes=free_bytes,
            used_percent=used_percent,
            database_name=row.database_name or "",
            uses_default_quota=uses_default,
        )

    def _effective_used_percent_expr(self, default_quota_bytes: int):
        return case(
            (AppMailboxQuotaRow.used_percent.is_not(None), AppMailboxQuotaRow.used_percent),
            (
                AppMailboxQuotaRow.used_bytes.is_not(None),
                AppMailboxQuotaRow.used_bytes * 100.0 / default_quota_bytes,
            ),
            else_=None,
        )

    def _ensure_ready(self) -> None:
        if not is_app_database_configured():
            raise AppDatabaseConfigurationError("APP_DATABASE_URL is not configured")
        ensure_app_schema_initialized()

    @staticmethod
    def _canonical_payload_dict(payload: MailboxQuotaSnapshotImport) -> dict[str, Any]:
        rows = sorted(
            [
                {
                    "display_name": row.display_name,
                    "email": row.email,
                    "user_principal_name": row.user_principal_name,
                    "mailbox_type": row.mailbox_type,
                    "used_bytes": row.used_bytes,
                    "quota_bytes": row.quota_bytes,
                    "free_bytes": row.free_bytes,
                    "used_percent": row.used_percent,
                    "database_name": row.database_name,
                }
                for row in payload.rows
            ],
            key=lambda item: item["email"],
        )
        collected_at = payload.collected_at
        if isinstance(collected_at, datetime):
            collected_at_text = collected_at.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        else:
            collected_at_text = None
        return {
            "exchange_server": _normalize_text(payload.exchange_server),
            "source_host": _normalize_text(payload.source_host),
            "collected_at": collected_at_text,
            "rows": rows,
        }

    @classmethod
    def compute_payload_sha256(cls, payload: MailboxQuotaSnapshotImport) -> str:
        canonical = cls._canonical_payload_dict(payload)
        encoded = json.dumps(canonical, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    @staticmethod
    def _serialize_snapshot(row: AppMailboxQuotaSnapshot) -> MailboxQuotaSnapshotSummary:
        return MailboxQuotaSnapshotSummary(
            id=int(row.id),
            imported_at=row.imported_at,
            collected_at=row.collected_at,
            source_host=row.source_host or "",
            exchange_server=row.exchange_server or "",
            row_count=int(row.row_count or 0),
        )

    def import_snapshot(self, payload: MailboxQuotaSnapshotImport) -> MailboxQuotaImportResponse:
        self._ensure_ready()
        payload_sha256 = self.compute_payload_sha256(payload)
        now = _utcnow()

        with app_session() as session:
            existing = session.scalar(
                select(AppMailboxQuotaSnapshot).where(AppMailboxQuotaSnapshot.payload_sha256 == payload_sha256)
            )
            if existing is not None:
                return MailboxQuotaImportResponse(
                    snapshot_id=int(existing.id),
                    row_count=int(existing.row_count or 0),
                    duplicate=True,
                )

            snapshot = AppMailboxQuotaSnapshot(
                imported_at=now,
                collected_at=payload.collected_at,
                source_host=_normalize_text(payload.source_host),
                exchange_server=_normalize_text(payload.exchange_server),
                payload_sha256=payload_sha256,
                row_count=len(payload.rows),
            )
            session.add(snapshot)
            session.flush()

            for row in payload.rows:
                session.add(
                    AppMailboxQuotaRow(
                        snapshot_id=int(snapshot.id),
                        email=row.email,
                        display_name=_normalize_text(row.display_name),
                        upn=_normalize_text(row.user_principal_name),
                        mailbox_type=_normalize_text(row.mailbox_type),
                        used_bytes=row.used_bytes,
                        quota_bytes=row.quota_bytes,
                        free_bytes=row.free_bytes,
                        used_percent=row.used_percent,
                        database_name=_normalize_text(row.database_name),
                    )
                )

            self._purge_old_snapshots_locked(session, now=now)
            session.flush()
            return MailboxQuotaImportResponse(
                snapshot_id=int(snapshot.id),
                row_count=len(payload.rows),
                duplicate=False,
            )

    def _purge_old_snapshots_locked(self, session, *, now: datetime) -> None:
        cutoff = now - timedelta(days=self._retention_days)
        old_ids = session.scalars(
            select(AppMailboxQuotaSnapshot.id).where(AppMailboxQuotaSnapshot.imported_at < cutoff)
        ).all()
        if not old_ids:
            return
        session.execute(delete(AppMailboxQuotaRow).where(AppMailboxQuotaRow.snapshot_id.in_(old_ids)))
        session.execute(delete(AppMailboxQuotaSnapshot).where(AppMailboxQuotaSnapshot.id.in_(old_ids)))
        logger.info("Purged %s mailbox quota snapshots older than %s days", len(old_ids), self._retention_days)

    def list_snapshots(self, *, limit: int = 20) -> list[MailboxQuotaSnapshotSummary]:
        self._ensure_ready()
        safe_limit = max(1, min(int(limit), 100))
        with app_session() as session:
            rows = session.scalars(
                select(AppMailboxQuotaSnapshot)
                .order_by(desc(AppMailboxQuotaSnapshot.imported_at), desc(AppMailboxQuotaSnapshot.id))
                .limit(safe_limit)
            ).all()
            return [self._serialize_snapshot(row) for row in rows]

    def get_latest_snapshot(self) -> Optional[MailboxQuotaSnapshotSummary]:
        snapshots = self.list_snapshots(limit=1)
        return snapshots[0] if snapshots else None

    def list_rows(
        self,
        snapshot_id: int,
        *,
        search: str = "",
        over_quota: bool = False,
        warning_90: bool = False,
        no_quota: bool = False,
        database_name: str = "",
        limit: int = 100,
        offset: int = 0,
    ) -> MailboxQuotaRowsPage:
        self._ensure_ready()
        safe_limit = max(1, min(int(limit), 500))
        safe_offset = max(0, int(offset))
        search_text = _normalize_text(search).lower()
        database_text = _normalize_text(database_name)

        with app_session() as session:
            snapshot = session.get(AppMailboxQuotaSnapshot, int(snapshot_id))
            if snapshot is None:
                raise ValueError(f"Snapshot {snapshot_id} not found")

            query = select(AppMailboxQuotaRow).where(AppMailboxQuotaRow.snapshot_id == int(snapshot_id))
            if search_text:
                pattern = f"%{search_text}%"
                query = query.where(
                    or_(
                        func.lower(AppMailboxQuotaRow.email).like(pattern),
                        func.lower(AppMailboxQuotaRow.display_name).like(pattern),
                        func.lower(AppMailboxQuotaRow.upn).like(pattern),
                    )
                )
            if database_text:
                query = query.where(AppMailboxQuotaRow.database_name == database_text)
            if no_quota:
                query = query.where(AppMailboxQuotaRow.quota_bytes.is_(None))
            else:
                effective_percent = self._effective_used_percent_expr(self.default_quota_bytes())
                if over_quota:
                    query = query.where(effective_percent.is_not(None), effective_percent >= 100)
                elif warning_90:
                    query = query.where(
                        effective_percent.is_not(None),
                        effective_percent >= 90,
                        effective_percent < 100,
                    )

            total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
            effective_percent = self._effective_used_percent_expr(self.default_quota_bytes())
            rows = session.scalars(
                query.order_by(
                    nulls_last(desc(effective_percent)),
                    nulls_last(desc(AppMailboxQuotaRow.used_bytes)),
                    AppMailboxQuotaRow.email,
                )
                .offset(safe_offset)
                .limit(safe_limit)
            ).all()

            items = [self._serialize_row(row) for row in rows]
            return MailboxQuotaRowsPage(
                items=items,
                total=int(total),
                snapshot=self._serialize_snapshot(snapshot),
            )

    def get_snapshot_summary(self, snapshot_id: int) -> MailboxQuotaSnapshotStats:
        self._ensure_ready()
        with app_session() as session:
            snapshot = session.get(AppMailboxQuotaSnapshot, int(snapshot_id))
            if snapshot is None:
                raise ValueError(f"Snapshot {snapshot_id} not found")

            base = AppMailboxQuotaRow.snapshot_id == int(snapshot_id)
            total = session.scalar(select(func.count()).where(base)) or 0
            with_quota = session.scalar(
                select(func.count()).where(base, AppMailboxQuotaRow.quota_bytes.is_not(None))
            ) or 0
            no_quota = int(total) - int(with_quota)
            effective_percent = self._effective_used_percent_expr(self.default_quota_bytes())
            over_quota = session.scalar(
                select(func.count()).where(
                    base,
                    effective_percent.is_not(None),
                    effective_percent >= 100,
                )
            ) or 0
            warning_90 = session.scalar(
                select(func.count()).where(
                    base,
                    effective_percent.is_not(None),
                    effective_percent >= 90,
                    effective_percent < 100,
                )
            ) or 0

            db_rows = session.execute(
                select(
                    AppMailboxQuotaRow.database_name,
                    func.count().label("total"),
                    func.sum(
                        case(
                            (
                                (effective_percent.is_not(None)) & (effective_percent >= 100),
                                1,
                            ),
                            else_=0,
                        )
                    ).label("over_quota"),
                    func.sum(
                        case(
                            (
                                (effective_percent.is_not(None))
                                & (effective_percent >= 90)
                                & (effective_percent < 100),
                                1,
                            ),
                            else_=0,
                        )
                    ).label("warning_90"),
                )
                .where(base)
                .group_by(AppMailboxQuotaRow.database_name)
                .order_by(AppMailboxQuotaRow.database_name)
            ).all()

            by_database = [
                MailboxQuotaDatabaseSummary(
                    name=_normalize_text(row.database_name, default="—"),
                    total=int(row.total or 0),
                    over_quota=int(row.over_quota or 0),
                    warning_90=int(row.warning_90 or 0),
                )
                for row in db_rows
            ]

            return MailboxQuotaSnapshotStats(
                snapshot_id=int(snapshot_id),
                total=int(total),
                with_quota=int(with_quota),
                no_quota=int(no_quota),
                over_quota=int(over_quota),
                warning_90=int(warning_90),
                by_database=by_database,
            )


mailbox_quota_service = MailboxQuotaService()
