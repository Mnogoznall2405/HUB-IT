"""Shared libraries ("Общие папки") of My Files: created by administrators, used by whole departments.

A library owns its files and folders under a negative ``owner_user_id`` (see ``MyFilesService.may_act_locked``),
so nothing in it counts against a person's quota or expires. Members are portal users or departments with a
role (``view`` / ``comment`` / ``edit`` / ``manage``); department membership is read live.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from backend.appdb.db import app_session
from backend.appdb.models import (
    AppDepartment,
    AppDepartmentMembership,
    AppMyFile,
    AppMyFileFolder,
    AppMyFileLibrary,
    AppMyFileLibraryMember,
    AppUser,
)
from backend.services.my_files_service import (
    _LIBRARY_ROLE_RANK,
    STATUS_DELETED,
    STATUS_READY,
    MyFilesNotFoundError,
    MyFilesRequestMeta,
    MyFilesValidationError,
    _actor_id,
    _coerce_utc,
    _normalize_text,
    _utc_now,
    my_files_service,
)


logger = logging.getLogger("backend.services.my_files_library_service")

MAX_LIBRARY_MEMBERS = 200
MAX_LIBRARIES = 200
INVITE_EVENT_TYPE = "my_files.library_invited"
INVITE_ENTITY_TYPE = "my_file_library"
ROLE_LABELS = {"manage": "управление", "edit": "правка", "comment": "комментарии", "view": "просмотр"}
_PRINCIPAL_TYPES = ("user", "department")
_INVALID_NAME_CHARS = '<>:"/\\|?*'
# Notifying a whole department at once would flood people; the library shows up in their section anyway.
_MAX_NOTIFIED = 200


def _notify_invited(user_id: int, *, library_id: str, library_name: str, owner_label: str, role: str) -> None:
    """Best effort: the access is already stored, a failed notification must not undo it."""
    try:
        from backend.services.hub_service import hub_service

        hub_service.create_user_notification(
            recipient_user_id=int(user_id),
            event_type=INVITE_EVENT_TYPE,
            title=f"Вам открыта общая папка ({ROLE_LABELS.get(role, role)})",
            body=f"{owner_label or 'Администратор'} открыл(а) вам общую папку «{library_name}»"[:300],
            entity_type=INVITE_ENTITY_TYPE,
            entity_id=library_id,
        )
    except Exception:
        logger.warning("library.invite_notification_failed user_id=%s library_id=%s", user_id, library_id, exc_info=True)


def _clean_name(value: Any) -> str:
    name = _normalize_text(value)[:255]
    if not name:
        raise MyFilesValidationError("Library name is required")
    if any(ch in name for ch in _INVALID_NAME_CHARS) or name in {".", ".."}:
        raise MyFilesValidationError("Library name contains invalid characters")
    return name


def _clean_quota(value: Any) -> int:
    try:
        quota = int(value or 0)
    except (TypeError, ValueError) as exc:
        raise MyFilesValidationError("Quota must be a number of bytes") from exc
    if quota < 0:
        raise MyFilesValidationError("Quota must not be negative")
    return quota


class MyFilesLibraryService:
    def __init__(self, files=None) -> None:
        self.files = files or my_files_service

    # -- helpers ----------------------------------------------------------------------------

    def _session_ready(self, session) -> None:
        if not self.files._libraries_present(session):
            raise MyFilesValidationError("Shared libraries are not available yet")

    @staticmethod
    def _live_library_locked(session, library_id: str) -> AppMyFileLibrary:
        library = session.get(AppMyFileLibrary, _normalize_text(library_id))
        if library is None or library.deleted_at is not None:
            raise MyFilesNotFoundError("Library not found")
        return library

    def _stats_locked(self, session, library: AppMyFileLibrary) -> tuple[int, int]:
        """(files, used bytes) of live files in the library."""
        files_count = int(
            session.scalar(
                select(func.count(AppMyFile.id)).where(
                    AppMyFile.owner_user_id == library.owner_user_id,
                    AppMyFile.deleted_at.is_(None),
                    AppMyFile.status == STATUS_READY,
                )
            )
            or 0
        )
        return files_count, self.files._quota_used_locked(session, library.owner_user_id)

    def _response(self, session, library: AppMyFileLibrary, *, role: str = "") -> dict[str, Any]:
        files_count, used_bytes = self._stats_locked(session, library)
        members_count = int(
            session.scalar(
                select(func.count()).select_from(AppMyFileLibraryMember).where(
                    AppMyFileLibraryMember.library_id == library.id
                )
            )
            or 0
        )
        return {
            "id": library.id,
            "name": _normalize_text(library.name),
            "quota_bytes": int(library.quota_bytes or 0),
            "used_bytes": used_bytes,
            "files_count": files_count,
            "members_count": members_count,
            "my_role": role,
            "created_at": _coerce_utc(library.created_at),
            "updated_at": _coerce_utc(library.updated_at),
        }

    def _assert_name_free_locked(self, session, name: str, exclude_id: str = "") -> None:
        for library_id, other in session.execute(
            select(AppMyFileLibrary.id, AppMyFileLibrary.name).where(AppMyFileLibrary.deleted_at.is_(None))
        ).all():
            if library_id != exclude_id and _normalize_text(other).casefold() == name.casefold():
                raise MyFilesValidationError("Library with this name already exists")

    # -- listing ----------------------------------------------------------------------------

    def list_for_user(self, *, user_id: int, is_admin: bool = False) -> list[dict[str, Any]]:
        """Libraries the user belongs to; administrators also see the rest (with an empty role)."""
        database_url = self.files._database_url_or_raise()
        with app_session(database_url) as session:
            if not self.files._libraries_present(session):
                return []
            result: list[dict[str, Any]] = []
            libraries = session.scalars(
                select(AppMyFileLibrary).where(AppMyFileLibrary.deleted_at.is_(None)).order_by(AppMyFileLibrary.name.asc())
            ).all()
            for library in libraries:
                role = self.files.library_role_locked(session, library, user_id)
                if role or is_admin:
                    result.append(self._response(session, library, role=role))
            return result

    # -- administration ---------------------------------------------------------------------

    def create_library(
        self,
        *,
        actor: Any,
        name: str,
        quota_bytes: int = 0,
        meta: MyFilesRequestMeta | None = None,
    ) -> dict[str, Any]:
        actor_id = _actor_id(actor)
        if actor_id <= 0:
            raise MyFilesValidationError("Authenticated user is required")
        safe_name = _clean_name(name)
        quota = _clean_quota(quota_bytes)
        database_url = self.files._database_url_or_raise()
        for attempt in range(3):
            try:
                with app_session(database_url) as session:
                    self._session_ready(session)
                    live = int(
                        session.scalar(
                            select(func.count(AppMyFileLibrary.id)).where(AppMyFileLibrary.deleted_at.is_(None))
                        )
                        or 0
                    )
                    if live >= MAX_LIBRARIES:
                        raise MyFilesValidationError("Too many shared libraries")
                    self._assert_name_free_locked(session, safe_name)
                    # Owners are -1, -2, ...; ids of deleted libraries stay reserved so old rows never mix.
                    lowest = session.scalar(select(func.min(AppMyFileLibrary.owner_user_id)))
                    owner_user_id = min(-1, int(lowest or 0) - 1) if lowest is not None else -1
                    now = _utc_now()
                    library = AppMyFileLibrary(
                        id=uuid.uuid4().hex,
                        name=safe_name,
                        owner_user_id=owner_user_id,
                        quota_bytes=quota,
                        created_by_user_id=actor_id,
                        created_at=now,
                        updated_at=now,
                    )
                    session.add(library)
                    session.add(
                        AppMyFileLibraryMember(
                            library_id=library.id,
                            principal_type="user",
                            principal_id=str(actor_id),
                            role="manage",
                            added_by_user_id=actor_id,
                            created_at=now,
                        )
                    )
                    session.flush()
                    self.files._write_audit(
                        session,
                        action="library_created",
                        row=None,
                        actor=actor,
                        meta=meta,
                        details=f"Общая папка «{safe_name}»" + (f", лимит {quota} байт" if quota else ", без лимита"),
                    )
                    return self._response(session, library, role="manage")
            except IntegrityError:
                # Two administrators created a library at once and picked the same owner id.
                if attempt == 2:
                    raise MyFilesValidationError("Could not create the library, try again") from None
        raise MyFilesValidationError("Could not create the library, try again")

    def update_library(
        self,
        *,
        library_id: str,
        actor: Any,
        name: Any = None,
        quota_bytes: Any = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> dict[str, Any]:
        database_url = self.files._database_url_or_raise()
        with app_session(database_url) as session:
            self._session_ready(session)
            library = self._live_library_locked(session, library_id)
            changes = []
            if name is not None:
                safe_name = _clean_name(name)
                if safe_name != _normalize_text(library.name):
                    self._assert_name_free_locked(session, safe_name, exclude_id=library.id)
                    changes.append(f"Название: «{_normalize_text(library.name)}» → «{safe_name}»")
                    library.name = safe_name
            if quota_bytes is not None:
                quota = _clean_quota(quota_bytes)
                used = self.files._quota_used_locked(session, library.owner_user_id)
                if quota and quota < used:
                    raise MyFilesValidationError("Quota is below the space already used")
                if quota != int(library.quota_bytes or 0):
                    changes.append(f"Лимит: {quota} байт" if quota else "Лимит снят")
                    library.quota_bytes = quota
            if changes:
                library.updated_at = _utc_now()
                self.files._write_audit(
                    session,
                    action="library_updated",
                    row=None,
                    actor=actor,
                    meta=meta,
                    details="; ".join(changes),
                )
            role = self.files.library_role_locked(session, library, _actor_id(actor))
            return self._response(session, library, role=role)

    def delete_library(
        self,
        *,
        library_id: str,
        actor: Any,
        meta: MyFilesRequestMeta | None = None,
    ) -> None:
        """Only an empty library goes away: content must be removed (and the trash emptied) first."""
        database_url = self.files._database_url_or_raise()
        with app_session(database_url) as session:
            self._session_ready(session)
            library = self._live_library_locked(session, library_id)
            owner = library.owner_user_id
            files_left = int(
                session.scalar(
                    select(func.count(AppMyFile.id)).where(
                        AppMyFile.owner_user_id == owner, AppMyFile.status != STATUS_DELETED
                    )
                )
                or 0
            )
            folders_left = int(
                session.scalar(select(func.count(AppMyFileFolder.id)).where(AppMyFileFolder.owner_user_id == owner))
                or 0
            )
            if files_left or folders_left:
                raise MyFilesValidationError("Library is not empty: delete its files and empty its trash first")
            session.execute(delete(AppMyFileLibraryMember).where(AppMyFileLibraryMember.library_id == library.id))
            library.deleted_at = _utc_now()
            library.updated_at = library.deleted_at
            self.files._write_audit(
                session,
                action="library_deleted",
                row=None,
                actor=actor,
                meta=meta,
                details=f"Общая папка «{_normalize_text(library.name)}»",
            )

    # -- members ----------------------------------------------------------------------------

    @staticmethod
    def _members_locked(session, library_id: str) -> list[dict[str, Any]]:
        members = session.scalars(
            select(AppMyFileLibraryMember).where(AppMyFileLibraryMember.library_id == library_id)
        ).all()
        user_ids = [int(m.principal_id) for m in members if m.principal_type == "user" and m.principal_id.isdigit()]
        department_ids = [m.principal_id for m in members if m.principal_type == "department"]
        users = {
            int(uid): (_normalize_text(username), _normalize_text(full_name))
            for uid, username, full_name in session.execute(
                select(AppUser.id, AppUser.username, AppUser.full_name).where(AppUser.id.in_(user_ids or [0]))
            ).all()
        }
        departments = {
            _normalize_text(did): _normalize_text(name)
            for did, name in session.execute(
                select(AppDepartment.id, AppDepartment.name).where(AppDepartment.id.in_(department_ids or [""]))
            ).all()
        }
        counts = {
            _normalize_text(did): int(count)
            for did, count in session.execute(
                select(AppDepartmentMembership.department_id, func.count(func.distinct(AppDepartmentMembership.user_id)))
                .where(
                    AppDepartmentMembership.department_id.in_(department_ids or [""]),
                    AppDepartmentMembership.is_active.is_(True),
                )
                .group_by(AppDepartmentMembership.department_id)
            ).all()
        }
        items = []
        for member in members:
            if member.principal_type == "user":
                username, full_name = users.get(int(member.principal_id), (f"user-{member.principal_id}", "")) if member.principal_id.isdigit() else ("", "")
                label = f"{full_name} ({username})" if full_name and full_name != username else username
                members_count = 0
            else:
                label = departments.get(member.principal_id, member.principal_id)
                members_count = counts.get(member.principal_id, 0)
            items.append(
                {
                    "principal_type": member.principal_type,
                    "principal_id": member.principal_id,
                    "name": label,
                    "role": MyFilesLibraryService._role(member.role),
                    "members_count": members_count,
                }
            )
        items.sort(key=lambda item: (item["principal_type"] != "department", item["name"].casefold()))
        return items

    @staticmethod
    def _role(value: Any) -> str:
        role = _normalize_text(value).lower()
        if role not in _LIBRARY_ROLE_RANK:
            raise MyFilesValidationError("Unknown role")
        return role

    def list_members(self, *, library_id: str) -> list[dict[str, Any]]:
        database_url = self.files._database_url_or_raise()
        with app_session(database_url) as session:
            self._session_ready(session)
            library = self._live_library_locked(session, library_id)
            return self._members_locked(session, library.id)

    def set_members(
        self,
        *,
        library_id: str,
        members: list[tuple[str, str, str]],
        actor: Any = None,
        meta: MyFilesRequestMeta | None = None,
    ) -> list[dict[str, Any]]:
        """Replace the member list: ``members`` are ``(principal_type, principal_id, role)``; the last entry of a principal wins."""
        wanted: dict[tuple[str, str], str] = {}
        for principal_type, principal_id, role in members:
            kind = _normalize_text(principal_type).lower()
            pid = _normalize_text(principal_id)
            if kind not in _PRINCIPAL_TYPES or not pid:
                raise MyFilesValidationError("Unknown member")
            if kind == "user" and not pid.isdigit():
                raise MyFilesValidationError("Unknown member")
            wanted[(kind, pid)] = self._role(role)
        if len(wanted) > MAX_LIBRARY_MEMBERS:
            raise MyFilesValidationError(f"At most {MAX_LIBRARY_MEMBERS} members are allowed")
        if wanted and "manage" not in wanted.values():
            raise MyFilesValidationError("At least one manager is required")
        if not wanted:
            raise MyFilesValidationError("At least one manager is required")
        database_url = self.files._database_url_or_raise()
        with app_session(database_url) as session:
            self._session_ready(session)
            library = self._live_library_locked(session, library_id)
            user_ids = [int(pid) for kind, pid in wanted if kind == "user"]
            if user_ids:
                active = set(
                    session.scalars(select(AppUser.id).where(AppUser.id.in_(user_ids), AppUser.is_active.is_(True))).all()
                )
                if active != set(user_ids):
                    raise MyFilesValidationError("Unknown or inactive user")
            department_ids = [pid for kind, pid in wanted if kind == "department"]
            if department_ids:
                known = set(
                    session.scalars(
                        select(AppDepartment.id).where(
                            AppDepartment.id.in_(department_ids), AppDepartment.is_active.is_(True)
                        )
                    ).all()
                )
                if known != set(department_ids):
                    raise MyFilesValidationError("Unknown department")
            before = {
                (m["principal_type"], m["principal_id"]): m
                for m in self._members_locked(session, library.id)
            }
            current = {
                (m.principal_type, m.principal_id): m
                for m in session.scalars(
                    select(AppMyFileLibraryMember).where(AppMyFileLibraryMember.library_id == library.id)
                ).all()
            }
            removed = [key for key in current if key not in wanted]
            for kind, pid in removed:
                session.delete(current[(kind, pid)])
            added = [key for key in wanted if key not in current]
            changed = [key for key, row in current.items() if key in wanted and row.role != wanted[key]]
            for key in changed:
                current[key].role = wanted[key]
            now = _utc_now()
            for kind, pid in added:
                session.add(
                    AppMyFileLibraryMember(
                        library_id=library.id,
                        principal_type=kind,
                        principal_id=pid,
                        role=wanted[(kind, pid)],
                        added_by_user_id=_actor_id(actor),
                        created_at=now,
                    )
                )
            session.flush()
            result = self._members_locked(session, library.id)
            names = {(m["principal_type"], m["principal_id"]): m["name"] for m in result}
            names.update({key: item["name"] for key, item in before.items() if key not in names})
            library_name = _normalize_text(library.name)
            library_pk = library.id
            if removed or added or changed:
                parts = []
                for role in ("manage", "edit", "comment", "view"):
                    label = ", ".join(sorted(names[key] for key in added if wanted[key] == role))
                    if label:
                        parts.append(f"Добавлены ({ROLE_LABELS[role]}): {label}")
                for role in ("manage", "edit", "comment", "view"):
                    label = ", ".join(sorted(names[key] for key in changed if wanted[key] == role))
                    if label:
                        parts.append(f"Доступ изменён на «{ROLE_LABELS[role]}»: {label}")
                if removed:
                    parts.append("Убраны: " + ", ".join(sorted(names[key] for key in removed)))
                self.files._write_audit(
                    session,
                    action="library_members_changed",
                    row=None,
                    actor=actor,
                    meta=meta,
                    details=f"Общая папка «{library_name}». " + ". ".join(parts) + ".",
                )
            to_notify: dict[int, str] = {}
            for key in [*added, *changed]:
                role = wanted[key]
                if key[0] == "user":
                    to_notify[int(key[1])] = role
                else:
                    for uid in session.scalars(
                        select(AppDepartmentMembership.user_id).where(
                            AppDepartmentMembership.department_id == key[1],
                            AppDepartmentMembership.is_active.is_(True),
                        )
                    ).all():
                        previous = to_notify.get(int(uid))
                        if previous is None or _LIBRARY_ROLE_RANK[role] > _LIBRARY_ROLE_RANK[previous]:
                            to_notify[int(uid)] = role
            to_notify.pop(_actor_id(actor), None)
            owner_label = _normalize_text(getattr(actor, "full_name", "")) or _normalize_text(getattr(actor, "username", ""))
        for uid, role in list(to_notify.items())[:_MAX_NOTIFIED]:
            _notify_invited(uid, library_id=library_pk, library_name=library_name, owner_label=owner_label, role=role)
        return result


my_files_library_service = MyFilesLibraryService()
