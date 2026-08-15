from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Event, Thread
from typing import Protocol

from .config import SandboxSettings
from .contracts import (
    SandboxExecutionCancelled,
    SandboxJobRecord,
    SandboxJobStatus,
    SandboxSessionRecord,
    SandboxSessionStatus,
)
from .repository import SandboxQueueRepository


class SandboxJobExecutor(Protocol):
    def execute(
        self,
        job: SandboxJobRecord,
        *,
        command_timeout_seconds: int,
        response_timeout_seconds: int,
    ) -> dict: ...

    def purge_session(self, session: SandboxSessionRecord) -> None: ...

    def abort_job(self, job: SandboxJobRecord) -> None: ...

    def finalize_job(self, job: SandboxJobRecord) -> None: ...

    def notify_job_state(self, job_id: str) -> None: ...


@dataclass(frozen=True)
class WorkerCycleResult:
    claimed_job_id: str | None = None
    outcome: str = "idle"


class AiSandboxWorker:
    """Single-cycle worker orchestration; process supervision lives outside it."""

    def __init__(
        self,
        *,
        worker_id: str,
        settings: SandboxSettings,
        repository: SandboxQueueRepository,
        executor: SandboxJobExecutor,
        shutdown_event: Event | None = None,
    ) -> None:
        self.worker_id = worker_id
        self.settings = settings
        self.repository = repository
        self.executor = executor
        self.shutdown_event = shutdown_event or Event()

    def request_shutdown(self) -> None:
        self.shutdown_event.set()

    def _recover_cleanup_pending(self, *, limit: int = 50) -> int:
        recovered = 0
        if self.shutdown_event.is_set():
            return 0
        list_pending = getattr(self.repository, "list_cleanup_pending", None)
        complete_cleanup = getattr(self.repository, "complete_cleanup", None)
        if not callable(list_pending) or not callable(complete_cleanup):
            return 0
        for job in list_pending(limit=limit):
            if self.shutdown_event.is_set():
                break
            try:
                self.executor.abort_job(job)
            except Exception:
                continue
            if complete_cleanup(job_id=job.id, now=datetime.now(timezone.utc)):
                recovered += 1
                self.executor.notify_job_state(job.id)
        return recovered

    def _recover_pending_finalizations(self, *, limit: int = 50) -> int:
        finalized = 0
        list_pending = getattr(self.repository, "list_pending_finalizations", None)
        finalize_job = getattr(self.executor, "finalize_job", None)
        if not callable(list_pending) or not callable(finalize_job):
            return 0
        for job in list_pending(limit=limit):
            if self.shutdown_event.is_set():
                break
            try:
                finalize_job(job)
            except Exception:
                continue
            finalized += 1
            self.executor.notify_job_state(job.id)
        return finalized

    def _fail_disabled_unstarted(self, *, now: datetime, limit: int = 50) -> int:
        fail_unstarted = getattr(self.repository, "fail_unstarted_jobs_for_disabled", None)
        if not callable(fail_unstarted):
            return 0
        rows = list(fail_unstarted(now=now, limit=limit))
        for job in rows:
            self.executor.notify_job_state(job.id)
        return len(rows)

    def run_once(self, *, now: datetime | None = None) -> WorkerCycleResult:
        timestamp = now or datetime.now(timezone.utc)
        self._recover_cleanup_pending(limit=50)
        self._recover_pending_finalizations(limit=50)
        heartbeat_timeout = timedelta(
            seconds=max(300, self.settings.limits.command_timeout_seconds * 2)
        )
        if not self.settings.enabled:
            # Disabling execution is a rollback switch, not permission to
            # abandon durable claims left by a killed worker. Convert stale
            # claims/runs to cleanup-only work; never requeue or execute them.
            self._fail_disabled_unstarted(now=timestamp, limit=50)
            recovered = self.repository.reap_stale_jobs(
                now=timestamp,
                heartbeat_timeout=heartbeat_timeout,
                max_attempts=3,
                limit=50,
                allow_requeue=False,
            )
            for stale_job in recovered:
                self.executor.notify_job_state(stale_job.id)
            self._recover_cleanup_pending(limit=50)
            return WorkerCycleResult(outcome="disabled")
        if self.shutdown_event.is_set():
            return WorkerCycleResult(outcome="stopping")
        self.repository.reap_stale_jobs(
            now=timestamp,
            heartbeat_timeout=heartbeat_timeout,
            max_attempts=3,
            limit=50,
            allow_requeue=True,
        )
        self._recover_cleanup_pending(limit=50)
        if self.shutdown_event.is_set():
            return WorkerCycleResult(outcome="stopping")
        job = self.repository.claim_next_job(worker_id=self.worker_id, now=timestamp)
        if job is None:
            return WorkerCycleResult(outcome="idle")
        deadline_at = job.deadline_at if job.deadline_at.tzinfo is not None else job.deadline_at.replace(tzinfo=timezone.utc)
        if deadline_at <= timestamp:
            self.repository.fail_job(
                job_id=job.id,
                worker_id=self.worker_id,
                error_code="deadline_expired",
                now=timestamp,
            )
            self.executor.notify_job_state(job.id)
            return WorkerCycleResult(claimed_job_id=job.id, outcome="expired")

        if not self.repository.mark_job_running(job_id=job.id, worker_id=self.worker_id, now=timestamp):
            return WorkerCycleResult(claimed_job_id=job.id, outcome="cancelled_before_start")
        self.executor.notify_job_state(job.id)

        heartbeat_stop = Event()

        def _heartbeat() -> None:
            while not heartbeat_stop.wait(timeout=30.0) and not self.shutdown_event.is_set():
                self.repository.heartbeat_job(
                    job_id=job.id,
                    worker_id=self.worker_id,
                    now=datetime.now(timezone.utc),
                )

        heartbeat_thread = Thread(target=_heartbeat, name=f"sandbox-heartbeat-{job.id[:8]}", daemon=True)
        heartbeat_thread.start()
        try:
            result = self.executor.execute(
                job,
                command_timeout_seconds=self.settings.limits.command_timeout_seconds,
                response_timeout_seconds=self.settings.limits.response_timeout_seconds,
            )
        except SandboxExecutionCancelled:
            current = self.repository.get_job_for_user(job_id=job.id, user_id=job.user_id)
            terminal = "cancelled" if current and current.cleanup_terminal_status == "cancelled" else "failed"
            self.repository.mark_cleanup_pending(
                job_id=job.id,
                worker_id=self.worker_id,
                terminal_status=terminal,
                error_code="worker_shutdown" if self.shutdown_event.is_set() else "user_cancelled",
                now=datetime.now(timezone.utc),
            )
            self._recover_cleanup_pending(limit=50)
            self.executor.notify_job_state(job.id)
            return WorkerCycleResult(
                claimed_job_id=job.id,
                outcome="stopping" if self.shutdown_event.is_set() else "cancelled",
            )
        except Exception:
            self.repository.mark_cleanup_pending(
                job_id=job.id,
                worker_id=self.worker_id,
                terminal_status="failed",
                error_code="sandbox_execution_failed",
                now=datetime.now(timezone.utc),
            )
            self._recover_cleanup_pending(limit=50)
            self.executor.notify_job_state(job.id)
            return WorkerCycleResult(claimed_job_id=job.id, outcome="failed")
        finally:
            heartbeat_stop.set()
            heartbeat_thread.join(timeout=1.0)

        if self.shutdown_event.is_set():
            self.repository.mark_cleanup_pending(
                job_id=job.id,
                worker_id=self.worker_id,
                terminal_status="failed",
                error_code="worker_shutdown",
                now=datetime.now(timezone.utc),
            )
            self._recover_cleanup_pending(limit=50)
            self.executor.notify_job_state(job.id)
            return WorkerCycleResult(claimed_job_id=job.id, outcome="stopping")

        finalizing = self.repository.begin_job_finalization(
            job_id=job.id,
            worker_id=self.worker_id,
            result=result,
            now=datetime.now(timezone.utc),
        )
        if not finalizing:
            current = self.repository.get_job_for_user(job_id=job.id, user_id=job.user_id)
            if current is not None and current.status in {
                SandboxJobStatus.CANCELLED,
                SandboxJobStatus.CLEANUP_PENDING,
            }:
                self._recover_cleanup_pending(limit=50)
                return WorkerCycleResult(claimed_job_id=job.id, outcome="cancelled")
            return WorkerCycleResult(claimed_job_id=job.id, outcome="lost_claim")
        current = self.repository.get_job_for_user(job_id=job.id, user_id=job.user_id)
        if current is None:
            return WorkerCycleResult(claimed_job_id=job.id, outcome="lost_claim")
        try:
            self.executor.finalize_job(current)
        except Exception:
            self.executor.notify_job_state(job.id)
            return WorkerCycleResult(claimed_job_id=job.id, outcome="finalizing")
        terminal = self.repository.get_job_for_user(job_id=job.id, user_id=job.user_id)
        if terminal is None or terminal.status is not SandboxJobStatus.SUCCEEDED:
            self.executor.notify_job_state(job.id)
            return WorkerCycleResult(claimed_job_id=job.id, outcome="finalizing")
        self.executor.notify_job_state(job.id)
        return WorkerCycleResult(claimed_job_id=job.id, outcome="succeeded")

    def purge_expired_once(self, *, now: datetime | None = None, limit: int = 50) -> int:
        if self.shutdown_event.is_set() or not getattr(self.settings, "retention_enabled", True):
            return 0
        timestamp = now or datetime.now(timezone.utc)
        purged = 0
        recover_stale = getattr(self.repository, "recover_stale_purging_sessions", None)
        stale_sessions: list[SandboxSessionRecord] = []
        if callable(recover_stale):
            try:
                stale_sessions = list(
                    recover_stale(
                        now=timestamp,
                        stale_after=timedelta(minutes=5),
                        limit=max(1, min(limit, 200)),
                    )
                )
            except Exception:
                # Retention is periodic and must not terminate the execution
                # worker because PostgreSQL is transiently unavailable.
                return 0
        try:
            remaining = max(0, max(1, min(limit, 200)) - len(stale_sessions))
            expired_sessions = self.repository.list_expired_sessions(
                now=timestamp,
                limit=max(1, remaining),
            ) if remaining else []
        except Exception:
            return 0
        for session in [*stale_sessions, *expired_sessions]:
            if self.shutdown_event.is_set():
                break
            claimed = session
            if session.status is not SandboxSessionStatus.PURGING:
                try:
                    claimed = self.repository.mark_session_for_purge(
                        session_id=session.id,
                        expected_last_activity_at=session.last_activity_at,
                        now=timestamp,
                    )
                except Exception:
                    continue
                if claimed is None:
                    continue
            if not claimed.purge_token:
                continue
            try:
                self.executor.purge_session(claimed)
            except Exception:
                # Keep the durable purge token. A later pass can only retry its
                # detached tombstone and can never reopen the fixed key.
                continue
            try:
                marked_purged = self.repository.mark_session_purged(
                    session_id=claimed.id,
                    purge_token=claimed.purge_token,
                    now=datetime.now(timezone.utc),
                )
            except Exception:
                continue
            if marked_purged:
                purged += 1
        return purged
