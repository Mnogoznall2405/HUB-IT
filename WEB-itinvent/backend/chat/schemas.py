"""Pydantic models for chat API."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class ChatUserSummary(BaseModel):
    id: int
    username: str
    full_name: Optional[str] = None
    role: str = "viewer"
    is_active: bool = True
    presence: Optional["ChatPresenceSummary"] = None


class ChatMemberResponse(BaseModel):
    user: ChatUserSummary
    member_role: str = "member"
    joined_at: str


class ChatReplyPreview(BaseModel):
    id: str
    sender_name: str
    kind: Literal["text", "task_share", "file"] = "text"
    body: str = ""
    task_title: Optional[str] = None
    attachments_count: int = 0


class ChatForwardPreview(BaseModel):
    id: str
    sender_name: str
    kind: Literal["text", "task_share", "file"] = "text"
    body: str = ""
    task_title: Optional[str] = None
    attachments_count: int = 0


class ChatMessageResponse(BaseModel):
    id: str
    conversation_id: str
    kind: Literal["text", "task_share", "file"] = "text"
    body_format: Literal["plain", "markdown"] = "plain"
    client_message_id: Optional[str] = None
    sender: ChatUserSummary
    body: str
    created_at: str
    edited_at: Optional[str] = None
    is_own: bool = False
    delivery_status: Optional[Literal["sent", "read"]] = None
    read_by_count: int = 0
    reply_preview: Optional["ChatReplyPreview"] = None
    forward_preview: Optional["ChatForwardPreview"] = None
    task_preview: Optional["ChatTaskPreview"] = None
    attachments: list["ChatAttachmentResponse"] = Field(default_factory=list)
    action_card: Optional[dict[str, Any]] = None


class ChatConversationSummary(BaseModel):
    id: str
    kind: Literal["direct", "group", "ai"]
    title: str
    created_at: str
    updated_at: str
    last_message_at: Optional[str] = None
    last_message_preview: str = ""
    unread_count: int = 0
    member_count: int = 0
    online_member_count: int = 0
    is_pinned: bool = False
    is_muted: bool = False
    is_archived: bool = False
    member_preview: list[ChatMemberResponse] = Field(default_factory=list)
    direct_peer: Optional[ChatUserSummary] = None


class ChatConversationListResponse(BaseModel):
    items: list[ChatConversationSummary] = Field(default_factory=list)


class ChatConversationDetailResponse(ChatConversationSummary):
    members: list[ChatMemberResponse] = Field(default_factory=list)


class ChatMessageListResponse(BaseModel):
    items: list[ChatMessageResponse] = Field(default_factory=list)
    has_more: bool = False
    has_older: bool = False
    has_newer: bool = False
    cursor_invalid: bool = False
    older_cursor_message_id: Optional[str] = None
    newer_cursor_message_id: Optional[str] = None
    viewer_last_read_message_id: Optional[str] = None
    viewer_last_read_at: Optional[str] = None


class ChatThreadBootstrapResponse(ChatMessageListResponse):
    initial_anchor_mode: Literal["bottom", "message", "first_unread"] = "bottom"
    initial_anchor_message_id: Optional[str] = None


class ChatMessageSearchResponse(BaseModel):
    items: list[ChatMessageResponse] = Field(default_factory=list)
    has_more: bool = False


class ChatHealthResponse(BaseModel):
    enabled: bool = False
    configured: bool = False
    available: bool = False
    database_url_masked: Optional[str] = None
    realtime_mode: str = "local"
    redis_available: bool = False
    redis_configured: bool = False
    pubsub_subscribed: bool = False
    realtime_node_id: Optional[str] = None
    outbound_queue_depth: int = 0
    slow_consumer_disconnects: int = 0
    presence_watch_count: int = 0
    local_connection_count: int = 0
    push_outbox_backlog: int = 0
    push_outbox_ready: int = 0
    push_outbox_processing: int = 0
    push_outbox_failed: int = 0
    push_outbox_oldest_queued_age_sec: float = 0.0
    event_outbox_backlog: int = 0
    event_outbox_processing: int = 0
    event_outbox_failed: int = 0
    event_outbox_oldest_queued_age_sec: float = 0.0
    event_dispatcher_active: bool = False
    event_outbox_avg_job_ms: float = 0.0
    ws_rate_limited_count: int = 0
    ws_rate_limited_connections: int = 0
    ai_worker_concurrency: int = 0
    ai_kb_index_age_sec: float = 0.0
    ai_last_run_duration_ms: float = 0.0


class DirectConversationRequest(BaseModel):
    peer_user_id: int = Field(..., gt=0)


class ChatTaskPreview(BaseModel):
    id: str
    title: str
    status: str = "new"
    priority: str = "normal"
    assignee_full_name: Optional[str] = None
    assignee_username: Optional[str] = None
    due_at: Optional[str] = None
    is_overdue: bool = False


class GroupConversationRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    member_user_ids: list[int] = Field(default_factory=list)

    @field_validator("title", mode="before")
    @classmethod
    def _normalize_title(cls, value):
        return str(value or "").strip()


class SendMessageRequest(BaseModel):
    body: str = Field(..., min_length=1, max_length=12000)
    body_format: Literal["plain", "markdown"] = "plain"
    client_message_id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    reply_to_message_id: Optional[str] = Field(default=None, min_length=1, max_length=64)

    @field_validator("body", mode="before")
    @classmethod
    def _normalize_body(cls, value):
        return str(value or "").strip()

    @field_validator("client_message_id", "reply_to_message_id", mode="before")
    @classmethod
    def _normalize_optional_message_id(cls, value):
        text = str(value or "").strip()
        return text or None


class ForwardMessageRequest(BaseModel):
    source_message_id: str = Field(..., min_length=1, max_length=64)
    body_format: Literal["plain", "markdown"] = "plain"
    body: Optional[str] = Field(default=None, max_length=12000)
    reply_to_message_id: Optional[str] = Field(default=None, min_length=1, max_length=64)

    @field_validator("source_message_id", mode="before")
    @classmethod
    def _normalize_source_message_id(cls, value):
        return str(value or "").strip()

    @field_validator("body", mode="before")
    @classmethod
    def _normalize_body(cls, value):
        text = str(value or "").strip()
        return text or None

    @field_validator("reply_to_message_id", mode="before")
    @classmethod
    def _normalize_reply_to_message_id(cls, value):
        text = str(value or "").strip()
        return text or None


class MarkReadRequest(BaseModel):
    message_id: str = Field(..., min_length=1, max_length=64)


class ChatUsersResponse(BaseModel):
    items: list[ChatUserSummary] = Field(default_factory=list)


class TaskShareMessageRequest(BaseModel):
    task_id: str = Field(..., min_length=1, max_length=64)
    reply_to_message_id: Optional[str] = Field(default=None, min_length=1, max_length=64)

    @field_validator("task_id", mode="before")
    @classmethod
    def _normalize_task_id(cls, value):
        return str(value or "").strip()

    @field_validator("reply_to_message_id", mode="before")
    @classmethod
    def _normalize_reply_to_message_id(cls, value):
        text = str(value or "").strip()
        return text or None


class UpdateConversationSettingsRequest(BaseModel):
    is_pinned: Optional[bool] = None
    is_muted: Optional[bool] = None
    is_archived: Optional[bool] = None


class ChatShareableTasksResponse(BaseModel):
    items: list[ChatTaskPreview] = Field(default_factory=list)


class ChatAttachmentResponse(BaseModel):
    id: str
    file_name: str
    mime_type: Optional[str] = None
    file_size: int = 0
    width: Optional[int] = None
    height: Optional[int] = None
    variant_urls: dict[str, str] = Field(default_factory=dict)
    created_at: str


class ChatConversationAttachmentItemResponse(BaseModel):
    id: str
    message_id: str
    kind: Literal["image", "video", "file", "audio"] = "file"
    file_name: str
    mime_type: Optional[str] = None
    file_size: int = 0
    width: Optional[int] = None
    height: Optional[int] = None
    variant_urls: dict[str, str] = Field(default_factory=dict)
    created_at: str


class ChatConversationAssetsSummaryResponse(BaseModel):
    photos_count: int = 0
    videos_count: int = 0
    files_count: int = 0
    audio_count: int = 0
    shared_tasks_count: int = 0
    recent_photos: list[ChatConversationAttachmentItemResponse] = Field(default_factory=list)
    recent_videos: list[ChatConversationAttachmentItemResponse] = Field(default_factory=list)
    recent_files: list[ChatConversationAttachmentItemResponse] = Field(default_factory=list)
    recent_audio: list[ChatConversationAttachmentItemResponse] = Field(default_factory=list)


class ChatConversationAttachmentsResponse(BaseModel):
    items: list[ChatConversationAttachmentItemResponse] = Field(default_factory=list)
    has_more: bool = False
    next_before_attachment_id: Optional[str] = None


class ChatUploadSessionFileRequest(BaseModel):
    file_name: str = Field(..., min_length=1, max_length=255)
    mime_type: Optional[str] = Field(default=None, max_length=255)
    size: int = Field(..., gt=0, le=25 * 1024 * 1024)
    original_size: int = Field(..., gt=0, le=25 * 1024 * 1024)
    transfer_encoding: Literal["identity", "gzip"] = "identity"

    @field_validator("file_name", "mime_type", mode="before")
    @classmethod
    def _normalize_text(cls, value):
        text = str(value or "").strip()
        return text or None

    @field_validator("transfer_encoding", mode="before")
    @classmethod
    def _normalize_transfer_encoding(cls, value):
        text = str(value or "identity").strip().lower()
        return text or "identity"


class ChatUploadSessionCreateRequest(BaseModel):
    body: Optional[str] = Field(default=None, max_length=12000)
    reply_to_message_id: Optional[str] = Field(default=None, min_length=1, max_length=64)
    files: list[ChatUploadSessionFileRequest] = Field(default_factory=list)

    @field_validator("body", "reply_to_message_id", mode="before")
    @classmethod
    def _normalize_text(cls, value):
        text = str(value or "").strip()
        return text or None


class ChatUploadSessionFileResponse(BaseModel):
    file_id: str
    file_name: str
    mime_type: Optional[str] = None
    size: int = 0
    original_size: int = 0
    transfer_encoding: Literal["identity", "gzip"] = "identity"
    chunk_count: int = 0
    received_bytes: int = 0
    received_chunks: list[int] = Field(default_factory=list)


class ChatUploadSessionResponse(BaseModel):
    session_id: str
    chunk_size_bytes: int = 0
    expires_at: str
    status: Literal["pending", "completed"] = "pending"
    message_id: Optional[str] = None
    files: list[ChatUploadSessionFileResponse] = Field(default_factory=list)


class ChatUploadSessionChunkResponse(BaseModel):
    session_id: str
    file_id: str
    chunk_index: int = 0
    already_present: bool = False
    received_bytes: int = 0
    received_chunks: list[int] = Field(default_factory=list)
    file_complete: bool = False


class ChatUploadSessionCancelResponse(BaseModel):
    ok: bool = True


class ChatUnreadSummaryResponse(BaseModel):
    messages_unread_total: int = 0
    conversations_unread: int = 0


class ChatPushConfigResponse(BaseModel):
    enabled: bool = False
    vapid_public_key: Optional[str] = None
    requires_installed_pwa: bool = False
    icon_url: str = "/pwa-192.png"
    badge_url: str = "/hubit-badge.svg"


class ChatPushSubscriptionKeysRequest(BaseModel):
    p256dh: str = Field(..., min_length=1, max_length=512)
    auth: str = Field(..., min_length=1, max_length=512)

    @field_validator("p256dh", "auth", mode="before")
    @classmethod
    def _normalize_key(cls, value):
        return str(value or "").strip()


class ChatPushSubscriptionRequest(BaseModel):
    endpoint: str = Field(..., min_length=1, max_length=2048)
    expiration_time: Optional[int] = None
    keys: ChatPushSubscriptionKeysRequest
    user_agent: Optional[str] = Field(default=None, max_length=512)
    platform: Optional[str] = Field(default=None, max_length=128)
    browser_family: Optional[str] = Field(default=None, max_length=64)
    install_mode: Optional[str] = Field(default=None, max_length=64)

    @field_validator("endpoint", "user_agent", "platform", "browser_family", "install_mode", mode="before")
    @classmethod
    def _normalize_text(cls, value):
        text = str(value or "").strip()
        return text or None


class ChatPushSubscriptionDeleteRequest(BaseModel):
    endpoint: str = Field(..., min_length=1, max_length=2048)

    @field_validator("endpoint", mode="before")
    @classmethod
    def _normalize_endpoint(cls, value):
        return str(value or "").strip()


class ChatPushSubscriptionStatusResponse(BaseModel):
    ok: bool = True
    subscribed: bool = False
    push_enabled: bool = False


class ChatPresenceSummary(BaseModel):
    is_online: bool = False
    last_seen_at: Optional[str] = None
    status_text: str = ""


class ChatMessageReadReceipt(BaseModel):
    user: ChatUserSummary
    read_at: str


class ChatMessageReadsResponse(BaseModel):
    items: list[ChatMessageReadReceipt] = Field(default_factory=list)


ChatMessageResponse.model_rebuild()
ChatUserSummary.model_rebuild()
ChatMessageReadReceipt.model_rebuild()
