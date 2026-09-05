"""
Hub service for dashboard announcements, tasks, and notifications.
"""
from __future__ import annotations

import copy
import json
import logging
import os
import re
import shutil
import sqlite3
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import time
from urllib.parse import quote

from threading import Lock, RLock
from typing import Any, Callable, Optional

from sqlalchemy import inspect

from backend.appdb.db import get_app_database_url, get_app_engine, initialize_app_schema, is_app_database_configured
from backend.appdb.sql_compat import SqlAlchemyCompatConnection
from backend.config import config
from backend.db_schema import schema_name
from local_store import get_local_store
from backend.services.app_push_service import app_push_service
from backend.services.access_policy_service import (
    VISIBILITY_PRIVATE,
    _assignee_cannot_review_as_non_creator,
    can_create_task_for_department,
    can_edit_task_canvas,
    can_review_task,
    can_view_task,
    user_can_close_task,
    normalize_visibility_scope,
    user_can_manage_tasks_all,
    user_is_department_manager,
    user_is_department_member,
)
from backend.services.authorization_service import (
    PERM_ANNOUNCEMENTS_MODERATE,
    PERM_TASKS_READ,
    PERM_TASKS_REVIEW,
    authorization_service,
)
from backend.services.department_service import (
    DEPARTMENT_MANAGER_ROLE,
    DEPARTMENT_MEMBER_ROLE,
    department_id_from_name,
    department_service,
)
from backend.services.notification_preferences_service import notification_preferences_service
from backend.services.task_email_outbox_service import (
    TaskEmailOutboxMixin,
    _normalize_email_deadline_remind_hours,
    _resolve_email_deadline_remind_hours,
)
from backend.services.task_email_service import task_email_service
from backend.services.task_email_templates import build_overdue_digest_email, build_task_email_content
from backend.services.task_participant_service import TaskParticipantMixin
from backend.services.user_service import user_service

logger = logging.getLogger(__name__)

_HUB_PUSH_EXECUTOR = ThreadPoolExecutor(max_workers=8, thread_name_prefix="hub-push")


class _CountingSqliteConnection:
    """Thin sqlite3 proxy that records executes into request-scoped sql_query_counter."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def execute(self, sql: str, params: Any = ()) -> Any:
        try:
            from backend.services.sql_query_counter import note_sql_execute

            note_sql_execute(str(sql or ""))
        except Exception:
            pass
        if params == () or params is None:
            return self._conn.execute(sql)
        return self._conn.execute(sql, params)

    def executemany(self, sql: str, seq_of_params: Any) -> Any:
        try:
            from backend.services.sql_query_counter import note_sql_execute

            note_sql_execute(str(sql or ""))
        except Exception:
            pass
        return self._conn.executemany(sql, seq_of_params)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._conn, name)

    def __enter__(self):
        self._conn.__enter__()
        return self

    def __exit__(self, exc_type, exc, tb) -> Any:
        return self._conn.__exit__(exc_type, exc, tb)


class _AfterCommitConnection:
    """Connection proxy that runs best-effort side effects only after commit."""

    def __init__(self, conn: Any) -> None:
        self._conn = conn
        self._after_commit: list[Callable[[], None]] = []

    def add_after_commit(self, callback: Callable[[], None]) -> None:
        if callable(callback):
            self._after_commit.append(callback)

    def commit(self) -> None:
        self._conn.commit()
        callbacks = self._after_commit
        self._after_commit = []
        for callback in callbacks:
            try:
                callback()
            except Exception:
                logger.warning("HUB after-commit callback failed", exc_info=True)

    def rollback(self) -> None:
        self._after_commit = []
        self._conn.rollback()

    def close(self) -> None:
        self._after_commit = []
        self._conn.close()

    def __getattr__(self, name: str) -> Any:
        return getattr(self._conn, name)

    def __enter__(self):
        self._conn.__enter__()
        return self

    def __exit__(self, exc_type, exc, tb) -> Any:
        try:
            result = self._conn.__exit__(exc_type, exc, tb)
        except BaseException:
            self._after_commit = []
            raise
        if exc_type is None:
            callbacks = self._after_commit
            self._after_commit = []
            for callback in callbacks:
                try:
                    callback()
                except Exception:
                    logger.warning("HUB after-commit callback failed", exc_info=True)
        else:
            self._after_commit = []
        return result


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _safe_file_name(value: str) -> str:
    base = Path(str(value or "").strip()).name
    base = re.sub(r"[^A-Za-z0-9._\-\u0400-\u04FF ]+", "_", base)
    return base.strip() or "file.bin"


_HUB_REQUIRED_COLUMNS = {
    "hub_announcements": {
        "id",
        "title",
        "preview",
        "body",
        "priority",
        "is_active",
        "author_user_id",
        "author_username",
        "author_full_name",
        "published_at",
        "updated_at",
        "version",
        "audience_scope",
        "audience_roles",
        "audience_user_ids",
        "requires_ack",
        "is_pinned",
        "pinned_until",
        "published_from",
        "expires_at",
        "status",
        "comments_enabled",
        "reactions_enabled",
        "publication_notified_at",
        "category_id",
    },
    "hub_announcement_reads": {
        "announcement_id",
        "user_id",
        "username",
        "full_name",
        "read_at",
        "seen_version",
        "acknowledged_version",
        "acknowledged_at",
    },
    "hub_announcement_attachments": {
        "id",
        "announcement_id",
        "file_name",
        "file_path",
        "file_mime",
        "file_size",
        "uploaded_by_user_id",
        "uploaded_by_username",
        "uploaded_at",
        "sort_order",
        "is_cover",
    },
    "hub_tasks": {
        "id",
        "title",
        "description",
        "status",
        "due_at",
        "email_deadline_remind_hours",
        "assignee_user_id",
        "assignee_user_ids",
        "assignee_username",
        "assignee_full_name",
        "controller_user_id",
        "controller_username",
        "controller_full_name",
        "created_by_user_id",
        "created_by_username",
        "created_by_full_name",
        "created_at",
        "updated_at",
        "submitted_at",
        "reviewed_at",
        "reviewer_user_id",
        "reviewer_username",
        "reviewer_full_name",
        "review_comment",
        "priority",
        "checklist_items",
        "project_id",
        "object_id",
        "protocol_date",
        "completed_at",
        "completed_at_source",
        "department_id",
        "visibility_scope",
        "observer_user_ids",
    },
    "hub_task_projects": {"id", "name", "code", "description", "is_active", "created_at", "updated_at"},
    "hub_task_objects": {"id", "project_id", "name", "code", "description", "is_active", "created_at", "updated_at"},
    "hub_task_reports": {
        "id",
        "task_id",
        "comment",
        "file_name",
        "file_path",
        "file_mime",
        "file_size",
        "uploaded_by_user_id",
        "uploaded_by_username",
        "uploaded_at",
    },
    "hub_task_attachments": {
        "id",
        "task_id",
        "scope",
        "file_name",
        "file_path",
        "file_mime",
        "file_size",
        "uploaded_by_user_id",
        "uploaded_by_username",
        "uploaded_at",
    },
    "hub_task_canvases": {
        "task_id",
        "scene_json",
        "revision",
        "updated_by_user_id",
        "updated_by_username",
        "created_at",
        "updated_at",
    },
    "hub_announcement_likes": {
        "announcement_id",
        "user_id",
        "username",
        "full_name",
        "created_at",
    },
    "hub_announcement_comments": {
        "id",
        "announcement_id",
        "user_id",
        "username",
        "full_name",
        "body",
        "created_at",
        "updated_at",
        "parent_comment_id",
        "root_comment_id",
        "reply_to_user_id",
        "reply_to_username",
        "deleted_at",
        "deleted_by_user_id",
        "change_version",
    },
    "hub_announcement_reactions": {"announcement_id", "user_id", "reaction_type", "username", "full_name", "created_at", "updated_at"},
    "hub_announcement_comment_reactions": {"comment_id", "user_id", "reaction_type", "username", "full_name", "created_at", "updated_at"},
    "hub_announcement_comment_attachments": {"id", "comment_id", "announcement_id", "file_name", "file_path", "file_mime", "file_size", "uploaded_by_user_id", "uploaded_at"},
    "hub_announcement_comment_mentions": {"comment_id", "user_id", "username", "full_name"},
    "hub_announcement_categories": {"id", "name", "slug", "is_active", "created_by_user_id", "created_at", "updated_at"},
    "hub_announcement_tags": {"id", "name", "slug", "created_at"},
    "hub_announcement_tag_links": {"announcement_id", "tag_id"},
    "hub_announcement_bookmarks": {"announcement_id", "user_id", "created_at"},
    "hub_announcement_polls": {"id", "announcement_id", "question", "allows_multiple", "is_anonymous", "closes_at", "created_at", "updated_at"},
    "hub_announcement_poll_options": {"id", "poll_id", "text", "sort_order"},
    "hub_announcement_poll_votes": {"poll_id", "option_id", "user_id", "created_at"},
    "hub_task_attachment_previews": {
        "attachment_id",
        "task_id",
        "status",
        "attempt_count",
        "next_attempt_at",
        "lease_owner",
        "lease_expires_at",
        "artifact_rel_path",
        "pdf_filename",
        "source_kind",
        "page_count",
        "sheets_json",
        "last_error",
        "created_at",
        "updated_at",
        "ready_at",
    },
    "hub_task_comment_reads": {"task_id", "user_id", "last_seen_comment_id", "last_seen_at"},
    "hub_task_comments": {"id", "task_id", "user_id", "username", "full_name", "body", "created_at"},
    "hub_task_status_log": {
        "id",
        "task_id",
        "old_status",
        "new_status",
        "changed_by_user_id",
        "changed_by_username",
        "changed_at",
    },
    "hub_notifications": {
        "id",
        "recipient_user_id",
        "event_type",
        "title",
        "body",
        "entity_type",
        "entity_id",
        "created_at",
    },
    "hub_notification_reads": {"notification_id", "user_id", "read_at"},
    "hub_task_email_outbox": {
        "id",
        "dedupe_key",
        "task_id",
        "recipient_user_id",
        "recipient_email",
        "event_type",
        "subject",
        "body_text",
        "body_html",
        "status",
        "attempt_count",
        "available_at",
        "created_at",
        "updated_at",
        "sent_at",
        "last_error",
    },
}
# Columns fetched for list assembly. Thick columns used only to derive counts
# (e.g. checklist_items) are stripped from the public list DTO.
_TASK_LIST_SELECT_COLUMNS = (
    "id",
    "title",
    "SUBSTR(description, 1, 500) AS description_preview",
    "status",
    "due_at",
    "email_deadline_remind_hours",
    "priority",
    "checklist_items",
    "assignee_user_id",
    "assignee_user_ids",
    "assignee_username",
    "assignee_full_name",
    "controller_user_id",
    "controller_username",
    "controller_full_name",
    "created_by_user_id",
    "created_by_username",
    "created_by_full_name",
    "created_at",
    "updated_at",
    "submitted_at",
    "reviewed_at",
    "project_id",
    "object_id",
    "protocol_date",
    "completed_at",
    "completed_at_source",
    "department_id",
    "visibility_scope",
    "observer_user_ids",
)
# Stable public list contract — every item always has exactly these keys
# (plus optional integration_* from API enrich). No conditional key omission.
_TASK_LIST_PUBLIC_KEYS = frozenset({
    "id",
    "title",
    "description_preview",
    "status",
    "priority",
    "due_at",
    "email_deadline_remind_hours",
    "assignee_user_id",
    "assignee_user_ids",
    "assignees",
    "assignee_username",
    "assignee_full_name",
    "controller_user_id",
    "controller_username",
    "controller_full_name",
    "created_by_user_id",
    "created_by_username",
    "created_by_full_name",
    "created_at",
    "updated_at",
    "submitted_at",
    "reviewed_at",
    "project_id",
    "project_name",
    "object_id",
    "object_name",
    "protocol_date",
    "completed_at",
    "completed_at_source",
    "completed_on_time",
    "done_without_due",
    "department_id",
    "department_name",
    "visibility_scope",
    "observer_user_ids",
    "is_overdue",
    "attachments_count",
    "reports_count",
    "comments_count",
    "checklist_total",
    "checklist_done",
    "latest_comment_preview",
    "latest_comment_at",
    "latest_comment_user_id",
    "latest_comment_username",
    "latest_comment_full_name",
    "has_unread_comments",
})
_TASK_LIST_FORBIDDEN_KEYS = frozenset({
    "description",
    "checklist_items",
    "attachments",
    "latest_report",
    "review_comment",
    "reviewer_user_id",
    "reviewer_username",
    "reviewer_full_name",
    "observers",
    "status_history",
})
_TASK_VISIBILITY_SELECT_COLUMNS = (
    "id",
    "assignee_user_id",
    "assignee_user_ids",
    "created_by_user_id",
    "controller_user_id",
    "observer_user_ids",
    "department_id",
    "visibility_scope",
)
_TASK_ANALYTICS_SELECT_COLUMNS = (
    "id",
    "status",
    "assignee_user_id",
    "assignee_user_ids",
    "assignee_username",
    "assignee_full_name",
    "project_id",
    "object_id",
    "protocol_date",
    "created_at",
    "completed_at",
    "completed_at_source",
    "due_at",
    "updated_at",
    "submitted_at",
    "reviewed_at",
    "department_id",
    "visibility_scope",
    "created_by_user_id",
    "controller_user_id",
    "observer_user_ids",
)
_DEPARTMENT_SCOPE_SQL_SCAN_CAP = 2000
_DEPARTMENT_SCOPE_FETCH_BATCH = 100
_HUB_REQUIRED_INDEXES = {
    "hub_announcements": {"idx_hub_announcements_published", "idx_hub_announcements_status_due"},
    "hub_announcement_attachments": {"idx_hub_announcement_attachments_announcement"},
    "hub_announcement_likes": {"idx_hub_announcement_likes_announcement"},
    "hub_announcement_comments": {"idx_hub_announcement_comments_announcement"},
    "hub_announcement_reactions": {"idx_hub_announcement_reactions_announcement"},
    "hub_announcement_comment_reactions": {"idx_hub_comment_reactions_comment"},
    "hub_announcement_comment_attachments": {"idx_hub_comment_attachments_comment"},
    "hub_announcement_bookmarks": {"idx_hub_bookmarks_user"},
    "hub_announcement_tag_links": {"idx_hub_tag_links_tag"},
    "hub_tasks": {
        "idx_hub_tasks_assignee",
        "idx_hub_tasks_controller",
        "idx_hub_tasks_created_by",
        "idx_hub_tasks_due_at",
        "idx_hub_tasks_project",
        "idx_hub_tasks_object",
        "idx_hub_tasks_protocol_date",
        "idx_hub_tasks_completed_at",
        "idx_hub_tasks_department",
    },
    "hub_task_projects": {"idx_hub_task_projects_active"},
    "hub_task_objects": {"idx_hub_task_objects_project"},
    "hub_task_attachments": {"idx_hub_task_attachments_task"},
    "hub_task_attachment_previews": {
        "idx_hub_task_attachment_previews_status_next_attempt",
        "idx_hub_task_attachment_previews_lease_expires",
        "idx_hub_task_attachment_previews_task",
    },
    "hub_task_comment_reads": {"idx_hub_task_comment_reads_task"},
    "hub_task_comments": {"idx_hub_task_comments_task"},
    "hub_task_status_log": {"idx_hub_task_status_log_task"},
    "hub_notifications": {
        "idx_hub_notifications_recipient",
        "idx_hub_notifications_entity",
        "idx_hub_notifications_retention",
    },
    "hub_task_email_outbox": {"idx_hub_task_email_outbox_status", "uq_hub_task_email_outbox_dedupe"},
}


class HubSchemaConfigurationError(RuntimeError):
    """Raised when production hub schema is not migration-ready."""


class TaskCanvasRevisionConflict(RuntimeError):
    """Raised when a task canvas was changed after the client loaded it."""

    def __init__(self, current_revision: int) -> None:
        self.current_revision = max(0, int(current_revision))
        super().__init__("Task canvas revision conflict")


class TaskCanvasTooLarge(ValueError):
    """Raised when the serialized task canvas exceeds its storage limit."""


class HubService(TaskEmailOutboxMixin, TaskParticipantMixin):
    _DEFAULT_TASK_PROJECT_ID = "general-tasks"
    _DEFAULT_TASK_PROJECT_NAME = "Общие задачи"
    _DEFAULT_TASK_PROJECT_CODE = "GENERAL"
    _DEFAULT_TASK_PROJECT_DESCRIPTION = "Базовый проект для задач, созданных до введения проектного учёта."
    _TRANSFER_ACT_REMINDER_PROJECT_ID = "transfer-act-reminders"
    _TRANSFER_ACT_REMINDER_PROJECT_NAME = "Перемещение техники"
    _TRANSFER_ACT_REMINDER_PROJECT_CODE = "TRANSFER_ACTS"
    _TRANSFER_ACT_REMINDER_PROJECT_DESCRIPTION = "Системный проект для reminder-задач о загрузке подписанных актов перемещения техники."
    _ANN_TABLE = "hub_announcements"
    # Keep the result shape stable across online schema migrations. Psycopg may
    # cache prepared statements, and SELECT * breaks those plans after ALTER TABLE.
    _ANN_SELECT_COLUMNS = ", ".join(sorted(_HUB_REQUIRED_COLUMNS["hub_announcements"]))
    _ANN_READS_TABLE = "hub_announcement_reads"
    _ANN_ATTACH_TABLE = "hub_announcement_attachments"
    _ANN_LIKES_TABLE = "hub_announcement_likes"
    _ANN_COMMENTS_TABLE = "hub_announcement_comments"
    _ANN_REACTIONS_TABLE = "hub_announcement_reactions"
    _ANN_COMMENT_REACTIONS_TABLE = "hub_announcement_comment_reactions"
    _ANN_COMMENT_ATTACH_TABLE = "hub_announcement_comment_attachments"
    _ANN_COMMENT_MENTIONS_TABLE = "hub_announcement_comment_mentions"
    _ANN_CATEGORIES_TABLE = "hub_announcement_categories"
    _ANN_TAGS_TABLE = "hub_announcement_tags"
    _ANN_TAG_LINKS_TABLE = "hub_announcement_tag_links"
    _ANN_BOOKMARKS_TABLE = "hub_announcement_bookmarks"
    _ANN_POLLS_TABLE = "hub_announcement_polls"
    _ANN_POLL_OPTIONS_TABLE = "hub_announcement_poll_options"
    _ANN_POLL_VOTES_TABLE = "hub_announcement_poll_votes"
    _REACTION_TYPES = {"like", "love", "laugh", "wow", "sad", "angry"}
    _ANNOUNCEMENT_STATUSES = {"draft", "scheduled", "published", "archived"}
    _TASKS_TABLE = "hub_tasks"
    _TASK_PROJECTS_TABLE = "hub_task_projects"
    _TASK_OBJECTS_TABLE = "hub_task_objects"
    _TASK_REPORTS_TABLE = "hub_task_reports"
    _TASK_ATTACH_TABLE = "hub_task_attachments"
    _TASK_CANVAS_TABLE = "hub_task_canvases"
    _TASK_ATTACHMENT_PREVIEWS_TABLE = "hub_task_attachment_previews"
    _TASK_COMMENT_READS_TABLE = "hub_task_comment_reads"
    _TASK_COMMENTS_TABLE = "hub_task_comments"
    _TASK_STATUS_LOG_TABLE = "hub_task_status_log"
    _NOTIF_TABLE = "hub_notifications"
    _NOTIF_READS_TABLE = "hub_notification_reads"
    _TASK_EMAIL_OUTBOX_TABLE = "hub_task_email_outbox"
    _TASK_STATUSES = {"new", "in_progress", "review", "done"}
    _TASK_CANVAS_MAX_BYTES = 2 * 1024 * 1024
    _TASK_CANVAS_MAX_ELEMENTS = 2000
    _COMPLETED_AT_SOURCE_VALUES = {"explicit", "reviewed_at", "submitted_at", "updated_at", "backfill"}
    _TASK_EMAIL_EVENT_TYPES = {
        "task.assigned",
        "task.controller_assigned",
        "task.deadline_changed",
        "task.submitted",
        "task.review_required",
        "task.reviewed",
        "task.reopened",
        "task.deadline_soon",
        "task.observer_added",
    }

    def __init__(self, *, database_url: str | None = None) -> None:
        explicit_database_url = str(database_url or "").strip() or None
        self._database_url = get_app_database_url(explicit_database_url) if (explicit_database_url or is_app_database_configured()) else None
        self._use_app_db = bool(self._database_url)
        self.store = None if self._use_app_db else get_local_store()
        self.db_path = None if self.store is None else Path(self.store.db_path)
        self.data_dir = (
            (Path(__file__).resolve().parents[3] / "data")
            if self.store is None
            else Path(self.store.data_dir)
        )
        self._app_schema = schema_name("app", self._database_url)
        self.announcement_attachments_root = self.data_dir / "hub_announcement_attachments"
        self.announcement_comment_attachments_root = self.data_dir / "hub_announcement_comment_attachments"
        self.task_attachments_root = self.data_dir / "hub_task_attachments"
        self.task_attachment_previews_root = self.data_dir / "hub_task_attachment_previews"
        self.announcement_attachments_root.mkdir(parents=True, exist_ok=True)
        self.announcement_comment_attachments_root.mkdir(parents=True, exist_ok=True)
        self.task_attachments_root.mkdir(parents=True, exist_ok=True)
        self.task_attachment_previews_root.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        self._unread_counts_cache: dict[int, tuple[float, dict[str, int]]] = {}
        self._unread_counts_cache_lock = Lock()
        # Soft-cache with invalidation on writes; shorter TTL keeps badges fresher under load.
        self._unread_counts_cache_ttl_sec = 15.0
        # Short soft-cache for poll-heavy dashboard; invalidated with unread counts.
        self._dashboard_cache: dict[tuple[int, int, int], tuple[float, dict[str, Any]]] = {}
        self._dashboard_cache_lock = Lock()
        self._dashboard_cache_ttl_sec = 8.0
        # The absence widget has one shared 30-second cache key. Serialize its
        # cold refresh so a dashboard burst does not repeat the same APP DB +
        # address-book load in every request.
        self._dashboard_absences_refresh_lock = Lock()
        # Short soft-cache for default /hub/tasks polls (protects APP DB pool under many VU).
        self._tasks_list_cache: dict[tuple[Any, ...], tuple[float, dict[str, Any]]] = {}
        self._tasks_list_cache_lock = Lock()
        self._tasks_list_cache_ttl_sec = 3.0
        # Short soft-cache for notifications/poll (items + unread_counts); invalidated with unread.
        self._notifications_poll_cache: dict[tuple[Any, ...], tuple[float, dict[str, Any]]] = {}
        self._notifications_poll_cache_lock = Lock()
        self._notifications_poll_cache_ttl_sec = 2.5
        self._task_due_ensure_last: dict[int, float] = {}
        self._task_due_ensure_lock = Lock()
        self._task_due_ensure_ttl_sec = 600.0
        self._user_directory_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
        self._user_directory_cache_lock = Lock()
        self._user_directory_cache_ttl_sec = 300.0
        # Hub write-path can defer web-push until after DB commit.
        self._defer_hub_push = False
        self._pending_hub_push_jobs: list[dict[str, Any]] = []
        # SQLite/dev: status-log DDL once per process; PostgreSQL never DDLs here.
        self._task_status_log_ready = False
        self._task_status_log_ready_lock = Lock()
        # TEST/DIAGNOSTIC ONLY (PR1b A/B). Never expose via HTTP/API/env user input.
        # Forced hot-path DDL is refused when config.app.is_production.
        self._status_log_force_ddl_every_call = False
        if self._use_app_db and self._database_url:
            initialize_app_schema(self._database_url)
        self._ensure_schema()

    def _flush_pending_hub_push(self) -> int:
        jobs = list(self._pending_hub_push_jobs)
        self._pending_hub_push_jobs = []
        return self._schedule_hub_push_jobs(jobs)

    @staticmethod
    def _deliver_hub_push_job(job: dict[str, Any]) -> None:
        try:
            app_push_service.enqueue_notification(**job)
        except Exception:
            logger.warning(
                "Failed to send deferred hub push recipient_user_id=%s channel=%s tag=%s",
                job.get("recipient_user_id"),
                job.get("channel"),
                job.get("tag"),
                exc_info=True,
            )

    def _schedule_hub_push_jobs(self, jobs: list[dict[str, Any]]) -> int:
        scheduled = 0
        for job in jobs:
            try:
                _HUB_PUSH_EXECUTOR.submit(self._deliver_hub_push_job, dict(job))
                scheduled += 1
            except RuntimeError:
                logger.warning(
                    "Failed to schedule hub push recipient_user_id=%s channel=%s tag=%s",
                    job.get("recipient_user_id"),
                    job.get("channel"),
                    job.get("tag"),
                    exc_info=True,
                )
        return scheduled

    @contextmanager
    def _hub_push_deferred(self):
        previous = bool(self._defer_hub_push)
        self._defer_hub_push = True
        flush_stats = {"push_jobs": 0, "push_flush_ms": 0.0}
        try:
            yield flush_stats
        finally:
            self._defer_hub_push = previous
            if not self._defer_hub_push:
                flush_started = time.perf_counter()
                flush_stats["push_jobs"] = self._flush_pending_hub_push()
                flush_stats["push_flush_ms"] = self._elapsed_ms(flush_started)

    @staticmethod
    def _elapsed_ms(started_at: float) -> float:
        return round((time.perf_counter() - started_at) * 1000.0, 1)

    def _log_task_write_timing(self, op: str, *, started_at: float, stages: dict[str, float], **extra: Any) -> None:
        payload = " ".join(f"{key}={value}" for key, value in extra.items() if value is not None)
        stage_payload = " ".join(f"{key}={value:.1f}" for key, value in stages.items())
        logger.info(
            "hub.task.%s took_ms=%.1f %s %s",
            op,
            self._elapsed_ms(started_at),
            stage_payload,
            payload,
        )
        try:
            from backend.services.sql_query_counter import note_hub_stage_timing

            note_hub_stage_timing(op, stages=stages, **extra)
        except Exception:
            pass

    @contextmanager
    def _db_conn(self, *, write: bool = False):
        # APP/PostgreSQL already serializes via transactions; global RLock stampedes
        # chat fan-out and hub HTTP under concurrent writes.
        if self._use_app_db:
            with self._connect() as conn:
                yield conn
        else:
            with self._lock, self._connect() as conn:
                yield conn

    def _task_list_select_sql(self) -> str:
        columns = ", ".join(_TASK_LIST_SELECT_COLUMNS)
        return f"SELECT {columns} FROM {self._TASKS_TABLE}"

    def _append_department_scope_visibility_clause(
        self,
        *,
        user: dict[str, Any],
        where_clauses: list[str],
        params: list[Any],
        user_id: int,
        delegate_owner_ids: list[int],
    ) -> None:
        if user_can_manage_tasks_all(user):
            return
        normalized_user_id = int(user_id)
        observer_clause, observer_params = self._observer_membership_clause(normalized_user_id)
        participant_parts = [
            "created_by_user_id = ?",
            "controller_user_id = ?",
            observer_clause,
        ]
        participant_params: list[Any] = [normalized_user_id, normalized_user_id, *observer_params]
        assignee_clause, assignee_params = self._assignee_membership_any_clause(
            [normalized_user_id, *delegate_owner_ids]
        )
        participant_parts.append(assignee_clause)
        participant_params.extend(assignee_params)
        participant_sql = "(" + " OR ".join(participant_parts) + ")"
        department_ids = sorted(
            department_service.get_user_department_ids(
                user,
                roles=[DEPARTMENT_MEMBER_ROLE, DEPARTMENT_MANAGER_ROLE],
            )
        )
        if department_ids:
            department_placeholders = ", ".join(["?"] * len(department_ids))
            visibility_sql = (
                f"(department_id IN ({department_placeholders}) "
                "AND visibility_scope IN ('department', 'department_managers', 'global'))"
            )
            where_clauses.append(f"({participant_sql} OR {visibility_sql})")
            params.extend([*participant_params, *department_ids])
        else:
            where_clauses.append(participant_sql)
            params.extend(participant_params)

    def _task_visibility_select_sql(self) -> str:
        columns = ", ".join(_TASK_VISIBILITY_SELECT_COLUMNS)
        return f"SELECT {columns} FROM {self._TASKS_TABLE}"

    def _task_row_is_viewable_in_department_scope(self, viewer: dict[str, Any], row_dict: dict[str, Any]) -> bool:
        return can_view_task(
            viewer,
            row_dict,
            participant_user_ids=self._task_viewer_user_ids(row_dict, include_delegates=True),
        )

    def _collect_department_scope_visible_task_ids(
        self,
        conn: sqlite3.Connection,
        *,
        viewer: dict[str, Any],
        where_sql: str,
        params: list[Any],
        sort_expr: str,
        normalized_sort_dir: str,
        tie_breaker: str,
    ) -> tuple[list[str], bool]:
        visible_ids: list[str] = []
        sql_offset = 0
        sql_rows_scanned = 0
        truncated = False
        while sql_rows_scanned < _DEPARTMENT_SCOPE_SQL_SCAN_CAP:
            rows = conn.execute(
                f"""
                {self._task_visibility_select_sql()}
                {where_sql}
                ORDER BY
                  {sort_expr} {normalized_sort_dir},
                  {tie_breaker}
                LIMIT ? OFFSET ?
                """,
                tuple([*params, _DEPARTMENT_SCOPE_FETCH_BATCH, sql_offset]),
            ).fetchall()
            if not rows:
                break
            for row in rows:
                row_dict = dict(row)
                if self._task_row_is_viewable_in_department_scope(viewer, row_dict):
                    visible_ids.append(_normalize_text(row_dict["id"]))
            fetched = len(rows)
            sql_rows_scanned += fetched
            sql_offset += fetched
            if fetched < _DEPARTMENT_SCOPE_FETCH_BATCH:
                break
        else:
            truncated = True
        return visible_ids, truncated

    def _fetch_task_list_rows_by_ids(self, conn: sqlite3.Connection, task_ids: list[str]) -> list[sqlite3.Row]:
        normalized_ids = [_normalize_text(item) for item in task_ids if _normalize_text(item)]
        if not normalized_ids:
            return []
        placeholders = ", ".join(["?"] * len(normalized_ids))
        order_parts = " ".join(f"WHEN ? THEN {index}" for index in range(len(normalized_ids)))
        rows = conn.execute(
            f"""
            {self._task_list_select_sql()}
            WHERE id IN ({placeholders})
            ORDER BY CASE id {order_parts} END
            """,
            tuple([*normalized_ids, *normalized_ids]),
        ).fetchall()
        return list(rows)

    def _connect(self):
        if self._use_app_db and self._database_url:
            return _AfterCommitConnection(
                SqlAlchemyCompatConnection(
                    get_app_engine(self._database_url),
                    table_names=self._hub_table_names(),
                    schema=self._app_schema,
                )
            )
        conn = sqlite3.connect(str(self.db_path), timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return _AfterCommitConnection(_CountingSqliteConnection(conn))

    def _hub_table_names(self) -> set[str]:
        return {
            self._ANN_TABLE,
            self._ANN_READS_TABLE,
            self._ANN_ATTACH_TABLE,
            self._ANN_LIKES_TABLE,
            self._ANN_COMMENTS_TABLE,
            self._ANN_REACTIONS_TABLE,
            self._ANN_COMMENT_REACTIONS_TABLE,
            self._ANN_COMMENT_ATTACH_TABLE,
            self._ANN_COMMENT_MENTIONS_TABLE,
            self._ANN_CATEGORIES_TABLE,
            self._ANN_TAGS_TABLE,
            self._ANN_TAG_LINKS_TABLE,
            self._ANN_BOOKMARKS_TABLE,
            self._ANN_POLLS_TABLE,
            self._ANN_POLL_OPTIONS_TABLE,
            self._ANN_POLL_VOTES_TABLE,
            self._TASKS_TABLE,
            self._TASK_PROJECTS_TABLE,
            self._TASK_OBJECTS_TABLE,
            self._TASK_REPORTS_TABLE,
            self._TASK_ATTACH_TABLE,
            self._TASK_CANVAS_TABLE,
            self._TASK_ATTACHMENT_PREVIEWS_TABLE,
            self._TASK_COMMENT_READS_TABLE,
            self._TASK_COMMENTS_TABLE,
            self._TASK_STATUS_LOG_TABLE,
            self._NOTIF_TABLE,
            self._NOTIF_READS_TABLE,
            self._TASK_EMAIL_OUTBOX_TABLE,
        }

    def _table_columns(self, conn: sqlite3.Connection, table_name: str) -> set[str]:
        rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        return {str(row["name"]) for row in rows}

    def _is_production_postgres_app_db(self, engine=None) -> bool:
        if not (self._use_app_db and self._database_url and config.app.is_production):
            return False
        resolved_engine = engine or get_app_engine(self._database_url)
        return str(resolved_engine.dialect.name).lower() == "postgresql"

    def _verify_production_schema(self, engine) -> None:
        # Back-compat alias: same read-only fail-fast validation for any PG app DB.
        self._verify_hub_schema(engine)

    def _verify_hub_schema(self, engine) -> None:
        try:
            inspector = inspect(engine)
            schema = self._app_schema
            missing_tables = sorted(
                table_name
                for table_name in self._hub_table_names()
                if not inspector.has_table(table_name, schema=schema)
            )
            missing_columns: list[str] = []
            missing_indexes: list[str] = []
            for table_name, required_columns in _HUB_REQUIRED_COLUMNS.items():
                if table_name in missing_tables:
                    continue
                existing_columns = {
                    _normalize_text(column.get("name")).lower()
                    for column in inspector.get_columns(table_name, schema=schema)
                }
                for column_name in sorted(required_columns):
                    if column_name.lower() not in existing_columns:
                        missing_columns.append(f"{table_name}.{column_name}")
            for table_name, required_indexes in _HUB_REQUIRED_INDEXES.items():
                if table_name in missing_tables:
                    continue
                existing_indexes = {
                    _normalize_text(index.get("name")).lower()
                    for index in inspector.get_indexes(table_name, schema=schema)
                }
                for index_name in sorted(required_indexes):
                    if index_name.lower() not in existing_indexes:
                        missing_indexes.append(f"{table_name}.{index_name}")
        except HubSchemaConfigurationError:
            raise
        except Exception as exc:
            raise HubSchemaConfigurationError(
                "Hub schema could not be inspected; "
                "verify APP_DATABASE_URL and backend Alembic migrations."
            ) from exc

        if missing_tables or missing_columns or missing_indexes:
            details: list[str] = []
            if missing_tables:
                details.append("missing tables: " + ", ".join(missing_tables))
            if missing_columns:
                details.append("missing columns: " + ", ".join(missing_columns))
            if missing_indexes:
                details.append("missing indexes: " + ", ".join(missing_indexes))
            raise HubSchemaConfigurationError(
                "Hub PostgreSQL schema is incomplete; "
                "run backend Alembic migrations before startup "
                "(request path will not create hub_task_status_log). "
                + "; ".join(details)
            )

    def _user_can_review_tasks(self, user: dict[str, Any]) -> bool:
        if not bool(user.get("is_active", True)):
            return False
        if str(user.get("role") or "").strip().lower() == "admin":
            return True
        return authorization_service.has_permission(
            user.get("role"),
            PERM_TASKS_REVIEW,
            use_custom_permissions=bool(user.get("use_custom_permissions", False)),
            custom_permissions=user.get("custom_permissions", []),
        )

    def _ensure_task_controller_columns(self, conn: sqlite3.Connection) -> None:
        columns = self._table_columns(conn, self._TASKS_TABLE)
        if "controller_user_id" not in columns:
            conn.execute(
                f"ALTER TABLE {self._TASKS_TABLE} ADD COLUMN controller_user_id INTEGER NOT NULL DEFAULT 0"
            )
        if "controller_username" not in columns:
            conn.execute(
                f"ALTER TABLE {self._TASKS_TABLE} ADD COLUMN controller_username TEXT NOT NULL DEFAULT ''"
            )
        if "controller_full_name" not in columns:
            conn.execute(
                f"ALTER TABLE {self._TASKS_TABLE} ADD COLUMN controller_full_name TEXT NOT NULL DEFAULT ''"
            )
        conn.execute(
            f"""
            CREATE INDEX IF NOT EXISTS idx_{self._TASKS_TABLE}_controller
                ON {self._TASKS_TABLE}(controller_user_id, status, updated_at DESC)
            """
        )
        self._backfill_task_controllers(conn)

    def _backfill_task_controllers(self, conn: sqlite3.Connection) -> None:
        try:
            users = user_service.list_users()
        except Exception as exc:
            logger.warning("Skipping task controller backfill during startup: %s", exc)
            return
        users_by_id = {self._as_int(user.get("id")): user for user in users}
        review_candidates = [user for user in users if self._user_can_review_tasks(user)]
        default_reviewer = review_candidates[0] if review_candidates else None

        rows = conn.execute(
            f"""
            SELECT id, created_by_user_id, controller_user_id, controller_username, controller_full_name
            FROM {self._TASKS_TABLE}
            """
        ).fetchall()

        for row in rows:
            row_dict = dict(row)
            current_id = self._as_int(row_dict.get("controller_user_id"))
            current_username = _normalize_text(row_dict.get("controller_username"))
            current_full_name = _normalize_text(row_dict.get("controller_full_name"))
            current_user = users_by_id.get(current_id)
            if current_id > 0 and current_user and bool(current_user.get("is_active", True)) and current_username:
                continue

            created_by_id = self._as_int(row_dict.get("created_by_user_id"))
            creator_user = users_by_id.get(created_by_id)
            chosen = None
            if creator_user and bool(creator_user.get("is_active", True)) and self._user_can_review_tasks(creator_user):
                chosen = creator_user
            elif default_reviewer:
                chosen = default_reviewer
            elif creator_user and bool(creator_user.get("is_active", True)):
                chosen = creator_user

            if chosen is None:
                continue

            conn.execute(
                f"""
                UPDATE {self._TASKS_TABLE}
                SET controller_user_id = ?, controller_username = ?, controller_full_name = ?
                WHERE id = ?
                """,
                (
                    self._as_int(chosen.get("id")),
                    _normalize_text(chosen.get("username")),
                    _normalize_text(chosen.get("full_name")) or _normalize_text(chosen.get("username")),
                    _normalize_text(row_dict.get("id")),
                ),
            )

    def _ensure_task_priority_column(self, conn: sqlite3.Connection) -> None:
        cols = self._table_columns(conn, self._TASKS_TABLE)
        if "priority" not in cols:
            conn.execute(f"ALTER TABLE {self._TASKS_TABLE} ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'")
        if "checklist_items" not in cols:
            conn.execute(f"ALTER TABLE {self._TASKS_TABLE} ADD COLUMN checklist_items TEXT NOT NULL DEFAULT '[]'")

    def _ensure_task_extended_columns(self, conn: sqlite3.Connection) -> None:
        columns = self._table_columns(conn, self._TASKS_TABLE)
        if "assignee_user_ids" not in columns:
            conn.execute(f"ALTER TABLE {self._TASKS_TABLE} ADD COLUMN assignee_user_ids TEXT NOT NULL DEFAULT '[]'")
        if "project_id" not in columns:
            conn.execute(f"ALTER TABLE {self._TASKS_TABLE} ADD COLUMN project_id TEXT NULL")
        if "object_id" not in columns:
            conn.execute(f"ALTER TABLE {self._TASKS_TABLE} ADD COLUMN object_id TEXT NULL")
        if "protocol_date" not in columns:
            conn.execute(f"ALTER TABLE {self._TASKS_TABLE} ADD COLUMN protocol_date TEXT NULL")
        if "completed_at" not in columns:
            conn.execute(f"ALTER TABLE {self._TASKS_TABLE} ADD COLUMN completed_at TEXT NULL")
        if "completed_at_source" not in columns:
            conn.execute(f"ALTER TABLE {self._TASKS_TABLE} ADD COLUMN completed_at_source TEXT NULL")
        if "department_id" not in columns:
            conn.execute(f"ALTER TABLE {self._TASKS_TABLE} ADD COLUMN department_id TEXT NULL")
        if "visibility_scope" not in columns:
            conn.execute(f"ALTER TABLE {self._TASKS_TABLE} ADD COLUMN visibility_scope TEXT NOT NULL DEFAULT 'private'")
        if "email_deadline_remind_hours" not in columns:
            conn.execute(f"ALTER TABLE {self._TASKS_TABLE} ADD COLUMN email_deadline_remind_hours INTEGER NULL")
        if "observer_user_ids" not in columns:
            conn.execute(f"ALTER TABLE {self._TASKS_TABLE} ADD COLUMN observer_user_ids TEXT NOT NULL DEFAULT '[]'")
        conn.execute(
            f"""
            UPDATE {self._TASKS_TABLE}
            SET assignee_user_ids = '[' || assignee_user_id || ']'
            WHERE assignee_user_id > 0
              AND (assignee_user_ids IS NULL OR TRIM(assignee_user_ids) IN ('', '[]'))
            """
        )
        conn.execute(
            f"CREATE INDEX IF NOT EXISTS idx_{self._TASKS_TABLE}_project ON {self._TASKS_TABLE}(project_id, updated_at DESC)"
        )
        conn.execute(
            f"CREATE INDEX IF NOT EXISTS idx_{self._TASKS_TABLE}_object ON {self._TASKS_TABLE}(object_id, updated_at DESC)"
        )
        conn.execute(
            f"CREATE INDEX IF NOT EXISTS idx_{self._TASKS_TABLE}_protocol_date ON {self._TASKS_TABLE}(protocol_date)"
        )
        conn.execute(
            f"CREATE INDEX IF NOT EXISTS idx_{self._TASKS_TABLE}_completed_at ON {self._TASKS_TABLE}(completed_at)"
        )
        conn.execute(
            f"CREATE INDEX IF NOT EXISTS idx_{self._TASKS_TABLE}_department ON {self._TASKS_TABLE}(department_id, updated_at DESC)"
        )
        conn.execute(
            f"CREATE INDEX IF NOT EXISTS idx_{self._TASKS_TABLE}_created_by ON {self._TASKS_TABLE}(created_by_user_id, status, updated_at DESC)"
        )
        conn.execute(
            f"CREATE INDEX IF NOT EXISTS idx_{self._TASKS_TABLE}_due_at ON {self._TASKS_TABLE}(due_at)"
        )
        self._backfill_task_completed_tracking(conn)

    def _ensure_task_projects_table(self, conn: sqlite3.Connection) -> None:
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {self._TASK_PROJECTS_TABLE} (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                code TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            f"""
            CREATE INDEX IF NOT EXISTS idx_{self._TASK_PROJECTS_TABLE}_active
                ON {self._TASK_PROJECTS_TABLE}(is_active, name)
            """
        )

    def _ensure_default_task_project(self, conn: sqlite3.Connection) -> None:
        row = conn.execute(
            f"""
            SELECT id
            FROM {self._TASK_PROJECTS_TABLE}
            WHERE LOWER(name) = LOWER(?)
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            """,
            (self._DEFAULT_TASK_PROJECT_NAME,),
        ).fetchone()
        project_id = _normalize_text(row["id"] if isinstance(row, sqlite3.Row) else row[0]) if row else ""
        now_iso = _utc_now_iso()

        if not project_id:
            row = conn.execute(
                f"SELECT id FROM {self._TASK_PROJECTS_TABLE} WHERE id = ? LIMIT 1",
                (self._DEFAULT_TASK_PROJECT_ID,),
            ).fetchone()
            project_id = _normalize_text(row["id"] if isinstance(row, sqlite3.Row) else row[0]) if row else ""

        if project_id:
            conn.execute(
                f"""
                UPDATE {self._TASK_PROJECTS_TABLE}
                SET name = ?, code = ?, description = ?, is_active = 1, updated_at = ?
                WHERE id = ?
                """,
                (
                    self._DEFAULT_TASK_PROJECT_NAME,
                    self._DEFAULT_TASK_PROJECT_CODE,
                    self._DEFAULT_TASK_PROJECT_DESCRIPTION,
                    now_iso,
                    project_id,
                ),
            )
        else:
            project_id = self._DEFAULT_TASK_PROJECT_ID
            conn.execute(
                f"""
                INSERT INTO {self._TASK_PROJECTS_TABLE}(id, name, code, description, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, 1, ?, ?)
                """,
                (
                    project_id,
                    self._DEFAULT_TASK_PROJECT_NAME,
                    self._DEFAULT_TASK_PROJECT_CODE,
                    self._DEFAULT_TASK_PROJECT_DESCRIPTION,
                    now_iso,
                    now_iso,
                ),
        )

        conn.execute(
            f"""
            UPDATE {self._TASKS_TABLE}
            SET project_id = ?
            WHERE project_id IS NULL OR TRIM(project_id) = ''
            """,
            (project_id,),
        )

    def ensure_transfer_act_reminder_task_project(self) -> dict[str, Any]:
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"SELECT id FROM {self._TASK_PROJECTS_TABLE} WHERE id = ? LIMIT 1",
                (self._TRANSFER_ACT_REMINDER_PROJECT_ID,),
            ).fetchone()
            project_id = _normalize_text(row["id"] if isinstance(row, sqlite3.Row) else row[0]) if row else ""
            if not project_id:
                row = conn.execute(
                    f"""
                    SELECT id
                    FROM {self._TASK_PROJECTS_TABLE}
                    WHERE LOWER(name) = LOWER(?)
                    ORDER BY created_at ASC, id ASC
                    LIMIT 1
                    """,
                    (self._TRANSFER_ACT_REMINDER_PROJECT_NAME,),
                ).fetchone()
                project_id = _normalize_text(row["id"] if isinstance(row, sqlite3.Row) else row[0]) if row else ""

            if project_id:
                conn.execute(
                    f"""
                    UPDATE {self._TASK_PROJECTS_TABLE}
                    SET name = ?, code = ?, description = ?, is_active = 1, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        self._TRANSFER_ACT_REMINDER_PROJECT_NAME,
                        self._TRANSFER_ACT_REMINDER_PROJECT_CODE,
                        self._TRANSFER_ACT_REMINDER_PROJECT_DESCRIPTION,
                        now_iso,
                        project_id,
                    ),
                )
            else:
                project_id = self._TRANSFER_ACT_REMINDER_PROJECT_ID
                conn.execute(
                    f"""
                    INSERT INTO {self._TASK_PROJECTS_TABLE}(id, name, code, description, is_active, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 1, ?, ?)
                    """,
                    (
                        project_id,
                        self._TRANSFER_ACT_REMINDER_PROJECT_NAME,
                        self._TRANSFER_ACT_REMINDER_PROJECT_CODE,
                        self._TRANSFER_ACT_REMINDER_PROJECT_DESCRIPTION,
                        now_iso,
                        now_iso,
                    ),
                )

            conn.commit()
            row = conn.execute(
                f"SELECT * FROM {self._TASK_PROJECTS_TABLE} WHERE id = ?",
                (project_id,),
            ).fetchone()
            return dict(row) if row else {}

    def _ensure_task_objects_table(self, conn: sqlite3.Connection) -> None:
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {self._TASK_OBJECTS_TABLE} (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL,
                code TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            f"""
            CREATE INDEX IF NOT EXISTS idx_{self._TASK_OBJECTS_TABLE}_project
                ON {self._TASK_OBJECTS_TABLE}(project_id, is_active, name)
            """
        )

    def _ensure_announcement_columns(self, conn: sqlite3.Connection) -> None:
        columns = self._table_columns(conn, self._ANN_TABLE)
        if "version" not in columns:
            conn.execute(f"ALTER TABLE {self._ANN_TABLE} ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
        if "audience_scope" not in columns:
            conn.execute(f"ALTER TABLE {self._ANN_TABLE} ADD COLUMN audience_scope TEXT NOT NULL DEFAULT 'all'")
        if "audience_roles" not in columns:
            conn.execute(f"ALTER TABLE {self._ANN_TABLE} ADD COLUMN audience_roles TEXT NOT NULL DEFAULT '[]'")
        if "audience_user_ids" not in columns:
            conn.execute(f"ALTER TABLE {self._ANN_TABLE} ADD COLUMN audience_user_ids TEXT NOT NULL DEFAULT '[]'")
        if "requires_ack" not in columns:
            conn.execute(f"ALTER TABLE {self._ANN_TABLE} ADD COLUMN requires_ack INTEGER NOT NULL DEFAULT 0")
        if "is_pinned" not in columns:
            conn.execute(f"ALTER TABLE {self._ANN_TABLE} ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0")
        if "pinned_until" not in columns:
            conn.execute(f"ALTER TABLE {self._ANN_TABLE} ADD COLUMN pinned_until TEXT NULL")
        if "published_from" not in columns:
            conn.execute(f"ALTER TABLE {self._ANN_TABLE} ADD COLUMN published_from TEXT NULL")
        if "expires_at" not in columns:
            conn.execute(f"ALTER TABLE {self._ANN_TABLE} ADD COLUMN expires_at TEXT NULL")

        additions = {
            "status": "TEXT NOT NULL DEFAULT 'published'",
            "comments_enabled": "INTEGER NOT NULL DEFAULT 1",
            "reactions_enabled": "INTEGER NOT NULL DEFAULT 1",
            "publication_notified_at": "TEXT NULL",
            "category_id": "TEXT NULL",
        }
        columns = self._table_columns(conn, self._ANN_TABLE)
        for name, ddl in additions.items():
            if name not in columns:
                conn.execute(f"ALTER TABLE {self._ANN_TABLE} ADD COLUMN {name} {ddl}")

    def _ensure_feed_social_schema(self, conn: sqlite3.Connection) -> None:
        attachment_columns = self._table_columns(conn, self._ANN_ATTACH_TABLE)
        if "sort_order" not in attachment_columns:
            conn.execute(f"ALTER TABLE {self._ANN_ATTACH_TABLE} ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
        if "is_cover" not in attachment_columns:
            conn.execute(f"ALTER TABLE {self._ANN_ATTACH_TABLE} ADD COLUMN is_cover INTEGER NOT NULL DEFAULT 0")

        comment_columns = self._table_columns(conn, self._ANN_COMMENTS_TABLE)
        comment_additions = {
            "parent_comment_id": "TEXT NULL",
            "root_comment_id": "TEXT NULL",
            "reply_to_user_id": "INTEGER NULL",
            "reply_to_username": "TEXT NOT NULL DEFAULT ''",
            "deleted_at": "TEXT NULL",
            "deleted_by_user_id": "INTEGER NULL",
            "change_version": "INTEGER NOT NULL DEFAULT 1",
        }
        for name, ddl in comment_additions.items():
            if name not in comment_columns:
                conn.execute(f"ALTER TABLE {self._ANN_COMMENTS_TABLE} ADD COLUMN {name} {ddl}")

        conn.executescript(f"""
            CREATE TABLE IF NOT EXISTS {self._ANN_REACTIONS_TABLE} (
                announcement_id TEXT NOT NULL, user_id INTEGER NOT NULL,
                reaction_type TEXT NOT NULL, username TEXT NOT NULL DEFAULT '',
                full_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL, PRIMARY KEY (announcement_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS {self._ANN_COMMENT_REACTIONS_TABLE} (
                comment_id TEXT NOT NULL, user_id INTEGER NOT NULL,
                reaction_type TEXT NOT NULL, username TEXT NOT NULL DEFAULT '',
                full_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL, PRIMARY KEY (comment_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS {self._ANN_COMMENT_ATTACH_TABLE} (
                id TEXT PRIMARY KEY, comment_id TEXT NOT NULL, announcement_id TEXT NOT NULL,
                file_name TEXT NOT NULL, file_path TEXT NOT NULL, file_mime TEXT NULL,
                file_size INTEGER NOT NULL, uploaded_by_user_id INTEGER NOT NULL, uploaded_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS {self._ANN_COMMENT_MENTIONS_TABLE} (
                comment_id TEXT NOT NULL, user_id INTEGER NOT NULL,
                username TEXT NOT NULL DEFAULT '', full_name TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (comment_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS {self._ANN_CATEGORIES_TABLE} (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
                is_active INTEGER NOT NULL DEFAULT 1, created_by_user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS {self._ANN_TAGS_TABLE} (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS {self._ANN_TAG_LINKS_TABLE} (
                announcement_id TEXT NOT NULL, tag_id TEXT NOT NULL,
                PRIMARY KEY (announcement_id, tag_id)
            );
            CREATE TABLE IF NOT EXISTS {self._ANN_BOOKMARKS_TABLE} (
                announcement_id TEXT NOT NULL, user_id INTEGER NOT NULL, created_at TEXT NOT NULL,
                PRIMARY KEY (announcement_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS {self._ANN_POLLS_TABLE} (
                id TEXT PRIMARY KEY, announcement_id TEXT NOT NULL UNIQUE,
                question TEXT NOT NULL DEFAULT '', allows_multiple INTEGER NOT NULL DEFAULT 0,
                is_anonymous INTEGER NOT NULL DEFAULT 0, closes_at TEXT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS {self._ANN_POLL_OPTIONS_TABLE} (
                id TEXT PRIMARY KEY, poll_id TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS {self._ANN_POLL_VOTES_TABLE} (
                poll_id TEXT NOT NULL, option_id TEXT NOT NULL, user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL, PRIMARY KEY (poll_id, option_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_hub_announcements_status_due
                ON {self._ANN_TABLE}(status, published_from);
            CREATE INDEX IF NOT EXISTS idx_hub_announcement_reactions_announcement
                ON {self._ANN_REACTIONS_TABLE}(announcement_id, reaction_type);
            CREATE INDEX IF NOT EXISTS idx_hub_comment_reactions_comment
                ON {self._ANN_COMMENT_REACTIONS_TABLE}(comment_id, reaction_type);
            CREATE INDEX IF NOT EXISTS idx_hub_comments_root
                ON {self._ANN_COMMENTS_TABLE}(announcement_id, root_comment_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_hub_comment_attachments_comment
                ON {self._ANN_COMMENT_ATTACH_TABLE}(comment_id, uploaded_at);
            CREATE INDEX IF NOT EXISTS idx_hub_bookmarks_user
                ON {self._ANN_BOOKMARKS_TABLE}(user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_hub_tag_links_tag
                ON {self._ANN_TAG_LINKS_TABLE}(tag_id, announcement_id);
            CREATE INDEX IF NOT EXISTS idx_hub_poll_options_poll
                ON {self._ANN_POLL_OPTIONS_TABLE}(poll_id, sort_order);
            CREATE INDEX IF NOT EXISTS idx_hub_poll_votes_poll_user
                ON {self._ANN_POLL_VOTES_TABLE}(poll_id, user_id);
            CREATE INDEX IF NOT EXISTS idx_hub_poll_votes_option
                ON {self._ANN_POLL_VOTES_TABLE}(option_id);
        """)
        conn.execute(
            f"""INSERT INTO {self._ANN_REACTIONS_TABLE}
                (announcement_id, user_id, reaction_type, username, full_name, created_at, updated_at)
                SELECT announcement_id, user_id, 'like', username, full_name, created_at, created_at
                FROM {self._ANN_LIKES_TABLE}
                WHERE 1 = 1
                ON CONFLICT(announcement_id, user_id) DO NOTHING"""
        )
        conn.execute(f"UPDATE {self._ANN_TABLE} SET status = 'archived' WHERE is_active = 0 AND status = 'published'")
        conn.execute(f"UPDATE {self._ANN_TABLE} SET status = 'scheduled' WHERE is_active = 1 AND published_from IS NOT NULL AND published_from > ? AND status = 'published'", (_utc_now_iso(),))
        conn.execute(f"UPDATE {self._ANN_TABLE} SET publication_notified_at = COALESCE(publication_notified_at, published_at, updated_at) WHERE status IN ('published', 'scheduled')")

    def _ensure_announcement_read_columns(self, conn: sqlite3.Connection) -> None:
        columns = self._table_columns(conn, self._ANN_READS_TABLE)
        if "seen_version" not in columns:
            conn.execute(f"ALTER TABLE {self._ANN_READS_TABLE} ADD COLUMN seen_version INTEGER NOT NULL DEFAULT 0")
        if "acknowledged_version" not in columns:
            conn.execute(
                f"ALTER TABLE {self._ANN_READS_TABLE} ADD COLUMN acknowledged_version INTEGER NOT NULL DEFAULT 0"
            )
        if "acknowledged_at" not in columns:
            conn.execute(f"ALTER TABLE {self._ANN_READS_TABLE} ADD COLUMN acknowledged_at TEXT NULL")

    def _ensure_task_reviewer_full_name_column(self, conn: sqlite3.Connection) -> None:
        columns = self._table_columns(conn, self._TASKS_TABLE)
        if "reviewer_full_name" not in columns:
            conn.execute(f"ALTER TABLE {self._TASKS_TABLE} ADD COLUMN reviewer_full_name TEXT NOT NULL DEFAULT ''")

    def _ensure_task_comments_table(self, conn: sqlite3.Connection) -> None:
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS {self._TASK_COMMENTS_TABLE} (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL DEFAULT '',
                full_name TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
        """)
        conn.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_{self._TASK_COMMENTS_TABLE}_task
                ON {self._TASK_COMMENTS_TABLE}(task_id, created_at ASC)
        """)

    def _ensure_task_comment_reads_table(self, conn: sqlite3.Connection) -> None:
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS {self._TASK_COMMENT_READS_TABLE} (
                task_id TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                last_seen_comment_id TEXT NULL,
                last_seen_at TEXT NOT NULL,
                PRIMARY KEY (task_id, user_id)
            )
        """)
        conn.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_{self._TASK_COMMENT_READS_TABLE}_task
                ON {self._TASK_COMMENT_READS_TABLE}(task_id, user_id)
        """)

    def _uses_postgres_app_db(self) -> bool:
        if not (self._use_app_db and self._database_url):
            return False
        try:
            return str(get_app_engine(self._database_url).dialect.name).lower() == "postgresql"
        except Exception:
            return False

    def _run_task_status_log_ddl(self, conn: sqlite3.Connection) -> None:
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS {self._TASK_STATUS_LOG_TABLE} (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                old_status TEXT NOT NULL DEFAULT '',
                new_status TEXT NOT NULL DEFAULT '',
                changed_by_user_id INTEGER NOT NULL,
                changed_by_username TEXT NOT NULL DEFAULT '',
                changed_at TEXT NOT NULL
            )
        """)
        conn.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_{self._TASK_STATUS_LOG_TABLE}_task
                ON {self._TASK_STATUS_LOG_TABLE}(task_id, changed_at ASC)
        """)

    def _ensure_task_status_log_table(self, conn: sqlite3.Connection) -> None:
        """Ensure status-log table exists.

        PostgreSQL app DB: never DDL in request path — table/index come from Alembic
        (`20260327_0002_hub_init`). Missing schema fails at startup validation.
        SQLite/dev: CREATE TABLE/INDEX at most once per process (thread-safe memoize).
        """
        ensure_started = time.perf_counter()
        try:
            # TEST/DIAGNOSTIC ONLY — reproduce pre-fix DDL-every-transition behaviour.
            if bool(getattr(self, "_status_log_force_ddl_every_call", False)):
                if config.app.is_production:
                    raise RuntimeError(
                        "_status_log_force_ddl_every_call is test/diagnostic only and "
                        "is forbidden when APP_ENV is production"
                    )
                logger.warning(
                    "hub.status_log diagnostic force DDL enabled "
                    "(test/bench only; never expose via HTTP)"
                )
                self._run_task_status_log_ddl(conn)
                return
            # Any PostgreSQL — production or development — skips hot-path DDL.
            if self._uses_postgres_app_db() or self._is_production_postgres_app_db():
                return
            if self._task_status_log_ready:
                return
            with self._task_status_log_ready_lock:
                if self._task_status_log_ready:
                    return
                self._run_task_status_log_ddl(conn)
                self._task_status_log_ready = True
        finally:
            try:
                from backend.services.sql_query_counter import note_diag_timing

                note_diag_timing("status_log_ensure_ms", self._elapsed_ms(ensure_started))
            except Exception:
                pass

    def prepare_task_status_log_schema(self) -> dict[str, Any]:
        """Bench/diagnostic one-shot prepare — NOT for HTTP request handlers.

        Call only from offline scripts (e.g. bench_hub_task_workflow). Concurrent
        HTTP traffic must never invoke this; PostgreSQL relies on Alembic + startup
        read-only schema validation.
        """
        started = time.perf_counter()
        if config.app.is_production and bool(getattr(self, "_status_log_force_ddl_every_call", False)):
            raise RuntimeError(
                "prepare_task_status_log_schema refused: force DDL is forbidden in production"
            )
        ran_ddl = False
        if self._uses_postgres_app_db():
            engine = get_app_engine(self._database_url)
            self._verify_hub_schema(engine)
            self._task_status_log_ready = True
            return {
                "backend": "postgresql",
                "ran_ddl": False,
                "ready": True,
                "validated": True,
                "took_ms": self._elapsed_ms(started),
            }
        with self._db_conn(write=True) as conn:
            before = bool(self._task_status_log_ready)
            self._ensure_task_status_log_table(conn)
            conn.commit()
            ran_ddl = (not before) and bool(self._task_status_log_ready)
        return {
            "backend": "sqlite",
            "ran_ddl": ran_ddl,
            "ready": bool(self._task_status_log_ready),
            "validated": False,
            "took_ms": self._elapsed_ms(started),
        }

    def _log_status_change(self, conn: sqlite3.Connection, *, task_id: str, old_status: str, new_status: str, user_id: int, username: str) -> None:
        import uuid as _uuid
        now_iso = _utc_now_iso()
        insert_started = time.perf_counter()
        conn.execute(
            f"INSERT INTO {self._TASK_STATUS_LOG_TABLE} (id, task_id, old_status, new_status, changed_by_user_id, changed_by_username, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (str(_uuid.uuid4()), task_id, old_status, new_status, user_id, username, now_iso),
        )
        try:
            from backend.services.sql_query_counter import note_diag_timing

            note_diag_timing("status_log_insert_ms", self._elapsed_ms(insert_started))
        except Exception:
            pass

    def list_task_comments(
        self,
        task_id: str,
        *,
        user_id: int,
        is_admin: bool = False,
    ) -> list[dict[str, Any]]:
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return []
        with self._lock, self._connect() as conn:
            self._task_access_or_raise(conn, task_id=normalized_id, user_id=int(user_id), is_admin=is_admin)
            rows = conn.execute(
                f"SELECT * FROM {self._TASK_COMMENTS_TABLE} WHERE task_id = ? ORDER BY created_at ASC",
                (normalized_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def add_task_comment(self, *, task_id: str, user: dict[str, Any], body: str) -> Optional[dict[str, Any]]:
        from backend.chat.task_discussion import is_task_discussion_chat_enabled

        if is_task_discussion_chat_enabled():
            raise ValueError("use_task_discussion_chat")
        normalized_id = _normalize_text(task_id)
        body_text = _normalize_text(body)
        if not normalized_id or not body_text:
            return None
        user_id = self._as_int(user.get("id"))
        now_iso = _utc_now_iso()
        comment_id = str(uuid.uuid4())
        with self._lock, self._connect() as conn:
            task = self._task_access_or_raise(conn, task_id=normalized_id, user_id=user_id, is_admin=self._is_admin_role(user.get("role")))
            conn.execute(
                f"INSERT INTO {self._TASK_COMMENTS_TABLE} (id, task_id, user_id, username, full_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (comment_id, normalized_id, user_id, _normalize_text(user.get("username")), _normalize_text(user.get("full_name")), body_text, now_iso),
            )
            conn.execute(f"UPDATE {self._TASKS_TABLE} SET updated_at = ? WHERE id = ?", (now_iso, normalized_id))
            preview = self._preview_text(body_text)
            self._create_task_notifications(
                conn,
                recipient_user_ids=self._task_participant_user_ids(task, include_delegates=True),
                skip_user_ids={user_id},
                event_type="task.comment_added",
                title=f"Новый комментарий: {_normalize_text(task.get('title'))}",
                body=preview,
                task_id=normalized_id,
            )
            conn.commit()
            for participant_id in self._task_participant_user_ids(task, include_delegates=False):
                if participant_id != user_id:
                    self._invalidate_unread_counts_cache(participant_id)
            created = conn.execute(f"SELECT * FROM {self._TASK_COMMENTS_TABLE} WHERE id = ?", (comment_id,)).fetchone()
            result = dict(created) if created else None
        self._publish_task_realtime(
            task={**task, "updated_at": now_iso},
            operation="comment_added",
            actor_user_id=user_id,
        )
        return result

    def mark_task_comments_seen(
        self,
        *,
        task_id: str,
        user: dict[str, Any],
        is_admin: bool = False,
    ) -> Optional[dict[str, Any]]:
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return None
        user_id = self._as_int(user.get("id"))
        with self._lock, self._connect() as conn:
            self._task_access_or_raise(conn, task_id=normalized_id, user_id=user_id, is_admin=is_admin)
            latest_comment = conn.execute(
                f"""
                SELECT id, created_at
                FROM {self._TASK_COMMENTS_TABLE}
                WHERE task_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (normalized_id,),
            ).fetchone()
            seen_at = _normalize_text(latest_comment["created_at"] if latest_comment else _utc_now_iso())
            self._mark_task_comment_seen(
                conn,
                task_id=normalized_id,
                user_id=user_id,
                last_seen_comment_id=_normalize_text(latest_comment["id"]) if latest_comment else None,
                last_seen_at=seen_at,
            )
            conn.commit()
            self._invalidate_unread_counts_cache(user_id)
            task_row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            if task_row is None:
                return None
            return self._task_with_latest_report(conn, task_row, viewer_user_id=user_id)

    def list_task_status_log(
        self,
        task_id: str,
        *,
        user_id: int,
        is_admin: bool = False,
    ) -> list[dict[str, Any]]:
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return []
        with self._lock, self._connect() as conn:
            self._ensure_task_status_log_table(conn)
            self._task_access_or_raise(conn, task_id=normalized_id, user_id=int(user_id), is_admin=is_admin)
            rows = conn.execute(
                f"SELECT * FROM {self._TASK_STATUS_LOG_TABLE} WHERE task_id = ? ORDER BY changed_at ASC",
                (normalized_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def _ensure_schema(self) -> None:
        if self._use_app_db and self._database_url:
            engine = get_app_engine(self._database_url)
            # Any PostgreSQL: read-only validation + fail-fast. No runtime DDL.
            if str(engine.dialect.name).lower() == "postgresql":
                self._verify_hub_schema(engine)
                self._task_status_log_ready = True
                return

        with self._lock, self._connect() as conn:
            if self._use_app_db and self._database_url and self._app_schema:
                self._ensure_task_comments_table(conn)
                self._ensure_task_comment_reads_table(conn)
                self._ensure_task_status_log_table(conn)
            conn.executescript(
                f"""
                CREATE TABLE IF NOT EXISTS {self._ANN_TABLE} (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    preview TEXT NOT NULL DEFAULT '',
                    body TEXT NOT NULL DEFAULT '',
                    priority TEXT NOT NULL DEFAULT 'normal',
                    is_active INTEGER NOT NULL DEFAULT 1,
                    author_user_id INTEGER NOT NULL DEFAULT 0,
                    author_username TEXT NOT NULL DEFAULT '',
                    author_full_name TEXT NOT NULL DEFAULT '',
                    published_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS {self._ANN_READS_TABLE} (
                    announcement_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL,
                    username TEXT NOT NULL DEFAULT '',
                    full_name TEXT NOT NULL DEFAULT '',
                    read_at TEXT NOT NULL,
                    PRIMARY KEY (announcement_id, user_id)
                );
                CREATE TABLE IF NOT EXISTS {self._ANN_ATTACH_TABLE} (
                    id TEXT PRIMARY KEY,
                    announcement_id TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    file_mime TEXT NULL,
                    file_size INTEGER NOT NULL DEFAULT 0,
                    uploaded_by_user_id INTEGER NOT NULL,
                    uploaded_by_username TEXT NOT NULL DEFAULT '',
                    uploaded_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS {self._TASKS_TABLE} (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'new',
                    due_at TEXT NULL,
                    assignee_user_id INTEGER NOT NULL,
                    assignee_user_ids TEXT NOT NULL DEFAULT '[]',
                    assignee_username TEXT NOT NULL DEFAULT '',
                    assignee_full_name TEXT NOT NULL DEFAULT '',
                    controller_user_id INTEGER NOT NULL DEFAULT 0,
                    controller_username TEXT NOT NULL DEFAULT '',
                    controller_full_name TEXT NOT NULL DEFAULT '',
                    created_by_user_id INTEGER NOT NULL,
                    created_by_username TEXT NOT NULL DEFAULT '',
                    created_by_full_name TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    submitted_at TEXT NULL,
                    reviewed_at TEXT NULL,
                    reviewer_user_id INTEGER NULL,
                    reviewer_username TEXT NULL,
                    review_comment TEXT NULL,
                    priority TEXT NOT NULL DEFAULT 'normal',
                    checklist_items TEXT NOT NULL DEFAULT '[]'
                );
                CREATE TABLE IF NOT EXISTS {self._TASK_REPORTS_TABLE} (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    comment TEXT NOT NULL DEFAULT '',
                    file_name TEXT NULL,
                    file_path TEXT NULL,
                    file_mime TEXT NULL,
                    file_size INTEGER NULL,
                    uploaded_by_user_id INTEGER NOT NULL,
                    uploaded_by_username TEXT NOT NULL DEFAULT '',
                    uploaded_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS {self._TASK_ATTACH_TABLE} (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    scope TEXT NOT NULL DEFAULT 'task',
                    file_name TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    file_mime TEXT NULL,
                    file_size INTEGER NOT NULL DEFAULT 0,
                    uploaded_by_user_id INTEGER NOT NULL,
                    uploaded_by_username TEXT NOT NULL DEFAULT '',
                    uploaded_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS {self._TASK_CANVAS_TABLE} (
                    task_id TEXT PRIMARY KEY,
                    scene_json TEXT NOT NULL DEFAULT '{{"elements":[],"appState":{{}},"files":{{}}}}',
                    revision INTEGER NOT NULL DEFAULT 0,
                    updated_by_user_id INTEGER NULL,
                    updated_by_username TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS {self._ANN_LIKES_TABLE} (
                    announcement_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL,
                    username TEXT NOT NULL DEFAULT '',
                    full_name TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (announcement_id, user_id)
                );
                CREATE TABLE IF NOT EXISTS {self._ANN_COMMENTS_TABLE} (
                    id TEXT PRIMARY KEY,
                    announcement_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL,
                    username TEXT NOT NULL DEFAULT '',
                    full_name TEXT NOT NULL DEFAULT '',
                    body TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS {self._TASK_ATTACHMENT_PREVIEWS_TABLE} (
                    attachment_id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'queued',
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    next_attempt_at TEXT NOT NULL,
                    lease_owner TEXT NULL,
                    lease_expires_at TEXT NULL,
                    artifact_rel_path TEXT NOT NULL DEFAULT '',
                    pdf_filename TEXT NOT NULL DEFAULT '',
                    source_kind TEXT NOT NULL DEFAULT '',
                    page_count INTEGER NOT NULL DEFAULT 0,
                    sheets_json TEXT NOT NULL DEFAULT '[]',
                    last_error TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    ready_at TEXT NULL
                );
                CREATE TABLE IF NOT EXISTS {self._TASK_COMMENT_READS_TABLE} (
                    task_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL,
                    last_seen_comment_id TEXT NULL,
                    last_seen_at TEXT NOT NULL,
                    PRIMARY KEY (task_id, user_id)
                );
                CREATE TABLE IF NOT EXISTS {self._NOTIF_TABLE} (
                    id TEXT PRIMARY KEY,
                    recipient_user_id INTEGER NULL,
                    event_type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    body TEXT NOT NULL DEFAULT '',
                    entity_type TEXT NOT NULL DEFAULT '',
                    entity_id TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS {self._NOTIF_READS_TABLE} (
                    notification_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL,
                    read_at TEXT NOT NULL,
                    PRIMARY KEY (notification_id, user_id)
                );
                CREATE TABLE IF NOT EXISTS {self._TASK_EMAIL_OUTBOX_TABLE} (
                    id TEXT PRIMARY KEY,
                    dedupe_key TEXT NOT NULL,
                    task_id TEXT NULL,
                    recipient_user_id INTEGER NOT NULL,
                    recipient_email TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    subject TEXT NOT NULL,
                    body_text TEXT NOT NULL,
                    body_html TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'pending',
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    available_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    sent_at TEXT NULL,
                    last_error TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_{self._ANN_TABLE}_published
                    ON {self._ANN_TABLE}(is_active, published_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._ANN_ATTACH_TABLE}_announcement
                    ON {self._ANN_ATTACH_TABLE}(announcement_id, uploaded_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._ANN_LIKES_TABLE}_announcement
                    ON {self._ANN_LIKES_TABLE}(announcement_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._ANN_COMMENTS_TABLE}_announcement
                    ON {self._ANN_COMMENTS_TABLE}(announcement_id, created_at ASC);
                CREATE INDEX IF NOT EXISTS idx_{self._TASKS_TABLE}_assignee
                    ON {self._TASKS_TABLE}(assignee_user_id, status, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._TASK_ATTACH_TABLE}_task
                    ON {self._TASK_ATTACH_TABLE}(task_id, uploaded_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._TASK_ATTACHMENT_PREVIEWS_TABLE}_status_next_attempt
                    ON {self._TASK_ATTACHMENT_PREVIEWS_TABLE}(status, next_attempt_at);
                CREATE INDEX IF NOT EXISTS idx_{self._TASK_ATTACHMENT_PREVIEWS_TABLE}_lease_expires
                    ON {self._TASK_ATTACHMENT_PREVIEWS_TABLE}(lease_expires_at);
                CREATE INDEX IF NOT EXISTS idx_{self._TASK_ATTACHMENT_PREVIEWS_TABLE}_task
                    ON {self._TASK_ATTACHMENT_PREVIEWS_TABLE}(task_id);
                CREATE INDEX IF NOT EXISTS idx_{self._TASK_COMMENT_READS_TABLE}_task
                    ON {self._TASK_COMMENT_READS_TABLE}(task_id, user_id);
                CREATE INDEX IF NOT EXISTS idx_{self._NOTIF_TABLE}_recipient
                    ON {self._NOTIF_TABLE}(recipient_user_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._NOTIF_TABLE}_entity
                    ON {self._NOTIF_TABLE}(entity_type, entity_id);
                CREATE INDEX IF NOT EXISTS idx_{self._NOTIF_TABLE}_retention
                    ON {self._NOTIF_TABLE}(entity_type, created_at, id)
                    WHERE recipient_user_id IS NOT NULL;
                CREATE UNIQUE INDEX IF NOT EXISTS uq_{self._TASK_EMAIL_OUTBOX_TABLE}_dedupe
                    ON {self._TASK_EMAIL_OUTBOX_TABLE}(dedupe_key);
                CREATE INDEX IF NOT EXISTS idx_{self._TASK_EMAIL_OUTBOX_TABLE}_status
                    ON {self._TASK_EMAIL_OUTBOX_TABLE}(status, available_at, created_at);
                """
            )
            self._ensure_announcement_columns(conn)
            self._ensure_feed_social_schema(conn)
            self._ensure_announcement_read_columns(conn)
            self._ensure_task_controller_columns(conn)
            self._ensure_task_priority_column(conn)
            self._ensure_task_extended_columns(conn)
            self._ensure_task_projects_table(conn)
            self._ensure_default_task_project(conn)
            self._ensure_task_objects_table(conn)
            self._ensure_task_reviewer_full_name_column(conn)
            self._ensure_task_comments_table(conn)
            self._ensure_task_comment_reads_table(conn)
            self._ensure_task_email_outbox_body_html_column(conn)
            conn.commit()

    @staticmethod
    def _as_int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except Exception:
            return int(default)

    @staticmethod
    def _coerce_limit(value: Any, *, default: int, minimum: int, maximum: int) -> int:
        try:
            parsed = int(value)
        except Exception:
            parsed = default
        return max(minimum, min(maximum, parsed))

    @staticmethod
    def _parse_iso_datetime(value: Any) -> Optional[datetime]:
        text = _normalize_text(value)
        if not text:
            return None
        candidate = text.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(candidate)
        except Exception:
            return None
        if parsed.tzinfo is None:
            # Frontend sends due_at as local wall-clock without offset
            # (e.g. "2026-07-23T11:00"). Treat naive values as server-local,
            # not UTC — otherwise UTC+5 shows 11:00 as 16:00 in emails/overdue.
            local_tz = datetime.now().astimezone().tzinfo or timezone.utc
            return parsed.replace(tzinfo=local_tz).astimezone(timezone.utc)
        return parsed.astimezone(timezone.utc)

    @staticmethod
    def _normalize_protocol_date(value: Any) -> str | None:
        text = _normalize_text(value)
        if not text:
            return None
        for candidate in (text, text[:10]):
            try:
                parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
            except Exception:
                continue
            return parsed.date().isoformat()
        return None

    @classmethod
    def _normalize_completed_at_source(cls, value: Any) -> str | None:
        text = _normalize_text(value).lower()
        if not text:
            return None
        return text if text in cls._COMPLETED_AT_SOURCE_VALUES else None

    def _derive_completed_tracking(self, item: dict[str, Any]) -> tuple[str | None, str | None]:
        status_text = _normalize_text(item.get("status")).lower()
        explicit_completed_at = _normalize_text(item.get("completed_at")) or None
        explicit_source = self._normalize_completed_at_source(item.get("completed_at_source"))
        if status_text != "done":
            return None, None
        if explicit_completed_at and self._parse_iso_datetime(explicit_completed_at):
            return explicit_completed_at, explicit_source or "explicit"

        for field_name, source_name in (
            ("reviewed_at", "reviewed_at"),
            ("submitted_at", "submitted_at"),
            ("updated_at", "updated_at"),
            ("created_at", "backfill"),
        ):
            candidate = _normalize_text(item.get(field_name)) or None
            if candidate and self._parse_iso_datetime(candidate):
                return candidate, source_name
        return None, None

    def _backfill_task_completed_tracking(self, conn: sqlite3.Connection) -> None:
        rows = conn.execute(
            f"""
            SELECT id, status, created_at, updated_at, submitted_at, reviewed_at, completed_at, completed_at_source
            FROM {self._TASKS_TABLE}
            """
        ).fetchall()
        for row in rows:
            item = dict(row)
            next_completed_at, next_source = self._derive_completed_tracking(item)
            current_completed_at = _normalize_text(item.get("completed_at")) or None
            current_source = self._normalize_completed_at_source(item.get("completed_at_source"))
            if current_completed_at == next_completed_at and current_source == next_source:
                continue
            conn.execute(
                f"""
                UPDATE {self._TASKS_TABLE}
                SET completed_at = ?, completed_at_source = ?
                WHERE id = ?
                """,
                (
                    next_completed_at,
                    next_source,
                    _normalize_text(item.get("id")),
                ),
            )

    def _completed_on_time(self, *, completed_at: Any, due_at: Any, status: Any) -> bool:
        if _normalize_text(status).lower() != "done":
            return False
        completed_dt = self._parse_iso_datetime(completed_at)
        if completed_dt is None:
            return False
        due_dt = self._parse_iso_datetime(due_at)
        if due_dt is None:
            return False
        return completed_dt <= due_dt

    @staticmethod
    def _is_task_overdue(due_at: Any, status: Any) -> bool:
        if _normalize_text(status).lower() == "done":
            return False
        parsed_due = HubService._parse_iso_datetime(due_at)
        if parsed_due is None:
            return False
        return parsed_due < datetime.now(timezone.utc)

    @staticmethod
    def _row_to_dict(row: Optional[sqlite3.Row]) -> Optional[dict[str, Any]]:
        if row is None:
            return None
        return {key: row[key] for key in row.keys()}

    @staticmethod
    def _attachment_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        item = dict(row)
        item["file_size"] = HubService._as_int(item.get("file_size"))
        item["scope"] = _normalize_text(item.get("scope"))
        return item

    @staticmethod
    def _json_load_list(value: Any) -> list[Any]:
        if isinstance(value, list):
            return value
        text = _normalize_text(value)
        if not text:
            return []
        try:
            loaded = json.loads(text)
        except Exception:
            return []
        return loaded if isinstance(loaded, list) else []

    @staticmethod
    def _serialize_json_list(values: Any) -> str:
        if not isinstance(values, list):
            values = []
        return json.dumps(values, ensure_ascii=False)

    @classmethod
    def _normalize_checklist_items(cls, values: Any) -> list[dict[str, Any]]:
        source = cls._json_load_list(values) if isinstance(values, str) else (values if isinstance(values, list) else [])
        items: list[dict[str, Any]] = []
        for raw in source[:100]:
            if isinstance(raw, dict):
                text = _normalize_text(raw.get("text"))
                item_id = _normalize_text(raw.get("id")) or str(uuid.uuid4())
                is_done = bool(raw.get("done"))
            else:
                text = _normalize_text(raw)
                item_id = str(uuid.uuid4())
                is_done = False
            if not text:
                continue
            items.append({
                "id": item_id[:80],
                "text": text[:500],
                "done": is_done,
            })
        return items

    @classmethod
    def _serialize_checklist_items(cls, values: Any) -> str:
        return cls._serialize_json_list(cls._normalize_checklist_items(values))

    @staticmethod
    def _preview_text(value: Any, *, limit: int = 140) -> str:
        text = re.sub(r"\s+", " ", _normalize_text(value)).strip()
        if len(text) <= limit:
            return text
        return text[: max(0, limit - 1)].rstrip() + "…"

    @staticmethod
    def _unique_ints(values: Any) -> list[int]:
        out: list[int] = []
        for item in values if isinstance(values, list) else []:
            try:
                parsed = int(item)
            except Exception:
                continue
            if parsed > 0 and parsed not in out:
                out.append(parsed)
        return out

    @staticmethod
    def _unique_texts(values: Any) -> list[str]:
        out: list[str] = []
        for item in values if isinstance(values, list) else []:
            text = _normalize_text(item).lower()
            if text and text not in out:
                out.append(text)
        return out

    @staticmethod
    def _is_admin_role(value: Any) -> bool:
        return _normalize_text(value).lower() == "admin"

    @staticmethod
    def _user_can_moderate_announcements(user: dict[str, Any]) -> bool:
        if _normalize_text(user.get("role")).lower() == "admin":
            return True
        if PERM_ANNOUNCEMENTS_MODERATE in set(user.get("permissions") or []):
            return True
        return authorization_service.has_permission(
            user.get("role"),
            PERM_ANNOUNCEMENTS_MODERATE,
            use_custom_permissions=bool(user.get("use_custom_permissions", False)),
            custom_permissions=user.get("custom_permissions", []),
        )

    def _active_users(self) -> list[dict[str, Any]]:
        from backend.services.ad_users_service import is_hub_service_account_login

        return [
            row
            for row in user_service.list_users()
            if bool(row.get("is_active", True)) and not is_hub_service_account_login(row.get("username"))
        ]

    def realtime_recipient_user_ids(self, permission: str) -> set[int]:
        """Active users allowed to receive one permission-scoped invalidation."""
        normalized_permission = _normalize_text(permission)
        if not normalized_permission:
            return set()
        recipients: set[int] = set()
        for user in self._get_cached_user_directory("active_users", self._active_users):
            user_id = self._as_int(user.get("id"))
            if user_id <= 0:
                continue
            if authorization_service.has_permission(
                user.get("role"),
                normalized_permission,
                use_custom_permissions=bool(user.get("use_custom_permissions", False)),
                custom_permissions=user.get("custom_permissions", []),
            ):
                recipients.add(user_id)
        return recipients

    def publish_permission_realtime(
        self,
        *,
        permission: str,
        event_type: str,
        payload: dict[str, Any] | None = None,
        event_id: str = "",
    ) -> int:
        from backend.realtime.hub import hub_realtime_publisher

        published = 0
        for recipient_user_id in self.realtime_recipient_user_ids(permission):
            if hub_realtime_publisher.publish_user_event(
                recipient_user_id=recipient_user_id,
                event_type=event_type,
                payload=dict(payload or {}),
                event_id=event_id,
            ):
                published += 1
        return published

    def _users_by_id(self) -> dict[int, dict[str, Any]]:
        users = self._get_cached_user_directory("active_users", self._active_users)
        return {self._as_int(row.get("id")): row for row in users}

    @staticmethod
    def _user_can_read_tasks(user: dict[str, Any]) -> bool:
        return authorization_service.has_permission(
            user.get("role"),
            PERM_TASKS_READ,
            use_custom_permissions=bool(user.get("use_custom_permissions", False)),
            custom_permissions=user.get("custom_permissions", []),
        )

    def _task_realtime_recipient_user_ids(self, task: dict[str, Any] | None) -> set[int]:
        if not isinstance(task, dict) or not _normalize_text(task.get("id")):
            return set()
        participant_user_ids = self._task_viewer_user_ids(task, include_delegates=True)
        recipients: set[int] = set()
        for user in self._get_cached_user_directory("active_users", self._active_users):
            user_id = self._as_int(user.get("id"))
            if user_id <= 0 or not self._user_can_read_tasks(user):
                continue
            if can_view_task(user, task, participant_user_ids=participant_user_ids):
                recipients.add(user_id)
        return recipients

    def _publish_task_realtime(
        self,
        *,
        task: dict[str, Any] | None,
        operation: str,
        previous_task: dict[str, Any] | None = None,
        actor_user_id: int = 0,
    ) -> int:
        task_payload = task if isinstance(task, dict) else previous_task
        task_id = _normalize_text((task_payload or {}).get("id"))
        if not task_id:
            return 0
        recipients = self._task_realtime_recipient_user_ids(task)
        recipients.update(self._task_realtime_recipient_user_ids(previous_task))
        if not recipients:
            return 0

        from backend.realtime.hub import (
            HUB_TASK_CREATED_EVENT,
            HUB_TASK_DELETED_EVENT,
            HUB_TASK_UPDATED_EVENT,
            hub_realtime_publisher,
        )

        normalized_operation = _normalize_text(operation, "updated").lower()
        event_type = {
            "created": HUB_TASK_CREATED_EVENT,
            "deleted": HUB_TASK_DELETED_EVENT,
        }.get(normalized_operation, HUB_TASK_UPDATED_EVENT)
        event_id = str(uuid.uuid4())
        payload = {
            "task_id": task_id,
            "operation": normalized_operation,
            "updated_at": _normalize_text((task_payload or {}).get("updated_at")),
            "status": _normalize_text((task_payload or {}).get("status")),
            "actor_user_id": self._as_int(actor_user_id),
        }
        return sum(
            1
            for recipient_user_id in recipients
            if hub_realtime_publisher.publish_user_event(
                recipient_user_id=recipient_user_id,
                event_type=event_type,
                event_id=event_id,
                payload=payload,
            )
        )

    def _uses_postgresql(self) -> bool:
        if not self._use_app_db or not self._database_url:
            return False
        try:
            return str(get_app_engine(self._database_url).dialect.name).lower() == "postgresql"
        except Exception:
            return False

    def _get_task_project(self, conn: sqlite3.Connection, project_id: Any) -> Optional[dict[str, Any]]:
        normalized_id = _normalize_text(project_id)
        if not normalized_id:
            return None
        row = conn.execute(
            f"SELECT * FROM {self._TASK_PROJECTS_TABLE} WHERE id = ?",
            (normalized_id,),
        ).fetchone()
        return dict(row) if row else None

    def _get_task_object(self, conn: sqlite3.Connection, object_id: Any) -> Optional[dict[str, Any]]:
        normalized_id = _normalize_text(object_id)
        if not normalized_id:
            return None
        row = conn.execute(
            f"SELECT * FROM {self._TASK_OBJECTS_TABLE} WHERE id = ?",
            (normalized_id,),
        ).fetchone()
        return dict(row) if row else None

    def _validate_task_project_object(
        self,
        conn: sqlite3.Connection,
        *,
        project_id: Any,
        object_id: Any,
    ) -> tuple[str | None, str | None]:
        normalized_project_id = _normalize_text(project_id) or None
        normalized_object_id = _normalize_text(object_id) or None
        if normalized_project_id:
            project = self._get_task_project(conn, normalized_project_id)
            if not project or not bool(self._as_int(project.get("is_active"), 1)):
                raise ValueError("Project is not available")
        if normalized_object_id:
            task_object = self._get_task_object(conn, normalized_object_id)
            if not task_object or not bool(self._as_int(task_object.get("is_active"), 1)):
                raise ValueError("Task object is not available")
            object_project_id = _normalize_text(task_object.get("project_id")) or None
            if normalized_project_id and object_project_id != normalized_project_id:
                raise ValueError("Task object does not belong to the selected project")
            if not normalized_project_id:
                normalized_project_id = object_project_id
        return normalized_project_id, normalized_object_id

    def _task_user_can_view(
        self,
        task: dict[str, Any],
        *,
        user_id: int,
        is_admin: bool = False,
        viewer: Optional[dict[str, Any]] = None,
        delegate_user_ids_by_assignee: Optional[dict[int, list[int]]] = None,
    ) -> bool:
        if is_admin:
            return True
        normalized_user_id = self._as_int(user_id)
        if normalized_user_id <= 0:
            return False
        user = viewer or user_service.get_by_id(normalized_user_id) or {"id": normalized_user_id, "role": "viewer"}
        if delegate_user_ids_by_assignee is None:
            participant_user_ids = self._task_viewer_user_ids(task, include_delegates=True)
        else:
            participant_user_ids = self._task_viewer_user_ids(task, include_delegates=False)
            for assignee_user_id in self._task_assignee_user_ids(task):
                if assignee_user_id not in delegate_user_ids_by_assignee:
                    delegate_user_ids_by_assignee[assignee_user_id] = self._task_delegate_user_ids(assignee_user_id)
                participant_user_ids.update(delegate_user_ids_by_assignee[assignee_user_id])
        return can_view_task(
            user,
            task,
            participant_user_ids=participant_user_ids,
        )

    def _task_access_or_raise(
        self,
        conn: sqlite3.Connection,
        *,
        task_id: str,
        user_id: int,
        is_admin: bool = False,
    ) -> dict[str, Any]:
        row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (_normalize_text(task_id),)).fetchone()
        if row is None:
            raise LookupError("Task not found")
        task = dict(row)
        if not self._task_user_can_view(task, user_id=int(user_id), is_admin=bool(is_admin)):
            raise PermissionError("Task is not available for current user")
        return task

    def _mark_task_comment_seen(
        self,
        conn: sqlite3.Connection,
        *,
        task_id: str,
        user_id: int,
        last_seen_comment_id: Optional[str],
        last_seen_at: str,
    ) -> None:
        conn.execute(
            f"""
            INSERT INTO {self._TASK_COMMENT_READS_TABLE}(task_id, user_id, last_seen_comment_id, last_seen_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(task_id, user_id) DO UPDATE SET
              last_seen_comment_id = excluded.last_seen_comment_id,
              last_seen_at = excluded.last_seen_at
            """,
            (_normalize_text(task_id), self._as_int(user_id), _normalize_text(last_seen_comment_id) or None, _normalize_text(last_seen_at)),
        )

    def _get_cached_user_directory(
        self,
        cache_key: str,
        builder: Callable[[], list[dict[str, Any]]],
    ) -> list[dict[str, Any]]:
        now = time.monotonic()
        with self._user_directory_cache_lock:
            cached = self._user_directory_cache.get(cache_key)
            if cached and (now - cached[0]) < self._user_directory_cache_ttl_sec:
                return list(cached[1])
        items = builder()
        with self._user_directory_cache_lock:
            self._user_directory_cache[cache_key] = (now, list(items))
        return items

    def _load_records_by_ids(
        self,
        conn: sqlite3.Connection,
        *,
        table: str,
        ids: list[str],
    ) -> dict[str, dict[str, Any]]:
        normalized_ids = [_normalize_text(item) for item in ids if _normalize_text(item)]
        if not normalized_ids:
            return {}
        placeholders = ", ".join(["?"] * len(normalized_ids))
        rows = conn.execute(
            f"SELECT * FROM {table} WHERE id IN ({placeholders})",
            tuple(normalized_ids),
        ).fetchall()
        return {_normalize_text(row["id"]): dict(row) for row in rows}

    def _build_task_list_batch_context(
        self,
        conn: sqlite3.Connection,
        task_ids: list[str],
        *,
        viewer_user_id: Optional[int],
    ) -> dict[str, Any]:
        normalized_ids = [_normalize_text(task_id) for task_id in task_ids if _normalize_text(task_id)]
        if not normalized_ids:
            return {
                "attachment_counts": {},
                "report_counts": {},
                "comment_counts": {},
                "latest_comments": {},
                "last_seen_at": {},
                "viewer_user_id": self._as_int(viewer_user_id),
            }
        placeholders = ", ".join(["?"] * len(normalized_ids))
        attach_rows = conn.execute(
            f"""
            SELECT task_id, COUNT(*) AS c
            FROM {self._TASK_ATTACH_TABLE}
            WHERE task_id IN ({placeholders})
            GROUP BY task_id
            """,
            tuple(normalized_ids),
        ).fetchall()
        report_rows = conn.execute(
            f"""
            SELECT task_id, COUNT(*) AS c
            FROM {self._TASK_REPORTS_TABLE}
            WHERE task_id IN ({placeholders})
            GROUP BY task_id
            """,
            tuple(normalized_ids),
        ).fetchall()
        comment_count_rows = conn.execute(
            f"""
            SELECT task_id, COUNT(*) AS c
            FROM {self._TASK_COMMENTS_TABLE}
            WHERE task_id IN ({placeholders})
            GROUP BY task_id
            """,
            tuple(normalized_ids),
        ).fetchall()
        latest_comment_rows = conn.execute(
            f"""
            SELECT c.task_id, c.id, c.user_id, c.username, c.full_name, c.body, c.created_at
            FROM {self._TASK_COMMENTS_TABLE} c
            INNER JOIN (
                SELECT task_id, MAX(created_at) AS max_created_at
                FROM {self._TASK_COMMENTS_TABLE}
                WHERE task_id IN ({placeholders})
                GROUP BY task_id
            ) latest ON c.task_id = latest.task_id AND c.created_at = latest.max_created_at
            WHERE c.task_id IN ({placeholders})
            """,
            tuple([*normalized_ids, *normalized_ids]),
        ).fetchall()
        last_seen_at: dict[str, str] = {}
        normalized_viewer_id = self._as_int(viewer_user_id)
        if normalized_viewer_id > 0:
            seen_rows = conn.execute(
                f"""
                SELECT task_id, last_seen_at
                FROM {self._TASK_COMMENT_READS_TABLE}
                WHERE user_id = ? AND task_id IN ({placeholders})
                """,
                tuple([normalized_viewer_id, *normalized_ids]),
            ).fetchall()
            last_seen_at = {
                _normalize_text(row["task_id"]): _normalize_text(row["last_seen_at"])
                for row in seen_rows
            }
        return {
            "attachment_counts": {
                _normalize_text(row["task_id"]): self._as_int(row["c"])
                for row in attach_rows
            },
            "report_counts": {
                _normalize_text(row["task_id"]): self._as_int(row["c"])
                for row in report_rows
            },
            "comment_counts": {
                _normalize_text(row["task_id"]): self._as_int(row["c"])
                for row in comment_count_rows
            },
            "latest_comments": {
                _normalize_text(row["task_id"]): dict(row)
                for row in latest_comment_rows
            },
            "last_seen_at": last_seen_at,
            "viewer_user_id": normalized_viewer_id,
        }

    def _comment_summary_from_batch(
        self,
        *,
        task_id: str,
        batch_ctx: dict[str, Any],
    ) -> dict[str, Any]:
        normalized_task_id = _normalize_text(task_id)
        latest_comment = batch_ctx["latest_comments"].get(normalized_task_id)
        comments_count = self._as_int(batch_ctx["comment_counts"].get(normalized_task_id, 0))
        last_seen_at = _normalize_text(batch_ctx["last_seen_at"].get(normalized_task_id, ""))
        normalized_viewer_id = self._as_int(batch_ctx.get("viewer_user_id"))
        latest_comment_created_at = _normalize_text(latest_comment.get("created_at")) if latest_comment else ""
        latest_comment_user_id = self._as_int(latest_comment.get("user_id")) if latest_comment else 0
        has_unread = bool(
            latest_comment
            and normalized_viewer_id > 0
            and latest_comment_user_id != normalized_viewer_id
            and (not last_seen_at or latest_comment_created_at > last_seen_at)
        )
        return {
            "comments_count": comments_count,
            "latest_comment_preview": self._preview_text(latest_comment.get("body")) if latest_comment else "",
            "latest_comment_at": latest_comment_created_at,
            "latest_comment_user_id": latest_comment_user_id,
            "latest_comment_username": _normalize_text(latest_comment.get("username")) if latest_comment else "",
            "latest_comment_full_name": _normalize_text(latest_comment.get("full_name")) if latest_comment else "",
            "has_unread_comments": has_unread,
        }

    def _apply_task_derived_fields(
        self,
        item: dict[str, Any],
        *,
        project: Optional[dict[str, Any]] = None,
        task_object: Optional[dict[str, Any]] = None,
        department: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        item["reviewer_full_name"] = _normalize_text(item.get("reviewer_full_name"))
        checklist_items = self._normalize_checklist_items(item.get("checklist_items"))
        item["checklist_items"] = checklist_items
        item["checklist_total"] = len(checklist_items)
        item["checklist_done"] = sum(1 for checklist_item in checklist_items if bool(checklist_item.get("done")))
        item["project_id"] = _normalize_text(item.get("project_id")) or None
        item["project_name"] = _normalize_text(project.get("name")) if project else ""
        item["object_id"] = _normalize_text(item.get("object_id")) or None
        item["object_name"] = _normalize_text(task_object.get("name")) if task_object else ""
        item["department_id"] = _normalize_text(item.get("department_id")) or None
        item["department_name"] = _normalize_text((department or {}).get("name"))
        item["visibility_scope"] = normalize_visibility_scope(item.get("visibility_scope"), default=VISIBILITY_PRIVATE)
        item["protocol_date"] = self._normalize_protocol_date(item.get("protocol_date")) or self._normalize_protocol_date(item.get("created_at"))
        completed_at, completed_at_source = self._derive_completed_tracking(item)
        item["completed_at"] = completed_at
        item["completed_at_source"] = completed_at_source
        item["completed_on_time"] = self._completed_on_time(
            completed_at=completed_at,
            due_at=item.get("due_at"),
            status=item.get("status"),
        )
        item["done_without_due"] = (
            _normalize_text(item.get("status")).lower() == "done"
            and bool(completed_at)
            and self._parse_iso_datetime(item.get("due_at")) is None
        )
        item["observer_user_ids"] = self._normalize_observer_user_ids(item.get("observer_user_ids"))
        return item

    def _enrich_analytics_task_row(
        self,
        item: dict[str, Any],
        *,
        projects_by_id: dict[str, dict[str, Any]],
        objects_by_id: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        enriched = dict(item)
        enriched["is_overdue"] = self._is_task_overdue(enriched.get("due_at"), enriched.get("status"))
        project_id = _normalize_text(enriched.get("project_id"))
        object_id = _normalize_text(enriched.get("object_id"))
        return self._apply_task_derived_fields(
            enriched,
            project=projects_by_id.get(project_id) if project_id else None,
            task_object=objects_by_id.get(object_id) if object_id else None,
            department=None,
        )

    def _unread_comments_exists_sql(self, *, user_id: int, table_alias: str = "") -> tuple[str, list[Any]]:
        normalized_user_id = self._as_int(user_id)
        task_ref = f"{table_alias}." if table_alias else ""
        clause = f"""
            EXISTS (
                SELECT 1
                FROM {self._TASK_COMMENTS_TABLE} c
                INNER JOIN (
                    SELECT task_id, MAX(created_at) AS max_created_at
                    FROM {self._TASK_COMMENTS_TABLE}
                    GROUP BY task_id
                ) latest ON latest.task_id = c.task_id AND c.created_at = latest.max_created_at
                LEFT JOIN {self._TASK_COMMENT_READS_TABLE} r
                    ON r.task_id = c.task_id AND r.user_id = ?
                WHERE c.task_id = {task_ref}id
                  AND c.user_id <> ?
                  AND (
                    r.last_seen_at IS NULL
                    OR TRIM(r.last_seen_at) = ''
                    OR c.created_at > r.last_seen_at
                  )
            )
        """
        return clause, [normalized_user_id, normalized_user_id]

    def _task_to_list_item(
        self,
        task_row: sqlite3.Row,
        batch_ctx: dict[str, Any],
        *,
        projects_by_id: dict[str, dict[str, Any]],
        objects_by_id: dict[str, dict[str, Any]],
        departments_by_id: dict[str, Optional[dict[str, Any]]],
        users_by_id: dict[int, dict[str, Any]],
    ) -> dict[str, Any]:
        raw = dict(task_row)
        task_id = _normalize_text(raw.get("id"))
        project_id = _normalize_text(raw.get("project_id"))
        object_id = _normalize_text(raw.get("object_id"))
        department_id = _normalize_text(raw.get("department_id"))
        project = projects_by_id.get(project_id) if project_id else None
        task_object = objects_by_id.get(object_id) if object_id else None
        department = departments_by_id.get(department_id) if department_id else None
        checklist_items = self._normalize_checklist_items(raw.get("checklist_items"))
        completed_at, completed_at_source = self._derive_completed_tracking(raw)
        comment_summary = self._comment_summary_from_batch(task_id=task_id, batch_ctx=batch_ctx)
        item = {
            "id": task_id,
            "title": _normalize_text(raw.get("title")),
            "description_preview": _normalize_text(raw.get("description_preview")),
            "status": _normalize_text(raw.get("status")),
            "priority": _normalize_text(raw.get("priority"), "normal"),
            "due_at": _normalize_text(raw.get("due_at")) or None,
            "email_deadline_remind_hours": raw.get("email_deadline_remind_hours"),
            "assignee_user_id": self._as_int(raw.get("assignee_user_id")),
            "assignee_user_ids": self._normalize_assignee_user_ids(
                raw.get("assignee_user_ids"),
                fallback_assignee_user_id=raw.get("assignee_user_id"),
            ),
            "assignee_username": _normalize_text(raw.get("assignee_username")),
            "assignee_full_name": _normalize_text(raw.get("assignee_full_name")),
            "controller_user_id": self._as_int(raw.get("controller_user_id")),
            "controller_username": _normalize_text(raw.get("controller_username")),
            "controller_full_name": _normalize_text(raw.get("controller_full_name")),
            "created_by_user_id": self._as_int(raw.get("created_by_user_id")),
            "created_by_username": _normalize_text(raw.get("created_by_username")),
            "created_by_full_name": _normalize_text(raw.get("created_by_full_name")),
            "created_at": _normalize_text(raw.get("created_at")),
            "updated_at": _normalize_text(raw.get("updated_at")),
            "submitted_at": _normalize_text(raw.get("submitted_at")) or None,
            "reviewed_at": _normalize_text(raw.get("reviewed_at")) or None,
            "project_id": project_id or None,
            "project_name": _normalize_text(project.get("name")) if project else "",
            "object_id": object_id or None,
            "object_name": _normalize_text(task_object.get("name")) if task_object else "",
            "protocol_date": self._normalize_protocol_date(raw.get("protocol_date"))
            or self._normalize_protocol_date(raw.get("created_at")),
            "completed_at": completed_at,
            "completed_at_source": completed_at_source,
            "completed_on_time": self._completed_on_time(
                completed_at=completed_at,
                due_at=raw.get("due_at"),
                status=raw.get("status"),
            ),
            "done_without_due": (
                _normalize_text(raw.get("status")).lower() == "done"
                and bool(completed_at)
                and self._parse_iso_datetime(raw.get("due_at")) is None
            ),
            "department_id": department_id or None,
            "department_name": _normalize_text((department or {}).get("name")),
            "visibility_scope": normalize_visibility_scope(
                raw.get("visibility_scope"),
                default=VISIBILITY_PRIVATE,
            ),
            "observer_user_ids": self._normalize_observer_user_ids(raw.get("observer_user_ids")),
            "is_overdue": self._is_task_overdue(raw.get("due_at"), raw.get("status")),
            "attachments_count": self._as_int(batch_ctx.get("attachment_counts", {}).get(task_id, 0)),
            "reports_count": self._as_int(batch_ctx.get("report_counts", {}).get(task_id, 0)),
            "checklist_total": len(checklist_items),
            "checklist_done": sum(1 for checklist_item in checklist_items if bool(checklist_item.get("done"))),
            **comment_summary,
        }
        # Stable schema: never emit thick/detail-only keys from list DTO.
        for forbidden in _TASK_LIST_FORBIDDEN_KEYS:
            item.pop(forbidden, None)
        return self._enrich_task_assignee_fields(item, users_by_id=users_by_id)

    def _get_task_comment_summary(
        self,
        conn: sqlite3.Connection,
        *,
        task_id: str,
        viewer_user_id: Optional[int],
    ) -> dict[str, Any]:
        normalized_task_id = _normalize_text(task_id)
        comments_total_row = conn.execute(
            f"SELECT COUNT(*) AS c FROM {self._TASK_COMMENTS_TABLE} WHERE task_id = ?",
            (normalized_task_id,),
        ).fetchone()
        latest_comment_row = conn.execute(
            f"""
            SELECT id, user_id, username, full_name, body, created_at
            FROM {self._TASK_COMMENTS_TABLE}
            WHERE task_id = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (normalized_task_id,),
        ).fetchone()
        latest_comment = dict(latest_comment_row) if latest_comment_row else None
        last_seen_at = ""
        normalized_viewer_id = self._as_int(viewer_user_id)
        if normalized_viewer_id > 0:
            seen_row = conn.execute(
                f"""
                SELECT last_seen_at
                FROM {self._TASK_COMMENT_READS_TABLE}
                WHERE task_id = ? AND user_id = ?
                """,
                (normalized_task_id, normalized_viewer_id),
            ).fetchone()
            last_seen_at = _normalize_text(seen_row["last_seen_at"]) if seen_row else ""

        latest_comment_created_at = _normalize_text(latest_comment.get("created_at")) if latest_comment else ""
        latest_comment_user_id = self._as_int(latest_comment.get("user_id")) if latest_comment else 0
        has_unread = bool(
            latest_comment
            and normalized_viewer_id > 0
            and latest_comment_user_id != normalized_viewer_id
            and (not last_seen_at or latest_comment_created_at > last_seen_at)
        )

        return {
            "comments_count": self._as_int(comments_total_row["c"] if comments_total_row else 0),
            "latest_comment_preview": self._preview_text(latest_comment.get("body")) if latest_comment else "",
            "latest_comment_at": latest_comment_created_at,
            "latest_comment_user_id": latest_comment_user_id,
            "latest_comment_username": _normalize_text(latest_comment.get("username")) if latest_comment else "",
            "latest_comment_full_name": _normalize_text(latest_comment.get("full_name")) if latest_comment else "",
            "has_unread_comments": has_unread,
        }

    def _task_with_latest_report(
        self,
        conn: sqlite3.Connection,
        task_row: sqlite3.Row,
        *,
        viewer_user_id: Optional[int] = None,
    ) -> dict[str, Any]:
        item = dict(task_row)
        report = conn.execute(
            f"""
            SELECT id, comment, file_name, file_mime, file_size, uploaded_by_username, uploaded_at
            FROM {self._TASK_REPORTS_TABLE}
            WHERE task_id = ?
            ORDER BY uploaded_at DESC
            LIMIT 1
            """,
            (item["id"],),
        ).fetchone()
        item["latest_report"] = self._row_to_dict(report)
        item["attachments"] = self._list_task_attachments(conn, item["id"])
        item["attachments_count"] = len(item["attachments"])
        item["is_overdue"] = self._is_task_overdue(item.get("due_at"), item.get("status"))
        item.update(self._get_task_comment_summary(conn, task_id=item["id"], viewer_user_id=viewer_user_id))
        item["reviewer_full_name"] = _normalize_text(item.get("reviewer_full_name"))
        checklist_items = self._normalize_checklist_items(item.get("checklist_items"))
        item["checklist_items"] = checklist_items
        item["checklist_total"] = len(checklist_items)
        item["checklist_done"] = sum(1 for checklist_item in checklist_items if bool(checklist_item.get("done")))
        project = self._get_task_project(conn, item.get("project_id"))
        task_object = self._get_task_object(conn, item.get("object_id"))
        item["project_id"] = _normalize_text(item.get("project_id")) or None
        item["project_name"] = _normalize_text(project.get("name")) if project else ""
        item["object_id"] = _normalize_text(item.get("object_id")) or None
        item["object_name"] = _normalize_text(task_object.get("name")) if task_object else ""
        item["department_id"] = _normalize_text(item.get("department_id")) or None
        department = department_service.get_department(item["department_id"]) if item["department_id"] else None
        item["department_name"] = _normalize_text((department or {}).get("name"))
        item["visibility_scope"] = normalize_visibility_scope(item.get("visibility_scope"), default=VISIBILITY_PRIVATE)
        item["protocol_date"] = self._normalize_protocol_date(item.get("protocol_date")) or self._normalize_protocol_date(item.get("created_at"))
        completed_at, completed_at_source = self._derive_completed_tracking(item)
        item["completed_at"] = completed_at
        item["completed_at_source"] = completed_at_source
        item["completed_on_time"] = self._completed_on_time(
            completed_at=completed_at,
            due_at=item.get("due_at"),
            status=item.get("status"),
        )
        item["done_without_due"] = (
            _normalize_text(item.get("status")).lower() == "done"
            and bool(completed_at)
            and self._parse_iso_datetime(item.get("due_at")) is None
        )
        item["observer_user_ids"] = self._normalize_observer_user_ids(item.get("observer_user_ids"))
        self._enrich_task_assignee_fields(item)
        return self._enrich_task_observer_fields(item)

    def _announcement_users_for_roles(self, roles: list[str]) -> list[dict[str, Any]]:
        allowed_roles = {item for item in self._unique_texts(roles) if item}
        if not allowed_roles:
            return []
        return [row for row in self._active_users() if _normalize_text(row.get("role")).lower() in allowed_roles]

    def _announcement_recipient_users(self, announcement: dict[str, Any]) -> list[dict[str, Any]]:
        users = self._active_users()
        author_user_id = self._as_int(announcement.get("author_user_id"))
        audience_scope = _normalize_text(announcement.get("audience_scope"), "all").lower()
        if audience_scope == "roles":
            audience_roles = self._unique_texts(self._json_load_list(announcement.get("audience_roles")))
            recipients = [row for row in users if _normalize_text(row.get("role")).lower() in set(audience_roles)]
        elif audience_scope == "users":
            audience_user_ids = set(self._unique_ints(self._json_load_list(announcement.get("audience_user_ids"))))
            recipients = [row for row in users if self._as_int(row.get("id")) in audience_user_ids]
        else:
            recipients = users
        return [row for row in recipients if self._as_int(row.get("id")) != author_user_id]

    def _announcement_is_visible_to_user(self, announcement: dict[str, Any], *, user_id: int, is_admin: bool = False) -> bool:
        normalized_user_id = self._as_int(user_id)
        if normalized_user_id <= 0:
            return False
        if is_admin or normalized_user_id == self._as_int(announcement.get("author_user_id")):
            return True
        if _normalize_text(announcement.get("status"), "published").lower() != "published":
            return False
        published_from = self._parse_iso_datetime(announcement.get("published_from"))
        expires_at = self._parse_iso_datetime(announcement.get("expires_at"))
        now_utc = datetime.now(timezone.utc)
        if self._as_int(announcement.get("is_active"), 1) != 1:
            return False
        if published_from and published_from > now_utc:
            return False
        if expires_at and expires_at <= now_utc:
            return False
        audience_scope = _normalize_text(announcement.get("audience_scope"), "all").lower()
        # Fast paths: avoid building the full recipient list (O(users)) on every row.
        if audience_scope == "all":
            return True
        if audience_scope == "users":
            audience_user_ids = set(self._unique_ints(self._json_load_list(announcement.get("audience_user_ids"))))
            return normalized_user_id in audience_user_ids
        if audience_scope == "roles":
            audience_roles = {
                _normalize_text(role).lower()
                for role in self._unique_texts(self._json_load_list(announcement.get("audience_roles")))
            }
            if not audience_roles:
                return False
            viewer = self._users_by_id().get(normalized_user_id) or {}
            return _normalize_text(viewer.get("role")).lower() in audience_roles
        return normalized_user_id in {
            self._as_int(item.get("id"))
            for item in self._announcement_recipient_users(announcement)
        }

    def _announcement_recipients_summary(self, announcement: dict[str, Any]) -> str:
        audience_scope = _normalize_text(announcement.get("audience_scope"), "all").lower()
        if audience_scope == "roles":
            roles = self._unique_texts(self._json_load_list(announcement.get("audience_roles")))
            if not roles:
                return "Для ролей"
            return ", ".join(role.title() for role in roles)
        if audience_scope == "users":
            users_by_id = self._users_by_id()
            labels = [
                _normalize_text(users_by_id.get(user_id, {}).get("full_name"))
                or _normalize_text(users_by_id.get(user_id, {}).get("username"))
                for user_id in self._unique_ints(self._json_load_list(announcement.get("audience_user_ids")))
                if user_id in users_by_id
            ]
            if not labels:
                return "Адресная"
            if len(labels) > 3:
                return ", ".join(labels[:3]) + f" +{len(labels) - 3}"
            return ", ".join(labels)
        return "Для всех"

    def _load_announcement_reads_for_user(
        self,
        conn: sqlite3.Connection,
        *,
        user_id: int,
    ) -> dict[str, Any]:
        rows = conn.execute(
            f"""
            SELECT announcement_id, seen_version, acknowledged_version, acknowledged_at, read_at
            FROM {self._ANN_READS_TABLE}
            WHERE user_id = ?
            """,
            (int(user_id),),
        ).fetchall()
        result: dict[str, Any] = {}
        for row in rows:
            announcement_id = _normalize_text(row["announcement_id"] if not isinstance(row, dict) else row.get("announcement_id"))
            if announcement_id:
                result[announcement_id] = row
        return result

    def _load_announcement_attachment_counts(self, conn: sqlite3.Connection) -> dict[str, int]:
        rows = conn.execute(
            f"""
            SELECT announcement_id, COUNT(*) AS c
            FROM {self._ANN_ATTACH_TABLE}
            GROUP BY announcement_id
            """
        ).fetchall()
        result: dict[str, int] = {}
        for row in rows:
            announcement_id = _normalize_text(row["announcement_id"] if not isinstance(row, dict) else row.get("announcement_id"))
            if announcement_id:
                result[announcement_id] = self._as_int(row["c"] if not isinstance(row, dict) else row.get("c"))
        return result

    def _load_announcement_attachments_by_announcement(
        self,
        conn: sqlite3.Connection,
    ) -> dict[str, list[dict[str, Any]]]:
        rows = conn.execute(
            f"""
            SELECT id, announcement_id, file_name, file_mime, file_size,
                   uploaded_by_user_id, uploaded_by_username, uploaded_at, sort_order, is_cover
            FROM {self._ANN_ATTACH_TABLE}
            ORDER BY sort_order ASC, uploaded_at ASC
            """
        ).fetchall()
        result: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            item = self._attachment_row_to_dict(row)
            announcement_id = _normalize_text(item.get("announcement_id"))
            if announcement_id:
                result.setdefault(announcement_id, []).append(item)
        return result

    @staticmethod
    def _announcement_attachment_is_image(item: dict[str, Any]) -> bool:
        mime = _normalize_text(item.get("file_mime")).lower()
        if mime.startswith("image/"):
            return True
        return Path(_normalize_text(item.get("file_name"))).suffix.lower() in {
            ".avif",
            ".gif",
            ".jpeg",
            ".jpg",
            ".png",
            ".webp",
        }

    def _load_announcement_cover_attachments(self, conn: sqlite3.Connection) -> dict[str, dict[str, Any]]:
        rows = conn.execute(
            f"""
            SELECT id, announcement_id, file_name, file_mime, file_size,
                   uploaded_by_user_id, uploaded_by_username, uploaded_at, sort_order, is_cover
            FROM {self._ANN_ATTACH_TABLE}
            ORDER BY is_cover DESC, sort_order ASC, uploaded_at ASC
            """
        ).fetchall()
        result: dict[str, dict[str, Any]] = {}
        for row in rows:
            item = self._attachment_row_to_dict(row)
            announcement_id = _normalize_text(item.get("announcement_id"))
            if announcement_id and announcement_id not in result and self._announcement_attachment_is_image(item):
                result[announcement_id] = item
        return result

    def _load_announcement_social_state(
        self,
        conn: sqlite3.Connection,
        *,
        viewer_user_id: int,
    ) -> tuple[dict[str, dict[str, int]], dict[str, int], dict[str, str], set[str]]:
        reaction_rows = conn.execute(
            f"SELECT announcement_id, reaction_type, COUNT(*) AS c FROM {self._ANN_REACTIONS_TABLE} GROUP BY announcement_id, reaction_type"
        ).fetchall()
        comment_rows = conn.execute(
            f"SELECT announcement_id, COUNT(*) AS c FROM {self._ANN_COMMENTS_TABLE} WHERE deleted_at IS NULL GROUP BY announcement_id"
        ).fetchall()
        viewer_rows = conn.execute(
            f"SELECT announcement_id, reaction_type FROM {self._ANN_REACTIONS_TABLE} WHERE user_id = ?",
            (self._as_int(viewer_user_id),),
        ).fetchall()
        bookmark_rows = conn.execute(
            f"SELECT announcement_id FROM {self._ANN_BOOKMARKS_TABLE} WHERE user_id = ?",
            (self._as_int(viewer_user_id),),
        ).fetchall()
        reactions: dict[str, dict[str, int]] = {}
        for row in reaction_rows:
            announcement_id = _normalize_text(row["announcement_id"])
            reaction_type = _normalize_text(row["reaction_type"]).lower()
            if announcement_id and reaction_type in self._REACTION_TYPES:
                reactions.setdefault(announcement_id, {})[reaction_type] = self._as_int(row["c"])
        comments = {
            _normalize_text(row["announcement_id"]): self._as_int(row["c"])
            for row in comment_rows
            if _normalize_text(row["announcement_id"])
        }
        viewer_reactions = {
            _normalize_text(row["announcement_id"]): _normalize_text(row["reaction_type"]).lower()
            for row in viewer_rows
            if _normalize_text(row["announcement_id"])
        }
        bookmarks = {
            _normalize_text(row["announcement_id"])
            for row in bookmark_rows
            if _normalize_text(row["announcement_id"])
        }
        return reactions, comments, viewer_reactions, bookmarks

    def _load_announcement_taxonomy_state(
        self,
        conn: sqlite3.Connection,
    ) -> tuple[dict[str, dict[str, Any]], dict[str, list[dict[str, Any]]]]:
        category_rows = conn.execute(
            f"""SELECT a.id AS announcement_id, c.id, c.name, c.slug
                FROM {self._ANN_TABLE} a
                JOIN {self._ANN_CATEGORIES_TABLE} c ON c.id = a.category_id"""
        ).fetchall()
        tag_rows = conn.execute(
            f"""SELECT l.announcement_id, t.id, t.name, t.slug
                FROM {self._ANN_TAG_LINKS_TABLE} l
                JOIN {self._ANN_TAGS_TABLE} t ON t.id = l.tag_id
                ORDER BY t.name ASC"""
        ).fetchall()
        categories = {
            _normalize_text(row["announcement_id"]): {
                "id": _normalize_text(row["id"]),
                "name": _normalize_text(row["name"]),
                "slug": _normalize_text(row["slug"]),
            }
            for row in category_rows
        }
        tags: dict[str, list[dict[str, Any]]] = {}
        for row in tag_rows:
            announcement_id = _normalize_text(row["announcement_id"])
            tags.setdefault(announcement_id, []).append({
                "id": _normalize_text(row["id"]),
                "name": _normalize_text(row["name"]),
                "slug": _normalize_text(row["slug"]),
            })
        return categories, tags

    def _load_announcement_polls(
        self,
        conn: sqlite3.Connection,
        *,
        viewer_user_id: int,
    ) -> dict[str, dict[str, Any]]:
        poll_rows = conn.execute(
            f"SELECT * FROM {self._ANN_POLLS_TABLE}"
        ).fetchall()
        if not poll_rows:
            return {}
        option_rows = conn.execute(
            f"""SELECT o.id, o.poll_id, o.text, o.sort_order, COUNT(v.user_id) AS votes_count
                FROM {self._ANN_POLL_OPTIONS_TABLE} o
                LEFT JOIN {self._ANN_POLL_VOTES_TABLE} v ON v.option_id = o.id
                GROUP BY o.id, o.poll_id, o.text, o.sort_order
                ORDER BY o.poll_id, o.sort_order, o.id"""
        ).fetchall()
        viewer_rows = conn.execute(
            f"SELECT poll_id, option_id FROM {self._ANN_POLL_VOTES_TABLE} WHERE user_id = ?",
            (self._as_int(viewer_user_id),),
        ).fetchall()
        voter_rows = conn.execute(
            f"SELECT poll_id, COUNT(DISTINCT user_id) AS c FROM {self._ANN_POLL_VOTES_TABLE} GROUP BY poll_id"
        ).fetchall()
        viewer_votes: dict[str, set[str]] = {}
        for row in viewer_rows:
            viewer_votes.setdefault(_normalize_text(row["poll_id"]), set()).add(_normalize_text(row["option_id"]))
        voter_counts = {_normalize_text(row["poll_id"]): self._as_int(row["c"]) for row in voter_rows}
        options: dict[str, list[dict[str, Any]]] = {}
        for row in option_rows:
            poll_id = _normalize_text(row["poll_id"])
            option_id = _normalize_text(row["id"])
            options.setdefault(poll_id, []).append({
                "id": option_id,
                "text": _normalize_text(row["text"]),
                "sort_order": self._as_int(row["sort_order"]),
                "votes_count": self._as_int(row["votes_count"]),
                "viewer_voted": option_id in viewer_votes.get(poll_id, set()),
            })
        now = datetime.now(timezone.utc)
        result: dict[str, dict[str, Any]] = {}
        for row in poll_rows:
            item = dict(row)
            poll_id = _normalize_text(item.get("id"))
            poll_options = options.get(poll_id, [])
            closes_at = self._parse_iso_datetime(item.get("closes_at"))
            viewer_option_ids = sorted(viewer_votes.get(poll_id, set()))
            result[_normalize_text(item.get("announcement_id"))] = {
                "id": poll_id,
                "question": _normalize_text(item.get("question")),
                "allows_multiple": bool(self._as_int(item.get("allows_multiple"))),
                "is_anonymous": bool(self._as_int(item.get("is_anonymous"))),
                "closes_at": _normalize_text(item.get("closes_at")) or None,
                "is_closed": bool(closes_at and closes_at <= now),
                "options": poll_options,
                "viewer_option_ids": viewer_option_ids,
                "has_voted": bool(viewer_option_ids),
                "total_votes": sum(self._as_int(option.get("votes_count")) for option in poll_options),
                "total_voters": voter_counts.get(poll_id, 0),
            }
        return result

    def _build_announcement_item(
        self,
        conn: sqlite3.Connection,
        announcement_row: sqlite3.Row | dict[str, Any],
        *,
        viewer_user_id: int,
        is_admin: bool = False,
        include_body: bool = True,
        include_hidden_for_manager: bool = False,
        read_row: sqlite3.Row | dict[str, Any] | None = None,
        attachments: list[dict[str, Any]] | None = None,
        attachments_count: int | None = None,
        include_attachments: bool = True,
        likes_count: int = 0,
        comments_count: int = 0,
        viewer_has_liked: bool = False,
        reaction_counts: dict[str, int] | None = None,
        viewer_reaction: str = "",
        viewer_bookmarked: bool = False,
        category: dict[str, Any] | None = None,
        tags: list[dict[str, Any]] | None = None,
        cover_attachment: dict[str, Any] | None = None,
        poll: dict[str, Any] | None = None,
    ) -> Optional[dict[str, Any]]:
        item = dict(announcement_row)
        normalized_viewer_id = self._as_int(viewer_user_id)
        can_manage = bool(is_admin or normalized_viewer_id == self._as_int(item.get("author_user_id")))
        if not self._announcement_is_visible_to_user(item, user_id=normalized_viewer_id, is_admin=bool(is_admin)):
            if not (include_hidden_for_manager and can_manage):
                return None
        current_version = max(1, self._as_int(item.get("version"), 1))
        announcement_id = _normalize_text(item.get("id"))
        resolved_read_row = read_row
        if resolved_read_row is None:
            resolved_read_row = conn.execute(
                f"""
                SELECT seen_version, acknowledged_version, acknowledged_at, read_at
                FROM {self._ANN_READS_TABLE}
                WHERE announcement_id = ? AND user_id = ?
                """,
                (announcement_id, normalized_viewer_id),
            ).fetchone()
        seen_version = current_version if normalized_viewer_id == self._as_int(item.get("author_user_id")) else self._as_int(resolved_read_row["seen_version"] if resolved_read_row else 0)
        acknowledged_version = current_version if normalized_viewer_id == self._as_int(item.get("author_user_id")) else self._as_int(resolved_read_row["acknowledged_version"] if resolved_read_row else 0)
        requires_ack = bool(self._as_int(item.get("requires_ack")))
        is_unread = seen_version < current_version
        is_updated = seen_version > 0 and seen_version < current_version
        is_ack_pending = requires_ack and acknowledged_version < current_version and normalized_viewer_id != self._as_int(item.get("author_user_id"))
        if include_attachments:
            resolved_attachments = (
                attachments
                if attachments is not None
                else self._list_announcement_attachments(conn, announcement_id)
            )
        else:
            resolved_attachments = []
        resolved_attachments_count = (
            self._as_int(attachments_count)
            if attachments_count is not None
            else len(resolved_attachments)
        )
        pinned_until = self._parse_iso_datetime(item.get("pinned_until"))
        now_utc = datetime.now(timezone.utc)
        item["audience_scope"] = _normalize_text(item.get("audience_scope"), "all").lower()
        item["audience_roles"] = self._unique_texts(self._json_load_list(item.get("audience_roles")))
        item["audience_user_ids"] = self._unique_ints(self._json_load_list(item.get("audience_user_ids")))
        item["requires_ack"] = requires_ack
        item["is_pinned"] = bool(self._as_int(item.get("is_pinned")))
        item["is_active"] = bool(self._as_int(item.get("is_active"), 1))
        item["status"] = _normalize_text(item.get("status"), "published").lower()
        item["comments_enabled"] = bool(self._as_int(item.get("comments_enabled"), 1))
        item["reactions_enabled"] = bool(self._as_int(item.get("reactions_enabled"), 1))
        item["is_pinned_active"] = bool(item["is_pinned"] and (pinned_until is None or pinned_until > now_utc))
        item["version"] = current_version
        item["seen_version"] = seen_version
        item["acknowledged_version"] = acknowledged_version
        item["acknowledged_at"] = _normalize_text(
            resolved_read_row["acknowledged_at"] if resolved_read_row else ""
        )
        item["is_unread"] = is_unread
        item["is_updated"] = is_updated
        item["is_ack_pending"] = is_ack_pending
        item["attachments_count"] = resolved_attachments_count
        normalized_reactions = {
            key: max(0, self._as_int((reaction_counts or {}).get(key)))
            for key in sorted(self._REACTION_TYPES)
            if self._as_int((reaction_counts or {}).get(key)) > 0
        }
        item["reaction_counts"] = normalized_reactions
        item["reactions_count"] = sum(normalized_reactions.values())
        item["viewer_reaction"] = _normalize_text(viewer_reaction).lower() or None
        item["likes_count"] = normalized_reactions.get("like", max(0, self._as_int(likes_count)))
        item["comments_count"] = max(0, self._as_int(comments_count))
        item["viewer_has_liked"] = item["viewer_reaction"] == "like" or bool(viewer_has_liked)
        item["viewer_bookmarked"] = bool(viewer_bookmarked)
        item["category"] = dict(category) if isinstance(category, dict) else None
        item["tags"] = list(tags or [])
        item["cover_attachment"] = dict(cover_attachment) if isinstance(cover_attachment, dict) else None
        resolved_poll = poll
        if resolved_poll is None:
            resolved_poll = self._load_announcement_polls(conn, viewer_user_id=normalized_viewer_id).get(announcement_id, {})
        item["poll"] = dict(resolved_poll) if resolved_poll else None
        item["recipients_summary"] = self._announcement_recipients_summary(item)
        item["is_targeted_to_viewer"] = item["audience_scope"] != "all" and not can_manage
        item["can_manage"] = can_manage
        if include_body:
            item["attachments"] = resolved_attachments
        else:
            item.pop("body", None)
        return item

    def _store_attachment_file(
        self,
        *,
        root: Path,
        parent_id: str,
        attachment_id: str,
        file_name: str,
        file_bytes: bytes,
    ) -> tuple[str, str, int]:
        safe_name = _safe_file_name(file_name or "file.bin")
        parent_dir = root / parent_id
        parent_dir.mkdir(parents=True, exist_ok=True)
        full_path = parent_dir / f"{attachment_id}_{safe_name}"
        full_path.write_bytes(file_bytes or b"")
        rel_path = str(full_path.relative_to(self.data_dir)).replace("\\", "/")
        return safe_name, rel_path, len(file_bytes or b"")

    def _remove_relative_files(self, rel_paths: list[str]) -> None:
        for rel_path in rel_paths:
            normalized_rel = _normalize_text(rel_path)
            if not normalized_rel:
                continue
            abs_path = (self.data_dir / normalized_rel).resolve()
            try:
                abs_path.relative_to(self.data_dir.resolve())
            except Exception:
                continue
            try:
                if abs_path.exists() and abs_path.is_file():
                    abs_path.unlink()
            except Exception:
                continue

    @staticmethod
    def _remove_dir_quiet(path: Path) -> None:
        try:
            if path.exists() and path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
        except Exception:
            return

    def _list_announcement_attachments(self, conn: sqlite3.Connection, announcement_id: str) -> list[dict[str, Any]]:
        rows = conn.execute(
            f"""
            SELECT id, announcement_id, file_name, file_mime, file_size, uploaded_by_user_id, uploaded_by_username, uploaded_at, sort_order, is_cover
            FROM {self._ANN_ATTACH_TABLE}
            WHERE announcement_id = ?
            ORDER BY sort_order ASC, uploaded_at ASC
            """,
            (announcement_id,),
        ).fetchall()
        return [self._attachment_row_to_dict(row) for row in rows]

    def _list_task_attachments(self, conn: sqlite3.Connection, task_id: str) -> list[dict[str, Any]]:
        rows = conn.execute(
            f"""
            SELECT id, task_id, scope, file_name, file_mime, file_size, uploaded_by_user_id, uploaded_by_username, uploaded_at
            FROM {self._TASK_ATTACH_TABLE}
            WHERE task_id = ?
            ORDER BY uploaded_at DESC
            """,
            (task_id,),
        ).fetchall()
        return [self._attachment_row_to_dict(row) for row in rows]

    def _insert_task_attachment(
        self,
        *,
        conn: sqlite3.Connection,
        attachment_id: Optional[str] = None,
        task_id: str,
        scope: str,
        file_name: str,
        file_path: str,
        file_mime: Optional[str],
        file_size: int,
        user_id: int,
        username: str,
        uploaded_at: str,
    ) -> str:
        normalized_attachment_id = _normalize_text(attachment_id) or str(uuid.uuid4())
        conn.execute(
            f"""
            INSERT INTO {self._TASK_ATTACH_TABLE}
            (id, task_id, scope, file_name, file_path, file_mime, file_size, uploaded_by_user_id, uploaded_by_username, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                normalized_attachment_id,
                task_id,
                _normalize_text(scope, "task"),
                _normalize_text(file_name, "file.bin"),
                _normalize_text(file_path),
                _normalize_text(file_mime),
                self._as_int(file_size),
                self._as_int(user_id),
                _normalize_text(username),
                uploaded_at,
            ),
        )
        return normalized_attachment_id

    @staticmethod
    def _task_email_recipient_email(user: dict[str, Any] | None) -> str:
        if not isinstance(user, dict):
            return ""
        return _normalize_text(user.get("mailbox_email")) or _normalize_text(user.get("email"))

    def _task_email_url(self, task_id: Any) -> str:
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return ""
        path = f"/tasks?task={quote(normalized_id)}"
        base_url = _normalize_text(task_email_service.app_url()).rstrip("/")
        return f"{base_url}{path}" if base_url else path

    def _format_task_email_due(self, due_at: Any) -> str:
        parsed = self._parse_iso_datetime(due_at)
        if parsed is None:
            return "Без срока"
        return parsed.astimezone().strftime("%d.%m.%Y %H:%M")

    def _build_task_email_content(
        self,
        *,
        event_type: str,
        task: dict[str, Any],
        notification_title: str = "",
        notification_body: str = "",
    ) -> tuple[str, str, str]:
        task_id = _normalize_text(task.get("id"))
        link = self._task_email_url(task_id)
        return build_task_email_content(
            event_type=event_type,
            task=task,
            link=link,
            notification_title=notification_title,
            notification_body=notification_body,
            format_due=self._format_task_email_due,
        )

    def _queue_task_email_event(
        self,
        conn: sqlite3.Connection,
        *,
        recipient_user_id: int,
        event_type: str,
        task_id: str,
        notification_title: str = "",
        notification_body: str = "",
        dedupe_hint: str = "",
        task: Optional[dict[str, Any]] = None,
    ) -> bool:
        normalized_event = _normalize_text(event_type).lower()
        normalized_task_id = _normalize_text(task_id)
        normalized_recipient_id = self._as_int(recipient_user_id)
        if (
            not task_email_service.is_enabled()
            or normalized_event not in self._TASK_EMAIL_EVENT_TYPES
            or normalized_recipient_id <= 0
            or not normalized_task_id
        ):
            return False
        if not notification_preferences_service.is_enabled(user_id=normalized_recipient_id, channel="task_email"):
            return False

        user = user_service.get_by_id(normalized_recipient_id)
        recipient_email = self._task_email_recipient_email(user)
        if not task_email_service.is_valid_recipient(recipient_email):
            return False

        if task is None:
            row = conn.execute(
                f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?",
                (normalized_task_id,),
            ).fetchone()
            if row is None:
                return False
            task = self._task_with_latest_report(conn, row, viewer_user_id=normalized_recipient_id)
        subject, body_text, body_html = self._build_task_email_content(
            event_type=normalized_event,
            task=task,
            notification_title=notification_title,
            notification_body=notification_body,
        )
        dedupe_tail = _normalize_text(dedupe_hint) or _normalize_text(task.get("updated_at")) or _normalize_text(task.get("created_at"))
        dedupe_key = f"{normalized_event}:{normalized_task_id}:{normalized_recipient_id}:{dedupe_tail}"
        if normalized_event == "task.deadline_soon":
            dedupe_key = f"{normalized_event}:{normalized_task_id}:{normalized_recipient_id}"
        return self._enqueue_task_email(
            conn,
            dedupe_key=dedupe_key,
            task_id=normalized_task_id,
            recipient_user_id=normalized_recipient_id,
            recipient_email=recipient_email,
            event_type=normalized_event,
            subject=subject,
            body_text=body_text,
            body_html=body_html,
        )

    def _queue_task_email_notifications(
        self,
        conn: sqlite3.Connection,
        *,
        recipient_user_ids: set[int],
        skip_user_ids: set[int] | None = None,
        event_type: str,
        title: str,
        body: str,
        task_id: str,
        dedupe_hint: str = "",
    ) -> None:
        skipped = {self._as_int(item) for item in (skip_user_ids or set()) if self._as_int(item) > 0}
        recipients = [
            recipient_user_id
            for recipient_user_id in {self._as_int(item) for item in recipient_user_ids if self._as_int(item) > 0}
            if recipient_user_id not in skipped
        ]
        if not recipients:
            return
        normalized_task_id = _normalize_text(task_id)
        row = conn.execute(
            f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?",
            (normalized_task_id,),
        ).fetchone()
        if row is None:
            return
        # One enrich per event (not per recipient) — email body does not need viewer-specific fields.
        task_payload = self._task_with_latest_report(conn, row, viewer_user_id=None)
        queued = False
        for recipient_user_id in recipients:
            queued = self._queue_task_email_event(
                conn,
                recipient_user_id=recipient_user_id,
                event_type=event_type,
                task_id=normalized_task_id,
                notification_title=title,
                notification_body=body,
                dedupe_hint=dedupe_hint,
                task=task_payload,
            ) or queued
        if queued:
            self._schedule_task_email_outbox_dispatch()

    def _queue_overdue_digest_email(
        self,
        conn: sqlite3.Connection,
        *,
        recipient_user_id: int,
        tasks: list[dict[str, Any]],
        digest_date: str,
    ) -> bool:
        normalized_recipient_id = self._as_int(recipient_user_id)
        if (
            not task_email_service.is_enabled()
            or normalized_recipient_id <= 0
            or not tasks
            or not notification_preferences_service.is_enabled(user_id=normalized_recipient_id, channel="task_email")
        ):
            return False
        user = user_service.get_by_id(normalized_recipient_id)
        recipient_email = self._task_email_recipient_email(user)
        if not task_email_service.is_valid_recipient(recipient_email):
            return False

        count = len(tasks)
        tasks_page_url = f"{_normalize_text(task_email_service.app_url()).rstrip('/')}/tasks" if task_email_service.app_url() else ""
        subject, body_text, body_html = build_overdue_digest_email(
            tasks=tasks,
            task_url=self._task_email_url,
            format_due=self._format_task_email_due,
            tasks_page_url=tasks_page_url,
        )
        queued = self._enqueue_task_email(
            conn,
            dedupe_key=f"task.overdue_digest:{normalized_recipient_id}:{digest_date}",
            task_id="",
            recipient_user_id=normalized_recipient_id,
            recipient_email=recipient_email,
            event_type="task.overdue_digest",
            subject=subject,
            body_text=body_text,
            body_html=body_html,
        )
        if queued:
            self._schedule_task_email_outbox_dispatch()
        return queued

    def _create_notification(
        self,
        *,
        recipient_user_id: Optional[int],
        event_type: str,
        title: str,
        body: str = "",
        entity_type: str = "",
        entity_id: str = "",
        conn: Optional[sqlite3.Connection] = None,
    ) -> str:
        now_iso = _utc_now_iso()
        notification_id = str(uuid.uuid4())
        row = (
            notification_id,
            recipient_user_id,
            _normalize_text(event_type),
            _normalize_text(title),
            _normalize_text(body),
            _normalize_text(entity_type),
            _normalize_text(entity_id),
            now_iso,
        )
        notification = {
            "id": notification_id,
            "recipient_user_id": int(recipient_user_id or 0),
            "event_type": row[2],
            "title": row[3],
            "body": row[4],
            "entity_type": row[5],
            "entity_id": row[6],
            "created_at": now_iso,
            "unread": 1,
        }
        if conn is None:
            with self._lock, self._connect() as local_conn:
                local_conn.execute(
                    f"""
                    INSERT INTO {self._NOTIF_TABLE}
                    (id, recipient_user_id, event_type, title, body, entity_type, entity_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    row,
                )
                self._register_notification_realtime_after_commit(local_conn, notification)
                local_conn.commit()
        else:
            conn.execute(
                f"""
                INSERT INTO {self._NOTIF_TABLE}
                (id, recipient_user_id, event_type, title, body, entity_type, entity_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                row,
            )
            self._register_notification_realtime_after_commit(conn, notification)
        self._invalidate_unread_counts_cache(int(recipient_user_id))
        normalized_entity_type = _normalize_text(entity_type).lower()
        if int(recipient_user_id or 0) > 0 and normalized_entity_type != "chat":
            channel = "tasks" if normalized_entity_type == "task" else ("announcements" if normalized_entity_type == "announcement" else "system")
            if notification_preferences_service.is_enabled(user_id=int(recipient_user_id), channel=channel):
                route = "/"
                if channel == "tasks":
                    route = "/tasks"
                elif channel == "announcements":
                    announcement_entity, _, comment_entity = _normalize_text(entity_id).partition("#")
                    route = f"/feed?post={announcement_entity}" if announcement_entity else "/feed"
                    if comment_entity:
                        route += f"#feed-comment-{comment_entity}"
                push_job = {
                    "recipient_user_id": int(recipient_user_id),
                    "title": _normalize_text(title) or "Новое уведомление",
                    "body": _normalize_text(body) or _normalize_text(title) or "Откройте приложение, чтобы посмотреть подробности.",
                    "channel": channel,
                    "route": route,
                    "tag": f"hub:{notification_id}",
                    "data": {
                        "notification_id": notification_id,
                        "entity_type": normalized_entity_type,
                        "entity_id": _normalize_text(entity_id),
                    },
                    "ttl": 12 * 60 * 60,
                }
                if self._defer_hub_push:
                    self._pending_hub_push_jobs.append(push_job)
                else:
                    try:
                        app_push_service.enqueue_notification(**push_job)
                    except Exception:
                        logger.warning(
                            "Failed to send hub push recipient_user_id=%s channel=%s notification_id=%s",
                            int(recipient_user_id),
                            channel,
                            notification_id,
                            exc_info=True,
                        )
        return notification_id

    @staticmethod
    def _register_notification_realtime_after_commit(conn: Any, notification: dict[str, Any]) -> bool:
        add_after_commit = getattr(conn, "add_after_commit", None)
        if not callable(add_after_commit):
            return False

        def _publish() -> None:
            from backend.realtime.hub import hub_realtime_publisher

            hub_realtime_publisher.publish_notification(dict(notification))

        add_after_commit(_publish)
        return True

    def create_notifications_batch(
        self,
        items: list[dict[str, Any]],
        *,
        conn: Optional[sqlite3.Connection] = None,
        commit_external: bool = True,
    ) -> int:
        """Insert many hub notifications in one round-trip. Used by chat fan-out."""
        rows: list[tuple[Any, ...]] = []
        notifications: list[dict[str, Any]] = []
        recipient_ids: list[int] = []
        now_iso = _utc_now_iso()
        for item in items:
            recipient_user_id = item.get("recipient_user_id")
            try:
                normalized_recipient = int(recipient_user_id) if recipient_user_id is not None else 0
            except Exception:
                normalized_recipient = 0
            if normalized_recipient <= 0:
                continue
            row = (
                _normalize_text(item.get("id")) or str(uuid.uuid4()),
                normalized_recipient,
                _normalize_text(item.get("event_type")),
                _normalize_text(item.get("title")),
                _normalize_text(item.get("body")),
                _normalize_text(item.get("entity_type")),
                _normalize_text(item.get("entity_id")),
                now_iso,
            )
            rows.append(row)
            notifications.append({
                "id": row[0],
                "recipient_user_id": normalized_recipient,
                "event_type": row[2],
                "title": row[3],
                "body": row[4],
                "entity_type": row[5],
                "entity_id": row[6],
                "created_at": now_iso,
                "unread": 1,
            })
            recipient_ids.append(normalized_recipient)
        if not rows:
            return 0

        # One multi-VALUES INSERT (not executemany): SqlAlchemyCompatConnection.executemany
        # loops per row and under chat storms that becomes N round-trips (~hundreds of ms each).
        values_sql = ", ".join(["(?, ?, ?, ?, ?, ?, ?, ?)"] * len(rows))
        flat_params: list[Any] = [value for row in rows for value in row]
        sql = f"""
            INSERT INTO {self._NOTIF_TABLE}
            (id, recipient_user_id, event_type, title, body, entity_type, entity_id, created_at)
            VALUES {values_sql}
            """
        if conn is None:
            with self._db_conn(write=True) as local_conn:
                local_conn.execute(sql, flat_params)
                for notification in notifications:
                    self._register_notification_realtime_after_commit(local_conn, notification)
                local_conn.commit()
        else:
            conn.execute(sql, flat_params)
            for notification in notifications:
                self._register_notification_realtime_after_commit(conn, notification)
            if commit_external:
                commit = getattr(conn, "commit", None)
                if callable(commit):
                    commit()

        unique_recipient_ids = set(recipient_ids)
        if len(unique_recipient_ids) > 100:
            self._invalidate_unread_counts_cache(None)
        else:
            for recipient_id in unique_recipient_ids:
                self._invalidate_unread_counts_cache(recipient_id)
        return len(rows)

    def _notification_exists(
        self,
        conn: sqlite3.Connection,
        *,
        recipient_user_id: Optional[int],
        event_type: str,
        entity_type: str,
        entity_id: str,
        created_on_date: str | None = None,
    ) -> bool:
        where = [
            "(recipient_user_id IS NULL OR recipient_user_id = ?)",
            "LOWER(event_type) = ?",
            "entity_type = ?",
            "entity_id = ?",
        ]
        params: list[Any] = [
            self._as_int(recipient_user_id),
            _normalize_text(event_type).lower(),
            _normalize_text(entity_type),
            _normalize_text(entity_id),
        ]
        if created_on_date:
            where.append("substr(created_at, 1, 10) = ?")
            params.append(_normalize_text(created_on_date))
        exists = conn.execute(
            f"SELECT id FROM {self._NOTIF_TABLE} WHERE {' AND '.join(where)} LIMIT 1",
            tuple(params),
        ).fetchone()
        return exists is not None

    def _create_task_notifications(
        self,
        conn: sqlite3.Connection,
        *,
        recipient_user_ids: set[int],
        skip_user_ids: set[int] | None = None,
        event_type: str,
        title: str,
        body: str,
        task_id: str,
        dedupe_hint: str = "",
    ) -> None:
        skipped = {self._as_int(item) for item in (skip_user_ids or set()) if self._as_int(item) > 0}
        for recipient_user_id in {self._as_int(item) for item in recipient_user_ids if self._as_int(item) > 0}:
            if recipient_user_id in skipped:
                continue
            self._create_notification(
                recipient_user_id=recipient_user_id,
                event_type=event_type,
                title=title,
                body=body,
                entity_type="task",
                entity_id=task_id,
                conn=conn,
            )
        self._queue_task_email_notifications(
            conn,
            recipient_user_ids=recipient_user_ids,
            skip_user_ids=skip_user_ids,
            event_type=event_type,
            title=title,
            body=body,
            task_id=task_id,
            dedupe_hint=dedupe_hint,
        )

    def _build_assignee_directory_row(
        self,
        row: dict[str, Any],
        *,
        include_department_id: bool = True,
    ) -> dict[str, Any]:
        return {
            "id": self._as_int(row.get("id")),
            "username": _normalize_text(row.get("username")),
            "full_name": _normalize_text(row.get("full_name")) or _normalize_text(row.get("username")),
            "role": _normalize_text(row.get("role"), "viewer"),
            "department": _normalize_text(row.get("department")),
            "department_id": (
                department_service.get_user_primary_department_id(row) or ""
            ) if include_department_id else "",
        }

    def _iter_assignee_source_rows(self, *, department_id: Optional[str] = None):
        from backend.services.ad_users_service import is_hub_service_account_login

        normalized_department_id = _normalize_text(department_id)
        for row in user_service.list_users():
            if not bool(row.get("is_active", True)):
                continue
            if is_hub_service_account_login(row.get("username")):
                continue
            if normalized_department_id and not (
                user_is_department_member(row, normalized_department_id)
                or user_is_department_manager(row, normalized_department_id)
            ):
                continue
            yield row

    @staticmethod
    def _user_row_search_text(row: dict[str, Any]) -> str:
        return " ".join(
            part
            for part in (
                _normalize_text(row.get("full_name")),
                _normalize_text(row.get("username")),
            )
            if part
        ).lower()

    def _build_assignees_list(self, *, department_id: Optional[str] = None) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = [
            self._build_assignee_directory_row(row, include_department_id=True)
            for row in self._iter_assignee_source_rows(department_id=department_id)
        ]
        out.sort(key=lambda item: (item.get("full_name") or "", item.get("username") or ""))
        return out

    def _build_controllers_list(self, *, department_id: Optional[str] = None) -> list[dict[str, Any]]:
        from backend.services.ad_users_service import is_hub_service_account_login

        normalized_department_id = _normalize_text(department_id)
        users = user_service.list_users()
        membership_map = department_service.get_user_department_role_map(
            [self._as_int(row.get("id")) for row in users]
        )
        out: list[dict[str, Any]] = []
        for row in users:
            if is_hub_service_account_login(row.get("username")):
                continue
            user_id = self._as_int(row.get("id"))
            role_memberships = membership_map.get(user_id, {})
            manager_department_ids = role_memberships.get(DEPARTMENT_MANAGER_ROLE, set())
            member_department_ids = role_memberships.get(DEPARTMENT_MEMBER_ROLE, set())
            is_any_department_manager = bool(manager_department_ids)
            is_target_department_manager = bool(
                normalized_department_id and normalized_department_id in manager_department_ids
            )
            if not (self._user_can_review_tasks(row) or is_any_department_manager or is_target_department_manager):
                continue
            if normalized_department_id and not (
                str(row.get("role") or "").strip().lower() == "admin"
                or is_target_department_manager
                or self._user_can_review_tasks(row)
            ):
                continue
            primary_department_id = (
                sorted(member_department_ids)[0]
                if member_department_ids
                else department_id_from_name(row.get("department")) or ""
            )
            out.append(
                {
                    "id": user_id,
                    "username": _normalize_text(row.get("username")),
                    "full_name": _normalize_text(row.get("full_name")) or _normalize_text(row.get("username")),
                    "role": _normalize_text(row.get("role"), "viewer"),
                    "department": _normalize_text(row.get("department")),
                    "department_id": primary_department_id,
                }
            )
        out.sort(key=lambda item: (item.get("full_name") or "", item.get("username") or ""))
        return out

    def list_assignees(self, *, department_id: Optional[str] = None) -> list[dict[str, Any]]:
        normalized_department_id = _normalize_text(department_id)
        cache_key = f"assignees:{normalized_department_id or ''}"
        return self._get_cached_user_directory(
            cache_key,
            lambda: self._build_assignees_list(department_id=normalized_department_id or None),
        )

    def list_controllers(self, *, department_id: Optional[str] = None) -> list[dict[str, Any]]:
        normalized_department_id = _normalize_text(department_id)
        cache_key = f"controllers:{normalized_department_id or ''}"
        return self._get_cached_user_directory(
            cache_key,
            lambda: self._build_controllers_list(department_id=normalized_department_id or None),
        )

    def invalidate_user_directory_cache(self) -> None:
        with self._user_directory_cache_lock:
            self._user_directory_cache.clear()

    @staticmethod
    def _user_directory_search_text(row: dict[str, Any]) -> str:
        return " ".join(
            part
            for part in (
                _normalize_text(row.get("full_name")),
                _normalize_text(row.get("username")),
            )
            if part
        ).lower()

    def _filter_user_directory(
        self,
        items: list[dict[str, Any]],
        *,
        q: str = "",
        limit: int = 30,
    ) -> tuple[list[dict[str, Any]], int]:
        normalized_q = _normalize_text(q).lower()
        if not normalized_q:
            return [], len(items)
        tokens = [token for token in normalized_q.split() if token]
        if not tokens:
            return [], len(items)
        filtered: list[dict[str, Any]] = []
        for row in items:
            haystack = self._user_directory_search_text(row)
            if all(token in haystack for token in tokens):
                filtered.append(row)
        limited = max(1, min(int(limit or 30), 200))
        return filtered[:limited], len(filtered)

    def search_assignees(
        self,
        *,
        department_id: Optional[str] = None,
        q: str = "",
        limit: int = 30,
        ids: Optional[list[int]] = None,
    ) -> dict[str, Any]:
        limited = max(1, min(int(limit or 30), 200))
        if ids:
            id_set = {int(item) for item in ids if int(item) > 0}
            matched = [
                self._build_assignee_directory_row(row, include_department_id=False)
                for row in self._iter_assignee_source_rows(department_id=department_id)
                if int(row.get("id") or 0) in id_set
            ]
            matched.sort(key=lambda item: (item.get("full_name") or "", item.get("username") or ""))
            return {"items": matched, "total": len(matched), "limit": len(matched)}

        normalized_q = _normalize_text(q).lower()
        tokens = [token for token in normalized_q.split() if token]
        if not tokens:
            return {"items": [], "total": 0, "limit": limited}

        matched: list[dict[str, Any]] = []
        total = 0
        for row in self._iter_assignee_source_rows(department_id=department_id):
            haystack = self._user_row_search_text(row)
            if not all(token in haystack for token in tokens):
                continue
            total += 1
            if len(matched) < limited:
                matched.append(self._build_assignee_directory_row(row, include_department_id=False))

        matched.sort(key=lambda item: (item.get("full_name") or "", item.get("username") or ""))
        return {"items": matched, "total": total, "limit": limited}

    def list_announcement_recipients(
        self,
        *,
        q: str = "",
        limit: Optional[int] = None,
        user_ids: Optional[list[int]] = None,
    ) -> dict[str, Any]:
        all_users = self.list_assignees()
        normalized_q = _normalize_text(q).lower()
        normalized_limit = max(1, min(int(limit or 30), 200)) if limit is not None else None
        selected_ids = {self._as_int(value) for value in (user_ids or []) if self._as_int(value) > 0}
        selected_users = [row for row in all_users if self._as_int(row.get("id")) in selected_ids]
        selected_user_ids = {self._as_int(row.get("id")) for row in selected_users}

        if normalized_q:
            matched_users, total = self._filter_user_directory(
                all_users,
                q=normalized_q,
                limit=normalized_limit or 30,
            )
        elif normalized_limit is not None:
            matched_users = all_users[:normalized_limit]
            total = len(all_users)
        else:
            matched_users = all_users
            total = len(all_users)
        users = selected_users + [
            row for row in matched_users
            if self._as_int(row.get("id")) not in selected_user_ids
        ]
        roles: list[dict[str, str]] = []
        seen_roles: set[str] = set()
        for row in self._active_users():
            role_value = _normalize_text(row.get("role")).lower()
            if not role_value or role_value in seen_roles:
                continue
            seen_roles.add(role_value)
            roles.append({"value": role_value, "label": role_value.title()})
        roles.sort(key=lambda item: item["label"])
        return {
            "users": users,
            "roles": roles,
            "total": total,
            "limit": normalized_limit,
        }

    def list_task_projects(self, *, include_inactive: bool = False) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT *
                FROM {self._TASK_PROJECTS_TABLE}
                {'' if include_inactive else 'WHERE is_active = 1'}
                ORDER BY is_active DESC, name ASC, created_at DESC
                """
            ).fetchall()
            return [dict(row) for row in rows]

    def create_task_project(self, *, name: str, code: str = "", description: str = "", is_active: bool = True) -> dict[str, Any]:
        name_text = _normalize_text(name)
        if len(name_text) < 2:
            raise ValueError("Project name is required")
        now_iso = _utc_now_iso()
        project_id = str(uuid.uuid4())
        with self._lock, self._connect() as conn:
            duplicate = conn.execute(
                f"SELECT id FROM {self._TASK_PROJECTS_TABLE} WHERE LOWER(name) = ?",
                (name_text.lower(),),
            ).fetchone()
            if duplicate is not None:
                raise ValueError("Project already exists")
            conn.execute(
                f"""
                INSERT INTO {self._TASK_PROJECTS_TABLE}(id, name, code, description, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    project_id,
                    name_text,
                    _normalize_text(code),
                    _normalize_text(description),
                    1 if bool(is_active) else 0,
                    now_iso,
                    now_iso,
                ),
            )
            conn.commit()
            row = conn.execute(f"SELECT * FROM {self._TASK_PROJECTS_TABLE} WHERE id = ?", (project_id,)).fetchone()
            return dict(row) if row else {}

    def update_task_project(self, project_id: str, payload: dict[str, Any]) -> Optional[dict[str, Any]]:
        normalized_id = _normalize_text(project_id)
        if not normalized_id:
            return None
        updates: list[str] = []
        params: list[Any] = []
        if "name" in payload:
            name_text = _normalize_text(payload.get("name"))
            if len(name_text) < 2:
                raise ValueError("Project name is required")
            updates.append("name = ?")
            params.append(name_text)
        if "code" in payload:
            updates.append("code = ?")
            params.append(_normalize_text(payload.get("code")))
        if "description" in payload:
            updates.append("description = ?")
            params.append(_normalize_text(payload.get("description")))
        if "is_active" in payload:
            updates.append("is_active = ?")
            params.append(1 if bool(payload.get("is_active")) else 0)
        if not updates:
            with self._lock, self._connect() as conn:
                row = conn.execute(f"SELECT * FROM {self._TASK_PROJECTS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
                return dict(row) if row else None
        updates.append("updated_at = ?")
        params.append(_utc_now_iso())
        params.append(normalized_id)
        with self._lock, self._connect() as conn:
            exists = self._get_task_project(conn, normalized_id)
            if not exists:
                return None
            conn.execute(f"UPDATE {self._TASK_PROJECTS_TABLE} SET {', '.join(updates)} WHERE id = ?", tuple(params))
            conn.commit()
            row = conn.execute(f"SELECT * FROM {self._TASK_PROJECTS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            return dict(row) if row else None

    def list_task_objects(self, *, project_ids: Optional[list[str]] = None, include_inactive: bool = False) -> list[dict[str, Any]]:
        normalized_project_ids = [_normalize_text(item) for item in (project_ids or []) if _normalize_text(item)]
        where_clauses: list[str] = []
        params: list[Any] = []
        if not include_inactive:
            where_clauses.append("is_active = 1")
        if normalized_project_ids:
            placeholders = ", ".join(["?"] * len(normalized_project_ids))
            where_clauses.append(f"project_id IN ({placeholders})")
            params.extend(normalized_project_ids)
        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT *
                FROM {self._TASK_OBJECTS_TABLE}
                {where_sql}
                ORDER BY is_active DESC, name ASC, created_at DESC
                """,
                tuple(params),
            ).fetchall()
            return [dict(row) for row in rows]

    def create_task_object(
        self,
        *,
        project_id: str,
        name: str,
        code: str = "",
        description: str = "",
        is_active: bool = True,
    ) -> dict[str, Any]:
        name_text = _normalize_text(name)
        project_text = _normalize_text(project_id)
        if not project_text:
            raise ValueError("project_id is required")
        if len(name_text) < 2:
            raise ValueError("Object name is required")
        now_iso = _utc_now_iso()
        object_id = str(uuid.uuid4())
        with self._lock, self._connect() as conn:
            project = self._get_task_project(conn, project_text)
            if not project:
                raise ValueError("Project is not available")
            duplicate = conn.execute(
                f"SELECT id FROM {self._TASK_OBJECTS_TABLE} WHERE project_id = ? AND LOWER(name) = ?",
                (project_text, name_text.lower()),
            ).fetchone()
            if duplicate is not None:
                raise ValueError("Object already exists in this project")
            conn.execute(
                f"""
                INSERT INTO {self._TASK_OBJECTS_TABLE}(id, project_id, name, code, description, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    object_id,
                    project_text,
                    name_text,
                    _normalize_text(code),
                    _normalize_text(description),
                    1 if bool(is_active) else 0,
                    now_iso,
                    now_iso,
                ),
            )
            conn.commit()
            row = conn.execute(f"SELECT * FROM {self._TASK_OBJECTS_TABLE} WHERE id = ?", (object_id,)).fetchone()
            return dict(row) if row else {}

    def update_task_object(self, object_id: str, payload: dict[str, Any]) -> Optional[dict[str, Any]]:
        normalized_id = _normalize_text(object_id)
        if not normalized_id:
            return None
        updates: list[str] = []
        params: list[Any] = []
        if "project_id" in payload:
            project_text = _normalize_text(payload.get("project_id"))
            if not project_text:
                raise ValueError("project_id is required")
            updates.append("project_id = ?")
            params.append(project_text)
        if "name" in payload:
            name_text = _normalize_text(payload.get("name"))
            if len(name_text) < 2:
                raise ValueError("Object name is required")
            updates.append("name = ?")
            params.append(name_text)
        if "code" in payload:
            updates.append("code = ?")
            params.append(_normalize_text(payload.get("code")))
        if "description" in payload:
            updates.append("description = ?")
            params.append(_normalize_text(payload.get("description")))
        if "is_active" in payload:
            updates.append("is_active = ?")
            params.append(1 if bool(payload.get("is_active")) else 0)
        if not updates:
            with self._lock, self._connect() as conn:
                row = conn.execute(f"SELECT * FROM {self._TASK_OBJECTS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
                return dict(row) if row else None
        updates.append("updated_at = ?")
        params.append(_utc_now_iso())
        params.append(normalized_id)
        with self._lock, self._connect() as conn:
            exists = self._get_task_object(conn, normalized_id)
            if not exists:
                return None
            if "project_id" in payload:
                project = self._get_task_project(conn, payload.get("project_id"))
                if not project:
                    raise ValueError("Project is not available")
            conn.execute(f"UPDATE {self._TASK_OBJECTS_TABLE} SET {', '.join(updates)} WHERE id = ?", tuple(params))
            conn.commit()
            row = conn.execute(f"SELECT * FROM {self._TASK_OBJECTS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            return dict(row) if row else None

    def _normalize_announcement_payload(self, payload: Optional[dict[str, Any]]) -> dict[str, Any]:
        source = payload or {}
        audience_scope = _normalize_text(source.get("audience_scope"), "all").lower()
        if audience_scope not in {"all", "roles", "users"}:
            audience_scope = "all"
        normalized = {
            "title": _normalize_text(source.get("title")),
            "preview": _normalize_text(source.get("preview")),
            "body": _normalize_text(source.get("body")),
            "priority": _normalize_text(source.get("priority"), "normal").lower(),
            "audience_scope": audience_scope,
            "audience_roles": self._unique_texts(source.get("audience_roles")),
            "audience_user_ids": self._unique_ints(source.get("audience_user_ids")),
            "requires_ack": bool(source.get("requires_ack")),
            "is_pinned": bool(source.get("is_pinned")),
            "pinned_until": _normalize_text(source.get("pinned_until")) or None,
            "published_from": _normalize_text(source.get("published_from")) or None,
            "expires_at": _normalize_text(source.get("expires_at")) or None,
            "is_active": source.get("is_active") is not False,
            "status": _normalize_text(source.get("status"), "published").lower(),
            "comments_enabled": source.get("comments_enabled") is not False,
            "reactions_enabled": source.get("reactions_enabled") is not False,
            "category_id": _normalize_text(source.get("category_id")) or None,
            "tags": self._unique_texts(source.get("tags")),
            "poll": self._normalize_announcement_poll_payload(source.get("poll")) if "poll" in source else None,
        }
        if normalized["priority"] not in {"low", "normal", "high"}:
            normalized["priority"] = "normal"
        if normalized["status"] not in self._ANNOUNCEMENT_STATUSES:
            normalized["status"] = "published"
        if normalized["audience_scope"] == "roles":
            normalized["audience_roles"] = self._unique_texts(normalized["audience_roles"])
            normalized["audience_user_ids"] = []
        elif normalized["audience_scope"] == "users":
            normalized["audience_user_ids"] = self._unique_ints(normalized["audience_user_ids"])
            normalized["audience_roles"] = []
        else:
            normalized["audience_roles"] = []
            normalized["audience_user_ids"] = []
        return normalized

    def _normalize_announcement_poll_payload(self, value: Any) -> dict[str, Any] | None:
        if value is None or value is False:
            return None
        if not isinstance(value, dict):
            raise ValueError("Poll payload must be an object")
        raw_options = value.get("options") if isinstance(value.get("options"), list) else []
        options: list[str] = []
        for raw_option in raw_options[:10]:
            option_text = _normalize_text(raw_option.get("text") if isinstance(raw_option, dict) else raw_option)
            options.append(option_text[:160])
        return {
            "question": _normalize_text(value.get("question"))[:300],
            "options": options,
            "allows_multiple": bool(value.get("allows_multiple")),
            "is_anonymous": bool(value.get("is_anonymous")),
            "closes_at": _normalize_text(value.get("closes_at")) or None,
        }

    def _sync_announcement_poll(
        self,
        conn: sqlite3.Connection,
        *,
        announcement_id: str,
        poll: dict[str, Any] | None,
    ) -> None:
        current = conn.execute(
            f"SELECT * FROM {self._ANN_POLLS_TABLE} WHERE announcement_id = ?",
            (announcement_id,),
        ).fetchone()
        if current is None and poll is None:
            return
        poll_id = _normalize_text(current["id"] if current else "") or str(uuid.uuid4())
        current_options = [
            _normalize_text(row["text"])
            for row in conn.execute(
                f"SELECT text FROM {self._ANN_POLL_OPTIONS_TABLE} WHERE poll_id = ? ORDER BY sort_order, id",
                (poll_id,),
            ).fetchall()
        ] if current else []
        votes_count = self._as_int(conn.execute(
            f"SELECT COUNT(*) AS c FROM {self._ANN_POLL_VOTES_TABLE} WHERE poll_id = ?",
            (poll_id,),
        ).fetchone()["c"]) if current else 0
        if poll is None:
            if votes_count:
                raise ValueError("Poll with votes cannot be removed")
            conn.execute(f"DELETE FROM {self._ANN_POLL_OPTIONS_TABLE} WHERE poll_id = ?", (poll_id,))
            conn.execute(f"DELETE FROM {self._ANN_POLLS_TABLE} WHERE id = ?", (poll_id,))
            return

        next_options = list(poll.get("options") or [])[:10]
        current_signature = None if current is None else (
            _normalize_text(current["question"]),
            bool(self._as_int(current["allows_multiple"])),
            bool(self._as_int(current["is_anonymous"])),
            _normalize_text(current["closes_at"]),
            current_options,
        )
        next_signature = (
            _normalize_text(poll.get("question")),
            bool(poll.get("allows_multiple")),
            bool(poll.get("is_anonymous")),
            _normalize_text(poll.get("closes_at")),
            next_options,
        )
        if current_signature == next_signature:
            return
        if votes_count:
            raise ValueError("Poll cannot be changed after voting has started")
        now_iso = _utc_now_iso()
        if current is None:
            conn.execute(
                f"""INSERT INTO {self._ANN_POLLS_TABLE}
                    (id, announcement_id, question, allows_multiple, is_anonymous, closes_at, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (poll_id, announcement_id, poll["question"], 1 if poll["allows_multiple"] else 0, 1 if poll["is_anonymous"] else 0, poll["closes_at"], now_iso, now_iso),
            )
        else:
            conn.execute(
                f"""UPDATE {self._ANN_POLLS_TABLE}
                    SET question = ?, allows_multiple = ?, is_anonymous = ?, closes_at = ?, updated_at = ?
                    WHERE id = ?""",
                (poll["question"], 1 if poll["allows_multiple"] else 0, 1 if poll["is_anonymous"] else 0, poll["closes_at"], now_iso, poll_id),
            )
            conn.execute(f"DELETE FROM {self._ANN_POLL_OPTIONS_TABLE} WHERE poll_id = ?", (poll_id,))
        for index, option_text in enumerate(next_options):
            conn.execute(
                f"INSERT INTO {self._ANN_POLL_OPTIONS_TABLE} (id, poll_id, text, sort_order) VALUES (?, ?, ?, ?)",
                (str(uuid.uuid4()), poll_id, option_text, index),
            )

    def _validate_announcement_poll_for_publish(self, conn: sqlite3.Connection, announcement_id: str) -> None:
        poll = conn.execute(
            f"SELECT * FROM {self._ANN_POLLS_TABLE} WHERE announcement_id = ?",
            (announcement_id,),
        ).fetchone()
        if poll is None:
            return
        if len(_normalize_text(poll["question"])) < 3:
            raise ValueError("Poll question must contain at least 3 characters")
        raw_options = [
            _normalize_text(row["text"])
            for row in conn.execute(
                f"SELECT text FROM {self._ANN_POLL_OPTIONS_TABLE} WHERE poll_id = ? ORDER BY sort_order",
                (_normalize_text(poll["id"]),),
            ).fetchall()
        ]
        if any(not option for option in raw_options):
            raise ValueError("Poll options must not be empty")
        options = [option for option in raw_options if option]
        if len(options) < 2:
            raise ValueError("Poll must contain at least two options")
        if len({option.casefold() for option in options}) != len(options):
            raise ValueError("Poll options must be unique")
        closes_at = self._parse_iso_datetime(poll["closes_at"])
        if closes_at and closes_at <= datetime.now(timezone.utc):
            raise ValueError("Poll closing date must be in the future")
        publication = conn.execute(
            f"SELECT published_from FROM {self._ANN_TABLE} WHERE id = ?",
            (announcement_id,),
        ).fetchone()
        published_from = self._parse_iso_datetime(publication["published_from"] if publication else None)
        if closes_at and published_from and closes_at <= published_from:
            raise ValueError("Poll closing date must be later than publication date")

    def _validate_announcement_publication(self, announcement: dict[str, Any]) -> None:
        if len(_normalize_text(announcement.get("title"))) < 3:
            raise ValueError("Announcement title must contain at least 3 characters")
        audience_scope = _normalize_text(announcement.get("audience_scope"), "all")
        audience_roles = announcement.get("audience_roles")
        audience_user_ids = announcement.get("audience_user_ids")
        roles = self._unique_texts(audience_roles) if isinstance(audience_roles, list) else self._unique_texts(self._json_load_list(audience_roles))
        user_ids = self._unique_ints(audience_user_ids) if isinstance(audience_user_ids, list) else self._unique_ints(self._json_load_list(audience_user_ids))
        if audience_scope == "roles" and not roles:
            raise ValueError("Announcement audience must not be empty")
        if audience_scope == "users" and not user_ids:
            raise ValueError("Announcement audience must not be empty")

        now = datetime.now(timezone.utc)
        published_from = self._parse_iso_datetime(announcement.get("published_from"))
        expires_at = self._parse_iso_datetime(announcement.get("expires_at"))
        status = _normalize_text(announcement.get("status"), "published")
        if status == "scheduled" and (published_from is None or published_from <= now):
            raise ValueError("Scheduled publication date must be in the future")
        if expires_at and published_from and expires_at <= published_from:
            raise ValueError("Publication expiry date must be later than publication date")
        if expires_at and expires_at <= now:
            raise ValueError("Publication expiry date must be in the future")

    @staticmethod
    def _feed_slug(value: Any) -> str:
        source = _normalize_text(value).lower()
        slug = re.sub(r"[^a-z0-9\u0400-\u04ff]+", "-", source).strip("-")
        return slug[:80] or str(uuid.uuid4())

    def _sync_announcement_tags(self, conn: sqlite3.Connection, *, announcement_id: str, tags: list[str]) -> None:
        conn.execute(f"DELETE FROM {self._ANN_TAG_LINKS_TABLE} WHERE announcement_id = ?", (announcement_id,))
        now_iso = _utc_now_iso()
        for name in self._unique_texts(tags)[:10]:
            clean_name = name[:60]
            slug = self._feed_slug(clean_name)
            existing = conn.execute(f"SELECT id FROM {self._ANN_TAGS_TABLE} WHERE slug = ?", (slug,)).fetchone()
            tag_id = _normalize_text(existing["id"] if existing else "") or str(uuid.uuid4())
            if existing is None:
                conn.execute(
                    f"INSERT INTO {self._ANN_TAGS_TABLE} (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
                    (tag_id, clean_name, slug, now_iso),
                )
            conn.execute(
                f"INSERT INTO {self._ANN_TAG_LINKS_TABLE} (announcement_id, tag_id) VALUES (?, ?) ON CONFLICT(announcement_id, tag_id) DO NOTHING",
                (announcement_id, tag_id),
            )

    def _upsert_announcement_read_state(
        self,
        conn: sqlite3.Connection,
        *,
        announcement_id: str,
        user: dict[str, Any],
        seen_version: Optional[int] = None,
        acknowledged_version: Optional[int] = None,
        acknowledged_at: Optional[str] = None,
    ) -> None:
        user_id = self._as_int(user.get("id"))
        if user_id <= 0:
            return
        existing = conn.execute(
            f"""
            SELECT seen_version, acknowledged_version, acknowledged_at
            FROM {self._ANN_READS_TABLE}
            WHERE announcement_id = ? AND user_id = ?
            """,
            (_normalize_text(announcement_id), user_id),
        ).fetchone()
        next_seen_version = max(self._as_int(existing["seen_version"] if existing else 0), self._as_int(seen_version))
        next_ack_version = max(self._as_int(existing["acknowledged_version"] if existing else 0), self._as_int(acknowledged_version))
        next_ack_at = _normalize_text(acknowledged_at) or _normalize_text(existing["acknowledged_at"] if existing else "")
        conn.execute(
            f"""
            INSERT INTO {self._ANN_READS_TABLE}
            (announcement_id, user_id, username, full_name, read_at, seen_version, acknowledged_version, acknowledged_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(announcement_id, user_id) DO UPDATE SET
              username = excluded.username,
              full_name = excluded.full_name,
              read_at = excluded.read_at,
              seen_version = excluded.seen_version,
              acknowledged_version = excluded.acknowledged_version,
              acknowledged_at = excluded.acknowledged_at
            """,
            (
                _normalize_text(announcement_id),
                user_id,
                _normalize_text(user.get("username")),
                _normalize_text(user.get("full_name")),
                _utc_now_iso(),
                next_seen_version,
                next_ack_version,
                next_ack_at or None,
            ),
        )

    def _create_announcement_notifications(
        self,
        conn: sqlite3.Connection,
        *,
        announcement: dict[str, Any],
        event_type: str,
        title: str,
        body: str,
        actor_user_id: int,
    ) -> list[dict[str, Any]]:
        normalized_actor_user_id = self._as_int(actor_user_id)
        recipient_user_ids = sorted({
            self._as_int(recipient.get("id"))
            for recipient in self._announcement_recipient_users(announcement)
            if self._as_int(recipient.get("id")) > 0
            and self._as_int(recipient.get("id")) != normalized_actor_user_id
        })
        if not recipient_user_ids:
            return []

        try:
            push_enabled_user_ids = notification_preferences_service.enabled_user_ids(
                user_ids=recipient_user_ids,
                channel="announcements",
            )
        except Exception:
            logger.warning("Failed to resolve announcement notification preferences in batch", exc_info=True)
            push_enabled_user_ids = set(recipient_user_ids)

        normalized_event_type = _normalize_text(event_type)
        normalized_title = _normalize_text(title)
        normalized_body = _normalize_text(body)
        entity_id = _normalize_text(announcement.get("id"))
        items = [
            {
                "id": str(uuid.uuid4()),
                "recipient_user_id": recipient_user_id,
                "event_type": normalized_event_type,
                "title": normalized_title,
                "body": normalized_body,
                "entity_type": "announcement",
                "entity_id": entity_id,
            }
            for recipient_user_id in recipient_user_ids
        ]
        self.create_notifications_batch(items, conn=conn, commit_external=False)

        route = f"/feed?post={entity_id}" if entity_id else "/feed"
        return [
            {
                "recipient_user_id": int(item["recipient_user_id"]),
                "title": normalized_title or "Новое уведомление",
                "body": normalized_body or normalized_title or "Откройте приложение, чтобы посмотреть подробности.",
                "channel": "announcements",
                "route": route,
                "tag": f"hub:{item['id']}",
                "data": {
                    "notification_id": item["id"],
                    "entity_type": "announcement",
                    "entity_id": entity_id,
                },
                "ttl": 12 * 60 * 60,
            }
            for item in items
            if int(item["recipient_user_id"]) in push_enabled_user_ids
        ]

    def create_announcement(
        self,
        *,
        payload: dict[str, Any],
        actor: dict[str, Any],
        attachments: Optional[list[dict[str, Any]]] = None,
    ) -> dict[str, Any]:
        normalized = self._normalize_announcement_payload(payload)
        now_iso = _utc_now_iso()
        client_request_id = _normalize_text(payload.get("client_request_id"))
        if len(client_request_id) > 200:
            raise ValueError("Announcement client request id is too long")
        actor_user_id = self._as_int(actor.get("id"))
        ann_id = str(uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"hub-announcement-create:{actor_user_id}:{client_request_id}",
        )) if client_request_id else str(uuid.uuid4())
        title_text = normalized["title"]
        status = normalized["status"]
        published_from = self._parse_iso_datetime(normalized.get("published_from"))
        if status == "published" and published_from and published_from > datetime.now(timezone.utc):
            status = "scheduled"
        if not normalized["is_active"]:
            status = "archived"
        if status in {"published", "scheduled"}:
            self._validate_announcement_publication({**normalized, "status": status})
        attachment_payloads = attachments if isinstance(attachments, list) else []
        push_jobs: list[dict[str, Any]] = []
        result: dict[str, Any] = {}

        with self._lock, self._connect() as conn:
            if client_request_id:
                existing_row = conn.execute(
                    f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?",
                    (ann_id,),
                ).fetchone()
                if existing_row is not None:
                    existing_item = dict(existing_row)
                    if (
                        self._as_int(existing_item.get("author_user_id")) != actor_user_id
                        or _normalize_text(existing_item.get("title")) != title_text
                        or _normalize_text(existing_item.get("preview")) != normalized["preview"]
                        or _normalize_text(existing_item.get("body")) != normalized["body"]
                    ):
                        raise ValueError("Announcement client request id was already used for another payload")
                    return self._build_announcement_item(
                        conn,
                        existing_row,
                        viewer_user_id=actor_user_id,
                        is_admin=self._user_can_moderate_announcements(actor),
                        include_hidden_for_manager=True,
                    ) or {}
            conn.execute(
                f"""
                INSERT INTO {self._ANN_TABLE}
                (id, title, preview, body, priority, is_active, author_user_id, author_username, author_full_name,
                 published_at, updated_at, version, audience_scope, audience_roles, audience_user_ids,
                 requires_ack, is_pinned, pinned_until, published_from, expires_at,
                 status, comments_enabled, reactions_enabled, publication_notified_at, category_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ann_id,
                    title_text,
                    normalized["preview"],
                    normalized["body"],
                    normalized["priority"],
                    1 if normalized["is_active"] else 0,
                    self._as_int(actor.get("id")),
                    _normalize_text(actor.get("username")),
                    _normalize_text(actor.get("full_name")),
                    now_iso,
                    now_iso,
                    normalized["audience_scope"],
                    self._serialize_json_list(normalized["audience_roles"]),
                    self._serialize_json_list(normalized["audience_user_ids"]),
                    1 if normalized["requires_ack"] else 0,
                    1 if normalized["is_pinned"] else 0,
                    normalized["pinned_until"],
                    normalized["published_from"],
                    normalized["expires_at"],
                    status,
                    1 if normalized["comments_enabled"] else 0,
                    1 if normalized["reactions_enabled"] else 0,
                    now_iso if status == "published" else None,
                    normalized["category_id"],
                ),
            )
            for attachment_index, attachment_payload in enumerate(attachment_payloads):
                file_bytes = attachment_payload.get("file_bytes")
                if not isinstance(file_bytes, (bytes, bytearray)) or len(file_bytes) == 0:
                    continue
                attachment_id = str(uuid.uuid4())
                safe_name, rel_path, file_size = self._store_attachment_file(
                    root=self.announcement_attachments_root,
                    parent_id=ann_id,
                    attachment_id=attachment_id,
                    file_name=_normalize_text(attachment_payload.get("file_name"), "file.bin"),
                    file_bytes=bytes(file_bytes),
                )
                conn.execute(
                    f"""
                    INSERT INTO {self._ANN_ATTACH_TABLE}
                    (id, announcement_id, file_name, file_path, file_mime, file_size, uploaded_by_user_id, uploaded_by_username, uploaded_at, sort_order, is_cover)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        attachment_id,
                        ann_id,
                        safe_name,
                        rel_path,
                        _normalize_text(attachment_payload.get("file_mime")),
                        file_size,
                        self._as_int(actor.get("id")),
                        _normalize_text(actor.get("username")),
                        now_iso,
                        attachment_index,
                        1 if attachment_index == 0 and _normalize_text(attachment_payload.get("file_mime")).lower().startswith("image/") else 0,
                    ),
                )
            self._sync_announcement_tags(conn, announcement_id=ann_id, tags=normalized["tags"])
            if "poll" in payload:
                self._sync_announcement_poll(conn, announcement_id=ann_id, poll=normalized["poll"])
            if status in {"published", "scheduled"}:
                self._validate_announcement_poll_for_publish(conn, ann_id)
            self._upsert_announcement_read_state(
                conn,
                announcement_id=ann_id,
                user=actor,
                seen_version=1,
                acknowledged_version=1 if normalized["requires_ack"] else 0,
                acknowledged_at=now_iso if normalized["requires_ack"] else None,
            )
            created_row = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            created_item = dict(created_row) if created_row else {"id": ann_id}
            if status == "published":
                push_jobs = self._create_announcement_notifications(
                    conn,
                    announcement=created_item,
                    event_type="announcement.new",
                    title="Новая публикация в ленте",
                    body=self._preview_text(title_text),
                    actor_user_id=self._as_int(actor.get("id")),
                )
            conn.commit()
            if created_row is not None:
                item = self._build_announcement_item(
                    conn,
                    created_row,
                    viewer_user_id=self._as_int(actor.get("id")),
                    include_hidden_for_manager=True,
                )
                result = item or {}
        self._schedule_hub_push_jobs(push_jobs)
        return result

    def update_announcement(
        self,
        announcement_id: str,
        payload: dict[str, Any],
        *,
        actor_user_id: int,
        is_admin: bool = False,
    ) -> Optional[dict[str, Any]]:
        ann_id = _normalize_text(announcement_id)
        if not ann_id:
            return None
        normalized = self._normalize_announcement_payload(payload)
        actor_id = self._as_int(actor_user_id)
        now_iso = _utc_now_iso()
        notify_on_update = bool(payload.get("notify_on_update"))
        with self._lock, self._connect() as conn:
            current_row = conn.execute(
                f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?",
                (ann_id,),
            ).fetchone()
            if current_row is None:
                return None
            current_item = dict(current_row)
            if not is_admin and self._as_int(current_item.get("author_user_id")) != actor_id:
                raise PermissionError("Only announcement author or admin can edit it")

            updates: list[str] = []
            params: list[Any] = []
            for key in (
                "title",
                "preview",
                "body",
                "priority",
                "audience_scope",
                "audience_roles",
                "audience_user_ids",
                "requires_ack",
                "is_pinned",
                "pinned_until",
                "published_from",
                "expires_at",
                "is_active",
                "status",
                "comments_enabled",
                "reactions_enabled",
                "category_id",
            ):
                if key not in payload:
                    continue
                if key == "audience_roles":
                    updates.append("audience_roles = ?")
                    params.append(self._serialize_json_list(normalized["audience_roles"]))
                elif key == "audience_user_ids":
                    updates.append("audience_user_ids = ?")
                    params.append(self._serialize_json_list(normalized["audience_user_ids"]))
                elif key in {"requires_ack", "is_pinned", "is_active", "comments_enabled", "reactions_enabled"}:
                    updates.append(f"{key} = ?")
                    params.append(1 if normalized[key] else 0)
                else:
                    updates.append(f"{key} = ?")
                    params.append(normalized[key])
            if not updates and "tags" not in payload and "poll" not in payload:
                return self._build_announcement_item(
                    conn,
                    current_row,
                    viewer_user_id=actor_id,
                    is_admin=is_admin,
                    include_hidden_for_manager=True,
                )
            target_status = normalized["status"] if "status" in payload else _normalize_text(current_item.get("status"), "published")
            target_title = normalized["title"] if "title" in payload else _normalize_text(current_item.get("title"))
            if target_status != "draft" and len(target_title) < 3:
                raise ValueError("Announcement title must contain at least 3 characters")
            if target_status in {"published", "scheduled"} and "status" in payload:
                validation_item = {
                    **current_item,
                    **{key: normalized[key] for key in normalized if key in payload},
                    "status": target_status,
                    "title": target_title,
                }
                self._validate_announcement_publication(validation_item)
            updates.extend(["updated_at = ?", "version = version + 1"])
            params.append(now_iso)
            params.append(ann_id)
            conn.execute(f"UPDATE {self._ANN_TABLE} SET {', '.join(updates)} WHERE id = ?", tuple(params))
            updated_row = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            updated_item = dict(updated_row) if updated_row else current_item
            if "tags" in payload:
                self._sync_announcement_tags(conn, announcement_id=ann_id, tags=normalized["tags"])
            if "poll" in payload:
                self._sync_announcement_poll(conn, announcement_id=ann_id, poll=normalized["poll"])
                if target_status in {"published", "scheduled"}:
                    self._validate_announcement_poll_for_publish(conn, ann_id)
            author_user = {
                "id": self._as_int(updated_item.get("author_user_id")),
                "username": _normalize_text(updated_item.get("author_username")),
                "full_name": _normalize_text(updated_item.get("author_full_name")),
            }
            current_version = max(1, self._as_int(updated_item.get("version"), 1))
            self._upsert_announcement_read_state(
                conn,
                announcement_id=ann_id,
                user=author_user,
                seen_version=current_version,
                acknowledged_version=current_version if bool(self._as_int(updated_item.get("requires_ack"))) else 0,
                acknowledged_at=now_iso if bool(self._as_int(updated_item.get("requires_ack"))) else None,
            )
            if notify_on_update and _normalize_text(updated_item.get("status"), "published") == "published":
                self._create_announcement_notifications(
                    conn,
                    announcement=updated_item,
                    event_type="announcement.updated",
                    title="Публикация в ленте обновлена",
                    body=self._preview_text(_normalize_text(updated_item.get("title"))),
                    actor_user_id=actor_id,
                )
            conn.commit()
            if updated_row is None:
                return None
            return self._build_announcement_item(
                conn,
                updated_row,
                viewer_user_id=actor_id,
                is_admin=is_admin,
                include_hidden_for_manager=True,
            )

    def get_announcement(
        self,
        announcement_id: str,
        *,
        user_id: int,
        is_admin: bool = False,
    ) -> Optional[dict[str, Any]]:
        ann_id = _normalize_text(announcement_id)
        if not ann_id:
            return None
        with self._lock, self._connect() as conn:
            row = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            if row is None:
                return None
            reaction_counts, comment_counts, viewer_reactions, bookmarks = self._load_announcement_social_state(
                conn,
                viewer_user_id=self._as_int(user_id),
            )
            categories, tags = self._load_announcement_taxonomy_state(conn)
            polls = self._load_announcement_polls(conn, viewer_user_id=self._as_int(user_id))
            cover_attachment = self._load_announcement_cover_attachments(conn).get(ann_id)
            item = self._build_announcement_item(
                conn,
                row,
                viewer_user_id=self._as_int(user_id),
                is_admin=is_admin,
                include_hidden_for_manager=True,
                comments_count=comment_counts.get(ann_id, 0),
                reaction_counts=reaction_counts.get(ann_id, {}),
                viewer_reaction=viewer_reactions.get(ann_id, ""),
                viewer_bookmarked=ann_id in bookmarks,
                category=categories.get(ann_id),
                tags=tags.get(ann_id, []),
                cover_attachment=cover_attachment,
                poll=polls.get(ann_id, {}),
            )
            if item is None:
                raise PermissionError("Announcement is not available for current user")
            return item

    def delete_announcement(self, *, announcement_id: str, actor_user_id: int, is_admin: bool = False) -> bool:
        ann_id = _normalize_text(announcement_id)
        if not ann_id:
            return False
        attachment_paths: list[str] = []
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"SELECT id, author_user_id FROM {self._ANN_TABLE} WHERE id = ?",
                (ann_id,),
            ).fetchone()
            if row is None:
                return False
            if not is_admin:
                raise PermissionError("Only admin can delete announcement permanently")

            file_rows = conn.execute(
                f"SELECT file_path FROM {self._ANN_ATTACH_TABLE} WHERE announcement_id = ?",
                (ann_id,),
            ).fetchall()
            attachment_paths = [_normalize_text(item["file_path"]) for item in file_rows]

            notif_ids = conn.execute(
                f"SELECT id FROM {self._NOTIF_TABLE} WHERE entity_type = 'announcement' AND (entity_id = ? OR entity_id LIKE ?)",
                (ann_id, f"{ann_id}#%"),
            ).fetchall()
            notif_id_values = [_normalize_text(item["id"]) for item in notif_ids if _normalize_text(item["id"])]
            if notif_id_values:
                placeholders = ", ".join(["?"] * len(notif_id_values))
                conn.execute(
                    f"DELETE FROM {self._NOTIF_READS_TABLE} WHERE notification_id IN ({placeholders})",
                    tuple(notif_id_values),
                )
            conn.execute(
                f"DELETE FROM {self._NOTIF_TABLE} WHERE entity_type = 'announcement' AND (entity_id = ? OR entity_id LIKE ?)",
                (ann_id, f"{ann_id}#%"),
            )
            comment_attachment_rows = conn.execute(f"SELECT file_path FROM {self._ANN_COMMENT_ATTACH_TABLE} WHERE announcement_id = ?", (ann_id,)).fetchall()
            attachment_paths.extend(_normalize_text(item["file_path"]) for item in comment_attachment_rows)
            conn.execute(f"DELETE FROM {self._ANN_READS_TABLE} WHERE announcement_id = ?", (ann_id,))
            conn.execute(f"DELETE FROM {self._ANN_ATTACH_TABLE} WHERE announcement_id = ?", (ann_id,))
            conn.execute(f"DELETE FROM {self._ANN_LIKES_TABLE} WHERE announcement_id = ?", (ann_id,))
            conn.execute(f"DELETE FROM {self._ANN_REACTIONS_TABLE} WHERE announcement_id = ?", (ann_id,))
            conn.execute(f"DELETE FROM {self._ANN_BOOKMARKS_TABLE} WHERE announcement_id = ?", (ann_id,))
            conn.execute(f"DELETE FROM {self._ANN_TAG_LINKS_TABLE} WHERE announcement_id = ?", (ann_id,))
            poll_row = conn.execute(f"SELECT id FROM {self._ANN_POLLS_TABLE} WHERE announcement_id = ?", (ann_id,)).fetchone()
            if poll_row is not None:
                poll_id = _normalize_text(poll_row["id"])
                conn.execute(f"DELETE FROM {self._ANN_POLL_VOTES_TABLE} WHERE poll_id = ?", (poll_id,))
                conn.execute(f"DELETE FROM {self._ANN_POLL_OPTIONS_TABLE} WHERE poll_id = ?", (poll_id,))
                conn.execute(f"DELETE FROM {self._ANN_POLLS_TABLE} WHERE id = ?", (poll_id,))
            comment_ids = [_normalize_text(item["id"]) for item in conn.execute(f"SELECT id FROM {self._ANN_COMMENTS_TABLE} WHERE announcement_id = ?", (ann_id,)).fetchall()]
            if comment_ids:
                placeholders = ", ".join(["?"] * len(comment_ids))
                conn.execute(f"DELETE FROM {self._ANN_COMMENT_REACTIONS_TABLE} WHERE comment_id IN ({placeholders})", tuple(comment_ids))
                conn.execute(f"DELETE FROM {self._ANN_COMMENT_MENTIONS_TABLE} WHERE comment_id IN ({placeholders})", tuple(comment_ids))
            conn.execute(f"DELETE FROM {self._ANN_COMMENT_ATTACH_TABLE} WHERE announcement_id = ?", (ann_id,))
            conn.execute(f"DELETE FROM {self._ANN_COMMENTS_TABLE} WHERE announcement_id = ?", (ann_id,))
            conn.execute(f"DELETE FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,))
            conn.commit()

        self._remove_relative_files(attachment_paths)
        self._remove_dir_quiet(self.announcement_attachments_root / ann_id)
        return True

    def list_announcements(
        self,
        *,
        user_id: int,
        limit: int = 30,
        offset: int = 0,
        q: str = "",
        priority: str = "",
        unread_only: bool = False,
        has_attachments: bool = False,
        include_body: bool = False,
        sort_by: str = "published_at",
        sort_dir: str = "desc",
        category_id: str = "",
        tag: str = "",
        bookmarked_only: bool = False,
    ) -> dict[str, Any]:
        safe_limit = self._coerce_limit(limit, default=30, minimum=1, maximum=300)
        safe_offset = max(0, self._as_int(offset, 0))
        query_text = _normalize_text(q).lower()
        query_terms = [term for term in query_text.split() if term]
        priority_value = _normalize_text(priority).lower()
        category_filter = _normalize_text(category_id)
        tag_filter = _normalize_text(tag).lower()
        normalized_sort_by = _normalize_text(sort_by, "published_at").lower()
        normalized_sort_dir = "asc" if _normalize_text(sort_dir).lower() == "asc" else "desc"
        with self._db_conn(write=False) as conn:
            rows = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE}").fetchall()
            reads_by_announcement_id = self._load_announcement_reads_for_user(conn, user_id=int(user_id))
            attachment_counts = self._load_announcement_attachment_counts(conn)
            attachments_by_announcement_id = (
                self._load_announcement_attachments_by_announcement(conn)
                if include_body
                else {}
            )
            cover_attachments = self._load_announcement_cover_attachments(conn)
            reaction_counts, comment_counts, viewer_reactions, bookmarks = self._load_announcement_social_state(
                conn,
                viewer_user_id=int(user_id),
            )
            categories, tags = self._load_announcement_taxonomy_state(conn)
            polls = self._load_announcement_polls(conn, viewer_user_id=int(user_id))
            now_utc = datetime.now(timezone.utc)
            items: list[dict[str, Any]] = []
            unread_total = 0
            ack_pending_total = 0
            for row in rows:
                announcement_id = _normalize_text(
                    row["id"] if not isinstance(row, dict) else row.get("id")
                )
                item = self._build_announcement_item(
                    conn,
                    row,
                    viewer_user_id=int(user_id),
                    include_body=bool(include_body),
                    read_row=reads_by_announcement_id.get(announcement_id, {}),
                    attachments=attachments_by_announcement_id.get(announcement_id, []),
                    attachments_count=attachment_counts.get(announcement_id, 0),
                    include_attachments=bool(include_body),
                    comments_count=comment_counts.get(announcement_id, 0),
                    reaction_counts=reaction_counts.get(announcement_id, {}),
                    viewer_reaction=viewer_reactions.get(announcement_id, ""),
                    viewer_bookmarked=announcement_id in bookmarks,
                    category=categories.get(announcement_id),
                    tags=tags.get(announcement_id, []),
                    cover_attachment=cover_attachments.get(announcement_id),
                    poll=polls.get(announcement_id, {}),
                )
                if item is None:
                    continue
                if _normalize_text(item.get("status"), "published") != "published":
                    continue
                published_from = self._parse_iso_datetime(item.get("published_from"))
                expires_at = self._parse_iso_datetime(item.get("expires_at"))
                if not item.get("is_active"):
                    continue
                if published_from and published_from > now_utc:
                    continue
                if expires_at and expires_at <= now_utc:
                    continue
                haystack = " ".join([
                    _normalize_text(item.get("title")).lower(),
                    _normalize_text(item.get("preview")).lower(),
                    _normalize_text(item.get("body")).lower(),
                    _normalize_text(item.get("author_full_name")).lower(),
                    _normalize_text(item.get("recipients_summary")).lower(),
                ])
                if query_terms and not all(term in haystack for term in query_terms):
                    continue
                if priority_value in {"low", "normal", "high"} and _normalize_text(item.get("priority")).lower() != priority_value:
                    continue
                if bool(unread_only) and not bool(item.get("is_unread")):
                    continue
                if bool(has_attachments) and self._as_int(item.get("attachments_count")) <= 0:
                    continue
                if category_filter and _normalize_text((item.get("category") or {}).get("id")) != category_filter:
                    continue
                if tag_filter and tag_filter not in {
                    _normalize_text(value.get("slug")).lower() for value in item.get("tags", [])
                } | {
                    _normalize_text(value.get("name")).lower() for value in item.get("tags", [])
                }:
                    continue
                if bool(bookmarked_only) and not bool(item.get("viewer_bookmarked")):
                    continue
                unread_total += 1 if bool(item.get("is_unread")) else 0
                ack_pending_total += 1 if bool(item.get("is_ack_pending")) else 0
                items.append(item)

        def _sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
            if normalized_sort_by == "priority":
                rank = {"high": 3, "normal": 2, "low": 1}.get(_normalize_text(item.get("priority")).lower(), 0)
                return (rank, _normalize_text(item.get("updated_at")), _normalize_text(item.get("id")))
            if normalized_sort_by == "updated_at":
                return (_normalize_text(item.get("updated_at")), _normalize_text(item.get("id")))
            return (_normalize_text(item.get("published_at")), _normalize_text(item.get("id")))

        items.sort(key=_sort_key, reverse=normalized_sort_dir == "desc")
        items.sort(
            key=lambda item: (
                1 if bool(item.get("is_pinned_active")) else 0,
                1 if _normalize_text(item.get("priority")).lower() == "high" and bool(item.get("is_unread")) else 0,
            ),
            reverse=True,
        )
        paged_items = items[safe_offset:safe_offset + safe_limit]
        return {
            "items": paged_items,
            "total": len(items),
            "unread_total": unread_total,
            "ack_pending_total": ack_pending_total,
            "limit": safe_limit,
            "offset": safe_offset,
            "filters": {
                "q": query_text,
                "q_terms": query_terms,
                "priority": priority_value,
                "unread_only": bool(unread_only),
                "has_attachments": bool(has_attachments),
                "include_body": bool(include_body),
                "sort_by": normalized_sort_by,
                "sort_dir": normalized_sort_dir,
                "category_id": category_filter,
                "tag": tag_filter,
                "bookmarked_only": bool(bookmarked_only),
            },
        }

    def mark_announcement_read(self, *, announcement_id: str, user: dict[str, Any]) -> bool:
        ann_id = _normalize_text(announcement_id)
        if not ann_id:
            return False
        with self._lock, self._connect() as conn:
            ann = conn.execute(
                f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?",
                (ann_id,),
            ).fetchone()
            if ann is None:
                return False
            announcement = dict(ann)
            if not self._announcement_is_visible_to_user(
                announcement,
                user_id=self._as_int(user.get("id")),
                is_admin=self._is_admin_role(user.get("role")),
            ):
                raise PermissionError("Announcement is not available for current user")
            current_version = max(1, self._as_int(announcement.get("version"), 1))
            self._upsert_announcement_read_state(
                conn,
                announcement_id=ann_id,
                user=user,
                seen_version=current_version,
            )
            conn.commit()
        return True

    def acknowledge_announcement(self, *, announcement_id: str, user: dict[str, Any]) -> dict[str, Any]:
        ann_id = _normalize_text(announcement_id)
        if not ann_id:
            raise LookupError("Announcement not found")
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            ann = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            if ann is None:
                raise LookupError("Announcement not found")
            announcement = dict(ann)
            if not self._announcement_is_visible_to_user(
                announcement,
                user_id=self._as_int(user.get("id")),
                is_admin=self._is_admin_role(user.get("role")),
            ):
                raise PermissionError("Announcement is not available for current user")
            current_version = max(1, self._as_int(announcement.get("version"), 1))
            self._upsert_announcement_read_state(
                conn,
                announcement_id=ann_id,
                user=user,
                seen_version=current_version,
                acknowledged_version=current_version,
                acknowledged_at=now_iso,
            )
            conn.commit()
        return {
            "ok": True,
            "announcement_id": ann_id,
            "acknowledged_version": current_version,
            "is_ack_pending": False,
        }

    def get_announcement_reads(self, announcement_id: str) -> dict[str, Any]:
        ann_id = _normalize_text(announcement_id)
        if not ann_id:
            return {"items": [], "summary": {}}
        with self._lock, self._connect() as conn:
            announcement_row = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            if announcement_row is None:
                return {"items": [], "summary": {}}
            announcement = dict(announcement_row)
            rows = conn.execute(
                f"""
                SELECT announcement_id, user_id, username, full_name, read_at, seen_version, acknowledged_version, acknowledged_at
                FROM {self._ANN_READS_TABLE}
                WHERE announcement_id = ?
                ORDER BY read_at DESC
                """,
                (ann_id,),
            ).fetchall()
            reads_by_user_id = {self._as_int(row["user_id"]): dict(row) for row in rows}
            current_version = max(1, self._as_int(announcement.get("version"), 1))
            items: list[dict[str, Any]] = []
            seen_total = 0
            ack_total = 0
            pending_ack_total = 0
            for recipient in self._announcement_recipient_users(announcement):
                recipient_user_id = self._as_int(recipient.get("id"))
                read_item = reads_by_user_id.get(recipient_user_id, {})
                seen_version = self._as_int(read_item.get("seen_version"))
                acknowledged_version = self._as_int(read_item.get("acknowledged_version"))
                is_seen = seen_version >= current_version
                is_ack = acknowledged_version >= current_version if bool(self._as_int(announcement.get("requires_ack"))) else False
                if is_seen:
                    seen_total += 1
                if is_ack:
                    ack_total += 1
                elif bool(self._as_int(announcement.get("requires_ack"))):
                    pending_ack_total += 1
                items.append(
                    {
                        "user_id": recipient_user_id,
                        "username": _normalize_text(recipient.get("username")),
                        "full_name": _normalize_text(recipient.get("full_name")) or _normalize_text(recipient.get("username")),
                        "role": _normalize_text(recipient.get("role")),
                        "read_at": _normalize_text(read_item.get("read_at")),
                        "acknowledged_at": _normalize_text(read_item.get("acknowledged_at")),
                        "seen_version": seen_version,
                        "acknowledged_version": acknowledged_version,
                        "is_seen": is_seen,
                        "is_acknowledged": is_ack,
                    }
                )
        return {
            "items": items,
            "summary": {
                "recipients_total": len(items),
                "seen_total": seen_total,
                "ack_total": ack_total,
                "pending_ack_total": pending_ack_total,
                "version": current_version,
            },
        }

    def set_announcement_like(
        self,
        *,
        announcement_id: str,
        user: dict[str, Any],
        liked: bool,
    ) -> dict[str, Any]:
        return self.set_announcement_reaction(
            announcement_id=announcement_id,
            user=user,
            reaction_type="like" if liked else None,
        )

    def set_announcement_reaction(
        self,
        *,
        announcement_id: str,
        user: dict[str, Any],
        reaction_type: str | None,
    ) -> dict[str, Any]:
        ann_id = _normalize_text(announcement_id)
        user_id = self._as_int(user.get("id"))
        normalized_reaction = _normalize_text(reaction_type).lower()
        if normalized_reaction and normalized_reaction not in self._REACTION_TYPES:
            raise ValueError("Unsupported reaction")
        if not ann_id or user_id <= 0:
            raise LookupError("Announcement not found")
        with self._lock, self._connect() as conn:
            row = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            if row is None:
                raise LookupError("Announcement not found")
            announcement = dict(row)
            if not self._announcement_is_visible_to_user(
                announcement,
                user_id=user_id,
                is_admin=self._user_can_moderate_announcements(user),
            ):
                raise PermissionError("Announcement is not available for current user")
            if not bool(self._as_int(announcement.get("reactions_enabled"), 1)):
                raise ValueError("Reactions are disabled for this publication")
            if normalized_reaction:
                conn.execute(
                    f"""
                    INSERT INTO {self._ANN_REACTIONS_TABLE}
                    (announcement_id, user_id, reaction_type, username, full_name, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(announcement_id, user_id) DO UPDATE SET
                      reaction_type = excluded.reaction_type,
                      username = excluded.username,
                      full_name = excluded.full_name,
                      updated_at = excluded.updated_at
                    """,
                    (
                        ann_id,
                        user_id,
                        normalized_reaction,
                        _normalize_text(user.get("username")),
                        _normalize_text(user.get("full_name")),
                        _utc_now_iso(),
                        _utc_now_iso(),
                    ),
                )
                if normalized_reaction == "like":
                    conn.execute(
                        f"""INSERT INTO {self._ANN_LIKES_TABLE}
                            (announcement_id, user_id, username, full_name, created_at)
                            VALUES (?, ?, ?, ?, ?)
                            ON CONFLICT(announcement_id, user_id) DO UPDATE SET
                              username = excluded.username, full_name = excluded.full_name""",
                        (ann_id, user_id, _normalize_text(user.get("username")), _normalize_text(user.get("full_name")), _utc_now_iso()),
                    )
                else:
                    conn.execute(f"DELETE FROM {self._ANN_LIKES_TABLE} WHERE announcement_id = ? AND user_id = ?", (ann_id, user_id))
            else:
                conn.execute(
                    f"DELETE FROM {self._ANN_REACTIONS_TABLE} WHERE announcement_id = ? AND user_id = ?",
                    (ann_id, user_id),
                )
                conn.execute(f"DELETE FROM {self._ANN_LIKES_TABLE} WHERE announcement_id = ? AND user_id = ?", (ann_id, user_id))
            count_rows = conn.execute(
                f"SELECT reaction_type, COUNT(*) AS c FROM {self._ANN_REACTIONS_TABLE} WHERE announcement_id = ? GROUP BY reaction_type",
                (ann_id,),
            ).fetchall()
            conn.commit()
        reaction_counts = {_normalize_text(row["reaction_type"]): self._as_int(row["c"]) for row in count_rows}
        return {
            "announcement_id": ann_id,
            "viewer_reaction": normalized_reaction or None,
            "reaction_counts": reaction_counts,
            "reactions_count": sum(reaction_counts.values()),
            "viewer_has_liked": normalized_reaction == "like",
            "likes_count": reaction_counts.get("like", 0),
        }

    def list_announcement_comments(
        self,
        *,
        announcement_id: str,
        user: dict[str, Any],
        limit: int = 20,
        offset: int = 0,
        sort: str = "interesting",
        root_comment_id: str = "",
        changed_since: str = "",
    ) -> dict[str, Any]:
        ann_id = _normalize_text(announcement_id)
        user_id = self._as_int(user.get("id"))
        is_moderator = self._user_can_moderate_announcements(user)
        if not ann_id or user_id <= 0:
            raise LookupError("Announcement not found")
        safe_limit = self._coerce_limit(limit, default=20, minimum=1, maximum=100)
        safe_offset = max(0, self._as_int(offset))
        normalized_sort = _normalize_text(sort, "interesting").lower()
        if normalized_sort not in {"interesting", "newest", "oldest"}:
            normalized_sort = "interesting"
        root_id = _normalize_text(root_comment_id)
        with self._lock, self._connect() as conn:
            ann_row = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            if ann_row is None:
                raise LookupError("Announcement not found")
            announcement = dict(ann_row)
            if not self._announcement_is_visible_to_user(announcement, user_id=user_id, is_admin=is_moderator):
                raise PermissionError("Announcement is not available for current user")
            where = "announcement_id = ? AND parent_comment_id IS NULL"
            params: list[Any] = [ann_id]
            if root_id:
                where = "announcement_id = ? AND root_comment_id = ? AND id <> ?"
                params.extend([root_id, root_id])
            if _normalize_text(changed_since):
                where += " AND updated_at > ?"
                params.append(_normalize_text(changed_since))
            count_row = conn.execute(
                f"SELECT COUNT(*) AS c FROM {self._ANN_COMMENTS_TABLE} WHERE {where}",
                tuple(params),
            ).fetchone()
            all_count_row = conn.execute(
                f"SELECT COUNT(*) AS c FROM {self._ANN_COMMENTS_TABLE} WHERE announcement_id = ?",
                (ann_id,),
            ).fetchone()
            order_sql = "created_at ASC"
            if normalized_sort == "newest":
                order_sql = "created_at DESC"
            elif normalized_sort == "interesting" and not root_id:
                order_sql = f"(SELECT COUNT(*) FROM {self._ANN_COMMENT_REACTIONS_TABLE} cr WHERE cr.comment_id = {self._ANN_COMMENTS_TABLE}.id) * 2 + (SELECT COUNT(*) FROM {self._ANN_COMMENTS_TABLE} child WHERE child.root_comment_id = {self._ANN_COMMENTS_TABLE}.id AND child.id <> child.root_comment_id) DESC, created_at DESC"
            rows = conn.execute(
                f"""
                SELECT *
                FROM {self._ANN_COMMENTS_TABLE}
                WHERE {where}
                ORDER BY {order_sql}
                LIMIT ? OFFSET ?
                """,
                tuple([*params, safe_limit, safe_offset]),
            ).fetchall()
            announcement_author_id = self._as_int(announcement.get("author_user_id"))
            comment_ids = [_normalize_text(row["id"]) for row in rows]
            reaction_counts: dict[str, dict[str, int]] = {}
            viewer_reactions: dict[str, str] = {}
            attachments: dict[str, list[dict[str, Any]]] = {}
            reply_counts: dict[str, int] = {}
            if comment_ids:
                placeholders = ", ".join(["?"] * len(comment_ids))
                for reaction in conn.execute(
                    f"SELECT comment_id, reaction_type, COUNT(*) AS c FROM {self._ANN_COMMENT_REACTIONS_TABLE} WHERE comment_id IN ({placeholders}) GROUP BY comment_id, reaction_type",
                    tuple(comment_ids),
                ).fetchall():
                    reaction_counts.setdefault(_normalize_text(reaction["comment_id"]), {})[_normalize_text(reaction["reaction_type"])] = self._as_int(reaction["c"])
                for reaction in conn.execute(
                    f"SELECT comment_id, reaction_type FROM {self._ANN_COMMENT_REACTIONS_TABLE} WHERE user_id = ? AND comment_id IN ({placeholders})",
                    tuple([user_id, *comment_ids]),
                ).fetchall():
                    viewer_reactions[_normalize_text(reaction["comment_id"])] = _normalize_text(reaction["reaction_type"])
                for attachment in conn.execute(
                    f"SELECT id, comment_id, announcement_id, file_name, file_mime, file_size, uploaded_at FROM {self._ANN_COMMENT_ATTACH_TABLE} WHERE comment_id IN ({placeholders}) ORDER BY uploaded_at ASC",
                    tuple(comment_ids),
                ).fetchall():
                    item = dict(attachment)
                    attachments.setdefault(_normalize_text(item.get("comment_id")), []).append(item)
                if not root_id:
                    for reply in conn.execute(
                        f"SELECT root_comment_id, COUNT(*) AS c FROM {self._ANN_COMMENTS_TABLE} WHERE root_comment_id IN ({placeholders}) AND id <> root_comment_id GROUP BY root_comment_id",
                        tuple(comment_ids),
                    ).fetchall():
                        reply_counts[_normalize_text(reply["root_comment_id"])] = self._as_int(reply["c"])
            items = []
            for row in rows:
                item = dict(row)
                comment_id = _normalize_text(item.get("id"))
                deleted = bool(_normalize_text(item.get("deleted_at")))
                item["is_deleted"] = deleted
                if deleted:
                    item["body"] = "Комментарий удалён"
                item["can_edit"] = bool(not deleted and self._as_int(item.get("user_id")) == user_id)
                item["can_delete"] = bool(
                    not deleted and (is_moderator
                    or self._as_int(item.get("user_id")) == user_id
                    or announcement_author_id == user_id)
                )
                item["reaction_counts"] = reaction_counts.get(comment_id, {})
                item["viewer_reaction"] = viewer_reactions.get(comment_id) or None
                item["attachments"] = [] if deleted else attachments.get(comment_id, [])
                item["reply_count"] = reply_counts.get(comment_id, 0)
                items.append(item)
        return {
            "items": items,
            "total": self._as_int(count_row["c"] if count_row else 0),
            "comments_total": self._as_int(all_count_row["c"] if all_count_row else 0),
            "limit": safe_limit,
            "offset": safe_offset,
            "sort": normalized_sort,
            "next_offset": safe_offset + len(items) if safe_offset + len(items) < self._as_int(count_row["c"] if count_row else 0) else None,
            "cursor": max((_normalize_text(item.get("updated_at")) for item in items), default=_normalize_text(changed_since)),
        }

    def add_announcement_comment(
        self,
        *,
        announcement_id: str,
        user: dict[str, Any],
        body: str,
        parent_comment_id: str = "",
        mentioned_user_ids: list[int] | None = None,
        attachments: list[dict[str, Any]] | None = None,
        client_request_id: str = "",
    ) -> dict[str, Any]:
        ann_id = _normalize_text(announcement_id)
        body_text = _normalize_text(body)
        user_id = self._as_int(user.get("id"))
        if not ann_id or user_id <= 0:
            raise LookupError("Announcement not found")
        attachment_payloads = attachments if isinstance(attachments, list) else []
        if not body_text and not attachment_payloads:
            raise ValueError("Comment must not be empty")
        if len(body_text) > 4000:
            raise ValueError("Comment must contain no more than 4000 characters")
        normalized_request_id = _normalize_text(client_request_id)
        if len(normalized_request_id) > 200:
            raise ValueError("Comment client request id is too long")
        comment_id = str(uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"hub-announcement-comment:{ann_id}:{user_id}:{normalized_request_id}",
        )) if normalized_request_id else str(uuid.uuid4())
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            ann_row = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            if ann_row is None:
                raise LookupError("Announcement not found")
            announcement = dict(ann_row)
            if not self._announcement_is_visible_to_user(
                announcement,
                user_id=user_id,
                is_admin=self._is_admin_role(user.get("role")),
            ):
                raise PermissionError("Announcement is not available for current user")
            if not bool(self._as_int(announcement.get("comments_enabled"), 1)):
                raise ValueError("Comments are disabled for this publication")
            parent_id = _normalize_text(parent_comment_id)
            if normalized_request_id:
                existing = conn.execute(
                    f"SELECT * FROM {self._ANN_COMMENTS_TABLE} WHERE id = ? AND announcement_id = ?",
                    (comment_id, ann_id),
                ).fetchone()
                if existing is not None:
                    existing_item = dict(existing)
                    existing_attachments = [
                        dict(row)
                        for row in conn.execute(
                            f"""SELECT id, comment_id, announcement_id, file_name, file_mime, file_size, uploaded_at
                                FROM {self._ANN_COMMENT_ATTACH_TABLE}
                                WHERE comment_id = ? ORDER BY uploaded_at ASC""",
                            (comment_id,),
                        ).fetchall()
                    ]
                    requested_attachments = [
                        item for item in attachment_payloads
                        if isinstance(item.get("file_bytes"), (bytes, bytearray)) and item.get("file_bytes")
                    ]
                    attachment_matches = len(existing_attachments) == len(requested_attachments) and all(
                        _normalize_text(saved.get("file_name")) == _safe_file_name(_normalize_text(requested.get("file_name"), "file.bin"))
                        and self._as_int(saved.get("file_size")) == len(requested.get("file_bytes") or b"")
                        for saved, requested in zip(existing_attachments, requested_attachments)
                    )
                    if (
                        self._as_int(existing_item.get("user_id")) != user_id
                        or _normalize_text(existing_item.get("body")) != body_text
                        or _normalize_text(existing_item.get("parent_comment_id")) != parent_id
                        or not attachment_matches
                    ):
                        raise ValueError("Comment client request id was already used for another payload")
                    reaction_counts = {
                        _normalize_text(row["reaction_type"]): self._as_int(row["c"])
                        for row in conn.execute(
                            f"SELECT reaction_type, COUNT(*) AS c FROM {self._ANN_COMMENT_REACTIONS_TABLE} WHERE comment_id = ? GROUP BY reaction_type",
                            (comment_id,),
                        ).fetchall()
                    }
                    deleted = bool(_normalize_text(existing_item.get("deleted_at")))
                    existing_item["body"] = "Комментарий удалён" if deleted else body_text
                    existing_item["can_edit"] = not deleted
                    existing_item["can_delete"] = not deleted
                    existing_item["attachments"] = [] if deleted else existing_attachments
                    existing_item["reaction_counts"] = reaction_counts
                    existing_item["viewer_reaction"] = None
                    existing_item["reply_count"] = 0
                    existing_item["is_deleted"] = deleted
                    return existing_item
            parent = None
            root_id = comment_id
            reply_to_user_id = None
            reply_to_username = ""
            if parent_id:
                parent = conn.execute(
                    f"SELECT * FROM {self._ANN_COMMENTS_TABLE} WHERE id = ? AND announcement_id = ?",
                    (parent_id, ann_id),
                ).fetchone()
                if parent is None:
                    raise ValueError("Reply target must belong to the same publication")
                root_id = _normalize_text(parent["root_comment_id"]) or _normalize_text(parent["id"])
                reply_to_user_id = self._as_int(parent["user_id"])
                reply_to_username = _normalize_text(parent["username"])
            conn.execute(
                f"""
                INSERT INTO {self._ANN_COMMENTS_TABLE}
                (id, announcement_id, user_id, username, full_name, body, created_at, updated_at,
                 parent_comment_id, root_comment_id, reply_to_user_id, reply_to_username, change_version)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (
                    comment_id,
                    ann_id,
                    user_id,
                    _normalize_text(user.get("username")),
                    _normalize_text(user.get("full_name")),
                    body_text,
                    now_iso,
                    now_iso,
                    parent_id or None,
                    root_id,
                    reply_to_user_id,
                    reply_to_username,
                ),
            )
            for attachment in attachment_payloads:
                payload = attachment.get("file_bytes")
                if not isinstance(payload, (bytes, bytearray)) or not payload:
                    continue
                attachment_id = str(uuid.uuid4())
                safe_name, rel_path, file_size = self._store_attachment_file(
                    root=self.announcement_comment_attachments_root,
                    parent_id=comment_id,
                    attachment_id=attachment_id,
                    file_name=_normalize_text(attachment.get("file_name"), "file.bin"),
                    file_bytes=bytes(payload),
                )
                conn.execute(
                    f"""INSERT INTO {self._ANN_COMMENT_ATTACH_TABLE}
                        (id, comment_id, announcement_id, file_name, file_path, file_mime, file_size, uploaded_by_user_id, uploaded_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (attachment_id, comment_id, ann_id, safe_name, rel_path, _normalize_text(attachment.get("file_mime")), file_size, user_id, now_iso),
                )
            mentioned_ids = set(self._unique_ints(mentioned_user_ids or []))
            mentioned_users: list[dict[str, Any]] = []
            for mentioned_id in mentioned_ids:
                mentioned_user = user_service.get_by_id(mentioned_id)
                if not mentioned_user or not bool(mentioned_user.get("is_active", True)):
                    continue
                mentioned_users.append(mentioned_user)
                conn.execute(
                    f"""INSERT INTO {self._ANN_COMMENT_MENTIONS_TABLE}
                        (comment_id, user_id, username, full_name) VALUES (?, ?, ?, ?)
                        ON CONFLICT(comment_id, user_id) DO NOTHING""",
                    (comment_id, mentioned_id, _normalize_text(mentioned_user.get("username")), _normalize_text(mentioned_user.get("full_name"))),
                )
            announcement_author_id = self._as_int(announcement.get("author_user_id"))
            recipients: dict[int, tuple[str, str]] = {}
            if parent is None and announcement_author_id > 0:
                recipients[announcement_author_id] = ("announcement.comment_added", "Новый комментарий к публикации")
            if parent is not None and reply_to_user_id:
                recipients[reply_to_user_id] = ("announcement.comment_reply", "Новый ответ на комментарий")
            for mentioned_user in mentioned_users:
                recipients[self._as_int(mentioned_user.get("id"))] = ("announcement.comment_mention", "Вас упомянули в комментарии")
            recipients.pop(user_id, None)
            for recipient_id, (event_type, notification_title) in recipients.items():
                self._create_notification(
                    recipient_user_id=recipient_id,
                    event_type=event_type,
                    title=notification_title,
                    body=self._preview_text(body_text),
                    entity_type="announcement",
                    entity_id=f"{ann_id}#{comment_id}",
                    conn=conn,
                )
            conn.commit()
            created = conn.execute(
                f"SELECT * FROM {self._ANN_COMMENTS_TABLE} WHERE id = ?",
                (comment_id,),
            ).fetchone()
            created_attachments = [
                dict(row)
                for row in conn.execute(
                    f"""SELECT id, comment_id, announcement_id, file_name, file_mime, file_size, uploaded_at
                        FROM {self._ANN_COMMENT_ATTACH_TABLE}
                        WHERE comment_id = ? ORDER BY uploaded_at ASC""",
                    (comment_id,),
                ).fetchall()
            ]
        item = dict(created) if created else {
            "id": comment_id,
            "announcement_id": ann_id,
            "user_id": user_id,
            "body": body_text,
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        item["can_edit"] = True
        item["can_delete"] = True
        item["attachments"] = created_attachments
        item["reaction_counts"] = {}
        item["viewer_reaction"] = None
        item["reply_count"] = 0
        item["is_deleted"] = False
        return item

    def update_announcement_comment(
        self,
        *,
        announcement_id: str,
        comment_id: str,
        user: dict[str, Any],
        body: str,
    ) -> dict[str, Any]:
        ann_id = _normalize_text(announcement_id)
        normalized_comment_id = _normalize_text(comment_id)
        body_text = _normalize_text(body)
        user_id = self._as_int(user.get("id"))
        is_moderator = self._user_can_moderate_announcements(user)
        if not body_text:
            raise ValueError("Comment must not be empty")
        if len(body_text) > 4000:
            raise ValueError("Comment must contain no more than 4000 characters")
        with self._lock, self._connect() as conn:
            ann_row = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            if ann_row is None:
                raise LookupError("Announcement not found")
            if not self._announcement_is_visible_to_user(dict(ann_row), user_id=user_id, is_admin=is_moderator):
                raise PermissionError("Announcement is not available for current user")
            comment = conn.execute(
                f"SELECT * FROM {self._ANN_COMMENTS_TABLE} WHERE id = ? AND announcement_id = ?",
                (normalized_comment_id, ann_id),
            ).fetchone()
            if comment is None:
                raise LookupError("Comment not found")
            if self._as_int(comment["user_id"]) != user_id or _normalize_text(comment["deleted_at"]):
                raise PermissionError("Only comment author can edit it")
            now_iso = _utc_now_iso()
            conn.execute(
                f"UPDATE {self._ANN_COMMENTS_TABLE} SET body = ?, updated_at = ?, change_version = change_version + 1 WHERE id = ?",
                (body_text, now_iso, normalized_comment_id),
            )
            conn.commit()
            updated = conn.execute(
                f"SELECT * FROM {self._ANN_COMMENTS_TABLE} WHERE id = ?",
                (normalized_comment_id,),
            ).fetchone()
        item = dict(updated) if updated else dict(comment)
        item["can_edit"] = True
        item["can_delete"] = True
        return item

    def delete_announcement_comment(
        self,
        *,
        announcement_id: str,
        comment_id: str,
        user: dict[str, Any],
    ) -> bool:
        ann_id = _normalize_text(announcement_id)
        normalized_comment_id = _normalize_text(comment_id)
        user_id = self._as_int(user.get("id"))
        is_moderator = self._user_can_moderate_announcements(user)
        with self._lock, self._connect() as conn:
            ann_row = conn.execute(f"SELECT author_user_id FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            comment = conn.execute(
                f"SELECT user_id FROM {self._ANN_COMMENTS_TABLE} WHERE id = ? AND announcement_id = ?",
                (normalized_comment_id, ann_id),
            ).fetchone()
            if ann_row is None or comment is None:
                return False
            can_delete = bool(
                is_moderator
                or self._as_int(comment["user_id"]) == user_id
                or self._as_int(ann_row["author_user_id"]) == user_id
            )
            if not can_delete:
                raise PermissionError("Only comment author, publication author or admin can delete it")
            conn.execute(
                f"""UPDATE {self._ANN_COMMENTS_TABLE}
                    SET body = '', deleted_at = ?, deleted_by_user_id = ?, updated_at = ?, change_version = change_version + 1
                    WHERE id = ? AND announcement_id = ?""",
                (_utc_now_iso(), user_id, _utc_now_iso(), normalized_comment_id, ann_id),
            )
            conn.commit()
        return True

    def set_announcement_comment_reaction(
        self,
        *,
        announcement_id: str,
        comment_id: str,
        user: dict[str, Any],
        reaction_type: str | None,
    ) -> dict[str, Any]:
        ann_id = _normalize_text(announcement_id)
        normalized_comment_id = _normalize_text(comment_id)
        user_id = self._as_int(user.get("id"))
        normalized_reaction = _normalize_text(reaction_type).lower()
        if normalized_reaction and normalized_reaction not in self._REACTION_TYPES:
            raise ValueError("Unsupported reaction")
        with self._lock, self._connect() as conn:
            announcement = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            comment = conn.execute(
                f"SELECT id FROM {self._ANN_COMMENTS_TABLE} WHERE id = ? AND announcement_id = ?",
                (normalized_comment_id, ann_id),
            ).fetchone()
            if announcement is None or comment is None:
                raise LookupError("Comment not found")
            if not self._announcement_is_visible_to_user(dict(announcement), user_id=user_id, is_admin=self._user_can_moderate_announcements(user)):
                raise PermissionError("Announcement is not available for current user")
            if not bool(self._as_int(announcement["reactions_enabled"], 1)):
                raise ValueError("Reactions are disabled for this publication")
            if normalized_reaction:
                now_iso = _utc_now_iso()
                conn.execute(
                    f"""INSERT INTO {self._ANN_COMMENT_REACTIONS_TABLE}
                        (comment_id, user_id, reaction_type, username, full_name, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(comment_id, user_id) DO UPDATE SET
                          reaction_type = excluded.reaction_type, username = excluded.username,
                          full_name = excluded.full_name, updated_at = excluded.updated_at""",
                    (normalized_comment_id, user_id, normalized_reaction, _normalize_text(user.get("username")), _normalize_text(user.get("full_name")), now_iso, now_iso),
                )
            else:
                conn.execute(
                    f"DELETE FROM {self._ANN_COMMENT_REACTIONS_TABLE} WHERE comment_id = ? AND user_id = ?",
                    (normalized_comment_id, user_id),
                )
            rows = conn.execute(
                f"SELECT reaction_type, COUNT(*) AS c FROM {self._ANN_COMMENT_REACTIONS_TABLE} WHERE comment_id = ? GROUP BY reaction_type",
                (normalized_comment_id,),
            ).fetchall()
            conn.commit()
        counts = {_normalize_text(row["reaction_type"]): self._as_int(row["c"]) for row in rows}
        return {"comment_id": normalized_comment_id, "viewer_reaction": normalized_reaction or None, "reaction_counts": counts}

    def list_announcement_reaction_users(self, *, announcement_id: str, reaction_type: str = "") -> list[dict[str, Any]]:
        ann_id = _normalize_text(announcement_id)
        normalized_reaction = _normalize_text(reaction_type).lower()
        with self._lock, self._connect() as conn:
            if normalized_reaction:
                rows = conn.execute(
                    f"SELECT user_id, username, full_name, reaction_type, updated_at FROM {self._ANN_REACTIONS_TABLE} WHERE announcement_id = ? AND reaction_type = ? ORDER BY updated_at DESC",
                    (ann_id, normalized_reaction),
                ).fetchall()
            else:
                rows = conn.execute(
                    f"SELECT user_id, username, full_name, reaction_type, updated_at FROM {self._ANN_REACTIONS_TABLE} WHERE announcement_id = ? ORDER BY updated_at DESC",
                    (ann_id,),
                ).fetchall()
        return [dict(row) for row in rows]

    def set_announcement_bookmark(self, *, announcement_id: str, user: dict[str, Any], bookmarked: bool) -> dict[str, Any]:
        ann_id = _normalize_text(announcement_id)
        user_id = self._as_int(user.get("id"))
        with self._lock, self._connect() as conn:
            row = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            if row is None:
                raise LookupError("Announcement not found")
            if not self._announcement_is_visible_to_user(dict(row), user_id=user_id, is_admin=self._user_can_moderate_announcements(user)):
                raise PermissionError("Announcement is not available for current user")
            if bookmarked:
                conn.execute(
                    f"INSERT INTO {self._ANN_BOOKMARKS_TABLE} (announcement_id, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT(announcement_id, user_id) DO NOTHING",
                    (ann_id, user_id, _utc_now_iso()),
                )
            else:
                conn.execute(f"DELETE FROM {self._ANN_BOOKMARKS_TABLE} WHERE announcement_id = ? AND user_id = ?", (ann_id, user_id))
            conn.commit()
        return {"announcement_id": ann_id, "viewer_bookmarked": bool(bookmarked)}

    def vote_announcement_poll(
        self,
        *,
        announcement_id: str,
        user: dict[str, Any],
        option_ids: list[str],
    ) -> dict[str, Any]:
        ann_id = _normalize_text(announcement_id)
        user_id = self._as_int(user.get("id"))
        selected_ids = self._unique_texts(option_ids)
        with self._lock, self._connect() as conn:
            announcement = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            if announcement is None:
                raise LookupError("Announcement not found")
            if not self._announcement_is_visible_to_user(
                dict(announcement),
                user_id=user_id,
                is_admin=self._user_can_moderate_announcements(user),
            ):
                raise PermissionError("Announcement is not available for current user")
            poll = conn.execute(
                f"SELECT * FROM {self._ANN_POLLS_TABLE} WHERE announcement_id = ?",
                (ann_id,),
            ).fetchone()
            if poll is None:
                raise LookupError("Poll not found")
            closes_at = self._parse_iso_datetime(poll["closes_at"])
            if closes_at and closes_at <= datetime.now(timezone.utc):
                raise ValueError("Poll is closed")
            poll_id = _normalize_text(poll["id"])
            available_ids = {
                _normalize_text(row["id"])
                for row in conn.execute(
                    f"SELECT id FROM {self._ANN_POLL_OPTIONS_TABLE} WHERE poll_id = ?",
                    (poll_id,),
                ).fetchall()
            }
            if any(option_id not in available_ids for option_id in selected_ids):
                raise ValueError("Poll option is not available")
            if not bool(self._as_int(poll["allows_multiple"])) and len(selected_ids) > 1:
                raise ValueError("Only one poll option can be selected")
            conn.execute(
                f"DELETE FROM {self._ANN_POLL_VOTES_TABLE} WHERE poll_id = ? AND user_id = ?",
                (poll_id, user_id),
            )
            now_iso = _utc_now_iso()
            for option_id in selected_ids:
                conn.execute(
                    f"INSERT INTO {self._ANN_POLL_VOTES_TABLE} (poll_id, option_id, user_id, created_at) VALUES (?, ?, ?, ?)",
                    (poll_id, option_id, user_id, now_iso),
                )
            conn.commit()
            poll_payload = self._load_announcement_polls(conn, viewer_user_id=user_id).get(ann_id)
        return {"announcement_id": ann_id, "poll": poll_payload}

    def list_announcement_categories(self, *, include_inactive: bool = False) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            where = "" if include_inactive else "WHERE is_active = 1"
            rows = conn.execute(f"SELECT * FROM {self._ANN_CATEGORIES_TABLE} {where} ORDER BY name ASC").fetchall()
        return [dict(row) | {"is_active": bool(self._as_int(row["is_active"]))} for row in rows]

    def save_announcement_category(self, *, payload: dict[str, Any], actor_user_id: int, category_id: str = "") -> dict[str, Any]:
        name = _normalize_text(payload.get("name"))[:80]
        if len(name) < 2:
            raise ValueError("Category name must contain at least 2 characters")
        normalized_id = _normalize_text(category_id) or str(uuid.uuid4())
        slug = self._feed_slug(payload.get("slug") or name)
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            duplicate = conn.execute(f"SELECT id FROM {self._ANN_CATEGORIES_TABLE} WHERE slug = ? AND id <> ?", (slug, normalized_id)).fetchone()
            if duplicate is not None:
                raise ValueError("Category with this name already exists")
            conn.execute(
                f"""INSERT INTO {self._ANN_CATEGORIES_TABLE}
                    (id, name, slug, is_active, created_by_user_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET name = excluded.name, slug = excluded.slug,
                      is_active = excluded.is_active, updated_at = excluded.updated_at""",
                (normalized_id, name, slug, 1 if payload.get("is_active") is not False else 0, self._as_int(actor_user_id), now_iso, now_iso),
            )
            conn.commit()
            row = conn.execute(f"SELECT * FROM {self._ANN_CATEGORIES_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
        return dict(row) if row else {"id": normalized_id, "name": name, "slug": slug}

    def delete_announcement_category(self, category_id: str) -> bool:
        normalized_id = _normalize_text(category_id)
        with self._lock, self._connect() as conn:
            conn.execute(f"UPDATE {self._ANN_CATEGORIES_TABLE} SET is_active = 0, updated_at = ? WHERE id = ?", (_utc_now_iso(), normalized_id))
            changed = conn.execute(f"SELECT id FROM {self._ANN_CATEGORIES_TABLE} WHERE id = ?", (normalized_id,)).fetchone() is not None
            conn.commit()
        return changed

    def list_announcement_tags(self) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"""SELECT t.id, t.name, t.slug, COUNT(l.announcement_id) AS usage_count
                    FROM {self._ANN_TAGS_TABLE} t LEFT JOIN {self._ANN_TAG_LINKS_TABLE} l ON l.tag_id = t.id
                    GROUP BY t.id, t.name, t.slug ORDER BY usage_count DESC, t.name ASC"""
            ).fetchall()
        return [dict(row) for row in rows]

    def list_managed_announcements(self, *, user: dict[str, Any], status: str = "draft", limit: int = 100) -> dict[str, Any]:
        normalized_status = _normalize_text(status, "draft").lower()
        if normalized_status not in self._ANNOUNCEMENT_STATUSES:
            raise ValueError("Unsupported publication status")
        user_id = self._as_int(user.get("id"))
        moderator = self._user_can_moderate_announcements(user)
        with self._lock, self._connect() as conn:
            params: list[Any] = [normalized_status]
            where = "status = ?"
            if not moderator:
                where += " AND author_user_id = ?"
                params.append(user_id)
            params.append(self._coerce_limit(limit, default=100, minimum=1, maximum=300))
            rows = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE {where} ORDER BY updated_at DESC LIMIT ?", tuple(params)).fetchall()
            reads = self._load_announcement_reads_for_user(conn, user_id=user_id)
            attachment_counts = self._load_announcement_attachment_counts(conn)
            attachments = self._load_announcement_attachments_by_announcement(conn)
            covers = self._load_announcement_cover_attachments(conn)
            reactions, comment_counts, viewer_reactions, bookmarks = self._load_announcement_social_state(
                conn,
                viewer_user_id=user_id,
            )
            categories, tags = self._load_announcement_taxonomy_state(conn)
            polls = self._load_announcement_polls(conn, viewer_user_id=user_id)
            items = []
            for row in rows:
                announcement_id = _normalize_text(row["id"])
                items.append(self._build_announcement_item(
                    conn,
                    row,
                    viewer_user_id=user_id,
                    is_admin=moderator,
                    include_hidden_for_manager=True,
                    read_row=reads.get(announcement_id, {}),
                    attachments=attachments.get(announcement_id, []),
                    attachments_count=attachment_counts.get(announcement_id, 0),
                    reaction_counts=reactions.get(announcement_id, {}),
                    comments_count=comment_counts.get(announcement_id, 0),
                    viewer_reaction=viewer_reactions.get(announcement_id, ""),
                    viewer_bookmarked=announcement_id in bookmarks,
                    category=categories.get(announcement_id),
                    tags=tags.get(announcement_id, []),
                    cover_attachment=covers.get(announcement_id),
                    poll=polls.get(announcement_id, {}),
                ))
        return {"items": [item for item in items if item], "status": normalized_status}

    def publish_announcement(self, *, announcement_id: str, user: dict[str, Any]) -> dict[str, Any]:
        ann_id = _normalize_text(announcement_id)
        user_id = self._as_int(user.get("id"))
        moderator = self._user_can_moderate_announcements(user)
        push_jobs: list[dict[str, Any]] = []
        with self._lock, self._connect() as conn:
            row = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            if row is None:
                raise LookupError("Announcement not found")
            item = dict(row)
            if not moderator and self._as_int(item.get("author_user_id")) != user_id:
                raise PermissionError("Only publication author or moderator can publish it")
            now = datetime.now(timezone.utc)
            scheduled_at = self._parse_iso_datetime(item.get("published_from"))
            status = "scheduled" if scheduled_at and scheduled_at > now else "published"
            self._validate_announcement_publication({**item, "status": status})
            self._validate_announcement_poll_for_publish(conn, ann_id)
            notified_at = _normalize_text(item.get("publication_notified_at")) or None
            if status == "published" and not notified_at:
                push_jobs = self._create_announcement_notifications(
                    conn, announcement=item, event_type="announcement.new",
                    title="Новая публикация в ленте", body=self._preview_text(item.get("title")), actor_user_id=user_id,
                )
                notified_at = _utc_now_iso()
            conn.execute(
                f"UPDATE {self._ANN_TABLE} SET status = ?, is_active = 1, publication_notified_at = ?, published_at = ?, updated_at = ? WHERE id = ?",
                (status, notified_at, _utc_now_iso(), _utc_now_iso(), ann_id),
            )
            conn.commit()
        self._schedule_hub_push_jobs(push_jobs)
        return self.get_announcement(ann_id, user_id=user_id, is_admin=moderator) or {}

    def archive_announcement(self, *, announcement_id: str, user: dict[str, Any]) -> dict[str, Any]:
        return self.update_announcement(
            announcement_id,
            {"status": "archived", "is_active": False},
            actor_user_id=self._as_int(user.get("id")),
            is_admin=self._user_can_moderate_announcements(user),
        ) or {}

    def publish_due_announcements(self, *, limit: int = 100) -> int:
        now_iso = _utc_now_iso()
        published = 0
        all_jobs: list[dict[str, Any]] = []
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE status = 'scheduled' AND published_from IS NOT NULL AND published_from <= ? ORDER BY published_from ASC LIMIT ?",
                (now_iso, self._coerce_limit(limit, default=100, minimum=1, maximum=500)),
            ).fetchall()
            for row in rows:
                item = dict(row)
                ann_id = _normalize_text(item.get("id"))
                cursor = conn.execute(
                    f"UPDATE {self._ANN_TABLE} SET status = 'published', is_active = 1, published_at = ?, updated_at = ? WHERE id = ? AND status = 'scheduled'",
                    (now_iso, now_iso, ann_id),
                )
                if getattr(cursor, "rowcount", 1) == 0:
                    continue
                if not _normalize_text(item.get("publication_notified_at")):
                    all_jobs.extend(self._create_announcement_notifications(
                        conn, announcement=item, event_type="announcement.new",
                        title="Новая публикация в ленте", body=self._preview_text(item.get("title")), actor_user_id=self._as_int(item.get("author_user_id")),
                    ))
                    conn.execute(f"UPDATE {self._ANN_TABLE} SET publication_notified_at = ? WHERE id = ?", (now_iso, ann_id))
                published += 1
            conn.commit()
        self._schedule_hub_push_jobs(all_jobs)
        return published

    def get_announcement_analytics(self, *, announcement_id: str) -> dict[str, Any]:
        reads = self.get_announcement_reads(announcement_id)
        with self._lock, self._connect() as conn:
            reaction_rows = conn.execute(
                f"SELECT reaction_type, COUNT(*) AS c FROM {self._ANN_REACTIONS_TABLE} WHERE announcement_id = ? GROUP BY reaction_type",
                (_normalize_text(announcement_id),),
            ).fetchall()
            comment_row = conn.execute(
                f"SELECT COUNT(*) AS c FROM {self._ANN_COMMENTS_TABLE} WHERE announcement_id = ? AND deleted_at IS NULL",
                (_normalize_text(announcement_id),),
            ).fetchone()
            poll_payload = self._load_announcement_polls(conn, viewer_user_id=0).get(_normalize_text(announcement_id))
        reads["summary"]["reaction_counts"] = {_normalize_text(row["reaction_type"]): self._as_int(row["c"]) for row in reaction_rows}
        reads["summary"]["comments_total"] = self._as_int(comment_row["c"] if comment_row else 0)
        reads["summary"]["poll_total_voters"] = self._as_int((poll_payload or {}).get("total_voters"))
        reads["summary"]["poll_total_votes"] = self._as_int((poll_payload or {}).get("total_votes"))
        return reads

    def add_announcement_attachment(
        self,
        *,
        announcement_id: str,
        user: dict[str, Any],
        file_name: str,
        file_bytes: bytes,
        file_mime: str = "",
        client_upload_id: str = "",
    ) -> dict[str, Any]:
        ann_id = _normalize_text(announcement_id)
        user_id = self._as_int(user.get("id"))
        normalized_upload_id = _normalize_text(client_upload_id)
        if len(normalized_upload_id) > 200:
            raise ValueError("Attachment client upload id is too long")
        with self._lock, self._connect() as conn:
            announcement = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            if announcement is None:
                raise LookupError("Announcement not found")
            if not self._user_can_moderate_announcements(user) and self._as_int(announcement["author_user_id"]) != user_id:
                raise PermissionError("Only publication author or moderator can change attachments")
            attachment_id = str(uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"hub-announcement-attachment:{ann_id}:{user_id}:{normalized_upload_id}",
            )) if normalized_upload_id else str(uuid.uuid4())
            if normalized_upload_id:
                existing = conn.execute(
                    f"SELECT * FROM {self._ANN_ATTACH_TABLE} WHERE id = ? AND announcement_id = ?",
                    (attachment_id, ann_id),
                ).fetchone()
                if existing is not None:
                    existing_item = dict(existing)
                    if (
                        _normalize_text(existing_item.get("file_name")) != _safe_file_name(file_name or "file.bin")
                        or self._as_int(existing_item.get("file_size")) != len(file_bytes or b"")
                        or _normalize_text(existing_item.get("file_mime")) != _normalize_text(file_mime)
                    ):
                        raise ValueError("Attachment client upload id was already used for another file")
                    return self._attachment_row_to_dict(existing)
            order_row = conn.execute(f"SELECT COALESCE(MAX(sort_order), -1) AS n FROM {self._ANN_ATTACH_TABLE} WHERE announcement_id = ?", (ann_id,)).fetchone()
            safe_name, rel_path, file_size = self._store_attachment_file(root=self.announcement_attachments_root, parent_id=ann_id, attachment_id=attachment_id, file_name=file_name, file_bytes=file_bytes)
            is_image = _normalize_text(file_mime).lower().startswith("image/") or self._announcement_attachment_is_image({"file_name": safe_name})
            cover_row = conn.execute(f"SELECT id FROM {self._ANN_ATTACH_TABLE} WHERE announcement_id = ? AND is_cover = 1", (ann_id,)).fetchone()
            conn.execute(
                f"""INSERT INTO {self._ANN_ATTACH_TABLE}
                    (id, announcement_id, file_name, file_path, file_mime, file_size, uploaded_by_user_id, uploaded_by_username, uploaded_at, sort_order, is_cover)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (attachment_id, ann_id, safe_name, rel_path, _normalize_text(file_mime), file_size, user_id, _normalize_text(user.get("username")), _utc_now_iso(), self._as_int(order_row["n"]) + 1, 1 if is_image and cover_row is None else 0),
            )
            conn.commit()
            row = conn.execute(f"SELECT * FROM {self._ANN_ATTACH_TABLE} WHERE id = ?", (attachment_id,)).fetchone()
        return self._attachment_row_to_dict(row) if row else {"id": attachment_id}

    def update_announcement_attachment_order(self, *, announcement_id: str, user: dict[str, Any], attachment_ids: list[str], cover_attachment_id: str = "") -> list[dict[str, Any]]:
        ann_id = _normalize_text(announcement_id)
        with self._lock, self._connect() as conn:
            announcement = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            if announcement is None:
                raise LookupError("Announcement not found")
            if not self._user_can_moderate_announcements(user) and self._as_int(announcement["author_user_id"]) != self._as_int(user.get("id")):
                raise PermissionError("Only publication author or moderator can change attachments")
            existing_rows = conn.execute(
                f"SELECT id, file_name, file_mime FROM {self._ANN_ATTACH_TABLE} WHERE announcement_id = ?",
                (ann_id,),
            ).fetchall()
            existing_by_id = {_normalize_text(row["id"]): dict(row) for row in existing_rows}
            existing = set(existing_by_id)
            ordered = [value for value in self._unique_texts(attachment_ids) if value in existing]
            ordered.extend(sorted(existing - set(ordered)))
            normalized_cover_id = _normalize_text(cover_attachment_id)
            if normalized_cover_id:
                cover = existing_by_id.get(normalized_cover_id)
                if cover is None or not self._announcement_attachment_is_image(cover):
                    raise ValueError("Publication cover must be an image")
            for index, attachment_id in enumerate(ordered):
                conn.execute(f"UPDATE {self._ANN_ATTACH_TABLE} SET sort_order = ?, is_cover = ? WHERE id = ? AND announcement_id = ?", (index, 1 if attachment_id == normalized_cover_id else 0, attachment_id, ann_id))
            conn.commit()
            return self._list_announcement_attachments(conn, ann_id)

    def delete_announcement_attachment(self, *, announcement_id: str, attachment_id: str, user: dict[str, Any]) -> bool:
        ann_id = _normalize_text(announcement_id)
        with self._lock, self._connect() as conn:
            announcement = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            row = conn.execute(f"SELECT * FROM {self._ANN_ATTACH_TABLE} WHERE id = ? AND announcement_id = ?", (_normalize_text(attachment_id), ann_id)).fetchone()
            if announcement is None or row is None:
                return False
            if not self._user_can_moderate_announcements(user) and self._as_int(announcement["author_user_id"]) != self._as_int(user.get("id")):
                raise PermissionError("Only publication author or moderator can change attachments")
            conn.execute(f"DELETE FROM {self._ANN_ATTACH_TABLE} WHERE id = ?", (_normalize_text(attachment_id),))
            conn.commit()
        self._remove_relative_files([_normalize_text(row["file_path"])])
        return True

    def get_announcement_comment_attachment(self, *, announcement_id: str, comment_id: str, attachment_id: str) -> Optional[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"SELECT * FROM {self._ANN_COMMENT_ATTACH_TABLE} WHERE id = ? AND comment_id = ? AND announcement_id = ?",
                (_normalize_text(attachment_id), _normalize_text(comment_id), _normalize_text(announcement_id)),
            ).fetchone()
            if row is None:
                return None
            item = dict(row)
            item["file_abs_path"] = str((self.data_dir / _normalize_text(item.get("file_path"))).resolve())
            return item

    def get_announcement_attachment(self, *, announcement_id: str, attachment_id: str) -> Optional[dict[str, Any]]:
        ann_id = _normalize_text(announcement_id)
        normalized_attachment_id = _normalize_text(attachment_id)
        if not ann_id or not normalized_attachment_id:
            return None
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"""
                SELECT id, announcement_id, file_name, file_path, file_mime, file_size, uploaded_by_user_id, uploaded_by_username, uploaded_at
                FROM {self._ANN_ATTACH_TABLE}
                WHERE id = ? AND announcement_id = ?
                """,
                (normalized_attachment_id, ann_id),
            ).fetchone()
            if row is None:
                return None
            item = dict(row)
            rel_path = _normalize_text(item.get("file_path"))
            item["file_abs_path"] = str((self.data_dir / rel_path).resolve()) if rel_path else ""
            item["file_size"] = self._as_int(item.get("file_size"))
            return item

    def add_task_attachment(
        self,
        *,
        task_id: str,
        user: dict[str, Any],
        file_name: str,
        file_bytes: bytes,
        file_mime: Optional[str],
        can_review: bool = False,
    ) -> Optional[dict[str, Any]]:
        normalized_task_id = _normalize_text(task_id)
        if not normalized_task_id:
            return None
        payload = bytes(file_bytes or b"")
        if not payload:
            raise ValueError("Attachment payload is empty")

        user_id = self._as_int(user.get("id"))
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_task_id,)).fetchone()
            if row is None:
                return None
            task = dict(row)
            is_assignee = user_id in self._task_assignee_user_ids(task)
            is_creator = self._as_int(task.get("created_by_user_id")) == user_id
            is_controller = self._as_int(task.get("controller_user_id")) == user_id
            # Compatibility fallback for legacy tasks that might not have controller assigned yet.
            controller_missing = self._as_int(task.get("controller_user_id")) <= 0
            if not (is_assignee or is_creator or is_controller or (bool(can_review) and controller_missing)):
                raise PermissionError("Only assignee, creator, or reviewer can attach files")

            attachment_id = str(uuid.uuid4())
            safe_name, rel_path, file_size = self._store_attachment_file(
                root=self.task_attachments_root,
                parent_id=normalized_task_id,
                attachment_id=attachment_id,
                file_name=file_name,
                file_bytes=payload,
            )
            self._insert_task_attachment(
                conn=conn,
                attachment_id=attachment_id,
                task_id=normalized_task_id,
                scope="task",
                file_name=safe_name,
                file_path=rel_path,
                file_mime=file_mime,
                file_size=file_size,
                user_id=user_id,
                username=_normalize_text(user.get("username")),
                uploaded_at=now_iso,
            )
            conn.execute(
                f"UPDATE {self._TASKS_TABLE} SET updated_at = ? WHERE id = ?",
                (now_iso, normalized_task_id),
            )
            conn.commit()
            created_row = conn.execute(
                f"""
                SELECT id, task_id, scope, file_name, file_path, file_mime, file_size, uploaded_by_user_id, uploaded_by_username, uploaded_at
                FROM {self._TASK_ATTACH_TABLE}
                WHERE id = ?
                """,
                (attachment_id,),
            ).fetchone()
            result = self._attachment_row_to_dict(created_row) if created_row else None
        self._publish_task_realtime(
            task={**task, "updated_at": now_iso},
            operation="attachment_added",
            actor_user_id=user_id,
        )
        return result

    def add_task_attachment_from_path(
        self,
        *,
        task_id: str,
        source_path: str | Path,
        file_name: Optional[str] = None,
        file_mime: Optional[str] = None,
        scope: str = "transfer_act_generated",
        uploaded_by_user_id: int = 0,
        uploaded_by_username: str = "system",
    ) -> Optional[dict[str, Any]]:
        """Attach an existing file to a task (internal/system use, no permission gate)."""
        normalized_task_id = _normalize_text(task_id)
        if not normalized_task_id:
            return None
        abs_path = Path(source_path).expanduser().resolve()
        if not abs_path.is_file():
            raise FileNotFoundError(f"Attachment source not found: {abs_path}")
        payload = abs_path.read_bytes()
        if not payload:
            raise ValueError("Attachment payload is empty")

        safe_name = _normalize_text(file_name) or abs_path.name or "file.bin"
        normalized_mime = _normalize_text(file_mime) or None
        user_id = self._as_int(uploaded_by_user_id)
        username = _normalize_text(uploaded_by_username, "system")
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_task_id,)).fetchone()
            if row is None:
                return None
            task = dict(row)
            attachment_id = str(uuid.uuid4())
            stored_name, rel_path, file_size = self._store_attachment_file(
                root=self.task_attachments_root,
                parent_id=normalized_task_id,
                attachment_id=attachment_id,
                file_name=safe_name,
                file_bytes=payload,
            )
            self._insert_task_attachment(
                conn=conn,
                attachment_id=attachment_id,
                task_id=normalized_task_id,
                scope=_normalize_text(scope, "transfer_act_generated"),
                file_name=stored_name,
                file_path=rel_path,
                file_mime=normalized_mime,
                file_size=file_size,
                user_id=user_id,
                username=username,
                uploaded_at=now_iso,
            )
            conn.execute(
                f"UPDATE {self._TASKS_TABLE} SET updated_at = ? WHERE id = ?",
                (now_iso, normalized_task_id),
            )
            conn.commit()
            created_row = conn.execute(
                f"""
                SELECT id, task_id, scope, file_name, file_path, file_mime, file_size, uploaded_by_user_id, uploaded_by_username, uploaded_at
                FROM {self._TASK_ATTACH_TABLE}
                WHERE id = ?
                """,
                (attachment_id,),
            ).fetchone()
            result = self._attachment_row_to_dict(created_row) if created_row else None
        self._publish_task_realtime(
            task={**task, "updated_at": now_iso},
            operation="attachment_added",
            actor_user_id=user_id,
        )
        return result

    def get_task_attachment(self, *, task_id: str, attachment_id: str) -> Optional[dict[str, Any]]:
        normalized_task_id = _normalize_text(task_id)
        normalized_attachment_id = _normalize_text(attachment_id)
        if not normalized_task_id or not normalized_attachment_id:
            return None
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"""
                SELECT id, task_id, scope, file_name, file_path, file_mime, file_size, uploaded_by_user_id, uploaded_by_username, uploaded_at
                FROM {self._TASK_ATTACH_TABLE}
                WHERE id = ? AND task_id = ?
                """,
                (normalized_attachment_id, normalized_task_id),
            ).fetchone()
            if row is None:
                return None
            item = dict(row)
            rel_path = _normalize_text(item.get("file_path"))
            item["file_abs_path"] = str((self.data_dir / rel_path).resolve()) if rel_path else ""
            item["file_size"] = self._as_int(item.get("file_size"))
            return item

    def create_task(
        self,
        *,
        title: str,
        description: str,
        assignee_user_id: int,
        controller_user_id: int,
        due_at: Optional[str],
        assignee_user_ids: Optional[list[int]] = None,
        project_id: Optional[str] = None,
        object_id: Optional[str] = None,
        protocol_date: Optional[str] = None,
        priority: Optional[str] = "normal",
        checklist_items: Optional[list[dict[str, Any]]] = None,
        department_id: Optional[str] = None,
        visibility_scope: Optional[str] = None,
        email_deadline_remind_hours: int | None = None,
        observer_user_ids: Optional[list[int]] = None,
        actor: dict[str, Any],
        initial_status: str = "new",
    ) -> dict[str, Any]:
        started_at = time.perf_counter()
        stages: dict[str, float] = {}
        validate_started = time.perf_counter()
        title_text = _normalize_text(title)
        if len(title_text) < 3:
            raise ValueError("Task title must contain at least 3 characters")
        assignees = self._resolve_active_task_assignees(
            assignee_user_ids,
            fallback_assignee_user_id=assignee_user_id,
        )
        assignee = assignees[0]
        normalized_department_id = _normalize_text(department_id)
        if normalized_department_id and not department_service.get_department(normalized_department_id):
            raise ValueError("Department is not available")
        controller_id = self._as_int(controller_user_id)
        controller = None
        if controller_id > 0:
            controller = user_service.get_by_id(controller_id)
            if not controller or not bool(controller.get("is_active", True)):
                raise ValueError("Controller user is not available")
            if not (self._user_can_review_tasks(controller) or (normalized_department_id and user_is_department_manager(controller, normalized_department_id))):
                raise ValueError("Controller must have tasks.review permission or be department manager")
        if normalized_department_id:
            for target_assignee in assignees:
                if not can_create_task_for_department(
                    actor,
                    department_id=normalized_department_id,
                    assignee=target_assignee,
                ):
                    raise PermissionError("Task cannot be assigned in the selected department")

        now_iso = _utc_now_iso()
        task_id = str(uuid.uuid4())
        priority_text = _normalize_text(priority, "normal").lower()
        if priority_text not in {"low", "normal", "high", "urgent"}:
            priority_text = "normal"
        initial_status_text = _normalize_text(initial_status, "new").lower()
        if initial_status_text not in self._TASK_STATUSES:
            raise ValueError("Unsupported initial task status")
        visibility_scope_text = normalize_visibility_scope(visibility_scope, default=VISIBILITY_PRIVATE)
        if not normalized_department_id:
            visibility_scope_text = VISIBILITY_PRIVATE
        stages["validate_ms"] = self._elapsed_ms(validate_started)

        assignee_id = self._as_int(assignee.get("id"))
        normalized_assignee_ids = [self._as_int(item.get("id")) for item in assignees]
        actor_id = self._as_int(actor.get("id"))
        creator_id = actor_id
        normalized_observer_ids = self._normalize_observer_user_ids(
            observer_user_ids,
            creator_user_id=creator_id,
            assignee_user_id=assignee_id,
            assignee_user_ids=normalized_assignee_ids,
            controller_user_id=controller_id,
        )
        db_started = time.perf_counter()
        with self._db_conn(write=True) as conn:
            self._ensure_task_status_log_table(conn)
            validated_project_id, validated_object_id = self._validate_task_project_object(
                conn,
                project_id=project_id,
                object_id=object_id,
            )
            if not validated_project_id:
                raise ValueError("project_id is required")
            normalized_protocol_date = self._normalize_protocol_date(protocol_date) or self._normalize_protocol_date(now_iso)
            serialized_checklist_items = self._serialize_checklist_items(checklist_items)
            normalized_due_at = _normalize_text(due_at) or None
            normalized_email_deadline_remind_hours = None
            if normalized_due_at and email_deadline_remind_hours is not None:
                normalized_email_deadline_remind_hours = _normalize_email_deadline_remind_hours(email_deadline_remind_hours)
            serialized_observer_user_ids = self._serialize_json_list(normalized_observer_ids)
            serialized_assignee_user_ids = self._serialize_json_list(normalized_assignee_ids)
            conn.execute(
                f"""
                INSERT INTO {self._TASKS_TABLE}
                (id, title, description, status, due_at, email_deadline_remind_hours, priority, checklist_items, project_id, object_id, protocol_date, completed_at, completed_at_source,
                 department_id, visibility_scope, observer_user_ids,
                 assignee_user_id, assignee_user_ids, assignee_username, assignee_full_name,
                 controller_user_id, controller_username, controller_full_name,
                 created_by_user_id, created_by_username, created_by_full_name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    title_text,
                    _normalize_text(description),
                    initial_status_text,
                    normalized_due_at,
                    normalized_email_deadline_remind_hours,
                    priority_text,
                    serialized_checklist_items,
                    validated_project_id,
                    validated_object_id,
                    normalized_protocol_date,
                    now_iso if initial_status_text == "done" else None,
                    "explicit" if initial_status_text == "done" else None,
                    normalized_department_id or None,
                    visibility_scope_text,
                    serialized_observer_user_ids,
                    assignee_id,
                    serialized_assignee_user_ids,
                    _normalize_text(assignee.get("username")),
                    _normalize_text(assignee.get("full_name")) or _normalize_text(assignee.get("username")),
                    controller_id if controller else 0,
                    _normalize_text(controller.get("username")) if controller else "",
                    (_normalize_text(controller.get("full_name")) or _normalize_text(controller.get("username"))) if controller else "",
                    creator_id,
                    _normalize_text(actor.get("username")),
                    _normalize_text(actor.get("full_name")) or _normalize_text(actor.get("username")),
                    now_iso,
                    now_iso,
                ),
            )
            self._log_status_change(
                conn,
                task_id=task_id,
                old_status="",
                new_status=initial_status_text,
                user_id=actor_id,
                username=_normalize_text(actor.get("username")),
            )
            conn.commit()
        stages["db_write_ms"] = self._elapsed_ms(db_started)

        assignee_recipients = set(normalized_assignee_ids)
        for target_assignee_id in normalized_assignee_ids:
            assignee_recipients.update(self._task_delegate_user_ids(target_assignee_id))
        recipient_count = len(assignee_recipients) + (1 if controller_id > 0 else 0) + len(normalized_observer_ids)
        notify_started = time.perf_counter()
        with self._hub_push_deferred() as push_stats:
            with self._db_conn(write=True) as conn:
                self._create_task_notifications(
                    conn,
                    recipient_user_ids=assignee_recipients,
                    skip_user_ids={actor_id},
                    event_type="task.assigned",
                    title="Новая задача",
                    body=title_text,
                    task_id=task_id,
                )
                if controller_id > 0:
                    self._create_task_notifications(
                        conn,
                        recipient_user_ids={controller_id},
                        skip_user_ids={actor_id, *normalized_assignee_ids},
                        event_type="task.controller_assigned",
                        title="Вы назначены контролером задачи",
                        body=title_text,
                        task_id=task_id,
                    )
                if normalized_observer_ids:
                    self._create_task_notifications(
                        conn,
                        recipient_user_ids=set(normalized_observer_ids),
                        skip_user_ids={actor_id, *normalized_assignee_ids, controller_id},
                        event_type="task.observer_added",
                        title="Вас добавили наблюдателем задачи",
                        body=title_text,
                        task_id=task_id,
                    )
                conn.commit()
            stages["notifications_ms"] = self._elapsed_ms(notify_started)
            enrich_started = time.perf_counter()
            with self._db_conn(write=False) as conn:
                row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (task_id,)).fetchone()
                result = self._task_with_latest_report(conn, row, viewer_user_id=actor_id) if row else {}
            stages["enrich_ms"] = self._elapsed_ms(enrich_started)
        stages["push_flush_ms"] = float(push_stats.get("push_flush_ms") or 0.0)
        self._log_task_write_timing(
            "create",
            started_at=started_at,
            stages=stages,
            task_id=task_id,
            recipients=recipient_count,
            push_jobs=int(push_stats.get("push_jobs") or 0),
        )
        self._publish_task_realtime(
            task=result,
            operation="created",
            actor_user_id=actor_id,
        )
        return result

    def update_task(
        self,
        task_id: str,
        payload: dict[str, Any],
        *,
        actor_user_id: int,
        is_admin: bool = False,
    ) -> Optional[dict[str, Any]]:
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return None
        actor_id = self._as_int(actor_user_id)
        with self._lock, self._connect() as conn:
            task = self._task_access_or_raise(conn, task_id=normalized_id, user_id=actor_id, is_admin=is_admin)
            actor = user_service.get_by_id(actor_id) or {"id": actor_id, "role": "viewer"}
            payload_keys = {str(key) for key in (payload or {}).keys()}
            checklist_only = payload_keys and payload_keys <= {"checklist_items"}
            checklist_actor_allowed = (
                actor_id in self._task_participant_user_ids(task, include_delegates=True)
                or user_is_department_manager(actor, task.get("department_id"))
            )
            if not is_admin and self._as_int(task.get("created_by_user_id")) != actor_id and not user_is_department_manager(actor, task.get("department_id")) and not (checklist_only and checklist_actor_allowed):
                raise PermissionError("Only task creator or admin can edit task")
            updates: list[str] = []
            params: list[Any] = []
            assignees_changed = "assignee_user_ids" in payload or "assignee_user_id" in payload
            next_assignees: list[dict[str, Any]] = []
            if assignees_changed:
                if "assignee_user_ids" in payload:
                    next_assignees = self._resolve_active_task_assignees(payload.get("assignee_user_ids"))
                else:
                    next_assignees = self._resolve_active_task_assignees(
                        None,
                        fallback_assignee_user_id=payload.get("assignee_user_id"),
                    )
                effective_assignee_ids = [self._as_int(item.get("id")) for item in next_assignees]
            else:
                effective_assignee_ids = self._normalize_assignee_user_ids(
                    task.get("assignee_user_ids"),
                    fallback_assignee_user_id=task.get("assignee_user_id"),
                )
            effective_project_id = _normalize_text(payload.get("project_id")) if "project_id" in payload else _normalize_text(task.get("project_id"))
            effective_object_id = _normalize_text(payload.get("object_id")) if "object_id" in payload else _normalize_text(task.get("object_id"))
            if "project_id" in payload or "object_id" in payload:
                validated_project_id, validated_object_id = self._validate_task_project_object(
                    conn,
                    project_id=effective_project_id,
                    object_id=effective_object_id,
                )
                if "project_id" in payload or validated_project_id != (_normalize_text(task.get("project_id")) or None):
                    updates.append("project_id = ?")
                    params.append(validated_project_id)
                if "object_id" in payload or validated_object_id != (_normalize_text(task.get("object_id")) or None):
                    updates.append("object_id = ?")
                    params.append(validated_object_id)
            if "department_id" in payload:
                next_department_id = _normalize_text(payload.get("department_id")) or None
                if next_department_id and not department_service.get_department(next_department_id):
                    raise ValueError("Department is not available")
                if next_department_id and not is_admin:
                    for effective_assignee_id in effective_assignee_ids:
                        effective_assignee = user_service.get_by_id(effective_assignee_id) or {}
                        if not can_create_task_for_department(
                            actor,
                            department_id=next_department_id,
                            assignee=effective_assignee,
                        ):
                            raise PermissionError("Task cannot be moved to the selected department")
                updates.append("department_id = ?")
                params.append(next_department_id)
            if "visibility_scope" in payload:
                next_scope = normalize_visibility_scope(payload.get("visibility_scope"), default=VISIBILITY_PRIVATE)
                if not (_normalize_text(payload.get("department_id")) or _normalize_text(task.get("department_id"))):
                    next_scope = VISIBILITY_PRIVATE
                updates.append("visibility_scope = ?")
                params.append(next_scope)
            if "checklist_items" in payload:
                updates.append("checklist_items = ?")
                params.append(self._serialize_checklist_items(payload.get("checklist_items")))
            if assignees_changed:
                effective_department_id = _normalize_text(payload.get("department_id")) or _normalize_text(task.get("department_id"))
                if effective_department_id and not is_admin:
                    for assignee in next_assignees:
                        if not can_create_task_for_department(
                            actor,
                            department_id=effective_department_id,
                            assignee=assignee,
                        ):
                            raise PermissionError("Task cannot be assigned in the selected department")
                primary_assignee = next_assignees[0]
                updates.extend([
                    "assignee_user_id = ?",
                    "assignee_user_ids = ?",
                    "assignee_username = ?",
                    "assignee_full_name = ?",
                ])
                params.extend([
                    self._as_int(primary_assignee.get("id")),
                    self._serialize_json_list(effective_assignee_ids),
                    _normalize_text(primary_assignee.get("username")),
                    _normalize_text(primary_assignee.get("full_name")) or _normalize_text(primary_assignee.get("username")),
                ])
            if "observer_user_ids" in payload:
                effective_controller_id = (
                    self._as_int(payload.get("controller_user_id"))
                    if "controller_user_id" in payload
                    else self._as_int(task.get("controller_user_id"))
                )
                updates.append("observer_user_ids = ?")
                params.append(
                    self._serialize_observer_user_ids(
                        payload.get("observer_user_ids"),
                        creator_user_id=self._as_int(task.get("created_by_user_id")),
                        assignee_user_id=effective_assignee_ids[0],
                        assignee_user_ids=effective_assignee_ids,
                        controller_user_id=effective_controller_id,
                    )
                )
            elif assignees_changed:
                updates.append("observer_user_ids = ?")
                params.append(
                    self._serialize_observer_user_ids(
                        task.get("observer_user_ids"),
                        creator_user_id=self._as_int(task.get("created_by_user_id")),
                        assignee_user_id=effective_assignee_ids[0],
                        assignee_user_ids=effective_assignee_ids,
                        controller_user_id=(
                            self._as_int(payload.get("controller_user_id"))
                            if "controller_user_id" in payload
                            else self._as_int(task.get("controller_user_id"))
                        ),
                    )
                )
            if "email_deadline_remind_hours" in payload:
                effective_due_at = (
                    _normalize_text(payload.get("due_at"))
                    if "due_at" in payload
                    else (_normalize_text(task.get("due_at")) or None)
                )
                if effective_due_at:
                    updates.append("email_deadline_remind_hours = ?")
                    params.append(_normalize_email_deadline_remind_hours(payload.get("email_deadline_remind_hours")))
                else:
                    updates.append("email_deadline_remind_hours = ?")
                    params.append(None)
            for key in ("title", "description", "due_at", "priority", "controller_user_id", "protocol_date"):
                if key not in payload:
                    continue
                if key == "controller_user_id":
                    controller_id = self._as_int(payload.get(key))
                    if controller_id <= 0:
                        updates.extend(["controller_user_id = ?", "controller_username = ?", "controller_full_name = ?"])
                        params.extend([0, "", ""])
                        continue
                    controller = user_service.get_by_id(controller_id)
                    if not controller or not bool(controller.get("is_active", True)):
                        raise ValueError("Controller user is not available")
                    effective_department_id = _normalize_text(payload.get("department_id")) or _normalize_text(task.get("department_id"))
                    if not (self._user_can_review_tasks(controller) or (effective_department_id and user_is_department_manager(controller, effective_department_id))):
                        raise ValueError("Controller must have tasks.review permission or be department manager")
                    updates.extend(["controller_user_id = ?", "controller_username = ?", "controller_full_name = ?"])
                    params.extend(
                        [
                            self._as_int(controller.get("id")),
                            _normalize_text(controller.get("username")),
                            _normalize_text(controller.get("full_name")) or _normalize_text(controller.get("username")),
                        ]
                    )
                elif key == "due_at":
                    next_due_at_value = _normalize_text(payload.get(key)) or None
                    updates.append("due_at = ?")
                    params.append(next_due_at_value)
                    if not next_due_at_value:
                        updates.append("email_deadline_remind_hours = ?")
                        params.append(None)
                elif key == "priority":
                    pval = _normalize_text(payload.get(key), "normal").lower()
                    if pval not in {"low", "normal", "high", "urgent"}:
                        pval = "normal"
                    updates.append("priority = ?")
                    params.append(pval)
                elif key == "protocol_date":
                    normalized_protocol_date = self._normalize_protocol_date(payload.get(key))
                    if not normalized_protocol_date:
                        raise ValueError("protocol_date is required")
                    updates.append("protocol_date = ?")
                    params.append(normalized_protocol_date)
                else:
                    value = _normalize_text(payload.get(key))
                    if key == "title" and len(value) < 3:
                        raise ValueError("Task title must contain at least 3 characters")
                    updates.append(f"{key} = ?")
                    params.append(value)
            if not updates:
                return self.get_task(normalized_id, user_id=actor_id, is_admin=is_admin)
            updates.append("updated_at = ?")
            params.append(_utc_now_iso())
            params.append(normalized_id)
            previous_assignee_ids = self._task_assignee_user_ids(task)
            previous_controller_id = self._as_int(task.get("controller_user_id"))
            previous_due_at = _normalize_text(task.get("due_at")) or None
            previous_observer_ids = set(self._task_observer_user_ids(task))
            conn.execute(f"UPDATE {self._TASKS_TABLE} SET {', '.join(updates)} WHERE id = ?", tuple(params))
            row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            if row is None:
                return None
            updated = dict(row)
            next_assignee_ids = self._task_assignee_user_ids(updated)
            next_controller_id = self._as_int(updated.get("controller_user_id"))
            title_text = _normalize_text(updated.get("title"))
            added_assignee_ids = next_assignee_ids - previous_assignee_ids
            if added_assignee_ids:
                added_assignee_recipients = set(added_assignee_ids)
                for added_assignee_id in added_assignee_ids:
                    added_assignee_recipients.update(self._task_delegate_user_ids(added_assignee_id))
                self._create_task_notifications(
                    conn,
                    recipient_user_ids=added_assignee_recipients,
                    skip_user_ids={actor_id},
                    event_type="task.assigned",
                    title="Вам назначена задача",
                    body=title_text,
                    task_id=normalized_id,
                )
            if next_controller_id > 0 and next_controller_id != previous_controller_id:
                self._create_task_notifications(
                    conn,
                    recipient_user_ids={next_controller_id},
                    skip_user_ids={actor_id, *next_assignee_ids},
                    event_type="task.controller_assigned",
                    title="Вы назначены контролером задачи",
                    body=title_text,
                    task_id=normalized_id,
                )
            next_due_at = _normalize_text(updated.get("due_at")) or None
            if next_due_at != previous_due_at and next_assignee_ids:
                deadline_recipients = set(next_assignee_ids)
                for deadline_assignee_id in next_assignee_ids:
                    deadline_recipients.update(self._task_delegate_user_ids(deadline_assignee_id))
                self._create_task_notifications(
                    conn,
                    recipient_user_ids=deadline_recipients,
                    skip_user_ids={actor_id},
                    event_type="task.deadline_changed",
                    title="Изменен срок задачи",
                    body=title_text,
                    task_id=normalized_id,
                )
            next_observer_ids = set(self._task_observer_user_ids(updated))
            added_observer_ids = next_observer_ids - previous_observer_ids
            if added_observer_ids:
                self._create_task_notifications(
                    conn,
                    recipient_user_ids=added_observer_ids,
                    skip_user_ids={actor_id, *next_assignee_ids, next_controller_id},
                    event_type="task.observer_added",
                    title="Вас добавили наблюдателем задачи",
                    body=title_text,
                    task_id=normalized_id,
                )
            conn.commit()
            updated_task = self._task_with_latest_report(conn, row, viewer_user_id=actor_id)
        try:
            from backend.chat.task_discussion import sync_task_discussion_members

            if any(key in (payload or {}) for key in ("assignee_user_id", "assignee_user_ids", "controller_user_id", "title", "observer_user_ids")):
                sync_task_discussion_members(task_id=normalized_id, task=updated_task)
        except Exception:
            pass
        if assignees_changed:
            membership_cache_user_ids = {actor_id, *previous_assignee_ids, *next_assignee_ids}
            for assignee_id in previous_assignee_ids | next_assignee_ids:
                membership_cache_user_ids.update(self._task_delegate_user_ids(assignee_id))
            for cache_user_id in membership_cache_user_ids:
                if cache_user_id > 0:
                    self._invalidate_dashboard_cache(cache_user_id)
        self._publish_task_realtime(
            task=updated_task,
            previous_task=task,
            operation="updated",
            actor_user_id=actor_id,
        )
        return updated_task

    def task_exists(self, task_id: str) -> bool:
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return False
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"SELECT 1 FROM {self._TASKS_TABLE} WHERE id = ? LIMIT 1",
                (normalized_id,),
            ).fetchone()
            return row is not None

    def tasks_exist_batch(self, task_ids: list[str]) -> dict[str, bool]:
        normalized_ids: list[str] = []
        seen: set[str] = set()
        for raw_id in list(task_ids or []):
            normalized_id = _normalize_text(raw_id)
            if not normalized_id or normalized_id in seen:
                continue
            seen.add(normalized_id)
            normalized_ids.append(normalized_id)
        if not normalized_ids:
            return {}
        placeholders = ", ".join(["?"] * len(normalized_ids))
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"SELECT id FROM {self._TASKS_TABLE} WHERE id IN ({placeholders})",
                tuple(normalized_ids),
            ).fetchall()
        existing = {_normalize_text(row["id"]) for row in rows if _normalize_text(row["id"])}
        return {task_id: task_id in existing for task_id in normalized_ids}

    def get_tasks_for_user_batch(
        self,
        task_ids: list[str],
        *,
        user_id: int,
        is_admin: bool = False,
    ) -> dict[str, dict[str, Any]]:
        normalized_ids: list[str] = []
        seen: set[str] = set()
        for raw_id in list(task_ids or []):
            normalized_id = _normalize_text(raw_id)
            if not normalized_id or normalized_id in seen:
                continue
            seen.add(normalized_id)
            normalized_ids.append(normalized_id)
        if not normalized_ids:
            return {}
        placeholders = ", ".join(["?"] * len(normalized_ids))
        result: dict[str, dict[str, Any]] = {}
        viewer = None
        if not is_admin:
            normalized_user_id = self._as_int(user_id)
            viewer = user_service.get_by_id(normalized_user_id) or {"id": normalized_user_id, "role": "viewer"}
        delegate_user_ids_by_assignee: dict[int, list[int]] = {}
        with self._db_conn(write=False) as conn:
            rows = conn.execute(
                f"SELECT * FROM {self._TASKS_TABLE} WHERE id IN ({placeholders})",
                tuple(normalized_ids),
            ).fetchall()
            for row in rows:
                task = dict(row)
                task_id = _normalize_text(task.get("id"))
                if not task_id:
                    continue
                if not self._task_user_can_view(
                    task,
                    user_id=int(user_id),
                    is_admin=bool(is_admin),
                    viewer=viewer,
                    delegate_user_ids_by_assignee=delegate_user_ids_by_assignee,
                ):
                    continue
                result[task_id] = self._task_with_latest_report(conn, task, viewer_user_id=int(user_id))
        return result

    def get_task(
        self,
        task_id: str,
        *,
        user_id: int,
        is_admin: bool = False,
    ) -> Optional[dict[str, Any]]:
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return None
        with self._db_conn(write=False) as conn:
            task = self._task_access_or_raise(conn, task_id=normalized_id, user_id=int(user_id), is_admin=is_admin)
            return self._task_with_latest_report(conn, task, viewer_user_id=int(user_id))

    @staticmethod
    def _empty_task_canvas_scene() -> dict[str, Any]:
        return {"elements": [], "appState": {}, "files": {}}

    def _task_canvas_can_edit(self, *, actor: dict[str, Any], task: dict[str, Any]) -> bool:
        return can_edit_task_canvas(
            actor,
            task,
            participant_user_ids=self._task_participant_user_ids(task, include_delegates=True),
            observer_user_ids=self._task_observer_user_ids(task),
        )

    def _task_canvas_payload(
        self,
        *,
        task_id: str,
        row: Any,
        can_edit: bool,
    ) -> dict[str, Any]:
        scene = self._empty_task_canvas_scene()
        if row is not None:
            try:
                parsed = json.loads(str(row["scene_json"] or ""))
            except (TypeError, ValueError, json.JSONDecodeError):
                parsed = None
            if isinstance(parsed, dict):
                scene = {
                    "elements": parsed.get("elements") if isinstance(parsed.get("elements"), list) else [],
                    "appState": parsed.get("appState") if isinstance(parsed.get("appState"), dict) else {},
                    "files": parsed.get("files") if isinstance(parsed.get("files"), dict) else {},
                }
        return {
            "task_id": task_id,
            "revision": self._as_int(row["revision"] if row is not None else 0),
            "scene": scene,
            "can_edit": bool(can_edit),
            "max_scene_bytes": self._TASK_CANVAS_MAX_BYTES,
            "updated_by_user_id": self._as_int(row["updated_by_user_id"], 0) or None if row is not None else None,
            "updated_by_username": _normalize_text(row["updated_by_username"]) if row is not None else "",
            "updated_at": _normalize_text(row["updated_at"]) or None if row is not None else None,
        }

    def get_task_canvas(self, *, task_id: str, actor: dict[str, Any]) -> dict[str, Any]:
        normalized_id = _normalize_text(task_id)
        actor_id = self._as_int((actor or {}).get("id"))
        if not normalized_id:
            raise LookupError("Task not found")
        with self._db_conn(write=False) as conn:
            task = self._task_access_or_raise(
                conn,
                task_id=normalized_id,
                user_id=actor_id,
                is_admin=str((actor or {}).get("role") or "").strip().lower() == "admin",
            )
            row = conn.execute(
                f"SELECT * FROM {self._TASK_CANVAS_TABLE} WHERE task_id = ?",
                (normalized_id,),
            ).fetchone()
            return self._task_canvas_payload(
                task_id=normalized_id,
                row=row,
                can_edit=self._task_canvas_can_edit(actor=actor, task=task),
            )

    def save_task_canvas(
        self,
        *,
        task_id: str,
        scene: dict[str, Any],
        expected_revision: int,
        actor: dict[str, Any],
    ) -> dict[str, Any]:
        normalized_id = _normalize_text(task_id)
        actor_id = self._as_int((actor or {}).get("id"))
        expected = self._as_int(expected_revision, -1)
        if not normalized_id:
            raise LookupError("Task not found")
        if expected < 0:
            raise ValueError("Canvas revision must be non-negative")

        normalized_scene = {
            "elements": list((scene or {}).get("elements") or []),
            "appState": dict((scene or {}).get("appState") or {}),
            "files": dict((scene or {}).get("files") or {}),
        }
        if len(normalized_scene["elements"]) > self._TASK_CANVAS_MAX_ELEMENTS:
            raise TaskCanvasTooLarge(f"Task canvas has more than {self._TASK_CANVAS_MAX_ELEMENTS} elements")
        scene_json = json.dumps(normalized_scene, ensure_ascii=False, separators=(",", ":"))
        if len(scene_json.encode("utf-8")) > self._TASK_CANVAS_MAX_BYTES:
            raise TaskCanvasTooLarge("Task canvas is larger than 2 MB")

        with self._db_conn(write=True) as conn:
            task = self._task_access_or_raise(
                conn,
                task_id=normalized_id,
                user_id=actor_id,
                is_admin=str((actor or {}).get("role") or "").strip().lower() == "admin",
            )
            if not self._task_canvas_can_edit(actor=actor, task=task):
                raise PermissionError("Task canvas is read-only for current user")

            existing = conn.execute(
                f"SELECT revision FROM {self._TASK_CANVAS_TABLE} WHERE task_id = ?",
                (normalized_id,),
            ).fetchone()
            current_revision = self._as_int(existing["revision"] if existing is not None else 0)
            if current_revision != expected:
                raise TaskCanvasRevisionConflict(current_revision)

            next_revision = current_revision + 1
            now = _utc_now_iso()
            username = _normalize_text((actor or {}).get("username"))
            if existing is None:
                result = conn.execute(
                    f"""
                    INSERT INTO {self._TASK_CANVAS_TABLE}(
                      task_id, scene_json, revision, updated_by_user_id,
                      updated_by_username, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(task_id) DO NOTHING
                    """,
                    (normalized_id, scene_json, next_revision, actor_id or None, username, now, now),
                )
            else:
                result = conn.execute(
                    f"""
                    UPDATE {self._TASK_CANVAS_TABLE}
                    SET scene_json = ?, revision = ?, updated_by_user_id = ?,
                        updated_by_username = ?, updated_at = ?
                    WHERE task_id = ? AND revision = ?
                    """,
                    (scene_json, next_revision, actor_id or None, username, now, normalized_id, current_revision),
                )
            if self._rowcount(result) != 1:
                latest = conn.execute(
                    f"SELECT revision FROM {self._TASK_CANVAS_TABLE} WHERE task_id = ?",
                    (normalized_id,),
                ).fetchone()
                raise TaskCanvasRevisionConflict(self._as_int(latest["revision"] if latest is not None else 0))

            row = conn.execute(
                f"SELECT * FROM {self._TASK_CANVAS_TABLE} WHERE task_id = ?",
                (normalized_id,),
            ).fetchone()
            return self._task_canvas_payload(task_id=normalized_id, row=row, can_edit=True)

    def delete_task(self, *, task_id: str, actor_user_id: int, is_admin: bool = False) -> bool:
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return False
        actor_id = self._as_int(actor_user_id)
        file_paths: list[str] = []
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?",
                (normalized_id,),
            ).fetchone()
            if row is None:
                return False
            if not is_admin and self._as_int(row["created_by_user_id"]) != actor_id:
                raise PermissionError("Only task creator or admin can delete it")
            task = dict(row)

            task_attach_rows = conn.execute(
                f"SELECT file_path FROM {self._TASK_ATTACH_TABLE} WHERE task_id = ?",
                (normalized_id,),
            ).fetchall()
            task_report_rows = conn.execute(
                f"SELECT file_path FROM {self._TASK_REPORTS_TABLE} WHERE task_id = ?",
                (normalized_id,),
            ).fetchall()
            file_paths = [
                _normalize_text(item["file_path"])
                for item in [*task_attach_rows, *task_report_rows]
                if _normalize_text(item["file_path"])
            ]

            notif_ids = conn.execute(
                f"SELECT id FROM {self._NOTIF_TABLE} WHERE entity_type = 'task' AND entity_id = ?",
                (normalized_id,),
            ).fetchall()
            notif_id_values = [_normalize_text(item["id"]) for item in notif_ids if _normalize_text(item["id"])]
            if notif_id_values:
                placeholders = ", ".join(["?"] * len(notif_id_values))
                conn.execute(
                    f"DELETE FROM {self._NOTIF_READS_TABLE} WHERE notification_id IN ({placeholders})",
                    tuple(notif_id_values),
                )
            conn.execute(
                f"DELETE FROM {self._NOTIF_TABLE} WHERE entity_type = 'task' AND entity_id = ?",
                (normalized_id,),
            )
            conn.execute(f"DELETE FROM {self._TASK_ATTACHMENT_PREVIEWS_TABLE} WHERE task_id = ?", (normalized_id,))
            conn.execute(f"DELETE FROM {self._TASK_ATTACH_TABLE} WHERE task_id = ?", (normalized_id,))
            conn.execute(f"DELETE FROM {self._TASK_REPORTS_TABLE} WHERE task_id = ?", (normalized_id,))
            conn.execute(f"DELETE FROM {self._TASK_COMMENTS_TABLE} WHERE task_id = ?", (normalized_id,))
            conn.execute(f"DELETE FROM {self._TASK_COMMENT_READS_TABLE} WHERE task_id = ?", (normalized_id,))
            conn.execute(f"DELETE FROM {self._TASK_STATUS_LOG_TABLE} WHERE task_id = ?", (normalized_id,))
            conn.execute(f"DELETE FROM {self._TASK_CANVAS_TABLE} WHERE task_id = ?", (normalized_id,))
            conn.execute(f"DELETE FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,))
            conn.commit()

        self._remove_relative_files(file_paths)
        self._remove_dir_quiet(self.task_attachments_root / normalized_id)
        self._remove_dir_quiet(self.task_attachment_previews_root / normalized_id)
        self._publish_task_realtime(
            task=None,
            previous_task=task,
            operation="deleted",
            actor_user_id=actor_id,
        )
        return True

    def delete_notifications_for_entity(self, *, entity_type: str, entity_id: str) -> int:
        """Atomically delete notifications for one entity.

        Kept as a single DELETE (not batched): after idx_hub_notifications_entity
        a typical task removes few rows and must stay immediately consistent with
        task/announcement deletion.
        """
        normalized_type = _normalize_text(entity_type)
        normalized_id = _normalize_text(entity_id)
        if not normalized_type or not normalized_id:
            return 0
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"SELECT id FROM {self._NOTIF_TABLE} WHERE entity_type = ? AND entity_id = ?",
                (normalized_type, normalized_id),
            ).fetchall()
            notification_ids = [
                _normalize_text(item["id"])
                for item in rows
                if _normalize_text(item["id"])
            ]
            if notification_ids:
                placeholders = ", ".join(["?"] * len(notification_ids))
                conn.execute(
                    f"DELETE FROM {self._NOTIF_READS_TABLE} WHERE notification_id IN ({placeholders})",
                    tuple(notification_ids),
                )
            conn.execute(
                f"DELETE FROM {self._NOTIF_TABLE} WHERE entity_type = ? AND entity_id = ?",
                (normalized_type, normalized_id),
            )
            conn.commit()
        return len(notification_ids)

    def _notifications_use_postgres(self) -> bool:
        if not self._use_app_db or not self._database_url:
            return False
        try:
            engine = get_app_engine(self._database_url)
            return str(engine.dialect.name).lower() == "postgresql"
        except Exception:
            return False

    @staticmethod
    def _notification_cleanup_batch_size(value: Any = None) -> int:
        if value is None:
            raw = os.getenv("HUB_NOTIFICATIONS_CLEANUP_BATCH_SIZE", "500")
            try:
                value = int(raw)
            except Exception:
                value = 500
        try:
            parsed = int(value)
        except Exception:
            parsed = 500
        return max(1, min(5000, parsed))

    def cleanup_old_notifications(
        self,
        *,
        older_than_iso: str,
        batch_size: int | None = None,
        max_batches: int = 1,
        entity_type: str | None = None,
        recipient_user_id: int | None = None,
    ) -> dict[str, Any]:
        """Delete historical notifications in short committed batches.

        Intended for old/recipient/admin cleanup — not for per-task entity delete.
        One HTTP request should pass max_batches=1 (or enqueue a worker).
        """
        cutoff = _normalize_text(older_than_iso)
        if not cutoff:
            raise ValueError("older_than_iso is required")
        safe_batch = self._notification_cleanup_batch_size(batch_size)
        try:
            safe_max_batches = max(1, min(10_000, int(max_batches)))
        except Exception:
            safe_max_batches = 1
        normalized_entity_type = _normalize_text(entity_type) or None
        normalized_recipient = self._as_int(recipient_user_id, 0)
        use_skip_locked = self._notifications_use_postgres()

        deleted_total = 0
        batches_done = 0
        errors: list[str] = []
        has_more = False
        started = time.perf_counter()

        where = ["created_at < ?"]
        base_params: list[Any] = [cutoff]
        if normalized_entity_type:
            where.append("entity_type = ?")
            base_params.append(normalized_entity_type)
        if normalized_recipient > 0:
            where.append("recipient_user_id = ?")
            base_params.append(normalized_recipient)
        where_sql = " AND ".join(where)

        for _ in range(safe_max_batches):
            batch_started = time.perf_counter()
            try:
                with self._db_conn(write=True) as conn:
                    select_sql = f"""
                        SELECT id
                        FROM {self._NOTIF_TABLE}
                        WHERE {where_sql}
                        ORDER BY id
                        LIMIT ?
                    """
                    if use_skip_locked:
                        select_sql = f"""
                            SELECT id
                            FROM {self._NOTIF_TABLE}
                            WHERE {where_sql}
                            ORDER BY id
                            LIMIT ?
                            FOR UPDATE SKIP LOCKED
                        """
                    rows = conn.execute(
                        select_sql,
                        tuple([*base_params, safe_batch]),
                    ).fetchall()
                    notification_ids = [
                        _normalize_text(item["id"])
                        for item in rows
                        if _normalize_text(item["id"])
                    ]
                    if not notification_ids:
                        has_more = False
                        break
                    placeholders = ", ".join(["?"] * len(notification_ids))
                    conn.execute(
                        f"DELETE FROM {self._NOTIF_READS_TABLE} WHERE notification_id IN ({placeholders})",
                        tuple(notification_ids),
                    )
                    conn.execute(
                        f"DELETE FROM {self._NOTIF_TABLE} WHERE id IN ({placeholders})",
                        tuple(notification_ids),
                    )
                    conn.commit()
                    deleted_total += len(notification_ids)
                    batches_done += 1
                    has_more = len(notification_ids) >= safe_batch
                    logger.info(
                        "hub.notifications.cleanup_batch deleted=%s deleted_ms=%.1f batch=%s",
                        len(notification_ids),
                        (time.perf_counter() - batch_started) * 1000.0,
                        batches_done,
                    )
                    if not has_more:
                        break
            except Exception as exc:  # noqa: BLE001 — stop after a failed batch; prior commits remain
                errors.append(str(exc) or exc.__class__.__name__)
                break

        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        return {
            "deleted": deleted_total,
            "batches": batches_done,
            "batch_size": safe_batch,
            "max_batches": safe_max_batches,
            "has_more": bool(has_more),
            "errors": errors,
            "deleted_ms": elapsed_ms,
            "older_than_iso": cutoff,
            "entity_type": normalized_entity_type,
            "recipient_user_id": normalized_recipient or None,
            "skip_locked": bool(use_skip_locked),
        }

    @staticmethod
    def _analytics_protocol_basis_expr() -> str:
        return "COALESCE(NULLIF(TRIM(protocol_date), ''), substr(created_at, 1, 10))"

    def _analytics_basis_date_expr(self, basis: str) -> str:
        normalized_basis = _normalize_text(basis, "protocol_date").lower()
        if normalized_basis == "completed_at":
            return (
                "CASE WHEN completed_at IS NOT NULL AND TRIM(completed_at) <> '' "
                "THEN substr(completed_at, 1, 10) ELSE NULL END"
            )
        if normalized_basis == "due_at":
            return "CASE WHEN due_at IS NOT NULL AND TRIM(due_at) <> '' THEN substr(due_at, 1, 10) ELSE NULL END"
        return self._analytics_protocol_basis_expr()

    def _build_analytics_filter_clauses(
        self,
        *,
        basis: str,
        start_iso: str | None,
        end_iso: str | None,
        normalized_project_ids: set[str],
        normalized_object_ids: set[str],
        normalized_participants: set[int],
    ) -> tuple[list[str], list[Any]]:
        analytics_where: list[str] = []
        analytics_params: list[Any] = []
        if normalized_project_ids:
            placeholders = ", ".join(["?"] * len(normalized_project_ids))
            analytics_where.append(f"project_id IN ({placeholders})")
            analytics_params.extend(sorted(normalized_project_ids))
        if normalized_object_ids:
            placeholders = ", ".join(["?"] * len(normalized_object_ids))
            analytics_where.append(f"object_id IN ({placeholders})")
            analytics_params.extend(sorted(normalized_object_ids))
        if normalized_participants:
            assignee_clause, assignee_params = self._assignee_membership_any_clause(
                sorted(normalized_participants)
            )
            analytics_where.append(assignee_clause)
            analytics_params.extend(assignee_params)
        basis_date_expr = self._analytics_basis_date_expr(basis)
        if start_iso:
            analytics_where.append(f"({basis_date_expr} IS NOT NULL AND {basis_date_expr} >= ?)")
            analytics_params.append(start_iso)
        if end_iso:
            analytics_where.append(f"({basis_date_expr} IS NOT NULL AND {basis_date_expr} <= ?)")
            analytics_params.append(end_iso)
        return analytics_where, analytics_params

    @staticmethod
    def _analytics_metrics_select_sql(now_iso: str) -> str:
        return f"""
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new,
            SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
            SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) AS review,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN status IN ('new', 'in_progress', 'review') THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN status = 'done'
                AND completed_at IS NOT NULL AND TRIM(completed_at) <> ''
                AND due_at IS NOT NULL AND TRIM(due_at) <> ''
                AND completed_at <= due_at THEN 1 ELSE 0 END) AS done_on_time,
            SUM(CASE WHEN status = 'done'
                AND (due_at IS NULL OR TRIM(due_at) = '') THEN 1 ELSE 0 END) AS done_without_due,
            SUM(CASE WHEN due_at IS NOT NULL AND TRIM(due_at) <> ''
                AND due_at < '{now_iso}' AND status <> 'done' THEN 1 ELSE 0 END) AS overdue,
            SUM(CASE WHEN due_at IS NOT NULL AND TRIM(due_at) <> '' THEN 1 ELSE 0 END) AS with_due_total
        """

    def _summary_metrics_from_row(self, row: dict[str, Any]) -> dict[str, Any]:
        metrics = {
            "total": self._as_int(row.get("total")),
            "new": self._as_int(row.get("new")),
            "in_progress": self._as_int(row.get("in_progress")),
            "review": self._as_int(row.get("review")),
            "done": self._as_int(row.get("done")),
            "open": self._as_int(row.get("open")),
            "done_on_time": self._as_int(row.get("done_on_time")),
            "done_without_due": self._as_int(row.get("done_without_due")),
            "overdue": self._as_int(row.get("overdue")),
            "with_due_total": self._as_int(row.get("with_due_total")),
        }
        total = metrics["total"]
        with_due_total = metrics["with_due_total"]
        metrics["completion_percent"] = round((metrics["done"] / total) * 100, 2) if total else 0.0
        metrics["completion_on_time_percent"] = (
            round((metrics["done_on_time"] / with_due_total) * 100, 2) if with_due_total else 0.0
        )
        return metrics

    def _group_metrics_from_row(
        self,
        row: dict[str, Any],
        *,
        id_field: str,
        label_field: str,
        id_value: Any,
        label_value: str,
    ) -> dict[str, Any]:
        return {
            id_field: id_value,
            label_field: label_value,
            **self._summary_metrics_from_row(row),
        }

    def _analytics_where_sql(self, where_clauses: list[str]) -> str:
        return (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    def _fetch_analytics_summary_sql(
        self,
        conn: sqlite3.Connection,
        *,
        where_sql: str,
        params: list[Any],
        now_iso: str,
    ) -> dict[str, Any]:
        metrics_sql = self._analytics_metrics_select_sql(now_iso)
        row = conn.execute(
            f"SELECT {metrics_sql} FROM {self._TASKS_TABLE}{where_sql}",
            tuple(params),
        ).fetchone()
        return self._summary_metrics_from_row(dict(row) if row else {})

    def _fetch_analytics_grouped_sql(
        self,
        conn: sqlite3.Connection,
        *,
        where_sql: str,
        params: list[Any],
        now_iso: str,
        group_field: str,
    ) -> list[dict[str, Any]]:
        metrics_sql = self._analytics_metrics_select_sql(now_iso)
        if group_field == "assignee_user_id":
            if self._uses_postgresql():
                participant_expr = "CAST(assignee_entry.value AS INTEGER)"
                participant_join = (
                    "CROSS JOIN LATERAL json_array_elements_text("
                    "COALESCE(NULLIF(assignee_user_ids, ''), '[]')::json"
                    ") AS assignee_entry(value)"
                )
            else:
                participant_expr = "CAST(assignee_entry.value AS INTEGER)"
                participant_join = "JOIN json_each(COALESCE(assignee_user_ids, '[]')) assignee_entry"
            rows = conn.execute(
                f"""
                SELECT {participant_expr} AS assignee_user_id, {metrics_sql}
                FROM {self._TASKS_TABLE}
                {participant_join}
                {where_sql}
                GROUP BY {participant_expr}
                """,
                tuple(params),
            ).fetchall()
            return [dict(row) for row in rows]
        else:
            select_fields = group_field
        rows = conn.execute(
            f"""
            SELECT {select_fields}, {metrics_sql}
            FROM {self._TASKS_TABLE}{where_sql}
            GROUP BY {group_field}
            """,
            tuple(params),
        ).fetchall()
        return [dict(row) for row in rows]

    def _fetch_analytics_trend_daily_sql(
        self,
        conn: sqlite3.Connection,
        *,
        where_sql: str,
        params: list[Any],
    ) -> tuple[dict[str, int], dict[str, dict[str, int]]]:
        protocol_basis = self._analytics_protocol_basis_expr()
        created_rows = conn.execute(
            f"""
            SELECT {protocol_basis} AS bucket_date, COUNT(*) AS created
            FROM {self._TASKS_TABLE}{where_sql}
            GROUP BY {protocol_basis}
            HAVING {protocol_basis} IS NOT NULL AND TRIM({protocol_basis}) <> ''
            """,
            tuple(params),
        ).fetchall()
        completed_where = (
            f"{where_sql} AND completed_at IS NOT NULL AND TRIM(completed_at) <> ''"
            if where_sql
            else " WHERE completed_at IS NOT NULL AND TRIM(completed_at) <> ''"
        )
        completed_rows = conn.execute(
            f"""
            SELECT substr(completed_at, 1, 10) AS bucket_date,
                   COUNT(*) AS completed,
                   SUM(CASE WHEN status = 'done'
                       AND due_at IS NOT NULL AND TRIM(due_at) <> ''
                       AND completed_at <= due_at THEN 1 ELSE 0 END) AS completed_on_time
            FROM {self._TASKS_TABLE}{completed_where}
            GROUP BY substr(completed_at, 1, 10)
            HAVING substr(completed_at, 1, 10) IS NOT NULL
               AND TRIM(substr(completed_at, 1, 10)) <> ''
            """,
            tuple(params),
        ).fetchall()
        created_by_day = {
            _normalize_text(row["bucket_date"]): self._as_int(row["created"])
            for row in created_rows
            if _normalize_text(row["bucket_date"])
        }
        completed_by_day: dict[str, dict[str, int]] = {}
        for row in completed_rows:
            bucket_date = _normalize_text(row["bucket_date"])
            if not bucket_date:
                continue
            completed_by_day[bucket_date] = {
                "completed": self._as_int(row["completed"]),
                "completed_on_time": self._as_int(row["completed_on_time"]),
            }
        return created_by_day, completed_by_day

    def _build_analytics_trend_payload(
        self,
        *,
        created_by_day: dict[str, int],
        completed_by_day: dict[str, dict[str, int]],
        start_iso: str | None,
        end_iso: str | None,
    ) -> dict[str, Any]:
        def _bucket_start(value: date, granularity: str) -> date:
            if granularity == "day":
                return value
            if granularity == "week":
                return value - timedelta(days=value.weekday())
            if granularity == "month":
                return value.replace(day=1)
            quarter_month = ((value.month - 1) // 3) * 3 + 1
            return value.replace(month=quarter_month, day=1)

        def _next_bucket_start(value: date, granularity: str) -> date:
            if granularity == "day":
                return value + timedelta(days=1)
            if granularity == "week":
                return value + timedelta(days=7)
            if granularity == "month":
                year = value.year + (1 if value.month == 12 else 0)
                month = 1 if value.month == 12 else value.month + 1
                return value.replace(year=year, month=month, day=1)
            year = value.year + (1 if value.month >= 10 else 0)
            month = ((value.month - 1) // 3) * 3 + 4
            if month > 12:
                month -= 12
            return value.replace(year=year, month=month, day=1)

        def _bucket_label(value: date, granularity: str) -> str:
            if granularity == "day":
                return value.strftime("%d.%m")
            if granularity == "week":
                return f"Нед. {value.strftime('%d.%m')}"
            if granularity == "month":
                return value.strftime("%m.%Y")
            return f"Q{((value.month - 1) // 3) + 1} {value.year}"

        range_candidates: list[date] = []
        if start_iso:
            range_candidates.append(date.fromisoformat(start_iso))
        if end_iso:
            range_candidates.append(date.fromisoformat(end_iso))
        for bucket_date in {*created_by_day.keys(), *completed_by_day.keys()}:
            try:
                range_candidates.append(date.fromisoformat(bucket_date))
            except ValueError:
                continue
        if not range_candidates:
            return {"granularity": "day", "items": []}

        range_start = min(range_candidates)
        range_end = max(range_candidates)
        range_days = max(1, (range_end - range_start).days + 1)
        if range_days <= 45:
            granularity = "day"
        elif range_days <= 180:
            granularity = "week"
        elif range_days <= 730:
            granularity = "month"
        else:
            granularity = "quarter"

        items_map: dict[str, dict[str, Any]] = {}

        def _ensure_bucket(target_date: date) -> dict[str, Any]:
            bucket_date = _bucket_start(target_date, granularity)
            bucket_key = bucket_date.isoformat()
            payload = items_map.get(bucket_key)
            if payload is None:
                payload = {
                    "bucket_key": bucket_key,
                    "bucket_label": _bucket_label(bucket_date, granularity),
                    "created": 0,
                    "completed": 0,
                    "completed_on_time": 0,
                }
                items_map[bucket_key] = payload
            return payload

        for bucket_date, created_count in created_by_day.items():
            try:
                _ensure_bucket(date.fromisoformat(bucket_date))["created"] += int(created_count)
            except ValueError:
                continue
        for bucket_date, completed_metrics in completed_by_day.items():
            try:
                bucket = _ensure_bucket(date.fromisoformat(bucket_date))
            except ValueError:
                continue
            bucket["completed"] += int(completed_metrics.get("completed", 0))
            bucket["completed_on_time"] += int(completed_metrics.get("completed_on_time", 0))

        cursor = _bucket_start(range_start, granularity)
        end_bucket = _bucket_start(range_end, granularity)
        ordered_items: list[dict[str, Any]] = []
        while cursor <= end_bucket:
            ordered_items.append(_ensure_bucket(cursor))
            cursor = _next_bucket_start(cursor, granularity)
        ordered_items.sort(key=lambda item: item["bucket_key"])
        return {"granularity": granularity, "items": ordered_items}

    def _collect_analytics_acl_visible_task_ids(
        self,
        conn: sqlite3.Connection,
        *,
        viewer: dict[str, Any],
        where_sql: str,
        params: list[Any],
    ) -> tuple[list[str], bool]:
        visible_ids: list[str] = []
        sql_offset = 0
        sql_rows_scanned = 0
        truncated = False
        while sql_rows_scanned < _DEPARTMENT_SCOPE_SQL_SCAN_CAP:
            rows = conn.execute(
                f"""
                {self._task_visibility_select_sql()}
                {where_sql}
                ORDER BY updated_at DESC, id DESC
                LIMIT ? OFFSET ?
                """,
                tuple([*params, _DEPARTMENT_SCOPE_FETCH_BATCH, sql_offset]),
            ).fetchall()
            if not rows:
                break
            for row in rows:
                row_dict = dict(row)
                if self._task_row_is_viewable_in_department_scope(viewer, row_dict):
                    visible_ids.append(_normalize_text(row_dict["id"]))
            fetched = len(rows)
            sql_rows_scanned += fetched
            sql_offset += fetched
            if fetched < _DEPARTMENT_SCOPE_FETCH_BATCH:
                break
        else:
            truncated = True
        return visible_ids, truncated

    def get_task_analytics(
        self,
        *,
        start_date: str | None = None,
        end_date: str | None = None,
        date_basis: str = "protocol_date",
        project_ids: Optional[list[str]] = None,
        object_ids: Optional[list[str]] = None,
        participant_user_ids: Optional[list[int]] = None,
        current_user: Any = None,
    ) -> dict[str, Any]:
        basis = _normalize_text(date_basis, "protocol_date").lower()
        if basis not in {"protocol_date", "completed_at", "due_at"}:
            basis = "protocol_date"
        start_iso = self._normalize_protocol_date(start_date)
        end_iso = self._normalize_protocol_date(end_date)
        normalized_project_ids = {_normalize_text(item) for item in (project_ids or []) if _normalize_text(item)}
        normalized_object_ids = {_normalize_text(item) for item in (object_ids or []) if _normalize_text(item)}
        normalized_participants = {self._as_int(item) for item in (participant_user_ids or []) if self._as_int(item) > 0}
        analytics_where, analytics_params = self._build_analytics_filter_clauses(
            basis=basis,
            start_iso=start_iso,
            end_iso=end_iso,
            normalized_project_ids=normalized_project_ids,
            normalized_object_ids=normalized_object_ids,
            normalized_participants=normalized_participants,
        )
        truncated = False
        viewer = None
        if current_user is not None and not user_can_manage_tasks_all(current_user):
            user_id = self._as_int(getattr(current_user, "id", None) or current_user.get("id"))
            viewer = user_service.get_by_id(user_id) or {"id": user_id, "role": "viewer"}

        now_iso = _utc_now_iso()
        with self._db_conn(write=False) as conn:
            where_clauses = list(analytics_where)
            where_params = list(analytics_params)
            if viewer is not None:
                visible_ids, truncated = self._collect_analytics_acl_visible_task_ids(
                    conn,
                    viewer=viewer,
                    where_sql=self._analytics_where_sql(where_clauses),
                    params=where_params,
                )
                if not visible_ids:
                    empty_payload = {
                        "summary": self._summary_metrics_from_row({}),
                        "by_participant": [],
                        "by_project": [],
                        "by_object": [],
                        "status_breakdown": [
                            {"status": "new", "label": "Новые", "value": 0},
                            {"status": "in_progress", "label": "В работе", "value": 0},
                            {"status": "review", "label": "На проверке", "value": 0},
                            {"status": "done", "label": "Выполнено", "value": 0},
                        ],
                        "trend": {"granularity": "day", "items": []},
                        "truncated": truncated,
                        "filters": {
                            "start_date": start_iso,
                            "end_date": end_iso,
                            "date_basis": basis,
                            "project_ids": sorted(normalized_project_ids),
                            "object_ids": sorted(normalized_object_ids),
                            "participant_user_ids": sorted(normalized_participants),
                        },
                    }
                    return empty_payload
                id_placeholders = ", ".join(["?"] * len(visible_ids))
                where_clauses.append(f"{self._TASKS_TABLE}.id IN ({id_placeholders})")
                where_params.extend(visible_ids)

            where_sql = self._analytics_where_sql(where_clauses)
            summary = self._fetch_analytics_summary_sql(
                conn,
                where_sql=where_sql,
                params=where_params,
                now_iso=now_iso,
            )
            participant_rows = self._fetch_analytics_grouped_sql(
                conn,
                where_sql=where_sql,
                params=where_params,
                now_iso=now_iso,
                group_field="assignee_user_id",
            )
            project_rows = self._fetch_analytics_grouped_sql(
                conn,
                where_sql=where_sql,
                params=where_params,
                now_iso=now_iso,
                group_field="project_id",
            )
            object_rows = self._fetch_analytics_grouped_sql(
                conn,
                where_sql=where_sql,
                params=where_params,
                now_iso=now_iso,
                group_field="object_id",
            )
            created_by_day, completed_by_day = self._fetch_analytics_trend_daily_sql(
                conn,
                where_sql=where_sql,
                params=where_params,
            )
            project_ids_for_labels = {
                _normalize_text(row.get("project_id"))
                for row in project_rows
                if _normalize_text(row.get("project_id"))
            }
            object_ids_for_labels = {
                _normalize_text(row.get("object_id"))
                for row in object_rows
                if _normalize_text(row.get("object_id"))
            }
            projects_by_id = self._load_records_by_ids(
                conn,
                table=self._TASK_PROJECTS_TABLE,
                ids=list(project_ids_for_labels),
            )
            objects_by_id = self._load_records_by_ids(
                conn,
                table=self._TASK_OBJECTS_TABLE,
                ids=list(object_ids_for_labels),
            )

        users_by_id = self._users_by_id()
        by_participant: list[dict[str, Any]] = []
        for row in participant_rows:
            participant_id = self._as_int(row.get("assignee_user_id"))
            participant_name = (
                _normalize_text(users_by_id.get(participant_id, {}).get("full_name"))
                or _normalize_text(row.get("assignee_full_name"))
                or _normalize_text(row.get("assignee_username"))
                or "Не назначен"
            )
            by_participant.append(
                self._group_metrics_from_row(
                    row,
                    id_field="participant_user_id",
                    label_field="participant_name",
                    id_value=participant_id or 0,
                    label_value=participant_name,
                )
            )
        by_participant.sort(key=lambda item: (-int(item.get("total", 0)), str(item.get("participant_name") or "")))

        by_project: list[dict[str, Any]] = []
        for row in project_rows:
            project_id = _normalize_text(row.get("project_id")) or None
            project_name = (
                _normalize_text((projects_by_id.get(project_id or "") or {}).get("name"))
                or "Без проекта"
            )
            by_project.append(
                self._group_metrics_from_row(
                    row,
                    id_field="project_id",
                    label_field="project_name",
                    id_value=project_id,
                    label_value=project_name,
                )
            )
        by_project.sort(key=lambda item: (-int(item.get("total", 0)), str(item.get("project_name") or "")))

        by_object: list[dict[str, Any]] = []
        for row in object_rows:
            object_id = _normalize_text(row.get("object_id")) or None
            object_name = (
                _normalize_text((objects_by_id.get(object_id or "") or {}).get("name"))
                or "Без объекта"
            )
            by_object.append(
                self._group_metrics_from_row(
                    row,
                    id_field="object_id",
                    label_field="object_name",
                    id_value=object_id,
                    label_value=object_name,
                )
            )
        by_object.sort(key=lambda item: (-int(item.get("total", 0)), str(item.get("object_name") or "")))

        status_breakdown = [
            {"status": "new", "label": "Новые", "value": int(summary.get("new", 0))},
            {"status": "in_progress", "label": "В работе", "value": int(summary.get("in_progress", 0))},
            {"status": "review", "label": "На проверке", "value": int(summary.get("review", 0))},
            {"status": "done", "label": "Выполнено", "value": int(summary.get("done", 0))},
        ]
        payload = {
            "summary": summary,
            "by_participant": by_participant,
            "by_project": by_project,
            "by_object": by_object,
            "status_breakdown": status_breakdown,
            "trend": self._build_analytics_trend_payload(
                created_by_day=created_by_day,
                completed_by_day=completed_by_day,
                start_iso=start_iso,
                end_iso=end_iso,
            ),
            "truncated": truncated,
            "filters": {
                "start_date": start_iso,
                "end_date": end_iso,
                "date_basis": basis,
                "project_ids": sorted(normalized_project_ids),
                "object_ids": sorted(normalized_object_ids),
                "participant_user_ids": sorted(normalized_participants),
            },
        }
        return payload

    def list_tasks(
        self,
        *,
        user_id: int,
        scope: str = "my",
        role_scope: str = "both",
        status_filter: str = "",
        q: str = "",
        assignee_user_id: Optional[int] = None,
        controller_user_id: Optional[int] = None,
        department_id: Optional[str] = None,
        has_attachments: bool = False,
        due_state: str = "",
        unread_comments_only: bool = False,
        focus_mode: str = "",
        sort_by: str = "status",
        sort_dir: str = "asc",
        limit: int = 100,
        offset: int = 0,
        allow_all_scope: bool = False,
    ) -> dict[str, Any]:
        safe_limit = self._coerce_limit(limit, default=100, minimum=1, maximum=500)
        safe_offset = max(0, self._as_int(offset, 0))
        now_iso = _utc_now_iso()
        raw_scope = _normalize_text(scope).lower()
        normalized_scope = "all" if raw_scope == "all" and allow_all_scope else ("department" if raw_scope == "department" else "my")
        normalized_role_scope = _normalize_text(role_scope).lower()
        if normalized_role_scope not in {"assignee", "creator", "controller", "both"}:
            normalized_role_scope = "both"
        normalized_query = _normalize_text(q).lower()
        normalized_due_state = _normalize_text(due_state).lower()
        normalized_department_id = _normalize_text(department_id)
        normalized_sort_by = _normalize_text(sort_by, "status").lower()
        normalized_sort_dir = "desc" if _normalize_text(sort_dir).lower() == "desc" else "asc"
        normalized_status = _normalize_text(status_filter).lower()
        normalized_focus_mode = _normalize_text(focus_mode).lower()
        cacheable_default = (
            normalized_scope == "my"
            and normalized_role_scope == "both"
            and not normalized_status
            and not normalized_query
            and assignee_user_id is None
            and controller_user_id is None
            and not normalized_department_id
            and not bool(has_attachments)
            and not normalized_due_state
            and not bool(unread_comments_only)
            and not normalized_focus_mode
            and safe_offset == 0
        )
        tasks_cache_key: tuple[Any, ...] | None = None
        if cacheable_default:
            tasks_cache_key = (
                int(user_id),
                safe_limit,
                normalized_sort_by,
                normalized_sort_dir,
            )
            cached_tasks = self._get_cached_tasks_list(tasks_cache_key)
            if cached_tasks is not None:
                return cached_tasks
        where_clauses: list[str] = []
        params: list[Any] = []
        delegate_owner_ids = user_service.get_delegate_owner_ids(int(user_id))
        observer_clause, observer_params = self._observer_membership_clause(int(user_id))
        assignee_scope_clause, assignee_scope_params = self._assignee_membership_any_clause(
            [int(user_id), *delegate_owner_ids]
        )
        if normalized_scope == "my":
            if normalized_role_scope == "assignee":
                where_clauses.append(assignee_scope_clause)
                params.extend(assignee_scope_params)
            elif normalized_role_scope == "creator":
                where_clauses.append("created_by_user_id = ?")
                params.append(int(user_id))
            elif normalized_role_scope == "controller":
                where_clauses.append("controller_user_id = ?")
                params.append(int(user_id))
            else:
                where_clauses.append(
                    f"({assignee_scope_clause} OR created_by_user_id = ? OR controller_user_id = ? OR {observer_clause})"
                )
                params.extend([*assignee_scope_params, int(user_id), int(user_id), *observer_params])
        elif assignee_user_id is not None:
            assignee_filter_clause, assignee_filter_params = self._assignee_membership_any_clause(
                [self._as_int(assignee_user_id)]
            )
            where_clauses.append(assignee_filter_clause)
            params.extend(assignee_filter_params)
        if controller_user_id is not None:
            where_clauses.append("controller_user_id = ?")
            params.append(self._as_int(controller_user_id))
        if normalized_department_id:
            where_clauses.append("department_id = ?")
            params.append(normalized_department_id)
        if normalized_status:
            where_clauses.append("status = ?")
            params.append(normalized_status)
        if normalized_query:
            # Leading-wildcard LIKE; PostgreSQL can use idx_hub_tasks_title_trgm (pg_trgm) when present.
            where_clauses.append("(LOWER(title) LIKE ? OR LOWER(description) LIKE ?)")
            like = f"%{normalized_query}%"
            params.extend([like, like])
        if bool(has_attachments):
            where_clauses.append(
                f"EXISTS (SELECT 1 FROM {self._TASK_ATTACH_TABLE} ta WHERE ta.task_id = {self._TASKS_TABLE}.id)"
            )
        if normalized_due_state == "overdue":
            where_clauses.append("due_at IS NOT NULL AND due_at <> '' AND due_at < ? AND status <> 'done'")
            params.append(now_iso)
        elif normalized_due_state == "today":
            where_clauses.append("due_at IS NOT NULL AND due_at <> '' AND substr(due_at, 1, 10) = ?")
            params.append(now_iso[:10])
        elif normalized_due_state == "upcoming":
            where_clauses.append("due_at IS NOT NULL AND due_at <> '' AND substr(due_at, 1, 10) > ?")
            params.append(now_iso[:10])
        elif normalized_due_state == "none":
            where_clauses.append("(due_at IS NULL OR due_at = '')")
        if unread_comments_only or normalized_focus_mode == "comments":
            unread_clause, unread_params = self._unread_comments_exists_sql(user_id=int(user_id))
            where_clauses.append(unread_clause)
            params.extend(unread_params)
        if normalized_focus_mode == "review":
            where_clauses.append("status = ?")
            params.append("review")
        elif normalized_focus_mode == "overdue":
            where_clauses.append("due_at IS NOT NULL AND due_at <> '' AND due_at < ? AND status <> 'done'")
            params.append(now_iso)
        if normalized_scope == "department":
            viewer = user_service.get_by_id(int(user_id)) or {"id": int(user_id), "role": "viewer"}
            self._append_department_scope_visibility_clause(
                user=viewer,
                where_clauses=where_clauses,
                params=params,
                user_id=int(user_id),
                delegate_owner_ids=delegate_owner_ids,
            )
        where_sql = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        sort_map = {
            "status": (
                "CASE status "
                "WHEN 'new' THEN 1 "
                "WHEN 'in_progress' THEN 2 "
                "WHEN 'review' THEN 3 "
                "WHEN 'done' THEN 4 "
                "ELSE 9 END"
            ),
            "updated_at": "updated_at",
            "due_at": "CASE WHEN due_at IS NULL OR due_at = '' THEN 1 ELSE 0 END, due_at",
        }
        sort_expr = sort_map.get(normalized_sort_by, sort_map["status"])
        tie_breaker = "updated_at DESC"
        if normalized_sort_by == "updated_at":
            tie_breaker = "id DESC"

        with self._db_conn(write=False) as conn:
            scan_truncated = False
            if normalized_scope == "department":
                viewer = user_service.get_by_id(int(user_id)) or {"id": int(user_id), "role": "viewer"}
                visible_ids, scan_truncated = self._collect_department_scope_visible_task_ids(
                    conn,
                    viewer=viewer,
                    where_sql=where_sql,
                    params=params,
                    sort_expr=sort_expr,
                    normalized_sort_dir=normalized_sort_dir,
                    tie_breaker=tie_breaker,
                )
                total_count = len(visible_ids)
                page_ids = visible_ids[safe_offset:safe_offset + safe_limit]
                visible_rows = self._fetch_task_list_rows_by_ids(conn, page_ids)
            else:
                rows = conn.execute(
                    f"""
                    {self._task_list_select_sql()}
                    {where_sql}
                    ORDER BY
                      {sort_expr} {normalized_sort_dir},
                      {tie_breaker}
                    LIMIT ? OFFSET ?
                    """,
                    tuple([*params, safe_limit, safe_offset]),
                ).fetchall()
                visible_rows = list(rows)
                total = conn.execute(
                    f"SELECT COUNT(*) AS c FROM {self._TASKS_TABLE}{where_sql}",
                    tuple(params),
                ).fetchone()
                total_count = self._as_int(total["c"] if total else 0)

            task_ids = [_normalize_text(row["id"]) for row in visible_rows]
            batch_ctx = self._build_task_list_batch_context(conn, task_ids, viewer_user_id=int(user_id))
            project_ids = list(
                {_normalize_text(row["project_id"]) for row in visible_rows if _normalize_text(row["project_id"])}
            )
            object_ids = list(
                {_normalize_text(row["object_id"]) for row in visible_rows if _normalize_text(row["object_id"])}
            )
            department_ids = list(
                {_normalize_text(row["department_id"]) for row in visible_rows if _normalize_text(row["department_id"])}
            )
            projects_by_id = self._load_records_by_ids(conn, table=self._TASK_PROJECTS_TABLE, ids=project_ids)
            objects_by_id = self._load_records_by_ids(conn, table=self._TASK_OBJECTS_TABLE, ids=object_ids)
            if department_ids:
                all_departments = department_service.list_departments(include_inactive=True)
                departments_by_id = {
                    _normalize_text(item.get("id")): item
                    for item in all_departments
                    if _normalize_text(item.get("id")) in set(department_ids)
                }
            else:
                departments_by_id = {}
            users_by_id = self._users_by_id()
            # Lean list: observer details stay detail-only; assignee names are needed by list cards.
            items = [
                self._task_to_list_item(
                    row,
                    batch_ctx,
                    projects_by_id=projects_by_id,
                    objects_by_id=objects_by_id,
                    departments_by_id=departments_by_id,
                    users_by_id=users_by_id,
                )
                for row in visible_rows
            ]

        payload = {
            "items": items,
            "total": total_count,
            "limit": safe_limit,
            "offset": safe_offset,
            "scope": normalized_scope,
            "truncated": bool(scan_truncated) if normalized_scope == "department" else False,
            "filters": {
                "role_scope": normalized_role_scope,
                "status": normalized_status,
                "q": normalized_query,
                "assignee_user_id": self._as_int(assignee_user_id) if assignee_user_id is not None else None,
                "controller_user_id": self._as_int(controller_user_id) if controller_user_id is not None else None,
                "department_id": normalized_department_id or None,
                "has_attachments": bool(has_attachments),
                "due_state": normalized_due_state,
                "unread_comments_only": bool(unread_comments_only),
                "focus_mode": normalized_focus_mode or None,
                "sort_by": normalized_sort_by,
                "sort_dir": normalized_sort_dir,
            },
        }
        if tasks_cache_key is not None:
            self._store_tasks_list_cache(tasks_cache_key, payload)
        return payload

    def _can_act_as_assignee(self, task: dict[str, Any], user_id: int) -> bool:
        normalized_user_id = self._as_int(user_id)
        if normalized_user_id <= 0:
            return False
        assignee_ids = self._task_assignee_user_ids(task)
        if normalized_user_id in assignee_ids:
            return True
        delegate_owner_ids = user_service.get_delegate_owner_ids(normalized_user_id)
        return bool(assignee_ids & {self._as_int(item) for item in (delegate_owner_ids or [])})

    def _transition_spec(self, operation: str) -> dict[str, Any]:
        from backend.services.hub_task_transitions import TRANSITION_MATRIX

        spec = TRANSITION_MATRIX.get(str(operation or "").strip())
        if not spec:
            raise ValueError(f"Unknown task transition operation: {operation}")
        return spec

    def _rowcount(self, result: Any) -> int:
        try:
            return max(0, int(getattr(result, "rowcount", 0) or 0))
        except (TypeError, ValueError):
            return 0

    def _raise_task_transition_conflict(
        self,
        conn: sqlite3.Connection,
        *,
        task_id: str,
        operation: str,
        expected_statuses: set[str] | frozenset[str],
        requested_status: str,
        user_id: int | None = None,
        correlation_id: str | None = None,
    ) -> None:
        from backend.services.hub_task_transitions import (
            build_conflict_payload,
            expected_status_label,
            note_transition_conflict,
        )

        row = conn.execute(
            f"SELECT id, status, updated_at FROM {self._TASKS_TABLE} WHERE id = ?",
            (task_id,),
        ).fetchone()
        current = dict(row) if row is not None else {}
        current_status = _normalize_text(current.get("status")).lower() or None
        expected_label = expected_status_label(expected_statuses)
        note_transition_conflict(
            operation=operation,
            expected_status=expected_label,
            target_status=requested_status,
        )
        payload = build_conflict_payload(
            task_id=task_id,
            operation=operation,
            expected_statuses=expected_statuses,
            requested_status=requested_status,
            current_status=current_status,
            current_updated_at=_normalize_text(current.get("updated_at")) or None,
            current_version=None,
        )
        logger.info(
            "hub.task.transition_conflict task_id=%s user_id=%s operation=%s expected=%s "
            "requested=%s current=%s correlation_id=%s",
            task_id,
            user_id,
            operation,
            expected_label,
            requested_status,
            current_status,
            correlation_id or "",
        )
        from backend.services.hub_task_transitions import TaskTransitionConflict

        raise TaskTransitionConflict(payload)

    def _conditional_status_update(
        self,
        conn: sqlite3.Connection,
        *,
        task_id: str,
        operation: str,
        expected_statuses: set[str] | frozenset[str],
        target_status: str,
        set_sql: str,
        set_params: tuple[Any, ...] | list[Any],
        user_id: int | None = None,
        correlation_id: str | None = None,
    ) -> str:
        """Atomically update status when current status ∈ expected_statuses.

        Returns previous status that was matched (from soft-read is NOT used as truth —
        success is solely rowcount==1). On zero rows raises TaskTransitionConflict.
        """
        from backend.services.hub_task_transitions import expected_status_label, note_transition_attempt

        expected = frozenset(str(item).strip().lower() for item in expected_statuses if str(item).strip())
        if not expected:
            raise ValueError("expected_statuses must not be empty")
        target = _normalize_text(target_status).lower()
        expected_label = expected_status_label(expected)
        note_transition_attempt(operation=operation, expected_status=expected_label, target_status=target)
        placeholders = ", ".join(["?"] * len(expected))
        sql = f"""
            UPDATE {self._TASKS_TABLE}
            SET {set_sql}
            WHERE id = ? AND status IN ({placeholders})
            """
        params = tuple(set_params) + (task_id, *sorted(expected))
        tx_started = time.perf_counter()
        result = conn.execute(sql, params)
        if self._rowcount(result) <= 0:
            self._raise_task_transition_conflict(
                conn,
                task_id=task_id,
                operation=operation,
                expected_statuses=expected,
                requested_status=target,
                user_id=user_id,
                correlation_id=correlation_id,
            )
        # Recover matched old status for status_log: prefer single expected, else re-read is wrong
        # after update. Store old_status as the only expected when singleton; otherwise use
        # the pre-update soft status passed by caller via set_params side channel — callers
        # pass old_status explicitly to _log_status_change.
        logger.info(
            "hub.task.transition_success task_id=%s user_id=%s operation=%s expected=%s "
            "target=%s transaction_ms=%.2f correlation_id=%s",
            task_id,
            user_id,
            operation,
            expected_label,
            target,
            self._elapsed_ms(tx_started),
            correlation_id or "",
        )
        from backend.services.hub_task_transitions import note_transition_success

        note_transition_success(operation=operation, expected_status=expected_label, target_status=target)
        return target

    def start_task(self, *, task_id: str, user: dict[str, Any]) -> Optional[dict[str, Any]]:
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return None
        user_id = self._as_int(user.get("id"))
        now_iso = _utc_now_iso()
        spec = self._transition_spec("start")
        expected = set(spec["from"])
        target = str(spec["to"])
        with self._db_conn(write=True) as conn:
            row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            if row is None:
                return None
            task = dict(row)
            if not self._can_act_as_assignee(task, user_id):
                raise PermissionError("Only assignee can start the task")
            old_status = _normalize_text(task.get("status")).lower()
            self._conditional_status_update(
                conn,
                task_id=normalized_id,
                operation="start",
                expected_statuses=expected,
                target_status=target,
                set_sql="status = ?, completed_at = NULL, completed_at_source = NULL, updated_at = ?",
                set_params=(target, now_iso),
                user_id=user_id,
            )
            self._ensure_task_status_log_table(conn)
            self._log_status_change(
                conn,
                task_id=normalized_id,
                old_status=old_status if old_status in expected else sorted(expected)[0],
                new_status=target,
                user_id=user_id,
                username=_normalize_text(user.get("username")),
            )
            conn.commit()
            updated = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            result = self._task_with_latest_report(conn, updated, viewer_user_id=user_id) if updated else None
        self._publish_task_realtime(
            task=result,
            previous_task=task,
            operation="started",
            actor_user_id=user_id,
        )
        return result

    def _can_reopen_task(self, task: dict[str, Any], user: dict[str, Any], *, is_admin: bool = False) -> bool:
        if _normalize_text(task.get("integration_kind")).lower() == "transfer_act_upload":
            return False
        if _normalize_text(task.get("status")).lower() != "done":
            return False
        user_id = self._as_int(user.get("id"))
        if user_id <= 0:
            return False
        if is_admin or self._is_admin_role(user.get("role")):
            return True
        if user_is_department_manager(user, task.get("department_id")):
            return True
        return user_id in self._task_participant_user_ids(task, include_delegates=True)

    def reopen_task(
        self,
        *,
        task_id: str,
        user: dict[str, Any],
        is_admin: bool = False,
        due_at: Any = None,
        due_at_provided: bool = False,
    ) -> Optional[dict[str, Any]]:
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return None
        user_id = self._as_int(user.get("id"))
        now_iso = _utc_now_iso()
        spec = self._transition_spec("reopen")
        expected = set(spec["from"])
        target = str(spec["to"])
        with self._db_conn(write=True) as conn:
            row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            if row is None:
                return None
            task = dict(row)
            if not self._can_reopen_task(task, user, is_admin=is_admin):
                if _normalize_text(task.get("integration_kind")).lower() == "transfer_act_upload":
                    raise PermissionError("Transfer-act tasks cannot be reopened")
                if _normalize_text(task.get("status")).lower() not in expected:
                    self._raise_task_transition_conflict(
                        conn,
                        task_id=normalized_id,
                        operation="reopen",
                        expected_statuses=expected,
                        requested_status=target,
                        user_id=user_id,
                    )
                raise PermissionError("Only task participants can reopen the task")
            old_status = _normalize_text(task.get("status")).lower()
            if due_at_provided:
                next_due_at = _normalize_text(due_at) or None
            else:
                next_due_at = _normalize_text(task.get("due_at")) or None
            if due_at_provided:
                self._conditional_status_update(
                    conn,
                    task_id=normalized_id,
                    operation="reopen",
                    expected_statuses=expected,
                    target_status=target,
                    set_sql="status = ?, completed_at = NULL, completed_at_source = NULL, due_at = ?, updated_at = ?",
                    set_params=(target, next_due_at, now_iso),
                    user_id=user_id,
                )
            else:
                self._conditional_status_update(
                    conn,
                    task_id=normalized_id,
                    operation="reopen",
                    expected_statuses=expected,
                    target_status=target,
                    set_sql="status = ?, completed_at = NULL, completed_at_source = NULL, updated_at = ?",
                    set_params=(target, now_iso),
                    user_id=user_id,
                )
            self._ensure_task_status_log_table(conn)
            self._log_status_change(
                conn,
                task_id=normalized_id,
                old_status=old_status if old_status in expected else "done",
                new_status=target,
                user_id=user_id,
                username=_normalize_text(user.get("username")),
            )
            title_text = _normalize_text(task.get("title"))
            due_label = self._format_task_email_due(next_due_at)
            if due_label and due_label != "Без срока":
                notification_body = f"{title_text}: возвращено в работу. Новый срок: {due_label}"
            else:
                notification_body = f"{title_text}: возвращено в работу"
            participant_ids = self._task_participant_user_ids(task, include_delegates=True)
            notify_ids = {item for item in participant_ids if item > 0 and item != user_id}
            if notify_ids:
                self._create_task_notifications(
                    conn,
                    recipient_user_ids=notify_ids,
                    skip_user_ids={user_id},
                    event_type="task.reopened",
                    title="Задача возвращена в работу",
                    body=notification_body,
                    task_id=normalized_id,
                )
            conn.commit()
            updated = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            result = self._task_with_latest_report(conn, updated, viewer_user_id=user_id) if updated else None
        self._publish_task_realtime(
            task=result,
            previous_task=task,
            operation="reopened",
            actor_user_id=user_id,
        )
        return result

    def submit_task(
        self,
        *,
        task_id: str,
        user: dict[str, Any],
        comment: str,
        file_name: Optional[str],
        file_bytes: Optional[bytes],
        file_mime: Optional[str],
    ) -> Optional[dict[str, Any]]:
        started_at = time.perf_counter()
        stages: dict[str, float] = {}
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return None
        user_id = self._as_int(user.get("id"))
        now_iso = _utc_now_iso()
        title_text = ""
        creator_user_id = 0
        controller_user_id = 0
        db_started = time.perf_counter()
        spec = self._transition_spec("submit")
        expected = set(spec["from"])
        target = str(spec["to"])
        report_id = str(uuid.uuid4())
        rel_path: Optional[str] = None
        safe_name: Optional[str] = None
        file_size: Optional[int] = None
        if file_bytes:
            safe_name, rel_path, file_size = self._store_attachment_file(
                root=self.task_attachments_root,
                parent_id=normalized_id,
                attachment_id=report_id,
                file_name=file_name or "report.bin",
                file_bytes=bytes(file_bytes),
            )
        try:
            with self._db_conn(write=True) as conn:
                row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
                if row is None:
                    raise LookupError("Task not found")
                task = dict(row)
                if not self._can_act_as_assignee(task, user_id):
                    raise PermissionError("Only assignee can submit the task")
                old_status = _normalize_text(task.get("status")).lower()
                self._conditional_status_update(
                    conn,
                    task_id=normalized_id,
                    operation="submit",
                    expected_statuses=expected,
                    target_status=target,
                    set_sql="status = ?, submitted_at = ?, completed_at = NULL, completed_at_source = NULL, updated_at = ?",
                    set_params=(target, now_iso, now_iso),
                    user_id=user_id,
                )
                conn.execute(
                    f"""
                    INSERT INTO {self._TASK_REPORTS_TABLE}
                    (id, task_id, comment, file_name, file_path, file_mime, file_size, uploaded_by_user_id, uploaded_by_username, uploaded_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        report_id,
                        normalized_id,
                        _normalize_text(comment),
                        safe_name,
                        rel_path,
                        _normalize_text(file_mime),
                        file_size,
                        user_id,
                        _normalize_text(user.get("username")),
                        now_iso,
                    ),
                )
                if rel_path and safe_name:
                    self._insert_task_attachment(
                        conn=conn,
                        task_id=normalized_id,
                        scope="report",
                        file_name=safe_name,
                        file_path=rel_path,
                        file_mime=file_mime,
                        file_size=self._as_int(file_size),
                        user_id=user_id,
                        username=_normalize_text(user.get("username")),
                        uploaded_at=now_iso,
                    )
                self._ensure_task_status_log_table(conn)
                self._log_status_change(
                    conn,
                    task_id=normalized_id,
                    old_status=old_status if old_status in expected else sorted(expected)[0],
                    new_status=target,
                    user_id=user_id,
                    username=_normalize_text(user.get("username")),
                )
                title_text = _normalize_text(task.get("title"))
                creator_user_id = self._as_int(task.get("created_by_user_id"))
                controller_user_id = self._as_int(task.get("controller_user_id"))
                conn.commit()
        except Exception:
            if rel_path:
                try:
                    abs_path = (self.data_dir / rel_path).resolve()
                    if abs_path.is_file():
                        abs_path.unlink()
                except Exception:
                    pass
            raise
        stages["db_write_ms"] = self._elapsed_ms(db_started)

        notify_started = time.perf_counter()
        recipients = 0
        with self._hub_push_deferred() as push_stats:
            with self._db_conn(write=True) as conn:
                email_task = None
                row_after = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
                if row_after is not None:
                    email_task = self._task_with_latest_report(conn, row_after, viewer_user_id=None)
                if creator_user_id > 0 and creator_user_id != user_id:
                    recipients += 1
                    self._create_notification(
                        recipient_user_id=creator_user_id,
                        event_type="task.submitted",
                        title="Задача отправлена на проверку",
                        body=title_text,
                        entity_type="task",
                        entity_id=normalized_id,
                        conn=conn,
                    )
                    self._queue_task_email_event(
                        conn,
                        recipient_user_id=creator_user_id,
                        event_type="task.submitted",
                        task_id=normalized_id,
                        notification_title="Задача отправлена на проверку",
                        notification_body=title_text,
                        dedupe_hint=now_iso,
                        task=email_task,
                    )
                if controller_user_id > 0 and controller_user_id not in {user_id, creator_user_id}:
                    recipients += 1
                    self._create_notification(
                        recipient_user_id=controller_user_id,
                        event_type="task.review_required",
                        title="Требуется проверка задачи",
                        body=title_text,
                        entity_type="task",
                        entity_id=normalized_id,
                        conn=conn,
                    )
                    self._queue_task_email_event(
                        conn,
                        recipient_user_id=controller_user_id,
                        event_type="task.review_required",
                        task_id=normalized_id,
                        notification_title="Требуется проверка задачи",
                        notification_body=title_text,
                        dedupe_hint=now_iso,
                        task=email_task,
                    )
                self._schedule_task_email_outbox_dispatch()
                conn.commit()
            stages["notifications_ms"] = self._elapsed_ms(notify_started)
            enrich_started = time.perf_counter()
            with self._db_conn(write=False) as conn:
                updated = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
                result = self._task_with_latest_report(conn, updated, viewer_user_id=user_id) if updated else None
            stages["enrich_ms"] = self._elapsed_ms(enrich_started)
        stages["push_flush_ms"] = float(push_stats.get("push_flush_ms") or 0.0)
        self._log_task_write_timing(
            "submit",
            started_at=started_at,
            stages=stages,
            task_id=normalized_id,
            recipients=recipients,
            push_jobs=int(push_stats.get("push_jobs") or 0),
        )
        self._publish_task_realtime(
            task=result,
            operation="submitted",
            actor_user_id=user_id,
        )
        return result

    def review_task(
        self,
        *,
        task_id: str,
        reviewer: dict[str, Any],
        decision: str,
        comment: str,
        is_admin: bool = False,
    ) -> Optional[dict[str, Any]]:
        started_at = time.perf_counter()
        stages: dict[str, float] = {}
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return None
        decision_text = _normalize_text(decision).lower()
        if decision_text not in {"approve", "reject"}:
            from backend.services.hub_task_transitions import note_transition_invalid

            note_transition_invalid(operation="review", expected_status="review", target_status="")
            raise ValueError("Review decision must be approve or reject")
        now_iso = _utc_now_iso()
        operation = "approve" if decision_text == "approve" else "reject"
        spec = self._transition_spec(operation)
        expected = set(spec["from"])
        next_status = str(spec["to"])
        reviewer_id = self._as_int(reviewer.get("id"))
        creator_id = 0
        controller_id = 0
        assignee_id = 0
        title_text = ""
        review_result = "Принято" if next_status == "done" else "Возвращено"
        db_started = time.perf_counter()
        with self._db_conn(write=True) as conn:
            row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            if row is None:
                return None
            task = dict(row)
            creator_id = self._as_int(task.get("created_by_user_id"))
            controller_id = self._as_int(task.get("controller_user_id"))
            if _assignee_cannot_review_as_non_creator(reviewer, task):
                raise PermissionError("Assignee cannot review a task they did not assign to themselves")
            if not can_review_task(reviewer, task):
                raise PermissionError("Only task creator, controller, or admin can review this task")
            old_status = _normalize_text(task.get("status")).lower()
            self._conditional_status_update(
                conn,
                task_id=normalized_id,
                operation=operation,
                expected_statuses=expected,
                target_status=next_status,
                set_sql=(
                    "status = ?, reviewed_at = ?, reviewer_user_id = ?, reviewer_username = ?, "
                    "reviewer_full_name = ?, review_comment = ?, completed_at = ?, completed_at_source = ?, updated_at = ?"
                ),
                set_params=(
                    next_status,
                    now_iso,
                    reviewer_id,
                    _normalize_text(reviewer.get("username")),
                    _normalize_text(reviewer.get("full_name")),
                    _normalize_text(comment),
                    now_iso if next_status == "done" else None,
                    "explicit" if next_status == "done" else None,
                    now_iso,
                ),
                user_id=reviewer_id,
            )
            self._ensure_task_status_log_table(conn)
            self._log_status_change(
                conn,
                task_id=normalized_id,
                old_status=old_status if old_status in expected else "review",
                new_status=next_status,
                user_id=reviewer_id,
                username=_normalize_text(reviewer.get("username")),
            )
            title_text = _normalize_text(task.get("title"))
            assignee_ids = self._task_assignee_user_ids(task)
            conn.commit()
        stages["db_write_ms"] = self._elapsed_ms(db_started)

        notify_started = time.perf_counter()
        assignee_recipients = set(assignee_ids)
        for assignee_id in assignee_ids:
            assignee_recipients.update(self._task_delegate_user_ids(assignee_id))
        recipient_ids = set(assignee_recipients)
        for recipient_user_id in {creator_id, controller_id}:
            if recipient_user_id > 0 and recipient_user_id != reviewer_id and recipient_user_id not in assignee_ids:
                recipient_ids.add(recipient_user_id)
        with self._hub_push_deferred() as push_stats:
            with self._db_conn(write=True) as conn:
                self._create_task_notifications(
                    conn,
                    recipient_user_ids=assignee_recipients,
                    skip_user_ids={reviewer_id},
                    event_type="task.reviewed",
                    title="Результат проверки задачи",
                    body=f"{title_text}: {review_result}",
                    task_id=normalized_id,
                )
                for recipient_user_id in {creator_id, controller_id}:
                    if recipient_user_id <= 0 or recipient_user_id == reviewer_id or recipient_user_id in assignee_ids:
                        continue
                    self._create_task_notifications(
                        conn,
                        recipient_user_ids={recipient_user_id},
                        skip_user_ids={reviewer_id, *assignee_ids},
                        event_type="task.reviewed",
                        title="Задача проверена",
                        body=f"{title_text}: {review_result}",
                        task_id=normalized_id,
                    )
                conn.commit()
            stages["notifications_ms"] = self._elapsed_ms(notify_started)
            enrich_started = time.perf_counter()
            with self._db_conn(write=False) as conn:
                updated = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
                result = self._task_with_latest_report(conn, updated, viewer_user_id=reviewer_id) if updated else None
            stages["enrich_ms"] = self._elapsed_ms(enrich_started)
        stages["push_flush_ms"] = float(push_stats.get("push_flush_ms") or 0.0)
        self._log_task_write_timing(
            "review",
            started_at=started_at,
            stages=stages,
            task_id=normalized_id,
            decision=decision_text,
            recipients=len({item for item in recipient_ids if item > 0 and item != reviewer_id}),
            push_jobs=int(push_stats.get("push_jobs") or 0),
        )
        self._publish_task_realtime(
            task=result,
            operation="reviewed",
            actor_user_id=reviewer_id,
        )
        return result

    def complete_task_direct(
        self,
        *,
        task_id: str,
        actor: dict[str, Any],
        comment: str = "",
        enforce_permission: bool = False,
    ) -> Optional[dict[str, Any]]:
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return None
        actor_id = self._as_int(actor.get("id"))
        now_iso = _utc_now_iso()
        comment_text = _normalize_text(comment)
        spec = self._transition_spec("complete_direct")
        expected = set(spec["from"])
        target = str(spec["to"])
        with self._db_conn(write=True) as conn:
            row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            if row is None:
                return None
            task = dict(row)
            old_status = _normalize_text(task.get("status")).lower()
            if enforce_permission:
                if not user_can_close_task(actor, task):
                    if _normalize_text(task.get("integration_kind")).lower() == "transfer_act_upload":
                        raise PermissionError("Transfer-act tasks cannot be closed manually")
                    raise PermissionError("Only task creator, department manager, or admin can close this task")
                if old_status == "done":
                    return self._task_with_latest_report(conn, row, viewer_user_id=actor_id)
            elif old_status == "done":
                return self._task_with_latest_report(conn, row, viewer_user_id=actor_id)

            self._conditional_status_update(
                conn,
                task_id=normalized_id,
                operation="complete_direct",
                expected_statuses=expected,
                target_status=target,
                set_sql=(
                    "status = ?, reviewed_at = ?, reviewer_user_id = ?, reviewer_username = ?, "
                    "reviewer_full_name = ?, review_comment = ?, completed_at = ?, completed_at_source = ?, updated_at = ?"
                ),
                set_params=(
                    target,
                    now_iso,
                    actor_id if actor_id > 0 else None,
                    _normalize_text(actor.get("username")) or None,
                    _normalize_text(actor.get("full_name")) or _normalize_text(actor.get("username")) or None,
                    comment_text or None,
                    now_iso,
                    "explicit",
                    now_iso,
                ),
                user_id=actor_id,
            )
            self._ensure_task_status_log_table(conn)
            self._log_status_change(
                conn,
                task_id=normalized_id,
                old_status=old_status if old_status in expected else sorted(expected)[0],
                new_status=target,
                user_id=actor_id,
                username=_normalize_text(actor.get("username")),
            )
            if comment_text:
                conn.execute(
                    f"""
                    INSERT INTO {self._TASK_COMMENTS_TABLE} (id, task_id, user_id, username, full_name, body, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        normalized_id,
                        actor_id,
                        _normalize_text(actor.get("username")),
                        _normalize_text(actor.get("full_name")) or _normalize_text(actor.get("username")),
                        comment_text,
                        now_iso,
                    ),
                )

            title_text = _normalize_text(task.get("title"))
            self._create_task_notifications(
                conn,
                recipient_user_ids=self._task_participant_user_ids(task, include_delegates=True),
                skip_user_ids={actor_id},
                event_type="task.reviewed",
                title="Задача закрыта" if enforce_permission else "Задача закрыта автоматически",
                body=title_text,
                task_id=normalized_id,
            )
            conn.commit()
            updated = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            result = self._task_with_latest_report(conn, updated, viewer_user_id=actor_id) if updated else None
        self._publish_task_realtime(
            task=result,
            previous_task=task,
            operation="completed",
            actor_user_id=actor_id,
        )
        return result

    def get_report(self, report_id: str) -> Optional[dict[str, Any]]:
        normalized_id = _normalize_text(report_id)
        if not normalized_id:
            return None
        with self._lock, self._connect() as conn:
            row = conn.execute(f"SELECT * FROM {self._TASK_REPORTS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            if row is None:
                return None
            item = dict(row)
            rel_path = _normalize_text(item.get("file_path"))
            item["file_abs_path"] = str((self.data_dir / rel_path).resolve()) if rel_path else ""
            return item

    def mark_notification_read(self, *, notification_id: str, user_id: int) -> bool:
        normalized_id = _normalize_text(notification_id)
        if not normalized_id:
            return False
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            exists = conn.execute(f"SELECT id FROM {self._NOTIF_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            if exists is None:
                return False
            conn.execute(
                f"""
                INSERT OR IGNORE INTO {self._NOTIF_READS_TABLE}(notification_id, user_id, read_at)
                VALUES (?, ?, ?)
                """,
                (normalized_id, int(user_id), now_iso),
            )
            conn.commit()
        self._invalidate_unread_counts_cache(int(user_id))
        return True

    def mark_all_notifications_read(self, *, user_id: int) -> int:
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                INSERT OR IGNORE INTO {self._NOTIF_READS_TABLE}(notification_id, user_id, read_at)
                SELECT n.id, ?, ?
                FROM {self._NOTIF_TABLE} n
                LEFT JOIN {self._NOTIF_READS_TABLE} r
                  ON r.notification_id = n.id AND r.user_id = ?
                WHERE (n.recipient_user_id IS NULL OR n.recipient_user_id = ?)
                  AND r.user_id IS NULL
                """,
                (int(user_id), now_iso, int(user_id), int(user_id)),
            )
            changed = self._as_int(conn.total_changes)
            conn.commit()
        self._invalidate_unread_counts_cache(int(user_id))
        return changed

    def mark_task_notifications_read(
        self,
        *,
        task_id: str,
        user_id: int,
        event_types: Optional[list[str]] = None,
    ) -> int:
        normalized_task_id = _normalize_text(task_id)
        if not normalized_task_id:
            return 0
        normalized_events = [
            _normalize_text(item).lower()
            for item in (
                event_types
                or [
                    "task.assigned",
                    "task.controller_assigned",
                    "task.reviewed",
                    "task.review_required",
                    "task.submitted",
                    "task.comment_added",
                    "task.deadline_changed",
                    "task.deadline_soon",
                    "task.overdue_reminder",
                ]
            )
            if _normalize_text(item)
        ]
        if not normalized_events:
            return 0
        placeholders = ", ".join(["?"] * len(normalized_events))
        params: list[Any] = [int(user_id), _utc_now_iso(), int(user_id), normalized_task_id]
        params.extend(normalized_events)
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                INSERT OR IGNORE INTO {self._NOTIF_READS_TABLE}(notification_id, user_id, read_at)
                SELECT n.id, ?, ?
                FROM {self._NOTIF_TABLE} n
                WHERE (n.recipient_user_id IS NULL OR n.recipient_user_id = ?)
                  AND n.entity_type = 'task'
                  AND n.entity_id = ?
                  AND LOWER(n.event_type) IN ({placeholders})
                """,
                tuple(params),
            )
            changed = self._as_int(conn.total_changes)
            conn.commit()
        self._invalidate_unread_counts_cache(int(user_id))
        return changed

    def mark_chat_notifications_read(
        self,
        *,
        conversation_id: str,
        user_id: int,
        event_types: Optional[list[str]] = None,
    ) -> int:
        normalized_conversation_id = _normalize_text(conversation_id)
        if not normalized_conversation_id:
            return 0
        if event_types is None:
            try:
                from backend.chat.hub_bell_events import default_mark_chat_notification_event_types

                default_event_types = default_mark_chat_notification_event_types()
            except Exception:
                default_event_types = [
                    "chat.message_received",
                    "chat.task_shared",
                    "chat.file_shared",
                    "chat.mention",
                ]
        else:
            default_event_types = list(event_types)
        normalized_events = [
            _normalize_text(item).lower()
            for item in default_event_types
            if _normalize_text(item)
        ]
        if not normalized_events:
            return 0
        placeholders = ", ".join(["?"] * len(normalized_events))
        params: list[Any] = [int(user_id), _utc_now_iso(), int(user_id), normalized_conversation_id]
        params.extend(normalized_events)
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                INSERT OR IGNORE INTO {self._NOTIF_READS_TABLE}(notification_id, user_id, read_at)
                SELECT n.id, ?, ?
                FROM {self._NOTIF_TABLE} n
                WHERE (n.recipient_user_id IS NULL OR n.recipient_user_id = ?)
                  AND n.entity_type = 'chat'
                  AND n.entity_id = ?
                  AND LOWER(n.event_type) IN ({placeholders})
                """,
                tuple(params),
            )
            changed = self._as_int(conn.total_changes)
            conn.commit()
        self._invalidate_unread_counts_cache(int(user_id))
        return changed

    def _ensure_task_due_notifications_for_user(self, conn: sqlite3.Connection, *, user_id: int) -> None:
        normalized_user_id = self._as_int(user_id)
        if normalized_user_id <= 0:
            return
        delegate_owner_ids = user_service.get_delegate_owner_ids(normalized_user_id)
        assignee_filters = [normalized_user_id, *delegate_owner_ids]
        assignee_clause, assignee_params = self._assignee_membership_any_clause(assignee_filters)
        rows = conn.execute(
            f"""
            SELECT id, title, due_at, status, email_deadline_remind_hours
            FROM {self._TASKS_TABLE}
            WHERE status <> 'done'
              AND due_at IS NOT NULL
              AND due_at <> ''
              AND {assignee_clause}
            """,
            tuple(assignee_params),
        ).fetchall()
        now_utc = datetime.now(timezone.utc)
        today_iso = now_utc.date().isoformat()
        overdue_tasks_for_digest: list[dict[str, Any]] = []
        queued_email = False
        for row in rows:
            item = dict(row)
            due_at = self._parse_iso_datetime(item.get("due_at"))
            if due_at is None:
                continue
            title_text = _normalize_text(item.get("title"))
            email_deadline_hours = _resolve_email_deadline_remind_hours(item)
            if due_at < now_utc:
                overdue_tasks_for_digest.append(item)
                if not self._notification_exists(
                    conn,
                    recipient_user_id=normalized_user_id,
                    event_type="task.overdue_reminder",
                    entity_type="task",
                    entity_id=_normalize_text(item.get("id")),
                    created_on_date=today_iso,
                ):
                    self._create_notification(
                        recipient_user_id=normalized_user_id,
                        event_type="task.overdue_reminder",
                        title="Просроченная задача",
                        body=title_text,
                        entity_type="task",
                        entity_id=_normalize_text(item.get("id")),
                        conn=conn,
                    )
                continue
            hours_left = (due_at - now_utc).total_seconds() / 3600.0
            if hours_left > 72:
                continue
            if not self._notification_exists(
                    conn,
                    recipient_user_id=normalized_user_id,
                    event_type="task.deadline_soon",
                    entity_type="task",
                    entity_id=_normalize_text(item.get("id")),
            ):
                self._create_notification(
                    recipient_user_id=normalized_user_id,
                    event_type="task.deadline_soon",
                    title="Срок задачи приближается",
                    body=title_text,
                    entity_type="task",
                    entity_id=_normalize_text(item.get("id")),
                    conn=conn,
                )
            if email_deadline_hours is not None and hours_left <= email_deadline_hours:
                queued_email = self._queue_task_email_event(
                    conn,
                    recipient_user_id=normalized_user_id,
                    event_type="task.deadline_soon",
                    task_id=_normalize_text(item.get("id")),
                    notification_title="Срок задачи приближается",
                    notification_body=title_text,
                ) or queued_email
        if overdue_tasks_for_digest:
            queued_email = self._queue_overdue_digest_email(
                conn,
                recipient_user_id=normalized_user_id,
                tasks=overdue_tasks_for_digest,
                digest_date=today_iso,
            ) or queued_email
        if queued_email:
            self._schedule_task_email_outbox_dispatch()

    def _collect_task_due_notification_user_ids(self, conn: sqlite3.Connection) -> list[int]:
        rows = conn.execute(
            f"""
            SELECT assignee_user_id, assignee_user_ids
            FROM {self._TASKS_TABLE}
            WHERE status <> 'done'
              AND due_at IS NOT NULL
              AND due_at <> ''
            """
        ).fetchall()
        assignee_ids: set[int] = set()
        for row in rows:
            assignee_ids.update(self._task_assignee_user_ids(dict(row)))
        candidates = set(assignee_ids)
        for assignee_id in assignee_ids:
            for delegate_id in user_service.get_delegate_user_ids(assignee_id):
                normalized_delegate_id = self._as_int(delegate_id)
                if normalized_delegate_id > 0:
                    candidates.add(normalized_delegate_id)
        return sorted(candidates)

    def run_task_due_notifications_for_user(self, user_id: int, *, force: bool = False) -> None:
        normalized_user_id = self._as_int(user_id)
        if normalized_user_id <= 0:
            return
        with self._lock, self._connect() as conn:
            if force:
                self._ensure_task_due_notifications_for_user(conn, user_id=normalized_user_id)
            else:
                self._maybe_ensure_task_due_notifications_for_user(conn, user_id=normalized_user_id)

    def run_task_due_notification_cycle(self) -> int:
        with self._lock, self._connect() as conn:
            user_ids = self._collect_task_due_notification_user_ids(conn)
        processed = 0
        for user_id in user_ids:
            with self._lock, self._connect() as conn:
                self._maybe_ensure_task_due_notifications_for_user(conn, user_id=user_id)
            processed += 1
        return processed

    def _invalidate_unread_counts_cache(self, user_id: int | None = None) -> None:
        with self._unread_counts_cache_lock:
            if user_id is None:
                self._unread_counts_cache.clear()
            else:
                normalized = int(user_id)
                stale_keys = [
                    key for key in self._unread_counts_cache
                    if (
                        (isinstance(key, tuple) and key and int(key[0]) == normalized)
                        or key == normalized
                    )
                ]
                for key in stale_keys:
                    self._unread_counts_cache.pop(key, None)
        self._invalidate_notifications_poll_cache(user_id)
        self._invalidate_dashboard_cache(user_id)

    def _invalidate_notifications_poll_cache(self, user_id: int | None = None) -> None:
        with self._notifications_poll_cache_lock:
            if user_id is None:
                self._notifications_poll_cache.clear()
                return
            normalized = int(user_id)
            stale_keys = [key for key in self._notifications_poll_cache if key[0] == normalized]
            for key in stale_keys:
                self._notifications_poll_cache.pop(key, None)

    def _get_cached_notifications_poll(self, cache_key: tuple[Any, ...]) -> dict[str, Any] | None:
        now_mono = time.monotonic()
        with self._notifications_poll_cache_lock:
            cached = self._notifications_poll_cache.get(cache_key)
            if cached is not None and (now_mono - cached[0]) < self._notifications_poll_cache_ttl_sec:
                return copy.deepcopy(cached[1])
        return None

    def _store_notifications_poll_cache(self, cache_key: tuple[Any, ...], payload: dict[str, Any]) -> None:
        with self._notifications_poll_cache_lock:
            self._notifications_poll_cache[cache_key] = (time.monotonic(), copy.deepcopy(payload))

    def _invalidate_dashboard_cache(self, user_id: int | None = None) -> None:
        with self._dashboard_cache_lock:
            if user_id is None:
                self._dashboard_cache.clear()
            else:
                normalized = int(user_id)
                stale_keys = [key for key in self._dashboard_cache if key[0] == normalized]
                for key in stale_keys:
                    self._dashboard_cache.pop(key, None)
        self._invalidate_tasks_list_cache(user_id)

    def _invalidate_tasks_list_cache(self, user_id: int | None = None) -> None:
        with self._tasks_list_cache_lock:
            if user_id is None:
                self._tasks_list_cache.clear()
                return
            normalized = int(user_id)
            stale_keys = [key for key in self._tasks_list_cache if key[0] == normalized]
            for key in stale_keys:
                self._tasks_list_cache.pop(key, None)

    def _get_cached_tasks_list(self, cache_key: tuple[Any, ...]) -> dict[str, Any] | None:
        now_mono = time.monotonic()
        with self._tasks_list_cache_lock:
            cached = self._tasks_list_cache.get(cache_key)
            if cached is not None and (now_mono - cached[0]) < self._tasks_list_cache_ttl_sec:
                return copy.deepcopy(cached[1])
        return None

    def _store_tasks_list_cache(self, cache_key: tuple[Any, ...], payload: dict[str, Any]) -> None:
        with self._tasks_list_cache_lock:
            self._tasks_list_cache[cache_key] = (time.monotonic(), copy.deepcopy(payload))

    def _get_cached_dashboard(
        self, *, user_id: int, announcements_limit: int, tasks_limit: int
    ) -> dict[str, Any] | None:
        cache_key = (int(user_id), int(announcements_limit), int(tasks_limit))
        now_mono = time.monotonic()
        with self._dashboard_cache_lock:
            cached = self._dashboard_cache.get(cache_key)
            if cached is not None and (now_mono - cached[0]) < self._dashboard_cache_ttl_sec:
                return copy.deepcopy(cached[1])
        return None

    def _store_dashboard_cache(
        self,
        *,
        user_id: int,
        announcements_limit: int,
        tasks_limit: int,
        payload: dict[str, Any],
    ) -> None:
        cache_key = (int(user_id), int(announcements_limit), int(tasks_limit))
        with self._dashboard_cache_lock:
            self._dashboard_cache[cache_key] = (time.monotonic(), copy.deepcopy(payload))

    def _unread_counts_cache_bucket(self) -> tuple[int, int]:
        try:
            from backend.chat.hub_bell_events import hub_ordinary_read_visible, hub_ordinary_write_enabled

            return (
                int(bool(hub_ordinary_read_visible())),
                int(bool(hub_ordinary_write_enabled())),
            )
        except Exception:
            return (1, 1)

    def _get_cached_unread_counts(self, user_id: int) -> dict[str, int] | None:
        normalized_user_id = int(user_id)
        cache_key = (normalized_user_id, *self._unread_counts_cache_bucket())
        now_mono = time.monotonic()
        with self._unread_counts_cache_lock:
            cached = self._unread_counts_cache.get(cache_key)
            if cached is not None and (now_mono - cached[0]) < self._unread_counts_cache_ttl_sec:
                return dict(cached[1])
        return None

    def _store_unread_counts_cache(self, user_id: int, counts: dict[str, int]) -> None:
        cache_key = (int(user_id), *self._unread_counts_cache_bucket())
        with self._unread_counts_cache_lock:
            self._unread_counts_cache[cache_key] = (time.monotonic(), dict(counts))

    def _maybe_ensure_task_due_notifications_for_user(
        self,
        conn: sqlite3.Connection,
        *,
        user_id: int,
    ) -> None:
        normalized_user_id = self._as_int(user_id)
        if normalized_user_id <= 0:
            return
        now_mono = time.monotonic()
        with self._task_due_ensure_lock:
            last_run = self._task_due_ensure_last.get(normalized_user_id, 0.0)
            if (now_mono - last_run) < self._task_due_ensure_ttl_sec:
                return
            self._task_due_ensure_last[normalized_user_id] = now_mono
        self._ensure_task_due_notifications_for_user(conn, user_id=normalized_user_id)

    def _compute_task_hub_unread_metrics(
        self,
        conn: sqlite3.Connection,
        *,
        user_id: int,
    ) -> dict[str, int]:
        normalized_user_id = int(user_id)
        now_iso = datetime.now(timezone.utc).isoformat()
        assignee_clause, assignee_params = self._assignee_membership_any_clause([normalized_user_id])
        participant_where = f"({assignee_clause} OR created_by_user_id = ? OR controller_user_id = ?)"
        metrics_row = conn.execute(
            f"""
            SELECT
              SUM(CASE WHEN status IN ('new', 'in_progress', 'review') THEN 1 ELSE 0 END) AS tasks_open_total,
              SUM(CASE WHEN status IN ('new', 'in_progress', 'review') AND {assignee_clause} THEN 1 ELSE 0 END) AS tasks_assignee_open,
              SUM(CASE WHEN status IN ('new', 'in_progress', 'review') AND created_by_user_id = ? THEN 1 ELSE 0 END) AS tasks_created_open,
              SUM(CASE WHEN status IN ('new', 'in_progress', 'review') AND controller_user_id = ? THEN 1 ELSE 0 END) AS tasks_controller_open,
              SUM(CASE WHEN status = 'review' AND (created_by_user_id = ? OR controller_user_id = ?) THEN 1 ELSE 0 END) AS tasks_review_required,
              SUM(
                CASE
                  WHEN status <> 'done'
                    AND due_at IS NOT NULL
                    AND due_at <> ''
                    AND due_at < ?
                  THEN 1
                  ELSE 0
                END
              ) AS tasks_overdue
            FROM {self._TASKS_TABLE}
            WHERE {participant_where}
            """,
            (
                *assignee_params,
                normalized_user_id,
                normalized_user_id,
                normalized_user_id,
                normalized_user_id,
                now_iso,
                *assignee_params,
                normalized_user_id,
                normalized_user_id,
            ),
        ).fetchone()
        tasks_with_unread_comments = self._count_tasks_with_unread_comments(conn, user_id=normalized_user_id)
        new_tasks = conn.execute(
            f"""
            SELECT COUNT(*) AS c
            FROM {self._TASKS_TABLE}
            WHERE {assignee_clause} AND status = 'new'
            """,
            tuple(assignee_params),
        ).fetchone()
        open_total = self._as_int(metrics_row["tasks_open_total"] if metrics_row else 0)
        return {
            "tasks_open_total": open_total,
            "tasks_open": open_total,
            "tasks_new": self._as_int(new_tasks["c"] if new_tasks else 0),
            "tasks_assignee_open": self._as_int(metrics_row["tasks_assignee_open"] if metrics_row else 0),
            "tasks_created_open": self._as_int(metrics_row["tasks_created_open"] if metrics_row else 0),
            "tasks_controller_open": self._as_int(metrics_row["tasks_controller_open"] if metrics_row else 0),
            "tasks_review_required": self._as_int(metrics_row["tasks_review_required"] if metrics_row else 0),
            "tasks_overdue": self._as_int(metrics_row["tasks_overdue"] if metrics_row else 0),
            "tasks_with_unread_comments": tasks_with_unread_comments,
        }

    def _count_tasks_with_unread_comments(
        self,
        conn: sqlite3.Connection,
        *,
        user_id: int,
    ) -> int:
        normalized_user_id = int(user_id)
        if normalized_user_id <= 0:
            return 0
        assignee_clause, assignee_params = self._assignee_membership_any_clause([normalized_user_id])
        row = conn.execute(
            f"""
            SELECT COUNT(DISTINCT t.id) AS c
            FROM {self._TASKS_TABLE} t
            INNER JOIN (
                SELECT task_id, MAX(created_at) AS max_created_at
                FROM {self._TASK_COMMENTS_TABLE}
                GROUP BY task_id
            ) latest ON latest.task_id = t.id
            INNER JOIN {self._TASK_COMMENTS_TABLE} c
                ON c.task_id = t.id AND c.created_at = latest.max_created_at
            LEFT JOIN {self._TASK_COMMENT_READS_TABLE} r
                ON r.task_id = t.id AND r.user_id = ?
            WHERE ({assignee_clause} OR t.created_by_user_id = ? OR t.controller_user_id = ?)
              AND c.user_id <> ?
              AND (
                r.last_seen_at IS NULL
                OR TRIM(r.last_seen_at) = ''
                OR c.created_at > r.last_seen_at
              )
            """,
            (
                normalized_user_id,
                *assignee_params,
                normalized_user_id,
                normalized_user_id,
                normalized_user_id,
            ),
        ).fetchone()
        return self._as_int(row["c"] if row else 0)

    def _legacy_ordinary_chat_hub_exclusion_sql(self) -> tuple[str, list[Any]]:
        """Exclude ordinary chat hub rows from bell unread/poll.

        Controlled only by CHAT_HUB_ORDINARY_READ_VISIBLE (not WRITE_ENABLED),
        so rollback of the writer cannot resurrect ~695k legacy unread in badges.
        Important events (e.g. chat.mention) remain visible.
        """
        try:
            from backend.chat.hub_bell_events import (
                hub_ordinary_read_visible,
                ordinary_chat_hub_event_types_sql_list,
            )

            if hub_ordinary_read_visible():
                return "", []
            ordinary_types = ordinary_chat_hub_event_types_sql_list()
        except Exception:
            return "", []
        if not ordinary_types:
            return "", []
        placeholders = ", ".join(["?"] * len(ordinary_types))
        clause = (
            " AND NOT ("
            " LOWER(COALESCE(n.entity_type, '')) = 'chat'"
            f" AND LOWER(COALESCE(n.event_type, '')) IN ({placeholders})"
            " )"
        )
        return clause, [str(item).lower() for item in ordinary_types]

    def _hub_chat_ordinary_flags_payload(self) -> dict[str, Any]:
        try:
            from backend.chat.hub_bell_events import hub_ordinary_flags_snapshot

            snapshot = hub_ordinary_flags_snapshot()
            return {
                "ordinary_write_enabled": bool(snapshot.get("ordinary_write_enabled")),
                "ordinary_read_visible": bool(snapshot.get("ordinary_read_visible")),
                "source": str(snapshot.get("source") or "env"),
            }
        except Exception:
            return {
                "ordinary_write_enabled": True,
                "ordinary_read_visible": True,
                "source": "fallback",
            }

    def _compute_unread_counts(self, conn: sqlite3.Connection, *, user_id: int) -> dict[str, int]:
        exclude_sql, exclude_params = self._legacy_ordinary_chat_hub_exclusion_sql()
        unread_notifications = conn.execute(
            f"""
            SELECT COUNT(*) AS c
            FROM {self._NOTIF_TABLE} n
            LEFT JOIN {self._NOTIF_READS_TABLE} r
              ON r.notification_id = n.id AND r.user_id = ?
            WHERE (n.recipient_user_id IS NULL OR n.recipient_user_id = ?) AND r.user_id IS NULL
            {exclude_sql}
            """,
            (int(user_id), int(user_id), *exclude_params),
        ).fetchone()
        announcement_rows = conn.execute(f"SELECT {self._ANN_SELECT_COLUMNS} FROM {self._ANN_TABLE}").fetchall()
        reads_by_announcement_id = self._load_announcement_reads_for_user(conn, user_id=int(user_id))
        announcements_unread = 0
        announcements_ack_pending = 0
        now_utc = datetime.now(timezone.utc)
        for row in announcement_rows:
            announcement_id = _normalize_text(
                row["id"] if not isinstance(row, dict) else row.get("id")
            )
            # Counts path: skip attachment payload; only unread/ack flags are needed.
            item = self._build_announcement_item(
                conn,
                row,
                viewer_user_id=int(user_id),
                include_body=False,
                read_row=reads_by_announcement_id.get(announcement_id, {}),
                attachments_count=0,
                include_attachments=False,
                poll={},
            )
            if item is None or not item.get("is_active"):
                continue
            published_from = self._parse_iso_datetime(item.get("published_from"))
            expires_at = self._parse_iso_datetime(item.get("expires_at"))
            if published_from and published_from > now_utc:
                continue
            if expires_at and expires_at <= now_utc:
                continue
            announcements_unread += 1 if bool(item.get("is_unread")) else 0
            announcements_ack_pending += 1 if bool(item.get("is_ack_pending")) else 0

        task_metrics = self._compute_task_hub_unread_metrics(conn, user_id=int(user_id))
        return {
            "notifications_unread_total": self._as_int(unread_notifications["c"] if unread_notifications else 0),
            "announcements_unread": announcements_unread,
            "announcements_ack_pending": announcements_ack_pending,
            **task_metrics,
        }

    def get_unread_counts(self, *, user_id: int) -> dict[str, Any]:
        normalized_user_id = int(user_id)
        cached_counts = self._get_cached_unread_counts(normalized_user_id)
        if cached_counts is not None:
            payload = dict(cached_counts)
        else:
            with self._db_conn(write=False) as conn:
                counts = self._compute_unread_counts(conn, user_id=normalized_user_id)
            self._store_unread_counts_cache(normalized_user_id, counts)
            payload = dict(counts)
        payload["hub_chat_ordinary"] = self._hub_chat_ordinary_flags_payload()
        return payload

    def poll_notifications(
        self,
        *,
        user_id: int,
        since: str = "",
        limit: int = 50,
        unread_only: bool = False,
    ) -> dict[str, Any]:
        safe_limit = self._coerce_limit(limit, default=50, minimum=1, maximum=200)
        since_text = _normalize_text(since)
        normalized_user_id = int(user_id)
        try:
            from backend.chat.hub_bell_events import hub_ordinary_read_visible, hub_ordinary_write_enabled

            ordinary_read_flag = int(bool(hub_ordinary_read_visible()))
            ordinary_write_flag = int(bool(hub_ordinary_write_enabled()))
        except Exception:
            ordinary_read_flag = 1
            ordinary_write_flag = 1
        poll_cache_key = (
            normalized_user_id,
            since_text,
            safe_limit,
            int(bool(unread_only)),
            ordinary_read_flag,
            ordinary_write_flag,
        )
        cached_poll = self._get_cached_notifications_poll(poll_cache_key)
        if cached_poll is not None:
            return cached_poll
        params: list[Any] = [normalized_user_id, normalized_user_id]
        extra_where = ""
        if since_text:
            extra_where = " AND n.created_at > ?"
            params.append(since_text)
        if unread_only:
            extra_where += " AND r.user_id IS NULL"
        cached_counts = self._get_cached_unread_counts(normalized_user_id)
        exclude_sql, exclude_params = self._legacy_ordinary_chat_hub_exclusion_sql()
        with self._db_conn(write=False) as conn:
            rows = conn.execute(
                f"""
                SELECT n.*,
                       CASE WHEN r.user_id IS NULL THEN 1 ELSE 0 END AS unread
                FROM {self._NOTIF_TABLE} n
                LEFT JOIN {self._NOTIF_READS_TABLE} r
                  ON r.notification_id = n.id AND r.user_id = ?
                WHERE (n.recipient_user_id IS NULL OR n.recipient_user_id = ?){extra_where}{exclude_sql}
                ORDER BY n.created_at DESC
                LIMIT ?
                """,
                tuple([*params, *exclude_params, safe_limit]),
            ).fetchall()
            counts = (
                cached_counts
                if cached_counts is not None
                else self._compute_unread_counts(conn, user_id=normalized_user_id)
            )

        if cached_counts is None:
            self._store_unread_counts_cache(normalized_user_id, counts)

        payload = {
            "items": [dict(row) for row in rows],
            "since": since_text or None,
            "limit": safe_limit,
            "unread_only": bool(unread_only),
            "unread_counts": counts,
            "hub_chat_ordinary": self._hub_chat_ordinary_flags_payload(),
            "generated_at": _utc_now_iso(),
        }
        self._store_notifications_poll_cache(poll_cache_key, payload)
        return payload

    def get_dashboard(self, *, user_id: int, announcements_limit: int = 20, tasks_limit: int = 10) -> dict[str, Any]:
        safe_announcements_limit = max(1, min(100, int(announcements_limit or 20)))
        safe_tasks_limit = max(1, min(100, int(tasks_limit or 10)))
        cached_dashboard = self._get_cached_dashboard(
            user_id=int(user_id),
            announcements_limit=safe_announcements_limit,
            tasks_limit=safe_tasks_limit,
        )
        if cached_dashboard is not None:
            return cached_dashboard

        # Sequential loads keep APP DB pool pressure linear under multi-VU polls.
        # Parallel ThreadPoolExecutor here previously amplified pool wait under 50+ sessions.
        announcements = self.list_announcements(
            user_id=user_id, limit=safe_announcements_limit, offset=0
        )
        tasks = self.list_tasks(
            user_id=user_id,
            scope="my",
            role_scope="both",
            status_filter="",
            limit=safe_tasks_limit,
            offset=0,
            allow_all_scope=False,
        )
        try:
            from backend.services.employee_absence_service import employee_absence_service

            with self._dashboard_absences_refresh_lock:
                absences_today = employee_absence_service.dashboard_embed(limit=8)
        except Exception:  # noqa: BLE001 — dashboard must stay available if absences store is down
            logger.exception("Failed to embed absences_today into hub dashboard")
            absences_today = {"on": date.today().isoformat(), "count": 0, "items": []}

        # Reuse announcement totals already computed by list_announcements to avoid a second
        # full announcement scan inside get_unread_counts on cache miss.
        cached_counts = self._get_cached_unread_counts(int(user_id))
        if cached_counts is not None:
            unread_counts = dict(cached_counts)
        else:
            with self._db_conn(write=False) as conn:
                exclude_sql, exclude_params = self._legacy_ordinary_chat_hub_exclusion_sql()
                unread_notifications = conn.execute(
                    f"""
                    SELECT COUNT(*) AS c
                    FROM {self._NOTIF_TABLE} n
                    LEFT JOIN {self._NOTIF_READS_TABLE} r
                      ON r.notification_id = n.id AND r.user_id = ?
                    WHERE (n.recipient_user_id IS NULL OR n.recipient_user_id = ?) AND r.user_id IS NULL
                    {exclude_sql}
                    """,
                    (int(user_id), int(user_id), *exclude_params),
                ).fetchone()
                task_metrics = self._compute_task_hub_unread_metrics(conn, user_id=int(user_id))
            unread_counts = {
                "notifications_unread_total": self._as_int(
                    unread_notifications["c"] if unread_notifications else 0
                ),
                "announcements_unread": self._as_int(announcements.get("unread_total")),
                "announcements_ack_pending": self._as_int(announcements.get("ack_pending_total")),
                **task_metrics,
            }
            self._store_unread_counts_cache(int(user_id), unread_counts)
        payload = {
            "generated_at": _utc_now_iso(),
            "announcements": announcements,
            "my_tasks": tasks,
            "unread_counts": unread_counts,
            "absences_today": absences_today,
            "summary": {
                "announcements_ack_pending": unread_counts.get("announcements_ack_pending", 0),
                "announcements_attention": unread_counts.get("announcements_unread", 0),
                "tasks_open_total": unread_counts.get("tasks_open_total", unread_counts.get("tasks_open", 0)),
                "tasks_assignee_open": unread_counts.get("tasks_assignee_open", 0),
                "tasks_created_open": unread_counts.get("tasks_created_open", 0),
                "tasks_controller_open": unread_counts.get("tasks_controller_open", 0),
                "tasks_review_required": unread_counts.get("tasks_review_required", 0),
                "tasks_overdue": unread_counts.get("tasks_overdue", 0),
                "tasks_with_unread_comments": unread_counts.get("tasks_with_unread_comments", 0),
                "absences_today": int(absences_today.get("count") or 0),
            },
        }
        self._store_dashboard_cache(
            user_id=int(user_id),
            announcements_limit=safe_announcements_limit,
            tasks_limit=safe_tasks_limit,
            payload=payload,
        )
        return payload


hub_service = HubService()
