from __future__ import annotations

from datetime import datetime, timedelta
from typing import Protocol, Sequence

from .contracts import SandboxJobRecord, SandboxSessionRecord, VerifiedAttachmentInput


class SandboxQueueConflict(RuntimeError):
    """A transient queue/session state prevents safely starting new work."""


class SandboxQueueRepository(Protocol):
    """Persistence contract for the future app-scope 0099 implementation.

    ``claim_next_job`` and ``mark_session_for_purge`` must be compare-and-set
    operations inside a short database transaction.
    """

    def create_session(self, session: SandboxSessionRecord) -> SandboxSessionRecord: ...

    def get_session_for_user(self, session_id: str, user_id: int) -> SandboxSessionRecord | None: ...

    def get_session_for_conversation(
        self,
        *,
        conversation_id: str,
        user_id: int,
    ) -> SandboxSessionRecord | None: ...

    def touch_session(self, *, session_id: str, user_id: int, now: datetime, expires_at: datetime) -> bool: ...

    def reserve_job(self, job: SandboxJobRecord) -> SandboxJobRecord: ...

    def activate_prepared_job(self, *, job_id: str, user_id: int, now: datetime) -> SandboxJobRecord | None: ...

    def fail_prepared_job(self, *, job_id: str, user_id: int, error_code: str, now: datetime) -> bool: ...

    def replace_job_inputs(
        self,
        *,
        job_id: str,
        user_id: int,
        inputs: Sequence[VerifiedAttachmentInput],
        now: datetime,
    ) -> None: ...

    def get_job_for_user(self, *, job_id: str, user_id: int) -> SandboxJobRecord | None: ...

    def claim_next_job(self, *, worker_id: str, now: datetime) -> SandboxJobRecord | None: ...

    def mark_job_running(self, *, job_id: str, worker_id: str, now: datetime) -> bool: ...

    def heartbeat_job(self, *, job_id: str, worker_id: str, now: datetime) -> bool: ...

    def complete_job(self, *, job_id: str, worker_id: str, result: dict, now: datetime) -> bool: ...

    def begin_job_finalization(self, *, job_id: str, worker_id: str, result: dict, now: datetime) -> bool: ...

    def list_pending_finalizations(self, *, limit: int) -> Sequence[SandboxJobRecord]: ...

    def mark_cleanup_pending(
        self,
        *,
        job_id: str,
        worker_id: str | None,
        terminal_status: str,
        error_code: str,
        now: datetime,
    ) -> bool: ...

    def list_cleanup_pending(self, *, limit: int) -> Sequence[SandboxJobRecord]: ...

    def complete_cleanup(self, *, job_id: str, now: datetime) -> bool: ...

    def fail_job(self, *, job_id: str, worker_id: str, error_code: str, now: datetime) -> bool: ...

    def cancel_job(self, *, job_id: str, user_id: int, now: datetime) -> bool: ...

    def fail_unstarted_jobs_for_disabled(
        self,
        *,
        now: datetime,
        limit: int,
    ) -> Sequence[SandboxJobRecord]: ...

    def reap_stale_jobs(
        self,
        *,
        now: datetime,
        heartbeat_timeout: timedelta,
        max_attempts: int,
        limit: int,
        allow_requeue: bool = True,
    ) -> Sequence[SandboxJobRecord]: ...

    def list_expired_sessions(self, *, now: datetime, limit: int) -> Sequence[SandboxSessionRecord]: ...

    def recover_stale_purging_sessions(
        self,
        *,
        now: datetime,
        stale_after: timedelta,
        limit: int,
    ) -> Sequence[SandboxSessionRecord]: ...

    def mark_session_for_purge(
        self,
        *,
        session_id: str,
        expected_last_activity_at: datetime,
        now: datetime,
    ) -> SandboxSessionRecord | None: ...

    def mark_session_purged(self, *, session_id: str, purge_token: str, now: datetime) -> bool: ...

# Named bind parameters are intentional. A concrete SQLAlchemy repository can
# execute these statements without interpolating user-controlled values.
POSTGRES_CLAIM_JOB_SQL = """
WITH candidate AS (
    SELECT id
    FROM ai_sandbox_jobs
    WHERE status = 'queued'
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE ai_sandbox_jobs AS job
SET status = 'claimed',
    claimed_by = :worker_id,
    claimed_at = :now,
    heartbeat_at = :now,
    attempt = job.attempt + 1,
    updated_at = :now
FROM candidate
WHERE job.id = candidate.id
  AND job.status = 'queued'
RETURNING job.*
""".strip()


POSTGRES_ACTIVE_JOB_UNIQUE_INDEX_SQL = """
CREATE UNIQUE INDEX uq_ai_sandbox_jobs_one_active_per_user
ON ai_sandbox_jobs (user_id)
WHERE status IN ('preparing', 'queued', 'claimed', 'running', 'waiting_permission', 'finalizing', 'cleanup_pending')
""".strip()


POSTGRES_PURGE_SESSION_SQL = """
UPDATE ai_sandbox_sessions
SET status = 'purging', updated_at = :now
WHERE id = :session_id
  AND status IN ('ready', 'stopped', 'failed')
  AND last_activity_at = :expected_last_activity_at
  AND NOT EXISTS (
      SELECT 1 FROM ai_sandbox_jobs AS job
      WHERE job.session_id = ai_sandbox_sessions.id
        AND job.status IN ('preparing', 'queued', 'claimed', 'running', 'waiting_permission', 'finalizing', 'cleanup_pending')
  )
RETURNING id
""".strip()
