"""Personal file storage API."""
from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response, StreamingResponse
from starlette.background import BackgroundTask

from backend.api.deps import require_permission
from backend.api.v1.my_files_download_grant_rate_limit import (
    enforce_download_grant_consume_limits,
    enforce_download_grant_mint_limits,
    enforce_download_grant_miss_limit,
)
from backend.api.v1.my_files_public_rate_limit import (
    enforce_public_download_limits,
    enforce_public_meta_limits,
    enforce_public_miss_limit,
    enforce_public_preview_content_limits,
    enforce_public_preview_limits,
)
from backend.api.v1.my_files_upload_rate_limit import enforce_upload_limits
from backend.config import config
from backend.models.auth import User
from backend.models.my_files import (
    MyFileAuditResponse,
    MyFileDownloadGrantResponse,
    MyFileFolderCreateRequest,
    MyFileFolderListResponse,
    MyFileFolderResponse,
    MyFileFolderUpdateRequest,
    MyFileListResponse,
    MyFileQuotaResponse,
    MyFileResponse,
    MyFileShareResponse,
    MyFileTrashResponse,
    MyFileUpdateRequest,
    MyFileUploadSessionCreateRequest,
    MyFileUploadSessionResponse,
    PublicMyFilePreviewResponse,
    PublicMyFileResponse,
    PublicMyFolderResponse,
)
from backend.services.authorization_service import (
    PERM_MY_FILES_AUDIT_READ,
    PERM_MY_FILES_READ,
    PERM_MY_FILES_SHARE,
    PERM_MY_FILES_WRITE,
)
from backend.services.my_files_service import (
    _UNSET,
    DEFAULT_RETENTION_DAYS,
    MAX_FILE_SIZE_BYTES,
    STORAGE_ZSTD,
    UPLOAD_CHUNK_SIZE_BYTES,
    MyFilesCapacityError,
    MyFilesConfigurationError,
    MyFilesNotFoundError,
    MyFilesRequestMeta,
    MyFilesValidationError,
    my_files_service,
)
from backend.utils.request_network import build_request_network_context


router = APIRouter()

_DOWNLOAD_SECURITY_HEADERS = {
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
}


def _request_meta(request: Request) -> MyFilesRequestMeta:
    network_context = build_request_network_context(request)
    return MyFilesRequestMeta(
        ip_address=network_context.client_ip,
        user_agent=str(request.headers.get("user-agent") or ""),
    )


def _set_public_response_headers(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"


def _enforce_trusted_browser_origin(request: Request) -> None:
    fetch_site = str(request.headers.get("sec-fetch-site") or "").strip().lower()
    if fetch_site == "cross-site":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cross-site request is not allowed")
    origin = str(request.headers.get("origin") or "").strip().rstrip("/")
    if not origin:
        return
    trusted_origins = {str(item or "").strip().rstrip("/") for item in config.app.cors_origins if str(item or "").strip()}
    if origin not in trusted_origins:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Request origin is not allowed")


def _service_error_to_http(exc: Exception) -> HTTPException:
    if isinstance(exc, MyFilesConfigurationError):
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    if isinstance(exc, MyFilesNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    if isinstance(exc, MyFilesValidationError):
        return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if isinstance(exc, MyFilesCapacityError):
        return HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc), headers={"Retry-After": "30"})
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="My files request failed")


def _service_error_to_secure_http(exc: Exception) -> HTTPException:
    error = _service_error_to_http(exc)
    headers = dict(error.headers or {})
    headers.update(_DOWNLOAD_SECURITY_HEADERS)
    error.headers = headers
    return error


