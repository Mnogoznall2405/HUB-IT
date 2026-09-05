"""Lean ACK / minimal message.created payloads for the send critical path.

Full user maps, reply/forward previews, attachments enrichment and conversation
inbox metadata must not run between COMMIT and sender ACK.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from backend.chat.chat_formatting import _iso, _normalize_body_format
from backend.chat.utils import normalize_text as _normalize_text


def _stub_sender(user_id: int) -> dict[str, Any]:
    """Placeholder sender for lean ACK. Never use user-{id} as display name."""
    normalized = int(user_id or 0)
    return {
        "id": normalized,
        "username": "",
        "full_name": None,
        "role": "viewer",
        "is_active": True,
        "avatar_url": None,
        "presence": None,
    }


def build_sender_summary(
    *,
    user_id: int,
    username: Optional[str] = None,
    full_name: Optional[str] = None,
    role: Optional[str] = None,
    avatar_url: Optional[str] = None,
) -> dict[str, Any]:
    normalized = int(user_id or 0)
    normalized_username = _normalize_text(username) or ""
    # Avoid leaking synthetic placeholders into toast/push titles.
    if normalized_username.lower().startswith("user-") and normalized_username[5:].isdigit():
        normalized_username = ""
    return {
        "id": normalized,
        "username": normalized_username,
        "full_name": _normalize_text(full_name) or None,
        "role": _normalize_text(role) or "viewer",
        "is_active": True,
        "avatar_url": _normalize_text(avatar_url) or None,
        "presence": None,
    }


def apply_sender_summary_to_message(
    message: dict[str, Any] | None,
    *,
    user_id: int,
    username: Optional[str] = None,
    full_name: Optional[str] = None,
    role: Optional[str] = None,
    avatar_url: Optional[str] = None,
) -> dict[str, Any]:
    payload = dict(message or {})
    payload["sender"] = build_sender_summary(
        user_id=user_id,
        username=username,
        full_name=full_name,
        role=role,
        avatar_url=avatar_url,
    )
    return payload


def build_lean_message_payload(
    *,
    message_id: str,
    conversation_id: str,
    sender_user_id: int,
    current_user_id: int,
    body: str,
    body_format: str = "plain",
    client_message_id: Optional[str] = None,
    created_at: Optional[datetime | str] = None,
    conversation_seq: int = 0,
    kind: str = "text",
    reply_to_message_id: Optional[str] = None,
    conversation_kind: str = "direct",
    task_id: Optional[str] = None,
) -> dict[str, Any]:
    """Minimal message shape safe for ACK and critical message.created fan-out."""
    sender_id = int(sender_user_id or 0)
    viewer_id = int(current_user_id or 0)
    is_own = sender_id > 0 and sender_id == viewer_id
    created = created_at if isinstance(created_at, str) else (_iso(created_at) or "")
    normalized_kind = _normalize_text(kind, "text") or "text"
    if normalized_kind not in {"text", "task_share", "file", "system"}:
        normalized_kind = "text"
    return {
        "id": _normalize_text(message_id),
        "conversation_id": _normalize_text(conversation_id),
        "conversation_kind": _normalize_text(conversation_kind, "direct") or "direct",
        "task_id": _normalize_text(task_id) or None,
        "kind": normalized_kind,
        "body_format": _normalize_body_format(body_format),
        "client_message_id": _normalize_text(client_message_id) or None,
        "sender": _stub_sender(sender_id),
        "body": body if body is not None else "",
        "created_at": created,
        "edited_at": None,
        "is_deleted": False,
        "deleted_at": None,
        "deleted_by_user_id": None,
        "deleted_reason": None,
        "is_own": is_own,
        "delivery_status": "sent" if is_own else None,
        "read_by_count": 0,
        "reply_preview": None,
        "forward_preview": None,
        "task_preview": None,
        "attachments": [],
        "action_card": None,
        "reactions": [],
        "conversation_seq": int(conversation_seq or 0),
        "reply_to_message_id": _normalize_text(reply_to_message_id) or None,
        "payload_mode": "lean",
    }


def build_lean_message_payload_from_orm(
    *,
    message: Any,
    current_user_id: int,
    conversation_kind: str = "direct",
    task_id: Optional[str] = None,
) -> dict[str, Any]:
    return build_lean_message_payload(
        message_id=str(getattr(message, "id", "") or ""),
        conversation_id=str(getattr(message, "conversation_id", "") or ""),
        sender_user_id=int(getattr(message, "sender_user_id", 0) or 0),
        current_user_id=int(current_user_id),
        body=str(getattr(message, "body", "") or ""),
        body_format=_normalize_text(getattr(message, "body_format", None), "plain") or "plain",
        client_message_id=_normalize_text(getattr(message, "client_message_id", None)) or None,
        created_at=getattr(message, "created_at", None),
        conversation_seq=int(getattr(message, "conversation_seq", 0) or 0),
        kind=_normalize_text(getattr(message, "kind", None), "text") or "text",
        reply_to_message_id=_normalize_text(getattr(message, "reply_to_message_id", None)) or None,
        conversation_kind=conversation_kind,
        task_id=task_id,
    )


def build_lean_command_ok_payload(
    *,
    message: dict[str, Any],
    conversation_id: Optional[str] = None,
) -> dict[str, Any]:
    """Top-level lean ACK fields + slim message for client merge compatibility."""
    msg = dict(message or {})
    msg_id = _normalize_text(msg.get("id")) or _normalize_text(msg.get("message_id"))
    conv_id = (
        _normalize_text(conversation_id)
        or _normalize_text(msg.get("conversation_id"))
    )
    return {
        "command": "send_message",
        "ok": True,
        "client_message_id": _normalize_text(msg.get("client_message_id")) or None,
        "message_id": msg_id,
        "conversation_id": conv_id,
        "seq": int(msg.get("conversation_seq") or 0),
        "created_at": _normalize_text(msg.get("created_at")) or "",
        "status": _normalize_text(msg.get("delivery_status"), "sent") or "sent",
        "message": msg,
    }


def empty_ack_prepare_stage_metrics() -> dict[str, float]:
    """Sub-stages under ack_payload_prepare (zeros when lean path skips work)."""
    return {
        "message_reload_ms": 0.0,
        "sender_load_ms": 0.0,
        "participants_load_ms": 0.0,
        "attachment_load_ms": 0.0,
        "preview_build_ms": 0.0,
        "schema_validate_ms": 0.0,
        "json_encode_ms": 0.0,
        "ack_payload_prepare_ms": 0.0,
    }
