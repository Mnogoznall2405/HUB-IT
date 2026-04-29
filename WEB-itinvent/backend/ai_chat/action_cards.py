from __future__ import annotations

import json
import mimetypes
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import UploadFile
from sqlalchemy import select

from backend.ai_chat.artifact_generator import GeneratedFileError, build_generated_uploads, normalize_generated_file_specs
from backend.appdb.db import app_session
from backend.appdb.models import AppAiPendingAction
from backend.database import queries
from backend.database.equipment_db import invalidate_equipment_cache
from backend.services.authorization_service import (
    PERM_DATABASE_WRITE,
    PERM_MAIL_ACCESS,
    PERM_TASKS_READ,
    PERM_TASKS_WRITE,
    authorization_service,
)
from backend.services.equipment_transfer_execution_service import execute_equipment_transfer
from backend.services.hub_service import hub_service
from backend.services.mail_service import mail_service
from backend.services.transfer_service import get_act_record


ACTION_STATUS_PENDING = "pending"
ACTION_STATUS_CONFIRMED = "confirmed"
ACTION_STATUS_CANCELLED = "cancelled"
ACTION_STATUS_EXPIRED = "expired"
ACTION_STATUS_FAILED = "failed"

ACTION_TRANSFER = "itinvent.transfer"
ACTION_CONSUMABLE_CONSUME = "itinvent.consumable.consume"
ACTION_CONSUMABLE_QTY = "itinvent.consumable.qty"
ACTION_OFFICE_MAIL_SEND = "office.mail.send"
ACTION_OFFICE_MAIL_REPLY = "office.mail.reply"
ACTION_OFFICE_TASK_CREATE = "office.task.create"
ACTION_OFFICE_TASK_COMMENT = "office.task.comment"
ACTION_OFFICE_TASK_STATUS = "office.task.status"

DRAFT_EXPIRES_IN = timedelta(hours=1)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_text(value: object, default: object = "") -> str:
    if value is None or value == "":
        return str(default or "").strip()
    return str(value).strip()


def _json_dumps(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False, default=str)


def _json_loads(value: Any, default: Any = None) -> Any:
    try:
        return json.loads(str(value or ""))
    except Exception:
        return default


def _to_int(value: Any) -> int | None:
    if value in (None, "", "null"):
        return None
    try:
        return int(value)
    except Exception:
        return None


def _user_attr(user: Any, key: str, default: Any = None) -> Any:
    if isinstance(user, dict):
        return user.get(key, default)
    return getattr(user, key, default)


def _user_dict(user: Any) -> dict[str, Any]:
    return {
        "id": int(_user_attr(user, "id", 0) or 0),
        "username": _normalize_text(_user_attr(user, "username")),
        "full_name": _normalize_text(_user_attr(user, "full_name")),
        "role": _normalize_text(_user_attr(user, "role"), "viewer"),
        "use_custom_permissions": bool(_user_attr(user, "use_custom_permissions", False)),
        "custom_permissions": _user_attr(user, "custom_permissions", []) or [],
    }


def _has_permission(user: Any, permission: str) -> bool:
    payload = _user_dict(user)
    return authorization_service.has_permission(
        payload.get("role"),
        permission,
        use_custom_permissions=bool(payload.get("use_custom_permissions")),
        custom_permissions=payload.get("custom_permissions") or [],
    )


def _require_permission(user: Any, permission: str) -> None:
    if not _has_permission(user, permission):
        raise PermissionError(f"Permission required: {permission}")


def _is_admin_user(user: Any) -> bool:
    return _normalize_text(_user_attr(user, "role")).lower() == "admin"


def _build_upload_file(*, file_name: str, content_type: str, payload: bytes) -> UploadFile:
    import io

    return UploadFile(
        filename=file_name,
        file=io.BytesIO(bytes(payload or b"")),
        headers={"content-type": content_type or "application/octet-stream"},
    )


def _set_expired_if_needed(row: AppAiPendingAction, *, now: datetime | None = None) -> bool:
    current_now = now or _utc_now()
    expires_at = row.expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if row.status == ACTION_STATUS_PENDING and expires_at is not None and expires_at <= current_now:
        row.status = ACTION_STATUS_EXPIRED
        row.updated_at = current_now
        return True
    return False


def _action_to_card(row: AppAiPendingAction) -> dict[str, Any]:
    return {
        "id": row.id,
        "action_type": row.action_type,
        "status": row.status,
        "conversation_id": row.conversation_id,
        "message_id": row.message_id,
        "database_id": row.database_id,
        "preview": _json_loads(row.preview_json, {}) or {},
        "result": _json_loads(row.result_json, {}) or {},
        "error_text": _normalize_text(row.error_text) or None,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "executed_by_user_id": row.executed_by_user_id,
    }


