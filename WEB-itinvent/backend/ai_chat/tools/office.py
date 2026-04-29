from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    OFFICE_TOOL_ACTION_MAIL_REPLY_DRAFT,
    OFFICE_TOOL_ACTION_MAIL_SEND_DRAFT,
    OFFICE_TOOL_ACTION_TASK_COMMENT_DRAFT,
    OFFICE_TOOL_ACTION_TASK_CREATE_DRAFT,
    OFFICE_TOOL_ACTION_TASK_STATUS_DRAFT,
    OFFICE_TOOL_MAIL_CONTACTS_RESOLVE,
    OFFICE_TOOL_MAIL_GET_MESSAGE,
    OFFICE_TOOL_MAIL_SEARCH,
    OFFICE_TOOL_TASKS_GET,
    OFFICE_TOOL_TASKS_SEARCH,
    OFFICE_TOOL_WORKDAY_SUMMARY,
)
from backend.ai_chat.tools.registry import ai_tool_registry
from backend.services.authorization_service import (
    PERM_MAIL_ACCESS,
    PERM_TASKS_READ,
    PERM_TASKS_REVIEW,
    PERM_TASKS_WRITE,
    authorization_service,
)
from backend.services.hub_service import hub_service
from backend.services.mail_service import mail_service


DEFAULT_LIMIT = 20
MAX_LIMIT = 50


def _normalize_text(value: object, default: str = "") -> str:
    text = str(value if value is not None else "").strip()
    return text or default


def _to_int(value: object) -> int | None:
    if value in (None, "", "null"):
        return None
    try:
        return int(value)
    except Exception:
        return None


def _has_permission(context: AiToolExecutionContext, permission: str) -> bool:
    payload = context.user_payload if isinstance(context.user_payload, dict) else {}
    return authorization_service.has_permission(
        payload.get("role"),
        permission,
        use_custom_permissions=bool(payload.get("use_custom_permissions", False)),
        custom_permissions=payload.get("custom_permissions") or [],
    )


def _require_permission(context: AiToolExecutionContext, permission: str) -> None:
    if not _has_permission(context, permission):
        raise PermissionError(f"Permission required: {permission}")


def _is_admin(context: AiToolExecutionContext) -> bool:
    return _normalize_text((context.user_payload or {}).get("role")).lower() == "admin"


def _actor(context: AiToolExecutionContext) -> dict[str, Any]:
    payload = context.user_payload if isinstance(context.user_payload, dict) else {}
    return {
        "id": int(context.user_id or payload.get("id") or 0),
        "username": _normalize_text(payload.get("username")),
        "full_name": _normalize_text(payload.get("full_name")) or _normalize_text(payload.get("username")),
        "role": _normalize_text(payload.get("role"), "viewer"),
    }


def _cap_limit(value: int | None, *, default: int = DEFAULT_LIMIT, maximum: int = MAX_LIMIT) -> int:
    try:
        raw = int(value or default)
    except Exception:
        raw = default
    return max(1, min(maximum, raw))


def _mail_message_preview(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id"),
        "mailbox_id": item.get("mailbox_id"),
        "mailbox_label": item.get("mailbox_label"),
        "subject": item.get("subject"),
        "sender": item.get("sender"),
        "to": item.get("to"),
        "received_at": item.get("received_at") or item.get("sent_at"),
        "is_read": bool(item.get("is_read")),
        "has_attachments": bool(item.get("has_attachments")),
        "body_preview": item.get("body_preview"),
    }


def _task_preview(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id"),
        "title": item.get("title"),
        "status": item.get("status"),
        "priority": item.get("priority"),
        "assignee_user_id": item.get("assignee_user_id"),
        "assignee_full_name": item.get("assignee_full_name"),
        "controller_user_id": item.get("controller_user_id"),
        "controller_full_name": item.get("controller_full_name"),
        "due_at": item.get("due_at"),
        "is_overdue": bool(item.get("is_overdue")),
        "project_id": item.get("project_id"),
        "object_id": item.get("object_id"),
    }


