"""
Hub API: dashboard, announcements, tasks, notifications.
"""
from __future__ import annotations

import logging
import json
import os
import re
import time
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from backend.api.deps import ensure_user_any_permission, ensure_user_permission, get_current_active_user, require_any_permission, require_permission
from backend.models.auth import User
from backend.models.hub_task_canvas import TaskCanvasResponse, TaskCanvasUpdateRequest
from backend.services.authorization_service import (
    PERM_ANNOUNCEMENTS_MODERATE,
    PERM_ANNOUNCEMENTS_READ,
    PERM_ANNOUNCEMENTS_WRITE,
    PERM_CHAT_READ,
    PERM_DASHBOARD_READ,
    PERM_HUB_ABSENCES_MANAGE,
    PERM_MAIL_ACCESS,
    PERM_TASKS_CREATE,
    PERM_TASKS_READ,
    PERM_TASKS_MANAGE_ALL,
    PERM_TASKS_REVIEW,
    PERM_TASKS_WRITE,
)
from backend.services.employee_absence_service import employee_absence_service
from backend.services.access_policy_service import (
    can_close_task,
    can_review_task,
    user_is_department_manager,
)
from backend.services.hub_service import (
    TaskCanvasRevisionConflict,
    TaskCanvasTooLarge,
    _normalize_email_deadline_remind_hours,
    hub_service,
)
from backend.services.task_attachment_preview_service import task_attachment_preview_service
from backend.services.hub_task_transitions import TaskTransitionConflict, note_side_effect_failure
from backend.services.task_email_service import task_email_service
from backend.chat.task_discussion import (
    delete_task_discussion,
    ensure_task_discussion,
    get_task_discussion,
    is_task_discussion_chat_enabled,
    publish_task_discussion_updated,
)
from backend.services.task_analytics_export_service import build_task_analytics_excel
from backend.services.transfer_act_reminder_service import transfer_act_reminder_service
from backend.realtime.hub import HUB_DASHBOARD_INVALIDATE_EVENT
from backend.services.markdown_transform_service import (
    MarkdownTransformConfigError,
    MarkdownTransformError,
    markdown_transform_service,
)


router = APIRouter()
logger = logging.getLogger("backend.api.hub")

MAX_TASK_REPORT_FILE_BYTES = 20 * 1024 * 1024
MAX_ANNOUNCEMENT_FILE_BYTES = 20 * 1024 * 1024
MAX_TASK_ATTACHMENT_FILE_BYTES = 20 * 1024 * 1024
ALLOWED_UPLOAD_EXTENSIONS = {
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "jpg",
    "jpeg",
    "png",
    "txt",
    "zip",
}


