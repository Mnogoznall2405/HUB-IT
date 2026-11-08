"""Co-editing of My Files documents through ONLYOFFICE Document Server."""
from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from backend.api.deps import get_current_user_optional, require_permission
from backend.api.v1.my_files import (
    _download_response,
    _enforce_trusted_browser_origin,
    _request_meta,
    _service_error_to_http,
    _service_error_to_secure_http,
    _set_public_response_headers,
)
from backend.api.v1.my_files_public_rate_limit import enforce_public_meta_limits, enforce_public_miss_limit
from backend.api.v1.my_files_upload_rate_limit import enforce_upload_limits
from backend.models.auth import User
from backend.models.my_files import MyFileBlankDocumentRequest, MyFileResponse
from backend.services import onlyoffice_service as oo
from backend.services.authorization_service import PERM_MY_FILES_READ, PERM_MY_FILES_SHARE, PERM_MY_FILES_WRITE
from backend.services.my_files_collab_service import my_files_collab_service
from backend.services.my_files_history_service import MAX_CHANGES_BYTES, MyFilesHistoryService, normalize_history
from backend.services.my_files_copy_service import my_files_copy_service
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
    can_rename: bool = False
    can_manage_access: bool = False
    can_view_history: bool = True


class OfficeRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class OfficeRenameResponse(BaseModel):
    file: MyFileResponse
    editor_notified: bool


class OfficeCollaborator(BaseModel):
    user_id: int
    username: str
    full_name: str = ""
    role: str = oo.ROLE_EDIT


class OfficeMember(BaseModel):
    user_id: int
    role: str = oo.ROLE_EDIT


class OfficeCollaboratorsRequest(BaseModel):
    # ``members`` carries roles; ``user_ids`` is the older form and means full editing rights.
    members: list[OfficeMember] = Field(default_factory=list, max_length=200)
    user_ids: list[int] = Field(default_factory=list, max_length=200)


class OfficeCollaboratorsResponse(BaseModel):
    items: list[OfficeCollaborator] = Field(default_factory=list)
    owner: OfficeCollaborator | None = None
    owner_kind: str = "owner"
    inherited_access: bool = False
    library_name: str = ""


class OfficePublicAccess(BaseModel):
    signed_in: bool = False
    editable: bool = False
    collaborative: bool = False
    can_open: bool = False
    role: str = ""
    file_id: str = ""


class OfficeGroup(BaseModel):
    id: str
    name: str
    members_count: int = 0


class OfficeGroupsResponse(BaseModel):
    items: list[OfficeGroup] = Field(default_factory=list)


class OfficeSharedFile(BaseModel):
    id: str
    file_name: str
    owner_username: str = ""
    size_bytes: int = 0
    updated_at: datetime | None = None
    editable: bool = True
    role: str = oo.ROLE_EDIT


class OfficeSharedFilesResponse(BaseModel):
    items: list[OfficeSharedFile] = Field(default_factory=list)


class OfficeVersion(BaseModel):
    id: str
    version_no: int
    size_bytes: int = 0
    replaced_by: str = ""
    replaced_at: datetime | None = None
    author: str = ""
    authored_at: datetime | None = None


class OfficeCurrentVersion(BaseModel):
    author: str = ""
    authored_at: datetime | None = None
    size_bytes: int = 0


class OfficeVersionsResponse(BaseModel):
    items: list[OfficeVersion] = Field(default_factory=list)
    current: OfficeCurrentVersion | None = None


def _settings_or_503() -> oo.OnlyOfficeSettings:
    try:
        return oo.require_enabled()
    except oo.OnlyOfficeDisabledError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Совместное редактирование не настроено") from exc