def _resolve_single_user(*, query: str, candidates: list[dict[str, Any]], kind: str) -> dict[str, Any]:
    text = _normalize_text(query).lower()
    if not text:
        raise ValueError(f"{kind} is required")
    matches = []
    for row in candidates:
        haystack = " ".join(
            [
                _normalize_text(row.get("id")),
                _normalize_text(row.get("username")),
                _normalize_text(row.get("full_name")),
                _normalize_text(row.get("email")),
            ]
        ).lower()
        if text in haystack:
            matches.append(row)
    if len(matches) != 1:
        raise ValueError(f"{kind} is ambiguous or was not found")
    return matches[0]


def _resolve_single_project(query: str) -> dict[str, Any]:
    text = _normalize_text(query).lower()
    if not text:
        raise ValueError("project_id or project_query is required")
    matches = []
    for row in hub_service.list_task_projects(include_inactive=False):
        haystack = " ".join(
            [
                _normalize_text(row.get("id")),
                _normalize_text(row.get("name")),
                _normalize_text(row.get("code")),
            ]
        ).lower()
        if text in haystack:
            matches.append(row)
    if len(matches) != 1:
        raise ValueError("project is ambiguous or was not found")
    return matches[0]


class MailSearchArgs(BaseModel):
    q: str = Field(default="", max_length=500)
    mailbox_id: Optional[str] = Field(default=None, max_length=128)
    folder: str = Field(default="inbox", max_length=80)
    folder_scope: str = Field(default="current", max_length=40)
    unread_only: bool = False
    has_attachments: bool = False
    date_from: str = Field(default="", max_length=40)
    date_to: str = Field(default="", max_length=40)
    from_filter: str = Field(default="", max_length=255)
    to_filter: str = Field(default="", max_length=255)
    subject_filter: str = Field(default="", max_length=255)
    body_filter: str = Field(default="", max_length=255)
    limit: int = Field(default=20, ge=1, le=50)

    @field_validator("*", mode="before")
    @classmethod
    def _normalize_strings(cls, value):
        return _normalize_text(value) if isinstance(value, str) else value


class MailGetMessageArgs(BaseModel):
    message_id: str = Field(..., min_length=1, max_length=2048)
    mailbox_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("message_id", "mailbox_id", mode="before")
    @classmethod
    def _normalize_text_fields(cls, value):
        text = _normalize_text(value)
        return text or None


class ContactsResolveArgs(BaseModel):
    q: str = Field(..., min_length=2, max_length=255)
    mailbox_id: Optional[str] = Field(default=None, max_length=128)
    limit: int = Field(default=10, ge=1, le=25)

    @field_validator("q", "mailbox_id", mode="before")
    @classmethod
    def _normalize_text_fields(cls, value):
        text = _normalize_text(value)
        return text or None


class TasksSearchArgs(BaseModel):
    q: str = Field(default="", max_length=500)
    scope: Literal["my", "all"] = "my"
    role_scope: Literal["assignee", "creator", "controller", "both"] = "both"
    status: str = Field(default="", max_length=40)
    assignee_user_id: Optional[int] = None
    assignee_query: Optional[str] = Field(default=None, max_length=255)
    has_attachments: bool = False
    due_state: Literal["", "overdue", "today", "upcoming", "none"] = ""
    sort_by: Literal["status", "updated_at", "due_at"] = "status"
    sort_dir: Literal["asc", "desc"] = "asc"
    limit: int = Field(default=20, ge=1, le=50)

    @field_validator("q", "status", "assignee_query", mode="before")
    @classmethod
    def _normalize_text_fields(cls, value):
        text = _normalize_text(value)
        return text or None if value is None else text


class TasksGetArgs(BaseModel):
    task_id: str = Field(..., min_length=1, max_length=80)

    @field_validator("task_id", mode="before")
    @classmethod
    def _normalize_id(cls, value):
        return _normalize_text(value)


class WorkdaySummaryArgs(BaseModel):
    mail_limit: int = Field(default=10, ge=1, le=25)
    task_limit: int = Field(default=10, ge=1, le=25)


