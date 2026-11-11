"""Durable background generation of Office previews for Hub task attachments."""
from __future__ import annotations

import json
import logging
import os
import shutil
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from backend.services.hub_service import hub_service


logger = logging.getLogger("backend.hub.task_attachment_preview")

PREVIEW_STATUS_QUEUED = "queued"
PREVIEW_STATUS_PROCESSING = "processing"
PREVIEW_STATUS_READY = "ready"
PREVIEW_STATUS_FAILED = "failed"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _normalize_text(value: object, default: str = "") -> str:
    normalized = str(value or "").strip()
    return normalized or default


def _positive_int_env(name: str, default: int, *, minimum: int = 1, maximum: int = 86_400) -> int:
    try:
        value = int(str(os.getenv(name, default) or default))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


@dataclass(frozen=True)
class TaskAttachmentPreviewJob:
    attachment_id: str
    task_id: str
    file_path: str
    file_name: str
    mime_type: str
    file_size: int
    attempt_count: int
    lease_owner: str


class TaskAttachmentPreviewService:
    """Persistent task queue; LibreOffice runs only in ``process_next_job``."""

    def __init__(self, *, hub: Any = hub_service, artifacts_root: Path | None = None) -> None:
        self._hub = hub
        self._artifacts_root_override = Path(artifacts_root) if artifacts_root is not None else None

    @property
    def max_attempts(self) -> int:
        fallback = _positive_int_env("PREVIEW_MAX_ATTEMPTS", 3, maximum=20)
        return _positive_int_env("TASK_ATTACHMENT_PREVIEW_MAX_ATTEMPTS", fallback, maximum=20)

    @property
    def lease_seconds(self) -> int:
        fallback = _positive_int_env("PREVIEW_LEASE_SEC", 240, minimum=30, maximum=3600)
        return _positive_int_env("TASK_ATTACHMENT_PREVIEW_LEASE_SEC", fallback, minimum=30, maximum=3600)

    @property
    def poll_interval_ms(self) -> int:
        fallback = _positive_int_env("PREVIEW_POLL_INTERVAL_MS", 500, minimum=50, maximum=10_000)
        return _positive_int_env("TASK_ATTACHMENT_PREVIEW_POLL_INTERVAL_MS", fallback, minimum=50, maximum=10_000)

    @property
    def _table(self) -> str:
        return self._hub._TASK_ATTACHMENT_PREVIEWS_TABLE

    def _artifacts_root(self) -> Path:
        if self._artifacts_root_override is not None:
            return self._artifacts_root_override
        return Path(self._hub.task_attachment_previews_root)

    @staticmethod
    def _source_kind(attachment: dict[str, Any]) -> str:
        from backend.services.mail_attachment_preview_service import (
            classify_office_source,
            is_office_preview_enabled,
            office_preview_max_bytes,
        )

        if not is_office_preview_enabled():
            return ""
        if int(attachment.get("file_size") or 0) > office_preview_max_bytes():
            return ""
        return classify_office_source(
            filename=_normalize_text(attachment.get("file_name")),
            content_type=_normalize_text(attachment.get("file_mime")),
        )

    def _artifact_path(self, artifact_rel_path: str) -> Path:
        root = self._artifacts_root().resolve()
        path = (root / _normalize_text(artifact_rel_path)).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ValueError("Invalid preview artifact path") from exc
        return path

    def _source_path(self, job: TaskAttachmentPreviewJob) -> Path:
        root = Path(self._hub.data_dir).resolve()
        path = (root / job.file_path).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ValueError("Invalid task attachment path") from exc
        return path

    @staticmethod
    def _attachment_from_row(row: Any) -> dict[str, Any]:
        return dict(row) if row is not None else {}

    def _load_attachment(self, conn, *, task_id: str, attachment_id: str) -> dict[str, Any] | None:
        row = conn.execute(
            f"""
            SELECT id, task_id, file_name, file_path, file_mime, file_size
            FROM {self._hub._TASK_ATTACH_TABLE}
            WHERE id = ? AND task_id = ?
            """,
            (attachment_id, task_id),
        ).fetchone()
        return self._attachment_from_row(row) if row is not None else None

    def _enqueue(self, conn, *, attachment: dict[str, Any], now_iso: str) -> bool:
        if not self._source_kind(attachment):
            return False
        conn.execute(
            f"""
            INSERT OR IGNORE INTO {self._table}
            (attachment_id, task_id, status, attempt_count, next_attempt_at, lease_owner,
             lease_expires_at, artifact_rel_path, pdf_filename, source_kind, page_count,
             sheets_json, last_error, created_at, updated_at, ready_at)
            VALUES (?, ?, ?, 0, ?, NULL, NULL, '', '', '', 0, '[]', '', ?, ?, NULL)
            """,
            (
                _normalize_text(attachment.get("id")),
                _normalize_text(attachment.get("task_id")),
                PREVIEW_STATUS_QUEUED,
                now_iso,
                now_iso,
                now_iso,
            ),
        )
        return True

    def get_state(self, *, task_id: str, attachment_id: str, preview_pdf_path: str) -> dict[str, Any]:
        normalized_task_id = _normalize_text(task_id)
        normalized_attachment_id = _normalize_text(attachment_id)
        if not normalized_task_id or not normalized_attachment_id:
            raise LookupError("Task attachment not found")
        now_iso = _utc_now_iso()
        with self._hub._lock, self._hub._connect() as conn:
            attachment = self._load_attachment(
                conn,
                task_id=normalized_task_id,
                attachment_id=normalized_attachment_id,
            )
            if attachment is None:
                raise LookupError("Task attachment not found")
            if not self._enqueue(conn, attachment=attachment, now_iso=now_iso):
                raise ValueError("Attachment type is not supported for Office preview")
            row = conn.execute(
                f"SELECT * FROM {self._table} WHERE attachment_id = ?",
                (normalized_attachment_id,),
            ).fetchone()
            if row is None:
                raise RuntimeError("Task attachment preview could not be queued")
            preview = dict(row)
            if _normalize_text(preview.get("status")) == PREVIEW_STATUS_READY:
                artifact_path = self._artifact_path(_normalize_text(preview.get("artifact_rel_path")))
                if not artifact_path.is_file():
                    conn.execute(
                        f"""
                        UPDATE {self._table}
                        SET status = ?, next_attempt_at = ?, lease_owner = NULL,
                            lease_expires_at = NULL, last_error = ?, updated_at = ?
                        WHERE attachment_id = ?
                        """,
                        (
                            PREVIEW_STATUS_QUEUED,
                            now_iso,
                            "Published preview artifact is missing; queued for rebuild",
                            now_iso,
                            normalized_attachment_id,
                        ),
                    )
                    preview["status"] = PREVIEW_STATUS_QUEUED
                    preview["last_error"] = "Published preview artifact is missing; queued for rebuild"
            conn.commit()

        status = _normalize_text(preview.get("status"), PREVIEW_STATUS_QUEUED)
        state: dict[str, Any] = {"status": status, "attachment_id": normalized_attachment_id}
        if status == PREVIEW_STATUS_READY:
            try:
                sheets = json.loads(_normalize_text(preview.get("sheets_json"), "[]"))
            except (TypeError, ValueError, json.JSONDecodeError):
                sheets = []
            state.update(
                {
                    "preview_kind": "office_pdf",
                    "source_kind": _normalize_text(preview.get("source_kind")),
                    "source_filename": _normalize_text(attachment.get("file_name"), "attachment.bin"),
                    "pdf_filename": _normalize_text(preview.get("pdf_filename"), "attachment.pdf"),
                    "page_count": int(preview.get("page_count") or 0),
                    "sheets": sheets if isinstance(sheets, list) else [],
                    "preview_url": _normalize_text(preview_pdf_path),
                }
            )
        elif status == PREVIEW_STATUS_FAILED:
            state["error"] = _normalize_text(preview.get("last_error"), "Preview generation failed")
        else:
            state["retry_after_ms"] = self.poll_interval_ms
        return state

    def get_ready_artifact(self, *, task_id: str, attachment_id: str, preview_pdf_path: str) -> dict[str, Any]:
        state = self.get_state(
            task_id=task_id,
            attachment_id=attachment_id,
            preview_pdf_path=preview_pdf_path,
        )
        if state["status"] != PREVIEW_STATUS_READY:
            return state
        with self._hub._lock, self._hub._connect() as conn:
            row = conn.execute(
                f"SELECT artifact_rel_path FROM {self._table} WHERE attachment_id = ?",
                (_normalize_text(attachment_id),),
            ).fetchone()
        if row is None:
            return {"status": PREVIEW_STATUS_QUEUED, "retry_after_ms": self.poll_interval_ms}
        return {**state, "path": str(self._artifact_path(row["artifact_rel_path"]))}

    def claim_next_job(self, *, worker_id: str | None = None) -> TaskAttachmentPreviewJob | None:
        now = _utc_now()
        now_iso = now.isoformat()
        lease_owner = _normalize_text(worker_id) or uuid4().hex
        lease_expires_iso = (now + timedelta(seconds=self.lease_seconds)).isoformat()
        with self._hub._lock, self._hub._connect() as conn:
            row = conn.execute(
                f"""
                SELECT p.attachment_id, p.task_id, p.attempt_count,
                       a.file_path, a.file_name, a.file_mime, a.file_size
                FROM {self._table} p
                JOIN {self._hub._TASK_ATTACH_TABLE} a ON a.id = p.attachment_id
                WHERE (p.status = ? AND p.next_attempt_at <= ?)
                   OR (p.status = ? AND p.lease_expires_at IS NOT NULL AND p.lease_expires_at <= ?)
                ORDER BY p.next_attempt_at ASC, p.created_at ASC
                LIMIT 1
                """,
                (PREVIEW_STATUS_QUEUED, now_iso, PREVIEW_STATUS_PROCESSING, now_iso),
            ).fetchone()
            if row is None:
                return None
            candidate = dict(row)
            claimed = conn.execute(
                f"""
                UPDATE {self._table}
                SET status = ?, attempt_count = attempt_count + 1, lease_owner = ?,
                    lease_expires_at = ?, last_error = '', updated_at = ?
                WHERE attachment_id = ? AND (
                    (status = ? AND next_attempt_at <= ?)
                    OR (status = ? AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?)
                )
                """,
                (
                    PREVIEW_STATUS_PROCESSING,
                    lease_owner,
                    lease_expires_iso,
                    now_iso,
                    candidate["attachment_id"],
                    PREVIEW_STATUS_QUEUED,
                    now_iso,
                    PREVIEW_STATUS_PROCESSING,
                    now_iso,
                ),
            )
            if int(claimed.rowcount or 0) != 1:
                conn.rollback()
                return None
            conn.commit()
            return TaskAttachmentPreviewJob(
                attachment_id=_normalize_text(candidate.get("attachment_id")),
                task_id=_normalize_text(candidate.get("task_id")),
                file_path=_normalize_text(candidate.get("file_path")),
                file_name=_normalize_text(candidate.get("file_name"), "attachment.bin"),
                mime_type=_normalize_text(candidate.get("file_mime"), "application/octet-stream"),
                file_size=int(candidate.get("file_size") or 0),
                attempt_count=int(candidate.get("attempt_count") or 0) + 1,
                lease_owner=lease_owner,
            )

    def _renew_lease(self, job: TaskAttachmentPreviewJob) -> bool:
        now = _utc_now()
        with self._hub._lock, self._hub._connect() as conn:
            result = conn.execute(
                f"""
                UPDATE {self._table}
                SET lease_expires_at = ?, updated_at = ?
                WHERE attachment_id = ? AND status = ? AND lease_owner = ?
                """,
                (
                    (now + timedelta(seconds=self.lease_seconds)).isoformat(),
                    now.isoformat(),
                    job.attachment_id,
                    PREVIEW_STATUS_PROCESSING,
                    job.lease_owner,
                ),
            )
            conn.commit()
            return bool(result.rowcount)

    def _start_lease_heartbeat(self, job: TaskAttachmentPreviewJob) -> tuple[threading.Event, threading.Thread]:
        stop_event = threading.Event()
        interval = max(5.0, float(self.lease_seconds) / 3.0)

        def _heartbeat() -> None:
            while not stop_event.wait(interval):
                try:
                    if not self._renew_lease(job):
                        return
                except Exception:
                    logger.exception("task preview lease heartbeat failed attachment_id=%s", job.attachment_id)

        thread = threading.Thread(
            target=_heartbeat,
            name=f"task-preview-lease-{job.attachment_id[:12]}",
            daemon=True,
        )
        thread.start()
        return stop_event, thread

    def _mark_ready(self, *, job: TaskAttachmentPreviewJob, artifact, artifact_rel_path: str) -> bool:
        now_iso = _utc_now_iso()
        with self._hub._lock, self._hub._connect() as conn:
            result = conn.execute(
                f"""
                UPDATE {self._table}
                SET status = ?, artifact_rel_path = ?, pdf_filename = ?, source_kind = ?,
                    page_count = ?, sheets_json = ?, last_error = '', lease_owner = NULL,
                    lease_expires_at = NULL, next_attempt_at = ?, updated_at = ?, ready_at = ?
                WHERE attachment_id = ? AND status = ? AND lease_owner = ?
                """,
                (
                    PREVIEW_STATUS_READY,
                    artifact_rel_path,
                    _normalize_text(artifact.pdf_filename, "attachment.pdf"),
                    _normalize_text(artifact.source_kind),
                    int(artifact.page_count or 0),
                    json.dumps(list(artifact.sheets or []), ensure_ascii=False),
                    now_iso,
                    now_iso,
                    now_iso,
                    job.attachment_id,
                    PREVIEW_STATUS_PROCESSING,
                    job.lease_owner,
                ),
            )
            conn.commit()
            return bool(result.rowcount)

    def _mark_failure(self, *, job: TaskAttachmentPreviewJob, error: BaseException) -> str:
        now = _utc_now()
        terminal = int(job.attempt_count) >= self.max_attempts
        status = PREVIEW_STATUS_FAILED if terminal else PREVIEW_STATUS_QUEUED
        retry_delay = min(300, 2 ** max(0, int(job.attempt_count) - 1))
        with self._hub._lock, self._hub._connect() as conn:
            conn.execute(
                f"""
                UPDATE {self._table}
                SET status = ?, next_attempt_at = ?, lease_owner = NULL, lease_expires_at = NULL,
                    last_error = ?, updated_at = ?
                WHERE attachment_id = ? AND status = ? AND lease_owner = ?
                """,
                (
                    status,
                    (now if terminal else now + timedelta(seconds=retry_delay)).isoformat(),
                    (_normalize_text(error) or type(error).__name__)[:2000],
                    now.isoformat(),
                    job.attachment_id,
                    PREVIEW_STATUS_PROCESSING,
                    job.lease_owner,
                ),
            )
            conn.commit()
        return status

    def process_job(self, job: TaskAttachmentPreviewJob) -> str:
        """Convert one claimed task attachment and atomically publish its PDF."""

        from backend.services.mail_attachment_preview_service import build_office_preview_artifact

        temp_path: Path | None = None
        heartbeat_stop, heartbeat_thread = self._start_lease_heartbeat(job)

        def _stop_heartbeat() -> None:
            heartbeat_stop.set()
            heartbeat_thread.join(timeout=1.0)

        try:
            source_path = self._source_path(job)
            if not source_path.is_file():
                raise FileNotFoundError("Task attachment source file is missing")
            artifact = build_office_preview_artifact(
                filename=job.file_name,
                content_type=job.mime_type,
                content=source_path.read_bytes(),
            )
            artifact_rel_path = f"{job.task_id}/{job.attachment_id}.pdf"
            artifact_path = self._artifact_path(artifact_rel_path)
            artifact_path.parent.mkdir(parents=True, exist_ok=True)
            temp_path = artifact_path.with_name(f"{artifact_path.name}.{uuid4().hex}.tmp")
            with temp_path.open("xb") as handle:
                handle.write(artifact.pdf_bytes)
                handle.flush()
                os.fsync(handle.fileno())
            temp_path.replace(artifact_path)
            temp_path = None
            _stop_heartbeat()
            if not self._mark_ready(job=job, artifact=artifact, artifact_rel_path=artifact_rel_path):
                logger.warning("task preview lease was lost attachment_id=%s", job.attachment_id)
                return PREVIEW_STATUS_QUEUED
            return PREVIEW_STATUS_READY
        except Exception as exc:
            logger.warning(
                "task preview generation failed attachment_id=%s attempt=%s error=%s",
                job.attachment_id,
                job.attempt_count,
                exc,
            )
            _stop_heartbeat()
            return self._mark_failure(job=job, error=exc)
        finally:
            _stop_heartbeat()
            if temp_path is not None:
                try:
                    temp_path.unlink(missing_ok=True)
                except OSError:
                    pass

    def process_next_job(self, *, worker_id: str | None = None) -> bool:
        job = self.claim_next_job(worker_id=worker_id)
        if job is None:
            return False
        self.process_job(job)
        return True

    def delete_task_artifacts(self, task_id: str) -> None:
        normalized = _normalize_text(task_id)
        if not normalized or Path(normalized).name != normalized:
            return
        root = self._artifacts_root().resolve()
        target = (root / normalized).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            return
        shutil.rmtree(target, ignore_errors=True)


task_attachment_preview_service = TaskAttachmentPreviewService()
