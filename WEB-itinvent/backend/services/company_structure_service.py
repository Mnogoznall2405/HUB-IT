"""Manual company org-structure (ZUP department codes for people lookup)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy import delete, select

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppOrgStructureDepartmentLink, AppOrgStructureNode
from backend.services.address_book_service import (
    address_book_service,
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
    ) -> dict[str, Any]:
        return {
            "id": str(row.id),
            "parent_id": str(row.parent_id) if row.parent_id else None,
            "node_type": _normalize_node_type(row.node_type),
            "title": normalize_text(row.title),
            "person_name": normalize_text(row.person_name),
            "person_position": normalize_text(row.person_position),
            "sort_order": int(row.sort_order or 0),
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
            by_parent: dict[str | None, list[AppOrgStructureNode]] = {}
            for row in rows:
                parent_key = str(row.parent_id) if row.parent_id else None
                by_parent.setdefault(parent_key, []).append(row)
            for children in by_parent.values():
                children.sort(key=lambda item: (int(item.sort_order or 0), normalize_text(item.title).casefold()))

            def build(node: AppOrgStructureNode) -> dict[str, Any]:
                child_rows = by_parent.get(str(node.id), [])
                return self._node_dict(
                    node,
                    department_codes=links.get(str(node.id), []),
                    children=[build(child) for child in child_rows],
                )

            roots = [build(node) for node in by_parent.get(None, [])]
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
        sort_order = int(payload.get("sort_order") or 0)
        department_codes = _normalize_codes(payload.get("department_codes"))

        with app_session(self._database_url) as session:
            self._seed_if_empty(session)
            if parent_id and not session.get(AppOrgStructureNode, parent_id):
                raise ValueError("Parent node not found")
            now = _utc_now()
            node_id = _new_node_id()
            row = AppOrgStructureNode(
                id=node_id,
                parent_id=parent_id,
                node_type=node_type,
                title=title,
                person_name=person_name,
                person_position=person_position,
                sort_order=sort_order,
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
            if "sort_order" in payload:
                row.sort_order = int(payload.get("sort_order") or 0)
            if "is_active" in payload:
                row.is_active = bool(payload.get("is_active"))
            now = _utc_now()
            if "department_codes" in payload:
                next_codes = _normalize_codes(payload.get("department_codes"))
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
            return {"ok": True, "id": normalized_id, "reparented_children": len(children)}

    def list_node_people(self, node_id: str, *, limit: int = 500) -> dict[str, Any]:
        node = self.get_node(node_id)
        if not node:
            raise ValueError("Node not found")
        codes = list(node.get("department_codes") or [])
        title = normalize_text(node.get("title"))
        node_type = normalize_text(node.get("node_type")).lower()
        people_by_code = address_book_service.list_people_by_department_codes(codes, limit=limit)
        # Org units (управление/отдел/служба…): match ZUP people by department name = node title.
        people_by_name: list[dict[str, Any]] = []
        if title and node_type not in {"deputy", "root", "block"}:
            people_by_name = address_book_service.list_people_by_department_names([title], limit=limit)

        merged: dict[str, dict[str, Any]] = {}
        for person in people_by_code + people_by_name:
            key = normalize_text(person.get("employee_code")) or normalize_text(person.get("full_name"))
            if not key or key in merged:
                continue
            merged[key] = person
        people = sorted(
            (_safe_person(person) for person in merged.values()),
            key=lambda item: normalize_text(item.get("full_name")).casefold(),
        )
        limited = max(1, min(int(limit or 500), 2000))
        people = people[:limited]
        return {
            "node": node,
            "department_codes": codes,
            "matched_by_title": bool(people_by_name),
            "items": people,
            "total": len(people),
        }

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
        return address_book_service.list_department_codes(query, limit=limit)

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
