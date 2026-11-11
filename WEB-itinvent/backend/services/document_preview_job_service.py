"""Durable background previews for remotely fetched application documents."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from backend.appdb.db import app_session, ensure_app_database_configured
from backend.appdb.models import AppDocumentPreviewJob
from backend.config import PROJECT_ROOT


logger = logging.getLogger("backend.document_preview.jobs")

PREVIEW_SCOPE_MAIL = "mail"
PREVIEW_SCOPE_DOCFLOW = "docflow"
PREVIEW_SCOPE_WAREHOUSE_1C = "warehouse_1c"
PREVIEW_STATUS_QUEUED = "queued"
PREVIEW_STATUS_PROCESSING = "processing"
PREVIEW_STATUS_READY = "ready"
PREVIEW_STATUS_FAILED = "failed"
_SUPPORTED_SCOPES = frozenset(
    {PREVIEW_SCOPE_MAIL, PREVIEW_SCOPE_DOCFLOW, PREVIEW_SCOPE_WAREHOUSE_1C}
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_text(value: object, default: str = "") -> str:
    normalized = str(value or "").strip()
    return normalized or default


def _positive_int_env(
    name: str,
    default: int,
    *,
    minimum: int = 1,
    maximum: int = 86_400,
) -> int:
    try:
        value = int(str(os.getenv(name, default) or default))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _coerce_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@dataclass(frozen=True)
class DocumentPreviewJob:
    id: str
    scope: str
    owner_user_id: int
    source_payload: dict[str, Any]
    attempt_count: int
    lease_owner: str


class DocumentPreviewJobService:
    """Queue used by the standalone preview process for mail and 1C files."""

    def __init__(self, *, artifacts_root: Path | None = None, database_url: str | None = None) -> None:
        self._database_url = database_url
        self._artifacts_root_override = Path(artifacts_root) if artifacts_root is not None else None

    @property
    def max_attempts(self) -> int:
        fallback = _positive_int_env("PREVIEW_MAX_ATTEMPTS", 3, maximum=20)
        return _positive_int_env("DOCUMENT_PREVIEW_MAX_ATTEMPTS", fallback, maximum=20)

    @property
    def lease_seconds(self) -> int:
        fallback = _positive_int_env(
            "PREVIEW_LEASE_SEC",
            240,
            minimum=30,
            maximum=3600,
        )
        return _positive_int_env(
            "DOCUMENT_PREVIEW_LEASE_SEC",
            fallback,
            minimum=30,
            maximum=3600,
        )

    @property
    def poll_interval_ms(self) -> int:
        fallback = _positive_int_env(
            "PREVIEW_POLL_INTERVAL_MS",
            500,
            minimum=50,
            maximum=10_000,
        )
        return _positive_int_env(
            "DOCUMENT_PREVIEW_POLL_INTERVAL_MS",
            fallback,
            minimum=50,
            maximum=10_000,
        )

    @property
    def retention_hours(self) -> int:
        return _positive_int_env("DOCUMENT_PREVIEW_RETENTION_HOURS", 24, maximum=24 * 30)

    def _database(self) -> str:
        return ensure_app_database_configured(self._database_url)

    def _artifacts_root(self) -> Path:
        if self._artifacts_root_override is not None:
            return self._artifacts_root_override
        return PROJECT_ROOT / "data" / "document_preview_artifacts"

    def _artifact_path(self, artifact_rel_path: str) -> Path:
        root = self._artifacts_root().resolve()
        path = (root / _normalize_text(artifact_rel_path)).resolve()
        try:
            path.relative_to(root)
        except ValueError as exc:
            raise ValueError("Invalid preview artifact path") from exc
        return path

    @staticmethod
    def _normalized_scope(scope: str) -> str:
        normalized = _normalize_text(scope).lower()
        if normalized not in _SUPPORTED_SCOPES:
            raise ValueError("Unsupported document preview scope")
        return normalized

    @staticmethod
    def _normalized_payload(scope: str, payload: dict[str, Any]) -> dict[str, Any]:
        if scope == PREVIEW_SCOPE_MAIL:
            normalized = {
                "message_id": _normalize_text(payload.get("message_id")),
                "attachment_ref": _normalize_text(payload.get("attachment_ref")),
                "mailbox_id": _normalize_text(payload.get("mailbox_id")),
            }
            if not normalized["message_id"] or not normalized["attachment_ref"]:
                raise ValueError("Mail attachment preview context is incomplete")
            return normalized
        if scope == PREVIEW_SCOPE_WAREHOUSE_1C:
            normalized = {
                "registrar_ref": _normalize_text(payload.get("registrar_ref")),
                "file_ref": _normalize_text(payload.get("file_ref")),
            }
            if not normalized["registrar_ref"] or not normalized["file_ref"]:
                raise ValueError("Warehouse 1C preview context is incomplete")
            return normalized
        normalized = {
            "task_ref": _normalize_text(payload.get("task_ref")),
            "file_ref": _normalize_text(payload.get("file_ref")),
        }
        if not normalized["task_ref"] or not normalized["file_ref"]:
            raise ValueError("Document-flow preview context is incomplete")
        return normalized

    @staticmethod
    def _resource_key(scope: str, source_payload: dict[str, Any]) -> str:
        serialized = json.dumps(
            {"scope": scope, "source": source_payload},
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

    @staticmethod
    def _metadata(row: AppDocumentPreviewJob, *, preview_url: str) -> dict[str, Any]:
        state: dict[str, Any] = {
            "status": _normalize_text(row.status, PREVIEW_STATUS_QUEUED),
            "preview_id": _normalize_text(row.id),
        }
        if row.status == PREVIEW_STATUS_READY:
            try:
                sheets = json.loads(_normalize_text(row.sheets_json, "[]"))
            except (TypeError, ValueError, json.JSONDecodeError):
                sheets = []
            state.update(
                {
                    "preview_kind": "pdf" if row.source_kind == "pdf" else "office_pdf",
                    "source_kind": _normalize_text(row.source_kind),
                    "source_filename": _normalize_text(row.source_filename, "document.bin"),
                    "pdf_filename": _normalize_text(row.pdf_filename, "preview.pdf"),
                    "page_count": int(row.page_count or 0),
                    "sheets": sheets if isinstance(sheets, list) else [],
                    "preview_url": _normalize_text(preview_url),
                }
            )
        elif row.status == PREVIEW_STATUS_FAILED:
            state["error"] = _normalize_text(row.last_error, "Preview generation failed")
        return state

    def get_state(
        self,
        *,
        scope: str,
        owner_user_id: int,
        source_payload: dict[str, Any],
        preview_url: str,
    ) -> dict[str, Any]:
        normalized_scope = self._normalized_scope(scope)
        normalized_payload = self._normalized_payload(normalized_scope, source_payload)
        resource_key = self._resource_key(normalized_scope, normalized_payload)
        now = _utc_now()
        expires_at = now + timedelta(hours=self.retention_hours)
        database_url = self._database()

        with app_session(database_url) as session:
            row = session.scalar(
                select(AppDocumentPreviewJob).where(
                    AppDocumentPreviewJob.scope == normalized_scope,
                    AppDocumentPreviewJob.owner_user_id == int(owner_user_id),
                    AppDocumentPreviewJob.resource_key == resource_key,
                )
            )
            if row is None:
                row = AppDocumentPreviewJob(
                    id=uuid4().hex,
                    scope=normalized_scope,
                    owner_user_id=int(owner_user_id),
                    resource_key=resource_key,
                    source_payload_json=json.dumps(normalized_payload, ensure_ascii=False, sort_keys=True),
                    status=PREVIEW_STATUS_QUEUED,
                    attempt_count=0,
                    next_attempt_at=now,
                    created_at=now,
                    updated_at=now,
                    expires_at=expires_at,
                )
                session.add(row)
                try:
                    session.flush()
                except IntegrityError:
                    session.rollback()
                    row = session.scalar(
                        select(AppDocumentPreviewJob).where(
                            AppDocumentPreviewJob.scope == normalized_scope,
                            AppDocumentPreviewJob.owner_user_id == int(owner_user_id),
                            AppDocumentPreviewJob.resource_key == resource_key,
                        )
                    )
                    if row is None:
                        raise
            row.expires_at = expires_at
            row.updated_at = now
            if row.status == PREVIEW_STATUS_READY:
                artifact_path = self._artifact_path(row.artifact_rel_path)
                if not artifact_path.is_file():
                    row.status = PREVIEW_STATUS_QUEUED
                    row.next_attempt_at = now
                    row.lease_owner = None
                    row.lease_expires_at = None
                    row.last_error = "Published preview artifact is missing; queued for rebuild"
            state = self._metadata(row, preview_url=preview_url)

        if state["status"] in {PREVIEW_STATUS_QUEUED, PREVIEW_STATUS_PROCESSING}:
            state["retry_after_ms"] = self.poll_interval_ms
        return state

    def get_ready_artifact(
        self,
        *,
        scope: str,
        owner_user_id: int,
        source_payload: dict[str, Any],
        preview_url: str,
    ) -> dict[str, Any]:
        state = self.get_state(
            scope=scope,
            owner_user_id=owner_user_id,
            source_payload=source_payload,
            preview_url=preview_url,
        )
        if state["status"] != PREVIEW_STATUS_READY:
            return state
        normalized_scope = self._normalized_scope(scope)
        normalized_payload = self._normalized_payload(normalized_scope, source_payload)
        resource_key = self._resource_key(normalized_scope, normalized_payload)
        with app_session(self._database()) as session:
            row = session.scalar(
                select(AppDocumentPreviewJob).where(
                    AppDocumentPreviewJob.scope == normalized_scope,
                    AppDocumentPreviewJob.owner_user_id == int(owner_user_id),
                    AppDocumentPreviewJob.resource_key == resource_key,
                )
            )
            if row is None or row.status != PREVIEW_STATUS_READY:
                return {"status": PREVIEW_STATUS_QUEUED, "retry_after_ms": self.poll_interval_ms}
            artifact_path = self._artifact_path(row.artifact_rel_path)
        return {**state, "path": str(artifact_path)}

    def claim_next_job(self, *, worker_id: str | None = None) -> DocumentPreviewJob | None:
        now = _utc_now()
        lease_owner = _normalize_text(worker_id) or uuid4().hex
        lease_expires_at = now + timedelta(seconds=self.lease_seconds)
        with app_session(self._database()) as session:
            row = session.scalar(
                select(AppDocumentPreviewJob)
                .where(
                    AppDocumentPreviewJob.expires_at > now,
                    or_(
                        (
                            (AppDocumentPreviewJob.status == PREVIEW_STATUS_QUEUED)
                            & (AppDocumentPreviewJob.next_attempt_at <= now)
                        ),
                        (
                            (AppDocumentPreviewJob.status == PREVIEW_STATUS_PROCESSING)
                            & (AppDocumentPreviewJob.lease_expires_at.is_not(None))
                            & (AppDocumentPreviewJob.lease_expires_at <= now)
                        ),
                    ),
                )
                .order_by(AppDocumentPreviewJob.next_attempt_at.asc(), AppDocumentPreviewJob.created_at.asc())
                .with_for_update(skip_locked=True)
            )
            if row is None:
                return None
            row.status = PREVIEW_STATUS_PROCESSING
            row.attempt_count = int(row.attempt_count or 0) + 1
            row.lease_owner = lease_owner
            row.lease_expires_at = lease_expires_at
            row.last_error = ""
            row.updated_at = now
            try:
                source_payload = json.loads(_normalize_text(row.source_payload_json, "{}"))
            except (TypeError, ValueError, json.JSONDecodeError):
                source_payload = {}
            return DocumentPreviewJob(
                id=_normalize_text(row.id),
                scope=_normalize_text(row.scope),
                owner_user_id=int(row.owner_user_id),
                source_payload=source_payload if isinstance(source_payload, dict) else {},
                attempt_count=int(row.attempt_count),
                lease_owner=lease_owner,
            )

    def _renew_lease(self, job: DocumentPreviewJob) -> bool:
        now = _utc_now()
        with app_session(self._database()) as session:
            row = session.get(AppDocumentPreviewJob, job.id)
            if row is None or row.status != PREVIEW_STATUS_PROCESSING or row.lease_owner != job.lease_owner:
                return False
            row.lease_expires_at = now + timedelta(seconds=self.lease_seconds)
            row.updated_at = now
            return True

    def _start_lease_heartbeat(self, job: DocumentPreviewJob) -> tuple[threading.Event, threading.Thread]:
        stop_event = threading.Event()
        interval = max(5.0, float(self.lease_seconds) / 3.0)

        def _heartbeat() -> None:
            while not stop_event.wait(interval):
                try:
                    if not self._renew_lease(job):
                        return
                except Exception:
                    logger.exception("document preview lease heartbeat failed preview_id=%s", job.id)

        thread = threading.Thread(
            target=_heartbeat,
            name=f"document-preview-lease-{job.id[:12]}",
            daemon=True,
        )
        thread.start()
        return stop_event, thread

    @staticmethod
    def _pdf_page_count(content: bytes) -> int:
        try:
            from io import BytesIO
            from pypdf import PdfReader

            with PdfReader(BytesIO(content)) as reader:
                return max(0, len(reader.pages))
        except Exception:
            return 0

    def _load_source(self, job: DocumentPreviewJob) -> tuple[str, str, bytes]:
        if job.scope == PREVIEW_SCOPE_MAIL:
            from backend.services.mail_service import mail_service

            return mail_service.download_attachment(
                user_id=job.owner_user_id,
                mailbox_id=_normalize_text(job.source_payload.get("mailbox_id")) or None,
                message_id=_normalize_text(job.source_payload.get("message_id")),
                attachment_ref=_normalize_text(job.source_payload.get("attachment_ref")),
            )

        if job.scope == PREVIEW_SCOPE_WAREHOUSE_1C:
            from backend.services.warehouse_1c_service import warehouse_1c_service

            payload = asyncio.run(
                warehouse_1c_service.get_movement_file(
                    _normalize_text(job.source_payload.get("registrar_ref")),
                    _normalize_text(job.source_payload.get("file_ref")),
                )
            )
            return (
                _normalize_text(payload.get("name"), "document.bin"),
                _normalize_text(payload.get("content_type"), "application/octet-stream"),
                bytes(payload.get("content") or b""),
            )

        from backend.services.docflow_service import docflow_service

        exported = asyncio.run(
            docflow_service.export_file(
                user_id=job.owner_user_id,
                task_ref=_normalize_text(job.source_payload.get("task_ref")),
                file_ref=_normalize_text(job.source_payload.get("file_ref")),
                correlation_id=f"preview-{job.id}",
            )
        )
        path = docflow_service._validated_export_path(_normalize_text(exported.get("temporary_path")))
        try:
            content = path.read_bytes()
        finally:
            docflow_service.remove_exported_file(path)
        return (
            _normalize_text(exported.get("name"), "document.bin"),
            _normalize_text(exported.get("content_type"), "application/octet-stream"),
            content,
        )

    def _mark_ready(
        self,
        *,
        job: DocumentPreviewJob,
        artifact_rel_path: str,
        source_filename: str,
        content_type: str,
        pdf_filename: str,
        source_kind: str,
        page_count: int,
        sheets: list[dict[str, Any]],
    ) -> bool:
        now = _utc_now()
        with app_session(self._database()) as session:
            row = session.get(AppDocumentPreviewJob, job.id)
            if row is None or row.status != PREVIEW_STATUS_PROCESSING or row.lease_owner != job.lease_owner:
                return False
            row.status = PREVIEW_STATUS_READY
            row.artifact_rel_path = artifact_rel_path
            row.source_filename = source_filename
            row.content_type = content_type
            row.pdf_filename = pdf_filename
            row.source_kind = source_kind
            row.page_count = int(page_count or 0)
            row.sheets_json = json.dumps(list(sheets or []), ensure_ascii=False)
            row.last_error = ""
            row.lease_owner = None
            row.lease_expires_at = None
            row.updated_at = now
            row.ready_at = now
            return True

    def _mark_failure(self, *, job: DocumentPreviewJob, error: BaseException) -> str:
        now = _utc_now()
        terminal = int(job.attempt_count) >= self.max_attempts
        status = PREVIEW_STATUS_FAILED if terminal else PREVIEW_STATUS_QUEUED
        retry_delay = min(300, 2 ** max(0, int(job.attempt_count) - 1))
        with app_session(self._database()) as session:
            row = session.get(AppDocumentPreviewJob, job.id)
            if row is None or row.status != PREVIEW_STATUS_PROCESSING or row.lease_owner != job.lease_owner:
                return PREVIEW_STATUS_QUEUED
            row.status = status
            row.next_attempt_at = now if terminal else now + timedelta(seconds=retry_delay)
            row.lease_owner = None
            row.lease_expires_at = None
            row.last_error = (_normalize_text(error) or type(error).__name__)[:2000]
            row.updated_at = now
        return status

    def process_job(self, job: DocumentPreviewJob) -> str:
        """Fetch, convert and atomically publish one claimed preview job."""

        from backend.services.mail_attachment_preview_service import (
            PreviewArtifact,
            build_office_preview_artifact,
            classify_office_source,
        )

        temp_path: Path | None = None
        heartbeat_stop, heartbeat_thread = self._start_lease_heartbeat(job)

        def _stop_heartbeat() -> None:
            heartbeat_stop.set()
            heartbeat_thread.join(timeout=1.0)

        try:
            filename, content_type, content = self._load_source(job)
            is_pdf = content_type.lower() == "application/pdf" or filename.lower().endswith(".pdf")
            if is_pdf:
                artifact = PreviewArtifact(
                    pdf_bytes=content,
                    pdf_filename=filename,
                    source_kind="pdf",
                    page_count=self._pdf_page_count(content),
                    sheets=[],
                )
            else:
                if not classify_office_source(filename=filename, content_type=content_type):
                    raise ValueError("File type is not supported for document preview")
                artifact = build_office_preview_artifact(
                    filename=filename,
                    content_type=content_type,
                    content=content,
                )

            artifact_rel_path = f"{job.scope}/{job.id}.pdf"
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
            if not self._mark_ready(
                job=job,
                artifact_rel_path=artifact_rel_path,
                source_filename=filename,
                content_type=content_type,
                pdf_filename=artifact.pdf_filename,
                source_kind=artifact.source_kind,
                page_count=artifact.page_count,
                sheets=list(artifact.sheets or []),
            ):
                logger.warning("document preview lease was lost preview_id=%s", job.id)
                return PREVIEW_STATUS_QUEUED
            return PREVIEW_STATUS_READY
        except Exception as exc:
            logger.warning(
                "document preview generation failed preview_id=%s scope=%s attempt=%s error=%s",
                job.id,
                job.scope,
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

    def cleanup_expired(self, *, limit: int = 50) -> int:
        now = _utc_now()
        artifact_paths: list[Path] = []
        with app_session(self._database()) as session:
            rows = session.scalars(
                select(AppDocumentPreviewJob)
                .where(
                    AppDocumentPreviewJob.expires_at <= now,
                    AppDocumentPreviewJob.status != PREVIEW_STATUS_PROCESSING,
                )
                .order_by(AppDocumentPreviewJob.expires_at.asc())
                .limit(max(1, int(limit or 50)))
                .with_for_update(skip_locked=True)
            ).all()
            for row in rows:
                if _normalize_text(row.artifact_rel_path):
                    artifact_paths.append(self._artifact_path(row.artifact_rel_path))
                session.delete(row)
        for path in artifact_paths:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                logger.warning("failed to delete expired preview artifact path=%s", path)
        return len(artifact_paths)

    def process_next_job(self, *, worker_id: str | None = None) -> bool:
        job = self.claim_next_job(worker_id=worker_id)
        if job is None:
            return False
        self.process_job(job)
        return True


document_preview_job_service = DocumentPreviewJobService()
