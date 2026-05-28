"""Password vault API router."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.concurrency import run_in_threadpool

from backend.api.deps import get_current_admin_user, get_current_session_id, require_permission
from backend.models.auth import User
from backend.models.password_vault import (
    PasswordVaultAuditResponse,
    PasswordVaultGroupCreate,
    PasswordVaultGroupListResponse,
    PasswordVaultGroupResponse,
    PasswordVaultGroupUpdate,
    PasswordVaultEntryCreate,
    PasswordVaultEntryResponse,
    PasswordVaultEntryUpdate,
    PasswordVaultListResponse,
    PasswordVaultRevealRequest,
    PasswordVaultRevealResponse,
    PasswordVaultUnlockRequest,
    PasswordVaultUnlockResponse,
)
from backend.services.authorization_service import PERM_PASSWORDS_READ, PERM_PASSWORDS_WRITE
from backend.services.password_vault_service import (
    PasswordVaultAccessError,
    PasswordVaultConfigurationError,
    PasswordVaultNotFoundError,
    PasswordVaultRequestMeta,
    PasswordVaultValidationError,
    password_vault_service,
)
from backend.utils.request_network import build_request_network_context


router = APIRouter()


def _request_meta(request: Request) -> PasswordVaultRequestMeta:
    network_context = build_request_network_context(request)
    return PasswordVaultRequestMeta(
        ip_address=network_context.client_ip,
        user_agent=str(request.headers.get("user-agent") or ""),
    )


def _service_error_to_http(exc: Exception) -> HTTPException:
    if isinstance(exc, PasswordVaultConfigurationError):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    if isinstance(exc, PasswordVaultNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, PasswordVaultAccessError):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    if isinstance(exc, PasswordVaultValidationError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Password vault request failed")


def _payload(model: Any, *, exclude_unset: bool = False) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_unset=exclude_unset)
    return model.dict(exclude_unset=exclude_unset)


@router.get("", response_model=PasswordVaultListResponse)
@router.get("/", response_model=PasswordVaultListResponse)
async def list_passwords(
    q: str = Query(default=""),
    group: str = Query(default=""),
    tag: str = Query(default=""),
    include_archived: bool = Query(default=False),
    current_user: User = Depends(require_permission(PERM_PASSWORDS_READ)),
    session_id: str | None = Depends(get_current_session_id),
) -> dict[str, Any]:
    try:
        return await run_in_threadpool(
            password_vault_service.list_entries,
            q=q,
            group=group,
            tag=tag,
            include_archived=include_archived,
            user_id=int(current_user.id),
            session_id=session_id,
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.post("", response_model=PasswordVaultEntryResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=PasswordVaultEntryResponse, status_code=status.HTTP_201_CREATED)
async def create_password(
    payload: PasswordVaultEntryCreate,
    request: Request,
    current_user: User = Depends(require_permission(PERM_PASSWORDS_WRITE)),
) -> dict[str, Any]:
    try:
        return await run_in_threadpool(
            password_vault_service.create_entry,
            _payload(payload),
            actor=current_user,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.patch("/{entry_id}", response_model=PasswordVaultEntryResponse)
async def update_password(
    entry_id: str,
    payload: PasswordVaultEntryUpdate,
    request: Request,
    current_user: User = Depends(require_permission(PERM_PASSWORDS_WRITE)),
) -> dict[str, Any]:
    try:
        return await run_in_threadpool(
            password_vault_service.update_entry,
            entry_id,
            _payload(payload, exclude_unset=True),
            actor=current_user,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.post("/{entry_id}/archive", response_model=PasswordVaultEntryResponse)
async def archive_password(
    entry_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_PASSWORDS_WRITE)),
) -> dict[str, Any]:
    try:
        return await run_in_threadpool(
            password_vault_service.archive_entry,
            entry_id,
            actor=current_user,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.get("/groups", response_model=PasswordVaultGroupListResponse)
async def list_password_groups(
    include_inactive: bool = Query(default=False),
    _: User = Depends(require_permission(PERM_PASSWORDS_READ)),
) -> dict[str, Any]:
    try:
        items = await run_in_threadpool(
            password_vault_service.list_groups,
            include_inactive=include_inactive,
        )
        return {"items": items}
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.post("/groups", response_model=PasswordVaultGroupResponse, status_code=status.HTTP_201_CREATED)
async def create_password_group(
    payload: PasswordVaultGroupCreate,
    current_user: User = Depends(require_permission(PERM_PASSWORDS_WRITE)),
) -> dict[str, Any]:
    try:
        return await run_in_threadpool(
            password_vault_service.create_group,
            _payload(payload),
            actor=current_user,
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.patch("/groups/{group_id}", response_model=PasswordVaultGroupResponse)
async def update_password_group(
    group_id: str,
    payload: PasswordVaultGroupUpdate,
    current_user: User = Depends(require_permission(PERM_PASSWORDS_WRITE)),
) -> dict[str, Any]:
    try:
        return await run_in_threadpool(
            password_vault_service.update_group,
            group_id,
            _payload(payload, exclude_unset=True),
            actor=current_user,
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.post("/groups/{group_id}/archive", response_model=PasswordVaultGroupResponse)
async def archive_password_group(
    group_id: str,
    current_user: User = Depends(require_permission(PERM_PASSWORDS_WRITE)),
) -> dict[str, Any]:
    try:
        return await run_in_threadpool(
            password_vault_service.archive_group,
            group_id,
            actor=current_user,
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.post("/unlock", response_model=PasswordVaultUnlockResponse)
async def unlock_password_vault(
    payload: PasswordVaultUnlockRequest,
    request: Request,
    current_user: User = Depends(require_permission(PERM_PASSWORDS_READ)),
    session_id: str | None = Depends(get_current_session_id),
) -> dict[str, str]:
    try:
        return await run_in_threadpool(
            password_vault_service.unlock,
            actor=current_user,
            session_id=session_id,
            totp_code=payload.totp_code,
            backup_code=payload.backup_code,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.post("/{entry_id}/reveal", response_model=PasswordVaultRevealResponse)
async def reveal_password(
    entry_id: str,
    payload: PasswordVaultRevealRequest,
    request: Request,
    current_user: User = Depends(require_permission(PERM_PASSWORDS_READ)),
    session_id: str | None = Depends(get_current_session_id),
) -> dict[str, str]:
    try:
        return await run_in_threadpool(
            password_vault_service.reveal_entry,
            entry_id,
            purpose=payload.purpose,
            actor=current_user,
            session_id=session_id,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.get("/audit", response_model=PasswordVaultAuditResponse)
async def list_password_audit(
    limit: int = Query(default=100, ge=1, le=500),
    _: User = Depends(get_current_admin_user),
) -> dict[str, Any]:
    try:
        items = await run_in_threadpool(password_vault_service.list_audit, limit=limit)
        return {"items": items}
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
