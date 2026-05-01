from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException

from backend.api.deps import get_current_admin_user
from pydantic import BaseModel, Field
from backend.models.auth import User
from backend.services.ad_users_service import get_ad_users_password_status, import_ad_user_to_app_user, set_ad_user_branch
from backend.services.ad_app_user_import_service import ad_app_user_import_service

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
