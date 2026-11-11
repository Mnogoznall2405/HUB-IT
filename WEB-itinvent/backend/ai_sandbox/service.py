from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol, Sequence

from .config import SandboxSettings
from .contracts import (
    SandboxAttachmentReference,
    SandboxJobRecord,
    SandboxJobStatus,
    SandboxSessionRecord,
    SandboxSessionStatus,
    VerifiedAttachmentInput,
)
from .repository import SandboxQueueConflict, SandboxQueueRepository


class SandboxDisabledError(RuntimeError):
    pass


class SandboxOwnershipError(PermissionError):
    pass


class SandboxActiveJobError(RuntimeError):
    """Mapped from the 0099 partial unique constraint by the repository."""


class AttachmentAccessVerifier(Protocol):
    """Verify ownership + AV state without exposing a host path to PostgreSQL."""

    def verify_for_sandbox(
        self,
        *,
        reference: SandboxAttachmentReference,
        user_id: int,
        conversation_id: str,
    ) -> VerifiedAttachmentInput: ...


@dataclass(frozen=True)
class EnqueueSandboxRun:
    conversation_id: str
    user_id: int
    prompt_message_id: str
    attachments: Sequence[SandboxAttachmentReference] = ()


@dataclass(frozen=True)
class SandboxRunStatus:
    id: str
    conversation_id: str
    status: SandboxJobStatus
    created_at: datetime
    deadline_at: datetime
    result: dict


class AiSandboxService:
    """Integration seam for ``ai_chat_service.queue_run_for_message``.

    OpenCode never receives HUB personal memory. A session is created lazily on
    the first message and maps one-to-one to a HUB AI conversation.
    """

    def __init__(
        self,
        *,
        settings: SandboxSettings,
        repository: SandboxQueueRepository,
        attachment_verifier: AttachmentAccessVerifier | None = None,
    ) -> None:
        self.settings = settings
        self.repository = repository
        self.attachment_verifier = attachment_verifier

    def enqueue(self, request: EnqueueSandboxRun, *, now: datetime | None = None) -> SandboxRunStatus:
        self._require_enabled()
        timestamp = now or datetime.now(timezone.utc)
        try:
            session = self.repository.get_session_for_conversation(
                conversation_id=request.conversation_id,
                user_id=request.user_id,
            )
            if session is None:
                session = self._create_session(request=request, now=timestamp)
        except SandboxQueueConflict as exc:
            raise SandboxActiveJobError("Sandbox workspace cleanup is in progress; retry shortly") from exc

        job = SandboxJobRecord(
            id=str(uuid.uuid4()),
            session_id=session.id,
            conversation_id=request.conversation_id,
            user_id=request.user_id,
            prompt_message_id=request.prompt_message_id,
            status=SandboxJobStatus.PREPARING,
            created_at=timestamp,
            deadline_at=timestamp + timedelta(seconds=self.settings.limits.response_timeout_seconds),
        )
        # Reserve before filesystem staging. PREPARING is covered by the
        # one-active-job unique index but cannot be claimed by a worker.
        try:
            reserved = self.repository.reserve_job(job)
        except SandboxQueueConflict as exc:
            raise SandboxActiveJobError("Sandbox workspace is temporarily unavailable") from exc
        # Duplicate WebSocket delivery/reconnect must reuse the original job.
        # A terminal job remains the idempotent result for the same message;
        # only a genuinely PREPARING reservation may stage inputs.
        if reserved.id != job.id or reserved.status is not SandboxJobStatus.PREPARING:
            return self._status(reserved)
        try:
            if request.attachments and self.attachment_verifier is None:
                raise SandboxOwnershipError("Sandbox attachment verification is unavailable")
            verified_inputs = [
                self.attachment_verifier.verify_for_sandbox(
                    reference=attachment,
                    user_id=request.user_id,
                    conversation_id=request.conversation_id,
                )
                for attachment in request.attachments
            ]
            self.repository.replace_job_inputs(
                job_id=reserved.id,
                user_id=request.user_id,
                inputs=verified_inputs,
                now=datetime.now(timezone.utc),
            )
        except Exception:
            self.repository.fail_prepared_job(
                job_id=reserved.id,
                user_id=request.user_id,
                error_code="attachment_staging_failed",
                now=datetime.now(timezone.utc),
            )
            raise
        queued = self.repository.activate_prepared_job(
            job_id=reserved.id,
            user_id=request.user_id,
            now=datetime.now(timezone.utc),
        )
        if queued is None:
            raise SandboxActiveJobError("Sandbox job preparation lost its atomic reservation")
        self.repository.touch_session(
            session_id=session.id,
            user_id=request.user_id,
            now=timestamp,
            expires_at=timestamp + timedelta(days=self.settings.retention_days),
        )
        return self._status(queued)

    def get_status(self, *, job_id: str, user_id: int) -> SandboxRunStatus:
        self._require_enabled()
        job = self.repository.get_job_for_user(job_id=job_id, user_id=user_id)
        if job is None:
            raise SandboxOwnershipError("Sandbox job was not found for this user")
        return self._status(job)

    def cancel(self, *, job_id: str, user_id: int, now: datetime | None = None) -> bool:
        self._require_enabled()
        return self.repository.cancel_job(
            job_id=job_id,
            user_id=user_id,
            now=now or datetime.now(timezone.utc),
        )

    def _create_session(
        self,
        *,
        request: EnqueueSandboxRun,
        now: datetime,
    ) -> SandboxSessionRecord:
        session_id = str(uuid.uuid4())
        session = SandboxSessionRecord(
            id=session_id,
            conversation_id=request.conversation_id,
            user_id=request.user_id,
            workspace_key=f"ws-{uuid.uuid4().hex}",
            status=SandboxSessionStatus.NEW,
            created_at=now,
            last_activity_at=now,
            expires_at=now + timedelta(days=self.settings.retention_days),
            credential_ref="",
            inherits_personal_memory=False,
        )
        return self.repository.create_session(session)

    def _require_enabled(self) -> None:
        if not self.settings.enabled:
            raise SandboxDisabledError("OpenCode sandbox is disabled")

    @staticmethod
    def _status(job: SandboxJobRecord) -> SandboxRunStatus:
        return SandboxRunStatus(
            id=job.id,
            conversation_id=job.conversation_id,
            status=job.status,
            created_at=job.created_at,
            deadline_at=job.deadline_at,
            result=dict(job.result),
        )
