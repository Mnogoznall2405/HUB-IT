"""One-shot / resumable compact search backfill (NOT a permanent PM2 worker).

Builds derived documents from ``one_c_catalog_entries`` without calling 1C.
Disabled and dry-run by default.  Safe only against allowed test DBs when
invoked via the CLI guard.
"""
from __future__ import annotations

import hashlib
import logging
import shutil
import signal
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from sqlalchemy import text

from backend.appdb.db import get_app_session_factory
from backend.services.one_c_catalog_compact_flags import get_compact_flags
from backend.services.one_c_catalog_compact_search import STATUS_READY
from backend.services.one_c_catalog_compact_writer import (
    STATUS_BUILDING,
    STATUS_FAILED,
    OneCCatalogCompactWriter,
)


logger = logging.getLogger(__name__)

ADVISORY_LOCK_KEY = 0x1CC0BF11  # 1C compact backfill advisory lock


@dataclass
class BackfillReport:
    dry_run: bool = True
    enabled: bool = False
    stopped_reason: str = ""
    processed: int = 0
    upserted: int = 0
    catalogs: dict[str, dict[str, Any]] = field(default_factory=dict)
    errors: int = 0
    elapsed_seconds: float = 0.0
    free_disk_bytes: int | None = None


class OneCCatalogCompactBackfill:
    def __init__(
        self,
        database_url: str,
        *,
        dry_run: bool = True,
        source_base: str = "buh20",
        stop_check: Callable[[], bool] | None = None,
    ) -> None:
        self._database_url = database_url
        self._dry_run = bool(dry_run)
        self._source_base = source_base
        self._flags = get_compact_flags()
        self._stop_check = stop_check or (lambda: False)
        self._stop_requested = False
        self._writer = OneCCatalogCompactWriter(enabled=True)

    def request_stop(self, *_args) -> None:
        self._stop_requested = True

    def _should_stop(self) -> bool:
        return self._stop_requested or bool(self._stop_check())

    def _free_disk(self) -> int | None:
        try:
            return int(shutil.disk_usage("C:\\").free)
        except Exception:
            try:
                return int(shutil.disk_usage("/").free)
            except Exception:
                return None

    def run(self) -> BackfillReport:
        started = time.perf_counter()
        report = BackfillReport(
            dry_run=self._dry_run,
            enabled=self._flags.compact_backfill_enabled,
            free_disk_bytes=self._free_disk(),
        )
        if not self._flags.compact_backfill_enabled and not self._dry_run:
            report.stopped_reason = "backfill_disabled"
            return report

        free = report.free_disk_bytes
        if free is not None and free < self._flags.min_free_disk_bytes:
            report.stopped_reason = "low_disk"
            return report

        previous_handlers = []
        for sig in (getattr(signal, "SIGINT", None), getattr(signal, "SIGTERM", None)):
            if sig is None:
                continue
            try:
                previous_handlers.append((sig, signal.signal(sig, self.request_stop)))
            except Exception:
                pass

        session = get_app_session_factory(self._database_url)()
        locked = False
        try:
            if session.get_bind().dialect.name != "postgresql":
                report.stopped_reason = "non_postgresql"
                return report
            # Embed constant key (not user input) to avoid PG overload ambiguity
            # on bound bigint vs (int,int) advisory-lock signatures.
            lock_sql = f"SELECT pg_try_advisory_lock({int(ADVISORY_LOCK_KEY)})"
            locked = bool(session.execute(text(lock_sql)).scalar_one())
            session.commit()
            if not locked:
                report.stopped_reason = "advisory_lock_busy"
                return report
            snap = session.execute(
                text(
                    """
                    SELECT active_generation, nomenclature_count, warehouses_count
                    FROM app.one_c_catalog_snapshots
                    WHERE source_base = :source_base
                    """
                ),
                {"source_base": self._source_base},
            ).mappings().first()
            session.commit()
            if snap is None or int(snap["active_generation"] or 0) <= 0:
                report.stopped_reason = "no_snapshot"
                return report
            generation = int(snap["active_generation"])
            for catalog_type, expected in (
                ("nomenclature", int(snap["nomenclature_count"] or 0)),
                ("warehouses", int(snap["warehouses_count"] or 0)),
            ):
                catalog_report = self._backfill_catalog(
                    session,
                    catalog_type=catalog_type,
                    generation=generation,
                    expected_count=expected,
                    report=report,
                )
                report.catalogs[catalog_type] = catalog_report
                if report.stopped_reason:
                    break
        except Exception as exc:
            report.errors += 1
            report.stopped_reason = f"error:{type(exc).__name__}"
            # Log err_type + short message (no query text / params / PII).
            pgcode = getattr(getattr(exc, "orig", None), "pgcode", None) or ""
            msg = str(getattr(exc, "orig", None) or exc)
            msg = msg.split("\n", 1)[0][:160]
            logger.warning(
                "compact backfill failed err_type=%s pgcode=%s msg=%s",
                type(exc).__name__,
                pgcode or "n/a",
                msg,
            )
            try:
                session.rollback()
            except Exception:
                pass
        finally:
            if locked:
                try:
                    unlock_sql = f"SELECT pg_advisory_unlock({int(ADVISORY_LOCK_KEY)})"
                    session.execute(text(unlock_sql))
                    session.commit()
                except Exception:
                    try:
                        session.rollback()
                    except Exception:
                        pass
            session.close()
            for sig, handler in previous_handlers:
                try:
                    signal.signal(sig, handler)
                except Exception:
                    pass

        report.elapsed_seconds = time.perf_counter() - started
        if not report.stopped_reason:
            report.stopped_reason = "completed"
        return report

    def _backfill_catalog(
        self,
        session,
        *,
        catalog_type: str,
        generation: int,
        expected_count: int,
        report: BackfillReport,
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        state = session.execute(
            text(
                """
                SELECT status, checkpoint_ref, checkpoint_offset, indexed_count
                FROM app.one_c_catalog_search_index_state
                WHERE source_base = :source_base AND catalog_type = :catalog_type
                """
            ),
            {"source_base": self._source_base, "catalog_type": catalog_type},
        ).mappings().first()
        checkpoint_ref = str(state["checkpoint_ref"] or "") if state else ""

        if self._dry_run:
            count = session.execute(
                text(
                    """
                    SELECT COUNT(*) FROM app.one_c_catalog_entries
                    WHERE source_base = :source_base
                      AND generation = :generation
                      AND catalog_type = :catalog_type
                    """
                ),
                {
                    "source_base": self._source_base,
                    "generation": generation,
                    "catalog_type": catalog_type,
                },
            ).scalar_one()
            return {
                "dry_run": True,
                "expected_count": expected_count,
                "entry_count": int(count),
                "checkpoint_ref": checkpoint_ref,
            }

        session.execute(
            text(
                """
                INSERT INTO app.one_c_catalog_search_index_state AS s (
                    source_base, catalog_type, generation, status,
                    expected_count, indexed_count, build_version, checksum,
                    last_error, started_at, finished_at, updated_at,
                    checkpoint_ref, checkpoint_offset,
                    active_index_version, building_index_version,
                    previous_index_version, source_fingerprint,
                    previous_cleanup_after
                ) VALUES (
                    :source_base, :catalog_type, :generation, :status,
                    :expected_count, 0, 0, '',
                    '', :now, NULL, :now,
                    :checkpoint_ref, 0,
                    0, 0,
                    0, '',
                    NULL
                )
                ON CONFLICT (source_base, catalog_type) DO UPDATE SET
                    generation = EXCLUDED.generation,
                    status = :status,
                    expected_count = EXCLUDED.expected_count,
                    started_at = COALESCE(s.started_at, EXCLUDED.started_at),
                    updated_at = EXCLUDED.updated_at,
                    last_error = '',
                    active_index_version = COALESCE(s.active_index_version, 0),
                    building_index_version = COALESCE(s.building_index_version, 0),
                    previous_index_version = COALESCE(s.previous_index_version, 0),
                    source_fingerprint = COALESCE(s.source_fingerprint, '')
                """
            ),
            {
                "source_base": self._source_base,
                "catalog_type": catalog_type,
                "generation": generation,
                "status": STATUS_BUILDING,
                "expected_count": expected_count,
                "now": now,
                "checkpoint_ref": checkpoint_ref,
            },
        )
        session.flush()

        batch_size = self._flags.backfill_batch_size
        max_runtime = self._flags.backfill_max_runtime_seconds
        started = time.perf_counter()
        processed = 0
        last_ref = checkpoint_ref

        while True:
            if self._should_stop():
                report.stopped_reason = "shutdown"
                break
            if max_runtime and (time.perf_counter() - started) >= max_runtime:
                report.stopped_reason = "max_runtime"
                break
            free = self._free_disk()
            if free is not None and free < self._flags.min_free_disk_bytes:
                report.stopped_reason = "low_disk"
                break

            # Use SET (not SET LOCAL): after session.commit() we are outside a
            # transaction block, and SET LOCAL would raise ProgrammingError.
            timeout_ms = max(1, int(self._flags.backfill_statement_timeout_ms))
            session.execute(text(f"SET statement_timeout = '{timeout_ms}ms'"))
            rows = session.execute(
                text(
                    """
                    SELECT ref, code, name, code_normalized, name_normalized
                    FROM app.one_c_catalog_entries
                    WHERE source_base = :source_base
                      AND generation = :generation
                      AND catalog_type = :catalog_type
                      AND ref > :last_ref
                    ORDER BY ref
                    LIMIT :limit
                    """
                ),
                {
                    "source_base": self._source_base,
                    "generation": generation,
                    "catalog_type": catalog_type,
                    "last_ref": last_ref,
                    "limit": batch_size,
                },
            ).all()
            if not rows:
                break

            upserts = [(str(r.ref), str(r.code or ""), str(r.name or "")) for r in rows]
            try:
                self._writer.upsert_documents(
                    session,
                    source_base=self._source_base,
                    generation=generation,
                    catalog_type=catalog_type,
                    entries=upserts,
                )
                last_ref = str(rows[-1].ref)
                processed += len(rows)
                report.processed += len(rows)
                report.upserted += len(rows)
                session.execute(
                    text(
                        """
                        UPDATE app.one_c_catalog_search_index_state
                        SET checkpoint_ref = :checkpoint_ref,
                            checkpoint_offset = checkpoint_offset + :batch,
                            indexed_count = indexed_count + :batch,
                            updated_at = :now
                        WHERE source_base = :source_base
                          AND catalog_type = :catalog_type
                        """
                    ),
                    {
                        "checkpoint_ref": last_ref,
                        "batch": len(rows),
                        "now": datetime.now(timezone.utc),
                        "source_base": self._source_base,
                        "catalog_type": catalog_type,
                    },
                )
                session.commit()
                session.execute(text("SET statement_timeout = 0"))
            except Exception as exc:
                report.errors += 1
                try:
                    session.rollback()
                except Exception:
                    pass
                try:
                    session.execute(text("SET statement_timeout = 0"))
                except Exception:
                    pass
                if report.errors >= self._flags.backfill_error_budget:
                    report.stopped_reason = "error_budget"
                    session.execute(
                        text(
                            """
                            UPDATE app.one_c_catalog_search_index_state
                            SET status = :status, last_error = :err, updated_at = :now
                            WHERE source_base = :source_base AND catalog_type = :catalog_type
                            """
                        ),
                        {
                            "status": STATUS_FAILED,
                            "err": type(exc).__name__,
                            "now": datetime.now(timezone.utc),
                            "source_base": self._source_base,
                            "catalog_type": catalog_type,
                        },
                    )
                    session.commit()
                    break
                continue

            if self._flags.backfill_pause_ms:
                time.sleep(self._flags.backfill_pause_ms / 1000.0)

        if report.stopped_reason in {"", "completed"}:
            # Final consistency: rebuild token_stats and set ready if counts match.
            # Prod-scale (~700k): avoid huge statement_timeout leftovers, stream
            # checksum (never materialize all rows in Python at once).
            try:
                session.execute(text("SET statement_timeout = 0"))
                session.execute(text("SET work_mem = '256MB'"))
            except Exception:
                pass
            self._writer.rebuild_token_stats(
                session,
                source_base=self._source_base,
                generation=generation,
                catalog_type=catalog_type,
                index_version=1,
            )
            session.commit()
            checksum = self._stream_document_checksum(
                session,
                generation=generation,
                catalog_type=catalog_type,
                index_version=1,
            )
            indexed = session.execute(
                text(
                    """
                    SELECT COUNT(*) FROM app.one_c_catalog_search_documents
                    WHERE source_base = :source_base
                      AND generation = :generation
                      AND catalog_type = :catalog_type
                      AND coalesce(index_version, 1) = 1
                    """
                ),
                {
                    "source_base": self._source_base,
                    "generation": generation,
                    "catalog_type": catalog_type,
                },
            ).scalar_one()
            entry_count = session.execute(
                text(
                    """
                    SELECT COUNT(*) FROM app.one_c_catalog_entries
                    WHERE source_base = :source_base
                      AND generation = :generation
                      AND catalog_type = :catalog_type
                    """
                ),
                {
                    "source_base": self._source_base,
                    "generation": generation,
                    "catalog_type": catalog_type,
                },
            ).scalar_one()
            status = STATUS_READY if int(indexed) == int(entry_count) else STATUS_FAILED
            # Compute last_error in Python — reusing :status in CASE vs varchar
            # assignment makes psycopg report AmbiguousParameter (text vs varchar).
            session.execute(
                text(
                    """
                    UPDATE app.one_c_catalog_search_index_state
                    SET status = :status,
                        expected_count = :expected,
                        indexed_count = :indexed,
                        checksum = :checksum,
                        source_fingerprint = :checksum,
                        active_index_version = CASE
                            WHEN :set_active = 1 THEN GREATEST(COALESCE(active_index_version, 0), 1)
                            ELSE COALESCE(active_index_version, 0)
                        END,
                        finished_at = :now,
                        updated_at = :now,
                        last_error = :last_error,
                        build_version = build_version + 1
                    WHERE source_base = :source_base AND catalog_type = :catalog_type
                    """
                ),
                {
                    "status": status,
                    "set_active": 1 if status == STATUS_READY else 0,
                    "expected": int(entry_count),
                    "indexed": int(indexed),
                    "checksum": checksum,
                    "last_error": "" if status == STATUS_READY else "count_mismatch",
                    "now": datetime.now(timezone.utc),
                    "source_base": self._source_base,
                    "catalog_type": catalog_type,
                },
            )
            session.commit()
            try:
                session.execute(text("RESET work_mem"))
                session.execute(text("SET statement_timeout = 0"))
            except Exception:
                pass
            return {
                "status": status,
                "expected_count": int(entry_count),
                "indexed_count": int(indexed),
                "processed": processed,
                "checksum": checksum[:16] if checksum else "",
            }

        return {
            "status": "interrupted",
            "processed": processed,
            "stopped_reason": report.stopped_reason,
            "checkpoint_ref_len": len(last_ref),
        }

    def _stream_document_checksum(
        self,
        session,
        *,
        generation: int,
        catalog_type: str,
        index_version: int = 1,
        batch_size: int = 5_000,
    ) -> str:
        """SHA-256 fingerprint matching ``document_checksum`` without full materialization."""
        digest = hashlib.sha256()
        last_ref = ""
        version = max(1, int(index_version or 1))
        while True:
            rows = session.execute(
                text(
                    """
                    SELECT entry_ref, code_normalized, name_normalized
                    FROM app.one_c_catalog_search_documents
                    WHERE source_base = :source_base
                      AND generation = :generation
                      AND catalog_type = :catalog_type
                      AND coalesce(index_version, 1) = :index_version
                      AND entry_ref > :last_ref
                    ORDER BY entry_ref
                    LIMIT :limit
                    """
                ),
                {
                    "source_base": self._source_base,
                    "generation": generation,
                    "catalog_type": catalog_type,
                    "index_version": version,
                    "last_ref": last_ref,
                    "limit": batch_size,
                },
            ).all()
            if not rows:
                break
            for row in rows:
                for value in (
                    str(row.entry_ref or ""),
                    str(row.code_normalized or ""),
                    str(row.name_normalized or ""),
                ):
                    encoded = value.encode("utf-8")
                    digest.update(len(encoded).to_bytes(4, "big"))
                    digest.update(encoded)
                digest.update(b"\xff")
            last_ref = str(rows[-1].entry_ref or "")
        return digest.hexdigest()
