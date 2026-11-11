"""Per-user recent equipment act activity."""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import delete, select

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppEquipmentRecentAct


logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _json_loads(raw: str | bytes | None, fallback: Any) -> Any:
    try:
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        return json.loads(str(raw or ""))
    except Exception:
        return fallback


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_db_id(value: Any) -> str:
    return _normalize_text(value) or "default"


def _normalize_user_id(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _normalize_doc_no(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _normalize_action_type(value: Any) -> str:
    action = _normalize_text(value).lower()
    return action or "view"


ACTION_LABELS = {
    "view": "Открыт",
    "open_file": "Файл",
    "create": "Создан",
    "upload": "Загружен",
    "transfer": "Перемещение",
}


SNAPSHOT_SCALAR_KEYS = (
    "doc_no",
    "DOC_NO",
    "doc_number",
    "DOC_NUMBER",
    "doc_date",
    "DOC_DATE",
    "type_no",
    "TYPE_NO",
    "branch_name",
    "BRANCH_NAME",
    "location_name",
    "LOCATION_NAME",
    "employee_name",
    "EMPLOYEE_NAME",
    "has_file",
    "item_count",
    "items_count",
)


class EquipmentRecentActsService:
    """Store the latest transfer/act documents touched by each web user."""

    FILE_NAME = "web_equipment_recent_acts.json"
    MAX_PER_SCOPE = 50
    MAX_SNAPSHOT_ITEMS = 20

    def __init__(self, file_path: Optional[Path] = None, database_url: Optional[str] = None):
        if file_path is None:
            project_root = Path(__file__).resolve().parents[3]
            file_path = project_root / "data" / self.FILE_NAME
        self.file_path = Path(file_path)
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        self._file_lock = threading.RLock()
        self._database_url = _normalize_text(database_url) or None
        self._use_app_database = bool(self._database_url) or is_app_database_configured()
        if self._use_app_database:
            initialize_app_schema(self._database_url)
        else:
            self._ensure_file()

    def _ensure_file(self) -> None:
        if self._use_app_database:
            return
        with self._file_lock:
            if not self.file_path.exists():
                self._save_local_items_unlocked([])
                return
            try:
                data = json.loads(self.file_path.read_text(encoding="utf-8"))
            except Exception:
                data = None
            if not isinstance(data, list):
                self._save_local_items_unlocked([])

    @staticmethod
    def action_label(action_type: str) -> str:
        action = _normalize_action_type(action_type)
        return ACTION_LABELS.get(action, action.replace("_", " ").strip() or ACTION_LABELS["view"])

    @classmethod
    def normalize_snapshot(
        cls,
        snapshot: Any,
        *,
        doc_no: int,
        doc_number: str = "",
    ) -> dict[str, Any]:
        if not isinstance(snapshot, dict):
            snapshot = {}
        result: dict[str, Any] = {}
        for key in SNAPSHOT_SCALAR_KEYS:
            if key not in snapshot:
                continue
            value = snapshot.get(key)
            if value is None:
                continue
            if isinstance(value, (dict, list, tuple)):
                continue
            result[key] = value

        items_raw = snapshot.get("items")
        items: list[dict[str, Any]] = []
        if isinstance(items_raw, list):
            for raw_item in items_raw[: cls.MAX_SNAPSHOT_ITEMS]:
                if not isinstance(raw_item, dict):
                    continue
                inv_no = _normalize_text(raw_item.get("inv_no") or raw_item.get("INV_NO"))
                if not inv_no:
                    continue
                items.append(
                    {
                        "inv_no": inv_no,
                        "model_name": _normalize_text(raw_item.get("model_name") or raw_item.get("MODEL_NAME")),
                        "serial_no": _normalize_text(raw_item.get("serial_no") or raw_item.get("SERIAL_NO")),
                        "item_id": raw_item.get("item_id") or raw_item.get("ITEM_ID"),
                    }
                )
        if items:
            result["items"] = items
            result["item_count"] = len(items)
        elif "item_count" not in result and "items_count" in result:
            result["item_count"] = result.get("items_count")

        if doc_no and not result.get("doc_no") and not result.get("DOC_NO"):
            result["doc_no"] = doc_no
        normalized_doc_number = _normalize_text(doc_number) or _normalize_text(
            result.get("doc_number") or result.get("DOC_NUMBER")
        )
        if normalized_doc_number:
            result["doc_number"] = normalized_doc_number
        return result

    @staticmethod
    def _row_to_dict(row: AppEquipmentRecentAct) -> dict[str, Any]:
        snapshot = _json_loads(row.snapshot_json, {})
        return {
            "id": int(row.id or 0),
            "user_id": int(row.user_id or 0),
            "db_id": _normalize_db_id(row.db_id),
            "doc_no": _normalize_doc_no(row.doc_no),
            "doc_number": _normalize_text(row.doc_number),
            "last_action": _normalize_action_type(row.last_action),
            "last_action_label": _normalize_text(row.last_action_label)
            or EquipmentRecentActsService.action_label(row.last_action),
            "snapshot": snapshot if isinstance(snapshot, dict) else {},
            "activity_count": int(row.activity_count or 0),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "last_activity_at": row.last_activity_at.isoformat() if row.last_activity_at else None,
        }

    @staticmethod
    def _local_sort_key(item: dict[str, Any]) -> str:
        return _normalize_text(item.get("last_activity_at"))

    def _load_local_items_unlocked(self) -> list[dict[str, Any]]:
        try:
            data = json.loads(self.file_path.read_text(encoding="utf-8"))
        except Exception:
            data = []
        return data if isinstance(data, list) else []

    def _save_local_items_unlocked(self, items: list[dict[str, Any]]) -> None:
        tmp_path = self.file_path.with_suffix(f"{self.file_path.suffix}.tmp")
        tmp_path.write_text(
            json.dumps(items, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
        tmp_path.replace(self.file_path)

    def _prune_db_scope(self, session, *, user_id: int, db_id: str) -> None:
        stale_ids = [
            int(row_id)
            for row_id in session.scalars(
                select(AppEquipmentRecentAct.id)
                .where(AppEquipmentRecentAct.user_id == user_id, AppEquipmentRecentAct.db_id == db_id)
                .order_by(AppEquipmentRecentAct.last_activity_at.desc(), AppEquipmentRecentAct.id.desc())
                .offset(self.MAX_PER_SCOPE)
            ).all()
        ]
        if stale_ids:
            session.execute(delete(AppEquipmentRecentAct).where(AppEquipmentRecentAct.id.in_(stale_ids)))

    def _prune_local_scope(self, items: list[dict[str, Any]], *, user_id: int, db_id: str) -> list[dict[str, Any]]:
        scoped = [
            item for item in items
            if _normalize_user_id(item.get("user_id")) == user_id and _normalize_db_id(item.get("db_id")) == db_id
        ]
        scoped.sort(key=self._local_sort_key, reverse=True)
        stale_keys = {
            (
                _normalize_user_id(item.get("user_id")),
                _normalize_db_id(item.get("db_id")),
                _normalize_doc_no(item.get("doc_no")),
            )
            for item in scoped[self.MAX_PER_SCOPE :]
        }
        if not stale_keys:
            return items
        return [
            item for item in items
            if (
                _normalize_user_id(item.get("user_id")),
                _normalize_db_id(item.get("db_id")),
                _normalize_doc_no(item.get("doc_no")),
            )
            not in stale_keys
        ]

    def touch(
        self,
        *,
        user_id: int,
        db_id: Any,
        doc_no: Any,
        doc_number: Any = "",
        action_type: Any = "view",
        snapshot: Any = None,
    ) -> dict[str, Any]:
        normalized_user_id = _normalize_user_id(user_id)
        normalized_db_id = _normalize_db_id(db_id)
        normalized_doc_no = _normalize_doc_no(doc_no)
        normalized_doc_number = _normalize_text(doc_number)
        if normalized_user_id <= 0:
            raise ValueError("user_id is required")
        if normalized_doc_no <= 0:
            raise ValueError("doc_no is required")

        normalized_action = _normalize_action_type(action_type)
        label = self.action_label(normalized_action)
        next_snapshot = self.normalize_snapshot(
            snapshot,
            doc_no=normalized_doc_no,
            doc_number=normalized_doc_number,
        )
        if not normalized_doc_number:
            normalized_doc_number = _normalize_text(
                next_snapshot.get("doc_number") or next_snapshot.get("DOC_NUMBER")
            )
        now = _utc_now()

        if self._use_app_database:
            with app_session(self._database_url) as session:
                row = session.execute(
                    select(AppEquipmentRecentAct).where(
                        AppEquipmentRecentAct.user_id == normalized_user_id,
                        AppEquipmentRecentAct.db_id == normalized_db_id,
                        AppEquipmentRecentAct.doc_no == normalized_doc_no,
                    )
                ).scalar_one_or_none()
                if row is None:
                    row = AppEquipmentRecentAct(
                        user_id=normalized_user_id,
                        db_id=normalized_db_id,
                        doc_no=normalized_doc_no,
                        doc_number=normalized_doc_number,
                        created_at=now,
                        activity_count=0,
                    )
                    session.add(row)
                row.doc_number = normalized_doc_number or _normalize_text(row.doc_number)
                row.last_action = normalized_action
                row.last_action_label = label
                row.snapshot_json = json.dumps(next_snapshot, ensure_ascii=False, default=str)
                row.activity_count = int(row.activity_count or 0) + 1
                row.last_activity_at = now
                session.flush()
                self._prune_db_scope(session, user_id=normalized_user_id, db_id=normalized_db_id)
                session.flush()
                return self._row_to_dict(row)

        with self._file_lock:
            items = self._load_local_items_unlocked()
            next_item = None
            for item in items:
                if (
                    _normalize_user_id(item.get("user_id")) == normalized_user_id
                    and _normalize_db_id(item.get("db_id")) == normalized_db_id
                    and _normalize_doc_no(item.get("doc_no")) == normalized_doc_no
                ):
                    next_item = item
                    break
            if next_item is None:
                next_item = {
                    "id": len(items) + 1,
                    "user_id": normalized_user_id,
                    "db_id": normalized_db_id,
                    "doc_no": normalized_doc_no,
                    "doc_number": normalized_doc_number,
                    "created_at": _utc_now_iso(),
                    "activity_count": 0,
                }
                items.append(next_item)
            next_item.update(
                {
                    "doc_number": normalized_doc_number or _normalize_text(next_item.get("doc_number")),
                    "last_action": normalized_action,
                    "last_action_label": label,
                    "snapshot": next_snapshot,
                    "activity_count": int(next_item.get("activity_count") or 0) + 1,
                    "last_activity_at": now.isoformat(),
                }
            )
            items = self._prune_local_scope(items, user_id=normalized_user_id, db_id=normalized_db_id)
            self._save_local_items_unlocked(items)
            return dict(next_item)

    def list_recent(self, *, user_id: int, db_id: Any, limit: int = 8) -> list[dict[str, Any]]:
        normalized_user_id = _normalize_user_id(user_id)
        normalized_db_id = _normalize_db_id(db_id)
        safe_limit = max(1, min(self.MAX_PER_SCOPE, int(limit or 8)))
        if normalized_user_id <= 0:
            return []

        if self._use_app_database:
            with app_session(self._database_url) as session:
                rows = session.scalars(
                    select(AppEquipmentRecentAct)
                    .where(
                        AppEquipmentRecentAct.user_id == normalized_user_id,
                        AppEquipmentRecentAct.db_id == normalized_db_id,
                    )
                    .order_by(AppEquipmentRecentAct.last_activity_at.desc(), AppEquipmentRecentAct.id.desc())
                    .limit(safe_limit)
                ).all()
                return [self._row_to_dict(row) for row in rows]

        with self._file_lock:
            items = [
                dict(item)
                for item in self._load_local_items_unlocked()
                if (
                    _normalize_user_id(item.get("user_id")) == normalized_user_id
                    and _normalize_db_id(item.get("db_id")) == normalized_db_id
                )
            ]
        items.sort(key=self._local_sort_key, reverse=True)
        return items[:safe_limit]

    def remove(self, *, user_id: int, db_id: Any, doc_no: Any) -> dict[str, Any]:
        normalized_user_id = _normalize_user_id(user_id)
        normalized_db_id = _normalize_db_id(db_id)
        normalized_doc_no = _normalize_doc_no(doc_no)
        if normalized_user_id <= 0 or normalized_doc_no <= 0:
            return {"removed": 0}

        if self._use_app_database:
            with app_session(self._database_url) as session:
                result = session.execute(
                    delete(AppEquipmentRecentAct).where(
                        AppEquipmentRecentAct.user_id == normalized_user_id,
                        AppEquipmentRecentAct.db_id == normalized_db_id,
                        AppEquipmentRecentAct.doc_no == normalized_doc_no,
                    )
                )
                return {"removed": int(result.rowcount or 0)}

        with self._file_lock:
            items = self._load_local_items_unlocked()
            next_items = [
                item for item in items
                if not (
                    _normalize_user_id(item.get("user_id")) == normalized_user_id
                    and _normalize_db_id(item.get("db_id")) == normalized_db_id
                    and _normalize_doc_no(item.get("doc_no")) == normalized_doc_no
                )
            ]
            self._save_local_items_unlocked(next_items)
            return {"removed": len(items) - len(next_items)}

    def clear(self, *, user_id: int, db_id: Any) -> dict[str, Any]:
        normalized_user_id = _normalize_user_id(user_id)
        normalized_db_id = _normalize_db_id(db_id)
        if normalized_user_id <= 0:
            return {"removed": 0}

        if self._use_app_database:
            with app_session(self._database_url) as session:
                result = session.execute(
                    delete(AppEquipmentRecentAct).where(
                        AppEquipmentRecentAct.user_id == normalized_user_id,
                        AppEquipmentRecentAct.db_id == normalized_db_id,
                    )
                )
                return {"removed": int(result.rowcount or 0)}

        with self._file_lock:
            items = self._load_local_items_unlocked()
            next_items = [
                item for item in items
                if not (
                    _normalize_user_id(item.get("user_id")) == normalized_user_id
                    and _normalize_db_id(item.get("db_id")) == normalized_db_id
                )
            ]
            self._save_local_items_unlocked(next_items)
            return {"removed": len(items) - len(next_items)}


equipment_recent_acts_service = EquipmentRecentActsService()
