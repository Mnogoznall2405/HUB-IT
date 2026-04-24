"""
User settings API endpoints.
"""
from __future__ import annotations

import json
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.api.deps import get_current_active_user, get_current_admin_user
from backend.models.auth import User
from backend.services.app_settings_service import app_settings_service
from backend.services.env_settings_service import env_settings_service
from backend.services.settings_service import settings_service
from backend.services.app_push_service import app_push_service
from backend.services.notification_preferences_service import notification_preferences_service


router = APIRouter()
logger = logging.getLogger(__name__)


class UserSettingsResponse(BaseModel):
    pinned_database: Optional[str] = None
    theme_mode: str = "light"
    font_family: str = "Inter"
    font_scale: float = 1.0
    dashboard_mobile_sections: list[str] = Field(default_factory=lambda: ["urgent", "announcements", "tasks"])


class UserSettingsPatchRequest(BaseModel):
    pinned_database: Optional[str] = None
    theme_mode: Optional[str] = None
    font_family: Optional[str] = None
    font_scale: Optional[float] = Field(default=None, ge=0.9, le=1.2)
    dashboard_mobile_sections: Optional[list[str]] = None


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


class AppSettingsControllerUser(BaseModel):
    id: int
    username: str
    full_name: str
    role: str


class AppSettingsResponse(BaseModel):
    transfer_act_reminder_controller_username: Optional[str] = None
    admin_login_allowed_ips: list[str] = Field(default_factory=list)
    available_controllers: list[AppSettingsControllerUser] = Field(default_factory=list)
    resolved_controller: Optional[AppSettingsControllerUser] = None
    resolved_controller_source: Literal["configured", "fallback", "none"] = "none"
    fallback_used: bool = False
    warning: Optional[str] = None


class AppSettingsPatchRequest(BaseModel):
    transfer_act_reminder_controller_username: Optional[str] = None
    admin_login_allowed_ips: Optional[list[str]] = None


class NotificationPushConfigResponse(BaseModel):
    enabled: bool = False
    vapid_public_key: Optional[str] = None
    requires_installed_pwa: bool = True
    icon_url: Optional[str] = None
    badge_url: Optional[str] = None


class NotificationPushSubscriptionPayload(BaseModel):
    endpoint: str = Field(..., min_length=1)
    p256dh_key: str = Field(..., min_length=1)
    auth_key: str = Field(..., min_length=1)
    expiration_time: Optional[int] = None
    platform: Optional[str] = None
    browser_family: Optional[str] = None
    install_mode: Optional[str] = None


class NotificationPushDeletePayload(BaseModel):
    endpoint: str = Field(..., min_length=1)


class NotificationPushSubscriptionStatusResponse(BaseModel):
    ok: bool = True
    subscribed: bool = False
    push_enabled: bool = False
    removed: bool = False


class NotificationPushDebugPayload(BaseModel):
    stage: str = Field(..., min_length=2, max_length=120)
    detail: dict = Field(default_factory=dict)


class NotificationPreferencesResponse(BaseModel):
    user_id: int
    channels: dict[str, bool] = Field(default_factory=dict)


class NotificationPreferencesPatchRequest(BaseModel):
    mail: Optional[bool] = None
    tasks: Optional[bool] = None
    announcements: Optional[bool] = None
    chat: Optional[bool] = None


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


@router.get("/notifications/push-config", response_model=NotificationPushConfigResponse)
async def get_notification_push_config(
    current_user: User = Depends(get_current_active_user),
):
    _ = current_user
    return NotificationPushConfigResponse(**app_push_service.get_public_config())


@router.put("/notifications/push-subscription", response_model=NotificationPushSubscriptionStatusResponse)
async def put_notification_push_subscription(
    payload: NotificationPushSubscriptionPayload,
    request: Request,
    current_user: User = Depends(get_current_active_user),
):
    user_agent = request.headers.get("user-agent") or None
    data = app_push_service.upsert_subscription(
        current_user_id=int(current_user.id),
        endpoint=payload.endpoint,
        p256dh_key=payload.p256dh_key,
        auth_key=payload.auth_key,
        expiration_time=payload.expiration_time,
        user_agent=user_agent,
        platform=payload.platform,
        browser_family=payload.browser_family,
        install_mode=payload.install_mode,
    )
    return NotificationPushSubscriptionStatusResponse(**data)


@router.delete("/notifications/push-subscription", response_model=NotificationPushSubscriptionStatusResponse)
async def delete_notification_push_subscription(
    payload: NotificationPushDeletePayload,
    current_user: User = Depends(get_current_active_user),
):
    data = app_push_service.delete_subscription(
        current_user_id=int(current_user.id),
        endpoint=payload.endpoint,
    )
    return NotificationPushSubscriptionStatusResponse(**data)


@router.post("/notifications/push-debug")
async def post_notification_push_debug(
    payload: NotificationPushDebugPayload,
    request: Request,
    current_user: User = Depends(get_current_active_user),
):
    stage = str(payload.stage or "").strip() or "unknown"
    detail = payload.detail if isinstance(payload.detail, dict) else {}
    logger.info(
        "PUSH_DEBUG user_id=%s username=%s ip=%s stage=%s detail=%s ua=%s",
        int(current_user.id),
        str(current_user.username or "").strip(),
        str(getattr(request.client, "host", "") or "").strip(),
        stage,
        json.dumps(detail, ensure_ascii=False, sort_keys=True, default=str),
        str(request.headers.get("user-agent") or "").strip(),
    )
    print(
        "PUSH_DEBUG",
        {
            "user_id": int(current_user.id),
            "username": str(current_user.username or "").strip(),
            "ip": str(getattr(request.client, "host", "") or "").strip(),
            "stage": stage,
            "detail": detail,
            "ua": str(request.headers.get("user-agent") or "").strip(),
        },
        flush=True,
    )
    return {"ok": True}


@router.get("/notifications/preferences", response_model=NotificationPreferencesResponse)
async def get_notification_preferences(
    current_user: User = Depends(get_current_active_user),
):
    return NotificationPreferencesResponse(**notification_preferences_service.get_preferences(user_id=int(current_user.id)))


@router.patch("/notifications/preferences", response_model=NotificationPreferencesResponse)
async def patch_notification_preferences(
    payload: NotificationPreferencesPatchRequest,
    current_user: User = Depends(get_current_active_user),
):
    payload_data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    return NotificationPreferencesResponse(**notification_preferences_service.update_preferences(
        user_id=int(current_user.id),
        patch=payload_data or {},
    ))


@router.get("/app", response_model=AppSettingsResponse)
async def get_app_settings(
    current_user: User = Depends(get_current_admin_user),
):
    _ = current_user
    return AppSettingsResponse(**app_settings_service.resolve_transfer_act_reminder_controller())


@router.patch("/app", response_model=AppSettingsResponse)
async def update_app_settings(
    payload: AppSettingsPatchRequest,
    current_user: User = Depends(get_current_admin_user),
):
    _ = current_user
    payload_data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    try:
        app_settings_service.update_settings(payload_data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AppSettingsResponse(**app_settings_service.resolve_transfer_act_reminder_controller())


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
