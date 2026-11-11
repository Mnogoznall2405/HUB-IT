from typing import List, Dict, Any, Literal
from fastapi import APIRouter, Depends, HTTPException, Query

from backend.api.deps import get_current_admin_user, require_permission
from pydantic import BaseModel, Field
from backend.models.auth import User
from backend.services.ad_users_service import (
    get_ad_users_password_status,
    get_ad_password_expiry_report,
    import_ad_user_to_app_user,
    list_ad_organizational_units,
    set_ad_user_branch,
)
from backend.services.ad_app_user_import_service import ad_app_user_import_service
from backend.services.authorization_service import PERM_PASSWORDS_READ

router = APIRouter()

class AssignBranchRequest(BaseModel):
    login: str
    branch_no: int | None = None


class ImportAdUserRequest(BaseModel):
    login: str


class SyncAdUsersToAppRequest(BaseModel):
    logins: list[str] = Field(default_factory=list)

@router.get("/password-status", response_model=List[Dict[str, Any]])
def get_password_status(
    _: User = Depends(get_current_admin_user),
):
    """
    Returns a list of AD users from 'Users standart'/'Users Objects'
    along with their password expiration status (40 days policy).
    """
    return get_ad_users_password_status()


@router.get("/organizational-units", response_model=Dict[str, Any])
def get_organizational_units(
    parent_dn: str = Query(default=""),
    force: bool = Query(default=False),
    _: User = Depends(require_permission(PERM_PASSWORDS_READ)),
):
    """Return child organizational units for building an OU tree."""
    normalized_parent = str(parent_dn or "").strip() or None
    payload = list_ad_organizational_units(parent_dn=normalized_parent, force=force)
    if payload.get("status") == "error":
        raise HTTPException(status_code=503, detail=str(payload.get("error") or "LDAP query failed"))
    return payload


@router.get("/password-expiry", response_model=Dict[str, Any])
def get_password_expiry(
    ou_dn: str = Query(default=""),
    mode: Literal["all", "expiring"] = Query(default="all"),
    days_threshold: int = Query(default=7, ge=1, le=90),
    q: str = Query(default=""),
    force: bool = Query(default=False),
    _: User = Depends(require_permission(PERM_PASSWORDS_READ)),
):
    """Return AD users with password expiration status filtered by OU and mode."""
    normalized_ou = str(ou_dn or "").strip() or None
    payload = get_ad_password_expiry_report(
        ou_dn=normalized_ou,
        mode=mode,
        days_threshold=days_threshold,
        q=q,
        force=force,
    )
    if payload.get("status") == "error":
        raise HTTPException(status_code=503, detail=str(payload.get("error") or "LDAP query failed"))
    return payload


@router.get("/import-candidates", response_model=List[Dict[str, Any]])
def get_import_candidates(
    _: User = Depends(get_current_admin_user),
):
    """
    Returns active AD users annotated with web import status and warnings.
    """
    return ad_app_user_import_service.list_import_candidates()

@router.post("/assign-branch")
def assign_user_branch(
    req: AssignBranchRequest,
    _: User = Depends(get_current_admin_user),
):
    """
    Manually assign a branch to an AD user.
    """
    success = set_ad_user_branch(req.login, req.branch_no)
    if not success:
         raise HTTPException(status_code=400, detail="Failed to assign branch")
    return {"success": True}


@router.post("/import-to-app")
def import_user_to_app(
    req: ImportAdUserRequest,
    _: User = Depends(get_current_admin_user),
):
    try:
        return {"user": import_ad_user_to_app_user(req.login)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sync-to-app")
def sync_users_to_app(
    req: SyncAdUsersToAppRequest,
    _: User = Depends(get_current_admin_user),
):
    return ad_app_user_import_service.sync_to_app(req.logins)


@router.post("/sync-all-to-app")
def sync_all_users_to_app(
    _: User = Depends(get_current_admin_user),
):
    """Full AD sync: upsert all LDAP users and deactivate missing ldap accounts."""
    result = ad_app_user_import_service.sync_all_from_ad()
    if result.get("status") == "already_running":
        raise HTTPException(status_code=409, detail=str(result.get("message") or "Sync already running"))
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=str(result.get("message") or "AD sync failed"))
    return result


@router.get("/sync-status")
def get_ad_app_user_sync_status(
    _: User = Depends(get_current_admin_user),
):
    """Return last AD app-user sync status and statistics."""
    return ad_app_user_import_service.get_sync_status()
