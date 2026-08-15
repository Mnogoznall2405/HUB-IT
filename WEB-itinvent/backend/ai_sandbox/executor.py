"""Concrete rootless-Podman OpenCode job executor for the dedicated Linux VM."""
from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import re
import shutil
import stat
import subprocess
import time
import zipfile
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
from queue import Empty, Full, Queue
from threading import Event, Thread
from typing import Any, Callable, Mapping
from uuid import NAMESPACE_URL, uuid5

from .config import SandboxSettings
from .contracts import (
    PermissionGrantScope,
    SandboxExecutionCancelled,
    SandboxJobRecord,
    SandboxJobStatus,
    SandboxSessionRecord,
    WorkspaceLease,
)
from .control import OpenCodeControlError, OpenCodeHttpControlClient, permission_response_payload
from .gateway import SqlAlchemyGatewayAccessBroker
from .paths import inspect_archive, inspect_workspace_tree, resolve_workspace_path, validate_workspace_lease
from .repository import SandboxQueueRepository
from .runtime import (
    PodmanArgvBuilder,
    PodmanProcessRunner,
    generate_basic_auth_credentials,
    legacy_sandbox_container_name,
    remove_secret_env_file,
    sandbox_container_name,
    write_secret_env_file,
)
from .transfer import SandboxContentTransferClient, SandboxTransferCredentials
from .worker_control import SandboxWorkerControlClient


_WORKSPACE_KEY_RE = re.compile(r"^ws-[0-9a-f]{32}$")
_PURGE_TOKEN_RE = re.compile(r"^[0-9a-f]{32}$")
_INTERNAL_ROOTS = frozenset({".hub-opencode", ".hub-exports"})


class SandboxExecutorError(RuntimeError):
    pass


class ExternalQuotaVerifier:
    """Invoke a fixed root-owned verifier without a shell.

    The helper is an operations boundary: it must verify an already enforced
    XFS/ext4 project quota and print exactly ``verified:<bytes>``. Merely
    checking free space or a writable marker is intentionally insufficient.
    """

    def __init__(self, executable: Path) -> None:
        self.executable = executable

    def __call__(self, workspace: Path, quota_bytes: int) -> bool:
        helper = self.executable.resolve(strict=True)
        helper_stat = helper.stat()
        if not helper.is_absolute() or not stat.S_ISREG(helper_stat.st_mode):
            return False
        if os.name == "posix" and (helper_stat.st_uid != 0 or helper_stat.st_mode & 0o022):
            return False
        try:
            completed = subprocess.run(
                [str(helper), "verify", str(workspace), str(int(quota_bytes))],
                shell=False,
                check=True,
                capture_output=True,
                text=True,
                timeout=10,
                env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C"},
            )
        except (OSError, subprocess.SubprocessError):
            return False
        return completed.stdout.strip() == f"verified:{int(quota_bytes)}"


