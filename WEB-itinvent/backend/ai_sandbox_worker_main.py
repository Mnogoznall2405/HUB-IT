"""Process entrypoint for the dedicated Linux OpenCode sandbox worker VM."""
from __future__ import annotations

import argparse
import logging
import os
import signal
import threading
import time
from dataclasses import replace
from pathlib import Path

from backend.ai_sandbox.config import SandboxSettings
from backend.ai_sandbox.executor import (
    ConcreteSandboxJobExecutor,
    ExternalQuotaVerifier,
    FilesystemWorkspaceProvisioner,
)
from backend.ai_sandbox.gateway import SqlAlchemyGatewayAccessBroker
from backend.ai_sandbox.runtime import PodmanProcessRunner
from backend.ai_sandbox.sqlalchemy_repository import SqlAlchemySandboxQueueRepository
from backend.ai_sandbox.transfer import SandboxTransferCredentials
from backend.ai_sandbox.worker import AiSandboxWorker


logger = logging.getLogger("hub.ai_sandbox.worker")


def build_worker(*, worker_id: str, shutdown_event: threading.Event, cleanup_only: bool = False) -> AiSandboxWorker:
    settings = SandboxSettings.from_env()
    settings.validate(require_runtime_files=True)
    settings.validate_cleanup_runtime()
    settings.validate_worker_control()
    if cleanup_only:
        settings = replace(settings, enabled=False)
    quota_helper = Path(str(os.getenv("AI_SANDBOX_QUOTA_HELPER", "") or ""))
    if not quota_helper.is_absolute():
        raise RuntimeError("AI_SANDBOX_QUOTA_HELPER must be an absolute root-owned verifier")
    repository = SqlAlchemySandboxQueueRepository()
    provisioner = FilesystemWorkspaceProvisioner(
        settings=settings,
        quota_verifier=ExternalQuotaVerifier(quota_helper),
    )
    executor = ConcreteSandboxJobExecutor(
        settings=settings,
        repository=repository,
        workspace_provisioner=provisioner,
        runtime_runner=PodmanProcessRunner(podman_binary=settings.podman_binary),
        gateway_broker=SqlAlchemyGatewayAccessBroker(),
        # Retention/rollback mode still drains durable finalizing jobs, so the
        # internal service credential remains required even when new execution
        # is disabled.
        transfer_credentials=SandboxTransferCredentials.from_env(),
        shutdown_event=shutdown_event,
    )
    return AiSandboxWorker(
        worker_id=worker_id,
        settings=settings,
        repository=repository,
        executor=executor,
        shutdown_event=shutdown_event,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="HUB isolated OpenCode worker")
    parser.add_argument("--worker-id", default=f"sandbox-{os.getpid()}")
    parser.add_argument("--poll-seconds", type=float, default=1.0)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--cleanup-only", action="store_true")
    args = parser.parse_args(argv)
    if not (0.1 <= float(args.poll_seconds) <= 30.0):
        parser.error("--poll-seconds must be between 0.1 and 30")

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    stop_event = threading.Event()
    worker = build_worker(
        worker_id=str(args.worker_id)[:128],
        shutdown_event=stop_event,
        cleanup_only=bool(args.cleanup_only),
    )

    def _stop(_signum, _frame) -> None:
        worker.request_shutdown()

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    last_purge = 0.0
    while not stop_event.is_set():
        result = worker.run_once()
        now = time.monotonic()
        if not stop_event.is_set() and now - last_purge >= 60.0:
            worker.purge_expired_once(limit=20)
            last_purge = now
        if args.once:
            logger.info("sandbox worker cycle outcome=%s", result.outcome)
            return 0
        if result.outcome in {"idle", "disabled", "stopping"}:
            stop_event.wait(timeout=float(args.poll_seconds))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
