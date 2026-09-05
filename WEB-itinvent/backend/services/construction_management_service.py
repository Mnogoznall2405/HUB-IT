"""HUB-owned construction object passports and permanent project teams."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable
import uuid

from sqlalchemy import delete, select

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import (
    AppConstructionObject,
    AppConstructionObject1CGroup,
    AppConstructionObjectRoleAssignment,
)


CONSTRUCTION_ROLE_KEYS = (
    "project_lead",
    "pto_manager",
    "umto_coordinator",
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else None


def _text(value: Any, *, max_length: int = 255) -> str:
    return " ".join(str(value or "").strip().split())[:max_length]


def normalize_construction_group_ref(value: Any) -> str:
    candidate = _text(value, max_length=64)
    try:
        return str(uuid.UUID(candidate)).lower()
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("Некорректный GUID номенклатурной группы 1С") from exc


def _normalize_groups(groups: Iterable[dict[str, Any]] | None) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in groups or []:
        group_ref = normalize_construction_group_ref(raw.get("group_ref"))
        if group_ref in seen:
            continue
        seen.add(group_ref)
        result.append(
            {
                "group_ref": group_ref,
                "group_name": _text(raw.get("group_name")),
            }
        )
    if not result:
        raise ValueError("Выберите хотя бы одну номенклатурную группу 1С")
    return result


def _normalize_role_candidates(
    candidates: dict[str, dict[str, Any] | None] | None,
) -> dict[str, dict[str, str] | None]:
    normalized: dict[str, dict[str, str] | None] = {}
    for role_key in CONSTRUCTION_ROLE_KEYS:
        candidate = (candidates or {}).get(role_key)
        if not candidate:
            normalized[role_key] = None
            continue
        employee_code = _text(candidate.get("employee_code"), max_length=128)
        employee_name = _text(candidate.get("full_name"))
        if not employee_code or not employee_name:
            raise ValueError("Для сотрудника нужны стабильный код ЗУП и ФИО")
        normalized[role_key] = {
            "employee_code": employee_code,
            "full_name": employee_name,
            "position": _text(candidate.get("position")),
            "department": _text(candidate.get("department")),
            "department_location": _text(candidate.get("department_location")),
        }
    return normalized


def _serialize_group(row: AppConstructionObject1CGroup) -> dict[str, Any]:
    return {
        "group_ref": str(row.group_ref),
        "group_name": str(row.group_name or ""),
    }


def _serialize_role(row: AppConstructionObjectRoleAssignment) -> dict[str, Any]:
    return {
        "role_key": str(row.role_key),
        "employee_code": str(row.employee_code),
        "full_name": str(row.employee_name),
        "position": str(row.employee_position or ""),
        "department": str(row.employee_department or ""),
        "department_location": str(row.employee_department_location or ""),
        "valid_from": _iso(row.valid_from),
        "valid_to": _iso(row.valid_to),
    }


class ConstructionManagementService:
    def __init__(self, database_url: str | None = None) -> None:
        self._database_url = str(database_url or "").strip() or None
        if not (self._database_url or is_app_database_configured()):
            raise RuntimeError("APP_DATABASE_URL is required for construction objects")
        initialize_app_schema(self._database_url)

    def list_objects(
        self,
        *,
        include_inactive: bool = False,
        include_history: bool = False,
    ) -> list[dict[str, Any]]:
        with app_session(self._database_url) as session:
            object_query = select(AppConstructionObject)
            if not include_inactive:
                object_query = object_query.where(AppConstructionObject.is_active.is_(True))
            object_rows = session.scalars(
                object_query.order_by(AppConstructionObject.name, AppConstructionObject.id)
            ).all()
            object_ids = [str(row.id) for row in object_rows]
            group_rows = session.scalars(
                select(AppConstructionObject1CGroup)
                .where(AppConstructionObject1CGroup.object_id.in_(object_ids))
                .order_by(AppConstructionObject1CGroup.group_name, AppConstructionObject1CGroup.group_ref)
            ).all() if object_ids else []
            role_query = (
                select(AppConstructionObjectRoleAssignment)
                .where(AppConstructionObjectRoleAssignment.object_id.in_(object_ids))
                .order_by(
                    AppConstructionObjectRoleAssignment.object_id,
                    AppConstructionObjectRoleAssignment.role_key,
                    AppConstructionObjectRoleAssignment.valid_from.desc(),
                    AppConstructionObjectRoleAssignment.id.desc(),
                )
            )
            if not include_history:
                role_query = role_query.where(AppConstructionObjectRoleAssignment.valid_to.is_(None))
            role_rows = session.scalars(role_query).all() if object_ids else []

        groups_by_object: dict[str, list[dict[str, Any]]] = {object_id: [] for object_id in object_ids}
        for row in group_rows:
            groups_by_object.setdefault(str(row.object_id), []).append(_serialize_group(row))
        team_by_object: dict[str, list[dict[str, Any]]] = {object_id: [] for object_id in object_ids}
        history_by_object: dict[str, list[dict[str, Any]]] = {object_id: [] for object_id in object_ids}
        for row in role_rows:
            serialized = _serialize_role(row)
            if row.valid_to is None:
                team_by_object.setdefault(str(row.object_id), []).append(serialized)
            if include_history:
                history_by_object.setdefault(str(row.object_id), []).append(serialized)

        return [
            {
                "id": str(row.id),
                "name": str(row.name),
                "is_active": bool(row.is_active),
                "groups": groups_by_object.get(str(row.id), []),
                "team": team_by_object.get(str(row.id), []),
                "role_history": history_by_object.get(str(row.id), []) if include_history else [],
                "created_at": _iso(row.created_at),
                "updated_at": _iso(row.updated_at),
            }
            for row in object_rows
        ]

    def get_object(self, object_id: str, *, include_history: bool = True) -> dict[str, Any]:
        normalized_id = _text(object_id, max_length=64)
        for item in self.list_objects(include_inactive=True, include_history=include_history):
            if item["id"] == normalized_id:
                return item
        raise ValueError("Объект не найден")

    def get_snapshot_definitions(self) -> list[dict[str, Any]]:
        return self.list_objects(include_inactive=False, include_history=False)

    def save_object(
        self,
        *,
        object_id: str | None,
        name: str,
        groups: Iterable[dict[str, Any]],
        role_candidates: dict[str, dict[str, Any] | None] | None,
        actor_user_id: int,
    ) -> dict[str, Any]:
        normalized_name = _text(name)
        if not normalized_name:
            raise ValueError("Укажите название объекта")
        normalized_groups = _normalize_groups(groups)
        normalized_roles = _normalize_role_candidates(role_candidates)
        normalized_object_id = _text(object_id, max_length=64) or f"construction-{uuid.uuid4().hex[:20]}"
        actor_id = int(actor_user_id)
        now = _utc_now()

        with app_session(self._database_url) as session:
            row = session.get(AppConstructionObject, normalized_object_id)
            if object_id and row is None:
                raise ValueError("Объект не найден")
            group_refs = [item["group_ref"] for item in normalized_groups]
            conflicts = session.scalars(
                select(AppConstructionObject1CGroup).where(
                    AppConstructionObject1CGroup.group_ref.in_(group_refs),
                    AppConstructionObject1CGroup.object_id != normalized_object_id,
                )
            ).all()
            if conflicts:
                names = ", ".join(sorted({str(item.group_name or item.group_ref) for item in conflicts}))
                raise ValueError(f"Номенклатурная группа уже привязана к другому объекту: {names}")

            if row is None:
                row = AppConstructionObject(
                    id=normalized_object_id,
                    name=normalized_name,
                    is_active=True,
                    created_by_user_id=actor_id,
                    updated_by_user_id=actor_id,
                    created_at=now,
                    updated_at=now,
                )
                session.add(row)
            else:
                row.name = normalized_name
                row.is_active = True
                row.updated_by_user_id = actor_id
                row.updated_at = now

            session.execute(
                delete(AppConstructionObject1CGroup).where(
                    AppConstructionObject1CGroup.object_id == normalized_object_id
                )
            )
            session.add_all(
                [
                    AppConstructionObject1CGroup(
                        object_id=normalized_object_id,
                        group_ref=item["group_ref"],
                        group_name=item["group_name"],
                        created_by_user_id=actor_id,
                        created_at=now,
                    )
                    for item in normalized_groups
                ]
            )

            active_roles = {
                str(item.role_key): item
                for item in session.scalars(
                    select(AppConstructionObjectRoleAssignment).where(
                        AppConstructionObjectRoleAssignment.object_id == normalized_object_id,
                        AppConstructionObjectRoleAssignment.valid_to.is_(None),
                    )
                ).all()
            }
            pending_assignments: list[AppConstructionObjectRoleAssignment] = []
            for role_key in CONSTRUCTION_ROLE_KEYS:
                current = active_roles.get(role_key)
                candidate = normalized_roles[role_key]
                if current and candidate and str(current.employee_code).casefold() == candidate["employee_code"].casefold():
                    current.employee_name = candidate["full_name"]
                    current.employee_position = candidate["position"]
                    current.employee_department = candidate["department"]
                    current.employee_department_location = candidate["department_location"]
                    continue
                if current:
                    current.valid_to = now
                if candidate:
                    pending_assignments.append(
                        AppConstructionObjectRoleAssignment(
                            object_id=normalized_object_id,
                            role_key=role_key,
                            employee_code=candidate["employee_code"],
                            employee_name=candidate["full_name"],
                            employee_position=candidate["position"],
                            employee_department=candidate["department"],
                            employee_department_location=candidate["department_location"],
                            valid_from=now,
                            valid_to=None,
                            assigned_by_user_id=actor_id,
                            created_at=now,
                        )
                    )
            session.flush()
            session.add_all(pending_assignments)

        return self.get_object(normalized_object_id, include_history=True)


_default_service: ConstructionManagementService | None = None


def get_construction_management_service(
    database_url: str | None = None,
) -> ConstructionManagementService:
    global _default_service
    if database_url:
        return ConstructionManagementService(database_url=database_url)
    if _default_service is None:
        _default_service = ConstructionManagementService()
    return _default_service
