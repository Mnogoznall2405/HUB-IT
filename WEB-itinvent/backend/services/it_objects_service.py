"""IT objects: ITINVENT-backed objects with an assigned IT owner and per-section grants.

The object list itself lives in the objects SQL Server database (a branch is one object); this
service stores only who is responsible for an object and who else may open its sections.
"""
from __future__ import annotations

from datetime import datetime, timezone
import os
import threading
import time
from typing import Any, Callable
import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppItObject, AppItObjectAudit, AppItObjectGrant, AppItObjectOwner


SOURCE_TYPE_BRANCH = "itinvent_branch"
SECTIONS = ("passwords", "computers", "inventory")
LEVELS = ("view", "manage")
_LEVEL_RANK = {"view": 1, "manage": 2}
_SOURCE_CACHE_TTL_SEC = 60.0


class ItObjectError(Exception):
    """Business-rule failure; ``status`` is the HTTP status the router maps it to."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


class ItObjectSourceError(RuntimeError):
    """The objects database could not be read."""


def objects_database_id() -> str:
    return str(os.getenv("IT_OBJECTS_DB_ID") or "OBJ-ITINVENT").strip() or "OBJ-ITINVENT"


def _read_branches(db_id: str) -> list[dict[str, Any]]:
    from backend.database.equipment_directory_reads import get_all_branches

    return get_all_branches(db_id)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else None


def _text(value: Any, *, max_length: int = 255) -> str:
    return " ".join(str(value or "").strip().split())[:max_length]


def _person_name(user: dict[str, Any]) -> str:
    return _text(user.get("full_name") or user.get("username"))


class ItObjectsService:
    def __init__(
        self,
        database_url: str | None = None,
        *,
        source_db_id: str | None = None,
        branch_reader: Callable[[str], list[dict[str, Any]]] | None = None,
    ) -> None:
        self._database_url = str(database_url or "").strip() or None
        if not (self._database_url or is_app_database_configured()):
            raise RuntimeError("APP_DATABASE_URL is required for IT objects")
        initialize_app_schema(self._database_url)
        self._source_db_id = str(source_db_id or "").strip() or objects_database_id()
        self._branch_reader = branch_reader or _read_branches
        self._source_cache: tuple[float, list[dict[str, str]]] | None = None
        self._source_lock = threading.Lock()

    # ----- source (objects database) -----

    @property
    def source_db_id(self) -> str:
        return self._source_db_id

    def _source_objects(self) -> list[dict[str, str]]:
        with self._source_lock:
            cached = self._source_cache
            if cached is not None and cached[0] > time.monotonic():
                return cached[1]
        try:
            rows = self._branch_reader(self._source_db_id)
        except Exception as exc:  # noqa: BLE001 - any driver/config failure means "source unavailable"
            raise ItObjectSourceError("База объектов недоступна") from exc
        items: list[dict[str, str]] = []
        for row in rows or []:
            branch_no = row.get("id", row.get("BRANCH_NO"))
            if branch_no in (None, ""):
                continue
            name = _text(row.get("name", row.get("BRANCH_NAME"))) or f"Объект {branch_no}"
            items.append({"object_ref": f"{self._source_db_id}:{branch_no}", "branch_no": str(branch_no), "name": name})
        with self._source_lock:
            self._source_cache = (time.monotonic() + _SOURCE_CACHE_TTL_SEC, items)
        return items

    def _find_source_object(self, object_ref: str) -> dict[str, str]:
        ref = _text(object_ref, max_length=128)
        for item in self._source_objects():
            if item["object_ref"] == ref:
                return item
        raise ItObjectError("Объект не найден", 404)

    def source_binding(self, object_ref: str) -> dict[str, str]:
        """Where the object lives in ITINVENT: its database and branch number."""
        item = self._find_source_object(object_ref)
        return {"database_id": self._source_db_id, "branch_no": item["branch_no"], "name": item["name"]}

    # ----- reads -----

    @staticmethod
    def _sections_for(is_owner: bool, grants: list[AppItObjectGrant]) -> dict[str, str]:
        if is_owner:
            return {section: "manage" for section in SECTIONS}
        return {item.section: item.level for item in grants if item.section in SECTIONS}

    def list_objects(self, *, user_id: int, query: str = "", only_mine: bool = False, limit: int = 500) -> list[dict[str, Any]]:
        needle = _text(query).casefold()
        source = self._source_objects()
        with app_session(self._database_url) as session:
            registry = {
                row.source_ref: row
                for row in session.scalars(select(AppItObject).where(AppItObject.source_type == SOURCE_TYPE_BRANCH)).all()
            }
            owners = {
                row.object_id: row
                for row in session.scalars(select(AppItObjectOwner).where(AppItObjectOwner.valid_to.is_(None))).all()
            }
            my_grants: dict[str, list[AppItObjectGrant]] = {}
            for grant in session.scalars(
                select(AppItObjectGrant).where(
                    AppItObjectGrant.user_id == int(user_id), AppItObjectGrant.revoked_at.is_(None)
                )
            ).all():
                my_grants.setdefault(grant.object_id, []).append(grant)

            result: list[dict[str, Any]] = []
            for item in source:
                if needle and needle not in item["name"].casefold():
                    continue
                entry = registry.get(item["object_ref"])
                owner = owners.get(entry.id) if entry is not None else None
                is_owner = owner is not None and int(owner.user_id) == int(user_id)
                sections = self._sections_for(is_owner, my_grants.get(entry.id, []) if entry is not None else [])
                if only_mine and not sections:
                    continue
                result.append(
                    {
                        "object_ref": item["object_ref"],
                        "name": item["name"],
                        "owner": self._owner_dict(owner),
                        "my_access": {"is_owner": is_owner, "sections": sections},
                    }
                )
                if len(result) >= limit:
                    break
        return sorted(result, key=lambda row: (row["name"].casefold(), row["object_ref"]))

    @staticmethod
    def _owner_dict(owner: AppItObjectOwner | None) -> dict[str, Any] | None:
        if owner is None:
            return None
        return {"user_id": int(owner.user_id), "user_name": owner.user_name, "valid_from": _iso(owner.valid_from)}

    def get_object(self, object_ref: str, *, user_id: int, can_manage_owner: bool) -> dict[str, Any]:
        item = self._find_source_object(object_ref)
        with app_session(self._database_url) as session:
            entry = self._registry_row(session, item["object_ref"])
            owner = self._active_owner(session, entry.id) if entry is not None else None
            is_owner = owner is not None and int(owner.user_id) == int(user_id)
            grants = (
                session.scalars(
                    select(AppItObjectGrant)
                    .where(AppItObjectGrant.object_id == entry.id, AppItObjectGrant.revoked_at.is_(None))
                    .order_by(AppItObjectGrant.user_name, AppItObjectGrant.section)
                ).all()
                if entry is not None
                else []
            )
            my_grants = [grant for grant in grants if int(grant.user_id) == int(user_id)]
            can_manage_grants = bool(can_manage_owner or is_owner)
            return {
                "object_ref": item["object_ref"],
                "name": item["name"],
                "source_db_id": self._source_db_id,
                "owner": self._owner_dict(owner),
                "my_access": {"is_owner": is_owner, "sections": self._sections_for(is_owner, my_grants)},
                "can_manage_owner": bool(can_manage_owner),
                "can_manage_grants": can_manage_grants,
                "grants": [self._grant_dict(grant) for grant in grants] if can_manage_grants else [],
            }

    @staticmethod
    def _grant_dict(grant: AppItObjectGrant) -> dict[str, Any]:
        return {
            "user_id": int(grant.user_id),
            "user_name": grant.user_name,
            "section": grant.section,
            "level": grant.level,
            "created_at": _iso(grant.created_at),
        }

    def can_access(self, object_ref: str, *, user_id: int, section: str, level: str = "view") -> bool:
        """Authoritative check for section endpoints: IT owner always, otherwise an active grant."""
        if section not in SECTIONS or level not in _LEVEL_RANK:
            return False
        with app_session(self._database_url) as session:
            entry = self._registry_row(session, _text(object_ref, max_length=128))
            if entry is None:
                return False
            owner = self._active_owner(session, entry.id)
            if owner is not None and int(owner.user_id) == int(user_id):
                return True
            grant = session.scalar(
                select(AppItObjectGrant).where(
                    AppItObjectGrant.object_id == entry.id,
                    AppItObjectGrant.user_id == int(user_id),
                    AppItObjectGrant.section == section,
                    AppItObjectGrant.revoked_at.is_(None),
                )
            )
            return grant is not None and _LEVEL_RANK[grant.level] >= _LEVEL_RANK[level]

    def accessible_object_refs(self, *, user_id: int, section: str, level: str = "view") -> set[str]:
        """Objects whose ``section`` the user may open: the IT owner's objects plus active grants."""
        if section not in SECTIONS or level not in _LEVEL_RANK:
            return set()
        with app_session(self._database_url) as session:
            refs = set(
                session.scalars(
                    select(AppItObject.source_ref)
                    .join(AppItObjectOwner, AppItObjectOwner.object_id == AppItObject.id)
                    .where(AppItObjectOwner.user_id == int(user_id), AppItObjectOwner.valid_to.is_(None))
                ).all()
            )
            granted = session.execute(
                select(AppItObject.source_ref, AppItObjectGrant.level)
                .join(AppItObjectGrant, AppItObjectGrant.object_id == AppItObject.id)
                .where(
                    AppItObjectGrant.user_id == int(user_id),
                    AppItObjectGrant.section == section,
                    AppItObjectGrant.revoked_at.is_(None),
                )
            ).all()
            refs.update(ref for ref, grant_level in granted if _LEVEL_RANK.get(grant_level, 0) >= _LEVEL_RANK[level])
        return refs

    def object_names(self, object_refs: set[str] | list[str]) -> dict[str, str]:
        refs = sorted({str(ref) for ref in object_refs if ref})
        if not refs:
            return {}
        with app_session(self._database_url) as session:
            rows = session.execute(
                select(AppItObject.source_ref, AppItObject.name).where(AppItObject.source_ref.in_(refs))
            ).all()
        return {ref: name for ref, name in rows}

    # ----- writes -----

    @staticmethod
    def _registry_row(session, object_ref: str, *, for_update: bool = False) -> AppItObject | None:
        query = select(AppItObject).where(
            AppItObject.source_type == SOURCE_TYPE_BRANCH, AppItObject.source_ref == object_ref
        )
        if for_update:
            query = query.with_for_update()
        return session.scalar(query)

    @staticmethod
    def _active_owner(session, object_id: str) -> AppItObjectOwner | None:
        return session.scalar(
            select(AppItObjectOwner).where(AppItObjectOwner.object_id == object_id, AppItObjectOwner.valid_to.is_(None))
        )

    def _ensure_registry(self, session, item: dict[str, str]) -> AppItObject:
        entry = self._registry_row(session, item["object_ref"], for_update=True)
        now = _utc_now()
        if entry is None:
            entry = AppItObject(
                id=f"it-{uuid.uuid4().hex[:20]}",
                source_type=SOURCE_TYPE_BRANCH,
                source_ref=item["object_ref"],
                name=item["name"],
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            session.add(entry)
            session.flush()
        elif entry.name != item["name"]:
            entry.name = item["name"]
            entry.updated_at = now
        return entry

    @staticmethod
    def _audit(
        session,
        *,
        object_id: str,
        action: str,
        actor_id: int,
        target_id: int | None = None,
        section: str | None = None,
        level: str | None = None,
    ) -> None:
        session.add(
            AppItObjectAudit(
                object_id=object_id,
                action=action,
                actor_user_id=actor_id,
                target_user_id=target_id,
                section=section,
                level=level,
                created_at=_utc_now(),
            )
        )

    @staticmethod
    def _retry_once(operation: Callable[[], Any]) -> Any:
        # The unique indexes (registry source, active owner, active grant) turn a lost race into
        # IntegrityError; the retry then sees the winner's row and resolves it deterministically.
        try:
            return operation()
        except IntegrityError:
            return operation()

    def assign_owner(self, object_ref: str, *, target: dict[str, Any], actor_id: int) -> dict[str, Any]:
        target_id = int(target.get("id") or 0)
        if target_id <= 0 or not bool(target.get("is_active", True)):
            raise ItObjectError("Пользователь не найден или отключён", 400)
        if target_id == int(actor_id):
            raise ItObjectError("Нельзя назначить айтишником самого себя", 403)
        item = self._find_source_object(object_ref)

        def _write() -> None:
            with app_session(self._database_url) as session:
                entry = self._ensure_registry(session, item)
                current = self._active_owner(session, entry.id)
                if current is not None and int(current.user_id) == target_id:
                    return
                now = _utc_now()
                if current is not None:
                    current.valid_to = now
                    session.flush()
                session.add(
                    AppItObjectOwner(
                        object_id=entry.id,
                        user_id=target_id,
                        user_name=_person_name(target),
                        valid_from=now,
                        assigned_by_user_id=int(actor_id),
                    )
                )
                self._audit(session, object_id=entry.id, action="owner_assigned", actor_id=int(actor_id), target_id=target_id)

        self._retry_once(_write)
        return {"object_ref": item["object_ref"]}

    def clear_owner(self, object_ref: str, *, actor_id: int) -> dict[str, Any]:
        item = self._find_source_object(object_ref)
        with app_session(self._database_url) as session:
            entry = self._registry_row(session, item["object_ref"], for_update=True)
            current = self._active_owner(session, entry.id) if entry is not None else None
            if current is None:
                return {"object_ref": item["object_ref"]}
            current.valid_to = _utc_now()
            self._audit(
                session, object_id=entry.id, action="owner_cleared", actor_id=int(actor_id), target_id=int(current.user_id)
            )
        return {"object_ref": item["object_ref"]}

    def _require_grant_manager(self, session, entry: AppItObject | None, *, actor_id: int, can_manage_owner: bool) -> None:
        if can_manage_owner:
            return
        owner = self._active_owner(session, entry.id) if entry is not None else None
        if owner is None or int(owner.user_id) != int(actor_id):
            raise ItObjectError("Выдавать доступ может администратор или айтишник этого объекта", 403)

    def grant(
        self,
        object_ref: str,
        *,
        target: dict[str, Any],
        section: str,
        level: str,
        actor_id: int,
        can_manage_owner: bool,
    ) -> dict[str, Any]:
        if section not in SECTIONS:
            raise ItObjectError("Неизвестный раздел", 400)
        if level not in _LEVEL_RANK:
            raise ItObjectError("Неизвестный уровень доступа", 400)
        target_id = int(target.get("id") or 0)
        if target_id <= 0 or not bool(target.get("is_active", True)):
            raise ItObjectError("Пользователь не найден или отключён", 400)
        if target_id == int(actor_id):
            raise ItObjectError("Нельзя выдать доступ самому себе", 403)
        item = self._find_source_object(object_ref)

        def _write() -> None:
            with app_session(self._database_url) as session:
                entry = self._registry_row(session, item["object_ref"], for_update=True)
                self._require_grant_manager(session, entry, actor_id=actor_id, can_manage_owner=can_manage_owner)
                entry = self._ensure_registry(session, item)
                existing = session.scalar(
                    select(AppItObjectGrant).where(
                        AppItObjectGrant.object_id == entry.id,
                        AppItObjectGrant.user_id == target_id,
                        AppItObjectGrant.section == section,
                        AppItObjectGrant.revoked_at.is_(None),
                    )
                )
                if existing is not None:
                    if existing.level == level:
                        return
                    existing.level = level
                    existing.granted_by_user_id = int(actor_id)
                else:
                    session.add(
                        AppItObjectGrant(
                            object_id=entry.id,
                            user_id=target_id,
                            user_name=_person_name(target),
                            section=section,
                            level=level,
                            granted_by_user_id=int(actor_id),
                            created_at=_utc_now(),
                        )
                    )
                self._audit(
                    session,
                    object_id=entry.id,
                    action="grant_set",
                    actor_id=int(actor_id),
                    target_id=target_id,
                    section=section,
                    level=level,
                )

        self._retry_once(_write)
        return {"object_ref": item["object_ref"]}

    def revoke(
        self,
        object_ref: str,
        *,
        target_user_id: int,
        section: str,
        actor_id: int,
        can_manage_owner: bool,
    ) -> dict[str, Any]:
        if section not in SECTIONS:
            raise ItObjectError("Неизвестный раздел", 400)
        item = self._find_source_object(object_ref)
        with app_session(self._database_url) as session:
            entry = self._registry_row(session, item["object_ref"], for_update=True)
            self._require_grant_manager(session, entry, actor_id=actor_id, can_manage_owner=can_manage_owner)
            if entry is None:
                return {"object_ref": item["object_ref"]}
            grant = session.scalar(
                select(AppItObjectGrant).where(
                    AppItObjectGrant.object_id == entry.id,
                    AppItObjectGrant.user_id == int(target_user_id),
                    AppItObjectGrant.section == section,
                    AppItObjectGrant.revoked_at.is_(None),
                )
            )
            if grant is None:
                return {"object_ref": item["object_ref"]}
            grant.revoked_at = _utc_now()
            grant.revoked_by_user_id = int(actor_id)
            self._audit(
                session,
                object_id=entry.id,
                action="grant_revoked",
                actor_id=int(actor_id),
                target_id=int(target_user_id),
                section=section,
                level=grant.level,
            )
        return {"object_ref": item["object_ref"]}

_default_service: ItObjectsService | None = None
_default_lock = threading.Lock()


def get_it_objects_service(database_url: str | None = None) -> ItObjectsService:
    global _default_service
    if database_url:
        return ItObjectsService(database_url=database_url)
    with _default_lock:
        if _default_service is None:
            _default_service = ItObjectsService()
        return _default_service
