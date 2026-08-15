from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from contextlib import AbstractContextManager
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, exists, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.appdb.db import app_session
from backend.appdb.models import AppAiPendingAction
from backend.ai_sandbox.contracts import (
    SandboxJobRecord,
    SandboxJobStatus,
    SandboxSessionRecord,
    SandboxSessionStatus,
    VerifiedAttachmentInput,
)
from backend.ai_sandbox.models import (
    AppAiSandboxFile,
    AppAiSandboxJob,
    AppAiSandboxPermission,
    AppAiSandboxSession,
    AppAiSandboxTransferGrant,
)
from backend.ai_sandbox.repository import SandboxQueueConflict


ACTIVE_JOB_STATUSES = (
    "preparing",
    "queued",
    "claimed",
    "running",
    "waiting_permission",
    "finalizing",
    "cleanup_pending",
)


class SandboxRepositoryConflict(SandboxQueueConflict):
    pass


class SandboxRepositoryOwnershipError(PermissionError):
    pass


def _json_loads(value: object, fallback: Any) -> Any:
    try:
        parsed = json.loads(str(value or ""))
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback
    return parsed


def _json_dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _aware_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


class SqlAlchemySandboxQueueRepository:
    def __init__(
        self,
        session_provider: Callable[[], AbstractContextManager[Session]] = app_session,
    ) -> None:
        self._session_provider = session_provider

    @staticmethod
    def _session_record(row: AppAiSandboxSession) -> SandboxSessionRecord:
        return SandboxSessionRecord(
            id=row.id,
            conversation_id=row.conversation_id,
            user_id=int(row.user_id),
            workspace_key=row.workspace_key,
            status=SandboxSessionStatus(row.status),
            created_at=row.created_at,
            last_activity_at=row.last_activity_at,
            expires_at=row.expires_at,
            credential_ref=row.credential_ref,
            opencode_session_id=row.opencode_session_id,
            purge_token=row.purge_token,
            inherits_personal_memory=False,
        )

    @staticmethod
    def _job_record(row: AppAiSandboxJob) -> SandboxJobRecord:
        result = _json_loads(row.result_json, {})
        return SandboxJobRecord(
            id=row.id,
            session_id=row.session_id,
            conversation_id=row.conversation_id,
            user_id=int(row.user_id),
            prompt_message_id=row.prompt_message_id,
            status=SandboxJobStatus(row.status),
            created_at=row.created_at,
            deadline_at=row.deadline_at,
            job_type=row.job_type,
            target_file_id=row.target_file_id,
            claimed_by=row.claimed_by,
            claimed_at=row.claimed_at,
            heartbeat_at=row.heartbeat_at,
            attempt=int(row.attempt or 0),
            result=result if isinstance(result, dict) else {},
            finalization_state=str(row.finalization_state or "not_required"),
            finalization_markdown=str(row.finalization_markdown or ""),
            assistant_message_id=row.assistant_message_id,
            cleanup_terminal_status=row.cleanup_terminal_status,
        )

    def create_session(self, session: SandboxSessionRecord) -> SandboxSessionRecord:
        row = AppAiSandboxSession(
            id=session.id,
            conversation_id=session.conversation_id,
            user_id=int(session.user_id),
            workspace_key=session.workspace_key,
            opencode_session_id=session.opencode_session_id,
            status=session.status.value,
            credential_ref=session.credential_ref,
            purge_token=session.purge_token,
            last_activity_at=session.last_activity_at,
            expires_at=session.expires_at,
            created_at=session.created_at,
            updated_at=session.created_at,
        )
        try:
            with self._session_provider() as db:
                db.add(row)
                db.flush()
                return self._session_record(row)
        except IntegrityError:
            with self._session_provider() as db:
                existing_row = db.execute(
                    select(AppAiSandboxSession)
                    .where(
                        AppAiSandboxSession.conversation_id == session.conversation_id,
                        AppAiSandboxSession.user_id == int(session.user_id),
                    )
                    .with_for_update()
                ).scalar_one_or_none()
                if existing_row is not None:
                    if existing_row.status == "purged":
                        # Retention deletes workspace contents, not the durable
                        # conversation identity. Reuse the opaque key and reset
                        # all runtime/session state atomically.
                        existing_row.status = session.status.value
                        existing_row.opencode_session_id = None
                        existing_row.credential_ref = session.credential_ref
                        existing_row.purge_token = None
                        existing_row.last_activity_at = session.last_activity_at
                        existing_row.expires_at = session.expires_at
                        existing_row.updated_at = session.created_at
                    elif existing_row.status == "purging":
                        raise SandboxRepositoryConflict(
                            "Sandbox session is being purged; retry after cleanup"
                        )
                    db.flush()
                    return self._session_record(existing_row)
            raise SandboxRepositoryConflict("Sandbox session uniqueness conflict") from None

    def get_session_for_user(self, session_id: str, user_id: int) -> SandboxSessionRecord | None:
        with self._session_provider() as db:
            row = db.execute(
                select(AppAiSandboxSession).where(
                    AppAiSandboxSession.id == session_id,
                    AppAiSandboxSession.user_id == int(user_id),
                    AppAiSandboxSession.status.notin_(("purging", "purged")),
                )
            ).scalar_one_or_none()
            return None if row is None else self._session_record(row)

    def get_session_for_conversation(
        self,
        *,
        conversation_id: str,
        user_id: int,
    ) -> SandboxSessionRecord | None:
        with self._session_provider() as db:
            row = db.execute(
                select(AppAiSandboxSession).where(
                    AppAiSandboxSession.conversation_id == conversation_id,
                    AppAiSandboxSession.user_id == int(user_id),
                    AppAiSandboxSession.status.notin_(("purging", "purged")),
                )
            ).scalar_one_or_none()
            return None if row is None else self._session_record(row)

    def touch_session(self, *, session_id: str, user_id: int, now: datetime, expires_at: datetime) -> bool:
        with self._session_provider() as db:
            row = db.execute(
                select(AppAiSandboxSession).where(
                    AppAiSandboxSession.id == session_id,
                    AppAiSandboxSession.user_id == int(user_id),
                    AppAiSandboxSession.status.notin_(("purging", "purged")),
                )
            ).scalar_one_or_none()
            if row is None:
                return False
            row.last_activity_at = now
            row.expires_at = expires_at
            row.updated_at = now
            return True

    def reserve_job(self, job: SandboxJobRecord) -> SandboxJobRecord:
        row = AppAiSandboxJob(
            id=job.id,
            session_id=job.session_id,
            conversation_id=job.conversation_id,
            user_id=int(job.user_id),
            prompt_message_id=job.prompt_message_id,
            job_type=job.job_type,
            target_file_id=job.target_file_id,
            status="preparing",
            attempt=0,
            deadline_at=job.deadline_at,
            result_json="{}",
            error_code="",
            created_at=job.created_at,
            updated_at=job.created_at,
        )
        try:
            with self._session_provider() as db:
                session_row = db.execute(
                    select(AppAiSandboxSession)
                    .where(
                        AppAiSandboxSession.id == job.session_id,
                        AppAiSandboxSession.conversation_id == job.conversation_id,
                        AppAiSandboxSession.user_id == int(job.user_id),
                    )
                    .with_for_update()
                ).scalar_one_or_none()
                if session_row is None:
                    raise SandboxRepositoryOwnershipError("Sandbox session scope mismatch")
                if session_row.status in {"purging", "purged"}:
                    raise SandboxRepositoryConflict(
                        "Sandbox session is unavailable during retention cleanup"
                    )
                db.add(row)
                db.flush()
                return self._job_record(row)
        except IntegrityError:
            with self._session_provider() as db:
                existing = db.execute(
                    select(AppAiSandboxJob).where(
                        AppAiSandboxJob.conversation_id == job.conversation_id,
                        AppAiSandboxJob.prompt_message_id == job.prompt_message_id,
                        AppAiSandboxJob.job_type == job.job_type,
                        AppAiSandboxJob.user_id == int(job.user_id),
                    )
                ).scalar_one_or_none()
                if existing is not None:
                    return self._job_record(existing)
            raise SandboxRepositoryConflict("Only one active sandbox job is allowed per user") from None

    def activate_prepared_job(self, *, job_id: str, user_id: int, now: datetime) -> SandboxJobRecord | None:
        with self._session_provider() as db:
            row = db.execute(
                select(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.id == job_id,
                    AppAiSandboxJob.user_id == int(user_id),
                    AppAiSandboxJob.status == "preparing",
                )
                .with_for_update()
            ).scalar_one_or_none()
            if row is None:
                return None
            row.status = "queued"
            row.updated_at = now
            session_row = db.get(AppAiSandboxSession, row.session_id)
            if session_row is not None:
                session_row.last_activity_at = now
                session_row.expires_at = max(_aware_utc(session_row.expires_at), _aware_utc(now))
                session_row.updated_at = now
            db.flush()
            return self._job_record(row)

    def fail_prepared_job(self, *, job_id: str, user_id: int, error_code: str, now: datetime) -> bool:
        with self._session_provider() as db:
            row = db.execute(
                select(AppAiSandboxJob).where(
                    AppAiSandboxJob.id == job_id,
                    AppAiSandboxJob.user_id == int(user_id),
                    AppAiSandboxJob.status == "preparing",
                )
            ).scalar_one_or_none()
            if row is None:
                return False
            row.status = "failed"
            row.error_code = str(error_code or "preparation_failed")[:64]
            row.completed_at = now
            row.updated_at = now
            return True

    def replace_job_inputs(
        self,
        *,
        job_id: str,
        user_id: int,
        inputs: Sequence[VerifiedAttachmentInput],
        now: datetime,
    ) -> None:
        with self._session_provider() as db:
            job = db.execute(
                select(AppAiSandboxJob).where(
                    AppAiSandboxJob.id == job_id,
                    AppAiSandboxJob.user_id == int(user_id),
                    AppAiSandboxJob.status == "preparing",
                )
            ).scalar_one_or_none()
            if job is None:
                raise SandboxRepositoryOwnershipError("Prepared sandbox job was not found")
            db.execute(
                delete(AppAiSandboxFile).where(
                    AppAiSandboxFile.job_id == job_id,
                    AppAiSandboxFile.file_kind == "input",
                )
            )
            for item in inputs:
                file_id = str(uuid4())
                db.add(
                    AppAiSandboxFile(
                        id=file_id,
                        session_id=job.session_id,
                        job_id=job.id,
                        conversation_id=job.conversation_id,
                        relative_path=f"input/{file_id}/{item.normalized_name}",
                        file_name=item.normalized_name,
                        file_kind="input",
                        content_type=item.content_type,
                        size_bytes=int(item.size_bytes),
                        sha256=item.sha256,
                        is_changed=False,
                        diff_text="",
                        source_message_id=item.message_id,
                        source_attachment_id=item.attachment_id,
                        created_at=now,
                        updated_at=now,
                    )
                )

    def get_job_for_user(self, *, job_id: str, user_id: int) -> SandboxJobRecord | None:
        with self._session_provider() as db:
            row = db.execute(
                select(AppAiSandboxJob).where(
                    AppAiSandboxJob.id == job_id,
                    AppAiSandboxJob.user_id == int(user_id),
                )
            ).scalar_one_or_none()
            return None if row is None else self._job_record(row)

    def claim_next_job(self, *, worker_id: str, now: datetime) -> SandboxJobRecord | None:
        with self._session_provider() as db:
            query = (
                select(AppAiSandboxJob)
                .where(AppAiSandboxJob.status == "queued")
                .order_by(AppAiSandboxJob.created_at.asc(), AppAiSandboxJob.id.asc())
                .limit(1)
            )
            dialect = str(getattr(getattr(db.get_bind(), "dialect", None), "name", ""))
            if dialect == "postgresql":
                query = query.with_for_update(skip_locked=True)
            row = db.execute(query).scalar_one_or_none()
            if row is None:
                return None
            row.status = "claimed"
            row.claimed_by = worker_id
            row.claimed_at = now
            row.heartbeat_at = now
            row.attempt = int(row.attempt or 0) + 1
            row.updated_at = now
            session_row = db.get(AppAiSandboxSession, row.session_id)
            if session_row is not None:
                session_row.status = "busy"
                session_row.updated_at = now
            db.flush()
            return self._job_record(row)

    def mark_job_running(self, *, job_id: str, worker_id: str, now: datetime) -> bool:
        with self._session_provider() as db:
            changed = db.execute(
                update(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.id == job_id,
                    AppAiSandboxJob.claimed_by == worker_id,
                    AppAiSandboxJob.status == "claimed",
                )
                .values(
                    status="running",
                    started_at=now,
                    heartbeat_at=now,
                    updated_at=now,
                )
                .execution_options(synchronize_session=False)
            )
            if int(changed.rowcount or 0) != 1:
                return False
            return True

    def heartbeat_job(self, *, job_id: str, worker_id: str, now: datetime) -> bool:
        with self._session_provider() as db:
            row = db.execute(
                select(AppAiSandboxJob).where(
                    AppAiSandboxJob.id == job_id,
                    AppAiSandboxJob.claimed_by == worker_id,
                    AppAiSandboxJob.status.in_(("claimed", "running", "waiting_permission")),
                )
            ).scalar_one_or_none()
            if row is None:
                return False
            row.heartbeat_at = now
            row.updated_at = now
            return True

    def complete_job(self, *, job_id: str, worker_id: str, result: dict, now: datetime) -> bool:
        return self._finish_job(
            job_id=job_id,
            worker_id=worker_id,
            status="succeeded",
            result=result,
            error_code="",
            now=now,
        )

    def begin_job_finalization(self, *, job_id: str, worker_id: str, result: dict, now: datetime) -> bool:
        """Durably store delivery intent before any public success message."""

        result_payload = dict(result) if isinstance(result, dict) else {}
        pending = result_payload.pop("_pending_finalize", None)
        if not isinstance(pending, dict):
            pending = {}
        assistant_markdown = str(pending.get("assistant_markdown") or "")
        if len(assistant_markdown) > 1_000_000:
            raise ValueError("Sandbox assistant result is too large")
        with self._session_provider() as db:
            row = db.execute(
                select(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.id == job_id,
                    AppAiSandboxJob.claimed_by == worker_id,
                    AppAiSandboxJob.status.in_(("claimed", "running", "waiting_permission")),
                )
                .with_for_update()
            ).scalar_one_or_none()
            if row is None:
                return False
            row.status = "finalizing"
            row.result_json = _json_dumps(result_payload)
            row.finalization_state = "pending"
            row.finalization_markdown = assistant_markdown
            row.assistant_message_id = None
            row.cleanup_terminal_status = None
            row.error_code = ""
            row.heartbeat_at = now
            row.updated_at = now
            return True

    def list_pending_finalizations(self, *, limit: int) -> Sequence[SandboxJobRecord]:
        with self._session_provider() as db:
            query = (
                select(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.status == "finalizing",
                    AppAiSandboxJob.finalization_state == "pending",
                )
                .order_by(AppAiSandboxJob.updated_at.asc(), AppAiSandboxJob.id.asc())
                .limit(max(1, min(int(limit), 200)))
            )
            dialect = str(getattr(getattr(db.get_bind(), "dialect", None), "name", ""))
            if dialect == "postgresql":
                query = query.with_for_update(skip_locked=True)
            return [self._job_record(row) for row in db.execute(query).scalars()]

    def mark_cleanup_pending(
        self,
        *,
        job_id: str,
        worker_id: str | None,
        terminal_status: str,
        error_code: str,
        now: datetime,
    ) -> bool:
        normalized_terminal = str(terminal_status or "failed")
        if normalized_terminal not in {"failed", "cancelled", "expired"}:
            raise ValueError("Invalid sandbox cleanup terminal status")
        with self._session_provider() as db:
            query = select(AppAiSandboxJob).where(
                AppAiSandboxJob.id == job_id,
                AppAiSandboxJob.status.in_(("claimed", "running", "waiting_permission", "cleanup_pending")),
            )
            if worker_id:
                query = query.where(AppAiSandboxJob.claimed_by == worker_id)
            row = db.execute(query.with_for_update()).scalar_one_or_none()
            if row is None:
                return False
            if row.status != "cleanup_pending" or row.cleanup_terminal_status != "cancelled":
                row.cleanup_terminal_status = normalized_terminal
            row.status = "cleanup_pending"
            row.error_code = str(error_code or "sandbox_cleanup_pending")[:64]
            row.completed_at = None
            row.updated_at = now
            session_row = db.get(AppAiSandboxSession, row.session_id)
            if session_row is not None:
                session_row.status = "busy"
                session_row.updated_at = now
            return True

    def list_cleanup_pending(self, *, limit: int) -> Sequence[SandboxJobRecord]:
        with self._session_provider() as db:
            query = (
                select(AppAiSandboxJob)
                .where(AppAiSandboxJob.status == "cleanup_pending")
                .order_by(AppAiSandboxJob.updated_at.asc(), AppAiSandboxJob.id.asc())
                .limit(max(1, min(int(limit), 200)))
            )
            dialect = str(getattr(getattr(db.get_bind(), "dialect", None), "name", ""))
            if dialect == "postgresql":
                query = query.with_for_update(skip_locked=True)
            return [self._job_record(row) for row in db.execute(query).scalars()]

    def complete_cleanup(self, *, job_id: str, now: datetime) -> bool:
        with self._session_provider() as db:
            row = db.execute(
                select(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.id == job_id,
                    AppAiSandboxJob.status == "cleanup_pending",
                )
                .with_for_update()
            ).scalar_one_or_none()
            if row is None:
                return False
            terminal_status = str(row.cleanup_terminal_status or "failed")
            if terminal_status not in {"failed", "cancelled", "expired"}:
                terminal_status = "failed"
            row.status = terminal_status
            row.cleanup_terminal_status = None
            row.completed_at = now
            row.updated_at = now
            session_row = db.get(AppAiSandboxSession, row.session_id)
            if session_row is not None:
                session_row.status = "stopped"
                session_row.last_activity_at = now
                session_row.updated_at = now
            return True

    def fail_job(self, *, job_id: str, worker_id: str, error_code: str, now: datetime) -> bool:
        return self._finish_job(
            job_id=job_id,
            worker_id=worker_id,
            status="expired" if error_code == "deadline_expired" else "failed",
            result={},
            error_code=str(error_code or "sandbox_execution_failed")[:64],
            now=now,
        )

    def _finish_job(
        self,
        *,
        job_id: str,
        worker_id: str,
        status: str,
        result: dict,
        error_code: str,
        now: datetime,
    ) -> bool:
        with self._session_provider() as db:
            changed = db.execute(
                update(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.id == job_id,
                    AppAiSandboxJob.claimed_by == worker_id,
                    AppAiSandboxJob.status.in_(("claimed", "running", "waiting_permission")),
                )
                .values(
                    status=status,
                    result_json=_json_dumps(result if isinstance(result, dict) else {}),
                    finalization_state="not_required",
                    finalization_markdown="",
                    assistant_message_id=None,
                    cleanup_terminal_status=None,
                    error_code=error_code,
                    completed_at=now,
                    updated_at=now,
                )
                .execution_options(synchronize_session=False)
            )
            if int(changed.rowcount or 0) != 1:
                return False
            session_id = db.execute(
                select(AppAiSandboxJob.session_id).where(AppAiSandboxJob.id == job_id)
            ).scalar_one()
            session_row = db.get(AppAiSandboxSession, session_id)
            if session_row is not None:
                session_row.status = "stopped"
                session_row.last_activity_at = now
                session_row.updated_at = now
            return True

    def cancel_job(self, *, job_id: str, user_id: int, now: datetime) -> bool:
        with self._session_provider() as db:
            row = db.execute(
                select(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.id == job_id,
                    AppAiSandboxJob.user_id == int(user_id),
                    AppAiSandboxJob.status.in_(
                        ("preparing", "queued", "claimed", "running", "waiting_permission", "cleanup_pending")
                    ),
                )
                .with_for_update()
            ).scalar_one_or_none()
            if row is None:
                return False
            pending_permissions = list(
                db.execute(
                    select(AppAiSandboxPermission)
                    .where(
                        AppAiSandboxPermission.job_id == row.id,
                        AppAiSandboxPermission.user_id == int(user_id),
                        AppAiSandboxPermission.status == "pending",
                    )
                    .with_for_update()
                ).scalars()
            )
            action_ids = [permission.action_id for permission in pending_permissions if permission.action_id]
            for permission in pending_permissions:
                permission.status = "rejected"
                permission.grant_scope = None
                permission.responded_by_user_id = int(user_id)
                permission.responded_at = now
                permission.updated_at = now
            if action_ids:
                db.execute(
                    update(AppAiPendingAction)
                    .where(
                        AppAiPendingAction.id.in_(action_ids),
                        AppAiPendingAction.status.in_(("pending", "executing")),
                    )
                    .values(
                        status="cancelled",
                        executed_by_user_id=int(user_id),
                        result_json=_json_dumps(
                            {"success": False, "reason": "sandbox_job_cancelled"}
                        ),
                        updated_at=now,
                    )
                )
            db.execute(
                update(AppAiSandboxTransferGrant)
                .where(
                    AppAiSandboxTransferGrant.job_id == row.id,
                    AppAiSandboxTransferGrant.direction == "output_upload",
                    AppAiSandboxTransferGrant.status == "issued",
                )
                .values(status="revoked", consumed_at=None, updated_at=now)
            )
            requires_cleanup = row.status in {"claimed", "running", "waiting_permission", "cleanup_pending"}
            row.status = "cleanup_pending" if requires_cleanup else "cancelled"
            row.cleanup_terminal_status = "cancelled" if requires_cleanup else None
            row.error_code = "user_cancelled"
            row.completed_at = None if requires_cleanup else now
            row.updated_at = now
            session_row = db.get(AppAiSandboxSession, row.session_id)
            if session_row is not None:
                session_row.status = "busy" if requires_cleanup else "stopped"
                session_row.last_activity_at = now
                session_row.updated_at = now
            return True

    def fail_unstarted_jobs_for_disabled(
        self,
        *,
        now: datetime,
        limit: int,
    ) -> Sequence[SandboxJobRecord]:
        """Terminalize PREPARING/QUEUED work while execution is disabled.

        These jobs have never entered the container, so no abort is needed.
        Persisting the terminal state prevents a quick re-enable from running
        old prompts and releases the one-active-job constraint/retention.
        """

        failed: list[SandboxJobRecord] = []
        with self._session_provider() as db:
            query = (
                select(AppAiSandboxJob)
                .where(AppAiSandboxJob.status.in_(("preparing", "queued")))
                .order_by(AppAiSandboxJob.created_at.asc(), AppAiSandboxJob.id.asc())
                .limit(max(1, min(int(limit), 200)))
            )
            dialect = str(getattr(getattr(db.get_bind(), "dialect", None), "name", ""))
            if dialect == "postgresql":
                query = query.with_for_update(skip_locked=True)
            rows = list(db.execute(query).scalars())
            for row in rows:
                failed.append(self._job_record(row))
                row.status = "failed"
                row.error_code = "sandbox_disabled"
                row.finalization_state = "not_required"
                row.cleanup_terminal_status = None
                row.completed_at = now
                row.updated_at = now
                session_row = db.get(AppAiSandboxSession, row.session_id)
                if session_row is not None:
                    session_row.status = "stopped"
                    session_row.updated_at = now
        return failed

    def reap_stale_jobs(
        self,
        *,
        now: datetime,
        heartbeat_timeout: timedelta,
        max_attempts: int,
        limit: int,
        allow_requeue: bool = True,
    ) -> Sequence[SandboxJobRecord]:
        """Bounded CAS recovery for a worker that died after claiming a job."""

        cutoff = now - heartbeat_timeout
        recovered: list[SandboxJobRecord] = []
        with self._session_provider() as db:
            query = (
                select(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.status.in_(("claimed", "running", "waiting_permission")),
                    (
                        (AppAiSandboxJob.deadline_at <= now)
                        | (AppAiSandboxJob.heartbeat_at.is_(None))
                        | (AppAiSandboxJob.heartbeat_at < cutoff)
                    ),
                )
                .order_by(AppAiSandboxJob.deadline_at.asc(), AppAiSandboxJob.updated_at.asc())
                .limit(max(1, min(int(limit), 200)))
            )
            dialect = str(getattr(getattr(db.get_bind(), "dialect", None), "name", ""))
            if dialect == "postgresql":
                query = query.with_for_update(skip_locked=True)
            rows = list(db.execute(query).scalars())
            for row in rows:
                original = self._job_record(row)
                if row.status in {"running", "waiting_permission"}:
                    # Never replay a job that may already have performed an
                    # approved edit/bash side effect. Cleanup remains durable
                    # until container absence and gateway revocation verify.
                    row.status = "cleanup_pending"
                    row.cleanup_terminal_status = "failed"
                    row.error_code = "worker_heartbeat_stale"
                    row.completed_at = None
                elif _aware_utc(row.deadline_at) <= _aware_utc(now):
                    row.status = "expired"
                    row.error_code = "deadline_expired"
                    row.completed_at = now
                elif row.status == "claimed" and not allow_requeue:
                    # Rollback/feature-off must not strand a claim from a
                    # crashed worker, and must never replay a possibly-started
                    # run. The cleanup worker verifies container absence and
                    # gateway revocation before this becomes terminal.
                    row.status = "cleanup_pending"
                    row.cleanup_terminal_status = "failed"
                    row.error_code = "sandbox_disabled_recovery"
                    row.completed_at = None
                elif row.status == "claimed" and int(row.attempt or 0) < max(1, int(max_attempts)):
                    row.status = "queued"
                    row.claimed_by = None
                    row.claimed_at = None
                    row.heartbeat_at = None
                    row.error_code = ""
                else:
                    # A running/waiting job may already have executed edit/bash.
                    # It is never replayed after a lost heartbeat.
                    row.status = "failed"
                    row.error_code = "worker_heartbeat_stale"
                    row.completed_at = now
                row.updated_at = now
                session_row = db.get(AppAiSandboxSession, row.session_id)
                if session_row is not None:
                    session_row.status = (
                        "ready"
                        if row.status == "queued"
                        else "busy"
                        if row.status == "cleanup_pending"
                        else "stopped"
                    )
                    session_row.updated_at = now
                recovered.append(original)
        return recovered

    def list_expired_sessions(self, *, now: datetime, limit: int) -> Sequence[SandboxSessionRecord]:
        active_exists = exists().where(
            AppAiSandboxJob.session_id == AppAiSandboxSession.id,
            AppAiSandboxJob.status.in_(ACTIVE_JOB_STATUSES),
        )
        with self._session_provider() as db:
            rows = list(
                db.execute(
                    select(AppAiSandboxSession)
                    .where(
                        AppAiSandboxSession.expires_at <= now,
                        AppAiSandboxSession.status.in_(("ready", "stopped", "failed")),
                        ~active_exists,
                    )
                    .order_by(AppAiSandboxSession.expires_at.asc())
                    .limit(max(1, min(int(limit), 200)))
                ).scalars()
            )
            return [self._session_record(row) for row in rows]

    def recover_stale_purging_sessions(
        self,
        *,
        now: datetime,
        stale_after: timedelta,
        limit: int,
    ) -> Sequence[SandboxSessionRecord]:
        """List stale purge leases without reopening their fixed workspace.

        Recovery repeats only the same token-fenced tombstone deletion. A
        timeout alone must never make a still-running filesystem purge
        reusable by enqueue.
        """

        cutoff = now - max(stale_after, timedelta(seconds=30))
        active_exists = exists().where(
            AppAiSandboxJob.session_id == AppAiSandboxSession.id,
            AppAiSandboxJob.status.in_(ACTIVE_JOB_STATUSES),
        )
        with self._session_provider() as db:
            query = (
                select(AppAiSandboxSession)
                .where(
                    AppAiSandboxSession.status == "purging",
                    AppAiSandboxSession.updated_at <= cutoff,
                    AppAiSandboxSession.purge_token.is_not(None),
                    ~active_exists,
                )
                .order_by(AppAiSandboxSession.updated_at.asc(), AppAiSandboxSession.id.asc())
                .limit(max(1, min(int(limit), 200)))
            )
            return [self._session_record(row) for row in db.execute(query).scalars()]

    def mark_session_for_purge(
        self,
        *,
        session_id: str,
        expected_last_activity_at: datetime,
        now: datetime,
    ) -> SandboxSessionRecord | None:
        with self._session_provider() as db:
            row = db.execute(
                select(AppAiSandboxSession)
                .where(
                    AppAiSandboxSession.id == session_id,
                    AppAiSandboxSession.status.in_(("ready", "stopped", "failed")),
                    AppAiSandboxSession.last_activity_at == expected_last_activity_at,
                )
                .with_for_update()
            ).scalar_one_or_none()
            if row is None:
                return None
            active = db.execute(
                select(exists().where(
                    AppAiSandboxJob.session_id == row.id,
                    AppAiSandboxJob.status.in_(ACTIVE_JOB_STATUSES),
                ))
            ).scalar()
            if bool(active):
                return None
            permissions = list(
                db.execute(
                    select(AppAiSandboxPermission).where(
                        AppAiSandboxPermission.session_id == row.id,
                        or_(
                            AppAiSandboxPermission.status == "pending",
                            (
                                (AppAiSandboxPermission.status == "approved")
                                & (AppAiSandboxPermission.grant_scope == "session")
                            ),
                        ),
                    )
                ).scalars()
            )
            pending_action_ids = [
                permission.action_id
                for permission in permissions
                if permission.status == "pending" and permission.action_id
            ]
            for permission in permissions:
                permission.status = "expired"
                permission.grant_scope = None
                permission.responded_at = now
                permission.updated_at = now
            if pending_action_ids:
                db.execute(
                    update(AppAiPendingAction)
                    .where(
                        AppAiPendingAction.id.in_(pending_action_ids),
                        AppAiPendingAction.status.in_(("pending", "executing")),
                    )
                    .values(
                        status="cancelled",
                        result_json=_json_dumps(
                            {"success": False, "reason": "sandbox_session_retention"}
                        ),
                        updated_at=now,
                    )
                )
            row.status = "purging"
            row.purge_token = uuid4().hex
            row.updated_at = now
            db.flush()
            return self._session_record(row)

    def mark_session_purged(self, *, session_id: str, purge_token: str, now: datetime) -> bool:
        with self._session_provider() as db:
            row = db.execute(
                select(AppAiSandboxSession).where(
                    AppAiSandboxSession.id == session_id,
                    AppAiSandboxSession.status == "purging",
                    AppAiSandboxSession.purge_token == str(purge_token),
                )
                .with_for_update()
            ).scalar_one_or_none()
            if row is None:
                return False
            active = db.execute(
                select(exists().where(
                    AppAiSandboxJob.session_id == row.id,
                    AppAiSandboxJob.status.in_(ACTIVE_JOB_STATUSES),
                ))
            ).scalar()
            if bool(active):
                # This should be unreachable once reserve_job serializes on the
                # session row. Keep retention fenced and non-reusable and
                # fail closed if a legacy or out-of-band writer violates it.
                row.updated_at = now
                return False
            row.status = "purged"
            row.credential_ref = ""
            row.opencode_session_id = None
            row.purge_token = None
            row.updated_at = now
            return True
