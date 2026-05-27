"""Per-user recent equipment card activity."""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import delete, select

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppEquipmentRecentCard


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


def _normalize_action_type(value: Any) -> str:
    action = _normalize_text(value).lower()
    return action or "view"


ACTION_LABELS = {
    "view": "Открыта",
    "edit": "Изменена",
    "transfer": "Перемещение с актом",
    "location_transfer": "Перемещение",
    "act": "Акт",
    "cartridge": "Картридж",
    "battery": "Батарея",
    "component": "Компонент",
    "cleaning": "Чистка ПК",
    "delete": "Удалена",
}

SNAPSHOT_KEYS = (
    "ID",
    "id",
    "INV_NO",
    "inv_no",
    "SERIAL_NO",
    "serial_no",
    "HW_SERIAL_NO",
    "hw_serial_no",
    "PART_NO",
    "part_no",
    "TYPE_NAME",
    "type_name",
    "MODEL_NAME",
    "model_name",
    "OWNER_DISPLAY_NAME",
    "employee_name",
    "OWNER_FULLNAME",
    "OWNER_DEPT",
    "employee_dept",
    "STATUS_NAME",
    "status_name",
    "STATUS_DESCR",
    "status_descr",
    "DESCR",
    "status",
    "BRANCH_NAME",
    "branch_name",
    "LOCATION_NAME",
    "location_name",
    "LOCATION",
    "location",
    "PLACE",
    "DESCRIPTION",
    "description",
)


