"""Authenticated API for personal 1C Document Management access."""
from __future__ import annotations

import uuid
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from backend.api.deps import require_permission
from backend.models.auth import User
from backend.models.docflow import (
    DocflowAssignmentAssigneeList,
    DocflowAssignmentCapability,
    DocflowAssignmentCommandResponse,
    DocflowAssignmentCreateRequest,
    DocflowAssignmentDocumentList,
    DocflowConnectionTestResponse,
    DocflowCommandResponse,
    DocflowCredentialProfile,
    DocflowCredentialsInput,
    DocflowInboxSummary,
    DocflowMetadataResponse,
    DocflowTaskDetail,
    DocflowTaskActionRequest,
    DocflowTaskListResponse,
)
from backend.services.authorization_service import (
    PERM_DOCFLOW_ACT,
    PERM_DOCFLOW_ADMIN,
    PERM_DOCFLOW_CREATE,
    PERM_DOCFLOW_READ,
    authorization_service,
)
from backend.services.docflow_service import DocflowServiceError, docflow_service


router = APIRouter()


def _correlation_id(request: Request) -> str:
    raw = str(
        getattr(request.state, "correlation_id", "")
        or request.headers.get("X-Correlation-ID")
        or request.headers.get("X-Request-ID")
        or uuid.uuid4().hex
    ).strip()
    return raw[:64] or uuid.uuid4().hex


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


def _has_permission(user: User, permission: str) -> bool:
    return authorization_service.has_permission(
        user.role,
        permission,
        use_custom_permissions=bool(user.use_custom_permissions),
        custom_permissions=user.custom_permissions,
    )


def _content_disposition(filename: str, *, disposition: str = "inline") -> str:
    normalized = str(filename or "document.bin").replace("\r", "_").replace("\n", "_")[:240]
    ascii_name = "".join(char if ord(char) < 128 and char not in {'"', '\\'} else "_" for char in normalized)
    encoded = quote(normalized, safe="")
    return f'{disposition}; filename="{ascii_name or "document.bin"}"; filename*=UTF-8\'\'{encoded}'


def _raise_service_error(exc: DocflowServiceError, correlation_id: str) -> None:
    raise HTTPException(
        status_code=int(getattr(exc, "status_code", 500) or 500),
        detail={
            "code": str(getattr(exc, "code", "DOCFLOW_ERROR") or "DOCFLOW_ERROR"),
            "message": str(exc),
            "correlation_id": correlation_id,
        },
    ) from exc


@router.get("/profile", response_model=DocflowCredentialProfile)
async def get_my_docflow_profile(
    response: Response,
    current_user: User = Depends(require_permission(PERM_DOCFLOW_READ)),
) -> DocflowCredentialProfile:
    _no_store(response)
    payload = await docflow_service.get_profile(user_id=int(current_user.id))
    return DocflowCredentialProfile.model_validate(payload)


@router.post("/profile/test", response_model=DocflowConnectionTestResponse)
async def test_my_docflow_credentials(
    payload: DocflowCredentialsInput,
    request: Request,
    response: Response,
    current_user: User = Depends(require_permission(PERM_DOCFLOW_READ)),
) -> DocflowConnectionTestResponse:
    correlation = _correlation_id(request)
    _no_store(response)
    try:
        result = await docflow_service.test_credentials(
            user_id=int(current_user.id),
            login=payload.login,
            password=payload.password.get_secret_value(),
            correlation_id=correlation,
        )
    except DocflowServiceError as exc:
        _raise_service_error(exc, correlation)
    return DocflowConnectionTestResponse.model_validate(result)


@router.put("/profile/credentials", response_model=DocflowCredentialProfile)
async def save_my_docflow_credentials(
    payload: DocflowCredentialsInput,
    request: Request,
    response: Response,
    current_user: User = Depends(require_permission(PERM_DOCFLOW_READ)),
) -> DocflowCredentialProfile:
    correlation = _correlation_id(request)
    _no_store(response)
    try:
        result = await docflow_service.save_credentials(
            user_id=int(current_user.id),
            login=payload.login,
            password=payload.password.get_secret_value(),
            correlation_id=correlation,
        )
    except DocflowServiceError as exc:
        _raise_service_error(exc, correlation)
    return DocflowCredentialProfile.model_validate(result)


