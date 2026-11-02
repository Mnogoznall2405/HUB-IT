"""Co-editing of My Files documents through ONLYOFFICE Document Server."""
from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from backend.api.deps import require_permission
from backend.api.v1.my_files import _download_response, _enforce_trusted_browser_origin, _request_meta, _service_error_to_http
from backend.models.auth import User
from backend.services import onlyoffice_service as oo
from backend.services.authorization_service import PERM_MY_FILES_READ, PERM_MY_FILES_SHARE
from backend.services.my_files_collab_service import my_files_collab_service
from backend.services.my_files_service import MyFilesNotFoundError, MyFilesRequestMeta, my_files_service


logger = logging.getLogger(__name__)

router = APIRouter()

_MAX_SAVED_DOCUMENT_BYTES = 256 * 1024 * 1024


class OfficeStatusResponse(BaseModel):
    enabled: bool
    public_path: str = ""
    editable_extensions: list[str] = Field(default_factory=list)


class OfficeEditorConfigResponse(BaseModel):
    config: dict
    role: str
    public_path: str


class OfficeCollaborator(BaseModel):
    user_id: int
    username: str
    full_name: str = ""


class OfficeCollaboratorsRequest(BaseModel):
    user_ids: list[int] = Field(default_factory=list, max_length=50)


class OfficeCollaboratorsResponse(BaseModel):
    items: list[OfficeCollaborator] = Field(default_factory=list)


class OfficeSharedFile(BaseModel):
    id: str
    file_name: str
    owner_username: str = ""
    size_bytes: int = 0
    updated_at: datetime | None = None
    editable: bool = True


class OfficeSharedFilesResponse(BaseModel):
    items: list[OfficeSharedFile] = Field(default_factory=list)


class OfficeVersion(BaseModel):
    id: str
    version_no: int
    size_bytes: int = 0
    replaced_by: str = ""
    replaced_at: datetime | None = None


class OfficeVersionsResponse(BaseModel):
    items: list[OfficeVersion] = Field(default_factory=list)


def _settings_or_503() -> oo.OnlyOfficeSettings:
    try:
        return oo.require_enabled()
    except oo.OnlyOfficeDisabledError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Совместное редактирование не настроено") from exc


@router.get("/office/status", response_model=OfficeStatusResponse)
async def get_office_status(current_user: User = Depends(require_permission(PERM_MY_FILES_READ))) -> dict:
    settings = oo.load_settings()
    ready = bool(settings.enabled and settings.jwt_secret and settings.internal_url and settings.app_base_url)
    return {
        "enabled": ready,
        "public_path": settings.public_path if ready else "",
        "editable_extensions": sorted(oo.EDITABLE_DOCUMENT_TYPES) if ready else [],
    }


@router.get("/office/shared-with-me", response_model=OfficeSharedFilesResponse)
async def list_office_shared_with_me(current_user: User = Depends(require_permission(PERM_MY_FILES_READ))) -> dict:
    try:
        items = await run_in_threadpool(my_files_collab_service.list_shared_with_me, user_id=int(current_user.id))
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    return {"items": items}


@router.get("/office/source")
async def download_office_source(request: Request, t: str = Query(..., min_length=10, max_length=2048)):
    """Current document content for Document Server, authorised by a signed short-lived URL."""
    settings = _settings_or_503()
    try:
        claims = oo.read_url_token(settings, t, "src")
        payload = await run_in_threadpool(
            my_files_collab_service.resolve_source,
            file_id=str(claims.get("fid") or ""),
            blob_id=str(claims.get("bid") or ""),
        )
    except oo.OnlyOfficeAuthError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid token") from exc
    except MyFilesNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found") from exc
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    return _download_response(payload, request)


def _save_from_callback(
    settings: oo.OnlyOfficeSettings,
    *,
    file_id: str,
    document_key: str,
    document_url: str,
    user_ids: list[int],
    meta: MyFilesRequestMeta,
) -> str:
    spool_path = my_files_service.new_spool_path("office-edit.bin")
    try:
        oo.fetch_document(settings, document_url, spool_path, max_bytes=_MAX_SAVED_DOCUMENT_BYTES)
        return my_files_collab_service.save_version(
            file_id=file_id,
            document_key=document_key,
            spool_path=spool_path,
            editor_user_ids=user_ids,
            meta=meta,
        )
    finally:
        my_files_service._delete_spool_payload(spool_path)


