from __future__ import annotations

import hashlib
import hmac
import json
import stat
from datetime import datetime, timedelta, timezone
from pathlib import Path
from pathlib import PurePosixPath
from typing import Any, Mapping
from uuid import NAMESPACE_URL, uuid4, uuid5

from fastapi import UploadFile
from sqlalchemy import select, update

from backend.appdb.db import app_session, ensure_app_schema_initialized
from backend.appdb.models import AppAiBot, AppAiBotConversation, AppAiPendingAction
from backend.chat.service import chat_service
from backend.services.my_files_antivirus_service import scan_my_file
from backend.services.authorization_service import PERM_CHAT_AI_SANDBOX

from .config import SandboxConfigurationError, SandboxSettings
from .contracts import (
    PermissionDisposition,
    PermissionGrantScope,
    PermissionRequest,
    SandboxAttachmentReference,
    SandboxJobRecord,
    SandboxJobStatus,
    VerifiedAttachmentInput,
)
from .models import (
    AppAiSandboxFile,
    AppAiSandboxJob,
    AppAiSandboxPermission,
    AppAiSandboxSession,
    AppAiSandboxTransferGrant,
)
from .paths import inspect_archive, inspect_archive_if_present, normalize_upload_name
from .policy import OpenCodePermissionPolicy
from .redaction import redact_preview, redact_text
from .service import AiSandboxService, EnqueueSandboxRun, SandboxDisabledError
from .sqlalchemy_repository import (
    ACTIVE_JOB_STATUSES,
    SandboxRepositoryConflict,
    SqlAlchemySandboxQueueRepository,
)
from .transfer import OneTimeTransferToken


SANDBOX_ACTION_TYPE = "ai.sandbox.permission"
SANDBOX_REALTIME_EVENT = "chat.ai.sandbox.updated"
MAX_INPUT_ATTACHMENT_BYTES = 256 * 1024**2
MAX_DIFF_CHARS_PER_FILE = 100_000
MAX_DIFF_CHARS_TOTAL = 300_000
TRANSFER_GRANT_TTL = timedelta(minutes=2)
MAX_SANDBOX_OUTPUT_FILES = 5
MAX_SANDBOX_OUTPUT_BYTES = 1024**3


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _aware_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _json_loads(value: object, fallback: Any) -> Any:
    try:
        return json.loads(str(value or ""))
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


def _json_dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _validate_output_manifest_union(
    *,
    existing_sizes: Mapping[str, int],
    incoming_files: list[Mapping[str, Any]],
) -> dict[str, int]:
    """Return the bounded cumulative output manifest for one locked job.

    Internal result delivery is retryable, so validating only the current
    request would allow disjoint retries to accumulate more than five files.
    The caller holds the job row lock while applying this invariant.
    """

    union_sizes = {str(path): int(size) for path, size in existing_sizes.items()}
    for item in incoming_files:
        union_sizes[str(item["path"])] = int(item["size_bytes"])
    if len(union_sizes) > MAX_SANDBOX_OUTPUT_FILES:
        raise ValueError("OpenCode may register at most 5 result files per run")
    if sum(union_sizes.values()) > MAX_SANDBOX_OUTPUT_BYTES:
        raise ValueError("OpenCode result files exceed the 1 GiB run limit")
    return union_sizes


class ChatSandboxAttachmentVerifier:
    """Fail-closed ownership and antivirus check in the background queue path."""

    def verify_for_sandbox(
        self,
        *,
        reference: SandboxAttachmentReference,
        user_id: int,
        conversation_id: str,
    ) -> VerifiedAttachmentInput:
        message = chat_service.get_message(current_user_id=int(user_id), message_id=reference.message_id)
        if str(message.get("conversation_id") or "") != str(conversation_id):
            raise PermissionError("Attachment message does not belong to the sandbox conversation")
        attachment_payload = next(
            (
                item
                for item in list(message.get("attachments") or [])
                if str(item.get("id") or "") == reference.attachment_id
            ),
            None,
        )
        if attachment_payload is None:
            raise PermissionError("Attachment does not belong to the trigger message")

        download = chat_service.get_attachment_for_download(
            current_user_id=int(user_id),
            message_id=reference.message_id,
            attachment_id=reference.attachment_id,
        )
        source = Path(str(download.get("path") or "")).resolve(strict=True)
        source_stat = source.lstat()
        if source.is_symlink() or not source.is_file():
            raise PermissionError("Sandbox input must be a regular non-symlink file")
        if not (0 <= int(source_stat.st_size) <= MAX_INPUT_ATTACHMENT_BYTES):
            raise ValueError("Sandbox input attachment exceeds 256 MiB")

        scan_result = scan_my_file(source)
        if str(scan_result.status or "").strip().lower() != "clean":
            raise PermissionError("Sandbox input was not accepted by antivirus")
        inspect_archive_if_present(source)

        digest = hashlib.sha256()
        with source.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
        return VerifiedAttachmentInput(
            attachment_id=reference.attachment_id,
            message_id=reference.message_id,
            normalized_name=normalize_upload_name(str(download.get("file_name") or attachment_payload.get("file_name") or "input.bin")),
            size_bytes=int(source_stat.st_size),
            content_type=str(download.get("mime_type") or "application/octet-stream")[:255],
            sha256=digest.hexdigest(),
        )


