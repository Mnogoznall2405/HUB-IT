"""
Persistent reminders for uploading signed transfer acts.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any, Optional
from urllib.parse import urlencode

from backend.appdb.db import get_app_database_url, get_app_engine, initialize_app_schema, is_app_database_configured
from backend.appdb.sql_compat import SqlAlchemyCompatConnection
from backend.db_schema import schema_name
from local_store import get_local_store

from backend.services.app_settings_service import app_settings_service
from backend.services.hub_service import hub_service

logger = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _normalize_name(value: Any) -> str:
    return _normalize_text(value).lower()


def _normalize_inv_nos(values: Any) -> list[str]:
    result: list[str] = []
    for raw in values or []:
        token = _normalize_text(raw)
        if token and token not in result:
            result.append(token)
    return result


def _normalized_inv_signature(values: Any) -> tuple[str, ...]:
    return tuple(sorted(_normalize_inv_nos(values), key=lambda item: item.lower()))


class TransferActReminderService:
    _REMINDERS_TABLE = "equipment_transfer_act_reminders"
    _GROUPS_TABLE = "equipment_transfer_act_reminder_groups"

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
        self._lock = RLock()
        if self._use_app_db and self._database_url:
            initialize_app_schema(self._database_url)
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        if self._use_app_db and self._database_url:
            return SqlAlchemyCompatConnection(
                get_app_engine(self._database_url),
                table_names=self._reminder_table_names(),
                schema=self._app_schema,
            )
        conn = sqlite3.connect(str(self.db_path), timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _reminder_table_names(self) -> set[str]:
        return {
            self._REMINDERS_TABLE,
            self._GROUPS_TABLE,
        }

    def _ensure_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(
                f"""
                CREATE TABLE IF NOT EXISTS {self._REMINDERS_TABLE} (
                    reminder_id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    db_id TEXT NULL,
                    assignee_user_id INTEGER NOT NULL,
                    controller_user_id INTEGER NOT NULL,
                    created_by_user_id INTEGER NOT NULL,
                    new_employee_no TEXT NULL,
                    new_employee_name TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'open',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    completed_at TEXT NULL
                );
                CREATE TABLE IF NOT EXISTS {self._GROUPS_TABLE} (
                    id TEXT PRIMARY KEY,
                    reminder_id TEXT NOT NULL,
                    generated_act_id TEXT NULL,
                    old_employee_name TEXT NOT NULL DEFAULT '',
                    inv_nos_json TEXT NOT NULL DEFAULT '[]',
                    equipment_count INTEGER NOT NULL DEFAULT 0,
                    matched_doc_no INTEGER NULL,
                    matched_doc_number TEXT NULL,
                    completed_at TEXT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_{self._REMINDERS_TABLE}_task_id
                    ON {self._REMINDERS_TABLE}(task_id);
                CREATE INDEX IF NOT EXISTS idx_{self._REMINDERS_TABLE}_assignee_status
                    ON {self._REMINDERS_TABLE}(assignee_user_id, status, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._REMINDERS_TABLE}_db_status
                    ON {self._REMINDERS_TABLE}(db_id, status, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_{self._GROUPS_TABLE}_reminder
                    ON {self._GROUPS_TABLE}(reminder_id);
                """
            )
            conn.commit()

    @staticmethod
    def _json_dump(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False)

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
    def _actor_dict(user: Any) -> dict[str, Any]:
        return {
            "id": int(getattr(user, "id", 0) or 0),
            "username": _normalize_text(getattr(user, "username", "")),
            "full_name": _normalize_text(getattr(user, "full_name", "")) or _normalize_text(getattr(user, "username", "")),
            "role": _normalize_text(getattr(user, "role", "")),
        }

    @staticmethod
    def _serialize_group_row(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
        item = dict(row)
        inv_nos = _normalize_inv_nos(TransferActReminderService._json_load_list(item.get("inv_nos_json")))
        return {
            "id": _normalize_text(item.get("id")),
            "generated_act_id": _normalize_text(item.get("generated_act_id")) or None,
            "old_employee_name": _normalize_text(item.get("old_employee_name")),
            "inv_nos": inv_nos,
            "equipment_count": int(item.get("equipment_count") or len(inv_nos) or 0),
            "matched_doc_no": int(item.get("matched_doc_no")) if item.get("matched_doc_no") not in (None, "") else None,
            "matched_doc_number": _normalize_text(item.get("matched_doc_number")) or None,
            "completed_at": _normalize_text(item.get("completed_at")) or None,
        }

    def _build_upload_url(self, *, reminder_id: str, task_id: str, db_id: Optional[str]) -> str:
        params = {
            "upload_act": "1",
            "reminder_id": reminder_id,
            "source_task_id": task_id,
        }
        if _normalize_text(db_id):
            params["db_id"] = _normalize_text(db_id)
        return f"/database?{urlencode(params)}"

    def _build_task_description(
        self,
        *,
        new_employee_name: str,
        transferred_items: list[dict[str, Any]],
        groups: list[dict[str, Any]],
    ) -> str:
        total_items = len(transferred_items)
        lines = [
            "Нужно загрузить подписанный акт перемещения.",
            "",
            f"Новый сотрудник: {new_employee_name or '-'}",
            f"Перенесено карточек: {total_items}",
            f"Ожидается актов: {len(groups)}",
            "",
            "Ожидаемые акты по бывшим владельцам:",
        ]
        for group in groups:
            lines.append(
                f"- {group['old_employee_name'] or 'Без владельца'}: {int(group['equipment_count'])} шт. "
                f"(INV: {', '.join(group['inv_nos'])})"
            )
        lines.extend(
            [
                "",
                "Задача закроется автоматически после загрузки и записи всех подписанных актов.",
            ]
        )
        return "\n".join(lines)

    def create_transfer_reminder(
        self,
        *,
        db_id: Optional[str],
        transferred_items: list[dict[str, Any]],
        acts: list[dict[str, Any]],
        new_employee_no: Optional[Any],
        new_employee_name: str,
        actor_user: Any,
    ) -> dict[str, Any]:
        if not acts:
            return {
                "created": False,
                "warning": None,
                "task_id": None,
                "reminder_id": None,
                "controller_username": None,
                "controller_fallback_used": False,
            }

        actor = self._actor_dict(actor_user)
        assignee_user_id = int(actor.get("id") or 0)
        if assignee_user_id <= 0:
            return {
                "created": False,
                "warning": "Не удалось определить исполнителя reminder-задачи.",
                "task_id": None,
                "reminder_id": None,
                "controller_username": None,
                "controller_fallback_used": False,
            }

        controller_resolution = app_settings_service.resolve_transfer_act_reminder_controller()
        resolved_controller = controller_resolution.get("resolved_controller") or {}
        controller_user_id = int(resolved_controller.get("id") or 0)
        if controller_user_id <= 0:
            return {
                "created": False,
                "warning": controller_resolution.get("warning") or "Не найден контролер для reminder-задачи.",
                "task_id": None,
                "reminder_id": None,
                "controller_username": None,
                "controller_fallback_used": bool(controller_resolution.get("fallback_used")),
            }

        act_map = {
            _normalize_name(act.get("old_employee")): act
            for act in acts
        }
        grouped: dict[str, list[dict[str, Any]]] = {}
        for item in transferred_items:
            key = _normalize_name(item.get("old_employee_name") or "Без владельца")
            grouped.setdefault(key, []).append(item)

        reminder_groups: list[dict[str, Any]] = []
        for key, items in grouped.items():
            act = act_map.get(key)
            if not act:
                continue
            inv_nos = _normalize_inv_nos(item.get("inv_no") for item in items)
            reminder_groups.append(
                {
                    "generated_act_id": _normalize_text(act.get("act_id")) or None,
                    "old_employee_name": _normalize_text(act.get("old_employee")) or _normalize_text(items[0].get("old_employee_name")),
                    "inv_nos": inv_nos,
                    "equipment_count": len(inv_nos) or len(items),
                }
            )

        if not reminder_groups:
            return {
                "created": False,
                "warning": "Акты были сформированы, но не удалось построить напоминание по группам.",
                "task_id": None,
                "reminder_id": None,
                "controller_username": _normalize_text(resolved_controller.get("username")) or None,
                "controller_fallback_used": bool(controller_resolution.get("fallback_used")),
            }

        task_title = "Загрузить подписанный акт перемещения"
        task_description = self._build_task_description(
            new_employee_name=_normalize_text(new_employee_name),
            transferred_items=transferred_items,
            groups=reminder_groups,
        )

        warning = _normalize_text(controller_resolution.get("warning")) or None
        try:
            reminder_project = hub_service.ensure_transfer_act_reminder_task_project()
            task = hub_service.create_task(
                title=task_title,
                description=task_description,
                assignee_user_id=assignee_user_id,
                controller_user_id=controller_user_id,
                due_at=None,
                project_id=_normalize_text(reminder_project.get("id")) or None,
                priority="normal",
                actor=actor,
                initial_status="in_progress",
            )
        except Exception as exc:
            logger.exception("Failed to create hub reminder task for transfer acts")
            return {
                "created": False,
                "warning": f"Напоминание не создано: {exc}",
                "task_id": None,
                "reminder_id": None,
                "controller_username": _normalize_text(resolved_controller.get("username")) or None,
                "controller_fallback_used": bool(controller_resolution.get("fallback_used")),
            }

        reminder_id = str(uuid.uuid4())
        now_iso = _utc_now_iso()
        with self._lock, self._connect() as conn:
            conn.execute(
                f"""
                INSERT INTO {self._REMINDERS_TABLE}
                (reminder_id, task_id, db_id, assignee_user_id, controller_user_id, created_by_user_id,
                 new_employee_no, new_employee_name, status, created_at, updated_at, completed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL)
                """,
                (
                    reminder_id,
                    _normalize_text(task.get("id")),
                    _normalize_text(db_id) or None,
                    assignee_user_id,
                    controller_user_id,
                    assignee_user_id,
                    _normalize_text(new_employee_no) or None,
                    _normalize_text(new_employee_name),
                    now_iso,
                    now_iso,
                ),
            )
            for group in reminder_groups:
                conn.execute(
                    f"""
                    INSERT INTO {self._GROUPS_TABLE}
                    (id, reminder_id, generated_act_id, old_employee_name, inv_nos_json, equipment_count, matched_doc_no, matched_doc_number, completed_at)
                    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
                    """,
                    (
                        str(uuid.uuid4()),
                        reminder_id,
                        group.get("generated_act_id"),
                        group.get("old_employee_name"),
                        self._json_dump(group.get("inv_nos") or []),
                        int(group.get("equipment_count") or 0),
                    ),
                )
            conn.commit()

        return {
            "created": True,
            "warning": warning,
            "task_id": _normalize_text(task.get("id")) or None,
            "reminder_id": reminder_id,
            "controller_username": _normalize_text(resolved_controller.get("username")) or None,
            "controller_fallback_used": bool(controller_resolution.get("fallback_used")),
        }

    def _get_reminder_row(self, conn: sqlite3.Connection, *, reminder_id: Optional[str] = None, task_id: Optional[str] = None) -> Optional[sqlite3.Row]:
        normalized_reminder_id = _normalize_text(reminder_id)
        normalized_task_id = _normalize_text(task_id)
        if normalized_reminder_id:
            return conn.execute(
                f"SELECT * FROM {self._REMINDERS_TABLE} WHERE reminder_id = ?",
                (normalized_reminder_id,),
            ).fetchone()
        if normalized_task_id:
            return conn.execute(
                f"SELECT * FROM {self._REMINDERS_TABLE} WHERE task_id = ?",
                (normalized_task_id,),
            ).fetchone()
        return None

    def _list_group_rows(self, conn: sqlite3.Connection, reminder_id: str) -> list[sqlite3.Row]:
        return conn.execute(
            f"""
            SELECT *
            FROM {self._GROUPS_TABLE}
            WHERE reminder_id = ?
            ORDER BY COALESCE(completed_at, ''), old_employee_name, id
            """,
            (_normalize_text(reminder_id),),
        ).fetchall()

    def get_reminder(self, *, reminder_id: Optional[str] = None, task_id: Optional[str] = None) -> Optional[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            row = self._get_reminder_row(conn, reminder_id=reminder_id, task_id=task_id)
            if row is None:
                return None
            item = dict(row)
            groups = [self._serialize_group_row(group_row) for group_row in self._list_group_rows(conn, _normalize_text(item.get("reminder_id")))]
        pending_groups = [group for group in groups if not group.get("completed_at")]
        completed_groups = [group for group in groups if group.get("completed_at")]
        reminder_id_value = _normalize_text(item.get("reminder_id"))
        task_id_value = _normalize_text(item.get("task_id"))
        db_id = _normalize_text(item.get("db_id")) or None
        return {
            "reminder_id": reminder_id_value,
            "task_id": task_id_value,
            "db_id": db_id,
            "assignee_user_id": int(item.get("assignee_user_id") or 0),
            "controller_user_id": int(item.get("controller_user_id") or 0),
            "created_by_user_id": int(item.get("created_by_user_id") or 0),
            "new_employee_no": _normalize_text(item.get("new_employee_no")) or None,
            "new_employee_name": _normalize_text(item.get("new_employee_name")),
            "status": _normalize_text(item.get("status"), "open"),
            "created_at": _normalize_text(item.get("created_at")) or None,
            "updated_at": _normalize_text(item.get("updated_at")) or None,
            "completed_at": _normalize_text(item.get("completed_at")) or None,
            "pending_groups_total": len(pending_groups),
            "completed_groups_total": len(completed_groups),
            "pending_groups": pending_groups,
            "completed_groups": completed_groups,
            "upload_url": self._build_upload_url(reminder_id=reminder_id_value, task_id=task_id_value, db_id=db_id),
        }

    def enrich_task(self, task: dict[str, Any]) -> dict[str, Any]:
        item = dict(task or {})
        reminder = self.get_reminder(task_id=_normalize_text(item.get("id")))
        if not reminder:
            item["integration_kind"] = None
            item["integration_payload"] = None
            return item
        item["integration_kind"] = "transfer_act_upload"
        item["integration_payload"] = {
            "reminder_id": reminder["reminder_id"],
            "pending_groups_total": reminder["pending_groups_total"],
            "completed_groups_total": reminder["completed_groups_total"],
            "pending_groups": reminder["pending_groups"],
            "upload_url": reminder["upload_url"],
            "db_id": reminder["db_id"],
        }
        return item

    def enrich_tasks(self, tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [self.enrich_task(task) for task in (tasks or [])]

    def _find_matching_groups(
        self,
        *,
        conn: sqlite3.Connection,
        candidates: list[sqlite3.Row],
        from_employee: str,
        to_employee: str,
        linked_inv_nos: list[str],
    ) -> list[tuple[sqlite3.Row, sqlite3.Row]]:
        # Matching only by INV_NO signature — employee names are too fragile
        # (case sensitivity, typos, AI parsing errors).
        # INV_NO is unique and reliable. Candidates are already filtered by
        # status='open', assignee_user_id, and db_id at the caller level.
        matches: list[tuple[sqlite3.Row, sqlite3.Row]] = []
        inv_signature = _normalized_inv_signature(linked_inv_nos)
        for reminder_row in candidates:
            reminder = dict(reminder_row)
            for group_row in self._list_group_rows(conn, _normalize_text(reminder.get("reminder_id"))):
                group = self._serialize_group_row(group_row)
                if group.get("completed_at"):
                    continue
                if _normalized_inv_signature(group.get("inv_nos")) != inv_signature:
                    continue
                matches.append((reminder_row, group_row))
        return matches

    def complete_for_uploaded_act(
        self,
        *,
        reminder_id: Optional[str],
        source_task_id: Optional[str],
        db_id: Optional[str],
        current_user: Any,
        from_employee: str,
        to_employee: str,
        linked_inv_nos: list[str],
        doc_no: int,
        doc_number: str,
    ) -> dict[str, Any]:
        actor = self._actor_dict(current_user)
        user_id = int(actor.get("id") or 0)
        with self._lock, self._connect() as conn:
            candidates: list[sqlite3.Row] = []
            explicit_row = self._get_reminder_row(conn, reminder_id=reminder_id, task_id=source_task_id)
            if explicit_row is not None:
                candidates = [explicit_row]
            else:
                candidates = conn.execute(
                    f"""
                    SELECT *
                    FROM {self._REMINDERS_TABLE}
                    WHERE status = 'open'
                      AND assignee_user_id = ?
                      AND COALESCE(db_id, '') = COALESCE(?, '')
                    ORDER BY updated_at DESC
                    """,
                    (user_id, _normalize_text(db_id) or None),
                ).fetchall()

            if not candidates:
                return {
                    "reminder_status": "none",
                    "reminder_task_id": None,
                    "reminder_id": None,
                    "reminder_pending_groups": 0,
                    "warning": None,
                }

            matches = self._find_matching_groups(
                conn=conn,
                candidates=candidates,
                from_employee=from_employee,
                to_employee=to_employee,
                linked_inv_nos=linked_inv_nos,
            )
            if not matches:
                return {
                    "reminder_status": "none",
                    "reminder_task_id": _normalize_text(explicit_row["task_id"]) if explicit_row is not None else None,
                    "reminder_id": _normalize_text(explicit_row["reminder_id"]) if explicit_row is not None else None,
                    "reminder_pending_groups": 0,
                    "warning": "Не удалось автоматически сопоставить загруженный акт с reminder-задачей.",
                }
            if len(matches) > 1:
                first_reminder = dict(matches[0][0])
                return {
                    "reminder_status": "ambiguous",
                    "reminder_task_id": _normalize_text(first_reminder.get("task_id")) or None,
                    "reminder_id": _normalize_text(first_reminder.get("reminder_id")) or None,
                    "reminder_pending_groups": 0,
                    "warning": "Найдено несколько подходящих reminder-задач. Задача не закрыта автоматически.",
                }

            reminder_row, group_row = matches[0]
            reminder = dict(reminder_row)
            group = dict(group_row)
            now_iso = _utc_now_iso()
            conn.execute(
                f"""
                UPDATE {self._GROUPS_TABLE}
                SET matched_doc_no = ?, matched_doc_number = ?, completed_at = ?
                WHERE id = ?
                """,
                (int(doc_no), _normalize_text(doc_number), now_iso, _normalize_text(group.get("id"))),
            )
            conn.execute(
                f"UPDATE {self._REMINDERS_TABLE} SET updated_at = ? WHERE reminder_id = ?",
                (now_iso, _normalize_text(reminder.get("reminder_id"))),
            )

            refreshed_groups = [self._serialize_group_row(row) for row in self._list_group_rows(conn, _normalize_text(reminder.get("reminder_id")))]
            pending_groups_total = sum(1 for row in refreshed_groups if not row.get("completed_at"))
            status_value = "matched_partial"
            warning = None

            if pending_groups_total == 0:
                conn.execute(
                    f"""
                    UPDATE {self._REMINDERS_TABLE}
                    SET status = 'done', updated_at = ?, completed_at = ?
                    WHERE reminder_id = ?
                    """,
                    (now_iso, now_iso, _normalize_text(reminder.get("reminder_id"))),
                )
                status_value = "completed"
            conn.commit()

        if status_value == "completed":
            comment = "Подписанные акты загружены, задача закрыта автоматически."
            try:
                hub_service.complete_task_direct(
                    task_id=_normalize_text(reminder.get("task_id")),
                    actor=actor,
                    comment=comment,
                )
            except Exception as exc:
                logger.exception("Failed to auto-complete transfer act reminder task")
                warning = f"Reminder обновлен, но задачу не удалось закрыть автоматически: {exc}"

        return {
            "reminder_status": status_value,
            "reminder_task_id": _normalize_text(reminder.get("task_id")) or None,
            "reminder_id": _normalize_text(reminder.get("reminder_id")) or None,
            "reminder_pending_groups": int(pending_groups_total),
            "warning": warning,
        }


transfer_act_reminder_service = TransferActReminderService()