@router.post("/office/callback")
async def office_callback(request: Request, t: str = Query(..., min_length=10, max_length=2048)) -> dict:
    """Document Server notifications; ``error: 0`` tells it that the document is stored."""
    settings = _settings_or_503()
    try:
        claims = oo.read_url_token(settings, t, "cb")
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError("Callback body must be an object")
        event = oo.verify_callback(settings, body, request.headers.get("authorization", ""))
    except (oo.OnlyOfficeAuthError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid callback") from exc
    try:
        event_status = int(event.get("status") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status")
    if event_status not in oo.SAVE_STATUSES:
        return {"error": 0}
    file_id = str(claims.get("fid") or "")
    user_ids = []
    for raw in event.get("users") or []:
        try:
            user_ids.append(int(raw))
        except (TypeError, ValueError):
            continue
    try:
        result = await run_in_threadpool(
            _save_from_callback,
            settings,
            file_id=file_id,
            document_key=str(event.get("key") or ""),
            document_url=str(event.get("url") or ""),
            user_ids=user_ids,
            meta=_request_meta(request),
        )
    except MyFilesNotFoundError:
        logger.warning("office.callback_file_missing file_id=%s", file_id)
        return {"error": 0}
    except Exception:
        logger.exception("office.callback_failed file_id=%s status=%s", file_id, event_status)
        return {"error": 1}
    logger.info("office.callback file_id=%s status=%s result=%s", file_id, event_status, result)
    return {"error": 0}


@router.get("/{file_id}/office/config", response_model=OfficeEditorConfigResponse)
async def get_office_editor_config(
    file_id: str,
    current_user: User = Depends(require_permission(PERM_MY_FILES_READ)),
) -> dict:
    settings = _settings_or_503()
    try:
        session = await run_in_threadpool(
            my_files_collab_service.get_editor_session, file_id=file_id, user_id=int(current_user.id)
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    config = oo.build_editor_config(
        settings,
        file_id=session["file_id"],
        file_name=session["file_name"],
        blob_id=session["blob_id"],
        revision=session["revision"],
        user_id=int(current_user.id),
        user_name=str(getattr(current_user, "full_name", "") or current_user.username or ""),
    )
    return {"config": config, "role": session["role"], "public_path": settings.public_path}


@router.get("/{file_id}/office/collaborators", response_model=OfficeCollaboratorsResponse)
async def list_office_collaborators(
    file_id: str,
    current_user: User = Depends(require_permission(PERM_MY_FILES_SHARE)),
) -> dict:
    try:
        items = await run_in_threadpool(
            my_files_collab_service.list_collaborators, file_id=file_id, owner_user_id=int(current_user.id)
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    return {"items": items}


@router.put("/{file_id}/office/collaborators", response_model=OfficeCollaboratorsResponse)
async def set_office_collaborators(
    file_id: str,
    payload: OfficeCollaboratorsRequest,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_SHARE)),
) -> dict:
    _enforce_trusted_browser_origin(request)
    try:
        items = await run_in_threadpool(
            my_files_collab_service.set_collaborators,
            file_id=file_id,
            owner_user_id=int(current_user.id),
            user_ids=payload.user_ids,
            actor=current_user,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    return {"items": items}


@router.get("/{file_id}/office/versions", response_model=OfficeVersionsResponse)
async def list_office_versions(
    file_id: str,
    current_user: User = Depends(require_permission(PERM_MY_FILES_READ)),
) -> dict:
    try:
        items = await run_in_threadpool(
            my_files_collab_service.list_versions, file_id=file_id, user_id=int(current_user.id)
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    return {"items": items}


@router.post("/{file_id}/office/versions/{version_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
async def restore_office_version(
    file_id: str,
    version_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_READ)),
) -> Response:
    _enforce_trusted_browser_origin(request)
    try:
        await run_in_threadpool(
            my_files_collab_service.restore_version,
            file_id=file_id,
            version_id=version_id,
            user_id=int(current_user.id),
            actor=current_user,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
