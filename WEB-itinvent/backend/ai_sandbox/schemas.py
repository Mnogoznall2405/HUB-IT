from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class SandboxSessionView(BaseModel):
    id: str
    status: str
    last_activity_at: str
    expires_at: str


class SandboxJobView(BaseModel):
    id: str
    type: Literal["prompt", "archive", "attach_file"]
    status: str
    error_code: str | None = None
    created_at: str
    updated_at: str


class SandboxFileView(BaseModel):
    id: str
    path: str
    name: str
    kind: Literal["input", "output", "changed", "archive"]
    content_type: str
    size_bytes: int = Field(ge=0)
    sha256: str | None = None
    changed: bool = False
    message_id: str | None = None
    attachment_id: str | None = None
    download_url: str | None = None
    save_to_my_files_url: str | None = None
    availability: Literal["not_applicable", "pending", "attached", "unavailable"] = "not_applicable"


class SandboxDiffView(BaseModel):
    file_id: str
    path: str
    status: Literal["added", "modified"]
    patch: str
    truncated: bool = False


class SandboxPermissionView(BaseModel):
    id: str
    tool: str
    operation: str
    summary: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    requested_at: str
    action_id: str | None = None


class SandboxArchiveView(BaseModel):
    status: str | None = None
    job_id: str | None = None
    message_id: str | None = None
    attachment_id: str | None = None
    download_url: str | None = None
    save_to_my_files_url: str | None = None


class SandboxConversationView(BaseModel):
    enabled: bool
    conversation_id: str
    session: SandboxSessionView | None = None
    job: SandboxJobView | None = None
    files: list[SandboxFileView] = Field(default_factory=list)
    diff: list[SandboxDiffView] = Field(default_factory=list)
    pending_permissions: list[SandboxPermissionView] = Field(default_factory=list)
    archive: SandboxArchiveView | None = None


class SandboxPermissionResponseRequest(BaseModel):
    decision: Literal["allow", "reject"]
    scope: Literal["once", "session"] = "once"


class SandboxPermissionResponseResult(BaseModel):
    id: str
    status: Literal["approved", "rejected"]
    scope: Literal["once", "session"] | None = None
    conversation_id: str
    job_id: str


class SandboxJobAccepted(BaseModel):
    job_id: str
    conversation_id: str
    status: str


class SandboxInputTransferGrantView(BaseModel):
    grant_id: str
    file_id: str
    file_name: str
    content_type: str
    size_bytes: int = Field(ge=0, le=256 * 1024**2)
    sha256: str = Field(min_length=64, max_length=64)
    download_path: str
    token: str = Field(min_length=32, max_length=512, repr=False)
    expires_at: str


class SandboxJobManifestView(BaseModel):
    job_id: str
    conversation_id: str
    job_type: Literal["prompt", "archive", "attach_file"]
    target_file_id: str | None = None
    target_file: dict[str, Any] | None = None
    prompt: str = Field(max_length=1_048_576)
    inputs: list[SandboxInputTransferGrantView] = Field(default_factory=list)


class SandboxOutputTransferGrantView(BaseModel):
    grant_id: str
    upload_path: str
    token: str = Field(min_length=32, max_length=512, repr=False)
    size_bytes: int = Field(ge=0, le=1024**3)
    sha256: str = Field(min_length=64, max_length=64)
    expires_at: str


class SandboxOutputTransferResult(BaseModel):
    file_id: str
    message_id: str
    attachment_id: str


class SandboxWorkerPermissionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(min_length=1, max_length=64)
    opencode_permission_id: str = Field(min_length=1, max_length=200)
    tool: str = Field(min_length=1, max_length=64)
    operation: str = Field(default="", max_length=2_000)
    arguments: dict[str, Any] = Field(default_factory=dict)


class SandboxWorkerPermissionState(BaseModel):
    id: str
    status: Literal["pending", "approved", "rejected", "expired"]
    scope: Literal["once", "session"] | None = None
    job_id: str
    session_id: str
    opencode_permission_id: str


class SandboxWorkerFileMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1, max_length=1024)
    name: str = Field(min_length=1, max_length=255)
    kind: Literal["output", "changed", "archive"]
    content_type: str = Field(default="application/octet-stream", max_length=255)
    size_bytes: int = Field(ge=0, le=1024**3)
    sha256: str = Field(min_length=64, max_length=64)
    changed: bool = False
    diff: str = Field(default="", max_length=100_000)


class SandboxWorkerResultRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    opencode_session_id: str | None = Field(default=None, max_length=200)
    assistant_markdown: str = Field(default="", max_length=1_048_576)
    files: list[SandboxWorkerFileMetadata] = Field(default_factory=list, max_length=5)


class SandboxWorkerResultResponse(BaseModel):
    message_id: str | None = None
    files: list[SandboxFileView] = Field(default_factory=list)


class SandboxWorkerFinalizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assistant_markdown: str = Field(default="", max_length=1_048_576)


class SandboxWorkerJobState(BaseModel):
    job_id: str
    status: str