def _build_transfer_preview(*, payload: dict[str, Any], database_id: str, items: list[dict[str, Any]], target_owner: dict[str, Any]) -> dict[str, Any]:
    target_name = (
        _normalize_text(target_owner.get("OWNER_DISPLAY_NAME"))
        or _normalize_text(target_owner.get("owner_display_name"))
        or _normalize_text(payload.get("new_employee"))
    )
    return {
        "title": "Передача оборудования",
        "summary": f"Передать {len(items)} поз. сотруднику {target_name}",
        "database_id": database_id,
        "effects": ["перемещение оборудования", "запись в историю", "генерация акта"],
        "items": [
            {
                "inv_no": _normalize_text(item.get("INV_NO") or item.get("inv_no")),
                "name": _normalize_text(item.get("ITEM_NAME") or item.get("MODEL_NAME") or item.get("model_name")),
                "owner": _normalize_text(item.get("FIO") or item.get("employee_name") or item.get("OWNER_DISPLAY_NAME")),
            }
            for item in items
        ],
        "target": {
            "owner_no": _to_int(payload.get("new_employee_no")),
            "name": target_name,
            "department": _normalize_text(target_owner.get("OWNER_DEPT") or target_owner.get("employee_dept") or payload.get("new_employee_dept")) or None,
            "branch_no": payload.get("branch_no"),
            "loc_no": payload.get("loc_no"),
        },
        "comment": _normalize_text(payload.get("comment")) or None,
    }


def _build_consumable_preview(*, action_type: str, payload: dict[str, Any], database_id: str, item: dict[str, Any]) -> dict[str, Any]:
    qty = _to_int(payload.get("qty")) or 0
    current_qty = _to_int(item.get("QTY") or item.get("qty"))
    title = "Списание расходника" if action_type == ACTION_CONSUMABLE_CONSUME else "Изменение остатка расходника"
    if action_type == ACTION_CONSUMABLE_CONSUME:
        summary = f"Списать {qty} шт. расходника"
        next_qty = None if current_qty is None else current_qty - qty
    else:
        summary = f"Установить остаток {qty} шт."
        next_qty = qty
    return {
        "title": title,
        "summary": summary,
        "database_id": database_id,
        "item": {
            "item_id": _to_int(item.get("ID") or item.get("id")),
            "inv_no": _normalize_text(item.get("INV_NO") or item.get("inv_no")) or None,
            "type": _normalize_text(item.get("TYPE_NAME") or item.get("type_name")) or None,
            "model": _normalize_text(item.get("MODEL_NAME") or item.get("model_name")) or None,
            "branch": _normalize_text(item.get("BRANCH_NAME") or item.get("branch_name")) or None,
            "location": _normalize_text(item.get("LOCATION_NAME") or item.get("location_name")) or None,
            "qty_current": current_qty,
            "qty_next": next_qty,
        },
        "qty": qty,
        "reason": _normalize_text(payload.get("reason")) or None,
    }


def _normalize_mail_attachment_refs(value: Any) -> list[dict[str, str]]:
    refs: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in list(value or []):
        if not isinstance(item, dict):
            continue
        message_id = _normalize_text(item.get("message_id"))
        attachment_id = _normalize_text(item.get("attachment_id") or item.get("id"))
        if not message_id or not attachment_id:
            continue
        key = (message_id, attachment_id)
        if key in seen:
            continue
        seen.add(key)
        refs.append(
            {
                "message_id": message_id,
                "attachment_id": attachment_id,
                "file_name": _normalize_text(item.get("file_name")) or None,
                "size": _to_int(item.get("size") or item.get("file_size")),
            }
        )
        if len(refs) >= 10:
            break
    return refs


def _normalize_mail_generated_file_specs(value: Any) -> list[dict[str, Any]]:
    try:
        return normalize_generated_file_specs(list(value or []))[:10]
    except GeneratedFileError as exc:
        raise ValueError(f"Generated mail attachment is invalid: {exc}") from exc


