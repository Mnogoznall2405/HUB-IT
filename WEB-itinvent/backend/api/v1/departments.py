"""Department directory API."""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException

from backend.api.deps import require_permission
from backend.models.auth import User
from backend.services.authorization_service import PERM_DEPARTMENTS_MANAGE, PERM_SETTINGS_READ
from backend.services.department_service import department_service
from backend.services.user_service import user_service


router = APIRouter()


@router.get("")
async def list_departments(
    include_inactive: bool = False,
    current_user: User = Depends(require_permission(PERM_SETTINGS_READ)),
):
    department_service.sync_departments_from_users(user_service.list_users())
    manager_department_ids = set(department_service.get_user_department_ids(current_user.model_dump(), roles=["manager"]))
    return {
        "items": [
            {
                **item,
                "is_current_user_manager": str(item.get("id") or "") in manager_department_ids,
            }
            for item in department_service.list_departments(include_inactive=bool(include_inactive))
        ]
    }


@router.get("/{department_id}/members")
async def list_department_members(
    department_id: str,
    _: User = Depends(require_permission(PERM_SETTINGS_READ)),
):
    department = department_service.get_department(department_id)
    if not department:
        raise HTTPException(status_code=404, detail="Department not found")
    memberships = department_service.list_memberships(department_id=department_id)
    users_by_id = user_service.get_users_map_by_ids({item["user_id"] for item in memberships})
    return {
        "department": department,
        "items": [
            {
                **item,
                "user": users_by_id.get(int(item["user_id"])),
            }
            for item in memberships
        ],
    }


@router.put("/{department_id}/managers")
async def replace_department_managers(
    department_id: str,
    payload: dict = Body(...),
    _: User = Depends(require_permission(PERM_DEPARTMENTS_MANAGE)),
):
    try:
        manager_ids = payload.get("manager_user_ids") if isinstance(payload, dict) else []
        memberships = department_service.set_department_managers(department_id, manager_ids or [])
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    users_by_id = user_service.get_users_map_by_ids({item["user_id"] for item in memberships})
    return {
        "items": [
            {
                **item,
                "user": users_by_id.get(int(item["user_id"])),
            }
            for item in memberships
        ]
    }


@router.post("/sync-from-users")
async def sync_departments_from_users(
    _: User = Depends(require_permission(PERM_DEPARTMENTS_MANAGE)),
):
    department_service.sync_departments_from_users(user_service.list_users())
    return {"items": department_service.list_departments(include_inactive=True)}


@router.post("/sync-from-ad")
async def sync_departments_from_ad(
    _: User = Depends(require_permission(PERM_DEPARTMENTS_MANAGE)),
):
    from backend.services.ad_app_user_import_service import fetch_ad_import_users

    ad_users = fetch_ad_import_users()
    result = department_service.sync_departments_from_names(
        item.get("department")
        for item in ad_users
    )
    return {
        **result,
        "total_ad_users": len(ad_users),
        "items": department_service.list_departments(include_inactive=True),
    }
