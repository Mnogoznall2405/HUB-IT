"""Manual company org-structure (ZUP department codes for people lookup)."""
from __future__ import annotations

import io
import math
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import delete, select

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppOrgStructureDepartmentLink, AppOrgStructureNode
from backend.services.address_book_service import (
    address_book_service,
    build_department_label_resolver,
    normalize_search_text,
    normalize_text,
)


NODE_TYPES = {
    "root",
    "block",
    "deputy",
    "service",
    "directorate",
    "department",
    "group",
    "other",
}

NON_DEPARTMENT_NODE_TYPES = {"root", "block", "deputy"}
LEADER_CARD_NODE_TYPES = {"root", "deputy"}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _new_node_id() -> str:
    return f"org-{uuid.uuid4().hex[:20]}"


def _normalize_node_type(value: Any) -> str:
    normalized = normalize_text(value).lower()
    return normalized if normalized in NODE_TYPES else "other"


def _normalize_codes(codes: Iterable[Any] | None) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for raw in codes or []:
        code = normalize_text(raw)
        if not code or code in seen:
            continue
        seen.add(code)
        result.append(code)
    return result


def _normalize_layout_coordinate(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        normalized = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Layout coordinate must be a number") from exc
    if not math.isfinite(normalized) or normalized < 0 or normalized > 100_000:
        raise ValueError("Layout coordinate must be between 0 and 100000")
    return round(normalized, 2)


def _safe_contact_values(contacts: Iterable[Any] | None) -> list[str]:
    """Return contact values only; never pass address-book metadata through this API."""
    seen: set[str] = set()
    result: list[str] = []
    for contact in contacts or []:
        value = normalize_text(contact.get("value") if isinstance(contact, dict) else contact)
        key = value.casefold()
        if not value or key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def _safe_person(person: dict[str, Any]) -> dict[str, Any]:
    """Explicit allowlist: work contacts are public here, personal contacts are not."""
    return {
        "full_name": normalize_text(person.get("full_name")),
        "position": normalize_text(person.get("position")),
        "department": normalize_text(person.get("department")),
        "department_location": normalize_text(person.get("department_location")),
        "work_phones": _safe_contact_values(person.get("work_phones")),
        "work_emails": _safe_contact_values(person.get("work_emails")),
    }


def _person_identity(person: dict[str, Any]) -> str:
    employee_code = normalize_text(person.get("employee_code")).casefold()
    if employee_code:
        return f"employee:{employee_code}"
    full_name = normalize_search_text(person.get("full_name"))
    department_code = normalize_text(person.get("department_code")).casefold()
    return f"person:{full_name}|department:{department_code}" if full_name else ""


def _infer_node_type(department: str) -> str:
    normalized = normalize_search_text(department)
    if normalized.startswith(("управление", "департамент")):
        return "directorate"
    if normalized.startswith("отдел"):
        return "department"
    if normalized.startswith("служба"):
        return "service"
    if normalized.startswith(("группа", "сектор")):
        return "group"
    return "other"


class CompanyStructureService:
    def __init__(self, database_url: str | None = None) -> None:
        self._database_url = str(database_url or "").strip() or None
        if not (self._database_url or is_app_database_configured()):
            raise RuntimeError("APP_DATABASE_URL is required for company structure")
        initialize_app_schema(self._database_url)

    def _node_dict(
        self,
        row: AppOrgStructureNode,
        *,
        department_codes: list[str] | None = None,
        children: list[dict[str, Any]] | None = None,
        direct_people_count: int = 0,
        subtree_people_count: int = 0,
    ) -> dict[str, Any]:
        node_type = _normalize_node_type(row.node_type)
        supports_leader = node_type in LEADER_CARD_NODE_TYPES
        photo_updated_at = getattr(row, "person_photo_updated_at", None) if supports_leader else None
        photo_version = int(photo_updated_at.timestamp()) if photo_updated_at else None
        return {
            "id": str(row.id),
            "parent_id": str(row.parent_id) if row.parent_id else None,
            "node_type": node_type,
            "title": normalize_text(row.title),
            "person_name": normalize_text(row.person_name) if supports_leader else "",
            "person_position": normalize_text(row.person_position) if supports_leader else "",
            "person_employee_code": (
                normalize_text(getattr(row, "person_employee_code", None)) or None
                if supports_leader
                else None
            ),
            "person_photo_url": (
                f"/api/v1/company-structure/nodes/{row.id}/photo?v={photo_version}"
                if photo_version is not None
                else None
            ),
            "direct_people_count": max(0, int(direct_people_count or 0)),
            "subtree_people_count": max(0, int(subtree_people_count or 0)),
            "child_node_count": len(children or []),
            "sort_order": int(row.sort_order or 0),
            "layout_x": float(row.layout_x) if row.layout_x is not None else None,
            "layout_y": float(row.layout_y) if row.layout_y is not None else None,
            "is_active": bool(row.is_active),
            "department_codes": list(department_codes or []),
            "children": list(children or []),
            "created_at": row.created_at.isoformat() if row.created_at else "",
            "updated_at": row.updated_at.isoformat() if row.updated_at else "",
        }

    def _load_links_map(self, session) -> dict[str, list[str]]:
        rows = session.scalars(select(AppOrgStructureDepartmentLink)).all()
        mapping: dict[str, list[str]] = {}
        for row in rows:
            node_id = str(row.node_id)
            code = normalize_text(row.department_code)
            if not code:
                continue
            mapping.setdefault(node_id, []).append(code)
        for node_id, codes in mapping.items():
            mapping[node_id] = sorted(set(codes), key=str.casefold)
        return mapping

    def _direct_people_map(
        self,
        rows: Iterable[AppOrgStructureNode],
        links: dict[str, list[str]],
    ) -> dict[str, dict[str, dict[str, Any]]]:
        ordered_rows = sorted(
            rows,
            key=lambda row: (
                int(row.sort_order or 0),
                normalize_search_text(row.title),
                str(row.id),
            ),
        )
        code_to_node: dict[str, str] = {}
        legacy_title_to_node: dict[str, str] = {}
        for row in ordered_rows:
            node_id = str(row.id)
            codes = links.get(node_id, [])
            for code in codes:
                code_to_node.setdefault(normalize_text(code), node_id)
            node_type = _normalize_node_type(row.node_type)
            if not codes and node_type not in NON_DEPARTMENT_NODE_TYPES:
                legacy_title_to_node.setdefault(normalize_search_text(row.title), node_id)

        cache = address_book_service.load_cache()
        people = [item for item in cache.get("items") or [] if isinstance(item, dict)]
        resolve_department_label = build_department_label_resolver(people)
        result: dict[str, dict[str, dict[str, Any]]] = {}
        for person in people:
            node_id = code_to_node.get(normalize_text(person.get("department_code")))
            if not node_id:
                node_id = legacy_title_to_node.get(
                    normalize_search_text(resolve_department_label(person))
                )
            identity = _person_identity(person)
            if node_id and identity:
                result.setdefault(node_id, {}).setdefault(identity, person)
        return result

    def _direct_people_ids(
        self,
        rows: Iterable[AppOrgStructureNode],
        links: dict[str, list[str]],
    ) -> dict[str, set[str]]:
        return {
            node_id: set(people_by_id)
            for node_id, people_by_id in self._direct_people_map(rows, links).items()
        }

    @staticmethod
    def _photos_dir() -> Path:
        from backend.services.hub_service import hub_service

        path = Path(hub_service.data_dir) / "company_structure_photos"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @classmethod
    def _photo_path(cls, node_id: str) -> Path:
        safe_id = normalize_text(node_id)
        if not safe_id or Path(safe_id).name != safe_id:
            raise ValueError("Invalid node id")
        return cls._photos_dir() / f"{safe_id}.jpg"

    def _ensure_department_codes_available(
        self,
        session,
        codes: Iterable[Any] | None,
        *,
        exclude_node_id: str | None = None,
    ) -> None:
        normalized_codes = _normalize_codes(codes)
        if not normalized_codes:
            return
        query = select(AppOrgStructureDepartmentLink).where(
            AppOrgStructureDepartmentLink.department_code.in_(normalized_codes)
        )
        if exclude_node_id:
            query = query.where(AppOrgStructureDepartmentLink.node_id != exclude_node_id)
        links = session.scalars(query).all()
        if not links:
            return
        links_by_code = {normalize_text(link.department_code): link for link in links}
        conflict_code = next(code for code in normalized_codes if code in links_by_code)
        owner = session.get(AppOrgStructureNode, str(links_by_code[conflict_code].node_id))
        owner_title = normalize_text(owner.title) if owner else str(links_by_code[conflict_code].node_id)
        raise ValueError(f'Код ЗУП {conflict_code} уже привязан к карточке «{owner_title}»')

    def _seed_if_empty(self, session) -> None:
        existing = session.scalars(select(AppOrgStructureNode.id).limit(1)).first()
        if existing:
            return
        now = _utc_now()
        root_id = _new_node_id()
        build_id = _new_node_id()
        admin_id = _new_node_id()
        session.add_all(
            [
                AppOrgStructureNode(
                    id=root_id,
                    parent_id=None,
                    node_type="root",
                    title="Генеральный директор",
                    person_name="",
                    person_position="Генеральный директор",
                    sort_order=0,
                    is_active=True,
                    created_at=now,
                    updated_at=now,
                ),
                AppOrgStructureNode(
                    id=build_id,
                    parent_id=root_id,
                    node_type="block",
                    title="Строительный блок",
                    person_name="",
                    person_position="",
                    sort_order=0,
                    is_active=True,
                    created_at=now,
                    updated_at=now,
                ),
                AppOrgStructureNode(
                    id=admin_id,
                    parent_id=root_id,
                    node_type="block",
                    title="Административный блок",
                    person_name="",
                    person_position="",
                    sort_order=1,
                    is_active=True,
                    created_at=now,
                    updated_at=now,
                ),
            ]
        )
        session.flush()

    def get_tree(self, *, include_inactive: bool = False) -> dict[str, Any]:
        with app_session(self._database_url) as session:
            self._seed_if_empty(session)
            query = select(AppOrgStructureNode)
            if not include_inactive:
                query = query.where(AppOrgStructureNode.is_active.is_(True))
            rows = session.scalars(query).all()
            links = self._load_links_map(session)
            direct_people_ids = self._direct_people_ids(rows, links)
            by_parent: dict[str | None, list[AppOrgStructureNode]] = {}
            for row in rows:
                parent_key = str(row.parent_id) if row.parent_id else None
                by_parent.setdefault(parent_key, []).append(row)
            for children in by_parent.values():
                children.sort(key=lambda item: (int(item.sort_order or 0), normalize_text(item.title).casefold()))

            def build(node: AppOrgStructureNode) -> tuple[dict[str, Any], set[str]]:
                child_rows = by_parent.get(str(node.id), [])
                built_children = [build(child) for child in child_rows]
                direct_ids = set(direct_people_ids.get(str(node.id), set()))
                subtree_ids = set(direct_ids)
                for _, child_people_ids in built_children:
                    subtree_ids.update(child_people_ids)
                payload = self._node_dict(
                    node,
                    department_codes=links.get(str(node.id), []),
                    children=[child for child, _ in built_children],
                    direct_people_count=len(direct_ids),
                    subtree_people_count=len(subtree_ids),
                )
                return payload, subtree_ids

            roots = [build(node)[0] for node in by_parent.get(None, [])]
            return {"items": roots, "count": len(rows)}

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        normalized_id = normalize_text(node_id)
        if not normalized_id:
            return None
        with app_session(self._database_url) as session:
            row = session.get(AppOrgStructureNode, normalized_id)
            if not row:
                return None
            links = self._load_links_map(session)
            return self._node_dict(row, department_codes=links.get(normalized_id, []))

    def _would_create_cycle(self, session, node_id: str, parent_id: str | None) -> bool:
        if not parent_id:
            return False
        if parent_id == node_id:
            return True
        current = parent_id
        guard = 0
        while current and guard < 10_000:
            if current == node_id:
                return True
            parent_row = session.get(AppOrgStructureNode, current)
            if not parent_row:
                break
            current = str(parent_row.parent_id) if parent_row.parent_id else None
            guard += 1
        return False

    def create_node(self, payload: dict[str, Any]) -> dict[str, Any]:
        parent_id = normalize_text(payload.get("parent_id")) or None
        title = normalize_text(payload.get("title")) or "Новый узел"
        node_type = _normalize_node_type(payload.get("node_type"))
        person_name = normalize_text(payload.get("person_name"))
        person_position = normalize_text(payload.get("person_position"))
        person_employee_code = normalize_text(payload.get("person_employee_code")) or None
        if node_type not in LEADER_CARD_NODE_TYPES:
            person_name = ""
            person_position = ""
            person_employee_code = None
        sort_order = int(payload.get("sort_order") or 0)
        layout_x = _normalize_layout_coordinate(payload.get("layout_x"))
        layout_y = _normalize_layout_coordinate(payload.get("layout_y"))
        department_codes = _normalize_codes(payload.get("department_codes"))

        with app_session(self._database_url) as session:
            self._seed_if_empty(session)
            if parent_id and not session.get(AppOrgStructureNode, parent_id):
                raise ValueError("Parent node not found")
            self._ensure_department_codes_available(session, department_codes)
            now = _utc_now()
            node_id = _new_node_id()
            row = AppOrgStructureNode(
                id=node_id,
                parent_id=parent_id,
                node_type=node_type,
                title=title,
                person_name=person_name,
                person_position=person_position,
                person_employee_code=person_employee_code,
                sort_order=sort_order,
                layout_x=layout_x,
                layout_y=layout_y,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            for code in department_codes:
                session.add(
                    AppOrgStructureDepartmentLink(
                        node_id=node_id,
                        department_code=code,
                        created_at=now,
                    )
                )
            session.flush()
            return self._node_dict(row, department_codes=department_codes)

    def update_node(self, node_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        normalized_id = normalize_text(node_id)
        with app_session(self._database_url) as session:
            row = session.get(AppOrgStructureNode, normalized_id)
            if not row:
                raise ValueError("Node not found")
            if "parent_id" in payload:
                next_parent = normalize_text(payload.get("parent_id")) or None
                if next_parent and not session.get(AppOrgStructureNode, next_parent):
                    raise ValueError("Parent node not found")
                if self._would_create_cycle(session, normalized_id, next_parent):
                    raise ValueError("Cannot set parent: cycle detected")
                row.parent_id = next_parent
            if "title" in payload:
                row.title = normalize_text(payload.get("title")) or row.title
            if "node_type" in payload:
                row.node_type = _normalize_node_type(payload.get("node_type"))
            if "person_name" in payload:
                row.person_name = normalize_text(payload.get("person_name"))
            if "person_position" in payload:
                row.person_position = normalize_text(payload.get("person_position"))
            if "person_employee_code" in payload:
                row.person_employee_code = normalize_text(payload.get("person_employee_code")) or None
            if _normalize_node_type(row.node_type) not in LEADER_CARD_NODE_TYPES:
                row.person_name = ""
                row.person_position = ""
                row.person_employee_code = None
                row.person_photo_updated_at = None
            if "sort_order" in payload:
                row.sort_order = int(payload.get("sort_order") or 0)
            if "layout_x" in payload:
                row.layout_x = _normalize_layout_coordinate(payload.get("layout_x"))
            if "layout_y" in payload:
                row.layout_y = _normalize_layout_coordinate(payload.get("layout_y"))
            if "is_active" in payload:
                row.is_active = bool(payload.get("is_active"))
            now = _utc_now()
            if "department_codes" in payload:
                next_codes = _normalize_codes(payload.get("department_codes"))
                self._ensure_department_codes_available(
                    session,
                    next_codes,
                    exclude_node_id=normalized_id,
                )
                session.execute(
                    delete(AppOrgStructureDepartmentLink).where(
                        AppOrgStructureDepartmentLink.node_id == normalized_id
                    )
                )
                for code in next_codes:
                    session.add(
                        AppOrgStructureDepartmentLink(
                            node_id=normalized_id,
                            department_code=code,
                            created_at=now,
                        )
                    )
            row.updated_at = now
            session.flush()
            links = self._load_links_map(session)
            return self._node_dict(row, department_codes=links.get(normalized_id, []))

    def reset_layout_positions(self) -> dict[str, int]:
        with app_session(self._database_url) as session:
            rows = session.scalars(select(AppOrgStructureNode)).all()
            now = _utc_now()
            updated = 0
            for row in rows:
                if row.layout_x is None and row.layout_y is None:
                    continue
                row.layout_x = None
                row.layout_y = None
                row.updated_at = now
                updated += 1
            session.flush()
            return {"updated": updated}

    def move_node(self, node_id: str, *, parent_id: str | None, position: int) -> dict[str, Any]:
        """Move and reorder a node in one transaction, normalizing both sibling groups."""
        normalized_id = normalize_text(node_id)
        next_parent = normalize_text(parent_id) or None
        with app_session(self._database_url) as session:
            row = session.get(AppOrgStructureNode, normalized_id)
            if not row:
                raise ValueError("Node not found")
            if next_parent and not session.get(AppOrgStructureNode, next_parent):
                raise ValueError("Parent node not found")
            if self._would_create_cycle(session, normalized_id, next_parent):
                raise ValueError("Cannot set parent: cycle detected")

            previous_parent = str(row.parent_id) if row.parent_id else None

            def siblings(parent: str | None) -> list[AppOrgStructureNode]:
                query = select(AppOrgStructureNode).where(
                    AppOrgStructureNode.parent_id.is_(None)
                    if parent is None
                    else AppOrgStructureNode.parent_id == parent
                )
                values = [item for item in session.scalars(query).all() if str(item.id) != normalized_id]
                values.sort(
                    key=lambda item: (
                        int(item.sort_order or 0),
                        normalize_text(item.title).casefold(),
                    )
                )
                return values

            now = _utc_now()
            if previous_parent != next_parent:
                for index, sibling in enumerate(siblings(previous_parent)):
                    sibling.sort_order = index
                    sibling.updated_at = now

            target = siblings(next_parent)
            insert_at = max(0, min(int(position), len(target)))
            target.insert(insert_at, row)
            row.parent_id = next_parent
            for index, sibling in enumerate(target):
                sibling.sort_order = index
                sibling.updated_at = now
            session.flush()
            links = self._load_links_map(session)
            return self._node_dict(row, department_codes=links.get(normalized_id, []))

    def set_parent(
        self,
        node_id: str,
        *,
        parent_id: str | None,
        sort_order: int | None = None,
    ) -> dict[str, Any]:
        normalized_id = normalize_text(node_id)
        next_parent = normalize_text(parent_id) or None
        with app_session(self._database_url) as session:
            row = session.get(AppOrgStructureNode, normalized_id)
            if not row:
                raise ValueError("Node not found")
            if next_parent and not session.get(AppOrgStructureNode, next_parent):
                raise ValueError("Parent node not found")
            if self._would_create_cycle(session, normalized_id, next_parent):
                raise ValueError("Cannot set parent: cycle detected")
            row.parent_id = next_parent
            if sort_order is not None:
                row.sort_order = int(sort_order)
            row.updated_at = _utc_now()
            session.flush()
            links = self._load_links_map(session)
            return self._node_dict(row, department_codes=links.get(normalized_id, []))

    def set_department_codes(self, node_id: str, codes: Iterable[Any] | None) -> dict[str, Any]:
        normalized_id = normalize_text(node_id)
        next_codes = _normalize_codes(codes)
        with app_session(self._database_url) as session:
            row = session.get(AppOrgStructureNode, normalized_id)
            if not row:
                raise ValueError("Node not found")
            self._ensure_department_codes_available(
                session,
                next_codes,
                exclude_node_id=normalized_id,
            )
            session.execute(
                delete(AppOrgStructureDepartmentLink).where(
                    AppOrgStructureDepartmentLink.node_id == normalized_id
                )
            )
            now = _utc_now()
            for code in next_codes:
                session.add(
                    AppOrgStructureDepartmentLink(
                        node_id=normalized_id,
                        department_code=code,
                        created_at=now,
                    )
                )
            row.updated_at = now
            session.flush()
            return self._node_dict(row, department_codes=next_codes)

    def delete_node(self, node_id: str, *, force: bool = False) -> dict[str, Any]:
        normalized_id = normalize_text(node_id)
        with app_session(self._database_url) as session:
            row = session.get(AppOrgStructureNode, normalized_id)
            if not row:
                raise ValueError("Node not found")
            children = session.scalars(
                select(AppOrgStructureNode).where(AppOrgStructureNode.parent_id == normalized_id)
            ).all()
            if children and not force:
                raise ValueError("Node has children; pass force=true to reparent them")
            parent_id = str(row.parent_id) if row.parent_id else None
            for child in children:
                child.parent_id = parent_id
                child.updated_at = _utc_now()
            session.execute(
                delete(AppOrgStructureDepartmentLink).where(
                    AppOrgStructureDepartmentLink.node_id == normalized_id
                )
            )
            session.delete(row)
            session.flush()
            result = {"ok": True, "id": normalized_id, "reparented_children": len(children)}
        self._photo_path(normalized_id).unlink(missing_ok=True)
        return result

    def list_node_people(
        self,
        node_id: str,
        *,
        limit: int = 500,
        include_descendants: bool = False,
    ) -> dict[str, Any]:
        normalized_id = normalize_text(node_id)
        if not normalized_id:
            raise ValueError("Node not found")

        with app_session(self._database_url) as session:
            row = session.get(AppOrgStructureNode, normalized_id)
            if not row:
                raise ValueError("Node not found")
            rows = session.scalars(
                select(AppOrgStructureNode).where(AppOrgStructureNode.is_active.is_(True))
            ).all()
            links = self._load_links_map(session)
            node = self._node_dict(row, department_codes=links.get(normalized_id, []))

        rows_by_id = {str(item.id): item for item in rows}
        scope_ids = {normalized_id}
        if include_descendants:
            children_by_parent: dict[str, list[str]] = {}
            for item in rows:
                if item.parent_id:
                    children_by_parent.setdefault(str(item.parent_id), []).append(str(item.id))
            pending = list(children_by_parent.get(normalized_id, []))
            while pending:
                child_id = pending.pop()
                if child_id in scope_ids:
                    continue
                scope_ids.add(child_id)
                pending.extend(children_by_parent.get(child_id, []))

        people_by_node = self._direct_people_map(rows, links)
        merged: dict[str, dict[str, Any]] = {}
        for scope_id in scope_ids:
            merged.update(people_by_node.get(scope_id, {}))

        all_people = sorted(
            (_safe_person(person) for person in merged.values()),
            key=lambda item: normalize_text(item.get("full_name")).casefold(),
        )
        limited = max(1, min(int(limit or 500), 2000))
        matched_by_title = any(
            people_by_node.get(scope_id)
            and not links.get(scope_id)
            and _normalize_node_type(rows_by_id[scope_id].node_type) not in NON_DEPARTMENT_NODE_TYPES
            for scope_id in scope_ids
            if scope_id in rows_by_id
        )
        return {
            "node": node,
            "department_codes": list(node.get("department_codes") or []),
            "matched_by_title": matched_by_title,
            "items": all_people[:limited],
            "total": len(all_people),
        }

    def list_leader_candidates(self, query: str, *, limit: int = 30) -> dict[str, Any]:
        limited = max(1, min(int(limit or 30), 100))
        payload = address_book_service.search(
            normalize_text(query),
            limit=limited,
            include_age=False,
            include_personal_emails=False,
            include_personal_phones=False,
        )
        items: list[dict[str, str]] = []
        seen: set[str] = set()
        for person in payload.get("items") or []:
            employee_code = normalize_text(person.get("employee_code"))
            full_name = normalize_text(person.get("full_name"))
            if not employee_code or not full_name or employee_code in seen:
                continue
            seen.add(employee_code)
            items.append(
                {
                    "employee_code": employee_code,
                    "full_name": full_name,
                    "position": normalize_text(person.get("position")),
                    "department": normalize_text(person.get("department")),
                    "department_location": normalize_text(person.get("department_location")),
                }
            )
        return {"items": items, "total": len(items), "limit": limited}

    def save_node_photo(
        self,
        node_id: str,
        *,
        raw: bytes,
        content_type: str,
    ) -> dict[str, Any]:
        normalized_id = normalize_text(node_id)
        if not str(content_type or "").strip().lower().startswith("image/"):
            raise ValueError("Only image files are accepted")
        if not raw or len(raw) > 2 * 1024 * 1024:
            raise ValueError("Image must be between 1 byte and 2 MB")

        with app_session(self._database_url) as session:
            row = session.get(AppOrgStructureNode, normalized_id)
            if not row:
                raise ValueError("Node not found")
            if _normalize_node_type(row.node_type) not in LEADER_CARD_NODE_TYPES:
                raise ValueError("Leader photos are only available for root and deputy cards")

        from PIL import Image as PilImage

        photo_path = self._photo_path(normalized_id)
        temporary_path = photo_path.with_suffix(".tmp")
        try:
            with PilImage.open(io.BytesIO(raw)) as image:
                image.verify()
            with PilImage.open(io.BytesIO(raw)) as image:
                image = image.convert("RGB")
                width, height = image.size
                side = min(width, height)
                left = (width - side) // 2
                top = (height - side) // 2
                image = image.crop((left, top, left + side, top + side))
                image = image.resize((256, 256), PilImage.LANCZOS)
                image.save(str(temporary_path), format="JPEG", quality=88, optimize=True)
            os.replace(temporary_path, photo_path)
        except Exception as exc:
            temporary_path.unlink(missing_ok=True)
            raise ValueError("Invalid image file") from exc

        with app_session(self._database_url) as session:
            row = session.get(AppOrgStructureNode, normalized_id)
            if not row:
                photo_path.unlink(missing_ok=True)
                raise ValueError("Node not found")
            row.person_photo_updated_at = _utc_now()
            row.updated_at = _utc_now()
            session.flush()
            links = self._load_links_map(session)
            return self._node_dict(row, department_codes=links.get(normalized_id, []))

    def delete_node_photo(self, node_id: str) -> dict[str, Any]:
        normalized_id = normalize_text(node_id)
        with app_session(self._database_url) as session:
            row = session.get(AppOrgStructureNode, normalized_id)
            if not row:
                raise ValueError("Node not found")
            row.person_photo_updated_at = None
            row.updated_at = _utc_now()
            session.flush()
            links = self._load_links_map(session)
            payload = self._node_dict(row, department_codes=links.get(normalized_id, []))
        self._photo_path(normalized_id).unlink(missing_ok=True)
        return payload

    def get_node_photo_path(self, node_id: str) -> Path:
        normalized_id = normalize_text(node_id)
        with app_session(self._database_url) as session:
            row = session.get(AppOrgStructureNode, normalized_id)
            if not row or not row.person_photo_updated_at:
                raise ValueError("Photo not found")
        path = self._photo_path(normalized_id)
        if not path.is_file():
            raise ValueError("Photo not found")
        return path

    def search_directory(self, query: str, *, limit: int = 30) -> dict[str, Any]:
        """Search org nodes and safe employee fields, including work contacts only."""
        normalized_query = normalize_search_text(query)
        tokens = normalized_query.split()
        limited = max(1, min(int(limit or 30), 100))
        if not tokens:
            return {"items": [], "total": 0, "limit": limited}

        tree = self.get_tree()
        flat_nodes: list[dict[str, Any]] = []
        paths_by_node: dict[str, list[dict[str, str]]] = {}

        def visit(nodes: Iterable[dict[str, Any]], path: list[dict[str, str]]) -> None:
            for node in nodes:
                node_id = normalize_text(node.get("id"))
                title = normalize_text(node.get("title"))
                next_path = [*path, {"id": node_id, "title": title}]
                paths_by_node[node_id] = next_path
                flat_nodes.append(node)
                visit(node.get("children") or [], next_path)

        visit(tree.get("items") or [], [])
        code_to_node: dict[str, str] = {}
        title_to_node: dict[str, str] = {}
        for node in flat_nodes:
            node_id = normalize_text(node.get("id"))
            title_to_node.setdefault(normalize_search_text(node.get("title")), node_id)
            for code in node.get("department_codes") or []:
                code_to_node.setdefault(normalize_text(code), node_id)

        results: list[dict[str, Any]] = []
        for node in flat_nodes:
            haystack = normalize_search_text(
                " ".join(
                    [
                        normalize_text(node.get("title")),
                        normalize_text(node.get("person_name")),
                        normalize_text(node.get("person_position")),
                    ]
                )
            )
            if not all(token in haystack for token in tokens):
                continue
            node_id = normalize_text(node.get("id"))
            results.append(
                {
                    "kind": "node",
                    "node_id": node_id,
                    "title": normalize_text(node.get("title")),
                    "subtitle": normalize_text(node.get("person_name") or node.get("person_position")),
                    "department": normalize_text(node.get("title")),
                    "department_location": "",
                    "work_phones": [],
                    "work_emails": [],
                    "path": paths_by_node.get(node_id, []),
                }
            )

        cache = address_book_service.load_cache()
        for raw_person in cache.get("items") or []:
            if not isinstance(raw_person, dict):
                continue
            person = _safe_person(raw_person)
            searchable = normalize_search_text(
                " ".join(
                    [
                        person["full_name"],
                        person["position"],
                        person["department"],
                        person["department_location"],
                        *person["work_phones"],
                        *person["work_emails"],
                    ]
                )
            )
            if not all(token in searchable for token in tokens):
                continue
            node_id = code_to_node.get(normalize_text(raw_person.get("department_code")))
            if not node_id:
                node_id = title_to_node.get(normalize_search_text(person["department"]))
            results.append(
                {
                    "kind": "person",
                    "node_id": node_id,
                    "title": person["full_name"],
                    "subtitle": person["position"],
                    "department": person["department"],
                    "department_location": person["department_location"],
                    "work_phones": person["work_phones"],
                    "work_emails": person["work_emails"],
                    "path": paths_by_node.get(node_id or "", []),
                }
            )

        results.sort(
            key=lambda item: (
                0 if normalize_search_text(item.get("title")).startswith(normalized_query) else 1,
                0 if item.get("kind") == "node" else 1,
                normalize_search_text(item.get("title")),
            )
        )
        total = len(results)
        return {"items": results[:limited], "total": total, "limit": limited}

    def import_zup_departments(
        self,
        *,
        parent_id: str | None,
        departments: Iterable[str],
    ) -> dict[str, Any]:
        """Create selected exact ZUP departments as children of one hierarchy node."""
        next_parent = normalize_text(parent_id) or None
        requested = []
        seen: set[str] = set()
        for raw_name in departments or []:
            name = normalize_text(raw_name)
            key = normalize_search_text(name)
            if not name or key in seen:
                continue
            seen.add(key)
            requested.append((key, name))
        if not requested:
            raise ValueError("Select at least one ZUP department")

        catalog = address_book_service.list_department_names("", limit=2000)
        catalog_by_name = {
            normalize_search_text(item.get("department")): item
            for item in catalog.get("items") or []
            if normalize_text(item.get("department"))
        }

        with app_session(self._database_url) as session:
            self._seed_if_empty(session)
            if next_parent and not session.get(AppOrgStructureNode, next_parent):
                raise ValueError("Parent node not found")
            links = self._load_links_map(session)
            linked_codes = {code for codes in links.values() for code in codes}
            sibling_rows = session.scalars(
                select(AppOrgStructureNode).where(
                    AppOrgStructureNode.parent_id.is_(None)
                    if next_parent is None
                    else AppOrgStructureNode.parent_id == next_parent
                )
            ).all()
            sibling_titles = {normalize_search_text(item.title) for item in sibling_rows}
            next_order = max((int(item.sort_order or 0) for item in sibling_rows), default=-1) + 1
            now = _utc_now()
            created: list[dict[str, Any]] = []
            skipped: list[dict[str, str]] = []

            for key, requested_name in requested:
                meta = catalog_by_name.get(key)
                if not meta:
                    skipped.append({"department": requested_name, "reason": "not_found_in_zup"})
                    continue
                title = normalize_text(meta.get("department"))
                codes = _normalize_codes(meta.get("department_codes"))
                if key in sibling_titles or any(code in linked_codes for code in codes):
                    skipped.append({"department": title, "reason": "already_imported"})
                    continue

                node_id = _new_node_id()
                row = AppOrgStructureNode(
                    id=node_id,
                    parent_id=next_parent,
                    node_type=_infer_node_type(title),
                    title=title,
                    person_name="",
                    person_position="",
                    sort_order=next_order,
                    is_active=True,
                    created_at=now,
                    updated_at=now,
                )
                session.add(row)
                for code in codes:
                    session.add(
                        AppOrgStructureDepartmentLink(
                            node_id=node_id,
                            department_code=code,
                            created_at=now,
                        )
                    )
                session.flush()
                created.append(self._node_dict(row, department_codes=codes))
                sibling_titles.add(key)
                linked_codes.update(codes)
                next_order += 1

            return {"created": created, "skipped": skipped}

    def list_department_code_suggestions(self, query: str = "", limit: int = 50) -> dict[str, Any]:
        payload = address_book_service.list_department_codes(query, limit=limit)
        items = [dict(item) for item in payload.get("items") or [] if isinstance(item, dict)]
        with app_session(self._database_url) as session:
            links = session.scalars(select(AppOrgStructureDepartmentLink)).all()
            node_ids = {str(link.node_id) for link in links}
            nodes = {
                str(node.id): node
                for node in session.scalars(
                    select(AppOrgStructureNode).where(AppOrgStructureNode.id.in_(node_ids))
                ).all()
            } if node_ids else {}
        owners: dict[str, tuple[str, str]] = {}
        for link in links:
            code = normalize_text(link.department_code)
            node_id = str(link.node_id)
            node = nodes.get(node_id)
            owners.setdefault(code, (node_id, normalize_text(node.title) if node else node_id))
        for item in items:
            owner = owners.get(normalize_text(item.get("department_code")))
            item["linked_node_id"] = owner[0] if owner else None
            item["linked_node_title"] = owner[1] if owner else ""
        return {**payload, "items": items}

    def list_department_name_suggestions(self, query: str = "", limit: int = 50) -> dict[str, Any]:
        return address_book_service.list_department_names(query, limit=limit)


_default_service: CompanyStructureService | None = None


def get_company_structure_service(database_url: str | None = None) -> CompanyStructureService:
    global _default_service
    if database_url:
        return CompanyStructureService(database_url=database_url)
    if _default_service is None:
        _default_service = CompanyStructureService()
    return _default_service