async def _stream_request_to_spool(request: Request, spool_path: Path, *, expected_size: int) -> int:
    size = 0
    spool_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with spool_path.open("wb") as target:
            async for chunk in request.stream():
                if not chunk:
                    continue
                size += len(chunk)
                if size > MAX_FILE_SIZE_BYTES:
                    raise MyFilesValidationError("File exceeds upload limit")
                if size > int(expected_size):
                    raise MyFilesValidationError("Uploaded file size does not match reservation")
                target.write(chunk)
    except Exception:
        spool_path.unlink(missing_ok=True)
        raise
    if size != int(expected_size):
        spool_path.unlink(missing_ok=True)
        raise MyFilesValidationError("Uploaded file size does not match reservation")
    return size


async def _read_upload_chunk(request: Request) -> bytes:
    raw_content_length = str(request.headers.get("content-length") or "").strip()
    if raw_content_length:
        try:
            if int(raw_content_length) > UPLOAD_CHUNK_SIZE_BYTES:
                raise MyFilesValidationError("Upload chunk exceeds size limit")
        except ValueError as exc:
            raise MyFilesValidationError("Upload chunk content length is invalid") from exc

    payload = bytearray()
    async for chunk in request.stream():
        if not chunk:
            continue
        payload.extend(chunk)
        if len(payload) > UPLOAD_CHUNK_SIZE_BYTES:
            raise MyFilesValidationError("Upload chunk exceeds size limit")
    if not payload:
        raise MyFilesValidationError("Upload chunk is empty")
    return bytes(payload)


def _content_disposition(file_name: str, *, inline: bool = False) -> str:
    raw_name = str(file_name or "file.bin")
    safe_name = "".join(ch if 32 <= ord(ch) < 127 and ch not in '"\\' else "_" for ch in raw_name) or "file.bin"
    disposition = "inline" if inline else "attachment"
    return f'{disposition}; filename="{safe_name}"; filename*=UTF-8\'\'{quote(raw_name)}'


def _download_response(payload) -> Response:
    if payload.mode == STORAGE_ZSTD:
        headers = dict(_DOWNLOAD_SECURITY_HEADERS)
        headers["Content-Disposition"] = _content_disposition(payload.file_name)
        return StreamingResponse(
            my_files_service.iter_zstd_download(payload.path),
            media_type=payload.media_type,
            headers=headers,
        )
    return FileResponse(
        path=str(payload.path),
        media_type=payload.media_type,
        filename=payload.file_name,
        headers=_DOWNLOAD_SECURITY_HEADERS,
        background=BackgroundTask(payload.path.unlink, missing_ok=True) if getattr(payload, "cleanup_after", False) else None,
    )


