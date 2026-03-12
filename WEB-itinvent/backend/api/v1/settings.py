"""
User settings API endpoints.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.api.deps import get_current_active_user, get_current_admin_user
from backend.models.auth import User
from backend.services import env_settings_service, settings_service


router = APIRouter()


class UserSettingsResponse(BaseModel):
    pinned_database: Optional[str] = None
    theme_mode: str = "light"
    font_family: str = "Inter"
    font_scale: float = 1.0


class UserSettingsPatchRequest(BaseModel):
    pinned_database: Optional[str] = None
    theme_mode: Optional[str] = None
    font_family: Optional[str] = None
    font_scale: Optional[float] = Field(default=None, ge=0.9, le=1.2)


class EnvSettingItemPatch(BaseModel):
    key: str
    value: Optional[str] = None


class EnvSettingsPatchRequest(BaseModel):
    items: dict[str, Optional[str]] | list[EnvSettingItemPatch]


class EnvSettingsResponse(BaseModel):
    updated: int = 0
    items: list[dict] = Field(default_factory=list)
    deployment_targets: list[dict] = Field(default_factory=list)
    apply_plan: list[dict] = Field(default_factory=list)
    recent_changes: list[dict] = Field(default_factory=list)


@router.get("/me", response_model=UserSettingsResponse)
async def get_my_settings(
    current_user: User = Depends(get_current_active_user),
):
    settings = settings_service.get_user_settings(current_user.id)
    return UserSettingsResponse(**settings)


@router.patch("/me", response_model=UserSettingsResponse)
async def update_my_settings(
    payload: UserSettingsPatchRequest,
    current_user: User = Depends(get_current_active_user),
):
    payload_data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    updated = settings_service.update_user_settings(
        current_user.id,
        payload_data,
    )
    return UserSettingsResponse(**updated)


@router.get("/env", response_model=EnvSettingsResponse)
async def get_env_settings(
    current_user: User = Depends(get_current_admin_user),
):
    return EnvSettingsResponse(**env_settings_service.get_snapshot())


@router.patch("/env", response_model=EnvSettingsResponse)
async def update_env_settings(
    payload: EnvSettingsPatchRequest,
    current_user: User = Depends(get_current_admin_user),
):
    raw_items = payload.items
    if isinstance(raw_items, list):
        updates = {
            str(item.key).strip(): item.value
            for item in raw_items
            if str(item.key).strip()
        }
    else:
        updates = {
            str(key).strip(): value
            for key, value in raw_items.items()
            if str(key).strip()
        }
    return EnvSettingsResponse(**env_settings_service.update_variables(
        updates,
        actor_user_id=current_user.id,
        actor_username=current_user.username,
    ))