class MailDraftArgs(BaseModel):
    to: list[str] = Field(..., min_length=1, max_length=50)
    cc: list[str] = Field(default_factory=list, max_length=50)
    bcc: list[str] = Field(default_factory=list, max_length=50)
    subject: str = Field(..., min_length=1, max_length=500)
    body: str = Field(..., min_length=1, max_length=12000)
    mailbox_id: Optional[str] = Field(default=None, max_length=128)
    is_html: bool = True
    attachment_refs: list[dict[str, str]] = Field(default_factory=list, max_length=10)
    generated_file_specs: list[dict[str, Any]] = Field(default_factory=list, max_length=10)

    @field_validator("to", "cc", "bcc", mode="before")
    @classmethod
    def _normalize_recipients(cls, value):
        if isinstance(value, str):
            return [part.strip() for part in value.replace(";", ",").split(",") if part.strip()]
        return value

    @field_validator("subject", "body", "mailbox_id", mode="before")
    @classmethod
    def _normalize_text_fields(cls, value):
        text = _normalize_text(value)
        return text or None


class MailReplyDraftArgs(MailDraftArgs):
    reply_to_message_id: str = Field(..., min_length=1, max_length=2048)

    @field_validator("reply_to_message_id", mode="before")
    @classmethod
    def _normalize_reply_id(cls, value):
        return _normalize_text(value)


class TaskCreateDraftArgs(BaseModel):
    title: str = Field(..., min_length=3, max_length=300)
    description: str = Field(default="", max_length=12000)
    assignee_user_id: Optional[int] = None
    assignee_query: Optional[str] = Field(default=None, max_length=255)
    controller_user_id: Optional[int] = None
    controller_query: Optional[str] = Field(default=None, max_length=255)
    due_at: Optional[str] = Field(default=None, max_length=80)
    project_id: Optional[str] = Field(default=None, max_length=80)
    project_query: Optional[str] = Field(default=None, max_length=255)
    object_id: Optional[str] = Field(default=None, max_length=80)
    protocol_date: Optional[str] = Field(default=None, max_length=80)
    priority: Literal["low", "normal", "high", "urgent"] = "normal"

    @field_validator("title", "description", "assignee_query", "controller_query", "due_at", "project_id", "project_query", "object_id", "protocol_date", mode="before")
    @classmethod
    def _normalize_text_fields(cls, value):
        text = _normalize_text(value)
        return text or None if value is None else text


class TaskCommentDraftArgs(BaseModel):
    task_id: str = Field(..., min_length=1, max_length=80)
    body: str = Field(..., min_length=1, max_length=12000)

    @field_validator("task_id", "body", mode="before")
    @classmethod
    def _normalize_text_fields(cls, value):
        return _normalize_text(value)


class TaskStatusDraftArgs(BaseModel):
    task_id: str = Field(..., min_length=1, max_length=80)
    operation: Literal["start", "submit", "approve", "reject"]
    comment: str = Field(default="", max_length=12000)

    @field_validator("task_id", "comment", mode="before")
    @classmethod
    def _normalize_text_fields(cls, value):
        return _normalize_text(value)


class MailSearchTool(AiTool):
    tool_id = OFFICE_TOOL_MAIL_SEARCH
    description = "Search the current user's mailboxes. Use for finding messages by sender, recipient, subject, body, folder, unread state or attachments."
    input_model = MailSearchArgs
    stage = "checking_office"

    def execute(self, *, context: AiToolExecutionContext, args: MailSearchArgs) -> AiToolResult:
        _require_permission(context, PERM_MAIL_ACCESS)
        payload = mail_service.list_messages(
            user_id=int(context.user_id),
            mailbox_id=args.mailbox_id,
            folder=args.folder,
            folder_scope=args.folder_scope,
            limit=_cap_limit(args.limit),
            q=args.q,
            unread_only=bool(args.unread_only),
            has_attachments=bool(args.has_attachments),
            date_from=args.date_from,
            date_to=args.date_to,
            from_filter=args.from_filter,
            to_filter=args.to_filter,
            subject_filter=args.subject_filter,
            body_filter=args.body_filter,
        )
        items = [_mail_message_preview(item) for item in list(payload.get("items") or [])]
        total = int(payload.get("total") or len(items))
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=None,
            data={
                "items": items,
                "count": len(items),
                "returned_count": len(items),
                "total": total,
                "limit": int(payload.get("limit") or args.limit),
                "truncated": total > len(items),
                "filters": payload.get("filters") or {},
            },
        )