@router.delete("/profile/credentials", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_docflow_credentials(
    request: Request,
    response: Response,
    current_user: User = Depends(require_permission(PERM_DOCFLOW_READ)),
) -> None:
    _no_store(response)
    await docflow_service.delete_credentials(
        user_id=int(current_user.id),
        correlation_id=_correlation_id(request),
    )


@router.get("/tasks", response_model=DocflowTaskListResponse)
async def list_my_docflow_tasks(
    request: Request,
    response: Response,
    scope: Literal["inbox", "completed", "all"] = Query("inbox"),
    q: str = Query("", max_length=200),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(require_permission(PERM_DOCFLOW_READ)),
) -> DocflowTaskListResponse:
    correlation = _correlation_id(request)
    _no_store(response)
    try:
        result = await docflow_service.list_tasks(
            user_id=int(current_user.id),
            scope=scope,
            search=q,
            limit=limit,
            correlation_id=correlation,
        )
    except DocflowServiceError as exc:
        _raise_service_error(exc, correlation)
    return DocflowTaskListResponse.model_validate(result)


@router.get("/inbox-summary", response_model=DocflowInboxSummary)
async def get_my_docflow_inbox_summary(
    request: Request,
    response: Response,
    current_user: User = Depends(require_permission(PERM_DOCFLOW_READ)),
) -> DocflowInboxSummary:
    _no_store(response)
    result = await docflow_service.inbox_summary(
        user_id=int(current_user.id),
        correlation_id=_correlation_id(request),
    )
    return DocflowInboxSummary.model_validate(result)


@router.get("/assignments/capability", response_model=DocflowAssignmentCapability)
async def get_my_docflow_assignment_capability(
    response: Response,
    current_user: User = Depends(require_permission(PERM_DOCFLOW_CREATE)),
) -> DocflowAssignmentCapability:
    _no_store(response)
    return DocflowAssignmentCapability.model_validate(
        await docflow_service.assignment_capability(user_id=int(current_user.id))
    )


@router.get("/assignments/documents", response_model=DocflowAssignmentDocumentList)
async def search_my_docflow_assignment_documents(
    request: Request,
    response: Response,
    q: str = Query("", max_length=200),
    limit: int = Query(20, ge=1, le=50),
    current_user: User = Depends(require_permission(PERM_DOCFLOW_CREATE)),
) -> DocflowAssignmentDocumentList:
    correlation = _correlation_id(request)
    _no_store(response)
    try:
        result = await docflow_service.search_assignment_documents(
            user_id=int(current_user.id),
            search=q,
            limit=limit,
        )
    except DocflowServiceError as exc:
        _raise_service_error(exc, correlation)
    return DocflowAssignmentDocumentList.model_validate(result)


@router.get("/assignments/assignees", response_model=DocflowAssignmentAssigneeList)
async def search_my_docflow_assignment_assignees(
    request: Request,
    response: Response,
    q: str = Query("", max_length=200),
    limit: int = Query(20, ge=1, le=50),
    current_user: User = Depends(require_permission(PERM_DOCFLOW_CREATE)),
) -> DocflowAssignmentAssigneeList:
    correlation = _correlation_id(request)
    _no_store(response)
    try:
        result = await docflow_service.search_assignment_assignees(
            user_id=int(current_user.id),
            search=q,
            limit=limit,
        )
    except DocflowServiceError as exc:
        _raise_service_error(exc, correlation)
    return DocflowAssignmentAssigneeList.model_validate(result)


@router.post("/assignments", response_model=DocflowAssignmentCommandResponse)
async def create_my_docflow_assignment(
    payload: DocflowAssignmentCreateRequest,
    request: Request,
    response: Response,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=8, max_length=128),
    current_user: User = Depends(require_permission(PERM_DOCFLOW_CREATE)),
) -> DocflowAssignmentCommandResponse:
    correlation = _correlation_id(request)
    _no_store(response)
    try:
        result = await docflow_service.create_assignment(
            user_id=int(current_user.id),
            document_type=payload.document_type,
            document_ref=payload.document_ref,
            assignee_ref=payload.assignee_ref,
            controller_ref=payload.controller_ref,
            due_at=payload.due_at,
            importance=payload.importance,
            title=payload.title,
            description=payload.description,
            idempotency_key=idempotency_key,
            correlation_id=correlation,
        )
    except DocflowServiceError as exc:
        _raise_service_error(exc, correlation)
    if str(result.get("status") or "") in {"pending", "state_unknown"}:
        response.status_code = status.HTTP_202_ACCEPTED
    return DocflowAssignmentCommandResponse.model_validate(result)


@router.get("/assignments/commands/{command_id}", response_model=DocflowAssignmentCommandResponse)
async def get_my_docflow_assignment_command(
    command_id: uuid.UUID,
    request: Request,
    response: Response,
    current_user: User = Depends(require_permission(PERM_DOCFLOW_CREATE)),
) -> DocflowAssignmentCommandResponse:
    correlation = _correlation_id(request)
    _no_store(response)
    try:
        result = await docflow_service.get_assignment_command(
            user_id=int(current_user.id),
            command_id=command_id.hex,
            correlation_id=correlation,
        )
    except DocflowServiceError as exc:
        _raise_service_error(exc, correlation)
    if str(result.get("status") or "") in {"pending", "state_unknown"}:
        response.status_code = status.HTTP_202_ACCEPTED
    return DocflowAssignmentCommandResponse.model_validate(result)


