"""Hub chat tools for ai_chat: resolve recipients and draft a message send."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, field_validator

from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    CHAT_TOOL_ACTION_MESSAGE_SEND_DRAFT,
    CHAT_TOOL_CONVERSATIONS_SEARCH,
    CHAT_TOOL_USERS_SEARCH,
)
from backend.ai_chat.tools.registry import ai_tool_registry
from backend.chat.service import chat_service
from backend.services.user_service import user_service

MAX_LIMIT = 20


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _user_card(user: dict) -> dict:
    return {
        "id": int(user.get("id") or 0),
        "username": _normalize_text(user.get("username")) or None,
        "display_name": (
            _normalize_text(user.get("display_name"))
            or _normalize_text(user.get("full_name"))
            or _normalize_text(user.get("username"))
            or None
        ),
        "department": _normalize_text(user.get("department")) or None,
    }


class ChatUsersSearchArgs(BaseModel):
    query: str = Field(..., min_length=1, max_length=200)
    limit: int = Field(default=8, ge=1, le=MAX_LIMIT)

    @field_validator("query", mode="before")
    @classmethod
    def _normalize(cls, value):
        return _normalize_text(value)


class ChatConversationsSearchArgs(BaseModel):
    query: Optional[str] = Field(default=None, max_length=200)
    limit: int = Field(default=10, ge=1, le=MAX_LIMIT)

    @field_validator("query", mode="before")
    @classmethod
    def _normalize(cls, value):
        text = _normalize_text(value)
        return text or None


class ChatMessageSendDraftArgs(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    peer_user_id: Optional[int] = Field(default=None, gt=0)
    peer_name: Optional[str] = Field(default=None, max_length=200)
    conversation_id: Optional[str] = Field(default=None, max_length=200)
    conversation_title: Optional[str] = Field(default=None, max_length=300)

    @field_validator("text", "peer_name", "conversation_id", "conversation_title", mode="before")
    @classmethod
    def _normalize(cls, value):
        text = _normalize_text(value)
        return text or None


class ChatUsersSearchTool(AiTool):
    tool_id = CHAT_TOOL_USERS_SEARCH
    description = (
        "Find Hub users (colleagues) by name, username or department. "
        "Use before chat.action.message_send_draft to resolve peer_user_id."
    )
    input_model = ChatUsersSearchArgs
    stage = "checking_chat"

    def execute(self, *, context: AiToolExecutionContext, args: ChatUsersSearchArgs) -> AiToolResult:
        try:
            result = user_service.search_users(
                query=args.query,
                limit=int(args.limit or 8),
                status="active",
                exclude_user_id=int(context.user_id or 0) or None,
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))
        items = result.get("items") if isinstance(result, dict) else list(result or [])
        users = [
            _user_card(user)
            for user in (items or [])
            if isinstance(user, dict) and int(user.get("id") or 0) > 0
        ]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={"count": len(users), "items": users},
        )


class ChatConversationsSearchTool(AiTool):
    tool_id = CHAT_TOOL_CONVERSATIONS_SEARCH
    description = (
        "Search Hub chat conversations the current user belongs to by title. "
        "Use to resolve conversation_id for chat.action.message_send_draft."
    )
    input_model = ChatConversationsSearchArgs
    stage = "checking_chat"

    def execute(self, *, context: AiToolExecutionContext, args: ChatConversationsSearchArgs) -> AiToolResult:
        try:
            result = chat_service.list_conversations(
                current_user_id=int(context.user_id or 0),
                q=_normalize_text(args.query),
                limit=int(args.limit or 10),
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))
        items = (
            result.get("items")
            or result.get("conversations")
            or []
            if isinstance(result, dict)
            else []
        )
        conversations = []
        for item in items or []:
            if not isinstance(item, dict):
                continue
            conversation_id = _normalize_text(item.get("id") or item.get("conversation_id"))
            if not conversation_id:
                continue
            conversations.append(
                {
                    "id": conversation_id,
                    "title": _normalize_text(item.get("title") or item.get("name")) or None,
                    "kind": _normalize_text(item.get("kind") or item.get("type")) or None,
                    "member_count": item.get("member_count"),
                }
            )
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={"count": len(conversations), "items": conversations},
        )


class ChatMessageSendDraftTool(AiTool):
    tool_id = CHAT_TOOL_ACTION_MESSAGE_SEND_DRAFT
    description = (
        "Create a pending action card to send a Hub chat message to a user (peer_user_id or peer_name) "
        "or to a group conversation (conversation_id or conversation_title). "
        "Does not send before user confirmation."
    )
    input_model = ChatMessageSendDraftArgs
    stage = "checking_chat"

    def execute(self, *, context: AiToolExecutionContext, args: ChatMessageSendDraftArgs) -> AiToolResult:
        try:
            from backend.ai_chat.action_cards import build_chat_message_draft

            card = build_chat_message_draft(
                conversation_id=context.conversation_id,
                run_id=context.run_id,
                requester_user_id=int(context.user_id),
                payload=args.model_dump(),
            )
            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                data={"action_card": card, "requires_confirmation": True},
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))


for tool in [
    ChatUsersSearchTool(),
    ChatConversationsSearchTool(),
    ChatMessageSendDraftTool(),
]:
    ai_tool_registry.register(tool)