@router.get("", response_model=MyFileListResponse)
@router.get("/", response_model=MyFileListResponse)
async def list_my_files(
    folder_id: str | None = Query(default=None, max_length=64),
    view: str = Query(default="", max_length=16),
    current_user: User = Depends(require_permission(PERM_MY_FILES_READ)),
) -> dict:
    try:
        return await run_in_threadpool(
            my_files_service.list_files,
            user_id=int(current_user.id),
            folder_id=folder_id,
            view=view,
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.get("/folders", response_model=MyFileFolderListResponse)
async def list_my_file_folders(
    current_user: User = Depends(require_permission(PERM_MY_FILES_READ)),
) -> dict:
    try:
        return {"items": await run_in_threadpool(my_files_service.list_folders, user_id=int(current_user.id))}
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.post("/folders", response_model=MyFileFolderResponse, status_code=status.HTTP_201_CREATED)
async def create_my_file_folder(
    payload: MyFileFolderCreateRequest,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> dict:
    _enforce_trusted_browser_origin(request)
    try:
        return await run_in_threadpool(
            my_files_service.create_folder,
            actor=current_user,
            name=payload.name,
            parent_id=payload.parent_id,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.patch("/folders/{folder_id}", response_model=MyFileFolderResponse)
async def update_my_file_folder(
    folder_id: str,
    payload: MyFileFolderUpdateRequest,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> dict:
    _enforce_trusted_browser_origin(request)
    try:
        fields_set = payload.model_fields_set
        return await run_in_threadpool(
            my_files_service.update_folder,
            actor=current_user,
            folder_id=folder_id,
            name=payload.name if "name" in fields_set else _UNSET,
            parent_id=payload.parent_id if "parent_id" in fields_set else _UNSET,
            is_favorite=payload.is_favorite if "is_favorite" in fields_set else _UNSET,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.post("/folders/{folder_id}/archive-grant", response_model=MyFileDownloadGrantResponse)
async def create_my_file_folder_archive_grant(
    folder_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_READ)),
) -> dict:
    _enforce_trusted_browser_origin(request)
    enforce_download_grant_mint_limits(request, user_id=int(current_user.id))
    try:
        return await run_in_threadpool(
            my_files_service.create_folder_archive_grant,
            folder_id=folder_id,
            user_id=int(current_user.id),
            actor=current_user,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_file_folder(
    folder_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> Response:
    _enforce_trusted_browser_origin(request)
    try:
        await run_in_threadpool(
            my_files_service.delete_folder,
            actor=current_user,
            folder_id=folder_id,
            meta=_request_meta(request),
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.post("/folders/{folder_id}/share", response_model=MyFileShareResponse)
async def create_my_file_folder_share(
    folder_id: str,
    request: Request,
    rotate: bool = Query(default=False),
    current_user: User = Depends(require_permission(PERM_MY_FILES_SHARE)),
) -> dict:
    _enforce_trusted_browser_origin(request)
    try:
        return await run_in_threadpool(
            my_files_service.create_folder_share,
            actor=current_user,
            folder_id=folder_id,
            rotate=rotate,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.delete("/folders/{folder_id}/share", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_my_file_folder_share(
    folder_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_SHARE)),
) -> Response:
    _enforce_trusted_browser_origin(request)
    try:
        await run_in_threadpool(
            my_files_service.revoke_folder_share,
            actor=current_user,
            folder_id=folder_id,
            meta=_request_meta(request),
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.get("/public-folders/{token}", response_model=PublicMyFolderResponse)
async def get_public_my_files_folder(
    token: str,
    request: Request,
    response: Response,
) -> dict:
    enforce_public_meta_limits(request, token)
    _set_public_response_headers(response)
    try:
        return await run_in_threadpool(my_files_service.get_public_folder, token=token)
    except MyFilesNotFoundError as exc:
        enforce_public_miss_limit(request)
        raise _service_error_to_secure_http(exc) from exc
    except Exception as exc:
        raise _service_error_to_secure_http(exc) from exc


@router.get("/public-folders/{token}/files/{file_id}/preview", response_model=PublicMyFilePreviewResponse)
async def get_public_folder_file_preview(
    token: str,
    file_id: str,
    request: Request,
    response: Response,
) -> dict:
    enforce_public_preview_limits(request, token)
    _set_public_response_headers(response)
    try:
        return await run_in_threadpool(
            my_files_service.get_public_folder_file_preview_meta,
            token=token,
            file_id=file_id,
        )
    except MyFilesNotFoundError as exc:
        enforce_public_miss_limit(request)
        raise _service_error_to_secure_http(exc) from exc
    except Exception as exc:
        raise _service_error_to_secure_http(exc) from exc


@router.get("/public-folders/{token}/files/{file_id}/preview/content")
async def download_public_folder_file_preview_content(
    token: str,
    file_id: str,
    request: Request,
    variant: str = Query(default="", max_length=16),
):
    enforce_public_preview_content_limits(request, token)
    try:
        content, media_type, filename = await run_in_threadpool(
            my_files_service.get_public_folder_file_preview_content,
            token=token,
            file_id=file_id,
            variant=variant,
        )
        headers = dict(_DOWNLOAD_SECURITY_HEADERS)
        headers["Content-Disposition"] = _content_disposition(filename, inline=True)
        headers["Cache-Control"] = "private, max-age=300"
        return Response(content=content, media_type=media_type, headers=headers)
    except MyFilesNotFoundError as exc:
        enforce_public_miss_limit(request)
        raise _service_error_to_secure_http(exc) from exc
    except Exception as exc:
        raise _service_error_to_secure_http(exc) from exc


@router.post("/public-folders/{token}/files/{file_id}/download-grant", response_model=MyFileDownloadGrantResponse)
async def create_public_folder_download_grant(
    token: str,
    file_id: str,
    request: Request,
    response: Response,
) -> dict:
    enforce_public_meta_limits(request, token)
    _set_public_response_headers(response)
    try:
        return await run_in_threadpool(
            my_files_service.create_public_folder_download_grant,
            token=token,
            file_id=file_id,
        )
    except MyFilesNotFoundError as exc:
        enforce_public_miss_limit(request)
        raise _service_error_to_secure_http(exc) from exc
    except Exception as exc:
        raise _service_error_to_secure_http(exc) from exc


@router.get("/trash", response_model=MyFileTrashResponse)
async def list_my_files_trash(
    current_user: User = Depends(require_permission(PERM_MY_FILES_READ)),
) -> dict:
    try:
        return await run_in_threadpool(my_files_service.list_trash, user_id=int(current_user.id))
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.post("/trash/empty", status_code=status.HTTP_204_NO_CONTENT)
async def empty_my_files_trash(
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> Response:
    _enforce_trusted_browser_origin(request)
    try:
        await run_in_threadpool(
            my_files_service.empty_trash,
            actor=current_user,
            meta=_request_meta(request),
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.post("/trash/files/{file_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
async def restore_my_file(
    file_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> Response:
    _enforce_trusted_browser_origin(request)
    try:
        await run_in_threadpool(
            my_files_service.restore_file,
            file_id=file_id,
            user_id=int(current_user.id),
            actor=current_user,
            meta=_request_meta(request),
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.post("/trash/folders/{folder_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
async def restore_my_file_folder(
    folder_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> Response:
    _enforce_trusted_browser_origin(request)
    try:
        await run_in_threadpool(
            my_files_service.restore_folder,
            actor=current_user,
            folder_id=folder_id,
            meta=_request_meta(request),
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.delete("/trash/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def purge_my_file(
    file_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> Response:
    _enforce_trusted_browser_origin(request)
    try:
        await run_in_threadpool(
            my_files_service.purge_file,
            file_id=file_id,
            user_id=int(current_user.id),
            actor=current_user,
            meta=_request_meta(request),
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.delete("/trash/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def purge_my_file_folder(
    folder_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> Response:
    _enforce_trusted_browser_origin(request)
    try:
        await run_in_threadpool(
            my_files_service.purge_folder,
            actor=current_user,
            folder_id=folder_id,
            meta=_request_meta(request),
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.get("/quota", response_model=MyFileQuotaResponse)
async def get_my_files_quota(current_user: User = Depends(require_permission(PERM_MY_FILES_READ))) -> dict:
    try:
        return await run_in_threadpool(my_files_service.quota, user_id=int(current_user.id))
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.get("/audit", response_model=MyFileAuditResponse)
async def list_my_files_audit(
    limit: int = Query(default=100, ge=1, le=500),
    _: User = Depends(require_permission(PERM_MY_FILES_AUDIT_READ)),
) -> dict:
    try:
        items = await run_in_threadpool(my_files_service.list_audit, limit=limit)
        return {"items": items}
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.post("", response_model=MyFileResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=MyFileResponse, status_code=status.HTTP_201_CREATED)
async def upload_my_file(
    request: Request,
    file_name: str = Query(..., min_length=1, max_length=512),
    file_size: int = Query(..., gt=0, le=MAX_FILE_SIZE_BYTES),
    retention_days: int = Query(DEFAULT_RETENTION_DAYS),
    folder_id: str | None = Query(default=None, max_length=64),
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> dict:
    _enforce_trusted_browser_origin(request)
    enforce_upload_limits(request, user_id=int(current_user.id))
    spool_path = my_files_service.new_spool_path(file_name)
    reserved_file_id = ""
    try:
        reserved = await run_in_threadpool(
            my_files_service.reserve_upload,
            actor=current_user,
            original_file_name=file_name,
            mime_type=request.headers.get("content-type"),
            spool_path=spool_path,
            expected_size_bytes=file_size,
            retention_days=retention_days,
            folder_id=folder_id,
            meta=_request_meta(request),
        )
        reserved_file_id = str(reserved["id"])
        size = await _stream_request_to_spool(request, spool_path, expected_size=file_size)
        return await run_in_threadpool(
            my_files_service.complete_upload,
            file_id=reserved_file_id,
            user_id=int(current_user.id),
            actual_size_bytes=size,
            actor=current_user,
            meta=_request_meta(request),
        )
    except BaseException as exc:
        spool_path.unlink(missing_ok=True)
        if reserved_file_id:
            try:
                await run_in_threadpool(
                    my_files_service.abort_upload,
                    file_id=reserved_file_id,
                    user_id=int(current_user.id),
                    error_text="Upload interrupted",
                    actor=current_user,
                    meta=_request_meta(request),
                )
            except Exception:
                pass
        if not isinstance(exc, Exception):
            raise
        raise _service_error_to_http(exc) from exc


@router.post(
    "/upload-sessions",
    response_model=MyFileUploadSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_my_file_upload_session(
    payload: MyFileUploadSessionCreateRequest,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> dict:
    _enforce_trusted_browser_origin(request)
    enforce_upload_limits(request, user_id=int(current_user.id))
    spool_path = my_files_service.new_spool_path(payload.file_name)
    try:
        reserved = await run_in_threadpool(
            my_files_service.reserve_upload,
            actor=current_user,
            original_file_name=payload.file_name,
            mime_type=payload.mime_type,
            spool_path=spool_path,
            expected_size_bytes=payload.file_size,
            retention_days=payload.retention_days,
            folder_id=payload.folder_id,
            meta=_request_meta(request),
        )
        return await run_in_threadpool(
            my_files_service.get_upload_session,
            file_id=str(reserved["id"]),
            user_id=int(current_user.id),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.get("/upload-sessions/{file_id}", response_model=MyFileUploadSessionResponse)
async def get_my_file_upload_session(
    file_id: str,
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> dict:
    try:
        return await run_in_threadpool(
            my_files_service.get_upload_session,
            file_id=file_id,
            user_id=int(current_user.id),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.put("/upload-sessions/{file_id}/chunks", response_model=MyFileUploadSessionResponse)
async def upload_my_file_chunk(
    file_id: str,
    request: Request,
    offset: int = Query(..., ge=0),
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> dict:
    _enforce_trusted_browser_origin(request)
    try:
        payload = await _read_upload_chunk(request)
        return await run_in_threadpool(
            my_files_service.append_upload_chunk,
            file_id=file_id,
            user_id=int(current_user.id),
            offset=offset,
            payload=payload,
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.post("/upload-sessions/{file_id}/complete", response_model=MyFileResponse)
async def complete_my_file_upload_session(
    file_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> dict:
    _enforce_trusted_browser_origin(request)
    try:
        session = await run_in_threadpool(
            my_files_service.get_upload_session,
            file_id=file_id,
            user_id=int(current_user.id),
        )
        return await run_in_threadpool(
            my_files_service.complete_upload,
            file_id=file_id,
            user_id=int(current_user.id),
            actual_size_bytes=int(session["uploaded_bytes"]),
            actor=current_user,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.delete("/upload-sessions/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_my_file_upload_session(
    file_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
    reason: str | None = Query(default=None, max_length=2000),
) -> Response:
    _enforce_trusted_browser_origin(request)
    error_text = str(reason or "").strip() or "Upload cancelled"
    try:
        await run_in_threadpool(
            my_files_service.abort_upload,
            file_id=file_id,
            user_id=int(current_user.id),
            error_text=error_text,
            actor=current_user,
            meta=_request_meta(request),
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.get("/public/{token}", response_model=PublicMyFileResponse)
async def get_public_my_file(
    token: str,
    request: Request,
    response: Response,
) -> dict:
    enforce_public_meta_limits(request, token)
    _set_public_response_headers(response)
    try:
        return await run_in_threadpool(my_files_service.get_public_file, token=token)
    except MyFilesNotFoundError as exc:
        enforce_public_miss_limit(request)
        raise _service_error_to_secure_http(exc) from exc
    except Exception as exc:
        raise _service_error_to_secure_http(exc) from exc


@router.get("/download-grant/{token}")
async def download_my_file_by_grant(token: str, request: Request):
    enforce_download_grant_consume_limits(request, token)
    try:
        payload = await run_in_threadpool(
            my_files_service.consume_download_grant,
            token=token,
            meta=_request_meta(request),
        )
        return _download_response(payload)
    except MyFilesNotFoundError as exc:
        enforce_download_grant_miss_limit(request)
        raise _service_error_to_secure_http(exc) from exc
    except Exception as exc:
        raise _service_error_to_secure_http(exc) from exc


@router.get("/public/{token}/preview", response_model=PublicMyFilePreviewResponse)
async def get_public_my_file_preview(
    token: str,
    request: Request,
    response: Response,
) -> dict:
    enforce_public_preview_limits(request, token)
    _set_public_response_headers(response)
    try:
        return await run_in_threadpool(my_files_service.get_public_preview_meta, token=token)
    except MyFilesNotFoundError as exc:
        enforce_public_miss_limit(request)
        raise _service_error_to_secure_http(exc) from exc
    except Exception as exc:
        raise _service_error_to_secure_http(exc) from exc


@router.get("/public/{token}/preview/content")
async def download_public_my_file_preview_content(
    token: str,
    request: Request,
    variant: str = Query(default="", max_length=16),
):
    enforce_public_preview_content_limits(request, token)
    try:
        content, media_type, filename = await run_in_threadpool(
            my_files_service.get_public_preview_content,
            token=token,
            variant=variant,
        )
        headers = dict(_DOWNLOAD_SECURITY_HEADERS)
        headers["Content-Disposition"] = _content_disposition(filename, inline=True)
        headers["Cache-Control"] = "private, max-age=300"
        return Response(content=content, media_type=media_type, headers=headers)
    except MyFilesNotFoundError as exc:
        enforce_public_miss_limit(request)
        raise _service_error_to_secure_http(exc) from exc
    except Exception as exc:
        raise _service_error_to_secure_http(exc) from exc


@router.get("/public/{token}/download")
async def download_public_my_file(
    token: str,
    request: Request,
):
    enforce_public_download_limits(request, token)
    try:
        payload = await run_in_threadpool(
            my_files_service.get_public_download,
            token=token,
            meta=_request_meta(request),
        )
        return _download_response(payload)
    except MyFilesNotFoundError as exc:
        enforce_public_miss_limit(request)
        raise _service_error_to_secure_http(exc) from exc
    except Exception as exc:
        raise _service_error_to_secure_http(exc) from exc


@router.get("/{file_id}/preview", response_model=PublicMyFilePreviewResponse)
async def get_my_file_preview(
    file_id: str,
    current_user: User = Depends(require_permission(PERM_MY_FILES_READ)),
) -> dict:
    try:
        return await run_in_threadpool(
            my_files_service.get_file_preview_meta,
            file_id=file_id,
            user_id=int(current_user.id),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.get("/{file_id}/preview/content")
async def download_my_file_preview_content(
    file_id: str,
    current_user: User = Depends(require_permission(PERM_MY_FILES_READ)),
    variant: str = Query(default="", max_length=16),
):
    try:
        content, media_type, filename = await run_in_threadpool(
            my_files_service.get_file_preview_content,
            file_id=file_id,
            user_id=int(current_user.id),
            variant=variant,
        )
        headers = dict(_DOWNLOAD_SECURITY_HEADERS)
        headers["Content-Disposition"] = _content_disposition(filename, inline=True)
        headers["Cache-Control"] = "private, max-age=300"
        return Response(content=content, media_type=media_type, headers=headers)
    except Exception as exc:
        raise _service_error_to_secure_http(exc) from exc


@router.get("/{file_id}/preview/source")
async def download_my_file_preview_source(
    file_id: str,
    current_user: User = Depends(require_permission(PERM_MY_FILES_READ)),
):
    try:
        content, media_type, filename = await run_in_threadpool(
            my_files_service.get_file_preview_source,
            file_id=file_id,
            user_id=int(current_user.id),
        )
        headers = dict(_DOWNLOAD_SECURITY_HEADERS)
        headers["Content-Disposition"] = _content_disposition(filename, inline=True)
        headers["Cache-Control"] = "private, max-age=300"
        return Response(content=content, media_type=media_type, headers=headers)
    except Exception as exc:
        raise _service_error_to_secure_http(exc) from exc


@router.get("/{file_id}/download")
async def download_my_file(
    file_id: str,
    current_user: User = Depends(require_permission(PERM_MY_FILES_READ)),
):
    # Legacy blob/XHR path disabled: force clients to use one-time download-grant after deploy.
    raise HTTPException(
        status_code=410,
        detail="Обновите страницу (Ctrl+F5) и скачайте файл снова.",
    )


@router.post("/{file_id}/download-grant", response_model=MyFileDownloadGrantResponse)
async def create_my_file_download_grant(
    file_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_READ)),
) -> dict:
    _enforce_trusted_browser_origin(request)
    enforce_download_grant_mint_limits(request, user_id=int(current_user.id))
    try:
        payload = await run_in_threadpool(
            my_files_service.create_download_grant,
            file_id=file_id,
            user_id=int(current_user.id),
            actor=current_user,
            meta=_request_meta(request),
        )
        return {
            "download_path": payload["download_path"],
            "expires_at": payload.get("expires_at"),
            "expires_in_seconds": int(payload.get("expires_in_seconds") or 0),
        }
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.post("/{file_id}/share", response_model=MyFileShareResponse)
async def create_my_file_share(
    file_id: str,
    request: Request,
    rotate: bool = Query(False, description="Issue a new public link and invalidate the previous one"),
    current_user: User = Depends(require_permission(PERM_MY_FILES_SHARE)),
) -> dict:
    _enforce_trusted_browser_origin(request)
    try:
        return await run_in_threadpool(
            my_files_service.create_share,
            file_id=file_id,
            user_id=int(current_user.id),
            rotate=rotate,
            actor=current_user,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.delete("/{file_id}/share", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_my_file_share(
    file_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_SHARE)),
) -> Response:
    _enforce_trusted_browser_origin(request)
    try:
        await run_in_threadpool(
            my_files_service.revoke_share,
            file_id=file_id,
            user_id=int(current_user.id),
            actor=current_user,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{file_id}", response_model=MyFileResponse)
async def update_my_file(
    file_id: str,
    payload: MyFileUpdateRequest,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> dict:
    _enforce_trusted_browser_origin(request)
    try:
        fields_set = payload.model_fields_set
        return await run_in_threadpool(
            my_files_service.update_file,
            actor=current_user,
            file_id=file_id,
            name=payload.name if "name" in fields_set else _UNSET,
            folder_id=payload.folder_id if "folder_id" in fields_set else _UNSET,
            is_favorite=payload.is_favorite if "is_favorite" in fields_set else _UNSET,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_file(
    file_id: str,
    request: Request,
    current_user: User = Depends(require_permission(PERM_MY_FILES_WRITE)),
) -> Response:
    _enforce_trusted_browser_origin(request)
    try:
        await run_in_threadpool(
            my_files_service.delete_file,
            file_id=file_id,
            user_id=int(current_user.id),
            actor=current_user,
            meta=_request_meta(request),
        )
    except Exception as exc:
        raise _service_error_to_http(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
