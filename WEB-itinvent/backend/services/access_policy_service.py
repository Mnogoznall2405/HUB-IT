"""Resource access policy for department-scoped HUB data."""
from __future__ import annotations

from typing import Any, Iterable

from backend.services.authorization_service import (
    PERM_KB_MANAGE_ALL,
    PERM_KB_PUBLISH,
    PERM_KB_WRITE,
    PERM_TASKS_MANAGE_ALL,
    PERM_TASKS_REVIEW,
    PERM_TASKS_WRITE,
    authorization_service,
)
from backend.services.department_service import (
    DEPARTMENT_MANAGER_ROLE,
    DEPARTMENT_MEMBER_ROLE,
    department_service,
)


VISIBILITY_PRIVATE = "private"
VISIBILITY_DEPARTMENT = "department"
VISIBILITY_DEPARTMENT_MANAGERS = "department_managers"
VISIBILITY_GLOBAL = "global"
RESOURCE_VISIBILITY_SCOPES = {
    VISIBILITY_PRIVATE,
    VISIBILITY_DEPARTMENT,
    VISIBILITY_DEPARTMENT_MANAGERS,
    VISIBILITY_GLOBAL,
}


def _user_attr(user: Any, key: str, default: Any = None) -> Any:
    if isinstance(user, dict):
        return user.get(key, default)
    return getattr(user, key, default)


def _user_id(user: Any) -> int:
    try:
        return int(_user_attr(user, "id", 0) or 0)
    except Exception:
        return 0


def _username(user: Any) -> str:
    return str(_user_attr(user, "username", "") or "").strip()


def _is_admin(user: Any) -> bool:
    return str(_user_attr(user, "role", "") or "").strip().lower() == "admin"


def user_permissions(user: Any) -> set[str]:
    permissions = _user_attr(user, "permissions", None)
    if permissions is None:
        permissions = authorization_service.get_effective_permissions(
            _user_attr(user, "role", "viewer"),
            use_custom_permissions=bool(_user_attr(user, "use_custom_permissions", False)),
            custom_permissions=_user_attr(user, "custom_permissions", []),
        )
    return {str(item or "").strip() for item in list(permissions or []) if str(item or "").strip()}


def user_has_permission(user: Any, permission: str) -> bool:
    return str(permission or "").strip() in user_permissions(user)


def user_can_manage_tasks_all(user: Any) -> bool:
    return _is_admin(user) or user_has_permission(user, PERM_TASKS_MANAGE_ALL)


def user_can_manage_kb_all(user: Any) -> bool:
    return _is_admin(user) or user_has_permission(user, PERM_KB_MANAGE_ALL)


def normalize_visibility_scope(value: Any, *, default: str = VISIBILITY_PRIVATE) -> str:
    scope = str(value or "").strip().lower()
    return scope if scope in RESOURCE_VISIBILITY_SCOPES else default


def _resource_department_id(resource: dict[str, Any]) -> str:
    return str((resource or {}).get("department_id") or "").strip()


def user_is_department_member(user: Any, department_id: Any) -> bool:
    target = str(department_id or "").strip()
    if not target:
        return False
    return target in department_service.get_user_department_ids(
        user if isinstance(user, dict) else {"id": _user_id(user), "department": _user_attr(user, "department")},
        roles=[DEPARTMENT_MEMBER_ROLE, DEPARTMENT_MANAGER_ROLE],
    )


def user_is_department_manager(user: Any, department_id: Any) -> bool:
    target = str(department_id or "").strip()
    if not target:
        return False
    return department_service.is_department_manager(
        user if isinstance(user, dict) else {"id": _user_id(user), "department": _user_attr(user, "department")},
        target,
    )


def can_view_task(
    user: Any,
    task: dict[str, Any],
    *,
    participant_user_ids: Iterable[int],
) -> bool:
    if user_can_manage_tasks_all(user):
        return True
    uid = _user_id(user)
    participant_ids: set[int] = set()
    for item in list(participant_user_ids or []):
        try:
            parsed = int(item)
        except Exception:
            continue
        if parsed > 0:
            participant_ids.add(parsed)
    if uid > 0 and uid in participant_ids:
        return True
    department_id = _resource_department_id(task)
    scope = normalize_visibility_scope((task or {}).get("visibility_scope"))
    if not department_id or scope == VISIBILITY_PRIVATE:
        return False
    if scope == VISIBILITY_GLOBAL:
        return True
    if scope == VISIBILITY_DEPARTMENT:
        return user_is_department_member(user, department_id) or user_is_department_manager(user, department_id)
    if scope == VISIBILITY_DEPARTMENT_MANAGERS:
        return user_is_department_manager(user, department_id)
    return False


def can_create_task_for_department(
    user: Any,
    *,
    department_id: Any,
    assignee: dict[str, Any],
) -> bool:
    target = str(department_id or "").strip()
    if not target:
        return user_has_permission(user, PERM_TASKS_WRITE)
    if user_can_manage_tasks_all(user):
        return True
    if user_is_department_manager(user, target):
        return user_is_department_member(assignee, target) or user_is_department_manager(assignee, target)
    return _user_id(user) > 0 and _user_id(user) == _user_id(assignee) and user_is_department_member(user, target)


def can_review_task(user: Any, task: dict[str, Any]) -> bool:
    if user_can_manage_tasks_all(user):
        return True
    uid = _user_id(user)
    if uid in {
        int((task or {}).get("created_by_user_id") or 0),
        int((task or {}).get("controller_user_id") or 0),
    }:
        return True
    department_id = _resource_department_id(task)
    return bool(department_id and user_is_department_manager(user, department_id)) or user_has_permission(user, PERM_TASKS_REVIEW)


def _kb_owner_match(user: Any, item: dict[str, Any]) -> bool:
    uid = _user_id(user)
    if uid > 0 and int((item or {}).get("owner_user_id") or 0) == uid:
        return True
    return bool(_username(user) and str((item or {}).get("created_by") or "").strip().casefold() == _username(user).casefold())


def can_view_kb_item(user: Any, item: dict[str, Any]) -> bool:
    if user_can_manage_kb_all(user):
        return True
    scope = normalize_visibility_scope((item or {}).get("visibility_scope"), default=VISIBILITY_GLOBAL)
    if scope == VISIBILITY_GLOBAL:
        return True
    if scope == VISIBILITY_PRIVATE:
        return _kb_owner_match(user, item)
    department_id = _resource_department_id(item)
    if not department_id:
        return False
    if scope == VISIBILITY_DEPARTMENT:
        return user_is_department_member(user, department_id) or user_is_department_manager(user, department_id)
    if scope == VISIBILITY_DEPARTMENT_MANAGERS:
        return user_is_department_manager(user, department_id)
    return False


def can_edit_kb_item(user: Any, item: dict[str, Any]) -> bool:
    if user_can_manage_kb_all(user):
        return True
    if not user_has_permission(user, PERM_KB_WRITE):
        return False
    department_id = _resource_department_id(item)
    return _kb_owner_match(user, item) or bool(department_id and user_is_department_manager(user, department_id))


def can_publish_kb_item(user: Any, item: dict[str, Any]) -> bool:
    return user_can_manage_kb_all(user) or user_has_permission(user, PERM_KB_PUBLISH)