class AiSandboxAppService:
    def __init__(self) -> None:
        self.repository = SqlAlchemySandboxQueueRepository()
        self.policy = OpenCodePermissionPolicy()

    def settings(self) -> SandboxSettings:
        return SandboxSettings.from_env()

    def ensure_opencode_bot(self, *, ai_service: Any) -> dict[str, Any] | None:
        """Seed the pinned bot only when the complete sandbox config validates."""

        try:
            settings = self.settings()
            if settings.enabled:
                # Chat host does not need Podman/seccomp files, but every shared
                # isolation and authenticated-transfer setting must validate
                # before the bot can become visible.
                settings.validate(require_runtime_files=False)
        except SandboxConfigurationError:
            # A stale previously-enabled catalog row must become hidden even if
            # an operator turns the flag on with incomplete/unsafe settings.
            settings = SandboxSettings(enabled=False)
        ensure_app_schema_initialized()
        now = _utc_now()
        with app_session() as db:
            bot = db.execute(select(AppAiBot).where(AppAiBot.slug == "opencode")).scalar_one_or_none()
            if bot is None:
                bot = AppAiBot(
                    id=str(uuid4()),
                    slug="opencode",
                    title="OpenCode",
                    description="Изолированная рабочая область для кода и файлов",
                    system_prompt=(
                        "Работайте только внутри /workspace. Не запрашивайте внешнюю сеть, "
                        "пакетные менеджеры, внешние каталоги или Git-операции."
                    ),
                    model="",
                    temperature=0.1,
                    max_tokens=4000,
                    allowed_kb_scope_json="[]",
                    enabled_tools_json="[]",
                    tool_settings_json="{}",
                    allow_file_input=True,
                    allow_generated_artifacts=True,
                    allow_kb_document_delivery=False,
                    surface="sandbox",
                    placement="pinned",
                    sort_order=40,
                    required_permission=PERM_CHAT_AI_SANDBOX,
                    use_personal_memory=False,
                    is_enabled=bool(settings.enabled),
                    created_at=now,
                    updated_at=now,
                )
                db.add(bot)
                db.flush()
            else:
                bot.surface = "sandbox"
                bot.placement = "pinned"
                bot.sort_order = 40
                bot.required_permission = PERM_CHAT_AI_SANDBOX
                bot.use_personal_memory = False
                bot.allow_file_input = True
                bot.allow_generated_artifacts = True
                bot.is_enabled = bool(settings.enabled)
                bot.updated_at = now
            ai_service._ensure_bot_user(session=db, bot=bot)
            return ai_service._serialize_bot(bot, admin=True)

    def ensure_enabled(self) -> SandboxSettings:
        settings = self.settings()
        if not settings.enabled:
            raise SandboxDisabledError("OpenCode sandbox is disabled")
        return settings

    def _require_conversation(
        self,
        *,
        conversation_id: str,
        user_id: int,
        require_enabled: bool = True,
    ) -> tuple[AppAiBot, AppAiBotConversation]:
        ensure_app_schema_initialized()
        with app_session() as db:
            return self._require_conversation_in_session(
                db,
                conversation_id=conversation_id,
                user_id=user_id,
                require_enabled=require_enabled,
            )

    @staticmethod
    def _require_conversation_in_session(
        db: Any,
        *,
        conversation_id: str,
        user_id: int,
        require_enabled: bool = True,
    ) -> tuple[AppAiBot, AppAiBotConversation]:
        mapping = db.execute(
            select(AppAiBotConversation).where(
                AppAiBotConversation.conversation_id == str(conversation_id),
                AppAiBotConversation.user_id == int(user_id),
            )
        ).scalar_one_or_none()
        if mapping is None:
            raise LookupError("OpenCode conversation was not found")
        bot = db.get(AppAiBot, mapping.bot_id)
        if bot is None or str(getattr(bot, "surface", "") or "").strip().lower() != "sandbox":
            raise LookupError("Conversation is not an OpenCode sandbox")
        if (
            (require_enabled and not bool(bot.is_enabled))
            or str(getattr(bot, "required_permission", "") or "") != PERM_CHAT_AI_SANDBOX
        ):
            raise PermissionError("OpenCode bot is not available")
        return bot, mapping

    def enqueue_message(
        self,
        *,
        conversation_id: str,
        trigger_message_id: str,
        current_user_id: int,
    ) -> dict[str, Any]:
        settings = self.ensure_enabled()
        bot, _ = self._require_conversation(
            conversation_id=conversation_id,
            user_id=current_user_id,
        )
        message = chat_service.get_message(
            current_user_id=int(current_user_id),
            message_id=trigger_message_id,
        )
        if str(message.get("conversation_id") or "") != str(conversation_id):
            raise PermissionError("Trigger message does not belong to this OpenCode conversation")
        references = tuple(
            SandboxAttachmentReference(
                attachment_id=str(item.get("id") or ""),
                message_id=str(trigger_message_id),
            )
            for item in list(message.get("attachments") or [])
            if str(item.get("id") or "")
        )
        service = AiSandboxService(
            settings=settings,
            repository=self.repository,
            attachment_verifier=ChatSandboxAttachmentVerifier(),
        )
        queued = service.enqueue(
            EnqueueSandboxRun(
                conversation_id=str(conversation_id),
                user_id=int(current_user_id),
                prompt_message_id=str(trigger_message_id),
                attachments=references,
            )
        )
        payload = {
            "id": queued.id,
            "run_id": queued.id,
            "bot_id": bot.id,
            "bot_title": bot.title,
            "conversation_id": str(conversation_id),
            "user_id": int(current_user_id),
            "trigger_message_id": str(trigger_message_id),
            "status": "queued" if queued.status.value == "preparing" else queued.status.value,
            "stage": "preparing" if queued.status.value == "preparing" else "queued",
            "status_text": "Запрос OpenCode поставлен в очередь",
            "error_text": None,
            "updated_at": _iso(_utc_now()),
        }
        self._publish_update(
            conversation_id=str(conversation_id),
            user_id=int(current_user_id),
            change="job",
            payload=payload,
        )
        return payload

    def get_status(self, *, conversation_id: str, current_user_id: int) -> dict[str, Any]:
        # Existing jobs remain observable during rollback so the cleanup-only
        # worker and UI can converge instead of hiding an active claim.
        bot, _ = self._require_conversation(
            conversation_id=conversation_id,
            user_id=current_user_id,
            require_enabled=False,
        )
        with app_session() as db:
            job = db.execute(
                select(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.conversation_id == str(conversation_id),
                    AppAiSandboxJob.user_id == int(current_user_id),
                )
                .order_by(AppAiSandboxJob.created_at.desc())
                .limit(1)
            ).scalar_one_or_none()
        if job is None:
            return {
                "conversation_id": str(conversation_id),
                "bot_id": bot.id,
                "bot_title": bot.title,
                "status": None,
                "stage": None,
                "status_text": None,
                "run_id": None,
                "error_text": None,
                "updated_at": None,
            }
        return self._status_payload(bot=bot, job=job)

    def cancel_conversation(self, *, conversation_id: str, current_user_id: int) -> dict[str, Any]:
        # Feature-off blocks new execution, but must not prevent the owner from
        # cancelling already-durable work left by a crashed worker.
        bot, _ = self._require_conversation(
            conversation_id=conversation_id,
            user_id=current_user_id,
            require_enabled=False,
        )
        with app_session() as db:
            job = db.execute(
                select(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.conversation_id == str(conversation_id),
                    AppAiSandboxJob.user_id == int(current_user_id),
                    AppAiSandboxJob.status.in_(ACTIVE_JOB_STATUSES),
                )
                .order_by(AppAiSandboxJob.created_at.desc())
                .limit(1)
            ).scalar_one_or_none()
        if job is None:
            return self.get_status(conversation_id=conversation_id, current_user_id=current_user_id)
        self.repository.cancel_job(job_id=job.id, user_id=int(current_user_id), now=_utc_now())
        with app_session() as db:
            current = db.get(AppAiSandboxJob, job.id)
            payload = self._status_payload(bot=bot, job=current or job)
        self._publish_update(
            conversation_id=str(conversation_id),
            user_id=int(current_user_id),
            change="job",
            payload=payload,
        )
        return payload

    def retire_conversation(self, *, conversation_id: str, current_user_id: int) -> None:
        """Cancel work and make the workspace immediately retention-eligible.

        This remains available while the feature flag is off so users can
        still delete old OpenCode chats without leaving an orphan workspace.
        """

        now = _utc_now()
        with app_session() as db:
            mapping = db.execute(
                select(AppAiBotConversation).where(
                    AppAiBotConversation.conversation_id == str(conversation_id),
                    AppAiBotConversation.user_id == int(current_user_id),
                )
            ).scalar_one_or_none()
            if mapping is None:
                raise LookupError("OpenCode conversation was not found")
            bot = db.get(AppAiBot, mapping.bot_id)
            if bot is None or str(getattr(bot, "surface", "") or "").strip().lower() != "sandbox":
                raise LookupError("Conversation is not an OpenCode sandbox")
            session_row = db.execute(
                select(AppAiSandboxSession).where(
                    AppAiSandboxSession.conversation_id == str(conversation_id),
                    AppAiSandboxSession.user_id == int(current_user_id),
                ).with_for_update()
            ).scalar_one_or_none()
            if session_row is None:
                return
            active_jobs = list(
                db.execute(
                    select(AppAiSandboxJob).where(
                        AppAiSandboxJob.session_id == session_row.id,
                        AppAiSandboxJob.status.in_(ACTIVE_JOB_STATUSES),
                    ).with_for_update()
                ).scalars()
            )
            for job in active_jobs:
                if job.status == "finalizing":
                    # The conversation/mapping is about to be deleted, so a
                    # pending delivery can no longer be finalized. Cancelling
                    # the durable intent under the job lock prevents it from
                    # stranding the active-job constraint after deletion. A
                    # concurrent deterministic send either commits first and
                    # is deleted with the conversation, or its final CAS sees
                    # this terminal state and cannot resurrect the job.
                    job.status = "cancelled"
                    job.finalization_state = "not_required"
                    job.finalization_markdown = ""
                    job.cleanup_terminal_status = None
                    job.error_code = "conversation_deleted"
                    job.completed_at = now
                    job.updated_at = now
                    continue
                if job.status in {"claimed", "running", "waiting_permission", "cleanup_pending"}:
                    job.status = "cleanup_pending"
                    job.cleanup_terminal_status = "cancelled"
                    job.error_code = "conversation_deleted"
                    job.completed_at = None
                else:
                    job.status = "cancelled"
                    job.cleanup_terminal_status = None
                    job.completed_at = now
                job.updated_at = now
            pending_permissions = list(
                db.execute(
                    select(AppAiSandboxPermission).where(
                        AppAiSandboxPermission.session_id == session_row.id,
                        AppAiSandboxPermission.status == "pending",
                    )
                ).scalars()
            )
            for permission in pending_permissions:
                permission.status = "rejected"
                permission.responded_by_user_id = int(current_user_id)
                permission.responded_at = now
                permission.updated_at = now
                if permission.action_id:
                    action = db.get(AppAiPendingAction, permission.action_id)
                    if action is not None and action.status in {"pending", "executing"}:
                        action.status = "cancelled"
                        action.executed_by_user_id = int(current_user_id)
                        action.updated_at = now
            session_row.status = (
                "busy"
                if any(job.status in {"finalizing", "cleanup_pending"} for job in active_jobs)
                else "stopped"
            )
            session_row.expires_at = now
            session_row.updated_at = now

    def issue_job_manifest(self, *, job_id: str) -> dict[str, Any]:
        """Build a worker-only prompt manifest with one-time input grants."""

        self.ensure_enabled()
        with app_session() as db:
            job = db.get(AppAiSandboxJob, str(job_id))
            if job is None or job.status not in {"claimed", "running"}:
                raise LookupError("Active sandbox job was not found")
            session_row = db.get(AppAiSandboxSession, job.session_id)
            if session_row is None or int(session_row.user_id) != int(job.user_id):
                raise PermissionError("Sandbox job/session ownership mismatch")
            self._require_conversation_in_session(
                db,
                conversation_id=job.conversation_id,
                user_id=int(job.user_id),
            )
            inputs = list(
                db.execute(
                    select(AppAiSandboxFile)
                    .where(
                        AppAiSandboxFile.job_id == job.id,
                        AppAiSandboxFile.file_kind == "input",
                    )
                    .order_by(AppAiSandboxFile.created_at.asc(), AppAiSandboxFile.id.asc())
                ).scalars()
            )
            manifest_job = {
                "id": job.id,
                "conversation_id": job.conversation_id,
                "user_id": int(job.user_id),
                "prompt_message_id": job.prompt_message_id,
                "job_type": job.job_type,
                "target_file_id": job.target_file_id,
            }
            input_metadata = [
                {
                    "id": row.id,
                    "message_id": row.source_message_id,
                    "attachment_id": row.source_attachment_id,
                    "file_name": row.file_name,
                    "content_type": row.content_type,
                    "size_bytes": int(row.size_bytes or 0),
                    "sha256": row.sha256,
                }
                for row in inputs
            ]
            target_file = db.get(AppAiSandboxFile, job.target_file_id) if job.target_file_id else None
            if target_file is not None and (
                target_file.session_id != job.session_id
                or target_file.conversation_id != job.conversation_id
                or target_file.file_kind not in {"output", "changed", "archive"}
            ):
                raise PermissionError("Sandbox utility target scope mismatch")
            target_metadata = None if target_file is None else {
                "path": target_file.relative_path,
                "name": target_file.file_name,
                "size_bytes": int(target_file.size_bytes or 0),
                "sha256": target_file.sha256,
            }

        prompt = ""
        if manifest_job["job_type"] == "prompt":
            message = chat_service.get_message(
                current_user_id=manifest_job["user_id"],
                message_id=manifest_job["prompt_message_id"],
            )
            if str(message.get("conversation_id") or "") != manifest_job["conversation_id"]:
                raise PermissionError("Sandbox prompt message ownership mismatch")
            prompt = str(message.get("body") or "").strip()
            if not prompt:
                prompt = "Проанализируй приложенные файлы и выполни запрос пользователя."
            if len(prompt.encode("utf-8")) > 1024 * 1024:
                raise ValueError("Sandbox prompt exceeds 1 MiB")

        # AV, ownership and current hash checks intentionally run outside a DB
        # transaction. The short transaction below revalidates row identity.
        verifier = ChatSandboxAttachmentVerifier()
        verified_inputs: list[dict[str, Any]] = []
        for item in input_metadata:
            if not item["message_id"] or not item["attachment_id"]:
                raise PermissionError("Sandbox input lost its source reference")
            verified = verifier.verify_for_sandbox(
                reference=SandboxAttachmentReference(
                    attachment_id=item["attachment_id"],
                    message_id=item["message_id"],
                ),
                user_id=manifest_job["user_id"],
                conversation_id=manifest_job["conversation_id"],
            )
            if (
                int(verified.size_bytes) != item["size_bytes"]
                or not hmac.compare_digest(verified.sha256, str(item["sha256"] or ""))
            ):
                raise PermissionError("Sandbox input changed after queue validation")
            verified_inputs.append({**item, "verified": verified})

        now = _utc_now()
        grants: list[dict[str, Any]] = []
        with app_session() as db:
            locked_job = db.execute(
                select(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.id == manifest_job["id"],
                    AppAiSandboxJob.user_id == manifest_job["user_id"],
                    AppAiSandboxJob.status.in_(("claimed", "running")),
                )
                .with_for_update()
            ).scalar_one_or_none()
            if locked_job is None:
                raise LookupError("Sandbox job is no longer active")
            db.execute(
                update(AppAiSandboxTransferGrant)
                .where(
                    AppAiSandboxTransferGrant.job_id == locked_job.id,
                    AppAiSandboxTransferGrant.direction == "input_download",
                    AppAiSandboxTransferGrant.status == "issued",
                )
                .values(status="revoked", updated_at=now)
            )
            for item in verified_inputs:
                current_file = db.get(AppAiSandboxFile, item["id"])
                if (
                    current_file is None
                    or current_file.job_id != locked_job.id
                    or current_file.source_message_id != item["message_id"]
                    or current_file.source_attachment_id != item["attachment_id"]
                ):
                    raise PermissionError("Sandbox input metadata changed")
                token = OneTimeTransferToken()
                grant_id = str(uuid4())
                expires_at = now + TRANSFER_GRANT_TTL
                db.add(
                    AppAiSandboxTransferGrant(
                        id=grant_id,
                        job_id=locked_job.id,
                        file_id=current_file.id,
                        user_id=manifest_job["user_id"],
                        direction="input_download",
                        token_hash=token.digest(),
                        status="issued",
                        expires_at=expires_at,
                        created_at=now,
                        updated_at=now,
                    )
                )
                grants.append(
                    {
                        "grant_id": grant_id,
                        "file_id": current_file.id,
                        "file_name": current_file.file_name,
                        "content_type": current_file.content_type,
                        "size_bytes": int(current_file.size_bytes or 0),
                        "sha256": current_file.sha256,
                        "download_path": f"/api/v1/chat/internal/ai/sandbox/transfers/{grant_id}",
                        "token": token.reveal(),
                        "expires_at": _iso(expires_at),
                    }
                )
        return {
            "job_id": manifest_job["id"],
            "conversation_id": manifest_job["conversation_id"],
            "job_type": manifest_job["job_type"],
            "target_file_id": manifest_job.get("target_file_id"),
            "target_file": target_metadata,
            "prompt": prompt,
            "inputs": grants,
        }

    def consume_input_transfer(self, *, grant_id: str, raw_token: str) -> dict[str, Any]:
        claimed = self._claim_transfer_grant(
            grant_id=grant_id,
            raw_token=raw_token,
            direction="input_download",
        )
        try:
            verifier = ChatSandboxAttachmentVerifier()
            verified = verifier.verify_for_sandbox(
                reference=SandboxAttachmentReference(
                    attachment_id=claimed["source_attachment_id"],
                    message_id=claimed["source_message_id"],
                ),
                user_id=claimed["user_id"],
                conversation_id=claimed["conversation_id"],
            )
            if (
                int(verified.size_bytes) != claimed["size_bytes"]
                or not hmac.compare_digest(verified.sha256, claimed["sha256"])
            ):
                raise PermissionError("Sandbox input changed before transfer")
            download = chat_service.get_attachment_for_download(
                current_user_id=claimed["user_id"],
                message_id=claimed["source_message_id"],
                attachment_id=claimed["source_attachment_id"],
            )
            source = Path(str(download.get("path") or "")).resolve(strict=True)
            source_stat = source.lstat()
            if source.is_symlink() or not stat.S_ISREG(source_stat.st_mode):
                raise PermissionError("Sandbox transfer source is not a regular file")
            self._finish_transfer_grant(grant_id=grant_id, status="consumed")
            return {
                "path": source,
                "file_name": claimed["file_name"],
                "content_type": claimed["content_type"],
                "size_bytes": claimed["size_bytes"],
            }
        except Exception:
            self._finish_transfer_grant(grant_id=grant_id, status="revoked")
            raise

    def issue_output_upload_grant(self, *, job_id: str, file_id: str) -> dict[str, Any]:
        self.ensure_enabled()
        now = _utc_now()
        with app_session() as db:
            job = db.execute(
                select(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.id == str(job_id),
                    AppAiSandboxJob.status.in_(("claimed", "running", "waiting_permission")),
                    AppAiSandboxJob.job_type.in_(("prompt", "archive", "attach_file")),
                )
                .with_for_update()
            ).scalar_one_or_none()
            if job is None:
                raise LookupError("Active sandbox export job was not found")
            session_row = db.get(AppAiSandboxSession, job.session_id)
            file_row = db.get(AppAiSandboxFile, str(file_id))
            if (
                session_row is None
                or file_row is None
                or file_row.session_id != session_row.id
                or file_row.conversation_id != job.conversation_id
                or int(session_row.user_id) != int(job.user_id)
                or file_row.file_kind not in {"output", "changed", "archive"}
            ):
                raise PermissionError("Sandbox output does not belong to this job/session")
            if job.job_type == "attach_file" and job.target_file_id != file_row.id:
                raise PermissionError("Sandbox export job targets another file")
            if job.job_type == "archive" and file_row.file_kind != "archive":
                raise PermissionError("Sandbox archive job may only upload its archive")
            if job.job_type == "prompt" and (
                file_row.job_id != job.id or file_row.file_kind not in {"output", "changed"}
            ):
                raise PermissionError("Sandbox prompt may only upload its verified result files")
            if not (0 <= int(file_row.size_bytes or 0) <= MAX_SANDBOX_OUTPUT_BYTES):
                raise ValueError("Sandbox output exceeds 1 GiB")
            if len(str(file_row.sha256 or "")) != 64:
                raise ValueError("Sandbox output has no verified SHA-256 metadata")
            db.execute(
                update(AppAiSandboxTransferGrant)
                .where(
                    AppAiSandboxTransferGrant.job_id == job.id,
                    AppAiSandboxTransferGrant.file_id == file_row.id,
                    AppAiSandboxTransferGrant.direction == "output_upload",
                    AppAiSandboxTransferGrant.status == "issued",
                )
                .values(status="revoked", updated_at=now)
            )
            token = OneTimeTransferToken()
            grant_id = str(uuid4())
            expires_at = now + TRANSFER_GRANT_TTL
            db.add(
                AppAiSandboxTransferGrant(
                    id=grant_id,
                    job_id=job.id,
                    file_id=file_row.id,
                    user_id=int(job.user_id),
                    direction="output_upload",
                    token_hash=token.digest(),
                    status="issued",
                    expires_at=expires_at,
                    created_at=now,
                    updated_at=now,
                )
            )
            return {
                "grant_id": grant_id,
                "upload_path": f"/api/v1/chat/internal/ai/sandbox/transfers/{grant_id}",
                "token": token.reveal(),
                "size_bytes": int(file_row.size_bytes or 0),
                "sha256": file_row.sha256,
                "expires_at": _iso(expires_at),
            }

    def consume_output_upload(
        self,
        *,
        grant_id: str,
        raw_token: str,
        staged_path: Path,
    ) -> dict[str, Any]:
        claimed = self.claim_output_upload(
            grant_id=grant_id,
            raw_token=raw_token,
        )
        return self.consume_claimed_output_upload(claimed=claimed, staged_path=staged_path)

    def claim_output_upload(self, *, grant_id: str, raw_token: str) -> dict[str, Any]:
        return self._claim_transfer_grant(
            grant_id=grant_id,
            raw_token=raw_token,
            direction="output_upload",
        )

    def revoke_claimed_transfer(self, *, grant_id: str) -> None:
        self._finish_transfer_grant(grant_id=grant_id, status="revoked")

    def consume_claimed_output_upload(
        self,
        *,
        claimed: dict[str, Any],
        staged_path: Path,
    ) -> dict[str, Any]:
        completed_result = claimed.get("completed_result")
        if isinstance(completed_result, dict):
            return dict(completed_result)
        upload: UploadFile | None = None
        deterministic_delivery_attempted = False
        try:
            source = staged_path.resolve(strict=True)
            source_stat = source.lstat()
            if (
                source.is_symlink()
                or not stat.S_ISREG(source_stat.st_mode)
                or source_stat.st_nlink != 1
                or int(source_stat.st_size) != claimed["size_bytes"]
            ):
                raise PermissionError("Sandbox output staging validation failed")
            digest = hashlib.sha256()
            with source.open("rb") as handle:
                while chunk := handle.read(1024 * 1024):
                    digest.update(chunk)
            if not hmac.compare_digest(digest.hexdigest(), claimed["sha256"]):
                raise PermissionError("Sandbox output hash changed in transit")
            if claimed["file_kind"] == "archive":
                inspect_archive(source)
            scan_result = scan_my_file(source)
            if str(scan_result.status or "").strip().lower() != "clean":
                raise PermissionError("Sandbox output was not accepted by antivirus")

            with app_session() as db:
                mapping = db.execute(
                    select(AppAiBotConversation).where(
                        AppAiBotConversation.conversation_id == claimed["conversation_id"]
                    )
                ).scalar_one_or_none()
                bot = db.get(AppAiBot, mapping.bot_id) if mapping is not None else None
            if (
                mapping is None
                or int(mapping.user_id) != claimed["user_id"]
                or bot is None
                or str(getattr(bot, "surface", "") or "") != "sandbox"
                or not int(getattr(bot, "bot_user_id", 0) or 0)
            ):
                raise PermissionError("OpenCode sender identity is unavailable")
            handle = source.open("rb")
            upload = UploadFile(
                filename=claimed["file_name"],
                file=handle,
                headers={"content-type": claimed["content_type"]},
            )
            delivery_client_message_id = str(
                uuid5(
                    NAMESPACE_URL,
                    f"hub-ai-sandbox-output:{claimed['job_id']}:{claimed['file_id']}",
                )
            )
            try:
                deterministic_delivery_attempted = True
                message = chat_service.send_files(
                    current_user_id=int(bot.bot_user_id),
                    conversation_id=claimed["conversation_id"],
                    body="",
                    uploads=[upload],
                    client_message_id=delivery_client_message_id,
                    defer_push_notifications=True,
                )
            except Exception:
                # File-message persistence and the app-scope grant live in
                # separate databases. If the chat commit succeeded but the
                # local call/response failed, reconcile by the deterministic
                # delivery key instead of creating another attachment.
                message = chat_service.get_message_by_client_id(
                    current_user_id=int(bot.bot_user_id),
                    conversation_id=claimed["conversation_id"],
                    client_message_id=delivery_client_message_id,
                )
                if message is None:
                    # The chat DB confirms that no deterministic delivery was
                    # committed, so this grant can safely become terminal.
                    deterministic_delivery_attempted = False
                    raise
            attachments = list(message.get("attachments") or [])
            attachment = attachments[0] if attachments else {}
            message_id = str(message.get("id") or "")
            attachment_id = str(attachment.get("id") or "")
            if not message_id or not attachment_id:
                raise RuntimeError("Sandbox output was stored without an attachment id")
            with app_session() as db:
                file_row = db.get(AppAiSandboxFile, claimed["file_id"])
                grant = db.get(AppAiSandboxTransferGrant, claimed["grant_id"])
                if file_row is None or grant is None:
                    raise RuntimeError("Sandbox output transfer lost its database claim")
                if grant.status == "consumed" and file_row.delivery_status == "attached":
                    message_id = str(file_row.chat_message_id or "")
                    attachment_id = str(file_row.chat_attachment_id or "")
                    if not message_id or not attachment_id:
                        raise RuntimeError("Consumed sandbox output has incomplete attachment metadata")
                elif grant.status == "claimed":
                    now = _utc_now()
                    file_row.chat_message_id = message_id
                    file_row.chat_attachment_id = attachment_id
                    file_row.delivery_status = "attached"
                    file_row.updated_at = now
                    grant.status = "consumed"
                    grant.consumed_at = now
                    grant.updated_at = now
                else:
                    raise RuntimeError("Sandbox output transfer lost its database claim")
            from backend.ai_chat.service import ai_chat_service

            ai_chat_service._enqueue_message_side_effects_after_send(
                conversation_id=claimed["conversation_id"],
                message_id=message_id,
            )
            self._publish_update(
                conversation_id=claimed["conversation_id"],
                user_id=claimed["user_id"],
                change="files",
                payload={"job_id": claimed["job_id"], "status": "attached"},
            )
            return {"message_id": message_id, "attachment_id": attachment_id, "file_id": claimed["file_id"]}
        except Exception:
            if not deterministic_delivery_attempted:
                self._finish_transfer_grant(grant_id=claimed["grant_id"], status="revoked")
            raise
        finally:
            if upload is not None:
                try:
                    upload.file.close()
                except Exception:
                    pass

    def _claim_transfer_grant(self, *, grant_id: str, raw_token: str, direction: str) -> dict[str, Any]:
        token = OneTimeTransferToken(raw_token)
        now = _utc_now()
        with app_session() as db:
            grant_scope = db.execute(
                select(
                    AppAiSandboxTransferGrant.job_id,
                    AppAiSandboxTransferGrant.direction,
                ).where(AppAiSandboxTransferGrant.id == str(grant_id))
            ).one_or_none()
            if grant_scope is None or str(grant_scope.direction) != direction:
                raise PermissionError("One-time sandbox transfer grant is unavailable")
            # Job first, grant second: cancel_job uses the same lock order.
            # Whichever transaction wins defines whether delivery may start.
            job = db.execute(
                select(AppAiSandboxJob)
                .where(AppAiSandboxJob.id == str(grant_scope.job_id))
                .with_for_update()
            ).scalar_one_or_none()
            grant = db.execute(
                select(AppAiSandboxTransferGrant)
                .where(AppAiSandboxTransferGrant.id == str(grant_id))
                .with_for_update()
                .execution_options(populate_existing=True)
            ).scalar_one_or_none()
            if job is None or grant is None or grant.direction != direction or grant.job_id != job.id:
                raise PermissionError("One-time sandbox transfer grant is unavailable")
            expires_at = grant.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at <= now:
                grant.status = "expired"
                grant.updated_at = now
                raise PermissionError("One-time sandbox transfer grant expired")
            if not hmac.compare_digest(grant.token_hash, token.digest()):
                raise PermissionError("One-time sandbox transfer token is invalid")
            replay_status = ""
            if grant.status == "issued":
                if job.status not in {"claimed", "running", "waiting_permission"}:
                    raise PermissionError("Sandbox job no longer accepts transfers")
                grant.status = "claimed"
                grant.updated_at = now
            elif direction == "output_upload" and grant.status in {"claimed", "consumed"}:
                # A worker may lose the HTTP response after the chat host has
                # committed. The same exact scoped token is allowed to
                # reconcile, never to create another message/file.
                replay_status = str(grant.status)
            else:
                raise PermissionError("One-time sandbox transfer grant is unavailable")
            file_row = db.get(AppAiSandboxFile, grant.file_id)
            if job is None or file_row is None or int(job.user_id) != int(grant.user_id):
                raise PermissionError("Sandbox transfer ownership mismatch")
            payload = {
                "grant_id": grant.id,
                "job_id": job.id,
                "file_id": file_row.id,
                "user_id": int(job.user_id),
                "conversation_id": job.conversation_id,
                "file_name": file_row.file_name,
                "content_type": file_row.content_type,
                "file_kind": file_row.file_kind,
                "size_bytes": int(file_row.size_bytes or 0),
                "sha256": str(file_row.sha256 or ""),
                "source_message_id": str(file_row.source_message_id or ""),
                "source_attachment_id": str(file_row.source_attachment_id or ""),
            }
            if replay_status == "consumed":
                message_id = str(file_row.chat_message_id or "")
                attachment_id = str(file_row.chat_attachment_id or "")
                if file_row.delivery_status != "attached" or not message_id or not attachment_id:
                    raise PermissionError("Consumed sandbox output metadata is incomplete")
                payload["completed_result"] = {
                    "message_id": message_id,
                    "attachment_id": attachment_id,
                    "file_id": file_row.id,
                }
            return payload

    @staticmethod
    def _finish_transfer_grant(*, grant_id: str, status: str) -> None:
        if status not in {"consumed", "revoked"}:
            raise ValueError("Unsupported transfer terminal status")
        now = _utc_now()
        with app_session() as db:
            grant = db.get(AppAiSandboxTransferGrant, str(grant_id))
            if grant is None or grant.status != "claimed":
                return
            grant.status = status
            grant.consumed_at = now if status == "consumed" else None
            grant.updated_at = now

    def conversation_snapshot(self, *, conversation_id: str, current_user_id: int) -> dict[str, Any]:
        self.ensure_enabled()
        self._require_conversation(conversation_id=conversation_id, user_id=current_user_id)
        with app_session() as db:
            session_row = db.execute(
                select(AppAiSandboxSession).where(
                    AppAiSandboxSession.conversation_id == str(conversation_id),
                    AppAiSandboxSession.user_id == int(current_user_id),
                )
            ).scalar_one_or_none()
            if session_row is None:
                return {
                    "enabled": True,
                    "conversation_id": str(conversation_id),
                    "session": None,
                    "job": None,
                    "files": [],
                    "diff": [],
                    "pending_permissions": [],
                    "archive": None,
                }
            latest_job = db.execute(
                select(AppAiSandboxJob)
                .where(AppAiSandboxJob.session_id == session_row.id)
                .order_by(AppAiSandboxJob.created_at.desc())
                .limit(1)
            ).scalar_one_or_none()
            latest_archive_job = db.execute(
                select(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.session_id == session_row.id,
                    AppAiSandboxJob.job_type == "archive",
                )
                .order_by(AppAiSandboxJob.created_at.desc())
                .limit(1)
            ).scalar_one_or_none()
            files = list(
                db.execute(
                    select(AppAiSandboxFile)
                    .where(AppAiSandboxFile.session_id == session_row.id)
                    .order_by(AppAiSandboxFile.relative_path.asc(), AppAiSandboxFile.created_at.desc())
                    .limit(500)
                ).scalars()
            )
            permissions = list(
                db.execute(
                    select(AppAiSandboxPermission)
                    .where(
                        AppAiSandboxPermission.session_id == session_row.id,
                        AppAiSandboxPermission.user_id == int(current_user_id),
                        AppAiSandboxPermission.status == "pending",
                    )
                    .order_by(AppAiSandboxPermission.requested_at.asc())
                ).scalars()
            )

        file_payloads = [self._file_payload(item) for item in files]
        diff_payloads: list[dict[str, Any]] = []
        remaining_diff_chars = MAX_DIFF_CHARS_TOTAL
        for item in files:
            patch = str(item.diff_text or "")
            if not item.is_changed or not patch or remaining_diff_chars <= 0:
                continue
            visible = patch[: min(MAX_DIFF_CHARS_PER_FILE, remaining_diff_chars)]
            diff_payloads.append(
                {
                    "file_id": item.id,
                    "path": item.relative_path,
                    "status": "modified" if item.source_attachment_id else "added",
                    "patch": visible,
                    "truncated": len(visible) < len(patch),
                }
            )
            remaining_diff_chars -= len(visible)
        archive_file = next((item for item in files if item.file_kind == "archive"), None)
        archive_job = latest_archive_job
        return {
            "enabled": True,
            "conversation_id": str(conversation_id),
            "session": {
                "id": session_row.id,
                "status": session_row.status,
                "last_activity_at": _iso(session_row.last_activity_at),
                "expires_at": _iso(session_row.expires_at),
            },
            "job": None if latest_job is None else self._job_view(latest_job),
            "files": file_payloads,
            "diff": diff_payloads,
            "pending_permissions": [self._permission_payload(item) for item in permissions],
            "archive": None if archive_file is None and archive_job is None else {
                "status": archive_job.status if archive_job is not None else "succeeded",
                "job_id": archive_job.id if archive_job is not None else archive_file.job_id,
                "message_id": archive_file.chat_message_id if archive_file is not None else None,
                "attachment_id": archive_file.chat_attachment_id if archive_file is not None else None,
                "download_url": self._attachment_download_url(archive_file) if archive_file is not None else None,
                "save_to_my_files_url": self._attachment_save_url(archive_file) if archive_file is not None else None,
            },
        }

    def respond_permission(
        self,
        *,
        permission_id: str,
        current_user_id: int,
        decision: str,
        scope: str,
    ) -> dict[str, Any]:
        self.ensure_enabled()
        now = _utc_now()
        with app_session() as db:
            preview = db.execute(
                select(AppAiSandboxPermission)
                .where(
                    AppAiSandboxPermission.id == str(permission_id),
                    AppAiSandboxPermission.user_id == int(current_user_id),
                )
            ).scalar_one_or_none()
            if preview is None:
                raise LookupError("Sandbox permission was not found")
            # All cancellation/approval paths lock job -> permission in this
            # order. The unlocked lookup only discovers the immutable job id;
            # the permission is re-read under lock before any decision.
            job = db.execute(
                select(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.id == preview.job_id,
                    AppAiSandboxJob.session_id == preview.session_id,
                )
                .with_for_update()
            ).scalar_one_or_none()
            row = db.execute(
                select(AppAiSandboxPermission)
                .where(
                    AppAiSandboxPermission.id == str(permission_id),
                    AppAiSandboxPermission.user_id == int(current_user_id),
                )
                .with_for_update()
            ).scalar_one_or_none()
            if row is None:
                raise LookupError("Sandbox permission was not found")
            session_row = db.get(AppAiSandboxSession, row.session_id)
            if session_row is None or int(session_row.user_id) != int(current_user_id):
                raise PermissionError("Sandbox permission does not belong to this user")
            self._require_conversation_in_session(
                db,
                conversation_id=session_row.conversation_id,
                user_id=int(current_user_id),
            )
            if row.status != "pending":
                return {
                    "id": row.id,
                    "status": row.status,
                    "scope": row.grant_scope,
                    "conversation_id": session_row.conversation_id,
                    "job_id": row.job_id,
                }
            if job is None or job.status != "waiting_permission":
                # Stop/cancel owns the transition once the job is no longer
                # waiting. Never approve a stale card or revive the job.
                row.status = "rejected"
                row.grant_scope = None
                row.responded_by_user_id = int(current_user_id)
                row.responded_at = now
                row.updated_at = now
                if row.action_id:
                    db.execute(
                        update(AppAiPendingAction)
                        .where(
                            AppAiPendingAction.id == row.action_id,
                            AppAiPendingAction.status.in_(("pending", "executing")),
                        )
                        .values(
                            status="cancelled",
                            executed_by_user_id=int(current_user_id),
                            result_json=_json_dumps(
                                {"success": False, "reason": "sandbox_job_not_waiting"}
                            ),
                            updated_at=now,
                        )
                    )
                return {
                    "id": row.id,
                    "status": "rejected",
                    "scope": None,
                    "conversation_id": session_row.conversation_id,
                    "job_id": row.job_id,
                }
            normalized_scope = self.policy.validate_grant_scope(scope)
            requested_disposition = self.policy.disposition_for_tool(row.tool)
            normalized_decision = str(decision or "").strip().lower()
            if normalized_decision not in {"allow", "reject"}:
                raise ValueError("Sandbox permission decision must be allow or reject")
            approved = normalized_decision == "allow"
            if requested_disposition is not PermissionDisposition.ASK:
                approved = False
            terminal_status = "approved" if approved else "rejected"
            terminal_scope = normalized_scope.value if approved else None
            claimed = db.execute(
                update(AppAiSandboxPermission)
                .where(
                    AppAiSandboxPermission.id == row.id,
                    AppAiSandboxPermission.user_id == int(current_user_id),
                    AppAiSandboxPermission.status == "pending",
                )
                .values(
                    status=terminal_status,
                    grant_scope=terminal_scope,
                    responded_by_user_id=int(current_user_id),
                    responded_at=now,
                    updated_at=now,
                )
            )
            if not claimed.rowcount:
                db.expire_all()
                current = db.get(AppAiSandboxPermission, row.id)
                if current is None:
                    raise LookupError("Sandbox permission was not found")
                return {
                    "id": current.id,
                    "status": current.status,
                    "scope": current.grant_scope,
                    "conversation_id": session_row.conversation_id,
                    "job_id": current.job_id,
                }
            if row.action_id:
                db.execute(
                    update(AppAiPendingAction)
                    .where(
                        AppAiPendingAction.id == row.action_id,
                        AppAiPendingAction.status.in_(("pending", "executing")),
                    )
                    .values(
                        status="confirmed" if approved else "cancelled",
                        executed_by_user_id=int(current_user_id),
                        result_json=_json_dumps({"success": True, "permission_id": row.id}),
                        updated_at=now,
                    )
                )
            job.status = "running"
            job.heartbeat_at = now
            job.updated_at = now
            payload = {
                "id": row.id,
                "status": terminal_status,
                "scope": terminal_scope,
                "conversation_id": session_row.conversation_id,
                "job_id": row.job_id,
            }
        self._publish_update(
            conversation_id=payload["conversation_id"],
            user_id=int(current_user_id),
            change="permission",
            payload={"permission_id": payload["id"], "job_id": payload["job_id"], "status": payload["status"]},
        )
        return payload

    def create_permission_request(
        self,
        *,
        session_id: str,
        job_id: str,
        opencode_permission_id: str,
        tool: str,
        operation: str,
        arguments_preview: dict[str, Any],
        message_id: str | None,
    ) -> dict[str, Any]:
        """Worker-side persistence seam; preview is bounded/redacted first."""

        self.ensure_enabled()
        now = _utc_now()
        safe_arguments = redact_preview(arguments_preview)
        request = PermissionRequest(
            id=str(uuid4()),
            session_id=session_id,
            job_id=job_id,
            tool=str(tool),
            operation=str(operation),
            arguments_preview=safe_arguments if isinstance(safe_arguments, dict) else {},
            requested_at=now,
        )
        policy_decision = self.policy.evaluate_request(request)
        if policy_decision.disposition is PermissionDisposition.ASK and not message_id:
            with app_session() as db:
                session_preview = db.get(AppAiSandboxSession, session_id)
                job_preview = db.get(AppAiSandboxJob, job_id)
                if (
                    session_preview is None
                    or job_preview is None
                    or job_preview.session_id != session_id
                    or job_preview.status not in {"running", "waiting_permission"}
                ):
                    raise LookupError("Sandbox session/job was not found")
                _, mapping = self._require_conversation_in_session(
                    db,
                    conversation_id=session_preview.conversation_id,
                    user_id=int(session_preview.user_id),
                )
                bot = db.get(AppAiBot, mapping.bot_id)
                bot_user_id = int(getattr(bot, "bot_user_id", 0) or 0) if bot is not None else 0
                conversation_id_for_card = session_preview.conversation_id
            if bot_user_id <= 0:
                raise RuntimeError("OpenCode sender identity is unavailable")
            permission_message = chat_service.send_message(
                current_user_id=bot_user_id,
                conversation_id=conversation_id_for_card,
                body=(
                    "OpenCode запрашивает разрешение на действие: "
                    + (redact_text(operation, max_length=300) or str(tool))
                ),
                body_format="plain",
                client_message_id=str(
                    uuid5(NAMESPACE_URL, f"hub-ai-sandbox:{session_id}:{opencode_permission_id}")
                ),
                defer_push_notifications=True,
            )
            message_id = str(permission_message.get("id") or "") or None
            if message_id:
                from backend.ai_chat.service import ai_chat_service

                ai_chat_service._enqueue_message_side_effects_after_send(
                    conversation_id=conversation_id_for_card,
                    message_id=message_id,
                )
        with app_session() as db:
            session_row = db.get(AppAiSandboxSession, session_id)
            job = db.execute(
                select(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.id == job_id,
                    AppAiSandboxJob.session_id == session_id,
                )
                .with_for_update()
            ).scalar_one_or_none()
            if session_row is None or job is None or job.session_id != session_id:
                raise LookupError("Sandbox session/job was not found")
            existing = db.execute(
                select(AppAiSandboxPermission).where(
                    AppAiSandboxPermission.session_id == session_id,
                    AppAiSandboxPermission.opencode_permission_id == str(opencode_permission_id)[:200],
                )
            ).scalar_one_or_none()
            if existing is not None:
                return self._permission_payload(existing)
            if job.status != "running":
                raise LookupError("Sandbox job is not accepting a new permission request")
            reusable_session_grant = None
            if policy_decision.disposition is PermissionDisposition.ASK:
                reusable_session_grant = db.execute(
                    select(AppAiSandboxPermission)
                    .where(
                        AppAiSandboxPermission.session_id == session_id,
                        AppAiSandboxPermission.user_id == int(session_row.user_id),
                        AppAiSandboxPermission.tool == str(tool)[:64],
                        AppAiSandboxPermission.operation == redact_text(operation, max_length=128),
                        AppAiSandboxPermission.status == "approved",
                        AppAiSandboxPermission.grant_scope == "session",
                    )
                    .order_by(AppAiSandboxPermission.responded_at.desc())
                    .limit(1)
                ).scalar_one_or_none()
            is_allowed = (
                policy_decision.disposition is PermissionDisposition.ALLOW
                or reusable_session_grant is not None
            )
            needs_confirmation = policy_decision.disposition is PermissionDisposition.ASK and not is_allowed
            action_id = str(uuid4()) if needs_confirmation else None
            permission = AppAiSandboxPermission(
                id=request.id,
                session_id=session_id,
                job_id=job_id,
                user_id=int(session_row.user_id),
                opencode_permission_id=str(opencode_permission_id)[:200],
                tool=str(tool)[:64],
                operation=redact_text(operation, max_length=128),
                arguments_preview_json=_json_dumps(request.arguments_preview),
                action_id=action_id,
                status=(
                    "pending"
                    if needs_confirmation
                    else "approved" if is_allowed else "rejected"
                ),
                grant_scope=("session" if reusable_session_grant is not None else "once") if is_allowed else None,
                responded_by_user_id=int(session_row.user_id) if is_allowed else None,
                requested_at=now,
                responded_at=now if not needs_confirmation else None,
                created_at=now,
                updated_at=now,
            )
            db.add(permission)
            if action_id:
                expires_at = min(_aware_utc(job.deadline_at), now + timedelta(minutes=15))
                db.add(
                    AppAiPendingAction(
                        id=action_id,
                        action_type=SANDBOX_ACTION_TYPE,
                        status="pending",
                        conversation_id=session_row.conversation_id,
                        run_id=job.id,
                        message_id=message_id,
                        requester_user_id=int(session_row.user_id),
                        database_id=None,
                        payload_json=_json_dumps({"permission_id": permission.id, "scope": "once"}),
                        preview_json=_json_dumps(
                            {
                                "title": "Разрешить действие OpenCode",
                                "summary": redact_text(operation, max_length=300) or str(tool),
                                "tool": str(tool),
                                "arguments": request.arguments_preview,
                                "effects": ["Действие выполняется только в изолированной копии файлов"],
                            }
                        ),
                        result_json="{}",
                        error_text=None,
                        expires_at=expires_at,
                        created_at=now,
                        updated_at=now,
                    )
                )
                job.status = "waiting_permission"
                job.updated_at = now
            db.flush()
            payload = self._permission_payload(permission)
            conversation_id = session_row.conversation_id
            user_id = int(session_row.user_id)
        self._publish_update(
            conversation_id=conversation_id,
            user_id=user_id,
            change="permission",
            payload={"permission_id": payload["id"], "job_id": job_id, "status": payload["status"]},
        )
        return payload

    def get_permission_for_worker(self, *, job_id: str, permission_id: str) -> dict[str, Any]:
        self.ensure_enabled()
        with app_session() as db:
            row = db.execute(
                select(AppAiSandboxPermission).where(
                    AppAiSandboxPermission.id == str(permission_id),
                    AppAiSandboxPermission.job_id == str(job_id),
                )
            ).scalar_one_or_none()
            if row is None:
                raise LookupError("Sandbox permission was not found")
            job = db.get(AppAiSandboxJob, row.job_id)
            if job is None or job.session_id != row.session_id:
                raise PermissionError("Sandbox permission scope mismatch")
            return {
                "id": row.id,
                "status": row.status,
                "scope": row.grant_scope,
                "job_id": row.job_id,
                "session_id": row.session_id,
                "opencode_permission_id": row.opencode_permission_id,
            }

    @staticmethod
    def _validated_worker_path(value: str) -> str:
        raw = str(value or "").replace("\\", "/")
        path = PurePosixPath(raw)
        if (
            not raw
            or path.is_absolute()
            or any(part in {"", ".", ".."} for part in path.parts)
            or path.parts[0].lower() in {".opencode", ".hub-opencode"}
        ):
            raise ValueError("Sandbox output path is unsafe")
        return path.as_posix()

    def record_worker_result(
        self,
        *,
        job_id: str,
        opencode_session_id: str | None,
        assistant_markdown: str,
        files: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Persist bounded worker metadata before one-time output transfer."""

        self.ensure_enabled()
        # Answer delivery is intentionally deferred to finalize_worker_result.
        # Keeping it in this DTO avoids a split-version worker compatibility
        # hazard while rollout is staged.
        _ = assistant_markdown
        if len(files) > MAX_SANDBOX_OUTPUT_FILES:
            raise ValueError("OpenCode may return at most 5 files per run")
        safe_files: list[dict[str, Any]] = []
        total_size = 0
        seen_paths: set[str] = set()
        for item in files:
            relative_path = self._validated_worker_path(str(item.get("path") or ""))
            if relative_path in seen_paths:
                raise ValueError("Sandbox output paths must be unique")
            seen_paths.add(relative_path)
            size_bytes = int(item.get("size_bytes") or 0)
            total_size += size_bytes
            digest = str(item.get("sha256") or "").strip().lower()
            if (
                not (0 <= size_bytes <= MAX_SANDBOX_OUTPUT_BYTES)
                or total_size > MAX_SANDBOX_OUTPUT_BYTES
                or len(digest) != 64
                or any(ch not in "0123456789abcdef" for ch in digest)
            ):
                raise ValueError("Sandbox output metadata is invalid")
            kind = str(item.get("kind") or "output")
            if kind not in {"output", "changed", "archive"}:
                raise ValueError("Sandbox output kind is invalid")
            safe_files.append(
                {
                    "path": relative_path,
                    "name": normalize_upload_name(str(item.get("name") or Path(relative_path).name)),
                    "kind": kind,
                    "content_type": str(item.get("content_type") or "application/octet-stream")[:255],
                    "size_bytes": size_bytes,
                    "sha256": digest,
                    "changed": bool(item.get("changed")) or kind == "changed",
                    "diff": redact_text(str(item.get("diff") or ""), max_length=MAX_DIFF_CHARS_PER_FILE),
                }
            )

        now = _utc_now()
        with app_session() as db:
            job = db.execute(
                select(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.id == str(job_id),
                    AppAiSandboxJob.status.in_(("claimed", "running", "waiting_permission")),
                )
                .with_for_update()
            ).scalar_one_or_none()
            if job is None:
                raise LookupError("Active sandbox job was not found")
            session_row = db.get(AppAiSandboxSession, job.session_id)
            if session_row is None or int(session_row.user_id) != int(job.user_id):
                raise PermissionError("Sandbox result scope mismatch")
            self._require_conversation_in_session(
                db,
                conversation_id=job.conversation_id,
                user_id=int(job.user_id),
            )
            if opencode_session_id:
                session_row.opencode_session_id = str(opencode_session_id)[:200]
            existing_rows = list(
                db.execute(
                    select(AppAiSandboxFile).where(
                        AppAiSandboxFile.job_id == job.id,
                    )
                ).scalars()
            )
            all_by_path = {row.relative_path: row for row in existing_rows}
            existing_outputs = [
                row for row in existing_rows if row.file_kind in {"output", "changed", "archive"}
            ]
            existing_by_path = {row.relative_path: row for row in existing_outputs}
            _validate_output_manifest_union(
                existing_sizes={path: int(row.size_bytes or 0) for path, row in existing_by_path.items()},
                incoming_files=safe_files,
            )
            persisted: list[AppAiSandboxFile] = []
            for item in safe_files:
                row = all_by_path.get(item["path"])
                if row is None:
                    row = AppAiSandboxFile(
                        id=str(uuid4()),
                        session_id=job.session_id,
                        job_id=job.id,
                        conversation_id=job.conversation_id,
                        relative_path=item["path"],
                        delivery_status="pending",
                        created_at=now,
                        updated_at=now,
                    )
                    db.add(row)
                elif row.file_kind == "input":
                    raise ValueError("Sandbox output may not overwrite input metadata")
                elif row.delivery_status == "attached" and (
                    int(row.size_bytes or 0) != item["size_bytes"]
                    or not hmac.compare_digest(str(row.sha256 or ""), item["sha256"])
                ):
                    raise ValueError("Attached sandbox output metadata cannot be replaced")
                row.file_name = item["name"]
                row.file_kind = item["kind"]
                row.content_type = item["content_type"]
                row.size_bytes = item["size_bytes"]
                row.sha256 = item["sha256"]
                row.is_changed = item["changed"]
                row.diff_text = item["diff"]
                if row.delivery_status != "attached":
                    row.delivery_status = "pending"
                row.updated_at = now
                persisted.append(row)
            session_row.updated_at = now
            db.flush()
            file_payloads = [self._file_payload(row) for row in persisted]
            conversation_id = job.conversation_id
            user_id = int(job.user_id)
        self._publish_update(
            conversation_id=conversation_id,
            user_id=user_id,
            change="files" if file_payloads else "job",
            payload={"job_id": str(job_id), "status": "running"},
        )
        return {"message_id": None, "files": file_payloads}

    def finalize_worker_result(self, *, job_id: str, assistant_markdown: str) -> dict[str, Any]:
        """Idempotently publish a durably marked finalization and close it."""

        _ = assistant_markdown  # Stored finalization intent is the sole source of truth.
        with app_session() as db:
            job = db.execute(
                select(AppAiSandboxJob)
                .where(AppAiSandboxJob.id == str(job_id))
                .with_for_update()
            ).scalar_one_or_none()
            if job is None:
                raise LookupError("Sandbox job was not found")
            session_row = db.get(AppAiSandboxSession, job.session_id)
            if session_row is None or int(session_row.user_id) != int(job.user_id):
                raise PermissionError("Sandbox result scope mismatch")
            bot, _ = self._require_conversation_in_session(
                db,
                conversation_id=job.conversation_id,
                user_id=int(job.user_id),
                require_enabled=False,
            )
            files = list(
                db.execute(
                    select(AppAiSandboxFile).where(
                        AppAiSandboxFile.job_id == job.id,
                        AppAiSandboxFile.file_kind.in_(("output", "changed", "archive")),
                    )
                ).scalars()
            )
            if len(files) > MAX_SANDBOX_OUTPUT_FILES:
                raise RuntimeError("Sandbox result file cap invariant was violated")
            if any(
                row.delivery_status != "attached"
                or not row.chat_message_id
                or not row.chat_attachment_id
                for row in files
            ):
                raise RuntimeError("Sandbox result files are not fully attached")
            file_payloads = [self._file_payload(row) for row in files]
            conversation_id = job.conversation_id
            user_id = int(job.user_id)
            bot_user_id = int(getattr(bot, "bot_user_id", 0) or 0)
            if job.status == "succeeded" and job.finalization_state == "published":
                return {"message_id": job.assistant_message_id, "files": file_payloads}
            if job.status != "finalizing" or job.finalization_state != "pending":
                raise LookupError("Sandbox job is not ready for finalization")
            answer = str(job.finalization_markdown or "").strip()

        message_id = None
        if answer:
            if bot_user_id <= 0:
                raise RuntimeError("OpenCode sender identity is unavailable")
            message = chat_service.send_message(
                current_user_id=bot_user_id,
                conversation_id=conversation_id,
                body=answer,
                body_format="markdown",
                client_message_id=str(uuid5(NAMESPACE_URL, f"hub-ai-sandbox-result:{job_id}")),
                defer_push_notifications=True,
            )
            message_id = str(message.get("id") or "") or None
            if message_id:
                try:
                    from backend.ai_chat.action_cards import attach_run_actions_to_message
                    from backend.ai_chat.service import ai_chat_service

                    attach_run_actions_to_message(run_id=str(job_id), message_id=message_id)
                    ai_chat_service._enqueue_message_side_effects_after_send(
                        conversation_id=conversation_id,
                        message_id=message_id,
                    )
                except Exception:
                    # The answer and every attachment are already durable. A
                    # best-effort notification/action side effect must not turn
                    # the completed delivery into a failed sandbox job.
                    pass

        now = _utc_now()
        with app_session() as db:
            job = db.execute(
                select(AppAiSandboxJob)
                .where(AppAiSandboxJob.id == str(job_id))
                .with_for_update()
            ).scalar_one_or_none()
            if job is None:
                raise LookupError("Sandbox job was not found")
            if job.status == "succeeded" and job.finalization_state == "published":
                message_id = job.assistant_message_id or message_id
            elif job.status == "finalizing" and job.finalization_state == "pending":
                result_payload = _json_loads(job.result_json, {})
                if not isinstance(result_payload, dict):
                    result_payload = {}
                result_payload.update(
                    {
                        "delivery_state": "published",
                        "assistant_message_id": message_id,
                    }
                )
                job.status = "succeeded"
                job.finalization_state = "published"
                job.finalization_markdown = ""
                job.assistant_message_id = message_id
                job.result_json = _json_dumps(result_payload)
                job.error_code = ""
                job.completed_at = now
                job.updated_at = now
                session_row = db.get(AppAiSandboxSession, job.session_id)
                if session_row is not None:
                    session_row.status = "stopped"
                    session_row.last_activity_at = now
                    session_row.updated_at = now
            else:
                raise RuntimeError("Sandbox finalization state changed unexpectedly")
        try:
            self._publish_update(
                conversation_id=conversation_id,
                user_id=user_id,
                change="files" if file_payloads else "job",
                payload={"job_id": str(job_id), "status": "succeeded", "finalized": True},
            )
        except Exception:
            # Durable chat/job state is authoritative; polling/reconnect can
            # recover when realtime enqueue is temporarily unavailable.
            pass
        return {"message_id": message_id, "files": file_payloads}

    def publish_current_job_status(self, *, job_id: str) -> dict[str, Any]:
        self.ensure_enabled()
        with app_session() as db:
            job = db.get(AppAiSandboxJob, str(job_id))
            if job is None:
                raise LookupError("Sandbox job was not found")
            session_row = db.get(AppAiSandboxSession, job.session_id)
            if session_row is None or int(session_row.user_id) != int(job.user_id):
                raise PermissionError("Sandbox job scope mismatch")
            bot, _ = self._require_conversation_in_session(
                db,
                conversation_id=job.conversation_id,
                user_id=int(job.user_id),
            )
            payload = self._status_payload(bot=bot, job=job)
            if job.status in {"failed", "cancelled", "expired"}:
                db.execute(
                    update(AppAiSandboxFile)
                    .where(
                        AppAiSandboxFile.job_id == job.id,
                        AppAiSandboxFile.delivery_status == "pending",
                    )
                    .values(delivery_status="unavailable", updated_at=_utc_now())
                )
        self._publish_update(
            conversation_id=job.conversation_id,
            user_id=int(job.user_id),
            change="job",
            payload=payload,
        )
        return {"job_id": job.id, "status": job.status}

    def get_worker_job_state(self, *, job_id: str) -> dict[str, Any]:
        """Read durable cancellation state even while execution is disabled."""

        with app_session() as db:
            job = db.get(AppAiSandboxJob, str(job_id))
            if job is None:
                raise LookupError("Sandbox job was not found")
            session_row = db.get(AppAiSandboxSession, job.session_id)
            if session_row is None or int(session_row.user_id) != int(job.user_id):
                raise PermissionError("Sandbox job scope mismatch")
            return {"job_id": job.id, "status": job.status}

    def request_archive(self, *, conversation_id: str, current_user_id: int) -> dict[str, Any]:
        return self._enqueue_utility_job(
            conversation_id=conversation_id,
            current_user_id=current_user_id,
            job_type="archive",
        )

    def request_file_attach(self, *, file_id: str, current_user_id: int) -> dict[str, Any]:
        self.ensure_enabled()
        with app_session() as db:
            file_row = db.get(AppAiSandboxFile, str(file_id))
            if file_row is None:
                raise LookupError("Sandbox file was not found")
            session_row = db.get(AppAiSandboxSession, file_row.session_id)
            if session_row is None or int(session_row.user_id) != int(current_user_id):
                raise PermissionError("Sandbox file does not belong to this user")
            if file_row.file_kind not in {"output", "changed", "archive"}:
                raise ValueError("Only sandbox result files may be attached")
            conversation_id = session_row.conversation_id
        return self._enqueue_utility_job(
            conversation_id=conversation_id,
            current_user_id=current_user_id,
            job_type="attach_file",
            target_file_id=str(file_id),
        )

    def _enqueue_utility_job(
        self,
        *,
        conversation_id: str,
        current_user_id: int,
        job_type: str,
        target_file_id: str | None = None,
    ) -> dict[str, Any]:
        settings = self.ensure_enabled()
        self._require_conversation(conversation_id=conversation_id, user_id=current_user_id)
        session = self.repository.get_session_for_conversation(
            conversation_id=str(conversation_id),
            user_id=int(current_user_id),
        )
        if session is None:
            raise LookupError("OpenCode workspace has not been created yet")
        now = _utc_now()
        with app_session() as db:
            active = db.execute(
                select(AppAiSandboxJob)
                .where(
                    AppAiSandboxJob.conversation_id == str(conversation_id),
                    AppAiSandboxJob.user_id == int(current_user_id),
                    AppAiSandboxJob.job_type == job_type,
                    AppAiSandboxJob.target_file_id == target_file_id,
                    AppAiSandboxJob.status.in_(ACTIVE_JOB_STATUSES),
                )
                .order_by(AppAiSandboxJob.created_at.desc())
                .limit(1)
            ).scalar_one_or_none()
            if active is not None:
                return {
                    "job_id": active.id,
                    "conversation_id": str(conversation_id),
                    "status": active.status,
                }
        job_id = str(uuid4())
        try:
            reserved = self.repository.reserve_job(
                SandboxJobRecord(
                    id=job_id,
                    session_id=session.id,
                    conversation_id=str(conversation_id),
                    user_id=int(current_user_id),
                    prompt_message_id=job_id,
                    status=SandboxJobStatus.PREPARING,
                    created_at=now,
                    deadline_at=now + timedelta(seconds=settings.limits.response_timeout_seconds),
                    job_type=job_type,
                    target_file_id=target_file_id,
                )
            )
        except SandboxRepositoryConflict:
            # A concurrent identical request may have won the one-active-job
            # constraint after the read above. Return that active job instead
            # of turning a harmless double click into a server error.
            with app_session() as db:
                active = db.execute(
                    select(AppAiSandboxJob)
                    .where(
                        AppAiSandboxJob.conversation_id == str(conversation_id),
                        AppAiSandboxJob.user_id == int(current_user_id),
                        AppAiSandboxJob.job_type == job_type,
                        AppAiSandboxJob.target_file_id == target_file_id,
                        AppAiSandboxJob.status.in_(ACTIVE_JOB_STATUSES),
                    )
                    .order_by(AppAiSandboxJob.created_at.desc())
                    .limit(1)
                ).scalar_one_or_none()
                if active is None:
                    raise
                return {
                    "job_id": active.id,
                    "conversation_id": str(conversation_id),
                    "status": active.status,
                }
        self.repository.replace_job_inputs(
            job_id=reserved.id,
            user_id=int(current_user_id),
            inputs=[],
            now=now,
        )
        queued = self.repository.activate_prepared_job(
            job_id=reserved.id,
            user_id=int(current_user_id),
            now=now,
        )
        if queued is None:
            raise RuntimeError("Sandbox utility job lost its reservation")
        self.repository.touch_session(
            session_id=session.id,
            user_id=int(current_user_id),
            now=now,
            expires_at=now + timedelta(days=settings.retention_days),
        )
        payload = {"job_id": queued.id, "conversation_id": str(conversation_id), "status": queued.status.value}
        self._publish_update(
            conversation_id=str(conversation_id),
            user_id=int(current_user_id),
            change="job",
            payload=payload,
        )
        return payload

    @staticmethod
    def _job_view(job: AppAiSandboxJob) -> dict[str, Any]:
        return {
            "id": job.id,
            "type": job.job_type,
            "status": job.status,
            "error_code": job.error_code or None,
            "created_at": _iso(job.created_at),
            "updated_at": _iso(job.updated_at),
        }

    @staticmethod
    def _attachment_download_url(file_row: AppAiSandboxFile | None) -> str | None:
        if file_row is None or not file_row.chat_message_id or not file_row.chat_attachment_id:
            return None
        return (
            f"/api/v1/chat/messages/{file_row.chat_message_id}/attachments/"
            f"{file_row.chat_attachment_id}/file"
        )

    @staticmethod
    def _attachment_save_url(file_row: AppAiSandboxFile | None) -> str | None:
        if file_row is None or not file_row.chat_message_id or not file_row.chat_attachment_id:
            return None
        return (
            f"/api/v1/chat/messages/{file_row.chat_message_id}/attachments/"
            f"{file_row.chat_attachment_id}/save-to-my-files"
        )

    def _file_payload(self, row: AppAiSandboxFile) -> dict[str, Any]:
        return {
            "id": row.id,
            "path": row.relative_path,
            "name": row.file_name,
            "kind": row.file_kind,
            "content_type": row.content_type,
            "size_bytes": max(0, int(row.size_bytes or 0)),
            "sha256": row.sha256 or None,
            "changed": bool(row.is_changed),
            "message_id": row.chat_message_id,
            "attachment_id": row.chat_attachment_id,
            "download_url": self._attachment_download_url(row),
            "save_to_my_files_url": self._attachment_save_url(row),
            "availability": row.delivery_status or "not_applicable",
        }

    @staticmethod
    def _permission_payload(row: AppAiSandboxPermission) -> dict[str, Any]:
        arguments = _json_loads(row.arguments_preview_json, {})
        return {
            "id": row.id,
            "tool": row.tool,
            "operation": row.operation,
            "summary": row.operation or row.tool,
            "arguments": arguments if isinstance(arguments, dict) else {},
            "requested_at": _iso(row.requested_at),
            "action_id": row.action_id,
            "status": row.status,
            "scope": row.grant_scope,
            "job_id": row.job_id,
            "session_id": row.session_id,
            "opencode_permission_id": row.opencode_permission_id,
        }

    @staticmethod
    def _status_payload(*, bot: AppAiBot, job: AppAiSandboxJob) -> dict[str, Any]:
        stage_by_status = {
            "preparing": "preparing",
            "queued": "queued",
            "claimed": "starting",
            "running": "running",
            "waiting_permission": "waiting_permission",
            "finalizing": "finalizing",
            "cleanup_pending": "stopping",
            "succeeded": "completed",
            "failed": "failed",
            "cancelled": "cancelled",
            "expired": "failed",
        }
        public_status = {
            "preparing": "queued",
            "queued": "queued",
            "claimed": "queued",
            "running": "running",
            "waiting_permission": "running",
            "finalizing": "running",
            "cleanup_pending": "cancelled" if job.cleanup_terminal_status == "cancelled" else "running",
            "succeeded": "completed",
            "failed": "failed",
            "cancelled": "cancelled",
            "expired": "failed",
        }.get(job.status, "failed")
        return {
            "conversation_id": job.conversation_id,
            "bot_id": bot.id,
            "bot_title": bot.title,
            "status": public_status,
            "stage": stage_by_status.get(job.status, job.status),
            "status_text": {
                "queued": "Запрос OpenCode поставлен в очередь",
                "running": "OpenCode работает в изолированной среде",
                "waiting_permission": "OpenCode ожидает подтверждения",
                "finalizing": "OpenCode сохраняет результат",
                "cleanup_pending": "Изолированная среда останавливается",
                "succeeded": "OpenCode завершил работу",
                "cancelled": "Работа OpenCode остановлена",
                "failed": "OpenCode не смог завершить работу",
                "expired": "Превышено время работы OpenCode",
            }.get(job.status, "OpenCode запускается"),
            "run_id": job.id,
            "error_text": job.error_code or None,
            "updated_at": _iso(job.updated_at),
        }

    @staticmethod
    def _publish_update(
        *,
        conversation_id: str,
        user_id: int,
        change: str,
        payload: dict[str, Any],
    ) -> None:
        from backend.ai_chat.service import ai_chat_service

        event_payload = {
            "conversation_id": str(conversation_id),
            "change": str(change),
            "job_id": payload.get("job_id") or payload.get("run_id") or payload.get("id"),
            "status": payload.get("status"),
            "permission_id": payload.get("permission_id"),
            "updated_at": _iso(_utc_now()),
        }
        ai_chat_service._enqueue_realtime_jobs(
            [
                {
                    "event_type": SANDBOX_REALTIME_EVENT,
                    "target_scope": "both",
                    "target_user_id": int(user_id),
                    "conversation_id": str(conversation_id),
                    "message_id": None,
                    "payload": event_payload,
                    "dedupe_key": None,
                }
            ]
        )
        if change == "job":
            with app_session() as db:
                mapping = db.execute(
                    select(AppAiBotConversation).where(
                        AppAiBotConversation.conversation_id == str(conversation_id),
                        AppAiBotConversation.user_id == int(user_id),
                    )
                ).scalar_one_or_none()
                bot = db.get(AppAiBot, mapping.bot_id) if mapping is not None else None
            if bot is not None:
                raw_status = str(payload.get("status") or "queued")
                public_status = {
                    "preparing": "queued",
                    "queued": "queued",
                    "claimed": "queued",
                    "running": "running",
                    "waiting_permission": "running",
                    "finalizing": "running",
                    "cleanup_pending": "running",
                    "succeeded": "completed",
                    "completed": "completed",
                    "failed": "failed",
                    "expired": "failed",
                    "cancelled": "cancelled",
                }.get(raw_status, raw_status)
                ai_chat_service._publish_status_event(
                    conversation_id=str(conversation_id),
                    user_id=int(user_id),
                    bot=bot,
                    status=public_status,
                    stage=str(payload.get("stage") or raw_status),
                    status_text=str(payload.get("status_text") or "") or None,
                    run_id=str(payload.get("job_id") or payload.get("run_id") or payload.get("id") or ""),
                    error_text=str(payload.get("error_text") or "") or None,
                )


ai_sandbox_app_service = AiSandboxAppService()
