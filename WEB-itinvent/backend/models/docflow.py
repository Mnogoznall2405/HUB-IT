"""Typed API contracts for the personal 1C Document Management integration."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


class DocflowCredentialsInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    login: str = Field(..., min_length=1, max_length=128)
    password: SecretStr = Field(..., min_length=1, max_length=256, repr=False)

    @field_validator("password")
    @classmethod
    def password_must_not_be_blank(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value():
            raise ValueError("password must not be empty")
        return value


class DocflowCredentialProfile(BaseModel):
    configured: bool
    login: str | None = None
    status: Literal["not_configured", "configured", "valid", "invalid", "unavailable"]
    last_error_code: str | None = None
    last_verified_at: datetime | None = None
    updated_at: datetime | None = None


class DocflowConnectionTestResponse(BaseModel):
    connected: bool
    configuration: str
    verified_at: datetime


class DocflowTaskSummary(BaseModel):
    ref: str
    task_type: str
    task_type_label: str
    title: str
    number: str | None = None
    created_at: str | None = None
    due_at: str | None = None
    author: str | None = None
    subject: str | None = None
    description: str | None = None
    result: str | None = None
    business_state: str | None = None
    importance: str | None = None
    accepted: bool | None = None
    completed_at: str | None = None
    completed: bool = False


class DocflowTaskFileSummary(BaseModel):
    ref: str
    name: str
    extension: str = ""
    content_type: str = "application/octet-stream"
    size: int = Field(default=0, ge=0)
    created_at: str | None = None
    description: str | None = None
    preview_supported: bool = False


class DocflowAvailableAction(BaseModel):
    code: Literal["acknowledge", "approve", "approve_with_comments", "reject", "complete"]
    label: str
    tone: Literal["primary", "success", "error", "warning"] = "primary"
    comment_mode: Literal["optional", "required"] = "optional"


class DocflowRelatedObject(BaseModel):
    ref: str
    object_type: str | None = None
    object_type_label: str | None = None
    title: str


class DocflowTaskDetail(DocflowTaskSummary):
    xdto_task_type: str | None = None
    process_name: str | None = None
    process_ref: str | None = None
    process_type: str | None = None
    process_type_label: str | None = None
    xdto_process_type: str | None = None
    dm_version: str | None = None
    configuration_fingerprint: str | None = None
    state_token: str | None = None
    available_actions: list[DocflowAvailableAction] = Field(default_factory=list)
    action_unavailable_reason: str | None = None
    requires_digital_signature: bool = False
    open_in_1c_url: str | None = None
    related_objects: list[DocflowRelatedObject] = Field(default_factory=list)
    files: list[DocflowTaskFileSummary] = Field(default_factory=list)
    files_incomplete: bool = False


class DocflowTaskListResponse(BaseModel):
    items: list[DocflowTaskSummary] = Field(default_factory=list)
    returned: int = 0
    scope: Literal["inbox", "completed", "all"] = "inbox"
    source: Literal["live_1c"] = "live_1c"
    as_of: datetime
    truncated: bool = False


class DocflowMetadataType(BaseModel):
    name: str
    label: str
    attributes: list[str] = Field(default_factory=list)


class DocflowMetadataResponse(BaseModel):
    configuration: str
    task_types: list[DocflowMetadataType] = Field(default_factory=list)
    process_types: list[DocflowMetadataType] = Field(default_factory=list)
    active_task_type: str | None = None
    mapping_ready: bool = False


class DocflowTaskActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    action: Literal["acknowledge", "approve", "approve_with_comments", "reject", "complete"]
    comment: str = Field(default="", max_length=2000)
    state_token: str = Field(..., min_length=16, max_length=512)


class DocflowCommandResponse(BaseModel):
    command_id: str
    status: Literal["applied", "already_applied", "state_unknown", "rejected", "pending"]
    task: DocflowTaskDetail | None = None
    correlation_id: str
    error_code: str | None = None


class DocflowInboxSummary(BaseModel):
    status: Literal["not_configured", "available", "unavailable"]
    count: int | None = Field(default=None, ge=0)
    as_of: datetime
    truncated: bool = False


class DocflowAssignmentCapability(BaseModel):
    enabled: bool
    reason: str | None = None
    document_types: list[Literal["internal", "incoming", "outgoing"]] = Field(default_factory=list)
    test_only: bool = True
    required_title_prefix: str | None = None


class DocflowAssignmentDocument(BaseModel):
    ref: str
    document_type: Literal["internal", "incoming", "outgoing"]
    document_type_label: str
    title: str
    number: str | None = None
    date: str | None = None


class DocflowAssignmentAssignee(BaseModel):
    ref: str
    name: str
    department: str | None = None


class DocflowAssignmentDocumentList(BaseModel):
    items: list[DocflowAssignmentDocument] = Field(default_factory=list)
    returned: int = 0
    truncated: bool = False
    reason: str | None = None
    as_of: datetime


class DocflowAssignmentAssigneeList(BaseModel):
    items: list[DocflowAssignmentAssignee] = Field(default_factory=list)
    returned: int = 0
    truncated: bool = False
    reason: str | None = None
    as_of: datetime


class DocflowAssignmentCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    document_type: Literal["internal", "incoming", "outgoing"]
    document_ref: str = Field(..., min_length=36, max_length=36)
    assignee_ref: str = Field(..., min_length=36, max_length=36)
    controller_ref: str | None = Field(default=None, min_length=36, max_length=36)
    due_at: datetime
    importance: Literal["normal", "high"] = "normal"
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=1, max_length=2000)


class DocflowCreatedAssignment(BaseModel):
    process_ref: str
    task_ref: str | None = None
    title: str
    state: str | None = None
    task_completed: bool | None = None


class DocflowAssignmentCommandResponse(BaseModel):
    command_id: str
    status: Literal["applied", "already_applied", "state_unknown", "rejected", "pending"]
    assignment: DocflowCreatedAssignment | None = None
    correlation_id: str
    error_code: str | None = None