class MailGetMessageTool(AiTool):
    tool_id = OFFICE_TOOL_MAIL_GET_MESSAGE
    description = "Open one mail message for the current user. Use after office.mail.search when the user needs full message details."
    input_model = MailGetMessageArgs
    stage = "checking_office"

    def execute(self, *, context: AiToolExecutionContext, args: MailGetMessageArgs) -> AiToolResult:
        _require_permission(context, PERM_MAIL_ACCESS)
        message = mail_service.get_message(
            user_id=int(context.user_id),
            mailbox_id=args.mailbox_id,
            message_id=args.message_id,
        )
        return AiToolResult(tool_id=self.tool_id, ok=True, database_id=None, data=message)


class ContactsResolveTool(AiTool):
    tool_id = OFFICE_TOOL_MAIL_CONTACTS_RESOLVE
    description = "Resolve recipient names or email fragments in the current user's address book/GAL before drafting email."
    input_model = ContactsResolveArgs
    stage = "checking_office"

    def execute(self, *, context: AiToolExecutionContext, args: ContactsResolveArgs) -> AiToolResult:
        _require_permission(context, PERM_MAIL_ACCESS)
        rows = mail_service.search_contacts(int(context.user_id), args.q, mailbox_id=args.mailbox_id)
        rows = rows[: _cap_limit(args.limit, default=10, maximum=25)]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=None,
            data={"items": rows, "count": len(rows), "returned_count": len(rows), "limit": args.limit, "truncated": False},
        )


class TasksSearchTool(AiTool):
    tool_id = OFFICE_TOOL_TASKS_SEARCH
    description = "Search Hub tasks visible to the current user by text, status, role, assignee and due state."
    input_model = TasksSearchArgs
    stage = "checking_office"

    def execute(self, *, context: AiToolExecutionContext, args: TasksSearchArgs) -> AiToolResult:
        _require_permission(context, PERM_TASKS_READ)
        assignee_user_id = args.assignee_user_id
        if assignee_user_id is None and args.assignee_query:
            assignee = _resolve_single_user(query=args.assignee_query, candidates=hub_service.list_assignees(), kind="assignee")
            assignee_user_id = _to_int(assignee.get("id"))
        allow_all = bool(_has_permission(context, PERM_TASKS_REVIEW) or _is_admin(context))
        payload = hub_service.list_tasks(
            user_id=int(context.user_id),
            scope=args.scope,
            role_scope=args.role_scope,
            status_filter=args.status,
            q=args.q,
            assignee_user_id=assignee_user_id,
            has_attachments=bool(args.has_attachments),
            due_state=args.due_state,
            sort_by=args.sort_by,
            sort_dir=args.sort_dir,
            limit=_cap_limit(args.limit),
            offset=0,
            allow_all_scope=allow_all,
        )
        items = [_task_preview(item) for item in list(payload.get("items") or [])]
        total = int(payload.get("total") or len(items))
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=None,
            data={
                "items": items,
                "count": len(items),
                "returned_count": len(items),
                "total": total,
                "limit": int(payload.get("limit") or args.limit),
                "truncated": total > len(items),
                "filters": payload.get("filters") or {},
            },
        )


class TasksGetTool(AiTool):
    tool_id = OFFICE_TOOL_TASKS_GET
    description = "Open one Hub task visible to the current user, including comments and status log."
    input_model = TasksGetArgs
    stage = "checking_office"

    def execute(self, *, context: AiToolExecutionContext, args: TasksGetArgs) -> AiToolResult:
        _require_permission(context, PERM_TASKS_READ)
        is_admin = _is_admin(context)
        task = hub_service.get_task(args.task_id, user_id=int(context.user_id), is_admin=is_admin)
        if not task:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Task not found")
        comments = hub_service.list_task_comments(args.task_id, user_id=int(context.user_id), is_admin=is_admin)
        status_log = hub_service.list_task_status_log(args.task_id, user_id=int(context.user_id), is_admin=is_admin)
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=None,
            data={"task": task, "comments": comments, "status_log": status_log},
        )