def _mail_generated_file_previews(value: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in _normalize_mail_generated_file_specs(value):
        rows.append(
            {
                "file_name": _normalize_text(item.get("file_name")) or None,
                "format": _normalize_text(item.get("format")) or None,
                "size_bytes": _to_int(item.get("size_bytes")),
            }
        )
    return rows


def _build_office_mail_preview_v2(*, action_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    to = [item for item in list(payload.get("to") or []) if _normalize_text(item)]
    cc = [item for item in list(payload.get("cc") or []) if _normalize_text(item)]
    bcc = [item for item in list(payload.get("bcc") or []) if _normalize_text(item)]
    subject = _normalize_text(payload.get("subject"))
    body = _normalize_text(payload.get("body"))
    attachments = _normalize_mail_attachment_refs(payload.get("attachment_refs"))
    generated_files = _mail_generated_file_previews(payload.get("generated_file_specs"))
    attachment_count = len(attachments) + len(generated_files)
    warnings: list[str] = []
    if not subject:
        warnings.append("Письмо без темы.")
    if re.search(r"\b(влож|файл|прикреп|attachment|attach)\b", body, flags=re.IGNORECASE) and not attachments:
        warnings.append("В тексте упоминается вложение, но файлы не выбраны.")
    recipient_domains = {
        item.rsplit("@", 1)[1].lower()
        for item in [*to, *cc, *bcc]
        if "@" in item and item.rsplit("@", 1)[1]
    }
    title = "Ответ на письмо" if action_type == ACTION_OFFICE_MAIL_REPLY else "Отправка письма"
    return {
        "title": title,
        "summary": f"{subject or 'Без темы'} -> {', '.join(to[:3])}{' +' + str(len(to) - 3) if len(to) > 3 else ''}",
        "effects": ["отправка письма из mailbox текущего пользователя", "подпись будет добавлена автоматически при отправке"],
        "warnings": warnings,
        "mail": {
            "to": to,
            "cc": cc,
            "bcc": bcc,
            "bcc_count": len(bcc),
            "subject": subject,
            "body": body,
            "body_preview": body[:500],
            "mailbox_id": _normalize_text(payload.get("mailbox_id")) or None,
            "reply_to_message_id": _normalize_text(payload.get("reply_to_message_id")) or None,
            "attachment_refs": attachments,
            "generated_files": generated_files,
            "attachment_count": attachment_count,
            "chat_attachment_count": len(attachments),
            "generated_file_count": len(generated_files),
            "recipient_domains": sorted(recipient_domains),
            "signature_auto": True,
        },
    }


def _build_office_mail_preview(*, action_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    to = [item for item in list(payload.get("to") or []) if _normalize_text(item)]
    cc = [item for item in list(payload.get("cc") or []) if _normalize_text(item)]
    subject = _normalize_text(payload.get("subject"))
    title = "Ответ на письмо" if action_type == ACTION_OFFICE_MAIL_REPLY else "Отправка письма"
    return {
        "title": title,
        "summary": f"{subject or 'Без темы'} -> {', '.join(to[:3])}{' +' + str(len(to) - 3) if len(to) > 3 else ''}",
        "effects": ["отправка письма из mailbox текущего пользователя"],
        "mail": {
            "to": to,
            "cc": cc,
            "bcc_count": len(list(payload.get("bcc") or [])),
            "subject": subject,
            "body_preview": _normalize_text(payload.get("body"))[:500],
            "mailbox_id": _normalize_text(payload.get("mailbox_id")) or None,
            "reply_to_message_id": _normalize_text(payload.get("reply_to_message_id")) or None,
        },
    }


def _build_office_task_preview(*, action_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    if action_type == ACTION_OFFICE_TASK_CREATE:
        title = "Создание задачи"
        summary = _normalize_text(payload.get("title"))
        return {
            "title": title,
            "summary": summary,
            "effects": ["создание Hub-задачи", "уведомление участников"],
            "task": {
                "title": summary,
                "description_preview": _normalize_text(payload.get("description"))[:500],
                "assignee_user_id": _to_int(payload.get("assignee_user_id")),
                "assignee_name": _normalize_text(payload.get("assignee_name")) or None,
                "controller_user_id": _to_int(payload.get("controller_user_id")),
                "controller_name": _normalize_text(payload.get("controller_name")) or None,
                "due_at": _normalize_text(payload.get("due_at")) or None,
                "project_id": _normalize_text(payload.get("project_id")) or None,
                "project_name": _normalize_text(payload.get("project_name")) or None,
                "priority": _normalize_text(payload.get("priority"), "normal"),
            },
        }
    if action_type == ACTION_OFFICE_TASK_COMMENT:
        return {
            "title": "Комментарий к задаче",
            "summary": _normalize_text(payload.get("task_title")) or _normalize_text(payload.get("task_id")),
            "effects": ["добавление комментария к Hub-задаче"],
            "task": {
                "task_id": _normalize_text(payload.get("task_id")),
                "body_preview": _normalize_text(payload.get("body"))[:500],
            },
        }
    operation = _normalize_text(payload.get("operation"))
    operation_label = {
        "start": "взять в работу",
        "submit": "отправить на проверку",
        "approve": "принять задачу",
        "reject": "вернуть задачу",
    }.get(operation, operation)
    return {
        "title": "Изменение статуса задачи",
        "summary": f"{_normalize_text(payload.get('task_title')) or _normalize_text(payload.get('task_id'))}: {operation_label}",
        "effects": ["изменение статуса Hub-задачи по текущим правилам workflow"],
        "task": {
            "task_id": _normalize_text(payload.get("task_id")),
            "operation": operation,
            "current_status": _normalize_text(payload.get("current_status")) or None,
            "comment": _normalize_text(payload.get("comment")) or None,
        },
    }


def create_pending_action(
    *,
    action_type: str,
    conversation_id: str,
    run_id: str,
    requester_user_id: int,
    database_id: str | None,
    payload: dict[str, Any],
    preview: dict[str, Any],
) -> dict[str, Any]:
    now = _utc_now()
    with app_session() as session:
        row = AppAiPendingAction(
            id=str(uuid4()),
            action_type=_normalize_text(action_type),
            status=ACTION_STATUS_PENDING,
            conversation_id=_normalize_text(conversation_id),
            run_id=_normalize_text(run_id),
            message_id=None,
            requester_user_id=int(requester_user_id or 0),
            database_id=_normalize_text(database_id) or None,
            payload_json=_json_dumps(payload),
            preview_json=_json_dumps(preview),
            result_json="{}",
            error_text=None,
            expires_at=now + DRAFT_EXPIRES_IN,
            executed_by_user_id=None,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        session.flush()
        return _action_to_card(row)


def attach_run_actions_to_message(*, run_id: str, message_id: str) -> list[dict[str, Any]]:
    normalized_run_id = _normalize_text(run_id)
    normalized_message_id = _normalize_text(message_id)
    if not normalized_run_id or not normalized_message_id:
        return []
    now = _utc_now()
    with app_session() as session:
        rows = list(
            session.execute(
                select(AppAiPendingAction)
                .where(AppAiPendingAction.run_id == normalized_run_id)
                .where(AppAiPendingAction.message_id.is_(None))
                .order_by(AppAiPendingAction.created_at.asc())
            ).scalars()
        )
        for row in rows:
            row.message_id = normalized_message_id
            row.updated_at = now
        session.flush()
        return [_action_to_card(row) for row in rows]


def get_action_card_for_message(message_id: str) -> dict[str, Any] | None:
    normalized_message_id = _normalize_text(message_id)
    if not normalized_message_id:
        return None
    with app_session() as session:
        row = session.execute(
            select(AppAiPendingAction)
            .where(AppAiPendingAction.message_id == normalized_message_id)
            .order_by(AppAiPendingAction.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if row is None:
            return None
        _set_expired_if_needed(row)
        session.flush()
        return _action_to_card(row)


def build_transfer_draft(
    *,
    conversation_id: str,
    run_id: str,
    requester_user_id: int,
    database_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    inv_nos = []
    for raw in list(payload.get("inv_nos") or []):
        inv_no = _normalize_text(raw)
        if inv_no and inv_no not in inv_nos:
            inv_nos.append(inv_no)
    if not inv_nos:
        raise ValueError("inv_nos is required")

    items: list[dict[str, Any]] = []
    missing: list[str] = []
    for inv_no in inv_nos:
        item = queries.get_equipment_by_inv(inv_no, database_id)
        if isinstance(item, dict):
            items.append(item)
        else:
            missing.append(inv_no)
    if missing:
        raise ValueError(f"Equipment not found: {', '.join(missing)}")

    target_employee_name = _normalize_text(payload.get("new_employee"))
    target_employee_no = _to_int(payload.get("new_employee_no"))
    if target_employee_no is None and target_employee_name:
        target_employee_no = queries.get_owner_no_by_name(target_employee_name, strict=True, db_id=database_id)
    if target_employee_no is None:
        raise ValueError("Target employee is not resolved exactly. Ask the user to choose an existing employee.")
    target_owner = queries.get_owner_by_no(int(target_employee_no), database_id)
    if not target_owner:
        raise ValueError("Target employee was not found")

    normalized_payload = {
        "inv_nos": inv_nos,
        "new_employee": (
            _normalize_text(target_owner.get("OWNER_DISPLAY_NAME"))
            or _normalize_text(target_owner.get("owner_display_name"))
            or target_employee_name
        ),
        "new_employee_no": int(target_employee_no),
        "new_employee_dept": _normalize_text(payload.get("new_employee_dept")) or None,
        "branch_no": payload.get("branch_no"),
        "loc_no": payload.get("loc_no"),
        "comment": _normalize_text(payload.get("comment")) or None,
    }
    preview = _build_transfer_preview(
        payload=normalized_payload,
        database_id=database_id,
        items=items,
        target_owner=target_owner,
    )
    return create_pending_action(
        action_type=ACTION_TRANSFER,
        conversation_id=conversation_id,
        run_id=run_id,
        requester_user_id=requester_user_id,
        database_id=database_id,
        payload=normalized_payload,
        preview=preview,
    )


def _resolve_consumable_item(*, database_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    item_id = _to_int(payload.get("item_id"))
    inv_no = _normalize_text(payload.get("inv_no"))
    rows = list(queries.get_consumables_lookup(db_id=database_id, limit=1000) or [])
    for row in rows:
        row_item_id = _to_int(row.get("ID") or row.get("id"))
        row_inv_no = _normalize_text(row.get("INV_NO") or row.get("inv_no"))
        if item_id is not None and row_item_id == item_id:
            return row
        if inv_no and row_inv_no == inv_no:
            return row
    raise ValueError("Consumable item was not found")


def build_consumable_draft(
    *,
    action_type: str,
    conversation_id: str,
    run_id: str,
    requester_user_id: int,
    database_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    qty = _to_int(payload.get("qty"))
    if qty is None or qty < 0 or (action_type == ACTION_CONSUMABLE_CONSUME and qty <= 0):
        raise ValueError("Invalid qty")
    item = _resolve_consumable_item(database_id=database_id, payload=payload)
    current_qty = _to_int(item.get("QTY") or item.get("qty"))
    if action_type == ACTION_CONSUMABLE_CONSUME and current_qty is not None and current_qty < qty:
        raise ValueError("Insufficient consumable quantity")
    item_id = _to_int(item.get("ID") or item.get("id"))
    inv_no = _normalize_text(item.get("INV_NO") or item.get("inv_no"))
    normalized_payload = {
        "item_id": item_id,
        "inv_no": inv_no or None,
        "qty": qty,
        "reason": _normalize_text(payload.get("reason")) or None,
    }
    return create_pending_action(
        action_type=action_type,
        conversation_id=conversation_id,
        run_id=run_id,
        requester_user_id=requester_user_id,
        database_id=database_id,
        payload=normalized_payload,
        preview=_build_consumable_preview(
            action_type=action_type,
            payload=normalized_payload,
            database_id=database_id,
            item=item,
        ),
    )


def build_office_mail_draft(
    *,
    action_type: str,
    conversation_id: str,
    run_id: str,
    requester_user_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    if action_type not in {ACTION_OFFICE_MAIL_SEND, ACTION_OFFICE_MAIL_REPLY}:
        raise ValueError(f"Unsupported office mail action_type: {action_type}")
    to = [_normalize_text(item) for item in list(payload.get("to") or []) if _normalize_text(item)]
    if not to:
        raise ValueError("At least one recipient is required")
    subject = _normalize_text(payload.get("subject"))
    body = _normalize_text(payload.get("body"))
    if not subject:
        raise ValueError("subject is required")
    if not body:
        raise ValueError("body is required")
    normalized_payload = {
        "mailbox_id": _normalize_text(payload.get("mailbox_id")) or None,
        "to": to,
        "cc": [_normalize_text(item) for item in list(payload.get("cc") or []) if _normalize_text(item)],
        "bcc": [_normalize_text(item) for item in list(payload.get("bcc") or []) if _normalize_text(item)],
        "subject": subject,
        "body": body,
        "is_html": bool(payload.get("is_html", True)),
        "reply_to_message_id": _normalize_text(payload.get("reply_to_message_id")) or "",
        "attachment_refs": _normalize_mail_attachment_refs(payload.get("attachment_refs")),
        "generated_file_specs": _normalize_mail_generated_file_specs(payload.get("generated_file_specs")),
    }
    if action_type == ACTION_OFFICE_MAIL_REPLY and not normalized_payload["reply_to_message_id"]:
        raise ValueError("reply_to_message_id is required")
    return create_pending_action(
        action_type=action_type,
        conversation_id=conversation_id,
        run_id=run_id,
        requester_user_id=requester_user_id,
        database_id=None,
        payload=normalized_payload,
        preview=_build_office_mail_preview_v2(action_type=action_type, payload=normalized_payload),
    )


def build_office_task_draft(
    *,
    action_type: str,
    conversation_id: str,
    run_id: str,
    requester_user_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    if action_type not in {ACTION_OFFICE_TASK_CREATE, ACTION_OFFICE_TASK_COMMENT, ACTION_OFFICE_TASK_STATUS}:
        raise ValueError(f"Unsupported office task action_type: {action_type}")
    normalized_payload = dict(payload or {})
    return create_pending_action(
        action_type=action_type,
        conversation_id=conversation_id,
        run_id=run_id,
        requester_user_id=requester_user_id,
        database_id=None,
        payload=normalized_payload,
        preview=_build_office_task_preview(action_type=action_type, payload=normalized_payload),
    )


def _execute_transfer(*, payload: dict[str, Any], database_id: str, current_user: Any) -> dict[str, Any]:
    return execute_equipment_transfer(
        payload=payload,
        db_id=database_id,
        current_user=current_user,
        allow_create_owner=False,
    )


def _resolve_action_message_sender(row: AppAiPendingAction, *, fallback_user_id: int) -> int:
    message_id = _normalize_text(row.message_id)
    if not message_id:
        return int(fallback_user_id or 0)
    try:
        from backend.chat.db import chat_session
        from backend.chat.models import ChatMessage

        with chat_session() as session:
            message = session.get(ChatMessage, message_id)
            sender_user_id = int(getattr(message, "sender_user_id", 0) or 0) if message is not None else 0
            return sender_user_id or int(fallback_user_id or 0)
    except Exception:
        return int(fallback_user_id or 0)


def _publish_chat_message_created(*, conversation_id: str, message_id: str) -> None:
    try:
        import asyncio

        from backend.chat.realtime_side_effects import publish_message_created_after_send

        asyncio.run(
            publish_message_created_after_send(
                conversation_id=conversation_id,
                message_id=message_id,
            )
        )
    except Exception:
        pass


def _send_transfer_acts_to_chat(
    *,
    row: AppAiPendingAction,
    result: dict[str, Any],
    current_user: Any,
) -> dict[str, Any]:
    conversation_id = _normalize_text(row.conversation_id)
    acts = [item for item in list(result.get("acts") or []) if isinstance(item, dict)]
    if not conversation_id or not acts:
        return {"sent_count": 0, "messages": [], "warning": None}

    uploads: list[UploadFile] = []
    missing: list[str] = []
    try:
        for act in acts:
            act_id = _normalize_text(act.get("act_id"))
            record = get_act_record(act_id) if act_id else None
            file_path = Path(_normalize_text((record or {}).get("file_path")))
            if not act_id or not file_path.exists() or not file_path.is_file():
                missing.append(act_id or _normalize_text(act.get("file_name")) or "unknown")
                continue
            file_name = _normalize_text((record or {}).get("file_name")) or _normalize_text(act.get("file_name")) or file_path.name
            content_type = mimetypes.guess_type(file_name)[0] or "application/octet-stream"
            uploads.append(
                _build_upload_file(
                    file_name=file_name,
                    content_type=content_type,
                    payload=file_path.read_bytes(),
                )
            )

        if not uploads:
            warning = "Файлы актов не найдены для отправки в чат."
            if missing:
                warning = f"{warning} act_id: {', '.join(missing)}"
            return {"sent_count": 0, "messages": [], "warning": warning}

        from backend.chat.service import CHAT_MAX_FILES_PER_MESSAGE, chat_service

        sender_user_id = _resolve_action_message_sender(
            row,
            fallback_user_id=int(_user_attr(current_user, "id", 0) or 0),
        )
        messages: list[dict[str, Any]] = []
        for start in range(0, len(uploads), int(CHAT_MAX_FILES_PER_MESSAGE)):
            chunk = uploads[start : start + int(CHAT_MAX_FILES_PER_MESSAGE)]
            body = "Акт перемещения техники" if len(chunk) == 1 else f"Акты перемещения техники: {len(chunk)} файла"
            message = chat_service.send_files(
                current_user_id=sender_user_id,
                conversation_id=conversation_id,
                body=body,
                uploads=chunk,
                reply_to_message_id=_normalize_text(row.message_id) or None,
                defer_push_notifications=True,
            )
            message_id = _normalize_text(message.get("id"))
            if message_id:
                _publish_chat_message_created(conversation_id=conversation_id, message_id=message_id)
            messages.append(
                {
                    "message_id": message_id or None,
                    "attachment_count": len(message.get("attachments") or []),
                }
            )
        warning = None
        if missing:
            warning = f"Часть актов не отправлена в чат: {', '.join(missing)}"
        return {"sent_count": len(uploads), "messages": messages, "warning": warning}
    finally:
        for upload in uploads:
            try:
                upload.file.close()
            except Exception:
                pass


def _execute_consumable(*, action_type: str, payload: dict[str, Any], database_id: str, current_user: Any) -> dict[str, Any]:
    changed_by = _normalize_text(_user_attr(current_user, "username")) or "IT-WEB"
    if action_type == ACTION_CONSUMABLE_CONSUME:
        result = queries.consume_consumable_stock(
            db_id=database_id,
            item_id=_to_int(payload.get("item_id")),
            inv_no=_normalize_text(payload.get("inv_no")) or None,
            qty=_to_int(payload.get("qty")) or 0,
            changed_by=changed_by,
        )
    else:
        result = queries.set_consumable_stock_qty(
            db_id=database_id,
            item_id=_to_int(payload.get("item_id")),
            inv_no=_normalize_text(payload.get("inv_no")) or None,
            qty=_to_int(payload.get("qty")) or 0,
            changed_by=changed_by,
        )
    if result.get("success"):
        invalidate_equipment_cache(database_id)
    return result


def _apply_office_mail_overrides(payload: dict[str, Any], overrides: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(overrides, dict) or not overrides:
        return dict(payload or {})
    next_payload = dict(payload or {})
    for key in ("mailbox_id", "subject", "body", "reply_to_message_id"):
        if key in overrides:
            next_payload[key] = _normalize_text(overrides.get(key))
    if "is_html" in overrides:
        next_payload["is_html"] = bool(overrides.get("is_html", True))
    for key in ("to", "cc", "bcc"):
        if key in overrides:
            next_payload[key] = [_normalize_text(item) for item in list(overrides.get(key) or []) if _normalize_text(item)]
    if "attachment_refs" in overrides:
        next_payload["attachment_refs"] = _normalize_mail_attachment_refs(overrides.get("attachment_refs"))
    if "generated_file_specs" in overrides:
        next_payload["generated_file_specs"] = _normalize_mail_generated_file_specs(overrides.get("generated_file_specs"))
    if not next_payload.get("to"):
        raise ValueError("At least one recipient is required")
    if not _normalize_text(next_payload.get("body")):
        raise ValueError("body is required")
    return next_payload


def _resolve_office_mail_attachments(*, row: AppAiPendingAction, payload: dict[str, Any], current_user: Any) -> list[tuple[str, bytes]]:
    refs = _normalize_mail_attachment_refs(payload.get("attachment_refs"))
    from backend.chat.db import chat_session
    from backend.chat.models import ChatMessageAttachment
    from backend.chat.service import chat_service

    attachments: list[tuple[str, bytes]] = []
    seen: set[tuple[str, str]] = set()
    for ref in refs:
        message_id = _normalize_text(ref.get("message_id"))
        attachment_id = _normalize_text(ref.get("attachment_id"))
        key = (message_id, attachment_id)
        if not message_id or not attachment_id or key in seen:
            continue
        seen.add(key)
        with chat_session() as session:
            attachment = session.get(ChatMessageAttachment, attachment_id)
            if attachment is None or attachment.message_id != message_id:
                raise LookupError("Mail attachment was not found in chat")
            if _normalize_text(attachment.conversation_id) != _normalize_text(row.conversation_id):
                raise ValueError("Mail attachment belongs to another chat conversation")
        file_payload = chat_service.get_attachment_for_download(
            current_user_id=int(_user_attr(current_user, "id", 0) or 0),
            message_id=message_id,
            attachment_id=attachment_id,
        )
        file_path = Path(_normalize_text(file_payload.get("path")))
        if not file_path.exists() or not file_path.is_file():
            raise LookupError("Mail attachment file was not found")
        attachments.append((_normalize_text(file_payload.get("file_name")) or file_path.name, file_path.read_bytes()))
    generated_specs = _normalize_mail_generated_file_specs(payload.get("generated_file_specs"))
    if generated_specs:
        available_slots = max(0, 10 - len(attachments))
        uploads = build_generated_uploads(generated_specs[:available_slots])
        for upload in uploads:
            try:
                upload.file.seek(0)
                attachments.append((_normalize_text(upload.filename) or "attachment.bin", upload.file.read()))
            finally:
                try:
                    upload.file.close()
                except Exception:
                    pass
    return attachments


def _execute_office_mail(*, action_type: str, payload: dict[str, Any], current_user: Any, row: AppAiPendingAction | None = None) -> dict[str, Any]:
    _require_permission(current_user, PERM_MAIL_ACCESS)
    attachments = _resolve_office_mail_attachments(row=row, payload=payload, current_user=current_user) if row is not None else []
    result = mail_service.send_message(
        user_id=int(_user_attr(current_user, "id", 0) or 0),
        mailbox_id=_normalize_text(payload.get("mailbox_id")) or None,
        to=[_normalize_text(item) for item in list(payload.get("to") or []) if _normalize_text(item)],
        cc=[_normalize_text(item) for item in list(payload.get("cc") or []) if _normalize_text(item)],
        bcc=[_normalize_text(item) for item in list(payload.get("bcc") or []) if _normalize_text(item)],
        subject=_normalize_text(payload.get("subject")),
        body=_normalize_text(payload.get("body")),
        is_html=bool(payload.get("is_html", True)),
        attachments=attachments,
        reply_to_message_id=_normalize_text(payload.get("reply_to_message_id")) if action_type == ACTION_OFFICE_MAIL_REPLY else "",
    )
    return {"success": bool(result.get("ok", True)), "attachment_count": len(attachments), **result}


def _execute_office_task_create(*, payload: dict[str, Any], current_user: Any) -> dict[str, Any]:
    _require_permission(current_user, PERM_TASKS_WRITE)
    task = hub_service.create_task(
        title=_normalize_text(payload.get("title")),
        description=_normalize_text(payload.get("description")),
        assignee_user_id=int(_to_int(payload.get("assignee_user_id")) or 0),
        controller_user_id=int(_to_int(payload.get("controller_user_id")) or 0),
        due_at=_normalize_text(payload.get("due_at")) or None,
        project_id=_normalize_text(payload.get("project_id")) or None,
        object_id=_normalize_text(payload.get("object_id")) or None,
        protocol_date=_normalize_text(payload.get("protocol_date")) or None,
        priority=_normalize_text(payload.get("priority"), "normal"),
        actor=_user_dict(current_user),
    )
    return {"success": True, "task": task, "task_id": _normalize_text(task.get("id")) or None}


def _execute_office_task_comment(*, payload: dict[str, Any], current_user: Any) -> dict[str, Any]:
    _require_permission(current_user, PERM_TASKS_READ)
    comment = hub_service.add_task_comment(
        task_id=_normalize_text(payload.get("task_id")),
        user=_user_dict(current_user),
        body=_normalize_text(payload.get("body")),
    )
    return {"success": bool(comment), "comment": comment, "task_id": _normalize_text(payload.get("task_id"))}


def _execute_office_task_status(*, payload: dict[str, Any], current_user: Any) -> dict[str, Any]:
    _require_permission(current_user, PERM_TASKS_READ)
    task_id = _normalize_text(payload.get("task_id"))
    operation = _normalize_text(payload.get("operation")).lower()
    user_payload = _user_dict(current_user)
    if operation == "start":
        task = hub_service.start_task(task_id=task_id, user=user_payload)
    elif operation == "submit":
        task = hub_service.submit_task(
            task_id=task_id,
            user=user_payload,
            comment=_normalize_text(payload.get("comment")),
            file_name=None,
            file_bytes=None,
            file_mime=None,
        )
    elif operation in {"approve", "reject"}:
        task = hub_service.review_task(
            task_id=task_id,
            reviewer=user_payload,
            decision=operation,
            comment=_normalize_text(payload.get("comment")),
            is_admin=_is_admin_user(current_user),
        )
    else:
        raise ValueError("Unsupported task status operation")
    return {"success": bool(task), "task": task, "task_id": task_id, "operation": operation}


def confirm_action(*, action_id: str, current_user: Any, payload_overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    normalized_action_id = _normalize_text(action_id)
    with app_session() as session:
        row = session.get(AppAiPendingAction, normalized_action_id)
        if row is None:
            raise LookupError("Action was not found")
        if _set_expired_if_needed(row):
            session.flush()
            return _action_to_card(row)
        if row.status != ACTION_STATUS_PENDING:
            return _action_to_card(row)
        payload = _json_loads(row.payload_json, {}) or {}
        database_id = _normalize_text(row.database_id)
        if row.action_type in {ACTION_TRANSFER, ACTION_CONSUMABLE_CONSUME, ACTION_CONSUMABLE_QTY} and not database_id:
            raise ValueError("Action database is not resolved")
        try:
            if row.action_type == ACTION_TRANSFER:
                _require_permission(current_user, PERM_DATABASE_WRITE)
                result = _execute_transfer(payload=payload, database_id=database_id, current_user=current_user)
                try:
                    result["chat_act_delivery"] = _send_transfer_acts_to_chat(
                        row=row,
                        result=result,
                        current_user=current_user,
                    )
                except Exception as exc:
                    result["chat_act_delivery"] = {
                        "sent_count": 0,
                        "messages": [],
                        "warning": f"Акт создан, но не отправлен в чат: {_normalize_text(exc) or 'unknown error'}",
                    }
            elif row.action_type in {ACTION_CONSUMABLE_CONSUME, ACTION_CONSUMABLE_QTY}:
                _require_permission(current_user, PERM_DATABASE_WRITE)
                result = _execute_consumable(
                    action_type=row.action_type,
                    payload=payload,
                    database_id=database_id,
                    current_user=current_user,
                )
            elif row.action_type in {ACTION_OFFICE_MAIL_SEND, ACTION_OFFICE_MAIL_REPLY}:
                payload = _apply_office_mail_overrides(payload, payload_overrides)
                row.payload_json = _json_dumps(payload)
                row.preview_json = _json_dumps(_build_office_mail_preview_v2(action_type=row.action_type, payload=payload))
                result = _execute_office_mail(action_type=row.action_type, payload=payload, current_user=current_user, row=row)
            elif row.action_type == ACTION_OFFICE_TASK_CREATE:
                result = _execute_office_task_create(payload=payload, current_user=current_user)
            elif row.action_type == ACTION_OFFICE_TASK_COMMENT:
                result = _execute_office_task_comment(payload=payload, current_user=current_user)
            elif row.action_type == ACTION_OFFICE_TASK_STATUS:
                result = _execute_office_task_status(payload=payload, current_user=current_user)
            else:
                raise ValueError(f"Unsupported action_type: {row.action_type}")
            row.status = ACTION_STATUS_CONFIRMED if bool(result.get("success", True)) else ACTION_STATUS_FAILED
            row.result_json = _json_dumps(result)
            row.error_text = None if row.status == ACTION_STATUS_CONFIRMED else _normalize_text(result.get("message")) or "Action failed"
            row.executed_by_user_id = int(_user_attr(current_user, "id", 0) or 0) or None
            row.updated_at = _utc_now()
        except PermissionError:
            raise
        except Exception as exc:
            row.status = ACTION_STATUS_FAILED
            row.error_text = _normalize_text(exc) or "Action failed"
            row.result_json = _json_dumps({"success": False, "message": row.error_text})
            row.executed_by_user_id = int(_user_attr(current_user, "id", 0) or 0) or None
            row.updated_at = _utc_now()
        session.flush()
        return _action_to_card(row)


def cancel_action(*, action_id: str, current_user: Any) -> dict[str, Any]:
    normalized_action_id = _normalize_text(action_id)
    with app_session() as session:
        row = session.get(AppAiPendingAction, normalized_action_id)
        if row is None:
            raise LookupError("Action was not found")
        _set_expired_if_needed(row)
        if row.status == ACTION_STATUS_PENDING:
            row.status = ACTION_STATUS_CANCELLED
            row.executed_by_user_id = int(_user_attr(current_user, "id", 0) or 0) or None
            row.updated_at = _utc_now()
        session.flush()
        return _action_to_card(row)