@router.post("/office/new", response_model=MyFileResponse, status_code=status.HTTP_201_CREATED)
async def create_blank_document(
    payload: MyFileBlankDocumentRequest,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> dict:
    """Empty .docx / .xlsx / .pptx in the given folder; it becomes editable once the worker marks it ready."""
    _enforce_trusted_browser_origin(request)
    _settings_or_503()
    await run_in_threadpool(enforce_upload_limits, request, user_id=int(current_user.id))
    try:
        return await run_in_threadpool(
            my_files_copy_service.create_blank_document,
            actor=current_user,
            kind=payload.kind,
            name=payload.name,
            folder_id=payload.folder_id,
            library_id=payload.library_id,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


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


@router.get("/office/groups", response_model=OfficeGroupsResponse)
async def list_office_groups(current_user: User = Depends(require_permission(PERM_MY_FILES_SHARE))) -> dict:
    items = await run_in_threadpool(my_files_collab_service.list_groups)
    return {"items": items}


@router.get("/office/groups/{group_id}/members", response_model=OfficeCollaboratorsResponse)
async def list_office_group_members(
    group_id: str,
    current_user: User = Depends(require_permission(PERM_MY_FILES_SHARE)),
) -> dict:
    try:
        items = await run_in_threadpool(my_files_collab_service.list_group_members, group_id=group_id)
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    return {"items": items}


@router.get("/public/{token}/editor", response_model=OfficePublicAccess)
async def get_public_link_editor_access(
    token: str,
    request: Request,
    response: Response,
    current_user: User | None = Depends(get_current_user_optional),
) -> dict:
    """One link for everybody: guests download, signed-in collaborators may also edit."""
    enforce_public_meta_limits(request, token)
    _set_public_response_headers(response)
    try:
        return await run_in_threadpool(
            my_files_collab_service.public_editor_access,
            token=token,
            user_id=int(current_user.id) if current_user else None,
        )
    except MyFilesNotFoundError as exc:
        enforce_public_miss_limit(request)
        raise _service_error_to_secure_http(exc) from exc
    except Exception as exc:
        raise _service_error_to_secure_http(exc) from exc


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
    history=None,
    changes_url: str = "",
) -> str:
    spool_path = my_files_service.new_spool_path("office-edit.bin")
    changes_path = None
    try:
        oo.fetch_document(settings, document_url, spool_path, max_bytes=_MAX_SAVED_DOCUMENT_BYTES)
        if changes_url and normalize_history(history):
            changes_path = my_files_service.new_spool_path("office-changes.zip")
            try:
                oo.fetch_document(settings, changes_url, changes_path, max_bytes=MAX_CHANGES_BYTES)
            except Exception:
                logger.warning("office.history_download_failed file_id=%s", file_id)
                my_files_service._delete_spool_payload(changes_path)
                changes_path = None
        return my_files_collab_service.save_version(
            file_id=file_id,
            document_key=document_key,
            spool_path=spool_path,
            editor_user_ids=user_ids,
            meta=meta,
            history=history,
            changes_path=changes_path,
        )
    finally:
        my_files_service._delete_spool_payload(spool_path)
        if changes_path:
            my_files_service._delete_spool_payload(changes_path)


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
            history=event.get("history"),
            changes_url=str(event.get("changesurl") or ""),
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


@router.get("/office/history/source")
async def download_history_source(request: Request, t: str = Query(..., min_length=10, max_length=2048)):
    settings = _settings_or_503()
    try:
        claims = oo.read_url_token(settings, t, "hist")
        payload = await run_in_threadpool(MyFilesHistoryService(my_files_collab_service).resolve_asset,
            file_id=str(claims.get("fid") or ""), user_id=int(claims.get("uid") or 0),
            version_id=str(claims.get("vid") or ""), blob_id=str(claims.get("bid") or ""), kind=str(claims.get("kind") or ""))
    except oo.OnlyOfficeAuthError as exc:
        raise HTTPException(status_code=403, detail="Invalid token") from exc
    except Exception as exc:
        raise _service_error_to_secure_http(exc) from exc
    response = _download_response(payload, request)
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@router.get("/{file_id}/office/history")
async def get_document_history(file_id: str, current_user: User = Depends(require_permission(PERM_MY_FILES_READ))):
    try:
        return await run_in_threadpool(MyFilesHistoryService(my_files_collab_service).list_history,
            file_id=file_id, user_id=int(current_user.id))
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.get("/{file_id}/office/history/config")
async def get_history_config(file_id: str, current_user: User = Depends(require_permission(PERM_MY_FILES_READ))):
    settings = _settings_or_503()
    try:
        return await run_in_threadpool(MyFilesHistoryService(my_files_collab_service).viewer_config,
            settings=settings, file_id=file_id, user_id=int(current_user.id), username=current_user.username)
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.get("/{file_id}/office/history/{version_no}")
async def get_history_data(file_id: str, version_no: int, current_user: User = Depends(require_permission(PERM_MY_FILES_READ))):
    settings = _settings_or_503()
    try:
        return await run_in_threadpool(MyFilesHistoryService(my_files_collab_service).history_data,
            settings=settings, file_id=file_id, user_id=int(current_user.id), version_no=version_no)
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


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
        role=session["role"],
    )
    return {"config": config, "role": session["role"], "public_path": settings.public_path,
            "can_rename": session["role"] == oo.ROLE_OWNER, "can_manage_access": session["can_manage_access"]}