def _normalize_text(value: object, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _build_task_preview_content_disposition(filename: str) -> str:
    source = _normalize_text(filename, "attachment.pdf").replace("\r", " ").replace("\n", " ")
    ascii_fallback = source.encode("ascii", "ignore").decode("ascii")
    ascii_fallback = re.sub(r'[";\\]+', "_", ascii_fallback).strip(" .") or "attachment.pdf"
    return f'inline; filename="{ascii_fallback}"; filename*=UTF-8\'\'{quote(source, safe="")}'


def _has_permission(user: User, permission: str) -> bool:
    current_permissions = set(getattr(user, "permissions", []) or [])
    return permission in current_permissions


def _actor_dict(user: User) -> dict:
    return {
        "id": int(user.id),
        "username": _normalize_text(user.username),
        "full_name": _normalize_text(getattr(user, "full_name", "")),
        "role": _normalize_text(getattr(user, "role", "")),
        "department": _normalize_text(getattr(user, "department", "")),
        "permissions": list(getattr(user, "permissions", []) or []),
        "custom_permissions": list(getattr(user, "permissions", []) or []),
        "use_custom_permissions": True,
    }


def _is_admin_user(user: User) -> bool:
    return _normalize_text(getattr(user, "role", "")).lower() == "admin"


def _can_moderate_announcements(user: User) -> bool:
    return _is_admin_user(user) or _has_permission(user, PERM_ANNOUNCEMENTS_MODERATE)


def _require_announcement_manager(user: User) -> None:
    if _has_permission(user, PERM_ANNOUNCEMENTS_WRITE) or _can_moderate_announcements(user):
        return
    raise HTTPException(status_code=403, detail="Insufficient permissions: announcements.write")


def _http_task_transition_conflict(exc: TaskTransitionConflict) -> HTTPException:
    return HTTPException(status_code=409, detail=exc.payload)


async def _safe_publish_task_discussion_updated(*, task_id: str, task: dict, operation: str) -> None:
    """Post-commit discussion publish must not turn a successful transition into HTTP 500."""
    try:
        await publish_task_discussion_updated(task_id=task_id, task=task)
    except Exception:
        note_side_effect_failure(operation=operation, target_status=str((task or {}).get("status") or ""))
        logger.exception(
            "hub.task.discussion_publish_failed task_id=%s operation=%s (business transition already committed)",
            task_id,
            operation,
        )


async def _safe_provision_task_discussion(*, task: dict, actor_user_id: int) -> None:
    """Create and publish a task chat without rolling back the committed Hub task."""
    if not is_task_discussion_chat_enabled():
        return
    task_id = _normalize_text((task or {}).get("id"))
    if not task_id:
        return
    try:
        await run_in_threadpool(
            ensure_task_discussion,
            task_id=task_id,
            actor_user_id=int(actor_user_id),
        )
        await publish_task_discussion_updated(task_id=task_id, task=task)
    except Exception:
        note_side_effect_failure(operation="create", target_status=str((task or {}).get("status") or ""))
        logger.exception(
            "hub.task.discussion_provision_failed task_id=%s (task already committed)",
            task_id,
        )


async def _require_notifications_access(
    current_user: User = Depends(get_current_active_user),
) -> User:
    allowed_permissions = (
        PERM_DASHBOARD_READ,
        PERM_TASKS_READ,
        PERM_CHAT_READ,
        PERM_MAIL_ACCESS,
    )
    if any(_has_permission(current_user, permission) for permission in allowed_permissions):
        return current_user
    raise HTTPException(
        status_code=403,
        detail="Insufficient permissions: notifications.read",
    )


def _coerce_bool(value: object, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    text = _normalize_text(value).lower()
    if not text:
        return default
    return text in {"1", "true", "yes", "on"}


def _coerce_json_list(value: object) -> list:
    if isinstance(value, list):
        return value
    text = _normalize_text(value)
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except Exception:
        return []
    return parsed if isinstance(parsed, list) else []


def _coerce_json_object(value: object) -> dict | None:
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    text = _normalize_text(value)
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def _enrich_task_payload(item: Optional[dict]) -> Optional[dict]:
    if not isinstance(item, dict):
        return item
    return transfer_act_reminder_service.enrich_task(item)


def _enrich_task_payload_for_user(item: Optional[dict], current_user: User) -> Optional[dict]:
    enriched = _enrich_task_payload(item)
    if not isinstance(enriched, dict):
        return enriched

    actor = _actor_dict(current_user)
    actor_id = int(current_user.id)
    status = _normalize_text(enriched.get("status")).lower()
    is_admin = _is_admin_user(current_user)
    is_transfer_reminder = _normalize_text(enriched.get("integration_kind")).lower() == "transfer_act_upload"
    is_creator = int(enriched.get("created_by_user_id") or 0) == actor_id
    is_assignee = actor_id in hub_service._task_assignee_user_ids(enriched)
    is_controller = int(enriched.get("controller_user_id") or 0) == actor_id
    controller_missing = int(enriched.get("controller_user_id") or 0) <= 0
    is_department_manager = user_is_department_manager(actor, enriched.get("department_id"))
    participant_ids = hub_service._task_participant_user_ids(enriched, include_delegates=True)
    observer_ids = hub_service._task_observer_user_ids(enriched)
    is_observer_only = actor_id in observer_ids and actor_id not in participant_ids
    can_reopen = bool(
        not is_transfer_reminder
        and status == "done"
        and not is_observer_only
        and (
            is_admin
            or is_department_manager
            or actor_id in participant_ids
        )
    )

    if is_observer_only:
        enriched["is_observer"] = True
        enriched["capabilities"] = {
            "can_edit": False,
            "can_start": False,
            "can_submit": False,
            "can_review": False,
            "can_close": False,
            "can_reopen": False,
            "can_upload_files": False,
            "can_update_checklist": False,
            "can_open_discussion": bool(is_task_discussion_chat_enabled()),
        }
        return enriched

    enriched["is_observer"] = actor_id in observer_ids
    enriched["capabilities"] = {
        "can_edit": bool(is_admin or (not is_transfer_reminder and (is_creator or is_department_manager))),
        "can_start": bool(not is_transfer_reminder and is_assignee and status == "new"),
        "can_submit": bool(not is_transfer_reminder and is_assignee and status in {"new", "in_progress"}),
        "can_review": bool(
            not is_transfer_reminder
            and status == "review"
            and can_review_task(actor, enriched)
        ),
        "can_close": bool(can_close_task(actor, enriched)),
        "can_reopen": can_reopen,
        "can_upload_files": bool(
            not is_transfer_reminder
            and status != "done"
            and (
                is_assignee
                or is_creator
                or is_controller
                or (_has_permission(current_user, PERM_TASKS_REVIEW) and controller_missing)
            )
        ),
        "can_update_checklist": bool(
            status != "done"
            and (
                is_admin
                or actor_id in participant_ids
                or is_department_manager
            )
        ),
        "can_open_discussion": bool(is_task_discussion_chat_enabled()),
    }
    return enriched


def _enrich_task_collection(payload: dict) -> dict:
    result = dict(payload or {})
    items = result.get("items")
    if isinstance(items, list):
        enriched_items = transfer_act_reminder_service.enrich_tasks(items)
        for item in enriched_items:
            if isinstance(item, dict) and "description" not in item:
                item["description"] = _normalize_text(item.get("description_preview"))
        result["items"] = enriched_items
    if "meta" not in result:
        result["meta"] = {}
    if isinstance(result.get("meta"), dict) and "email_deadline_soon_hours_default" not in result["meta"]:
        result["meta"]["email_deadline_soon_hours_default"] = task_email_service.deadline_soon_hours()
    return result


def _validate_upload(file_name: str, payload_size: int, *, max_bytes: int, context: str) -> None:
    normalized_name = _normalize_text(file_name) or "file.bin"
    ext = Path(normalized_name).suffix.lower().lstrip(".")
    if not ext or ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"{context}: unsupported file type '{ext or '-'}'",
        )
    if int(payload_size) > int(max_bytes):
        raise HTTPException(
            status_code=413,
            detail=f"{context}: file is too large",
        )


@router.get("/dashboard")
async def get_hub_dashboard(
    announcements_limit: int = Query(20, ge=1, le=200),
    tasks_limit: int = Query(10, ge=1, le=200),
    current_user: User = Depends(require_permission(PERM_DASHBOARD_READ)),
):
    payload = await run_in_threadpool(
        hub_service.get_dashboard,
        user_id=int(current_user.id),
        announcements_limit=int(announcements_limit),
        tasks_limit=int(tasks_limit),
    )
    if isinstance(payload, dict) and isinstance(payload.get("my_tasks"), dict):
        payload["my_tasks"] = _enrich_task_collection(payload.get("my_tasks") or {})
    return payload


def _require_absences_manage(user: User) -> None:
    if _is_admin_user(user) or _has_permission(user, PERM_HUB_ABSENCES_MANAGE):
        return
    raise HTTPException(status_code=403, detail="Недостаточно прав для управления отсутствиями")


def _list_hub_absences_payload(
    *,
    on: str = "",
    starts_on: str = "",
    ends_on: str = "",
    limit: int = 100,
) -> dict:
    from datetime import date as date_cls

    from backend.services.address_book_service import address_book_service

    start_text = _normalize_text(starts_on)
    end_text = _normalize_text(ends_on)
    on_text = _normalize_text(on)
    if start_text or end_text:
        start = date_cls.fromisoformat(start_text[:10]) if start_text else None
        end = date_cls.fromisoformat(end_text[:10]) if end_text else None
        manual = employee_absence_service.list_range(starts_on=start, ends_on=end, limit=int(limit))
        zup = address_book_service.list_absences(starts_on=start, ends_on=end, limit=int(limit))
    else:
        day = date_cls.fromisoformat(on_text[:10]) if on_text else None
        manual = employee_absence_service.list_on_date(on=day, limit=int(limit))
        zup = address_book_service.list_absences(on=day or date_cls.today(), limit=int(limit))
    return {
        **manual,
        "items": manual.get("items") or [],
        "zup_items": zup.get("items") or [],
        "zup_count": int(zup.get("count") or 0),
        "zup_as_of": zup.get("as_of"),
    }


@router.get("/absences")
async def list_hub_absences(
    on: str = Query("", min_length=0, max_length=32),
    starts_on: str = Query("", min_length=0, max_length=32),
    ends_on: str = Query("", min_length=0, max_length=32),
    limit: int = Query(100, ge=1, le=500),
    _: User = Depends(require_permission(PERM_DASHBOARD_READ)),
):
    try:
        return await run_in_threadpool(
            _list_hub_absences_payload,
            on=on,
            starts_on=starts_on,
            ends_on=ends_on,
            limit=int(limit),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/absences")
async def create_hub_absence(
    payload: dict = Body(...),
    current_user: User = Depends(require_permission(PERM_DASHBOARD_READ)),
):
    _require_absences_manage(current_user)
    try:
        result = await run_in_threadpool(
            employee_absence_service.create,
            payload if isinstance(payload, dict) else {},
            created_by=int(current_user.id),
        )
        hub_service.publish_permission_realtime(
            permission=PERM_DASHBOARD_READ,
            event_type=HUB_DASHBOARD_INVALIDATE_EVENT,
            payload={"sections": ["absences"], "operation": "created"},
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/absences/{absence_id}")
async def update_hub_absence(
    absence_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(require_permission(PERM_DASHBOARD_READ)),
):
    _require_absences_manage(current_user)
    try:
        result = await run_in_threadpool(
            employee_absence_service.update,
            int(absence_id),
            payload if isinstance(payload, dict) else {},
        )
        hub_service.publish_permission_realtime(
            permission=PERM_DASHBOARD_READ,
            event_type=HUB_DASHBOARD_INVALIDATE_EVENT,
            payload={"sections": ["absences"], "operation": "updated"},
        )
        return result
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Запись об отсутствии не найдена") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/absences/{absence_id}")
async def delete_hub_absence(
    absence_id: int,
    current_user: User = Depends(require_permission(PERM_DASHBOARD_READ)),
):
    _require_absences_manage(current_user)
    try:
        await run_in_threadpool(employee_absence_service.delete, int(absence_id))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Запись об отсутствии не найдена") from exc
    hub_service.publish_permission_realtime(
        permission=PERM_DASHBOARD_READ,
        event_type=HUB_DASHBOARD_INVALIDATE_EVENT,
        payload={"sections": ["absences"], "operation": "deleted"},
    )
    return {"ok": True}


@router.get("/announcements")
async def get_announcements(
    q: str = Query("", min_length=0),
    priority: str = Query("", pattern="^(|low|normal|high)$"),
    unread_only: bool = Query(False),
    has_attachments: bool = Query(False),
    include_body: bool = Query(False),
    sort_by: str = Query("published_at", pattern="^(published_at|updated_at|priority)$"),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(30, ge=1, le=300),
    offset: int = Query(0, ge=0),
    category_id: str = Query(""),
    tag: str = Query(""),
    bookmarked_only: bool = Query(False),
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    return hub_service.list_announcements(
        user_id=int(current_user.id),
        q=_normalize_text(q),
        priority=_normalize_text(priority),
        unread_only=bool(unread_only),
        has_attachments=bool(has_attachments),
        include_body=bool(include_body),
        sort_by=_normalize_text(sort_by),
        sort_dir=_normalize_text(sort_dir),
        limit=int(limit),
        offset=int(offset),
        category_id=_normalize_text(category_id),
        tag=_normalize_text(tag),
        bookmarked_only=bool(bookmarked_only),
    )


@router.get("/announcements/{announcement_id}")
async def get_announcement(
    announcement_id: str,
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    try:
        item = hub_service.get_announcement(
            announcement_id,
            user_id=int(current_user.id),
            is_admin=_can_moderate_announcements(current_user),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not item:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return item


@router.post("/announcements")
async def create_announcement(
    request: Request,
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_WRITE)),
):
    try:
        title = ""
        preview = ""
        body = ""
        priority = "normal"
        attachments: list[dict] = []

        content_type = _normalize_text(request.headers.get("content-type")).lower()
        if "multipart/form-data" in content_type:
            form = await request.form()
            title = _normalize_text(form.get("title"))
            preview = _normalize_text(form.get("preview"))
            body = _normalize_text(form.get("body"))
            priority = _normalize_text(form.get("priority"), "normal")
            audience_scope = _normalize_text(form.get("audience_scope"), "all")
            audience_roles = _coerce_json_list(form.get("audience_roles"))
            audience_user_ids = _coerce_json_list(form.get("audience_user_ids"))
            requires_ack = _coerce_bool(form.get("requires_ack"))
            is_pinned = _coerce_bool(form.get("is_pinned"))
            pinned_until = _normalize_text(form.get("pinned_until"))
            published_from = _normalize_text(form.get("published_from"))
            expires_at = _normalize_text(form.get("expires_at"))
            is_active = _coerce_bool(form.get("is_active"), default=True)
            status = _normalize_text(form.get("status"), "published")
            comments_enabled = _coerce_bool(form.get("comments_enabled"), default=True)
            reactions_enabled = _coerce_bool(form.get("reactions_enabled"), default=True)
            category_id = _normalize_text(form.get("category_id"))
            tags = _coerce_json_list(form.get("tags"))
            poll = _coerce_json_object(form.get("poll"))
            client_request_id = _normalize_text(form.get("client_request_id"))
            form_files = form.getlist("files")
            for form_file in form_files:
                if form_file is None or not hasattr(form_file, "read"):
                    continue
                file_name = _normalize_text(getattr(form_file, "filename", "")) or "file.bin"
                file_mime = _normalize_text(getattr(form_file, "content_type", ""))
                payload_bytes = await form_file.read()
                _validate_upload(
                    file_name=file_name,
                    payload_size=len(payload_bytes),
                    max_bytes=MAX_ANNOUNCEMENT_FILE_BYTES,
                    context="Announcement attachment",
                )
                attachments.append(
                    {
                        "file_name": file_name,
                        "file_mime": file_mime,
                        "file_bytes": payload_bytes,
                    }
                )
        else:
            payload = await request.json()
            if not isinstance(payload, dict):
                raise HTTPException(status_code=400, detail="Invalid announcement payload")
            title = _normalize_text(payload.get("title"))
            preview = _normalize_text(payload.get("preview"))
            body = _normalize_text(payload.get("body"))
            priority = _normalize_text(payload.get("priority"), "normal")
            audience_scope = _normalize_text(payload.get("audience_scope"), "all")
            audience_roles = payload.get("audience_roles")
            audience_user_ids = payload.get("audience_user_ids")
            requires_ack = _coerce_bool(payload.get("requires_ack"))
            is_pinned = _coerce_bool(payload.get("is_pinned"))
            pinned_until = _normalize_text(payload.get("pinned_until"))
            published_from = _normalize_text(payload.get("published_from"))
            expires_at = _normalize_text(payload.get("expires_at"))
            is_active = payload.get("is_active") is not False
            status = _normalize_text(payload.get("status"), "published")
            comments_enabled = payload.get("comments_enabled") is not False
            reactions_enabled = payload.get("reactions_enabled") is not False
            category_id = _normalize_text(payload.get("category_id"))
            tags = payload.get("tags") if isinstance(payload.get("tags"), list) else []
            poll = payload.get("poll") if isinstance(payload.get("poll"), dict) else None
            client_request_id = _normalize_text(payload.get("client_request_id"))
        return hub_service.create_announcement(
            payload={
                "title": title,
                "preview": preview,
                "body": body,
                "priority": priority,
                "audience_scope": audience_scope,
                "audience_roles": audience_roles,
                "audience_user_ids": audience_user_ids,
                "requires_ack": requires_ack,
                "is_pinned": is_pinned,
                "pinned_until": pinned_until,
                "published_from": published_from,
                "expires_at": expires_at,
                "is_active": is_active,
                "status": status,
                "comments_enabled": comments_enabled,
                "reactions_enabled": reactions_enabled,
                "category_id": category_id,
                "tags": tags,
                "poll": poll,
                "client_request_id": client_request_id,
            },
            actor=_actor_dict(current_user),
            attachments=attachments,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/announcements/drafts")
async def create_announcement_draft(
    payload: dict = Body(default={}),
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_WRITE)),
):
    try:
        source = dict(payload or {})
        source["status"] = "draft"
        return await run_in_threadpool(
            hub_service.create_announcement,
            payload=source,
            actor=_actor_dict(current_user),
            attachments=[],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/announcements/{announcement_id}")
async def patch_announcement(
    announcement_id: str,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_active_user),
):
    _require_announcement_manager(current_user)
    try:
        updated = hub_service.update_announcement(
            announcement_id,
            payload or {},
            actor_user_id=int(current_user.id),
            is_admin=_can_moderate_announcements(current_user),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return updated


@router.post("/announcements/{announcement_id}/publish")
async def publish_announcement(
    announcement_id: str,
    current_user: User = Depends(get_current_active_user),
):
    _require_announcement_manager(current_user)
    try:
        return await run_in_threadpool(hub_service.publish_announcement, announcement_id=announcement_id, user=_actor_dict(current_user))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/announcements/{announcement_id}/archive")
async def archive_announcement(
    announcement_id: str,
    current_user: User = Depends(get_current_active_user),
):
    _require_announcement_manager(current_user)
    try:
        return await run_in_threadpool(hub_service.archive_announcement, announcement_id=announcement_id, user=_actor_dict(current_user))
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.put("/announcements/{announcement_id}/reaction")
async def set_announcement_reaction(
    announcement_id: str,
    payload: dict = Body(...),
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    try:
        return await run_in_threadpool(
            hub_service.set_announcement_reaction,
            announcement_id=announcement_id,
            user=_actor_dict(current_user),
            reaction_type=_normalize_text((payload or {}).get("reaction_type")),
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/announcements/{announcement_id}/reaction")
async def delete_announcement_reaction(
    announcement_id: str,
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    return await run_in_threadpool(hub_service.set_announcement_reaction, announcement_id=announcement_id, user=_actor_dict(current_user), reaction_type=None)


@router.get("/announcements/{announcement_id}/reactions")
async def list_announcement_reactions(
    announcement_id: str,
    reaction_type: str = Query(""),
    limit: int | None = Query(None, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    items = await run_in_threadpool(
        hub_service.list_announcement_reaction_users,
        announcement_id=announcement_id,
        reaction_type=reaction_type,
    )
    total = len(items)
    if limit is None:
        return {"items": items}
    page = items[offset:offset + limit]
    next_offset = offset + len(page) if offset + len(page) < total else None
    return {"items": page, "total": total, "next_offset": next_offset}


@router.put("/announcements/{announcement_id}/bookmark")
async def bookmark_announcement(
    announcement_id: str,
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    return await run_in_threadpool(hub_service.set_announcement_bookmark, announcement_id=announcement_id, user=_actor_dict(current_user), bookmarked=True)


@router.delete("/announcements/{announcement_id}/bookmark")
async def unbookmark_announcement(
    announcement_id: str,
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    return await run_in_threadpool(hub_service.set_announcement_bookmark, announcement_id=announcement_id, user=_actor_dict(current_user), bookmarked=False)


@router.put("/announcements/{announcement_id}/poll/vote")
async def vote_announcement_poll(
    announcement_id: str,
    payload: dict = Body(...),
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    try:
        return await run_in_threadpool(
            hub_service.vote_announcement_poll,
            announcement_id=announcement_id,
            user=_actor_dict(current_user),
            option_ids=(payload or {}).get("option_ids") or [],
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/announcements/{announcement_id}/analytics")
async def get_announcement_analytics(
    announcement_id: str,
    limit: int | None = Query(None, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_active_user),
):
    _require_announcement_manager(current_user)
    detail = hub_service.get_announcement(announcement_id, user_id=int(current_user.id), is_admin=_can_moderate_announcements(current_user))
    if not detail:
        raise HTTPException(status_code=404, detail="Announcement not found")
    if not detail.get("can_manage") and not _can_moderate_announcements(current_user):
        raise HTTPException(status_code=403, detail="Analytics are available only to the author or moderator")
    payload = await run_in_threadpool(hub_service.get_announcement_analytics, announcement_id=announcement_id)
    if limit is None:
        return payload
    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    total = len(items)
    page = items[offset:offset + limit]
    return {
        **payload,
        "items": page,
        "items_total": total,
        "next_offset": offset + len(page) if offset + len(page) < total else None,
    }


@router.post("/announcements/{announcement_id}/attachments")
async def upload_announcement_attachment(
    announcement_id: str,
    file: UploadFile = File(...),
    client_upload_id: str = Form(""),
    current_user: User = Depends(get_current_active_user),
):
    _require_announcement_manager(current_user)
    file_name = _normalize_text(file.filename) or "file.bin"
    file_bytes = await file.read()
    _validate_upload(file_name=file_name, payload_size=len(file_bytes), max_bytes=MAX_ANNOUNCEMENT_FILE_BYTES, context="Announcement attachment")
    try:
        return await run_in_threadpool(
            hub_service.add_announcement_attachment,
            announcement_id=announcement_id,
            user=_actor_dict(current_user),
            file_name=file_name,
            file_bytes=file_bytes,
            file_mime=_normalize_text(file.content_type),
            client_upload_id=_normalize_text(client_upload_id),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.patch("/announcements/{announcement_id}/attachments/order")
async def reorder_announcement_attachments(
    announcement_id: str,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_active_user),
):
    _require_announcement_manager(current_user)
    return await run_in_threadpool(
        hub_service.update_announcement_attachment_order,
        announcement_id=announcement_id,
        user=_actor_dict(current_user),
        attachment_ids=(payload or {}).get("attachment_ids") or [],
        cover_attachment_id=_normalize_text((payload or {}).get("cover_attachment_id")),
    )


@router.delete("/announcements/{announcement_id}/attachments/{attachment_id}")
async def delete_announcement_attachment(
    announcement_id: str,
    attachment_id: str,
    current_user: User = Depends(get_current_active_user),
):
    _require_announcement_manager(current_user)
    if not await run_in_threadpool(hub_service.delete_announcement_attachment, announcement_id=announcement_id, attachment_id=attachment_id, user=_actor_dict(current_user)):
        raise HTTPException(status_code=404, detail="Attachment not found")
    return {"ok": True}


@router.delete("/announcements/{announcement_id}")
async def delete_announcement(
    announcement_id: str,
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_MODERATE)),
):
    try:
        ok = hub_service.delete_announcement(
            announcement_id=announcement_id,
            actor_user_id=int(current_user.id),
            is_admin=True,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return {"ok": True, "announcement_id": announcement_id}


@router.post("/announcements/{announcement_id}/mark-as-read")
async def mark_announcement_as_read(
    announcement_id: str,
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    try:
        ok = hub_service.mark_announcement_read(
            announcement_id=announcement_id,
            user=_actor_dict(current_user),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return {"ok": True, "announcement_id": announcement_id}


@router.post("/announcements/{announcement_id}/ack")
async def acknowledge_announcement(
    announcement_id: str,
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    try:
        return hub_service.acknowledge_announcement(
            announcement_id=announcement_id,
            user=_actor_dict(current_user),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/announcements/{announcement_id}/reads")
async def get_announcement_reads(
    announcement_id: str,
    current_user: User = Depends(get_current_active_user),
):
    _require_announcement_manager(current_user)
    try:
        detail = hub_service.get_announcement(
            announcement_id,
            user_id=int(current_user.id),
            is_admin=_can_moderate_announcements(current_user),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not detail:
        raise HTTPException(status_code=404, detail="Announcement not found")
    if not detail.get("can_manage") and not _can_moderate_announcements(current_user):
        raise HTTPException(status_code=403, detail="Announcement reads are available only for managers")
    return hub_service.get_announcement_reads(announcement_id)


@router.get("/announcements/{announcement_id}/attachments/{attachment_id}/file")
async def download_announcement_attachment(
    announcement_id: str,
    attachment_id: str,
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    try:
        detail = hub_service.get_announcement(
            announcement_id,
            user_id=int(current_user.id),
            is_admin=_can_moderate_announcements(current_user),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not detail:
        raise HTTPException(status_code=404, detail="Announcement not found")
    item = hub_service.get_announcement_attachment(
        announcement_id=announcement_id,
        attachment_id=attachment_id,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Announcement attachment not found")
    file_path = Path(_normalize_text(item.get("file_abs_path")))
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Announcement attachment file is not available")
    return FileResponse(
        path=str(file_path),
        filename=_normalize_text(item.get("file_name"), file_path.name),
        media_type=_normalize_text(item.get("file_mime")) or "application/octet-stream",
    )


@router.get("/announcements/manage")
async def list_managed_announcements(
    status: str = Query("draft", pattern="^(draft|scheduled|published|archived)$"),
    limit: int = Query(100, ge=1, le=300),
    current_user: User = Depends(get_current_active_user),
):
    _require_announcement_manager(current_user)
    return await run_in_threadpool(
        hub_service.list_managed_announcements,
        user=_actor_dict(current_user),
        status=status,
        limit=limit,
    )


@router.get("/announcement-categories")
async def list_announcement_categories(
    include_inactive: bool = Query(False),
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    if include_inactive and not _can_moderate_announcements(current_user):
        raise HTTPException(status_code=403, detail="Announcement moderation permission required")
    return {"items": await run_in_threadpool(hub_service.list_announcement_categories, include_inactive=include_inactive)}


@router.post("/announcement-categories")
async def create_announcement_category(
    payload: dict = Body(...),
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_MODERATE)),
):
    try:
        return await run_in_threadpool(hub_service.save_announcement_category, payload=payload or {}, actor_user_id=int(current_user.id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/announcement-categories/{category_id}")
async def update_announcement_category(
    category_id: str,
    payload: dict = Body(...),
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_MODERATE)),
):
    try:
        return await run_in_threadpool(hub_service.save_announcement_category, payload=payload or {}, actor_user_id=int(current_user.id), category_id=category_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/announcement-categories/{category_id}")
async def delete_announcement_category(
    category_id: str,
    _: User = Depends(require_permission(PERM_ANNOUNCEMENTS_MODERATE)),
):
    if not await run_in_threadpool(hub_service.delete_announcement_category, category_id):
        raise HTTPException(status_code=404, detail="Category not found")
    return {"ok": True}


@router.get("/announcement-tags")
async def list_announcement_tags(
    _: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    return {"items": await run_in_threadpool(hub_service.list_announcement_tags)}


@router.put("/announcements/{announcement_id}/like")
async def like_announcement(
    announcement_id: str,
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    try:
        return hub_service.set_announcement_like(
            announcement_id=announcement_id,
            user=_actor_dict(current_user),
            liked=True,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/announcements/{announcement_id}/like")
async def unlike_announcement(
    announcement_id: str,
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    try:
        return hub_service.set_announcement_like(
            announcement_id=announcement_id,
            user=_actor_dict(current_user),
            liked=False,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/announcements/{announcement_id}/comments")
async def list_announcement_comments(
    announcement_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    sort: str = Query("interesting", pattern="^(interesting|newest|oldest)$"),
    root_comment_id: str = Query(""),
    changed_since: str = Query(""),
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    try:
        return hub_service.list_announcement_comments(
            announcement_id=announcement_id,
            user=_actor_dict(current_user),
            limit=int(limit),
            offset=int(offset),
            sort=sort,
            root_comment_id=root_comment_id,
            changed_since=changed_since,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/announcements/{announcement_id}/comments")
async def create_announcement_comment(
    announcement_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    try:
        attachments: list[dict] = []
        content_type = _normalize_text(request.headers.get("content-type")).lower()
        if "multipart/form-data" in content_type:
            form = await request.form()
            body = _normalize_text(form.get("body"))
            parent_comment_id = _normalize_text(form.get("parent_comment_id"))
            mentioned_user_ids = _coerce_json_list(form.get("mentioned_user_ids"))
            client_request_id = _normalize_text(form.get("client_request_id"))
            for form_file in form.getlist("files"):
                if form_file is None or not hasattr(form_file, "read"):
                    continue
                file_name = _normalize_text(getattr(form_file, "filename", "")) or "file.bin"
                file_bytes = await form_file.read()
                _validate_upload(
                    file_name=file_name,
                    payload_size=len(file_bytes),
                    max_bytes=MAX_ANNOUNCEMENT_FILE_BYTES,
                    context="Comment attachment",
                )
                attachments.append({
                    "file_name": file_name,
                    "file_mime": _normalize_text(getattr(form_file, "content_type", "")),
                    "file_bytes": file_bytes,
                })
        else:
            payload = await request.json()
            payload = payload if isinstance(payload, dict) else {}
            body = _normalize_text(payload.get("body"))
            parent_comment_id = _normalize_text(payload.get("parent_comment_id"))
            mentioned_user_ids = payload.get("mentioned_user_ids") if isinstance(payload.get("mentioned_user_ids"), list) else []
            client_request_id = _normalize_text(payload.get("client_request_id"))
        return hub_service.add_announcement_comment(
            announcement_id=announcement_id,
            user=_actor_dict(current_user),
            body=body,
            parent_comment_id=parent_comment_id,
            mentioned_user_ids=mentioned_user_ids,
            attachments=attachments,
            client_request_id=client_request_id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/announcements/{announcement_id}/comments/{comment_id}")
async def update_announcement_comment(
    announcement_id: str,
    comment_id: str,
    payload: dict = Body(...),
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    try:
        return hub_service.update_announcement_comment(
            announcement_id=announcement_id,
            comment_id=comment_id,
            user=_actor_dict(current_user),
            body=_normalize_text((payload or {}).get("body")),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/announcements/{announcement_id}/comments/{comment_id}")
async def delete_announcement_comment(
    announcement_id: str,
    comment_id: str,
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    try:
        deleted = hub_service.delete_announcement_comment(
            announcement_id=announcement_id,
            comment_id=comment_id,
            user=_actor_dict(current_user),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Comment not found")
    return {"ok": True, "comment_id": comment_id}


@router.put("/announcements/{announcement_id}/comments/{comment_id}/reaction")
async def set_announcement_comment_reaction(
    announcement_id: str,
    comment_id: str,
    payload: dict = Body(...),
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    try:
        return await run_in_threadpool(
            hub_service.set_announcement_comment_reaction,
            announcement_id=announcement_id,
            comment_id=comment_id,
            user=_actor_dict(current_user),
            reaction_type=_normalize_text((payload or {}).get("reaction_type")),
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/announcements/{announcement_id}/comments/{comment_id}/reaction")
async def delete_announcement_comment_reaction(
    announcement_id: str,
    comment_id: str,
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    return await run_in_threadpool(
        hub_service.set_announcement_comment_reaction,
        announcement_id=announcement_id,
        comment_id=comment_id,
        user=_actor_dict(current_user),
        reaction_type=None,
    )


@router.get("/announcements/{announcement_id}/comments/{comment_id}/attachments/{attachment_id}/file")
async def download_announcement_comment_attachment(
    announcement_id: str,
    comment_id: str,
    attachment_id: str,
    current_user: User = Depends(require_permission(PERM_ANNOUNCEMENTS_READ)),
):
    hub_service.get_announcement(announcement_id, user_id=int(current_user.id), is_admin=_can_moderate_announcements(current_user))
    item = hub_service.get_announcement_comment_attachment(announcement_id=announcement_id, comment_id=comment_id, attachment_id=attachment_id)
    if not item:
        raise HTTPException(status_code=404, detail="Comment attachment not found")
    file_path = Path(_normalize_text(item.get("file_abs_path")))
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Comment attachment file is not available")
    return FileResponse(path=str(file_path), filename=_normalize_text(item.get("file_name"), file_path.name), media_type=_normalize_text(item.get("file_mime")) or "application/octet-stream")


@router.get("/users/assignees")
async def get_assignee_users(
    department_id: str = Query("", min_length=0),
    q: str = Query("", min_length=0, max_length=200),
    limit: int = Query(30, ge=1, le=200),
    ids: str = Query("", min_length=0, max_length=2000),
    _: User = Depends(require_permission(PERM_TASKS_READ)),
):
    parsed_ids: list[int] = []
    if _normalize_text(ids):
        for part in ids.split(","):
            token = part.strip()
            if not token:
                continue
            try:
                parsed_ids.append(int(token))
            except ValueError:
                continue
    return await run_in_threadpool(
        hub_service.search_assignees,
        department_id=_normalize_text(department_id) or None,
        q=_normalize_text(q),
        limit=int(limit),
        ids=parsed_ids or None,
    )


@router.get("/users/controllers")
async def get_controller_users(
    department_id: str = Query("", min_length=0),
    _: User = Depends(require_permission(PERM_TASKS_READ)),
):
    items = await run_in_threadpool(
        hub_service.list_controllers,
        department_id=_normalize_text(department_id) or None,
    )
    return {"items": items}


@router.get("/task-projects")
async def get_task_projects(
    include_inactive: bool = Query(False),
    _: User = Depends(require_permission(PERM_TASKS_READ)),
):
    items = await run_in_threadpool(
        hub_service.list_task_projects,
        include_inactive=bool(include_inactive),
    )
    return {"items": items}


@router.post("/task-projects")
async def create_task_project(
    payload: dict = Body(...),
    _: User = Depends(require_any_permission((PERM_TASKS_CREATE, PERM_TASKS_WRITE))),
):
    try:
        return hub_service.create_task_project(
            name=_normalize_text(payload.get("name")),
            code=_normalize_text(payload.get("code")),
            description=_normalize_text(payload.get("description")),
            is_active=payload.get("is_active") is not False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/task-projects/{project_id}")
async def patch_task_project(
    project_id: str,
    payload: dict = Body(...),
    _: User = Depends(require_permission(PERM_TASKS_WRITE)),
):
    try:
        updated = hub_service.update_task_project(project_id, payload or {})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found")
    return updated


@router.get("/task-objects")
async def get_task_objects(
    project_id: list[str] = Query(default=[]),
    include_inactive: bool = Query(False),
    _: User = Depends(require_permission(PERM_TASKS_READ)),
):
    items = await run_in_threadpool(
        hub_service.list_task_objects,
        project_ids=project_id,
        include_inactive=bool(include_inactive),
    )
    return {"items": items}


@router.post("/task-objects")
async def create_task_object(
    payload: dict = Body(...),
    _: User = Depends(require_permission(PERM_TASKS_WRITE)),
):
    try:
        return hub_service.create_task_object(
            project_id=_normalize_text(payload.get("project_id")),
            name=_normalize_text(payload.get("name")),
            code=_normalize_text(payload.get("code")),
            description=_normalize_text(payload.get("description")),
            is_active=payload.get("is_active") is not False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/task-objects/{object_id}")
async def patch_task_object(
    object_id: str,
    payload: dict = Body(...),
    _: User = Depends(require_permission(PERM_TASKS_WRITE)),
):
    try:
        updated = hub_service.update_task_object(object_id, payload or {})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Object not found")
    return updated


@router.get("/users/announcement-recipients")
async def get_announcement_recipient_users(
    q: str = Query("", max_length=200),
    limit: Optional[int] = Query(None, ge=1, le=200),
    user_ids: str = Query("", max_length=2000),
    _: User = Depends(require_permission(PERM_ANNOUNCEMENTS_WRITE)),
):
    parsed_user_ids = [
        int(value)
        for value in _coerce_json_list(user_ids)[:100]
        if str(value).isdigit() and int(value) > 0
    ]
    return await run_in_threadpool(
        hub_service.list_announcement_recipients,
        q=q,
        limit=limit,
        user_ids=parsed_user_ids,
    )


@router.post("/markdown/transform")
async def transform_markdown(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_active_user),
):
    context = _normalize_text(payload.get("context")).lower()
    text = _normalize_text(payload.get("text"))

    if context not in {"announcement", "task"}:
        raise HTTPException(status_code=400, detail="context must be 'announcement' or 'task'")
    if len(text) < 3:
        raise HTTPException(status_code=400, detail="Text is too short for transformation")
    if len(text) > 20000:
        raise HTTPException(status_code=413, detail="Text is too large (max 20000 symbols)")

    if context == "announcement":
        ensure_user_permission(current_user, PERM_ANNOUNCEMENTS_WRITE)
    else:
        ensure_user_any_permission(current_user, (PERM_TASKS_CREATE, PERM_TASKS_WRITE))

    try:
        return markdown_transform_service.transform_text(text=text, context=context)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except MarkdownTransformConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except MarkdownTransformError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/tasks")
async def get_tasks(
    scope: str = Query("my", pattern="^(my|department|all)$"),
    role_scope: str = Query("both", pattern="^(assignee|creator|controller|both)$"),
    status_filter: str = Query("", alias="status"),
    q: str = Query("", min_length=0),
    assignee_user_id: Optional[int] = Query(None, ge=1),
    controller_user_id: Optional[int] = Query(None, ge=1),
    department_id: str = Query("", min_length=0),
    has_attachments: bool = Query(False),
    due_state: str = Query("", pattern="^(|overdue|today|upcoming|none)$"),
    unread_comments_only: bool = Query(False),
    focus_mode: str = Query("", pattern="^(|review|overdue|comments)$"),
    sort_by: str = Query("status", pattern="^(status|updated_at|due_at)$"),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    allow_all = str(getattr(current_user, "role", "") or "").lower() == "admin" or _has_permission(current_user, PERM_TASKS_MANAGE_ALL)
    if scope == "all" and not allow_all:
        raise HTTPException(status_code=403, detail="Insufficient permissions: tasks.all")
    payload = await run_in_threadpool(
        hub_service.list_tasks,
        user_id=int(current_user.id),
        scope=scope,
        role_scope=_normalize_text(role_scope).lower(),
        status_filter=_normalize_text(status_filter).lower(),
        q=_normalize_text(q),
        assignee_user_id=assignee_user_id,
        controller_user_id=controller_user_id,
        department_id=_normalize_text(department_id) or None,
        has_attachments=bool(has_attachments),
        due_state=_normalize_text(due_state).lower(),
        unread_comments_only=bool(unread_comments_only),
        focus_mode=_normalize_text(focus_mode).lower(),
        sort_by=_normalize_text(sort_by).lower(),
        sort_dir=_normalize_text(sort_dir).lower(),
        limit=int(limit),
        offset=int(offset),
        allow_all_scope=allow_all,
    )
    return _enrich_task_collection(payload)


@router.get("/tasks/analytics")
async def get_task_analytics(
    start_date: str = Query("", min_length=0),
    end_date: str = Query("", min_length=0),
    date_basis: str = Query("protocol_date", pattern="^(protocol_date|completed_at|due_at)$"),
    project_id: list[str] = Query(default=[]),
    object_id: list[str] = Query(default=[]),
    participant_user_id: list[int] = Query(default=[]),
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    return await run_in_threadpool(
        hub_service.get_task_analytics,
        start_date=_normalize_text(start_date) or None,
        end_date=_normalize_text(end_date) or None,
        date_basis=_normalize_text(date_basis, "protocol_date"),
        project_ids=project_id,
        object_ids=object_id,
        participant_user_ids=participant_user_id,
        current_user=current_user,
    )


@router.get("/tasks/analytics/export")
async def export_task_analytics(
    start_date: str = Query("", min_length=0),
    end_date: str = Query("", min_length=0),
    date_basis: str = Query("protocol_date", pattern="^(protocol_date|completed_at|due_at)$"),
    project_id: list[str] = Query(default=[]),
    object_id: list[str] = Query(default=[]),
    participant_user_id: list[int] = Query(default=[]),
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    file_bytes, filename = await run_in_threadpool(
        build_task_analytics_excel,
        hub_service_impl=hub_service,
        start_date=_normalize_text(start_date) or None,
        end_date=_normalize_text(end_date) or None,
        date_basis=_normalize_text(date_basis, "protocol_date"),
        project_ids=project_id,
        object_ids=object_id,
        participant_user_ids=participant_user_id,
        current_user=current_user,
    )
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
    }
    return StreamingResponse(
        iter([file_bytes]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@router.post("/tasks")
async def create_task(
    payload: dict = Body(...),
    current_user: User = Depends(require_any_permission((PERM_TASKS_CREATE, PERM_TASKS_WRITE))),
):
    try:
        controller_raw = payload.get("controller_user_id")
        controller_user_id = 0 if controller_raw in (None, "", 0, "0") else int(controller_raw)
        assignee_ids_raw = payload.get("assignee_user_ids")
        assignee_ids: list[int] = []
        if isinstance(assignee_ids_raw, list):
            for item in assignee_ids_raw:
                try:
                    value = int(item)
                except Exception:
                    continue
                if value not in assignee_ids:
                    assignee_ids.append(value)
        if not assignee_ids:
            single_assignee = payload.get("assignee_user_id")
            if single_assignee is not None:
                assignee_ids = [int(single_assignee)]
        if not assignee_ids:
            raise ValueError("At least one assignee is required")

        observer_ids_raw = payload.get("observer_user_ids")
        observer_ids: list[int] = []
        if isinstance(observer_ids_raw, list):
            for item in observer_ids_raw:
                try:
                    value = int(item)
                except Exception:
                    continue
                if value not in observer_ids:
                    observer_ids.append(value)

        due_at_value = _normalize_text(payload.get("due_at")) or None
        email_deadline_remind_hours = None
        if due_at_value and "email_deadline_remind_hours" in payload:
            email_deadline_remind_hours = _normalize_email_deadline_remind_hours(payload.get("email_deadline_remind_hours"))

        created_task = await run_in_threadpool(
            hub_service.create_task,
            title=_normalize_text(payload.get("title")),
            description=_normalize_text(payload.get("description")),
            assignee_user_id=assignee_ids[0],
            assignee_user_ids=assignee_ids,
            controller_user_id=controller_user_id,
            due_at=due_at_value,
            project_id=_normalize_text(payload.get("project_id")) or None,
            object_id=_normalize_text(payload.get("object_id")) or None,
            protocol_date=_normalize_text(payload.get("protocol_date")) or None,
            priority=_normalize_text(payload.get("priority"), "normal"),
            checklist_items=payload.get("checklist_items") if isinstance(payload.get("checklist_items"), list) else [],
            department_id=_normalize_text(payload.get("department_id")) or None,
            visibility_scope=_normalize_text(payload.get("visibility_scope")) or None,
            email_deadline_remind_hours=email_deadline_remind_hours,
            observer_user_ids=observer_ids,
            actor=_actor_dict(current_user),
        )
        await _safe_provision_task_discussion(
            task=created_task,
            actor_user_id=int(current_user.id),
        )
        created_items = [created_task]
        return {
            "items": transfer_act_reminder_service.enrich_tasks(created_items),
            "created": len(created_items),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.get("/tasks/{task_id}")
async def get_task(
    task_id: str,
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    try:
        item = await run_in_threadpool(
            hub_service.get_task,
            task_id,
            user_id=int(current_user.id),
            is_admin=_can_moderate_announcements(current_user),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not item:
        raise HTTPException(status_code=404, detail="Task not found")
    await run_in_threadpool(
        hub_service.mark_task_notifications_read,
        task_id=task_id,
        user_id=int(current_user.id),
    )
    return _enrich_task_payload_for_user(item, current_user)


@router.get("/tasks/{task_id}/canvas", response_model=TaskCanvasResponse)
async def get_task_canvas(
    task_id: str,
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    try:
        return await run_in_threadpool(
            hub_service.get_task_canvas,
            task_id=task_id,
            actor=_actor_dict(current_user),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/tasks/{task_id}/canvas", response_model=TaskCanvasResponse)
async def put_task_canvas(
    task_id: str,
    payload: TaskCanvasUpdateRequest,
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    try:
        return await run_in_threadpool(
            hub_service.save_task_canvas,
            task_id=task_id,
            scene=payload.scene.model_dump(by_alias=True),
            expected_revision=payload.revision,
            actor=_actor_dict(current_user),
        )
    except TaskCanvasRevisionConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Доска была изменена в другой вкладке. Обновите её перед повторным сохранением.",
                "current_revision": exc.current_revision,
            },
        ) from exc
    except TaskCanvasTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/tasks/{task_id}")
async def patch_task(
    task_id: str,
    payload: dict = Body(...),
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    try:
        updated = await run_in_threadpool(
            hub_service.update_task,
            task_id,
            payload or {},
            actor_user_id=int(current_user.id),
            is_admin=_is_admin_user(current_user),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found")
    await publish_task_discussion_updated(task_id=task_id, task=updated)
    return _enrich_task_payload(updated)


@router.delete("/tasks/{task_id}")
async def delete_task(
    task_id: str,
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    try:
        is_admin = _is_admin_user(current_user)
        ok = await run_in_threadpool(
            hub_service.delete_task,
            task_id=task_id,
            actor_user_id=int(current_user.id),
            is_admin=is_admin,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Task not found")
    await delete_task_discussion(task_id=task_id)
    return {"ok": True, "task_id": task_id}


@router.post("/tasks/{task_id}/start")
async def start_task(
    task_id: str,
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    try:
        updated = await run_in_threadpool(
            hub_service.start_task,
            task_id=task_id,
            user=_actor_dict(current_user),
        )
    except TaskTransitionConflict as exc:
        raise _http_task_transition_conflict(exc) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found")
    await run_in_threadpool(
        hub_service.mark_task_notifications_read,
        task_id=task_id,
        user_id=int(current_user.id),
    )
    await _safe_publish_task_discussion_updated(task_id=task_id, task=updated, operation="start")
    return _enrich_task_payload(updated)


@router.post("/tasks/{task_id}/reopen")
async def reopen_task(
    task_id: str,
    payload: dict = Body(default_factory=dict),
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    reopen_kwargs = {
        "task_id": task_id,
        "user": _actor_dict(current_user),
        "is_admin": _is_admin_user(current_user),
    }
    if isinstance(payload, dict) and "due_at" in payload:
        reopen_kwargs["due_at"] = _normalize_text(payload.get("due_at")) or None
        reopen_kwargs["due_at_provided"] = True
    try:
        updated = await run_in_threadpool(
            hub_service.reopen_task,
            **reopen_kwargs,
        )
    except TaskTransitionConflict as exc:
        raise _http_task_transition_conflict(exc) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found")
    await run_in_threadpool(
        hub_service.mark_task_notifications_read,
        task_id=task_id,
        user_id=int(current_user.id),
    )
    await _safe_publish_task_discussion_updated(task_id=task_id, task=updated, operation="reopen")
    return _enrich_task_payload_for_user(updated, current_user)


@router.post("/tasks/{task_id}/submit")
async def submit_task(
    task_id: str,
    comment: str = Form(""),
    file: Optional[UploadFile] = File(None),
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    file_name = None
    file_bytes = None
    file_mime = None
    if file is not None:
        file_name = _normalize_text(file.filename) or "report.bin"
        file_mime = _normalize_text(file.content_type)
        payload = await file.read()
        _validate_upload(
            file_name=file_name,
            payload_size=len(payload),
            max_bytes=MAX_TASK_REPORT_FILE_BYTES,
            context="Task report",
        )
        file_bytes = payload
    try:
        updated = await run_in_threadpool(
            hub_service.submit_task,
            task_id=task_id,
            user=_actor_dict(current_user),
            comment=_normalize_text(comment),
            file_name=file_name,
            file_bytes=file_bytes,
            file_mime=file_mime,
        )
    except TaskTransitionConflict as exc:
        raise _http_task_transition_conflict(exc) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError:
        raise HTTPException(status_code=404, detail="Task not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found")
    await _safe_publish_task_discussion_updated(task_id=task_id, task=updated, operation="submit")
    return _enrich_task_payload(updated)


@router.post("/tasks/{task_id}/attachments")
async def upload_task_attachment(
    task_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    file_name = _normalize_text(file.filename) or "file.bin"
    file_mime = _normalize_text(file.content_type)
    payload = await file.read()
    _validate_upload(
        file_name=file_name,
        payload_size=len(payload),
        max_bytes=MAX_TASK_ATTACHMENT_FILE_BYTES,
        context="Task attachment",
    )
    try:
        created = await run_in_threadpool(
            hub_service.add_task_attachment,
            task_id=task_id,
            user=_actor_dict(current_user),
            file_name=file_name,
            file_bytes=payload,
            file_mime=file_mime,
            can_review=_has_permission(current_user, PERM_TASKS_REVIEW),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not created:
        raise HTTPException(status_code=404, detail="Task not found")
    return created


@router.post("/tasks/{task_id}/review")
async def review_task(
    task_id: str,
    payload: dict = Body(...),
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    try:
        updated = await run_in_threadpool(
            hub_service.review_task,
            task_id=task_id,
            reviewer=_actor_dict(current_user),
            decision=_normalize_text(payload.get("decision")),
            comment=_normalize_text(payload.get("comment")),
            is_admin=_is_admin_user(current_user),
        )
    except TaskTransitionConflict as exc:
        raise _http_task_transition_conflict(exc) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found")
    await _safe_publish_task_discussion_updated(task_id=task_id, task=updated, operation="review")
    return _enrich_task_payload(updated)


@router.post("/tasks/{task_id}/complete")
async def complete_task(
    task_id: str,
    payload: dict = Body(default_factory=dict),
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    try:
        updated = await run_in_threadpool(
            hub_service.complete_task_direct,
            task_id=task_id,
            actor=_actor_dict(current_user),
            comment=_normalize_text((payload or {}).get("comment")),
            enforce_permission=True,
        )
    except TaskTransitionConflict as exc:
        raise _http_task_transition_conflict(exc) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found")
    await run_in_threadpool(
        hub_service.mark_task_notifications_read,
        task_id=task_id,
        user_id=int(current_user.id),
    )
    await _safe_publish_task_discussion_updated(task_id=task_id, task=updated, operation="complete")
    return _enrich_task_payload_for_user(updated, current_user)


@router.get("/tasks/{task_id}/attachments/{attachment_id}/file")
async def download_task_attachment(
    task_id: str,
    attachment_id: str,
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    try:
        task = hub_service.get_task(
            task_id,
            user_id=int(current_user.id),
            is_admin=_is_admin_user(current_user),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    item = hub_service.get_task_attachment(task_id=task_id, attachment_id=attachment_id)
    if not item:
        raise HTTPException(status_code=404, detail="Task attachment not found")
    file_path = Path(_normalize_text(item.get("file_abs_path")))
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Task attachment file is not available")
    return FileResponse(
        path=str(file_path),
        filename=_normalize_text(item.get("file_name"), file_path.name),
        media_type=_normalize_text(item.get("file_mime")) or "application/octet-stream",
    )


async def _get_authorized_task_attachment_preview(
    *,
    task_id: str,
    attachment_id: str,
    current_user: User,
    ready_artifact: bool = False,
) -> dict:
    try:
        task = await run_in_threadpool(
            hub_service.get_task,
            task_id,
            user_id=int(current_user.id),
            is_admin=_can_moderate_announcements(current_user),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    preview_pdf_path = (
        f"/api/v1/hub/tasks/{quote(str(task_id), safe='')}/attachments/"
        f"{quote(str(attachment_id), safe='')}/preview/pdf"
    )
    preview_method = (
        task_attachment_preview_service.get_ready_artifact
        if ready_artifact
        else task_attachment_preview_service.get_state
    )
    try:
        return await run_in_threadpool(
            preview_method,
            task_id=task_id,
            attachment_id=attachment_id,
            preview_pdf_path=preview_pdf_path,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/tasks/{task_id}/attachments/{attachment_id}/preview")
async def get_task_attachment_preview(
    task_id: str,
    attachment_id: str,
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    preview = await _get_authorized_task_attachment_preview(
        task_id=task_id,
        attachment_id=attachment_id,
        current_user=current_user,
    )
    status = _normalize_text(preview.get("status"), "queued").lower()
    if status == "ready":
        return preview
    if status == "failed":
        return JSONResponse(content=preview, status_code=422)
    retry_after_ms = max(100, int(preview.get("retry_after_ms") or 500))
    return JSONResponse(
        content=preview,
        status_code=202,
        headers={"Retry-After": str(max(1, (retry_after_ms + 999) // 1000))},
    )


@router.get("/tasks/{task_id}/attachments/{attachment_id}/preview/pdf")
async def download_task_attachment_preview_pdf(
    task_id: str,
    attachment_id: str,
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    preview = await _get_authorized_task_attachment_preview(
        task_id=task_id,
        attachment_id=attachment_id,
        current_user=current_user,
        ready_artifact=True,
    )
    status = _normalize_text(preview.get("status"), "queued").lower()
    if status != "ready":
        status_code = 422 if status == "failed" else 202
        headers = {}
        if status_code == 202:
            retry_after_ms = max(100, int(preview.get("retry_after_ms") or 500))
            headers["Retry-After"] = str(max(1, (retry_after_ms + 999) // 1000))
        return JSONResponse(content=preview, status_code=status_code, headers=headers)
    filename = _normalize_text(preview.get("pdf_filename"), "attachment.pdf")
    return FileResponse(
        path=str(preview["path"]),
        filename=filename,
        media_type="application/pdf",
        content_disposition_type="inline",
        headers={
            "Content-Disposition": _build_task_preview_content_disposition(filename),
            "Cache-Control": "private, max-age=300",
        },
    )


@router.get("/tasks/reports/{report_id}/file")
async def download_task_report(
    report_id: str,
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    item = hub_service.get_report(report_id)
    if not item:
        raise HTTPException(status_code=404, detail="Task report not found")
    try:
        task = hub_service.get_task(
            _normalize_text(item.get("task_id")),
            user_id=int(current_user.id),
            is_admin=_can_moderate_announcements(current_user),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    file_path = Path(_normalize_text(item.get("file_abs_path")))
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Task report file is not available")
    return FileResponse(
        path=str(file_path),
        filename=_normalize_text(item.get("file_name"), file_path.name),
        media_type=_normalize_text(item.get("file_mime")) or "application/octet-stream",
    )


@router.get("/tasks/{task_id}/discussion")
async def get_task_discussion_endpoint(
    task_id: str,
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    if not is_task_discussion_chat_enabled():
        raise HTTPException(status_code=404, detail="Task discussion chat is disabled")
    try:
        return await run_in_threadpool(
            get_task_discussion,
            task_id=task_id,
            actor_user_id=int(current_user.id),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/tasks/{task_id}/discussion")
async def open_task_discussion_endpoint(
    task_id: str,
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    if not is_task_discussion_chat_enabled():
        raise HTTPException(status_code=404, detail="Task discussion chat is disabled")
    try:
        return await run_in_threadpool(
            ensure_task_discussion,
            task_id=task_id,
            actor_user_id=int(current_user.id),
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/tasks/{task_id}/comments")
async def get_task_comments(
    task_id: str,
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    try:
        items = await run_in_threadpool(
            hub_service.list_task_comments,
            task_id,
            user_id=int(current_user.id),
            is_admin=_is_admin_user(current_user),
        )
        return {"items": items}
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/tasks/{task_id}/comments")
async def create_task_comment(
    task_id: str,
    payload: dict = Body(...),
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    body = _normalize_text(payload.get("body"))
    if len(body) < 1:
        raise HTTPException(status_code=400, detail="Comment body is required")
    try:
        result = hub_service.add_task_comment(
            task_id=task_id,
            user=_actor_dict(current_user),
            body=body,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        if str(exc) == "use_task_discussion_chat":
            raise HTTPException(status_code=400, detail="use_task_discussion_chat") from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not result:
        raise HTTPException(status_code=404, detail="Task not found")
    return result


@router.post("/tasks/{task_id}/comments/mark-seen")
async def mark_task_comments_seen(
    task_id: str,
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    try:
        result = await run_in_threadpool(
            hub_service.mark_task_comments_seen,
            task_id=task_id,
            user=_actor_dict(current_user),
            is_admin=_is_admin_user(current_user),
        )
        await run_in_threadpool(
            hub_service.mark_task_notifications_read,
            task_id=task_id,
            user_id=int(current_user.id),
            event_types=["task.comment_added"],
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not result:
        raise HTTPException(status_code=404, detail="Task not found")
    return {
        "ok": True,
        "task_id": task_id,
        "has_unread_comments": bool(result.get("has_unread_comments")),
    }


@router.get("/tasks/{task_id}/status-log")
async def get_task_status_log(
    task_id: str,
    current_user: User = Depends(require_permission(PERM_TASKS_READ)),
):
    try:
        items = await run_in_threadpool(
            hub_service.list_task_status_log,
            task_id,
            user_id=int(current_user.id),
            is_admin=_is_admin_user(current_user),
        )
        return {"items": items}
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/notifications/poll")
async def poll_notifications(
    since: str = Query("", min_length=0),
    limit: int = Query(50, ge=1, le=200),
    unread_only: bool = Query(False),
    current_user: User = Depends(_require_notifications_access),
):
    return await run_in_threadpool(
        hub_service.poll_notifications,
        user_id=int(current_user.id),
        since=_normalize_text(since),
        limit=int(limit),
        unread_only=bool(unread_only),
    )


@router.get("/notifications/unread-counts")
async def get_notification_unread_counts(
    current_user: User = Depends(_require_notifications_access),
):
    return await run_in_threadpool(hub_service.get_unread_counts, user_id=int(current_user.id))


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    current_user: User = Depends(_require_notifications_access),
):
    ok = hub_service.mark_notification_read(notification_id=notification_id, user_id=int(current_user.id))
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True, "notification_id": notification_id}


@router.post("/notifications/read-all")
async def mark_all_notifications_read(
    current_user: User = Depends(_require_notifications_access),
):
    changed = hub_service.mark_all_notifications_read(user_id=int(current_user.id))
    return {"ok": True, "marked_count": int(changed)}


@router.get("/notifications/chat-ordinary-flags")
async def notifications_chat_ordinary_flags(
    current_user: User = Depends(get_current_active_user),
):
    """Admin diagnostic: active ordinary chat hub WRITE/READ flags for this process."""
    if not _is_admin_user(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    from backend.chat.hub_bell_events import hub_ordinary_flags_snapshot

    snapshot = hub_ordinary_flags_snapshot()
    return {
        "ok": True,
        "pid": int(os.getpid()),
        "hub_chat_ordinary": {
            "ordinary_write_enabled": bool(snapshot.get("ordinary_write_enabled")),
            "ordinary_read_visible": bool(snapshot.get("ordinary_read_visible")),
            "source": str(snapshot.get("source") or "env"),
            "important_event_types": list(snapshot.get("important_event_types") or []),
            "ordinary_event_types": list(snapshot.get("ordinary_event_types") or []),
        },
        "rollout_notes": {
            "deploy": "WRITE=true READ=true (legacy)",
            "prod_stage_1": "WRITE=true READ=false (hide legacy badge, keep writer)",
            "prod_stage_2": "WRITE=false READ=false (cutover)",
            "rollback_writer_only": "WRITE=true READ=false",
            "prefer_env_restart": (
                "For production prefer env change + controlled restart of all backend "
                "instances unless file hot-reload consistency is verified on every worker."
            ),
        },
    }


@router.get("/notifications/retention/dry-run")
async def notifications_retention_dry_run(
    current_user: User = Depends(get_current_active_user),
):
    """Admin-only retention estimate. Never deletes rows."""
    if not _is_admin_user(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    from backend.services.hub_notifications_retention_service import (
        hub_notifications_retention_service,
    )

    return await run_in_threadpool(hub_notifications_retention_service.dry_run_report)


@router.post("/notifications/retention/run-once")
async def notifications_retention_run_once(
    payload: Optional[dict] = Body(None),
    current_user: User = Depends(get_current_active_user),
):
    """Admin-only retention cycle.

    Until cleanup is explicitly enabled, only dry-run is allowed.
    Execute is capped to one small HTTP batch (separate from worker config).
    """
    if not _is_admin_user(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    from backend.services.hub_notifications_retention_service import (
        RetentionConfig,
        hub_notifications_retention_service,
    )

    body = payload if isinstance(payload, dict) else {}
    dry_run = body.get("dry_run", True) is not False
    cfg = RetentionConfig.from_env()
    if not dry_run:
        if not cfg.enabled:
            raise HTTPException(
                status_code=403,
                detail="Retention execute is disabled while HUB_NOTIFICATIONS_CLEANUP_ENABLED=false",
            )
        cfg.max_batches = 1
        cfg.batch_size = min(int(cfg.batch_size), int(cfg.http_max_batch_size))
        cfg.batch_pause_ms = 0

    started = time.perf_counter()
    result = await run_in_threadpool(
        hub_notifications_retention_service.run_once,
        config=cfg,
        dry_run=bool(dry_run),
        acquire_lock=True,
        force_enabled=False,
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000.0, 2)
    logging.getLogger("backend.hub.notifications.retention.http").info(
        "hub.notifications.retention.http user_id=%s dry_run=%s rows=%s batches=%s "
        "stop_reason=%s duration_ms=%.1f",
        int(current_user.id),
        bool(dry_run),
        result.get("rows_deleted") or result.get("eligible_rows_exact"),
        result.get("batches"),
        result.get("stop_reason"),
        elapsed_ms,
    )
    return result
