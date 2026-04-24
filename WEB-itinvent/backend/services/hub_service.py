"""
Hub service for dashboard announcements, tasks, and notifications.
"""
from __future__ import annotations

import json
import logging
import re
import shutil
import sqlite3
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from threading import RLock
from typing import Any, Optional

from backend.appdb.db import get_app_database_url, get_app_engine, initialize_app_schema, is_app_database_configured
from backend.appdb.sql_compat import SqlAlchemyCompatConnection
from backend.db_schema import schema_name
from local_store import get_local_store
from backend.services.app_push_service import app_push_service
from backend.services.authorization_service import PERM_TASKS_REVIEW, authorization_service
from backend.services.notification_preferences_service import notification_preferences_service
from backend.services.user_service import user_service

logger = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _safe_file_name(value: str) -> str:
    base = Path(str(value or "").strip()).name
    base = re.sub(r"[^A-Za-z0-9._\-\u0400-\u04FF ]+", "_", base)
    return base.strip() or "file.bin"


class HubService:
    _DEFAULT_TASK_PROJECT_ID = "general-tasks"
    _DEFAULT_TASK_PROJECT_NAME = "Общие задачи"
    _DEFAULT_TASK_PROJECT_CODE = "GENERAL"
    _DEFAULT_TASK_PROJECT_DESCRIPTION = "Базовый проект для задач, созданных до введения проектного учёта."
    _TRANSFER_ACT_REMINDER_PROJECT_ID = "transfer-act-reminders"
    _TRANSFER_ACT_REMINDER_PROJECT_NAME = "Перемещение техники"
    _TRANSFER_ACT_REMINDER_PROJECT_CODE = "TRANSFER_ACTS"
    _TRANSFER_ACT_REMINDER_PROJECT_DESCRIPTION = "Системный проект для reminder-задач о загрузке подписанных актов перемещения техники."
    _ANN_TABLE = "hub_announcements"
    _ANN_READS_TABLE = "hub_announcement_reads"
    _ANN_ATTACH_TABLE = "hub_announcement_attachments"
    _TASKS_TABLE = "hub_tasks"
    _TASK_PROJECTS_TABLE = "hub_task_projects"
    _TASK_OBJECTS_TABLE = "hub_task_objects"
    _TASK_REPORTS_TABLE = "hub_task_reports"
    _TASK_ATTACH_TABLE = "hub_task_attachments"
    _TASK_COMMENT_READS_TABLE = "hub_task_comment_reads"
    _TASK_COMMENTS_TABLE = "hub_task_comments"
    _TASK_STATUS_LOG_TABLE = "hub_task_status_log"
    _NOTIF_TABLE = "hub_notifications"
    _NOTIF_READS_TABLE = "hub_notification_reads"
    _TASK_STATUSES = {"new", "in_progress", "review", "done"}
    _COMPLETED_AT_SOURCE_VALUES = {"explicit", "reviewed_at", "submitted_at", "updated_at", "backfill"}

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
        self.task_attachments_root = self.data_dir / "hub_task_attachments"
        self.announcement_attachments_root.mkdir(parents=True, exist_ok=True)
        self.task_attachments_root.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        if self._use_app_db and self._database_url:
            initialize_app_schema(self._database_url)
        self._ensure_schema()

    def _connect(self):
        if self._use_app_db and self._database_url:
            return SqlAlchemyCompatConnection(
                get_app_engine(self._database_url),
                table_names=self._hub_table_names(),
                schema=self._app_schema,
            )
        conn = sqlite3.connect(str(self.db_path), timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _hub_table_names(self) -> set[str]:
        return {
            self._ANN_TABLE,
            self._ANN_READS_TABLE,
            self._ANN_ATTACH_TABLE,
            self._TASKS_TABLE,
            self._TASK_PROJECTS_TABLE,
            self._TASK_OBJECTS_TABLE,
            self._TASK_REPORTS_TABLE,
            self._TASK_ATTACH_TABLE,
            self._TASK_COMMENT_READS_TABLE,
            self._TASK_COMMENTS_TABLE,
            self._TASK_STATUS_LOG_TABLE,
            self._NOTIF_TABLE,
            self._NOTIF_READS_TABLE,
        }

    def _table_columns(self, conn: sqlite3.Connection, table_name: str) -> set[str]:
        rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
        return {str(row["name"]) for row in rows}

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

    def _ensure_task_extended_columns(self, conn: sqlite3.Connection) -> None:
        columns = self._table_columns(conn, self._TASKS_TABLE)
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

    def _ensure_task_status_log_table(self, conn: sqlite3.Connection) -> None:
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

    def _log_status_change(self, conn: sqlite3.Connection, *, task_id: str, old_status: str, new_status: str, user_id: int, username: str) -> None:
        import uuid as _uuid
        now_iso = _utc_now_iso()
        conn.execute(
            f"INSERT INTO {self._TASK_STATUS_LOG_TABLE} (id, task_id, old_status, new_status, changed_by_user_id, changed_by_username, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (str(_uuid.uuid4()), task_id, old_status, new_status, user_id, username, now_iso),
        )

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
            created = conn.execute(f"SELECT * FROM {self._TASK_COMMENTS_TABLE} WHERE id = ?", (comment_id,)).fetchone()
            return dict(created) if created else None

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
                    priority TEXT NOT NULL DEFAULT 'normal'
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
                CREATE INDEX IF NOT EXISTS idx_{self._ANN_TABLE}_published
                    ON {self._ANN_TABLE}(is_active, published_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._ANN_ATTACH_TABLE}_announcement
                    ON {self._ANN_ATTACH_TABLE}(announcement_id, uploaded_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._TASKS_TABLE}_assignee
                    ON {self._TASKS_TABLE}(assignee_user_id, status, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._TASK_ATTACH_TABLE}_task
                    ON {self._TASK_ATTACH_TABLE}(task_id, uploaded_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._TASK_COMMENT_READS_TABLE}_task
                    ON {self._TASK_COMMENT_READS_TABLE}(task_id, user_id);
                CREATE INDEX IF NOT EXISTS idx_{self._NOTIF_TABLE}_recipient
                    ON {self._NOTIF_TABLE}(recipient_user_id, created_at DESC);
                """
            )
            self._ensure_announcement_columns(conn)
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
            return parsed.replace(tzinfo=timezone.utc)
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

    def _active_users(self) -> list[dict[str, Any]]:
        return [row for row in user_service.list_users() if bool(row.get("is_active", True))]

    def _users_by_id(self) -> dict[int, dict[str, Any]]:
        return {self._as_int(row.get("id")): row for row in self._active_users()}

    def _task_delegate_user_ids(self, assignee_user_id: Any) -> list[int]:
        return user_service.get_delegate_user_ids(self._as_int(assignee_user_id))

    def _task_participant_user_ids(self, task: dict[str, Any], *, include_delegates: bool = True) -> set[int]:
        participant_ids = {
            self._as_int(task.get("assignee_user_id")),
            self._as_int(task.get("created_by_user_id")),
            self._as_int(task.get("controller_user_id")),
        }
        if include_delegates:
            participant_ids.update(self._task_delegate_user_ids(task.get("assignee_user_id")))
        return {item for item in participant_ids if item > 0}

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

    def _task_user_can_view(self, task: dict[str, Any], *, user_id: int, is_admin: bool = False) -> bool:
        if is_admin:
            return True
        normalized_user_id = self._as_int(user_id)
        if normalized_user_id <= 0:
            return False
        return normalized_user_id in self._task_participant_user_ids(task, include_delegates=True)

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
        project = self._get_task_project(conn, item.get("project_id"))
        task_object = self._get_task_object(conn, item.get("object_id"))
        item["project_id"] = _normalize_text(item.get("project_id")) or None
        item["project_name"] = _normalize_text(project.get("name")) if project else ""
        item["object_id"] = _normalize_text(item.get("object_id")) or None
        item["object_name"] = _normalize_text(task_object.get("name")) if task_object else ""
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
        return item

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
        published_from = self._parse_iso_datetime(announcement.get("published_from"))
        expires_at = self._parse_iso_datetime(announcement.get("expires_at"))
        now_utc = datetime.now(timezone.utc)
        if self._as_int(announcement.get("is_active"), 1) != 1:
            return False
        if published_from and published_from > now_utc:
            return False
        if expires_at and expires_at <= now_utc:
            return False
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

    def _build_announcement_item(
        self,
        conn: sqlite3.Connection,
        announcement_row: sqlite3.Row | dict[str, Any],
        *,
        viewer_user_id: int,
        is_admin: bool = False,
        include_body: bool = True,
        include_hidden_for_manager: bool = False,
    ) -> Optional[dict[str, Any]]:
        item = dict(announcement_row)
        normalized_viewer_id = self._as_int(viewer_user_id)
        can_manage = bool(is_admin or normalized_viewer_id == self._as_int(item.get("author_user_id")))
        if not self._announcement_is_visible_to_user(item, user_id=normalized_viewer_id, is_admin=bool(is_admin)):
            if not (include_hidden_for_manager and can_manage):
                return None
        current_version = max(1, self._as_int(item.get("version"), 1))
        read_row = conn.execute(
            f"""
            SELECT seen_version, acknowledged_version, acknowledged_at, read_at
            FROM {self._ANN_READS_TABLE}
            WHERE announcement_id = ? AND user_id = ?
            """,
            (_normalize_text(item.get("id")), normalized_viewer_id),
        ).fetchone()
        seen_version = current_version if normalized_viewer_id == self._as_int(item.get("author_user_id")) else self._as_int(read_row["seen_version"] if read_row else 0)
        acknowledged_version = current_version if normalized_viewer_id == self._as_int(item.get("author_user_id")) else self._as_int(read_row["acknowledged_version"] if read_row else 0)
        requires_ack = bool(self._as_int(item.get("requires_ack")))
        is_unread = seen_version < current_version
        is_updated = seen_version > 0 and seen_version < current_version
        is_ack_pending = requires_ack and acknowledged_version < current_version and normalized_viewer_id != self._as_int(item.get("author_user_id"))
        attachments = self._list_announcement_attachments(conn, _normalize_text(item.get("id")))
        pinned_until = self._parse_iso_datetime(item.get("pinned_until"))
        now_utc = datetime.now(timezone.utc)
        item["audience_scope"] = _normalize_text(item.get("audience_scope"), "all").lower()
        item["audience_roles"] = self._unique_texts(self._json_load_list(item.get("audience_roles")))
        item["audience_user_ids"] = self._unique_ints(self._json_load_list(item.get("audience_user_ids")))
        item["requires_ack"] = requires_ack
        item["is_pinned"] = bool(self._as_int(item.get("is_pinned")))
        item["is_active"] = bool(self._as_int(item.get("is_active"), 1))
        item["is_pinned_active"] = bool(item["is_pinned"] and (pinned_until is None or pinned_until > now_utc))
        item["version"] = current_version
        item["seen_version"] = seen_version
        item["acknowledged_version"] = acknowledged_version
        item["acknowledged_at"] = _normalize_text(read_row["acknowledged_at"] if read_row else "")
        item["is_unread"] = is_unread
        item["is_updated"] = is_updated
        item["is_ack_pending"] = is_ack_pending
        item["attachments_count"] = len(attachments)
        item["recipients_summary"] = self._announcement_recipients_summary(item)
        item["is_targeted_to_viewer"] = item["audience_scope"] != "all" and not can_manage
        item["can_manage"] = can_manage
        if include_body:
            item["attachments"] = attachments
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
            SELECT id, announcement_id, file_name, file_mime, file_size, uploaded_by_user_id, uploaded_by_username, uploaded_at
            FROM {self._ANN_ATTACH_TABLE}
            WHERE announcement_id = ?
            ORDER BY uploaded_at DESC
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
        normalized_entity_type = _normalize_text(entity_type).lower()
        if int(recipient_user_id or 0) > 0 and normalized_entity_type != "chat":
            channel = "tasks" if normalized_entity_type == "task" else ("announcements" if normalized_entity_type == "announcement" else "system")
            if notification_preferences_service.is_enabled(user_id=int(recipient_user_id), channel=channel):
                route = "/"
                if channel == "tasks":
                    route = "/tasks"
                elif channel == "announcements":
                    route = "/dashboard"
                try:
                    app_push_service.send_notification(
                        recipient_user_id=int(recipient_user_id),
                        title=_normalize_text(title) or "Новое уведомление",
                        body=_normalize_text(body) or _normalize_text(title) or "Откройте приложение, чтобы посмотреть подробности.",
                        channel=channel,
                        route=route,
                        tag=f"hub:{notification_id}",
                        data={
                            "notification_id": notification_id,
                            "entity_type": normalized_entity_type,
                            "entity_id": _normalize_text(entity_id),
                        },
                        ttl=120,
                    )
                except Exception:
                    pass
        return notification_id

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

    def list_assignees(self) -> list[dict[str, Any]]:
        users = user_service.list_users()
        out: list[dict[str, Any]] = []
        for row in users:
            if not bool(row.get("is_active", True)):
                continue
            out.append(
                {
                    "id": self._as_int(row.get("id")),
                    "username": _normalize_text(row.get("username")),
                    "full_name": _normalize_text(row.get("full_name")) or _normalize_text(row.get("username")),
                    "role": _normalize_text(row.get("role"), "viewer"),
                }
            )
        out.sort(key=lambda item: (item.get("full_name") or "", item.get("username") or ""))
        return out

    def list_controllers(self) -> list[dict[str, Any]]:
        users = user_service.list_users()
        out: list[dict[str, Any]] = []
        for row in users:
            if not self._user_can_review_tasks(row):
                continue
            out.append(
                {
                    "id": self._as_int(row.get("id")),
                    "username": _normalize_text(row.get("username")),
                    "full_name": _normalize_text(row.get("full_name")) or _normalize_text(row.get("username")),
                    "role": _normalize_text(row.get("role"), "viewer"),
                }
            )
        out.sort(key=lambda item: (item.get("full_name") or "", item.get("username") or ""))
        return out

    def list_announcement_recipients(self) -> dict[str, Any]:
        users = self.list_assignees()
        roles: list[dict[str, str]] = []
        seen_roles: set[str] = set()
        for row in self._active_users():
            role_value = _normalize_text(row.get("role")).lower()
            if not role_value or role_value in seen_roles:
                continue
            seen_roles.add(role_value)
            roles.append({"value": role_value, "label": role_value.title()})
        roles.sort(key=lambda item: item["label"])
        return {"users": users, "roles": roles}

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
        }
        if normalized["priority"] not in {"low", "normal", "high"}:
            normalized["priority"] = "normal"
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
    ) -> None:
        for recipient in self._announcement_recipient_users(announcement):
            recipient_user_id = self._as_int(recipient.get("id"))
            if recipient_user_id <= 0 or recipient_user_id == self._as_int(actor_user_id):
                continue
            self._create_notification(
                recipient_user_id=recipient_user_id,
                event_type=event_type,
                title=title,
                body=body,
                entity_type="announcement",
                entity_id=_normalize_text(announcement.get("id")),
                conn=conn,
            )

    def create_announcement(
        self,
        *,
        payload: dict[str, Any],
        actor: dict[str, Any],
        attachments: Optional[list[dict[str, Any]]] = None,
    ) -> dict[str, Any]:
        normalized = self._normalize_announcement_payload(payload)
        now_iso = _utc_now_iso()
        ann_id = str(uuid.uuid4())
        title_text = normalized["title"]
        if len(title_text) < 3:
            raise ValueError("Announcement title must contain at least 3 characters")
        attachment_payloads = attachments if isinstance(attachments, list) else []

        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                INSERT INTO {self._ANN_TABLE}
                (id, title, preview, body, priority, is_active, author_user_id, author_username, author_full_name,
                 published_at, updated_at, version, audience_scope, audience_roles, audience_user_ids,
                 requires_ack, is_pinned, pinned_until, published_from, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
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
                ),
            )
            for payload in attachment_payloads:
                file_bytes = payload.get("file_bytes")
                if not isinstance(file_bytes, (bytes, bytearray)) or len(file_bytes) == 0:
                    continue
                attachment_id = str(uuid.uuid4())
                safe_name, rel_path, file_size = self._store_attachment_file(
                    root=self.announcement_attachments_root,
                    parent_id=ann_id,
                    attachment_id=attachment_id,
                    file_name=_normalize_text(payload.get("file_name"), "file.bin"),
                    file_bytes=bytes(file_bytes),
                )
                conn.execute(
                    f"""
                    INSERT INTO {self._ANN_ATTACH_TABLE}
                    (id, announcement_id, file_name, file_path, file_mime, file_size, uploaded_by_user_id, uploaded_by_username, uploaded_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        attachment_id,
                        ann_id,
                        safe_name,
                        rel_path,
                        _normalize_text(payload.get("file_mime")),
                        file_size,
                        self._as_int(actor.get("id")),
                        _normalize_text(actor.get("username")),
                        now_iso,
                    ),
                )
            self._upsert_announcement_read_state(
                conn,
                announcement_id=ann_id,
                user=actor,
                seen_version=1,
                acknowledged_version=1 if normalized["requires_ack"] else 0,
                acknowledged_at=now_iso if normalized["requires_ack"] else None,
            )
            created_row = conn.execute(f"SELECT * FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            created_item = dict(created_row) if created_row else {"id": ann_id}
            self._create_announcement_notifications(
                conn,
                announcement=created_item,
                event_type="announcement.new",
                title="Новая заметка",
                body=self._preview_text(title_text),
                actor_user_id=self._as_int(actor.get("id")),
            )
            conn.commit()
            if created_row is None:
                return {}
            item = self._build_announcement_item(
                conn,
                created_row,
                viewer_user_id=self._as_int(actor.get("id")),
                include_hidden_for_manager=True,
            )
            return item or {}

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
        with self._lock, self._connect() as conn:
            current_row = conn.execute(
                f"SELECT * FROM {self._ANN_TABLE} WHERE id = ?",
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
            ):
                if key not in payload:
                    continue
                if key == "audience_roles":
                    updates.append("audience_roles = ?")
                    params.append(self._serialize_json_list(normalized["audience_roles"]))
                elif key == "audience_user_ids":
                    updates.append("audience_user_ids = ?")
                    params.append(self._serialize_json_list(normalized["audience_user_ids"]))
                elif key in {"requires_ack", "is_pinned", "is_active"}:
                    updates.append(f"{key} = ?")
                    params.append(1 if normalized[key] else 0)
                else:
                    updates.append(f"{key} = ?")
                    params.append(normalized[key])
            if not updates:
                return self._build_announcement_item(
                    conn,
                    current_row,
                    viewer_user_id=actor_id,
                    is_admin=is_admin,
                    include_hidden_for_manager=True,
                )
            updates.extend(["updated_at = ?", "version = version + 1"])
            params.append(now_iso)
            params.append(ann_id)
            conn.execute(f"UPDATE {self._ANN_TABLE} SET {', '.join(updates)} WHERE id = ?", tuple(params))
            updated_row = conn.execute(f"SELECT * FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            updated_item = dict(updated_row) if updated_row else current_item
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
            if bool(self._as_int(updated_item.get("is_active"), 1)):
                self._create_announcement_notifications(
                    conn,
                    announcement=updated_item,
                    event_type="announcement.updated",
                    title="Заметка обновлена",
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
            row = conn.execute(f"SELECT * FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
            if row is None:
                return None
            item = self._build_announcement_item(
                conn,
                row,
                viewer_user_id=self._as_int(user_id),
                is_admin=is_admin,
                include_hidden_for_manager=True,
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
                f"SELECT id FROM {self._NOTIF_TABLE} WHERE entity_type = 'announcement' AND entity_id = ?",
                (ann_id,),
            ).fetchall()
            notif_id_values = [_normalize_text(item["id"]) for item in notif_ids if _normalize_text(item["id"])]
            if notif_id_values:
                placeholders = ", ".join(["?"] * len(notif_id_values))
                conn.execute(
                    f"DELETE FROM {self._NOTIF_READS_TABLE} WHERE notification_id IN ({placeholders})",
                    tuple(notif_id_values),
                )
            conn.execute(
                f"DELETE FROM {self._NOTIF_TABLE} WHERE entity_type = 'announcement' AND entity_id = ?",
                (ann_id,),
            )
            conn.execute(f"DELETE FROM {self._ANN_READS_TABLE} WHERE announcement_id = ?", (ann_id,))
            conn.execute(f"DELETE FROM {self._ANN_ATTACH_TABLE} WHERE announcement_id = ?", (ann_id,))
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
        sort_by: str = "published_at",
        sort_dir: str = "desc",
    ) -> dict[str, Any]:
        safe_limit = self._coerce_limit(limit, default=30, minimum=1, maximum=300)
        safe_offset = max(0, self._as_int(offset, 0))
        query_text = _normalize_text(q).lower()
        query_terms = [term for term in query_text.split() if term]
        priority_value = _normalize_text(priority).lower()
        normalized_sort_by = _normalize_text(sort_by, "published_at").lower()
        normalized_sort_dir = "asc" if _normalize_text(sort_dir).lower() == "asc" else "desc"
        with self._lock, self._connect() as conn:
            rows = conn.execute(f"SELECT * FROM {self._ANN_TABLE}").fetchall()
            now_utc = datetime.now(timezone.utc)
            items: list[dict[str, Any]] = []
            unread_total = 0
            ack_pending_total = 0
            for row in rows:
                item = self._build_announcement_item(conn, row, viewer_user_id=int(user_id), include_body=False)
                if item is None:
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
                "sort_by": normalized_sort_by,
                "sort_dir": normalized_sort_dir,
            },
        }

    def mark_announcement_read(self, *, announcement_id: str, user: dict[str, Any]) -> bool:
        ann_id = _normalize_text(announcement_id)
        if not ann_id:
            return False
        with self._lock, self._connect() as conn:
            ann = conn.execute(
                f"SELECT * FROM {self._ANN_TABLE} WHERE id = ?",
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
            ann = conn.execute(f"SELECT * FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
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
            announcement_row = conn.execute(f"SELECT * FROM {self._ANN_TABLE} WHERE id = ?", (ann_id,)).fetchone()
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
            is_assignee = self._as_int(task.get("assignee_user_id")) == user_id
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
            return self._attachment_row_to_dict(created_row) if created_row else None

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
        project_id: Optional[str] = None,
        object_id: Optional[str] = None,
        protocol_date: Optional[str] = None,
        priority: Optional[str] = "normal",
        actor: dict[str, Any],
        initial_status: str = "new",
    ) -> dict[str, Any]:
        title_text = _normalize_text(title)
        if len(title_text) < 3:
            raise ValueError("Task title must contain at least 3 characters")
        assignee = user_service.get_by_id(int(assignee_user_id))
        if not assignee or not bool(assignee.get("is_active", True)):
            raise ValueError("Assignee user is not available")
        controller = user_service.get_by_id(int(controller_user_id))
        if not controller or not bool(controller.get("is_active", True)):
            raise ValueError("Controller user is not available")
        if not self._user_can_review_tasks(controller):
            raise ValueError("Controller must have tasks.review permission")

        now_iso = _utc_now_iso()
        task_id = str(uuid.uuid4())
        priority_text = _normalize_text(priority, "normal").lower()
        if priority_text not in {"low", "normal", "high", "urgent"}:
            priority_text = "normal"
        initial_status_text = _normalize_text(initial_status, "new").lower()
        if initial_status_text not in self._TASK_STATUSES:
            raise ValueError("Unsupported initial task status")
        with self._lock, self._connect() as conn:
            self._ensure_task_status_log_table(conn)
            validated_project_id, validated_object_id = self._validate_task_project_object(
                conn,
                project_id=project_id,
                object_id=object_id,
            )
            if not validated_project_id:
                raise ValueError("project_id is required")
            normalized_protocol_date = self._normalize_protocol_date(protocol_date) or self._normalize_protocol_date(now_iso)
            conn.execute(
                f"""
                INSERT INTO {self._TASKS_TABLE}
                (id, title, description, status, due_at, priority, project_id, object_id, protocol_date, completed_at, completed_at_source,
                 assignee_user_id, assignee_username, assignee_full_name,
                 controller_user_id, controller_username, controller_full_name,
                 created_by_user_id, created_by_username, created_by_full_name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    title_text,
                    _normalize_text(description),
                    initial_status_text,
                    _normalize_text(due_at) or None,
                    priority_text,
                    validated_project_id,
                    validated_object_id,
                    normalized_protocol_date,
                    now_iso if initial_status_text == "done" else None,
                    "explicit" if initial_status_text == "done" else None,
                    self._as_int(assignee.get("id")),
                    _normalize_text(assignee.get("username")),
                    _normalize_text(assignee.get("full_name")) or _normalize_text(assignee.get("username")),
                    self._as_int(controller.get("id")),
                    _normalize_text(controller.get("username")),
                    _normalize_text(controller.get("full_name")) or _normalize_text(controller.get("username")),
                    self._as_int(actor.get("id")),
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
                user_id=self._as_int(actor.get("id")),
                username=_normalize_text(actor.get("username")),
            )
            assignee_id = self._as_int(assignee.get("id"))
            controller_id = self._as_int(controller.get("id"))
            actor_id = self._as_int(actor.get("id"))
            assignee_recipients = {assignee_id, *self._task_delegate_user_ids(assignee_id)}
            self._create_task_notifications(
                conn,
                recipient_user_ids=assignee_recipients,
                skip_user_ids={actor_id},
                event_type="task.assigned",
                title="Новая задача",
                body=title_text,
                task_id=task_id,
            )
            self._create_task_notifications(
                conn,
                recipient_user_ids={controller_id},
                skip_user_ids={actor_id, assignee_id},
                event_type="task.controller_assigned",
                title="Вы назначены контролером задачи",
                body=title_text,
                task_id=task_id,
            )
            conn.commit()
            row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (task_id,)).fetchone()
            return self._task_with_latest_report(conn, row, viewer_user_id=self._as_int(actor.get("id"))) if row else {}

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
            if not is_admin and self._as_int(task.get("created_by_user_id")) != actor_id:
                raise PermissionError("Only task creator or admin can edit task")
            updates: list[str] = []
            params: list[Any] = []
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
            for key in ("title", "description", "due_at", "priority", "assignee_user_id", "controller_user_id", "protocol_date"):
                if key not in payload:
                    continue
                if key == "assignee_user_id":
                    assignee = user_service.get_by_id(int(payload.get(key)))
                    if not assignee or not bool(assignee.get("is_active", True)):
                        raise ValueError("Assignee user is not available")
                    updates.extend(["assignee_user_id = ?", "assignee_username = ?", "assignee_full_name = ?"])
                    params.extend(
                        [
                            self._as_int(assignee.get("id")),
                            _normalize_text(assignee.get("username")),
                            _normalize_text(assignee.get("full_name")) or _normalize_text(assignee.get("username")),
                        ]
                    )
                elif key == "controller_user_id":
                    controller = user_service.get_by_id(int(payload.get(key)))
                    if not controller or not bool(controller.get("is_active", True)):
                        raise ValueError("Controller user is not available")
                    if not self._user_can_review_tasks(controller):
                        raise ValueError("Controller must have tasks.review permission")
                    updates.extend(["controller_user_id = ?", "controller_username = ?", "controller_full_name = ?"])
                    params.extend(
                        [
                            self._as_int(controller.get("id")),
                            _normalize_text(controller.get("username")),
                            _normalize_text(controller.get("full_name")) or _normalize_text(controller.get("username")),
                        ]
                    )
                elif key == "due_at":
                    updates.append("due_at = ?")
                    params.append(_normalize_text(payload.get(key)) or None)
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
            previous_assignee_id = self._as_int(task.get("assignee_user_id"))
            previous_controller_id = self._as_int(task.get("controller_user_id"))
            previous_due_at = _normalize_text(task.get("due_at")) or None
            conn.execute(f"UPDATE {self._TASKS_TABLE} SET {', '.join(updates)} WHERE id = ?", tuple(params))
            row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            if row is None:
                return None
            updated = dict(row)
            next_assignee_id = self._as_int(updated.get("assignee_user_id"))
            next_controller_id = self._as_int(updated.get("controller_user_id"))
            title_text = _normalize_text(updated.get("title"))
            if next_assignee_id > 0 and next_assignee_id != previous_assignee_id:
                self._create_task_notifications(
                    conn,
                    recipient_user_ids={next_assignee_id, *self._task_delegate_user_ids(next_assignee_id)},
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
                    skip_user_ids={actor_id, next_assignee_id},
                    event_type="task.controller_assigned",
                    title="Вы назначены контролером задачи",
                    body=title_text,
                    task_id=normalized_id,
                )
            next_due_at = _normalize_text(updated.get("due_at")) or None
            if next_due_at != previous_due_at and next_assignee_id > 0:
                self._create_task_notifications(
                    conn,
                    recipient_user_ids={next_assignee_id, *self._task_delegate_user_ids(next_assignee_id)},
                    skip_user_ids={actor_id},
                    event_type="task.deadline_changed",
                    title="Изменен срок задачи",
                    body=title_text,
                    task_id=normalized_id,
                )
            conn.commit()
            return self._task_with_latest_report(conn, row, viewer_user_id=actor_id)

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
        with self._lock, self._connect() as conn:
            task = self._task_access_or_raise(conn, task_id=normalized_id, user_id=int(user_id), is_admin=is_admin)
            row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            return self._task_with_latest_report(conn, row, viewer_user_id=int(user_id)) if row else task

    def delete_task(self, *, task_id: str, actor_user_id: int, is_admin: bool = False) -> bool:
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return False
        actor_id = self._as_int(actor_user_id)
        file_paths: list[str] = []
        with self._lock, self._connect() as conn:
            row = conn.execute(
                f"SELECT id, created_by_user_id FROM {self._TASKS_TABLE} WHERE id = ?",
                (normalized_id,),
            ).fetchone()
            if row is None:
                return False
            if not is_admin and self._as_int(row["created_by_user_id"]) != actor_id:
                raise PermissionError("Only task creator or admin can delete it")

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
            conn.execute(f"DELETE FROM {self._TASK_ATTACH_TABLE} WHERE task_id = ?", (normalized_id,))
            conn.execute(f"DELETE FROM {self._TASK_REPORTS_TABLE} WHERE task_id = ?", (normalized_id,))
            conn.execute(f"DELETE FROM {self._TASK_COMMENTS_TABLE} WHERE task_id = ?", (normalized_id,))
            conn.execute(f"DELETE FROM {self._TASK_COMMENT_READS_TABLE} WHERE task_id = ?", (normalized_id,))
            conn.execute(f"DELETE FROM {self._TASK_STATUS_LOG_TABLE} WHERE task_id = ?", (normalized_id,))
            conn.execute(f"DELETE FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,))
            conn.commit()

        self._remove_relative_files(file_paths)
        self._remove_dir_quiet(self.task_attachments_root / normalized_id)
        return True

    def get_task_analytics(
        self,
        *,
        start_date: str | None = None,
        end_date: str | None = None,
        date_basis: str = "protocol_date",
        project_ids: Optional[list[str]] = None,
        object_ids: Optional[list[str]] = None,
        participant_user_ids: Optional[list[int]] = None,
    ) -> dict[str, Any]:
        def _basis_date(item: dict[str, Any]) -> str | None:
            basis_value = item.get(basis)
            if basis == "protocol_date":
                return self._normalize_protocol_date(basis_value)
            basis_dt = self._parse_iso_datetime(basis_value)
            return basis_dt.date().isoformat() if basis_dt else None

        def _row_bucket_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
            metrics = {
                "total": len(rows),
                "new": 0,
                "in_progress": 0,
                "review": 0,
                "done": 0,
                "open": 0,
                "done_on_time": 0,
                "done_without_due": 0,
                "overdue": 0,
                "with_due_total": 0,
            }
            for item in rows:
                status_key = _normalize_text(item.get("status")).lower()
                if status_key in {"new", "in_progress", "review", "done"}:
                    metrics[status_key] += 1
                if status_key in {"new", "in_progress", "review"}:
                    metrics["open"] += 1
                if bool(item.get("completed_on_time")):
                    metrics["done_on_time"] += 1
                if bool(item.get("done_without_due")):
                    metrics["done_without_due"] += 1
                if bool(item.get("is_overdue")):
                    metrics["overdue"] += 1
                if self._parse_iso_datetime(item.get("due_at")) is not None:
                    metrics["with_due_total"] += 1
            total = metrics["total"]
            with_due_total = metrics["with_due_total"]
            metrics["completion_percent"] = round((metrics["done"] / total) * 100, 2) if total else 0.0
            metrics["completion_on_time_percent"] = round((metrics["done_on_time"] / with_due_total) * 100, 2) if with_due_total else 0.0
            return metrics

        def _group_rows(
            rows: list[dict[str, Any]],
            *,
            key_fn,
            label_fn,
            id_field: str,
            label_field: str,
        ) -> list[dict[str, Any]]:
            grouped: dict[str, list[dict[str, Any]]] = {}
            labels: dict[str, str] = {}
            raw_ids: dict[str, Any] = {}
            for row in rows:
                raw_key = key_fn(row)
                group_key = str(raw_key)
                grouped.setdefault(group_key, []).append(row)
                labels[group_key] = label_fn(row)
                raw_ids[group_key] = raw_key
            items: list[dict[str, Any]] = []
            for group_key, group_rows in grouped.items():
                metrics = _row_bucket_metrics(group_rows)
                items.append(
                    {
                        id_field: raw_ids[group_key],
                        label_field: labels[group_key],
                        **metrics,
                    }
                )
            items.sort(key=lambda row: (-int(row.get("total", 0)), str(row.get(label_field) or "")))
            return items

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

        def _trend_payload(rows: list[dict[str, Any]]) -> dict[str, Any]:
            range_candidates: list[date] = []
            if start_iso:
                range_candidates.append(date.fromisoformat(start_iso))
            if end_iso:
                range_candidates.append(date.fromisoformat(end_iso))
            for item in rows:
                protocol_basis = self._normalize_protocol_date(item.get("protocol_date")) or self._normalize_protocol_date(item.get("created_at"))
                if protocol_basis:
                    range_candidates.append(date.fromisoformat(protocol_basis))
                completed_dt = self._parse_iso_datetime(item.get("completed_at"))
                if completed_dt is not None:
                    range_candidates.append(completed_dt.date())
                basis_date = _basis_date(item)
                if basis_date:
                    range_candidates.append(date.fromisoformat(basis_date))

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

            for item in rows:
                protocol_basis = self._normalize_protocol_date(item.get("protocol_date")) or self._normalize_protocol_date(item.get("created_at"))
                if protocol_basis:
                    _ensure_bucket(date.fromisoformat(protocol_basis))["created"] += 1
                completed_dt = self._parse_iso_datetime(item.get("completed_at"))
                if completed_dt is not None:
                    bucket = _ensure_bucket(completed_dt.date())
                    bucket["completed"] += 1
                    if bool(item.get("completed_on_time")):
                        bucket["completed_on_time"] += 1

            cursor = _bucket_start(range_start, granularity)
            end_bucket = _bucket_start(range_end, granularity)
            ordered_items: list[dict[str, Any]] = []
            while cursor <= end_bucket:
                ordered_items.append(_ensure_bucket(cursor))
                cursor = _next_bucket_start(cursor, granularity)

            ordered_items.sort(key=lambda item: item["bucket_key"])
            return {"granularity": granularity, "items": ordered_items}

        basis = _normalize_text(date_basis, "protocol_date").lower()
        if basis not in {"protocol_date", "completed_at", "due_at"}:
            basis = "protocol_date"
        start_iso = self._normalize_protocol_date(start_date)
        end_iso = self._normalize_protocol_date(end_date)
        normalized_project_ids = {_normalize_text(item) for item in (project_ids or []) if _normalize_text(item)}
        normalized_object_ids = {_normalize_text(item) for item in (object_ids or []) if _normalize_text(item)}
        normalized_participants = {self._as_int(item) for item in (participant_user_ids or []) if self._as_int(item) > 0}

        with self._lock, self._connect() as conn:
            task_rows = conn.execute(f"SELECT * FROM {self._TASKS_TABLE}").fetchall()
            task_items = [self._task_with_latest_report(conn, row) for row in task_rows]

        filtered_items: list[dict[str, Any]] = []
        for item in task_items:
            participant_id = self._as_int(item.get("assignee_user_id"))
            if normalized_project_ids and (_normalize_text(item.get("project_id")) or None) not in normalized_project_ids:
                continue
            if normalized_object_ids and (_normalize_text(item.get("object_id")) or None) not in normalized_object_ids:
                continue
            if normalized_participants and participant_id not in normalized_participants:
                continue

            basis_date = _basis_date(item)
            if start_iso and (not basis_date or basis_date < start_iso):
                continue
            if end_iso and (not basis_date or basis_date > end_iso):
                continue
            filtered_items.append(item)

        users_by_id = self._users_by_id()

        by_participant = _group_rows(
            filtered_items,
            key_fn=lambda row: self._as_int(row.get("assignee_user_id")) or 0,
            label_fn=lambda row: (
                _normalize_text(users_by_id.get(self._as_int(row.get("assignee_user_id")), {}).get("full_name"))
                or _normalize_text(row.get("assignee_full_name"))
                or _normalize_text(row.get("assignee_username"))
                or "Не назначен"
            ),
            id_field="participant_user_id",
            label_field="participant_name",
        )
        by_project = _group_rows(
            filtered_items,
            key_fn=lambda row: _normalize_text(row.get("project_id")) or None,
            label_fn=lambda row: _normalize_text(row.get("project_name")) or "Без проекта",
            id_field="project_id",
            label_field="project_name",
        )
        by_object = _group_rows(
            filtered_items,
            key_fn=lambda row: _normalize_text(row.get("object_id")) or None,
            label_fn=lambda row: _normalize_text(row.get("object_name")) or "Без объекта",
            id_field="object_id",
            label_field="object_name",
        )
        summary = _row_bucket_metrics(filtered_items)
        status_breakdown = [
            {"status": "new", "label": "Новые", "value": int(summary.get("new", 0))},
            {"status": "in_progress", "label": "В работе", "value": int(summary.get("in_progress", 0))},
            {"status": "review", "label": "На проверке", "value": int(summary.get("review", 0))},
            {"status": "done", "label": "Выполнено", "value": int(summary.get("done", 0))},
        ]

        return {
            "summary": summary,
            "by_participant": by_participant,
            "by_project": by_project,
            "by_object": by_object,
            "status_breakdown": status_breakdown,
            "trend": _trend_payload(filtered_items),
            "filters": {
                "start_date": start_iso,
                "end_date": end_iso,
                "date_basis": basis,
                "project_ids": sorted(normalized_project_ids),
                "object_ids": sorted(normalized_object_ids),
                "participant_user_ids": sorted(normalized_participants),
            },
        }

    def list_tasks(
        self,
        *,
        user_id: int,
        scope: str = "my",
        role_scope: str = "both",
        status_filter: str = "",
        q: str = "",
        assignee_user_id: Optional[int] = None,
        has_attachments: bool = False,
        due_state: str = "",
        sort_by: str = "status",
        sort_dir: str = "asc",
        limit: int = 100,
        offset: int = 0,
        allow_all_scope: bool = False,
    ) -> dict[str, Any]:
        safe_limit = self._coerce_limit(limit, default=100, minimum=1, maximum=500)
        safe_offset = max(0, self._as_int(offset, 0))
        now_iso = _utc_now_iso()
        normalized_scope = "all" if _normalize_text(scope).lower() == "all" and allow_all_scope else "my"
        normalized_role_scope = _normalize_text(role_scope).lower()
        if normalized_role_scope not in {"assignee", "creator", "controller", "both"}:
            normalized_role_scope = "both"
        normalized_query = _normalize_text(q).lower()
        normalized_due_state = _normalize_text(due_state).lower()
        normalized_sort_by = _normalize_text(sort_by, "status").lower()
        normalized_sort_dir = "desc" if _normalize_text(sort_dir).lower() == "desc" else "asc"
        where_clauses: list[str] = []
        params: list[Any] = []
        delegate_owner_ids = user_service.get_delegate_owner_ids(int(user_id))
        if normalized_scope == "my":
            if normalized_role_scope == "assignee":
                if delegate_owner_ids:
                    delegate_placeholders = ", ".join(["?"] * len(delegate_owner_ids))
                    where_clauses.append(f"(assignee_user_id = ? OR assignee_user_id IN ({delegate_placeholders}))")
                    params.extend([int(user_id), *delegate_owner_ids])
                else:
                    where_clauses.append("assignee_user_id = ?")
                    params.append(int(user_id))
            elif normalized_role_scope == "creator":
                where_clauses.append("created_by_user_id = ?")
                params.append(int(user_id))
            elif normalized_role_scope == "controller":
                where_clauses.append("controller_user_id = ?")
                params.append(int(user_id))
            else:
                if delegate_owner_ids:
                    delegate_placeholders = ", ".join(["?"] * len(delegate_owner_ids))
                    where_clauses.append(
                        f"(assignee_user_id = ? OR assignee_user_id IN ({delegate_placeholders}) OR created_by_user_id = ? OR controller_user_id = ?)"
                    )
                    params.extend([int(user_id), *delegate_owner_ids, int(user_id), int(user_id)])
                else:
                    where_clauses.append("(assignee_user_id = ? OR created_by_user_id = ? OR controller_user_id = ?)")
                    params.extend([int(user_id), int(user_id), int(user_id)])
        elif assignee_user_id is not None:
            where_clauses.append("assignee_user_id = ?")
            params.append(self._as_int(assignee_user_id))
        normalized_status = _normalize_text(status_filter).lower()
        if normalized_status:
            where_clauses.append("status = ?")
            params.append(normalized_status)
        if normalized_query:
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
            where_clauses.append("due_at IS NOT NULL AND due_at <> '' AND date(due_at) = date('now', 'localtime')")
        elif normalized_due_state == "upcoming":
            where_clauses.append("due_at IS NOT NULL AND due_at <> '' AND date(due_at) > date('now', 'localtime')")
        elif normalized_due_state == "none":
            where_clauses.append("(due_at IS NULL OR due_at = '')")
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

        with self._lock, self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT *
                FROM {self._TASKS_TABLE}
                {where_sql}
                ORDER BY
                  {sort_expr} {normalized_sort_dir},
                  {tie_breaker}
                LIMIT ? OFFSET ?
                """,
                tuple([*params, safe_limit, safe_offset]),
            ).fetchall()
            total = conn.execute(
                f"SELECT COUNT(*) AS c FROM {self._TASKS_TABLE}{where_sql}",
                tuple(params),
            ).fetchone()
            items = []
            for row in rows:
                item = self._task_with_latest_report(conn, row, viewer_user_id=int(user_id))
                items.append(item)

        return {
            "items": items,
            "total": self._as_int(total["c"] if total else 0),
            "limit": safe_limit,
            "offset": safe_offset,
            "scope": normalized_scope,
            "filters": {
                "role_scope": normalized_role_scope,
                "status": normalized_status,
                "q": normalized_query,
                "assignee_user_id": self._as_int(assignee_user_id) if assignee_user_id is not None else None,
                "has_attachments": bool(has_attachments),
                "due_state": normalized_due_state,
                "sort_by": normalized_sort_by,
                "sort_dir": normalized_sort_dir,
            },
        }

    def start_task(self, *, task_id: str, user: dict[str, Any]) -> Optional[dict[str, Any]]:
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return None
        user_id = self._as_int(user.get("id"))
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            if row is None:
                return None
            task = dict(row)
            if self._as_int(task.get("assignee_user_id")) != user_id:
                raise PermissionError("Only assignee can start the task")
            if _normalize_text(task.get("status")).lower() == "done":
                raise ValueError("Task is already completed")
            if _normalize_text(task.get("status")).lower() == "review":
                raise ValueError("Task is already waiting for review")
            old_status = _normalize_text(task.get("status"))
            conn.execute(
                f"""
                UPDATE {self._TASKS_TABLE}
                SET status = 'in_progress', completed_at = NULL, completed_at_source = NULL, updated_at = ?
                WHERE id = ?
                """,
                (now_iso, normalized_id),
            )
            self._ensure_task_status_log_table(conn)
            self._log_status_change(conn, task_id=normalized_id, old_status=old_status, new_status="in_progress", user_id=user_id, username=_normalize_text(user.get("username")))
            conn.commit()
            updated = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            return self._task_with_latest_report(conn, updated, viewer_user_id=user_id) if updated else None

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
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return None
        user_id = self._as_int(user.get("id"))
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            if row is None:
                return None
            task = dict(row)
            if self._as_int(task.get("assignee_user_id")) != user_id:
                raise PermissionError("Only assignee can submit the task")
            if _normalize_text(task.get("status")).lower() == "done":
                raise ValueError("Task is already completed")
            if _normalize_text(task.get("status")).lower() == "review":
                raise ValueError("Task is already waiting for review")

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
            conn.execute(
                f"""
                UPDATE {self._TASKS_TABLE}
                SET status = 'review', submitted_at = ?, completed_at = NULL, completed_at_source = NULL, updated_at = ?
                WHERE id = ?
                """,
                (now_iso, now_iso, normalized_id),
            )
            self._ensure_task_status_log_table(conn)
            self._log_status_change(
                conn,
                task_id=normalized_id,
                old_status=_normalize_text(task.get("status")),
                new_status="review",
                user_id=user_id,
                username=_normalize_text(user.get("username")),
            )
            title_text = _normalize_text(task.get("title"))
            creator_user_id = self._as_int(task.get("created_by_user_id"))
            controller_user_id = self._as_int(task.get("controller_user_id"))
            if creator_user_id > 0 and creator_user_id != user_id:
                self._create_notification(
                    recipient_user_id=creator_user_id,
                    event_type="task.submitted",
                    title="Задача отправлена на проверку",
                    body=title_text,
                    entity_type="task",
                    entity_id=normalized_id,
                    conn=conn,
                )
            if controller_user_id > 0 and controller_user_id not in {user_id, creator_user_id}:
                self._create_notification(
                    recipient_user_id=controller_user_id,
                    event_type="task.review_required",
                    title="Требуется проверка задачи",
                    body=title_text,
                    entity_type="task",
                    entity_id=normalized_id,
                    conn=conn,
                )
            conn.commit()
            updated = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            return self._task_with_latest_report(conn, updated, viewer_user_id=user_id) if updated else None

    def review_task(
        self,
        *,
        task_id: str,
        reviewer: dict[str, Any],
        decision: str,
        comment: str,
        is_admin: bool = False,
    ) -> Optional[dict[str, Any]]:
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return None
        decision_text = _normalize_text(decision).lower()
        if decision_text not in {"approve", "reject"}:
            raise ValueError("Review decision must be approve or reject")
        now_iso = _utc_now_iso()
        next_status = "done" if decision_text == "approve" else "in_progress"
        with self._lock, self._connect() as conn:
            row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            if row is None:
                return None
            task = dict(row)
            reviewer_id = self._as_int(reviewer.get("id"))
            creator_id = self._as_int(task.get("created_by_user_id"))
            controller_id = self._as_int(task.get("controller_user_id"))
            if not (is_admin or reviewer_id == creator_id or reviewer_id == controller_id):
                raise PermissionError("Only task creator, controller, or admin can review this task")
            if _normalize_text(task.get("status")).lower() != "review":
                raise ValueError("Task is not waiting for review")
            conn.execute(
                f"""
                UPDATE {self._TASKS_TABLE}
                SET status = ?, reviewed_at = ?, reviewer_user_id = ?, reviewer_username = ?, reviewer_full_name = ?, review_comment = ?, completed_at = ?, completed_at_source = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    next_status,
                    now_iso,
                    reviewer_id,
                    _normalize_text(reviewer.get("username")),
                    _normalize_text(reviewer.get("full_name")),
                    _normalize_text(comment),
                    now_iso if next_status == "done" else None,
                    "explicit" if next_status == "done" else None,
                    now_iso,
                    normalized_id,
                ),
            )
            self._ensure_task_status_log_table(conn)
            self._log_status_change(
                conn,
                task_id=normalized_id,
                old_status=_normalize_text(task.get("status")),
                new_status=next_status,
                user_id=reviewer_id,
                username=_normalize_text(reviewer.get("username")),
            )
            review_result = "Принято" if next_status == "done" else "Возвращено"
            title_text = _normalize_text(task.get("title"))
            assignee_id = self._as_int(task.get("assignee_user_id"))
            self._create_task_notifications(
                conn,
                recipient_user_ids={assignee_id, *self._task_delegate_user_ids(assignee_id)},
                skip_user_ids={reviewer_id},
                event_type="task.reviewed",
                title="Результат проверки задачи",
                body=f"{title_text}: {review_result}",
                task_id=normalized_id,
            )
            for recipient_user_id in {creator_id, controller_id}:
                if recipient_user_id <= 0 or recipient_user_id == reviewer_id or recipient_user_id == assignee_id:
                    continue
                self._create_task_notifications(
                    conn,
                    recipient_user_ids={recipient_user_id},
                    skip_user_ids={reviewer_id, assignee_id},
                    event_type="task.reviewed",
                    title="Задача проверена",
                    body=f"{title_text}: {review_result}",
                    task_id=normalized_id,
                )
            conn.commit()
            updated = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            return self._task_with_latest_report(conn, updated, viewer_user_id=reviewer_id) if updated else None

    def complete_task_direct(
        self,
        *,
        task_id: str,
        actor: dict[str, Any],
        comment: str = "",
    ) -> Optional[dict[str, Any]]:
        normalized_id = _normalize_text(task_id)
        if not normalized_id:
            return None
        actor_id = self._as_int(actor.get("id"))
        now_iso = _utc_now_iso()
        comment_text = _normalize_text(comment)
        with self._lock, self._connect() as conn:
            row = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            if row is None:
                return None
            task = dict(row)
            old_status = _normalize_text(task.get("status")).lower()
            if old_status == "done":
                return self._task_with_latest_report(conn, row, viewer_user_id=actor_id)

            conn.execute(
                f"""
                UPDATE {self._TASKS_TABLE}
                SET status = 'done', reviewed_at = ?, reviewer_user_id = ?, reviewer_username = ?, reviewer_full_name = ?, review_comment = ?, completed_at = ?, completed_at_source = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    now_iso,
                    actor_id if actor_id > 0 else None,
                    _normalize_text(actor.get("username")) or None,
                    _normalize_text(actor.get("full_name")) or _normalize_text(actor.get("username")) or None,
                    comment_text or None,
                    now_iso,
                    "explicit",
                    now_iso,
                    normalized_id,
                ),
            )
            self._ensure_task_status_log_table(conn)
            self._log_status_change(
                conn,
                task_id=normalized_id,
                old_status=old_status,
                new_status="done",
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
                title="Задача закрыта автоматически",
                body=title_text,
                task_id=normalized_id,
            )
            conn.commit()
            updated = conn.execute(f"SELECT * FROM {self._TASKS_TABLE} WHERE id = ?", (normalized_id,)).fetchone()
            return self._task_with_latest_report(conn, updated, viewer_user_id=actor_id) if updated else None

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
        normalized_events = [
            _normalize_text(item).lower()
            for item in (
                event_types
                or ["chat.message_received", "chat.task_shared", "chat.file_shared"]
            )
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
        return changed

    def _ensure_task_due_notifications_for_user(self, conn: sqlite3.Connection, *, user_id: int) -> None:
        normalized_user_id = self._as_int(user_id)
        if normalized_user_id <= 0:
            return
        delegate_owner_ids = user_service.get_delegate_owner_ids(normalized_user_id)
        assignee_filters = [normalized_user_id, *delegate_owner_ids]
        placeholders = ", ".join(["?"] * len(assignee_filters))
        rows = conn.execute(
            f"""
            SELECT *
            FROM {self._TASKS_TABLE}
            WHERE status <> 'done'
              AND due_at IS NOT NULL
              AND due_at <> ''
              AND assignee_user_id IN ({placeholders})
            """,
            tuple(assignee_filters),
        ).fetchall()
        now_utc = datetime.now(timezone.utc)
        today_iso = now_utc.date().isoformat()
        for row in rows:
            item = self._task_with_latest_report(conn, row, viewer_user_id=normalized_user_id)
            due_at = self._parse_iso_datetime(item.get("due_at"))
            if due_at is None:
                continue
            title_text = _normalize_text(item.get("title"))
            if due_at < now_utc:
                if self._notification_exists(
                    conn,
                    recipient_user_id=normalized_user_id,
                    event_type="task.overdue_reminder",
                    entity_type="task",
                    entity_id=_normalize_text(item.get("id")),
                    created_on_date=today_iso,
                ):
                    continue
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
            if self._notification_exists(
                conn,
                recipient_user_id=normalized_user_id,
                event_type="task.deadline_soon",
                entity_type="task",
                entity_id=_normalize_text(item.get("id")),
            ):
                continue
            self._create_notification(
                recipient_user_id=normalized_user_id,
                event_type="task.deadline_soon",
                title="Срок задачи приближается",
                body=title_text,
                entity_type="task",
                entity_id=_normalize_text(item.get("id")),
                conn=conn,
            )

    def get_unread_counts(self, *, user_id: int) -> dict[str, int]:
        with self._lock, self._connect() as conn:
            self._ensure_task_due_notifications_for_user(conn, user_id=int(user_id))
            unread_notifications = conn.execute(
                f"""
                SELECT COUNT(*) AS c
                FROM {self._NOTIF_TABLE} n
                LEFT JOIN {self._NOTIF_READS_TABLE} r
                  ON r.notification_id = n.id AND r.user_id = ?
                WHERE (n.recipient_user_id IS NULL OR n.recipient_user_id = ?) AND r.user_id IS NULL
                """,
                (int(user_id), int(user_id)),
            ).fetchone()
            announcement_rows = conn.execute(f"SELECT * FROM {self._ANN_TABLE}").fetchall()
            announcements_unread = 0
            announcements_ack_pending = 0
            for row in announcement_rows:
                item = self._build_announcement_item(conn, row, viewer_user_id=int(user_id), include_body=False)
                if item is None or not item.get("is_active"):
                    continue
                published_from = self._parse_iso_datetime(item.get("published_from"))
                expires_at = self._parse_iso_datetime(item.get("expires_at"))
                now_utc = datetime.now(timezone.utc)
                if published_from and published_from > now_utc:
                    continue
                if expires_at and expires_at <= now_utc:
                    continue
                announcements_unread += 1 if bool(item.get("is_unread")) else 0
                announcements_ack_pending += 1 if bool(item.get("is_ack_pending")) else 0

            task_rows = conn.execute(
                f"""
                SELECT *
                FROM {self._TASKS_TABLE}
                WHERE assignee_user_id = ? OR created_by_user_id = ? OR controller_user_id = ?
                """,
                (int(user_id), int(user_id), int(user_id)),
            ).fetchall()
            tasks_assignee_open = 0
            tasks_created_open = 0
            tasks_controller_open = 0
            tasks_review_required = 0
            tasks_overdue = 0
            tasks_with_unread_comments = 0
            tasks_open_ids: set[str] = set()
            for row in task_rows:
                item = self._task_with_latest_report(conn, row, viewer_user_id=int(user_id))
                status = _normalize_text(item.get("status")).lower()
                is_open = status in {"new", "in_progress", "review"}
                if is_open:
                    tasks_open_ids.add(_normalize_text(item.get("id")))
                if self._as_int(item.get("assignee_user_id")) == int(user_id) and is_open:
                    tasks_assignee_open += 1
                if self._as_int(item.get("created_by_user_id")) == int(user_id) and is_open:
                    tasks_created_open += 1
                if self._as_int(item.get("controller_user_id")) == int(user_id) and is_open:
                    tasks_controller_open += 1
                if status == "review" and int(user_id) in {self._as_int(item.get("created_by_user_id")), self._as_int(item.get("controller_user_id"))}:
                    tasks_review_required += 1
                if bool(item.get("is_overdue")):
                    tasks_overdue += 1
                if bool(item.get("has_unread_comments")):
                    tasks_with_unread_comments += 1
            new_tasks = conn.execute(
                f"""
                SELECT COUNT(*) AS c
                FROM {self._TASKS_TABLE}
                WHERE assignee_user_id = ? AND status = 'new'
                """,
                (int(user_id),),
            ).fetchone()
        return {
            "notifications_unread_total": self._as_int(unread_notifications["c"] if unread_notifications else 0),
            "announcements_unread": announcements_unread,
            "announcements_ack_pending": announcements_ack_pending,
            "tasks_open_total": len(tasks_open_ids),
            "tasks_open": len(tasks_open_ids),
            "tasks_new": self._as_int(new_tasks["c"] if new_tasks else 0),
            "tasks_assignee_open": tasks_assignee_open,
            "tasks_created_open": tasks_created_open,
            "tasks_controller_open": tasks_controller_open,
            "tasks_review_required": tasks_review_required,
            "tasks_overdue": tasks_overdue,
            "tasks_with_unread_comments": tasks_with_unread_comments,
        }

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
        params: list[Any] = [int(user_id), int(user_id)]
        extra_where = ""
        if since_text:
            extra_where = " AND n.created_at > ?"
            params.append(since_text)
        if unread_only:
            extra_where += " AND r.user_id IS NULL"
        with self._lock, self._connect() as conn:
            self._ensure_task_due_notifications_for_user(conn, user_id=int(user_id))
            rows = conn.execute(
                f"""
                SELECT n.*,
                       CASE WHEN r.user_id IS NULL THEN 1 ELSE 0 END AS unread
                FROM {self._NOTIF_TABLE} n
                LEFT JOIN {self._NOTIF_READS_TABLE} r
                  ON r.notification_id = n.id AND r.user_id = ?
                WHERE (n.recipient_user_id IS NULL OR n.recipient_user_id = ?){extra_where}
                ORDER BY n.created_at DESC
                LIMIT ?
                """,
                tuple([*params, safe_limit]),
            ).fetchall()
        counts = self.get_unread_counts(user_id=user_id)
        return {
            "items": [dict(row) for row in rows],
            "since": since_text or None,
            "limit": safe_limit,
            "unread_only": bool(unread_only),
            "unread_counts": counts,
            "generated_at": _utc_now_iso(),
        }

    def get_dashboard(self, *, user_id: int, announcements_limit: int = 20, tasks_limit: int = 10) -> dict[str, Any]:
        announcements = self.list_announcements(user_id=user_id, limit=announcements_limit, offset=0)
        tasks = self.list_tasks(
            user_id=user_id,
            scope="my",
            role_scope="both",
            status_filter="",
            limit=tasks_limit,
            offset=0,
            allow_all_scope=False,
        )
        unread_counts = self.get_unread_counts(user_id=user_id)
        return {
            "generated_at": _utc_now_iso(),
            "announcements": announcements,
            "my_tasks": tasks,
            "unread_counts": unread_counts,
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
            },
        }


hub_service = HubService()