@router.post("/{file_id}/office/rename", response_model=OfficeRenameResponse)
async def rename_office_document(
    file_id: str,
    payload: OfficeRenameRequest,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> dict:
    settings = _settings_or_503()
    _enforce_trusted_browser_origin(request)
    try:
        return await run_in_threadpool(
            my_files_collab_service.rename_document, settings=settings, file_id=file_id,
            name=payload.name, actor=current_user, meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.get("/office/folders/{folder_id}/collaborators", response_model=OfficeCollaboratorsResponse)
async def list_office_folder_collaborators(
    folder_id: str,
    current_user: User = Depends(require_permission(PERM_MY_FILES_SHARE)),
) -> dict:
    try:
        items = await run_in_threadpool(
            my_files_collab_service.list_folder_collaborators, folder_id=folder_id, owner_user_id=int(current_user.id)
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    return {"items": items}


@router.put("/office/folders/{folder_id}/collaborators", response_model=OfficeCollaboratorsResponse)
async def set_office_folder_collaborators(
    folder_id: str,
    payload: OfficeCollaboratorsRequest,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_SHARE)),
) -> dict:
    _enforce_trusted_browser_origin(request)
    try:
        items = await run_in_threadpool(
            my_files_collab_service.set_folder_collaborators,
            folder_id=folder_id,
            owner_user_id=int(current_user.id),
            members=[(item.user_id, item.role) for item in payload.members]
            + [(uid, oo.ROLE_EDIT) for uid in payload.user_ids if uid not in {m.user_id for m in payload.members}],
            actor=current_user,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    return {"items": items}


@router.get("/{file_id}/office/collaborators", response_model=OfficeCollaboratorsResponse)
async def list_office_collaborators(
    file_id: str,
    current_user: User = Depends(require_permission(PERM_MY_FILES_SHARE)),
) -> dict:
    try:
        return await run_in_threadpool(
            my_files_collab_service.collaborator_settings, file_id=file_id, user_id=int(current_user.id)
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


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
            members=[(item.user_id, item.role) for item in payload.members]
            + [(uid, oo.ROLE_EDIT) for uid in payload.user_ids if uid not in {m.user_id for m in payload.members}],
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
        payload = await run_in_threadpool(
            my_files_collab_service.list_versions, file_id=file_id, user_id=int(current_user.id)
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    return payload


@router.get("/{file_id}/office/versions/{version_id}/download")
async def download_office_version(
    file_id: str,
    version_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_READ)),
):
    try:
        payload = await run_in_threadpool(
            my_files_collab_service.get_version_download,
            file_id=file_id,
            version_id=version_id,
            user_id=int(current_user.id),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    return _download_response(payload, request)


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