class FilesystemWorkspaceProvisioner:
    def __init__(
        self,
        *,
        settings: SandboxSettings,
        quota_verifier: Callable[[Path, int], bool],
    ) -> None:
        self.settings = settings
        self.quota_verifier = quota_verifier

    def provision(self, session: SandboxSessionRecord) -> WorkspaceLease:
        if not _WORKSPACE_KEY_RE.fullmatch(str(session.workspace_key or "")):
            raise SandboxExecutorError("Invalid sandbox workspace key")
        root = self.settings.workspace_root
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if root.is_symlink():
            raise SandboxExecutorError("Sandbox workspace root is a symlink")
        workspace = root / session.workspace_key
        workspace.mkdir(mode=0o700, exist_ok=True)
        if workspace.is_symlink():
            raise SandboxExecutorError("Sandbox workspace is a symlink")
        quota = int(self.settings.limits.workspace_bytes)
        verified = bool(self.quota_verifier(workspace.resolve(strict=True), quota))
        lease = WorkspaceLease(
            session_id=session.id,
            path=workspace,
            quota_bytes=quota,
            quota_verified=verified,
        )
        validate_workspace_lease(
            lease,
            workspace_root=root,
            forbidden_roots=(*self.settings.forbidden_roots, self.settings.hub_code_root),
            maximum_quota_bytes=quota,
        )
        return lease

    def purge(self, session: SandboxSessionRecord) -> None:
        if not _WORKSPACE_KEY_RE.fullmatch(str(session.workspace_key or "")):
            raise SandboxExecutorError("Invalid sandbox workspace key")
        purge_token = str(session.purge_token or "")
        if not _PURGE_TOKEN_RE.fullmatch(purge_token):
            raise SandboxExecutorError("Sandbox purge has no valid fencing token")
        root_path = self.settings.workspace_root
        root_path.mkdir(mode=0o700, parents=True, exist_ok=True)
        if root_path.is_symlink():
            raise SandboxExecutorError("Sandbox workspace root is a symlink")
        root = root_path.resolve(strict=True)
        target = root / session.workspace_key
        session_hash = hashlib.sha256(str(session.id).encode("utf-8")).hexdigest()[:16]
        tombstone = root / f".purge-{session_hash}-{purge_token}"
        if target == root or root not in target.parents or root not in tombstone.parents:
            raise SandboxExecutorError("Refusing to purge an unsafe workspace path")
        if tombstone.is_symlink() or target.is_symlink():
            raise SandboxExecutorError("Refusing to purge a symlinked workspace")

        # Detach the fixed conversation key before the potentially slow tree
        # deletion. A resurrected session may safely recreate ``target`` while
        # this worker remains fenced to its immutable token-scoped tombstone.
        if not tombstone.exists() and target.exists():
            try:
                self._atomic_detach(target, tombstone)
            except FileNotFoundError:
                # Another worker with the same durable purge token won the
                # rename race. It is safe to continue with the tombstone.
                pass
            except FileExistsError:
                pass
        if tombstone.exists():
            try:
                self._delete_tombstone(tombstone)
            except FileNotFoundError:
                # Concurrent idempotent purge of the same tombstone completed.
                pass

    @staticmethod
    def _atomic_detach(source: Path, tombstone: Path) -> None:
        os.rename(source, tombstone)

    @staticmethod
    def _delete_tombstone(path: Path) -> None:
        shutil.rmtree(path)


@dataclass(frozen=True)
class _FileFingerprint:
    size_bytes: int
    sha256: str