@router.get("/tasks/{task_ref}", response_model=DocflowTaskDetail)
async def get_my_docflow_task(
    task_ref: uuid.UUID,
    request: Request,
    response: Response,
    current_user: User = Depends(require_permission(PERM_DOCFLOW_READ)),
) -> DocflowTaskDetail:
    correlation = _correlation_id(request)
    _no_store(response)
    try:
        result = await docflow_service.get_task_detail(
            user_id=int(current_user.id),
            task_ref=str(task_ref),
            correlation_id=correlation,
            can_act=_has_permission(current_user, PERM_DOCFLOW_ACT),
        )
    except DocflowServiceError as exc:
        _raise_service_error(exc, correlation)
    return DocflowTaskDetail.model_validate(result)


@router.post("/tasks/{task_ref}/actions", response_model=DocflowCommandResponse)
async def apply_my_docflow_task_action(
    task_ref: uuid.UUID,
    payload: DocflowTaskActionRequest,
    request: Request,
    response: Response,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=8, max_length=128),
    current_user: User = Depends(require_permission(PERM_DOCFLOW_ACT)),
) -> DocflowCommandResponse:
    correlation = _correlation_id(request)
    _no_store(response)
    try:
        result = await docflow_service.apply_task_action(
            user_id=int(current_user.id),
            task_ref=str(task_ref),
            action=payload.action,
            comment=payload.comment,
            state_token=payload.state_token,
            idempotency_key=idempotency_key,
            correlation_id=correlation,
        )
    except DocflowServiceError as exc:
        _raise_service_error(exc, correlation)
    if str(result.get("status") or "") in {"pending", "state_unknown"}:
        response.status_code = status.HTTP_202_ACCEPTED
    return DocflowCommandResponse.model_validate(result)


@router.get("/commands/{command_id}", response_model=DocflowCommandResponse)
async def get_my_docflow_command(
    command_id: uuid.UUID,
    request: Request,
    response: Response,
    current_user: User = Depends(require_permission(PERM_DOCFLOW_ACT)),
) -> DocflowCommandResponse:
    correlation = _correlation_id(request)
    _no_store(response)
    try:
        result = await docflow_service.get_command(
            user_id=int(current_user.id),
            command_id=command_id.hex,
            correlation_id=correlation,
        )
    except DocflowServiceError as exc:
        _raise_service_error(exc, correlation)
    if str(result.get("status") or "") in {"pending", "state_unknown"}:
        response.status_code = status.HTTP_202_ACCEPTED
    return DocflowCommandResponse.model_validate(result)


@router.get("/tasks/{task_ref}/files/{file_ref}/content")
async def download_my_docflow_task_file(
    task_ref: uuid.UUID,
    file_ref: uuid.UUID,
    request: Request,
    disposition: Literal["inline", "attachment"] = Query("attachment"),
    current_user: User = Depends(require_permission(PERM_DOCFLOW_READ)),
):
    correlation = _correlation_id(request)
    try:
        exported = await docflow_service.export_file(
            user_id=int(current_user.id),
            task_ref=str(task_ref),
            file_ref=str(file_ref),
            correlation_id=correlation,
        )
    except DocflowServiceError as exc:
        _raise_service_error(exc, correlation)
    path = str(exported["temporary_path"])
    return FileResponse(
        path=path,
        filename=str(exported.get("name") or "document.bin"),
        media_type=str(exported.get("content_type") or "application/octet-stream"),
        content_disposition_type=disposition,
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
        background=BackgroundTask(docflow_service.remove_exported_file, path),
    )


@router.get("/tasks/{task_ref}/files/{file_ref}/preview/pdf")
async def preview_my_docflow_task_file(
    task_ref: uuid.UUID,
    file_ref: uuid.UUID,
    request: Request,
    current_user: User = Depends(require_permission(PERM_DOCFLOW_READ)),
):
    correlation = _correlation_id(request)
    try:
        preview = await docflow_service.build_file_preview(
            user_id=int(current_user.id),
            task_ref=str(task_ref),
            file_ref=str(file_ref),
            correlation_id=correlation,
        )
    except DocflowServiceError as exc:
        _raise_service_error(exc, correlation)
    filename = str(preview.get("filename") or "preview.pdf")
    return Response(
        content=preview["content"],
        media_type="application/pdf",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": _content_disposition(filename),
            "X-Content-Type-Options": "nosniff",
            "X-Docflow-Preview-Source-Kind": str(preview.get("source_kind") or ""),
            "X-Docflow-Preview-Page-Count": str(int(preview.get("page_count") or 0)),
        },
    )


@router.get("/metadata", response_model=DocflowMetadataResponse)
async def get_my_docflow_metadata(
    request: Request,
    response: Response,
    current_user: User = Depends(require_permission(PERM_DOCFLOW_ADMIN)),
) -> DocflowMetadataResponse:
    correlation = _correlation_id(request)
    _no_store(response)
    try:
        result = await docflow_service.metadata(user_id=int(current_user.id))
    except DocflowServiceError as exc:
        _raise_service_error(exc, correlation)
    return DocflowMetadataResponse.model_validate(result)
