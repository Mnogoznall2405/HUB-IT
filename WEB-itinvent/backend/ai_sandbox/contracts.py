from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any


class SandboxSessionStatus(str, Enum):
    NEW = "new"
    READY = "ready"
    BUSY = "busy"
    STOPPED = "stopped"
    PURGING = "purging"
    PURGED = "purged"
    FAILED = "failed"


class SandboxJobStatus(str, Enum):
    PREPARING = "preparing"
    QUEUED = "queued"
    CLAIMED = "claimed"
    RUNNING = "running"
    WAITING_PERMISSION = "waiting_permission"
    FINALIZING = "finalizing"
    CLEANUP_PENDING = "cleanup_pending"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class SandboxExecutionCancelled(RuntimeError):
    """Raised after OpenCode abort when the HUB job was cancelled."""


class PermissionDisposition(str, Enum):
    ALLOW = "allow"
    ASK = "ask"
    DENY = "deny"


class PermissionGrantScope(str, Enum):
    ONCE = "once"
    SESSION = "session"


class BasicAuthCredentials:
    """Session-local credentials whose representation never contains secrets.

    The gateway bearer is a short-lived HUB token scoped to one sandbox
    session. It is not a RouterAI/provider API key.
    """

    __slots__ = ("username", "_password", "_gateway_bearer_token")

    def __init__(self, *, username: str, password: str, gateway_bearer_token: str) -> None:
        self.username = username
        self._password = password
        self._gateway_bearer_token = gateway_bearer_token

    def reveal_password(self) -> str:
        return self._password

    def reveal_gateway_bearer_token(self) -> str:
        return self._gateway_bearer_token

    def __repr__(self) -> str:
        return (
            f"BasicAuthCredentials(username={self.username!r}, "
            "password=<redacted>, gateway_bearer_token=<redacted>)"
        )


@dataclass(frozen=True)
class WorkspaceLease:
    session_id: str
    path: Path
    quota_bytes: int
    quota_verified: bool


@dataclass(frozen=True)
class SandboxSessionRecord:
    id: str
    conversation_id: str
    user_id: int
    workspace_key: str
    status: SandboxSessionStatus
    created_at: datetime
    last_activity_at: datetime
    expires_at: datetime
    credential_ref: str
    opencode_session_id: str | None = None
    purge_token: str | None = None
    inherits_personal_memory: bool = False


@dataclass(frozen=True)
class SandboxJobRecord:
    id: str
    session_id: str
    conversation_id: str
    user_id: int
    prompt_message_id: str
    status: SandboxJobStatus
    created_at: datetime
    deadline_at: datetime
    job_type: str = "prompt"
    target_file_id: str | None = None
    claimed_by: str | None = None
    claimed_at: datetime | None = None
    heartbeat_at: datetime | None = None
    attempt: int = 0
    result: dict[str, Any] = field(default_factory=dict)
    finalization_state: str = "not_required"
    finalization_markdown: str = field(default="", repr=False)
    assistant_message_id: str | None = None
    cleanup_terminal_status: str | None = None


@dataclass(frozen=True)
class PermissionRequest:
    id: str
    session_id: str
    job_id: str
    tool: str
    operation: str
    arguments_preview: dict[str, Any]
    requested_at: datetime


@dataclass(frozen=True)
class CleanAttachment:
    attachment_id: str
    conversation_id: str
    owner_user_id: int
    source_path: Path
    original_name: str
    size_bytes: int
    antivirus_status: str


@dataclass(frozen=True)
class SandboxAttachmentReference:
    """Opaque chat attachment reference accepted by the app/chat process."""

    attachment_id: str
    message_id: str


@dataclass(frozen=True)
class VerifiedAttachmentInput:
    """Redacted metadata persisted for worker-side internal transfer."""

    attachment_id: str
    message_id: str
    normalized_name: str
    size_bytes: int
    content_type: str
    sha256: str