class ConcreteSandboxJobExecutor:
    def __init__(
        self,
        *,
        settings: SandboxSettings,
        repository: SandboxQueueRepository,
        workspace_provisioner: FilesystemWorkspaceProvisioner,
        runtime_runner: PodmanProcessRunner,
        gateway_broker: SqlAlchemyGatewayAccessBroker,
        transfer_credentials: SandboxTransferCredentials | None,
        control_client_factory: Callable[..., OpenCodeHttpControlClient] = OpenCodeHttpControlClient,
        shutdown_event: Event | None = None,
    ) -> None:
        self.settings = settings
        self.repository = repository
        self.workspace_provisioner = workspace_provisioner
        self.runtime_runner = runtime_runner
        self.gateway_broker = gateway_broker
        self.transfer_credentials = transfer_credentials
        self.control_client_factory = control_client_factory
        self.shutdown_event = shutdown_event or Event()

    def execute(
        self,
        job: SandboxJobRecord,
        *,
        command_timeout_seconds: int,
        response_timeout_seconds: int,
    ) -> dict:
        self.settings.validate(require_runtime_files=True)
        if self.transfer_credentials is None:
            raise SandboxExecutorError("Sandbox worker control credentials are unavailable")
        self._raise_if_shutdown()
        session = self.repository.get_session_for_user(job.session_id, job.user_id)
        if session is None or session.conversation_id != job.conversation_id:
            raise SandboxExecutorError("Sandbox session/job ownership mismatch")
        lease = self.workspace_provisioner.provision(session)
        workspace = lease.path.resolve(strict=True)

        with ExitStack() as stack:
            transfer = stack.enter_context(
                SandboxContentTransferClient(
                    settings=self.settings,
                    credentials=self.transfer_credentials,
                )
            )
            worker_control = stack.enter_context(
                SandboxWorkerControlClient(
                    settings=self.settings,
                    credentials=self.transfer_credentials,
                )
            )
            manifest = transfer.fetch_manifest(job_id=job.id)
            self._raise_if_shutdown()
            if manifest.job_id != job.id or manifest.conversation_id != job.conversation_id:
                raise SandboxExecutorError("Sandbox manifest scope mismatch")
            input_paths = []
            for item in manifest.inputs:
                self._raise_if_shutdown()
                input_paths.append(transfer.download_input(grant=item, workspace=workspace))
            self._raise_if_shutdown()
            inspect_workspace_tree(workspace, maximum_bytes=self.settings.limits.workspace_bytes)

            if manifest.job_type == "archive":
                return self._execute_archive(job, workspace, worker_control, transfer)
            if manifest.job_type == "attach_file":
                return self._execute_attach(job, manifest, workspace, worker_control, transfer)
            if manifest.job_type != "prompt":
                raise SandboxExecutorError("Unsupported sandbox job type")

            baseline = self._snapshot(workspace)
            prompt = manifest.prompt
            if input_paths:
                relative_inputs = [path.relative_to(workspace).as_posix() for path in input_paths]
                prompt += "\n\nVerified attachments are available only inside /workspace:\n" + "\n".join(
                    f"- /workspace/{relative}" for relative in relative_inputs
                )
            session_id, answer, diff = self._execute_prompt_container(
                job=job,
                session=session,
                lease=lease,
                prompt=prompt,
                worker_control=worker_control,
                command_timeout_seconds=command_timeout_seconds,
                response_timeout_seconds=response_timeout_seconds,
            )
            self._raise_if_shutdown()
            inspect_workspace_tree(workspace, maximum_bytes=self.settings.limits.workspace_bytes)
            outputs = self._changed_files(workspace, baseline=baseline, diff=diff)
            return self._deliver_outputs(
                job=job,
                workspace=workspace,
                outputs=outputs,
                opencode_session_id=session_id,
                assistant_markdown=answer or "OpenCode завершил работу.",
                worker_control=worker_control,
                transfer=transfer,
            )

    def _deliver_outputs(
        self,
        *,
        job: SandboxJobRecord,
        workspace: Path,
        outputs: list[dict[str, Any]],
        opencode_session_id: str | None,
        assistant_markdown: str,
        worker_control: SandboxWorkerControlClient,
        transfer: SandboxContentTransferClient,
    ) -> dict[str, Any]:
        """Register, upload, then publish a result in three ordered phases."""

        self._ensure_job_accepts_output(worker_control=worker_control, job_id=job.id)
        recorded = worker_control.record_result(
            job_id=job.id,
            opencode_session_id=opencode_session_id,
            assistant_markdown="",
            files=outputs,
        )
        attached: list[dict[str, Any]] = []
        recorded_files = list(recorded.get("files") or [])
        by_path = {
            str(item.get("path") or ""): item
            for item in recorded_files
            if isinstance(item, dict)
        }
        for output in outputs:
            self._raise_if_shutdown()
            self._ensure_job_accepts_output(worker_control=worker_control, job_id=job.id)
            persisted = by_path.get(output["path"])
            if not persisted or not persisted.get("id"):
                raise SandboxExecutorError("HUB did not persist sandbox output metadata")
            grant = transfer.request_output_grant(job_id=job.id, file_id=str(persisted["id"]))
            source = resolve_workspace_path(workspace, output["path"], must_exist=True)
            attached.append(dict(transfer.upload_output(grant=grant, source=source)))
        self._raise_if_shutdown()
        return {
            "message_id": None,
            "files": recorded_files,
            "attachments": attached,
            "opencode_session_id": opencode_session_id,
            "_pending_finalize": {"assistant_markdown": assistant_markdown},
        }

    def _execute_prompt_container(
        self,
        *,
        job: SandboxJobRecord,
        session: SandboxSessionRecord,
        lease: WorkspaceLease,
        prompt: str,
        worker_control: SandboxWorkerControlClient,
        command_timeout_seconds: int,
        response_timeout_seconds: int,
    ) -> tuple[str, str, list[Mapping[str, object]]]:
        grant = self.gateway_broker.issue(job_id=job.id, session_id=session.id, user_id=job.user_id)
        secret_file: Path | None = None
        spec = None
        container_started = False
        control: OpenCodeHttpControlClient | None = None
        opencode_session_id = session.opencode_session_id
        try:
            credentials = generate_basic_auth_credentials(gateway_bearer_token=grant.token.reveal())
            secret_file = write_secret_env_file(
                settings=self.settings,
                session_id=session.id,
                job_id=job.id,
                user_id=job.user_id,
                credentials=credentials,
            )
            spec = PodmanArgvBuilder(self.settings).build(
                session_id=session.id,
                job_id=job.id,
                workspace=lease,
                secret_env_file=secret_file,
            )
            try:
                self.runtime_runner.start(spec)
                container_started = True
            finally:
                if secret_file is not None:
                    remove_secret_env_file(secret_file)
                    secret_file = None
            control_target = self.runtime_runner.control_target(spec.container_name)
            control = self.control_client_factory(
                control_host=control_target.host,
                control_port=control_target.port,
                username=credentials.username,
                password=credentials.reveal_password(),
                response_timeout_seconds=response_timeout_seconds,
            )
            with control:
                prompt_payload = {
                    "messageID": str(uuid5(NAMESPACE_URL, f"hub-ai-sandbox-prompt:{job.id}")),
                    "parts": [{"type": "text", "text": prompt}],
                }
                if opencode_session_id:
                    try:
                        control.prompt_async(
                            session_id=opencode_session_id,
                            prompt=prompt_payload,
                        )
                    except OpenCodeControlError as exc:
                        if exc.status_code != 404:
                            raise
                        opencode_session_id = None
                if not opencode_session_id:
                    created = control.create_session(startup_timeout_seconds=30)
                    opencode_session_id = str(created.get("id") or "")
                    if not opencode_session_id:
                        raise SandboxExecutorError("OpenCode returned no session id")
                    control.prompt_async(
                        session_id=opencode_session_id,
                        prompt=prompt_payload,
                    )
                answer = self._wait_for_completion(
                    job=job,
                    session=session,
                    opencode_session_id=opencode_session_id,
                    control=control,
                    worker_control=worker_control,
                    command_timeout_seconds=command_timeout_seconds,
                    response_timeout_seconds=response_timeout_seconds,
                )
                diff = control.get_diff(session_id=opencode_session_id)
                return opencode_session_id, answer, diff
        except SandboxExecutionCancelled:
            if control is not None and opencode_session_id:
                try:
                    control.abort(session_id=opencode_session_id)
                except Exception:
                    pass
            raise
        finally:
            try:
                if container_started and spec is not None:
                    self.runtime_runner.stop(spec.container_name)
            finally:
                try:
                    self.gateway_broker.revoke(grant_id=grant.id, job_id=job.id)
                finally:
                    if secret_file is not None:
                        remove_secret_env_file(secret_file)

    def _wait_for_completion(
        self,
        *,
        job: SandboxJobRecord,
        session: SandboxSessionRecord,
        opencode_session_id: str,
        control: OpenCodeHttpControlClient,
        worker_control: SandboxWorkerControlClient,
        command_timeout_seconds: int,
        response_timeout_seconds: int,
    ) -> str:
        deadline = time.monotonic() + max(1, min(int(response_timeout_seconds), 900))
        text_parts: dict[str, str] = {}
        active_tools: dict[str, float] = {}
        event_queue: Queue[Mapping[str, Any]] = Queue(maxsize=1024)
        reader_stop = Event()

        def _read_events() -> None:
            while not reader_stop.is_set():
                try:
                    for incoming in control.events():
                        if reader_stop.is_set():
                            return
                        try:
                            event_queue.put(incoming, timeout=1.0)
                        except Full:
                            return
                    if not reader_stop.is_set():
                        reader_stop.wait(timeout=0.2)
                except Exception:
                    if reader_stop.wait(timeout=0.2):
                        return

        reader = Thread(target=_read_events, name=f"opencode-events-{job.id[:8]}", daemon=True)
        reader.start()
        try:
            while time.monotonic() < deadline:
                self._raise_if_cancelled(job, control=control, opencode_session_id=opencode_session_id)
                self._raise_if_tool_timed_out(
                    active_tools,
                    timeout_seconds=command_timeout_seconds,
                    control=control,
                    opencode_session_id=opencode_session_id,
                )
                try:
                    event = event_queue.get(timeout=0.25)
                except Empty:
                    continue
                event_type = str(event.get("type") or "")
                properties = event.get("properties") if isinstance(event.get("properties"), dict) else {}
                event_session_id = str(properties.get("sessionID") or properties.get("session_id") or "")
                if event_session_id and event_session_id != opencode_session_id:
                    continue
                if event_type in {"permission.asked", "permission.updated", "permission.requested"}:
                    self._handle_permission(
                        job=job,
                        session=session,
                        opencode_session_id=opencode_session_id,
                        properties=properties,
                        control=control,
                        worker_control=worker_control,
                        deadline=deadline,
                    )
                elif event_type == "message.part.updated":
                    part = properties.get("part") if isinstance(properties.get("part"), dict) else properties
                    if str(part.get("type") or "") == "text":
                        part_id = str(part.get("id") or len(text_parts))
                        text_parts[part_id] = str(part.get("text") or properties.get("delta") or "")
                    elif str(part.get("type") or "") == "tool":
                        tool_id = str(part.get("id") or part.get("callID") or "")
                        state = part.get("state") if isinstance(part.get("state"), dict) else {}
                        tool_status = str(state.get("status") or part.get("status") or "").lower()
                        # Waiting for a user card may take the whole response
                        # window. Count the command limit only after execution.
                        if tool_id and tool_status == "running":
                            active_tools.setdefault(tool_id, time.monotonic())
                        elif tool_id and tool_status in {"completed", "error", "failed", "cancelled"}:
                            active_tools.pop(tool_id, None)
                elif event_type == "session.error":
                    raise SandboxExecutorError("OpenCode session failed")
                elif event_type == "session.idle":
                    return "\n".join(value for value in text_parts.values() if value).strip()
            try:
                control.abort(session_id=opencode_session_id)
            except Exception:
                pass
            raise SandboxExecutorError("OpenCode response deadline expired")
        finally:
            reader_stop.set()
            interrupt = getattr(control, "interrupt_events", None)
            if callable(interrupt):
                interrupt()
            reader.join(timeout=2.0)

    @staticmethod
    def _raise_if_tool_timed_out(
        active_tools: Mapping[str, float],
        *,
        timeout_seconds: int,
        control: OpenCodeHttpControlClient,
        opencode_session_id: str,
    ) -> None:
        limit = max(1, min(int(timeout_seconds), 120))
        now = time.monotonic()
        if not any(now - started_at > limit for started_at in active_tools.values()):
            return
        try:
            control.abort(session_id=opencode_session_id)
        except Exception:
            pass
        raise SandboxExecutorError("OpenCode command exceeded the 120-second limit")

    def _handle_permission(
        self,
        *,
        job: SandboxJobRecord,
        session: SandboxSessionRecord,
        opencode_session_id: str,
        properties: Mapping[str, Any],
        control: OpenCodeHttpControlClient,
        worker_control: SandboxWorkerControlClient,
        deadline: float,
    ) -> None:
        permission_value = properties.get("permission")
        nested = permission_value if isinstance(permission_value, dict) else properties
        opencode_permission_id = str(nested.get("id") or properties.get("permissionID") or properties.get("id") or "")
        if not opencode_permission_id:
            raise SandboxExecutorError("OpenCode permission event has no id")
        tool_payload = properties.get("tool") if isinstance(properties.get("tool"), dict) else {}
        tool = str(
            permission_value
            if isinstance(permission_value, str)
            else nested.get("type") or nested.get("tool") or tool_payload.get("name") or "unknown"
        )
        patterns = properties.get("patterns") if isinstance(properties.get("patterns"), list) else []
        operation = str(
            nested.get("title")
            or nested.get("operation")
            or nested.get("pattern")
            or (patterns[0] if patterns else "")
            or tool
        )
        metadata = dict(nested.get("metadata")) if isinstance(nested.get("metadata"), dict) else {}
        tool_input = tool_payload.get("input") if isinstance(tool_payload.get("input"), dict) else {}
        metadata.update({key: value for key, value in tool_input.items() if key not in metadata})
        if tool.strip().lower() == "bash" and not metadata.get("command") and patterns:
            metadata["command"] = str(patterns[0])
        if tool.strip().lower() == "edit" and not metadata.get("path") and patterns:
            metadata["path"] = str(patterns[0])
        permission = worker_control.create_permission(
            job_id=job.id,
            session_id=session.id,
            opencode_permission_id=opencode_permission_id,
            tool=tool,
            operation=operation,
            arguments=metadata,
        )
        while str(permission.get("status") or "") == "pending" and time.monotonic() < deadline:
            self._raise_if_cancelled(job, control=control, opencode_session_id=opencode_session_id)
            time.sleep(0.25)
            permission = worker_control.get_permission(
                job_id=job.id,
                permission_id=str(permission.get("id") or ""),
            )
        approved = str(permission.get("status") or "") == "approved"
        scope = PermissionGrantScope(str(permission.get("scope") or "once")) if approved else PermissionGrantScope.ONCE
        # A stop may win while the last permission poll is in flight. Check
        # the durable job state immediately before answering OpenCode so an
        # already-cancelled edit/bash is never released by a stale response.
        self._raise_if_cancelled(job, control=control, opencode_session_id=opencode_session_id)
        control.answer_permission(
            session_id=opencode_session_id,
            permission_id=opencode_permission_id,
            payload=permission_response_payload(approved=approved, scope=scope),
        )

    def _raise_if_cancelled(
        self,
        job: SandboxJobRecord,
        *,
        control: OpenCodeHttpControlClient,
        opencode_session_id: str,
    ) -> None:
        self._raise_if_shutdown()
        current = self.repository.get_job_for_user(job_id=job.id, user_id=job.user_id)
        if current is None or current.status not in {
            SandboxJobStatus.CANCELLED,
            SandboxJobStatus.CLEANUP_PENDING,
        }:
            return
        try:
            control.abort(session_id=opencode_session_id)
        except Exception:
            pass
        raise SandboxExecutionCancelled("OpenCode job was cancelled")

    def _raise_if_shutdown(self) -> None:
        if self.shutdown_event.is_set():
            raise SandboxExecutionCancelled("OpenCode worker is shutting down")

    def _snapshot(self, workspace: Path) -> dict[str, _FileFingerprint]:
        inspect_workspace_tree(workspace, maximum_bytes=self.settings.limits.workspace_bytes)
        result: dict[str, _FileFingerprint] = {}
        for path in sorted(workspace.rglob("*")):
            relative = path.relative_to(workspace)
            if not relative.parts or relative.parts[0] in _INTERNAL_ROOTS or path.is_dir():
                continue
            path_stat = path.lstat()
            if not stat.S_ISREG(path_stat.st_mode) or path_stat.st_nlink != 1:
                raise SandboxExecutorError("Workspace contains an unsafe file")
            result[relative.as_posix()] = _FileFingerprint(
                size_bytes=int(path_stat.st_size),
                sha256=self._sha256(path),
            )
        return result

    def _changed_files(
        self,
        workspace: Path,
        *,
        baseline: dict[str, _FileFingerprint],
        diff: list[Mapping[str, object]],
    ) -> list[dict[str, Any]]:
        current = self._snapshot(workspace)
        changed = [path for path, fingerprint in current.items() if baseline.get(path) != fingerprint]
        if len(changed) > 5:
            raise SandboxExecutorError("OpenCode produced more than 5 result files")
        diff_by_path: dict[str, str] = {}
        for item in diff:
            path = str(item.get("file") or item.get("path") or "").replace("\\", "/")
            patch = item.get("patch") or item.get("diff")
            if path and patch:
                diff_by_path[path] = str(patch)[:100_000]
        outputs = []
        for relative in changed:
            fingerprint = current[relative]
            outputs.append(
                {
                    "path": relative,
                    "name": Path(relative).name,
                    "kind": "changed" if relative in baseline else "output",
                    "content_type": mimetypes.guess_type(relative)[0] or "application/octet-stream",
                    "size_bytes": fingerprint.size_bytes,
                    "sha256": fingerprint.sha256,
                    "changed": relative in baseline,
                    "diff": diff_by_path.get(relative, ""),
                }
            )
        return outputs

    def _execute_archive(
        self,
        job: SandboxJobRecord,
        workspace: Path,
        worker_control: SandboxWorkerControlClient,
        transfer: SandboxContentTransferClient,
    ) -> dict:
        inspect_workspace_tree(workspace, maximum_bytes=self.settings.limits.workspace_bytes)
        export_dir = workspace / ".hub-exports"
        export_dir.mkdir(mode=0o700, exist_ok=True)
        archive = export_dir / f"workspace-{job.id}.zip"
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(archive, flags, 0o600)
        os.close(descriptor)
        try:
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=False) as output:
                for path in sorted(workspace.rglob("*")):
                    relative = path.relative_to(workspace)
                    if not relative.parts or relative.parts[0] in _INTERNAL_ROOTS or path.is_dir():
                        continue
                    path_stat = path.lstat()
                    if not stat.S_ISREG(path_stat.st_mode) or path_stat.st_nlink != 1:
                        raise SandboxExecutorError("Workspace archive contains an unsafe file")
                    output.write(path, arcname=relative.as_posix())
            inspect_archive(archive)
            metadata = {
                "path": archive.relative_to(workspace).as_posix(),
                "name": archive.name,
                "kind": "archive",
                "content_type": "application/zip",
                "size_bytes": archive.stat().st_size,
                "sha256": self._sha256(archive),
                "changed": False,
                "diff": "",
            }
            return self._deliver_outputs(
                job=job,
                workspace=workspace,
                outputs=[metadata],
                opencode_session_id=None,
                assistant_markdown="",
                worker_control=worker_control,
                transfer=transfer,
            )
        except Exception:
            archive.unlink(missing_ok=True)
            raise

    def _execute_attach(
        self,
        job,
        manifest,
        workspace: Path,
        worker_control: SandboxWorkerControlClient,
        transfer: SandboxContentTransferClient,
    ) -> dict:
        self._raise_if_shutdown()
        target = getattr(manifest, "target_file", None)
        if not isinstance(target, Mapping):
            raise SandboxExecutorError("Sandbox attach manifest has no target file")
        source = resolve_workspace_path(workspace, str(target.get("path") or ""), must_exist=True)
        source_stat = source.lstat()
        if not stat.S_ISREG(source_stat.st_mode) or source_stat.st_nlink != 1:
            raise SandboxExecutorError("Sandbox attach target is unsafe")
        if int(source_stat.st_size) != int(target.get("size_bytes") or -1):
            raise SandboxExecutorError("Sandbox attach target size changed")
        if self._sha256(source) != str(target.get("sha256") or ""):
            raise SandboxExecutorError("Sandbox attach target hash changed")
        self._ensure_job_accepts_output(worker_control=worker_control, job_id=job.id)
        grant = transfer.request_output_grant(job_id=job.id, file_id=str(manifest.target_file_id or ""))
        attached = transfer.upload_output(grant=grant, source=source)
        self._raise_if_shutdown()
        return {
            "attachments": [dict(attached)],
            "target_file_id": manifest.target_file_id,
            "_pending_finalize": {"assistant_markdown": ""},
        }

    def finalize_job(self, job: SandboxJobRecord) -> None:
        if job.status is not SandboxJobStatus.FINALIZING or job.finalization_state != "pending":
            return
        if self.transfer_credentials is None:
            raise SandboxExecutorError("Sandbox worker control credentials are unavailable")
        with SandboxWorkerControlClient(
            settings=self.settings,
            credentials=self.transfer_credentials,
        ) as client:
            # The HUB uses the markdown stored by the durable finalizing CAS;
            # a retrying worker cannot replace it through this request.
            client.finalize_result(job_id=job.id, assistant_markdown="")

    def abort_job(self, job: SandboxJobRecord) -> None:
        try:
            self.runtime_runner.stop(
                sandbox_container_name(session_id=job.session_id, job_id=job.id)
            )
        finally:
            self.gateway_broker.revoke_job(job_id=job.id)

    @staticmethod
    def _ensure_job_accepts_output(
        *,
        worker_control: SandboxWorkerControlClient,
        job_id: str,
    ) -> None:
        state = worker_control.get_job_state(job_id=job_id)
        status = str(state.get("status") or "")
        if status not in {"claimed", "running", "waiting_permission"}:
            raise SandboxExecutionCancelled("Sandbox job no longer accepts output delivery")

    def notify_job_state(self, job_id: str) -> None:
        try:
            with SandboxWorkerControlClient(
                settings=self.settings,
                credentials=self.transfer_credentials,
            ) as client:
                client.publish_status(job_id=job_id)
        except Exception:
            # Queue state is durable; realtime is retried by UI polling/reconnect.
            return

    def purge_session(self, session: SandboxSessionRecord) -> None:
        # A retained pre-fencing container has the legacy session-only name.
        # Current containers are job-scoped and were verified absent before
        # their job left cleanup_pending.
        self.runtime_runner.stop(legacy_sandbox_container_name(session_id=session.id))
        self.workspace_provisioner.purge(session)

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
        return digest.hexdigest()