class WorkdaySummaryTool(AiTool):
    tool_id = OFFICE_TOOL_WORKDAY_SUMMARY
    description = "Build a short workday summary from unread mail, urgent/overdue tasks and recent office notifications."
    input_model = WorkdaySummaryArgs
    stage = "checking_office"

    def execute(self, *, context: AiToolExecutionContext, args: WorkdaySummaryArgs) -> AiToolResult:
        mail_summary: dict[str, Any] = {"enabled": _has_permission(context, PERM_MAIL_ACCESS)}
        if mail_summary["enabled"]:
            try:
                feed = mail_service.list_notification_feed(user_id=int(context.user_id), limit=_cap_limit(args.mail_limit, default=10, maximum=25))
                mail_summary.update(feed)
            except Exception as exc:
                mail_summary.update({"error": _normalize_text(exc), "items": [], "total_unread": 0})
        task_summary: dict[str, Any] = {"enabled": _has_permission(context, PERM_TASKS_READ)}
        if task_summary["enabled"]:
            task_limit = _cap_limit(args.task_limit, default=10, maximum=25)
            overdue = hub_service.list_tasks(user_id=int(context.user_id), due_state="overdue", limit=task_limit, allow_all_scope=False)
            today = hub_service.list_tasks(user_id=int(context.user_id), due_state="today", limit=task_limit, allow_all_scope=False)
            upcoming = hub_service.list_tasks(user_id=int(context.user_id), due_state="upcoming", limit=task_limit, allow_all_scope=False)
            task_summary.update(
                {
                    "overdue": [_task_preview(item) for item in list(overdue.get("items") or [])],
                    "today": [_task_preview(item) for item in list(today.get("items") or [])],
                    "upcoming": [_task_preview(item) for item in list(upcoming.get("items") or [])],
                    "overdue_total": int(overdue.get("total") or 0),
                    "today_total": int(today.get("total") or 0),
                    "upcoming_total": int(upcoming.get("total") or 0),
                }
            )
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=None,
            data={
                "mail": mail_summary,
                "tasks": task_summary,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            },
        )


class MailSendDraftTool(AiTool):
    tool_id = OFFICE_TOOL_ACTION_MAIL_SEND_DRAFT
    description = "Create a confirmation-card draft for sending a new email. Does not send mail before user confirmation."
    input_model = MailDraftArgs
    stage = "checking_office"

    def execute(self, *, context: AiToolExecutionContext, args: MailDraftArgs) -> AiToolResult:
        _require_permission(context, PERM_MAIL_ACCESS)
        from backend.ai_chat.action_cards import build_office_mail_draft

        card = build_office_mail_draft(
            action_type="office.mail.send",
            conversation_id=context.conversation_id,
            run_id=context.run_id,
            requester_user_id=int(context.user_id),
            payload=args.model_dump(mode="json"),
        )
        return AiToolResult(tool_id=self.tool_id, ok=True, database_id=None, data={"action_card": card})


class MailReplyDraftTool(AiTool):
    tool_id = OFFICE_TOOL_ACTION_MAIL_REPLY_DRAFT
    description = "Create a confirmation-card draft for replying to an email. Does not send mail before user confirmation."
    input_model = MailReplyDraftArgs
    stage = "checking_office"

    def execute(self, *, context: AiToolExecutionContext, args: MailReplyDraftArgs) -> AiToolResult:
        _require_permission(context, PERM_MAIL_ACCESS)
        mail_service.get_message(user_id=int(context.user_id), mailbox_id=args.mailbox_id, message_id=args.reply_to_message_id)
        from backend.ai_chat.action_cards import build_office_mail_draft

        card = build_office_mail_draft(
            action_type="office.mail.reply",
            conversation_id=context.conversation_id,
            run_id=context.run_id,
            requester_user_id=int(context.user_id),
            payload=args.model_dump(mode="json"),
        )
        return AiToolResult(tool_id=self.tool_id, ok=True, database_id=None, data={"action_card": card})


