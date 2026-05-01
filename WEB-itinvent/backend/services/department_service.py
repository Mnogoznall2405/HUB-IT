"""Department directory and membership service."""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import select

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppDepartment, AppDepartmentMembership
from backend.json_db.manager import JSONDataManager


DEPARTMENTS_FILE = "departments.json"
DEPARTMENT_MEMBERSHIPS_FILE = "department_memberships.json"
DEPARTMENT_MEMBER_ROLE = "member"
DEPARTMENT_MANAGER_ROLE = "manager"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_department_name(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def department_id_from_name(value: Any) -> str | None:
    name = normalize_department_name(value)
    if not name:
        return None
    digest = hashlib.sha1(name.casefold().encode("utf-8")).hexdigest()[:20]
    return f"dept-{digest}"


def _normalize_role(value: Any) -> str:
    role = str(value or "").strip().lower()
    return role if role in {DEPARTMENT_MEMBER_ROLE, DEPARTMENT_MANAGER_ROLE} else DEPARTMENT_MEMBER_ROLE


def _normalize_source(value: Any) -> str:
    source = str(value or "").strip().lower()
    return source if source in {"ad", "manual"} else "manual"


class DepartmentService:
    def __init__(self, data_manager: Optional[JSONDataManager] = None, database_url: str | None = None) -> None:
        self._database_url = str(database_url or "").strip() or None
        self._use_app_database = bool(self._database_url) or is_app_database_configured()
        self._data_manager = data_manager or (None if self._use_app_database else JSONDataManager())
        if self._use_app_database:
            initialize_app_schema(self._database_url)

    @staticmethod
    def department_id_from_name(value: Any) -> str | None:
        return department_id_from_name(value)

    def _load_json_departments(self) -> list[dict[str, Any]]:
        rows = self._data_manager.load_json(DEPARTMENTS_FILE, default_content=[]) if self._data_manager else []
        return [dict(row) for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def _save_json_departments(self, rows: list[dict[str, Any]]) -> None:
        if self._data_manager:
            self._data_manager.save_json(DEPARTMENTS_FILE, rows)

    def _load_json_memberships(self) -> list[dict[str, Any]]:
        rows = self._data_manager.load_json(DEPARTMENT_MEMBERSHIPS_FILE, default_content=[]) if self._data_manager else []
        return [dict(row) for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def _save_json_memberships(self, rows: list[dict[str, Any]]) -> None:
        if self._data_manager:
            self._data_manager.save_json(DEPARTMENT_MEMBERSHIPS_FILE, rows)

    @staticmethod
    def _department_row(row: Any) -> dict[str, Any]:
        if isinstance(row, dict):
            return {
                "id": str(row.get("id") or ""),
                "name": normalize_department_name(row.get("name")),
                "source": _normalize_source(row.get("source")),
                "is_active": row.get("is_active") is not False,
                "created_at": str(row.get("created_at") or ""),
                "updated_at": str(row.get("updated_at") or ""),
            }
        return {
            "id": str(row.id),
            "name": normalize_department_name(row.name),
            "source": _normalize_source(row.source),
            "is_active": bool(row.is_active),
            "created_at": row.created_at.isoformat() if row.created_at else "",
            "updated_at": row.updated_at.isoformat() if row.updated_at else "",
        }

    @staticmethod
    def _membership_row(row: Any) -> dict[str, Any]:
        if isinstance(row, dict):
            return {
                "id": int(row.get("id") or 0),
                "department_id": str(row.get("department_id") or ""),
                "user_id": int(row.get("user_id") or 0),
                "role": _normalize_role(row.get("role")),
                "source": _normalize_source(row.get("source")),
                "is_active": row.get("is_active") is not False,
                "created_at": str(row.get("created_at") or ""),
                "updated_at": str(row.get("updated_at") or ""),
            }
        return {
            "id": int(row.id),
            "department_id": str(row.department_id),
            "user_id": int(row.user_id),
            "role": _normalize_role(row.role),
            "source": _normalize_source(row.source),
            "is_active": bool(row.is_active),
            "created_at": row.created_at.isoformat() if row.created_at else "",
            "updated_at": row.updated_at.isoformat() if row.updated_at else "",
        }

    def ensure_department(self, name: Any, *, source: str = "manual") -> dict[str, Any] | None:
        department_name = normalize_department_name(name)
        department_id = department_id_from_name(department_name)
        if not department_id:
            return None
        now = datetime.now(timezone.utc)
        if self._use_app_database:
            initialize_app_schema(self._database_url)
            with app_session(self._database_url) as session:
                row = session.get(AppDepartment, department_id)
                if row is None:
                    row = AppDepartment(id=department_id, created_at=now)
                    session.add(row)
                row.name = department_name
                row.source = _normalize_source(source)
                row.is_active = True
                row.updated_at = now
                session.flush()
                return self._department_row(row)

        rows = self._load_json_departments()
        existing = next((row for row in rows if str(row.get("id")) == department_id), None)
        now_iso = _utc_now_iso()
        if existing is None:
            existing = {
                "id": department_id,
                "created_at": now_iso,
            }
            rows.append(existing)
        existing.update({
            "name": department_name,
            "source": _normalize_source(source),
            "is_active": True,
            "updated_at": now_iso,
        })
        self._save_json_departments(rows)
        return self._department_row(existing)

    def get_department(self, department_id: Any) -> dict[str, Any] | None:
        target = str(department_id or "").strip()
        if not target:
            return None
        if self._use_app_database:
            with app_session(self._database_url) as session:
                row = session.get(AppDepartment, target)
                return self._department_row(row) if row else None
        for row in self._load_json_departments():
            if str(row.get("id") or "") == target:
                return self._department_row(row)
        return None

    def sync_departments_from_users(self, users: Iterable[dict[str, Any]]) -> None:
        for user in list(users or []):
            department_name = normalize_department_name((user or {}).get("department"))
            if not department_name:
                continue
            department = self.ensure_department(department_name, source="ad")
            if department:
                self.replace_user_ad_department(int((user or {}).get("id") or 0), department_name)

    def sync_departments_from_names(self, department_names: Iterable[Any]) -> dict[str, Any]:
        created_or_updated = []
        seen: set[str] = set()
        skipped_empty = 0
        for item in list(department_names or []):
            department_name = normalize_department_name(item)
            if not department_name:
                skipped_empty += 1
                continue
            key = department_name.casefold()
            if key in seen:
                continue
            seen.add(key)
            department = self.ensure_department(department_name, source="ad")
            if department:
                created_or_updated.append(department)
        return {
            "synced": len(created_or_updated),
            "skipped_empty": skipped_empty,
            "items": sorted(created_or_updated, key=lambda row: str(row.get("name") or "").casefold()),
        }

    def list_departments(self, *, include_inactive: bool = False) -> list[dict[str, Any]]:
        if self._use_app_database:
            with app_session(self._database_url) as session:
                departments = [self._department_row(row) for row in session.scalars(select(AppDepartment)).all()]
                memberships = [self._membership_row(row) for row in session.scalars(select(AppDepartmentMembership)).all()]
        else:
            departments = [self._department_row(row) for row in self._load_json_departments()]
            memberships = [self._membership_row(row) for row in self._load_json_memberships()]
        counts: dict[str, dict[str, int]] = {}
        for membership in memberships:
            if not membership["is_active"]:
                continue
            bucket = counts.setdefault(membership["department_id"], {"members_count": 0, "managers_count": 0})
            if membership["role"] == DEPARTMENT_MANAGER_ROLE:
                bucket["managers_count"] += 1
            else:
                bucket["members_count"] += 1
        result = []
        for department in departments:
            if not include_inactive and not department["is_active"]:
                continue
            result.append({
                **department,
                **counts.get(department["id"], {"members_count": 0, "managers_count": 0}),
            })
        result.sort(key=lambda row: str(row.get("name") or "").casefold())
        return result

    def list_memberships(self, *, department_id: Any = None, user_id: Any = None, active_only: bool = True) -> list[dict[str, Any]]:
        target_department_id = str(department_id or "").strip()
        target_user_id = int(user_id or 0) if user_id not in (None, "") else 0
        if self._use_app_database:
            with app_session(self._database_url) as session:
                rows = [self._membership_row(row) for row in session.scalars(select(AppDepartmentMembership)).all()]
        else:
            rows = [self._membership_row(row) for row in self._load_json_memberships()]
        result = []
        for row in rows:
            if active_only and not row["is_active"]:
                continue
            if target_department_id and row["department_id"] != target_department_id:
                continue
            if target_user_id > 0 and row["user_id"] != target_user_id:
                continue
            result.append(row)
        result.sort(key=lambda row: (row["department_id"], row["role"], row["user_id"]))
        return result

    def replace_user_ad_department(self, user_id: int, department_name: Any) -> None:
        normalized_user_id = int(user_id or 0)
        if normalized_user_id <= 0:
            return
        department = self.ensure_department(department_name, source="ad") if normalize_department_name(department_name) else None
        now = datetime.now(timezone.utc)
        if self._use_app_database:
            with app_session(self._database_url) as session:
                rows = session.scalars(
                    select(AppDepartmentMembership).where(
                        AppDepartmentMembership.user_id == normalized_user_id,
                        AppDepartmentMembership.source == "ad",
                        AppDepartmentMembership.role == DEPARTMENT_MEMBER_ROLE,
                    )
                ).all()
                for row in rows:
                    row.is_active = False
                    row.updated_at = now
                if department:
                    current = next((row for row in rows if row.department_id == department["id"]), None)
                    if current is None:
                        current = AppDepartmentMembership(
                            department_id=department["id"],
                            user_id=normalized_user_id,
                            role=DEPARTMENT_MEMBER_ROLE,
                            source="ad",
                            created_at=now,
                        )
                        session.add(current)
                    current.is_active = True
                    current.updated_at = now
            return

        rows = self._load_json_memberships()
        now_iso = _utc_now_iso()
        for row in rows:
            if int(row.get("user_id") or 0) == normalized_user_id and _normalize_source(row.get("source")) == "ad" and _normalize_role(row.get("role")) == DEPARTMENT_MEMBER_ROLE:
                row["is_active"] = False
                row["updated_at"] = now_iso
        if department:
            current = next(
                (
                    row for row in rows
                    if str(row.get("department_id") or "") == department["id"]
                    and int(row.get("user_id") or 0) == normalized_user_id
                    and _normalize_role(row.get("role")) == DEPARTMENT_MEMBER_ROLE
                ),
                None,
            )
            if current is None:
                current = {
                    "id": max([int(row.get("id") or 0) for row in rows], default=0) + 1,
                    "department_id": department["id"],
                    "user_id": normalized_user_id,
                    "role": DEPARTMENT_MEMBER_ROLE,
                    "source": "ad",
                    "created_at": now_iso,
                }
                rows.append(current)
            current.update({"is_active": True, "source": "ad", "updated_at": now_iso})
        self._save_json_memberships(rows)

    def set_department_managers(self, department_id: str, manager_user_ids: Iterable[int]) -> list[dict[str, Any]]:
        target = str(department_id or "").strip()
        if not target or not self.get_department(target):
            raise ValueError("Department not found")
        desired: set[int] = set()
        for item in list(manager_user_ids or []):
            try:
                parsed = int(item)
            except Exception:
                continue
            if parsed > 0:
                desired.add(parsed)
        now = datetime.now(timezone.utc)
        if self._use_app_database:
            with app_session(self._database_url) as session:
                rows = session.scalars(
                    select(AppDepartmentMembership).where(
                        AppDepartmentMembership.department_id == target,
                        AppDepartmentMembership.role == DEPARTMENT_MANAGER_ROLE,
                    )
                ).all()
                existing_by_user = {int(row.user_id): row for row in rows}
                for row in rows:
                    row.is_active = int(row.user_id) in desired
                    row.updated_at = now
                for user_id in desired:
                    if user_id in existing_by_user:
                        continue
                    session.add(
                        AppDepartmentMembership(
                            department_id=target,
                            user_id=user_id,
                            role=DEPARTMENT_MANAGER_ROLE,
                            source="manual",
                            is_active=True,
                            created_at=now,
                            updated_at=now,
                        )
                    )
            return self.list_memberships(department_id=target)

        rows = self._load_json_memberships()
        now_iso = _utc_now_iso()
        existing_by_user = {
            int(row.get("user_id") or 0): row
            for row in rows
            if str(row.get("department_id") or "") == target and _normalize_role(row.get("role")) == DEPARTMENT_MANAGER_ROLE
        }
        for row in existing_by_user.values():
            row["is_active"] = int(row.get("user_id") or 0) in desired
            row["updated_at"] = now_iso
        next_id = max([int(row.get("id") or 0) for row in rows], default=0) + 1
        for user_id in desired:
            if user_id in existing_by_user:
                continue
            rows.append({
                "id": next_id,
                "department_id": target,
                "user_id": user_id,
                "role": DEPARTMENT_MANAGER_ROLE,
                "source": "manual",
                "is_active": True,
                "created_at": now_iso,
                "updated_at": now_iso,
            })
            next_id += 1
        self._save_json_memberships(rows)
        return self.list_memberships(department_id=target)

    def get_user_department_ids(self, user: dict[str, Any] | int, *, roles: Iterable[str] | None = None) -> set[str]:
        if isinstance(user, dict):
            user_id = int(user.get("id") or 0)
            fallback_department_name = user.get("department")
        else:
            user_id = int(user or 0)
            fallback_department_name = None
        allowed_roles = {_normalize_role(role) for role in list(roles or [])} if roles else set()
        department_ids = {
            row["department_id"]
            for row in self.list_memberships(user_id=user_id)
            if row["department_id"] and (not allowed_roles or row["role"] in allowed_roles)
        }
        can_use_department_fallback = not allowed_roles or DEPARTMENT_MEMBER_ROLE in allowed_roles
        if not department_ids and fallback_department_name and can_use_department_fallback:
            fallback_id = department_id_from_name(fallback_department_name)
            if fallback_id:
                department_ids.add(fallback_id)
        return department_ids

    def get_user_primary_department_id(self, user: dict[str, Any]) -> str | None:
        department_ids = self.get_user_department_ids(user, roles=[DEPARTMENT_MEMBER_ROLE])
        if department_ids:
            return sorted(department_ids)[0]
        return department_id_from_name((user or {}).get("department"))

    def is_department_manager(self, user: dict[str, Any] | int, department_id: Any) -> bool:
        target = str(department_id or "").strip()
        if not target:
            return False
        return target in self.get_user_department_ids(user, roles=[DEPARTMENT_MANAGER_ROLE])


department_service = DepartmentService()
