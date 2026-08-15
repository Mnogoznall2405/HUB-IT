from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class AiBotSummaryResponse(BaseModel):
    id: str
    slug: str
    title: str
    description: str = ""
    conversation_id: Optional[str] = None
    conversation_ids: list[str] = Field(default_factory=list)
    surface: str = "corporate"
    placement: str = "pinned"
    sort_order: int = 100
    allow_file_input: bool = True
    allow_generated_artifacts: bool = True
    allow_kb_document_delivery: bool = False
    is_enabled: bool = True
    configured: bool = False
    live_data_enabled: bool = False


class AiBotListResponse(BaseModel):
    items: list[AiBotSummaryResponse] = Field(default_factory=list)
    configured: bool = False


class AiBotAdminResponse(AiBotSummaryResponse):
    model: str = ""
    system_prompt: str = ""
    temperature: float = 0.2
    max_tokens: int = 2000
    allowed_kb_scope: list[str] = Field(default_factory=list)
    enabled_tools: list[str] = Field(default_factory=list)
    tool_settings: dict[str, Any] = Field(default_factory=dict)
    bot_user_id: Optional[int] = None
    required_permission: str = "chat.ai.use"
    use_personal_memory: bool = True
    openrouter_configured: bool = False
    updated_at: Optional[str] = None
    latest_run_status: Optional[str] = None
    latest_run_error: Optional[str] = None


class AiBotCreateRequest(BaseModel):
    slug: str = Field(..., min_length=2, max_length=80)
    title: str = Field(..., min_length=2, max_length=255)
    description: str = Field(default="", max_length=2000)
    system_prompt: str = Field(default="", max_length=40000)
    model: str = Field(default="", max_length=255)
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    max_tokens: int = Field(default=2000, ge=256, le=16000)
    allowed_kb_scope: list[str] = Field(default_factory=list)
    enabled_tools: list[str] = Field(default_factory=list)
    tool_settings: dict[str, Any] = Field(default_factory=dict)
    allow_file_input: bool = True
    allow_generated_artifacts: bool = True
    allow_kb_document_delivery: bool = False
    surface: Literal["corporate", "general", "sandbox"] = "corporate"
    placement: Literal["pinned", "hidden"] = "pinned"
    sort_order: int = Field(default=100, ge=0, le=10000)
    required_permission: str = Field(default="chat.ai.use", max_length=128)
    use_personal_memory: bool = True
    is_enabled: bool = True

    @field_validator("slug", mode="before")
    @classmethod
    def _normalize_slug(cls, value):
        return str(value or "").strip().lower()


class AiBotUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    system_prompt: Optional[str] = Field(default=None, max_length=40000)
    model: Optional[str] = Field(default=None, max_length=255)
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(default=None, ge=256, le=16000)
    allowed_kb_scope: Optional[list[str]] = None
    enabled_tools: Optional[list[str]] = None
    tool_settings: Optional[dict[str, Any]] = None
    allow_file_input: Optional[bool] = None
    allow_generated_artifacts: Optional[bool] = None
    allow_kb_document_delivery: Optional[bool] = None
    surface: Optional[Literal["corporate", "general", "sandbox"]] = None
    placement: Optional[Literal["pinned", "hidden"]] = None
    sort_order: Optional[int] = Field(default=None, ge=0, le=10000)
    required_permission: Optional[str] = Field(default=None, max_length=128)
    use_personal_memory: Optional[bool] = None
    is_enabled: Optional[bool] = None


class AiBotRunResponse(BaseModel):
    id: str
    bot_id: str
    conversation_id: str
    user_id: int
    trigger_message_id: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"] = "queued"
    stage: Optional[str] = None
    status_text: Optional[str] = None
    error_text: Optional[str] = None
    latency_ms: Optional[int] = None
    effective_database_id: Optional[str] = None
    tool_traces_count: int = 0
    tool_trace_errors_count: int = 0
    usage: dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


class AiBotRunListResponse(BaseModel):
    items: list[AiBotRunResponse] = Field(default_factory=list)


class AiConversationStatusResponse(BaseModel):
    conversation_id: str
    bot_id: str
    bot_title: str
    status: Optional[Literal["queued", "running", "completed", "failed", "cancelled"]] = None
    stage: Optional[str] = None
    status_text: Optional[str] = None
    run_id: Optional[str] = None
    error_text: Optional[str] = None
    updated_at: Optional[str] = None


class AiConversationUpdateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)

    @field_validator("title", mode="before")
    @classmethod
    def _normalize_title(cls, value):
        return str(value or "").strip()


class AiMemorySettingsRequest(BaseModel):
    enabled: bool


class AiMemoryUpdateRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=1000)

    @field_validator("content", mode="before")
    @classmethod
    def _normalize_content(cls, value):
        return str(value or "").strip()


class AiMemoryItemResponse(BaseModel):
    id: str
    content: str
    category: str = "preference"
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AiMemoryListResponse(BaseModel):
    enabled: bool = True
    items: list[AiMemoryItemResponse] = Field(default_factory=list)
    limits: dict[str, int] = Field(default_factory=lambda: {"max_facts": 20, "max_tokens": 4000})