class TaskCreateDraftTool(AiTool):
    tool_id = OFFICE_TOOL_ACTION_TASK_CREATE_DRAFT
    description = "Create a confirmation-card draft for a Hub task. Does not create the task before user confirmation."
    input_model = TaskCreateDraftArgs
    stage = "checking_office"

    def execute(self, *, context: AiToolExecutionContext, args: TaskCreateDraftArgs) -> AiToolResult:
        _require_permission(context, PERM_TASKS_WRITE)
        payload = args.model_dump(mode="json")
        if not payload.get("assignee_user_id") and args.assignee_query:
            assignee = _resolve_single_user(query=args.assignee_query, candidates=hub_service.list_assignees(), kind="assignee")
            payload["assignee_user_id"] = _to_int(assignee.get("id"))
            payload["assignee_name"] = _normalize_text(assignee.get("full_name")) or _normalize_text(assignee.get("username"))
        if not payload.get("controller_user_id") and args.controller_query:
            controller = _resolve_single_user(query=args.controller_query, candidates=hub_service.list_controllers(), kind="controller")
            payload["controller_user_id"] = _to_int(controller.get("id"))
            payload["controller_name"] = _normalize_text(controller.get("full_name")) or _normalize_text(controller.get("username"))
        if not payload.get("controller_user_id") and _has_permission(context, PERM_TASKS_REVIEW):
            payload["controller_user_id"] = int(context.user_id)
            payload["controller_name"] = _actor(context).get("full_name")
        if not payload.get("project_id") and args.project_query:
            project = _resolve_single_project(args.project_query)
            payload["project_id"] = _normalize_text(project.get("id"))
            payload["project_name"] = _normalize_text(project.get("name"))
        if not payload.get("assignee_user_id"):
            raise ValueError("assignee_user_id or exact assignee_query is required")
        if not payload.get("controller_user_id"):
            raise ValueError("controller_user_id, exact controller_query or current user with tasks.review is required")
        if not payload.get("project_id"):
            raise ValueError("project_id or exact project_query is required")
        from backend.ai_chat.action_cards import build_office_task_draft

        card = build_office_task_draft(
            action_type="office.task.create",
            conversation_id=context.conversation_id,
            run_id=context.run_id,
            requester_user_id=int(context.user_id),
            payload=payload,
        )
        return AiToolResult(tool_id=self.tool_id, ok=True, database_id=None, data={"action_card": card})


class TaskCommentDraftTool(AiTool):
    tool_id = OFFICE_TOOL_ACTION_TASK_COMMENT_DRAFT
    description = "Create a confirmation-card draft for adding a comment to a Hub task."
    input_model = TaskCommentDraftArgs
    stage = "checking_office"

    def execute(self, *, context: AiToolExecutionContext, args: TaskCommentDraftArgs) -> AiToolResult:
        _require_permission(context, PERM_TASKS_READ)
        task = hub_service.get_task(args.task_id, user_id=int(context.user_id), is_admin=_is_admin(context))
        if not task:
            raise ValueError("Task not found")
        from backend.ai_chat.action_cards import build_office_task_draft

        card = build_office_task_draft(
            action_type="office.task.comment",
            conversation_id=context.conversation_id,
            run_id=context.run_id,
            requester_user_id=int(context.user_id),
            payload={"task_id": args.task_id, "body": args.body, "task_title": _normalize_text(task.get("title"))},
        )
        return AiToolResult(tool_id=self.tool_id, ok=True, database_id=None, data={"action_card": card})


class TaskStatusDraftTool(AiTool):
    tool_id = OFFICE_TOOL_ACTION_TASK_STATUS_DRAFT
    description = "Create a confirmation-card draft for changing a Hub task status using existing Hub workflow rules."
    input_model = TaskStatusDraftArgs
    stage = "checking_office"

    def execute(self, *, context: AiToolExecutionContext, args: TaskStatusDraftArgs) -> AiToolResult:
        _require_permission(context, PERM_TASKS_READ)
        task = hub_service.get_task(args.task_id, user_id=int(context.user_id), is_admin=_is_admin(context))
        if not task:
            raise ValueError("Task not found")
        from backend.ai_chat.action_cards import build_office_task_draft

        card = build_office_task_draft(
            action_type="office.task.status",
            conversation_id=context.conversation_id,
            run_id=context.run_id,
            requester_user_id=int(context.user_id),
            payload={
                "task_id": args.task_id,
                "operation": args.operation,
                "comment": args.comment,
                "task_title": _normalize_text(task.get("title")),
                "current_status": _normalize_text(task.get("status")),
            },
        )
        return AiToolResult(tool_id=self.tool_id, ok=True, database_id=None, data={"action_card": card})


for tool in [
    MailSearchTool(),
    MailGetMessageTool(),
    ContactsResolveTool(),
    TasksSearchTool(),
    TasksGetTool(),
    WorkdaySummaryTool(),
    MailSendDraftTool(),
    MailReplyDraftTool(),
    TaskCreateDraftTool(),
    TaskCommentDraftTool(),
    TaskStatusDraftTool(),
]:
    ai_tool_registry.register(tool)