class EquipmentRecentCardsService:
    """Store the latest equipment cards touched by each web user."""

    FILE_NAME = "web_equipment_recent_cards.json"
    MAX_PER_SCOPE = 50

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

    @staticmethod
    def normalize_snapshot(snapshot: Any, *, inv_no: str) -> dict[str, Any]:
        if not isinstance(snapshot, dict):
            snapshot = {}
        result: dict[str, Any] = {}
        for key in SNAPSHOT_KEYS:
            if key not in snapshot:
                continue
            value = snapshot.get(key)
            if value is None:
                continue
            if isinstance(value, (dict, list, tuple)):
                continue
            result[key] = value
        if inv_no and not (result.get("INV_NO") or result.get("inv_no")):
            result["inv_no"] = inv_no
        return result

    @staticmethod
    def _row_to_dict(row: AppEquipmentRecentCard) -> dict[str, Any]:
        snapshot = _json_loads(row.snapshot_json, {})
        return {
            "id": int(row.id or 0),
            "user_id": int(row.user_id or 0),
            "db_id": _normalize_db_id(row.db_id),
            "inv_no": _normalize_text(row.inv_no),
            "last_action": _normalize_action_type(row.last_action),
            "last_action_label": _normalize_text(row.last_action_label) or EquipmentRecentCardsService.action_label(row.last_action),
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
                select(AppEquipmentRecentCard.id)
                .where(AppEquipmentRecentCard.user_id == user_id, AppEquipmentRecentCard.db_id == db_id)
                .order_by(AppEquipmentRecentCard.last_activity_at.desc(), AppEquipmentRecentCard.id.desc())
                .offset(self.MAX_PER_SCOPE)
            ).all()
        ]
        if stale_ids:
            session.execute(delete(AppEquipmentRecentCard).where(AppEquipmentRecentCard.id.in_(stale_ids)))

    def _prune_local_scope(self, items: list[dict[str, Any]], *, user_id: int, db_id: str) -> list[dict[str, Any]]:
        scoped = [
            item for item in items
            if _normalize_user_id(item.get("user_id")) == user_id and _normalize_db_id(item.get("db_id")) == db_id
        ]
        scoped.sort(key=self._local_sort_key, reverse=True)
        stale_keys = {
            (_normalize_user_id(item.get("user_id")), _normalize_db_id(item.get("db_id")), _normalize_text(item.get("inv_no")))
            for item in scoped[self.MAX_PER_SCOPE:]
        }
        if not stale_keys:
            return items
        return [
            item for item in items
            if (
                _normalize_user_id(item.get("user_id")),
                _normalize_db_id(item.get("db_id")),
                _normalize_text(item.get("inv_no")),
            ) not in stale_keys
        ]

    def touch(
        self,
        *,
        user_id: int,
        db_id: Any,
        inv_no: Any,
        action_type: Any = "view",
        snapshot: Any = None,
    ) -> dict[str, Any]:
        normalized_user_id = _normalize_user_id(user_id)
        normalized_db_id = _normalize_db_id(db_id)
        normalized_inv_no = _normalize_text(inv_no)
        if normalized_user_id <= 0:
            raise ValueError("user_id is required")
        if not normalized_inv_no:
            raise ValueError("inv_no is required")

        normalized_action = _normalize_action_type(action_type)
        label = self.action_label(normalized_action)
        next_snapshot = self.normalize_snapshot(snapshot, inv_no=normalized_inv_no)
        now = _utc_now()

        if self._use_app_database:
            with app_session(self._database_url) as session:
                row = session.execute(
                    select(AppEquipmentRecentCard).where(
                        AppEquipmentRecentCard.user_id == normalized_user_id,
                        AppEquipmentRecentCard.db_id == normalized_db_id,
                        AppEquipmentRecentCard.inv_no == normalized_inv_no,
                    )
                ).scalar_one_or_none()
                if row is None:
                    row = AppEquipmentRecentCard(
                        user_id=normalized_user_id,
                        db_id=normalized_db_id,
                        inv_no=normalized_inv_no,
                        created_at=now,
                        activity_count=0,
                    )
                    session.add(row)
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
                    and _normalize_text(item.get("inv_no")) == normalized_inv_no
                ):
                    next_item = item
                    break
            if next_item is None:
                next_item = {
                    "id": len(items) + 1,
                    "user_id": normalized_user_id,
                    "db_id": normalized_db_id,
                    "inv_no": normalized_inv_no,
                    "created_at": _utc_now_iso(),
                    "activity_count": 0,
                }
                items.append(next_item)
            next_item.update(
                {
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
                    select(AppEquipmentRecentCard)
                    .where(
                        AppEquipmentRecentCard.user_id == normalized_user_id,
                        AppEquipmentRecentCard.db_id == normalized_db_id,
                    )
                    .order_by(AppEquipmentRecentCard.last_activity_at.desc(), AppEquipmentRecentCard.id.desc())
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

    def remove(self, *, user_id: int, db_id: Any, inv_no: Any) -> dict[str, Any]:
        normalized_user_id = _normalize_user_id(user_id)
        normalized_db_id = _normalize_db_id(db_id)
        normalized_inv_no = _normalize_text(inv_no)
        if normalized_user_id <= 0 or not normalized_inv_no:
            return {"removed": 0}

        if self._use_app_database:
            with app_session(self._database_url) as session:
                result = session.execute(
                    delete(AppEquipmentRecentCard).where(
                        AppEquipmentRecentCard.user_id == normalized_user_id,
                        AppEquipmentRecentCard.db_id == normalized_db_id,
                        AppEquipmentRecentCard.inv_no == normalized_inv_no,
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
                    and _normalize_text(item.get("inv_no")) == normalized_inv_no
                )
            ]
            self._save_local_items_unlocked(next_items)
            return {"removed": len(items) - len(next_items)}

    def remove_for_equipment(self, *, db_id: Any, inv_no: Any) -> dict[str, Any]:
        normalized_db_id = _normalize_db_id(db_id)
        normalized_inv_no = _normalize_text(inv_no)
        if not normalized_inv_no:
            return {"removed": 0}

        if self._use_app_database:
            with app_session(self._database_url) as session:
                result = session.execute(
                    delete(AppEquipmentRecentCard).where(
                        AppEquipmentRecentCard.db_id == normalized_db_id,
                        AppEquipmentRecentCard.inv_no == normalized_inv_no,
                    )
                )
                return {"removed": int(result.rowcount or 0)}

        with self._file_lock:
            items = self._load_local_items_unlocked()
            next_items = [
                item for item in items
                if not (
                    _normalize_db_id(item.get("db_id")) == normalized_db_id
                    and _normalize_text(item.get("inv_no")) == normalized_inv_no
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
                    delete(AppEquipmentRecentCard).where(
                        AppEquipmentRecentCard.user_id == normalized_user_id,
                        AppEquipmentRecentCard.db_id == normalized_db_id,
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


equipment_recent_cards_service = EquipmentRecentCardsService()
