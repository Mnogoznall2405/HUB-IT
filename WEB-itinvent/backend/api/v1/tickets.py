"""
FastAPI router for the Tickets/Logistics module.

Provides REST API endpoints for managing ticket requests, comments, and history.
Registered in main.py with prefix /api/v1/tickets and tag "Tickets".
"""
from __future__ import annotations

from dataclasses import asdict
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from backend.api.deps import require_permission
from backend.models.auth import User
from backend.services.authorization_service import (
    PERM_TICKETS_READ,
    PERM_TICKETS_WRITE,
)
from backend.services.tickets_import_service import ImportSettings, TicketsImportService
from backend.services.tickets_notification_service import tickets_notification_service
from backend.services.tickets_service import (
    CreateRequestDTO,
    FinOpFilters,
    Pagination,
    PagedResult,
    RequestFilters,
    TicketsConflictError,
    TicketsNotFoundError,
    TicketsTransitionError,
    TicketsValidationError,
    UpdateRequestDTO,
    tickets_service,
)


router = APIRouter()
tickets_import_service = TicketsImportService()
MAX_IMPORT_UPLOAD_SIZE = 50 * 1024 * 1024


# ---------------------------------------------------------------------------
# Pydantic request/response models
# ---------------------------------------------------------------------------


class CreateRequestBody(BaseModel):
    """Body for POST /requests."""

    employee_id: int
    object_id: int
    status: str = "new"
    assignee_id: Optional[int] = None
    submitted_at: Optional[str] = None
    departure_date: Optional[str] = None
    arrival_date: Optional[str] = None
    route: Optional[str] = Field(None, max_length=500)
    total_cost: Optional[str] = None  # Decimal as string
    is_urgent: bool = False
    source: str = "manual"


class UpdateRequestBody(BaseModel):
    """Body for PATCH /requests/{id}."""

    assignee_id: Optional[int] = None
    departure_date: Optional[str] = None
    arrival_date: Optional[str] = None
    route: Optional[str] = Field(None, max_length=500)
    total_cost: Optional[str] = None  # Decimal as string
    is_urgent: Optional[bool] = None
    needs_review: Optional[bool] = None


class ChangeStatusBody(BaseModel):
    """Body for PATCH /requests/{id}/status."""

    new_status: str
    expected_version: int
    comment: Optional[str] = Field(None, max_length=500)


class CreateCommentBody(BaseModel):
    """Body for POST /requests/{id}/comments."""

    text: str = Field(..., min_length=1, max_length=2000)
    comment_type: str = "normal"


class ObjectBody(BaseModel):
    """Body for object create/update endpoints."""

    code: Optional[str] = None
    name: Optional[str] = None
    short_name: Optional[str] = None
    region: Optional[str] = None
    default_assignee_id: Optional[int] = None
    is_active: Optional[bool] = None


class EmployeeBody(BaseModel):
    """Body for employee create/update endpoints."""

    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    status: Optional[str] = None
    app_user_id: Optional[int] = None
    date_of_birth: Optional[str] = None
    documents: list[dict[str, Any]] = Field(default_factory=list)


class ImportExecuteBody(BaseModel):
    """Body for POST /import/{job_id}/execute."""

    color_map: dict[str, str] = Field(default_factory=dict)
    duplicate_strategy: str = "skip"
    sheet_object_map: dict[str, int] = Field(default_factory=dict)


class FinancialOpBody(BaseModel):
    """Body for financial operation create/update endpoints."""

    request_id: Optional[int] = None
    employee_id: Optional[int] = None
    object_id: Optional[int] = None
    op_type: Optional[str] = None
    amount: Optional[str] = None
    reason: Optional[str] = None
    refund_status: Optional[str] = None
    op_date: Optional[str] = None


class NotificationRuleBody(BaseModel):
    """Body for PATCH /notifications/rules/{id}."""

    is_enabled: Optional[bool] = None
    threshold_days: Optional[int] = Field(None, ge=0, le=365)
    notify_roles: Optional[str] = None


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def _parse_decimal(value: Optional[str]) -> Decimal:
    """Parse a string to Decimal, defaulting to 0.00."""
    if value is None:
        return Decimal("0.00")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid decimal value for total_cost",
        )


def _parse_int_list(value: Optional[str]) -> list[int]:
    """Parse comma-separated string of ints."""
    if not value:
        return []
    parts = [p.strip() for p in value.split(",") if p.strip()]
    result = []
    for p in parts:
        try:
            result.append(int(p))
        except ValueError:
            pass
    return result


def _parse_str_list(value: Optional[str]) -> list[str]:
    """Parse comma-separated string."""
    if not value:
        return []
    return [p.strip() for p in value.split(",") if p.strip()]


def _parse_assignee_list(value: Optional[str]) -> list[int | None]:
    """Parse comma-separated assignee IDs. 'null' or 'none' means unassigned."""
    if not value:
        return []
    parts = [p.strip() for p in value.split(",") if p.strip()]
    result: list[int | None] = []
    for p in parts:
        if p.lower() in ("null", "none"):
            result.append(None)
        else:
            try:
                result.append(int(p))
            except ValueError:
                pass
    return result


def _parse_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return default


def _user_dict(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "role": user.role,
        "permissions": list(user.permissions or []),
        "username": user.username,
    }


def _is_admin(user: User) -> bool:
    return str(user.role or "").strip().lower() == "admin"


def _admin_required(user: User) -> None:
    if not _is_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )


def _paged_payload(result: PagedResult) -> dict[str, Any]:
    return {
        "items": result.items,
        "total": result.total,
        "page": result.page,
        "page_size": result.page_size,
        "total_pages": result.total_pages,
    }


def _validation_error(exc: TicketsValidationError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=exc.errors,
    )


def _not_found(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=str(exc),
    )


# ---------------------------------------------------------------------------
# Request endpoints
# ---------------------------------------------------------------------------


@router.get("/requests")
async def list_requests(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1),
    object_ids: Optional[str] = Query(None, description="Comma-separated object IDs"),
    statuses: Optional[str] = Query(None, description="Comma-separated statuses"),
    assignee_ids: Optional[str] = Query(None, description="Comma-separated assignee IDs, 'null' for unassigned"),
    search: Optional[str] = Query(None, description="Search text (min 2 chars)"),
    sort_field: str = Query("created_at", description="Sort field"),
    sort_dir: str = Query("desc", description="Sort direction: asc or desc"),
    current_user: User = Depends(require_permission(PERM_TICKETS_READ)),
):
    """List ticket requests with pagination, sorting, and filters."""
    filters = RequestFilters(
        object_ids=_parse_int_list(object_ids),
        statuses=_parse_str_list(statuses),
        assignee_ids=_parse_assignee_list(assignee_ids),
        search=search or "",
        sort_field=sort_field,
        sort_dir=sort_dir,
    )
    pagination = Pagination(page=page, page_size=page_size)

    result = tickets_service.list_requests(filters=filters, pagination=pagination)
    return _paged_payload(result)


@router.get("/requests/{request_id}")
async def get_request(
    request_id: int,
    current_user: User = Depends(require_permission(PERM_TICKETS_READ)),
):
    """Get a single ticket request by ID."""
    result = tickets_service.get_request(request_id)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Request with id={request_id} not found",
        )
    return result


@router.post("/requests", status_code=status.HTTP_201_CREATED)
async def create_request(
    body: CreateRequestBody,
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    """Create a new ticket request."""
    from backend.services.tickets_service import _parse_date

    try:
        dto = CreateRequestDTO(
            employee_id=body.employee_id,
            object_id=body.object_id,
            status=body.status,
            assignee_id=body.assignee_id,
            submitted_at=_parse_date(body.submitted_at),
            departure_date=_parse_date(body.departure_date),
            arrival_date=_parse_date(body.arrival_date),
            route=body.route,
            total_cost=_parse_decimal(body.total_cost),
            is_urgent=body.is_urgent,
            source=body.source,
        )
        result = tickets_service.create_request(dto)
        return result
    except TicketsValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors,
        ) from exc
    except TicketsNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.patch("/requests/{request_id}")
async def update_request(
    request_id: int,
    body: UpdateRequestBody,
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    """Update fields of an existing ticket request."""
    from backend.services.tickets_service import _parse_date

    # Build UpdateRequestDTO with only provided fields
    provided_fields: set = set()
    raw = body.model_dump(exclude_unset=True)

    dto = UpdateRequestDTO()
    if "assignee_id" in raw:
        dto.assignee_id = raw["assignee_id"]
        provided_fields.add("assignee_id")
    if "departure_date" in raw:
        dto.departure_date = _parse_date(raw["departure_date"])
        provided_fields.add("departure_date")
    if "arrival_date" in raw:
        dto.arrival_date = _parse_date(raw["arrival_date"])
        provided_fields.add("arrival_date")
    if "route" in raw:
        dto.route = raw["route"]
        provided_fields.add("route")
    if "total_cost" in raw:
        dto.total_cost = _parse_decimal(raw["total_cost"])
        provided_fields.add("total_cost")
    if "is_urgent" in raw:
        dto.is_urgent = raw["is_urgent"]
        provided_fields.add("is_urgent")
    if "needs_review" in raw:
        dto.needs_review = raw["needs_review"]
        provided_fields.add("needs_review")

    dto._provided_fields = provided_fields

    try:
        result = tickets_service.update_request(
            request_id=request_id,
            data=dto,
            user_id=current_user.id,
            change_source="manual",
        )
    except TicketsValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors,
        ) from exc

    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Request with id={request_id} not found",
        )
    return result


@router.patch("/requests/{request_id}/status")
async def change_request_status(
    request_id: int,
    body: ChangeStatusBody,
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    """Change the status of a ticket request with optimistic locking."""
    try:
        result = tickets_service.change_status(
            request_id=request_id,
            new_status=body.new_status,
            user={"id": current_user.id, "role": current_user.role},
            expected_version=body.expected_version,
            comment=body.comment,
        )
        return result
    except TicketsNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except TicketsConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "Version conflict: request was modified by another user",
                "current_version": exc.current_version,
                "expected_version": exc.expected_version,
                "current_status": exc.current_status,
            },
        ) from exc
    except TicketsTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": f"Transition from '{exc.current_status}' to '{exc.new_status}' is not allowed",
                "current_status": exc.current_status,
                "new_status": exc.new_status,
                "allowed_transitions": exc.allowed,
            },
        ) from exc
    except TicketsValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors,
        ) from exc


# ---------------------------------------------------------------------------
# Comment endpoints
# ---------------------------------------------------------------------------


@router.post("/requests/{request_id}/comments", status_code=status.HTTP_201_CREATED)
async def add_comment(
    request_id: int,
    body: CreateCommentBody,
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    """Add a comment to a ticket request."""
    try:
        result = tickets_service.add_comment(
            request_id=request_id,
            text=body.text,
            comment_type=body.comment_type,
            user_id=current_user.id,
        )
        return result
    except TicketsNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except TicketsValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors,
        ) from exc


@router.get("/requests/{request_id}/comments")
async def get_comments(
    request_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1),
    current_user: User = Depends(require_permission(PERM_TICKETS_READ)),
):
    """Get comments for a ticket request in chronological order."""
    pagination = Pagination(page=page, page_size=page_size)
    result = tickets_service.get_comments(request_id=request_id, pagination=pagination)
    return _paged_payload(result)


# ---------------------------------------------------------------------------
# History endpoint
# ---------------------------------------------------------------------------


@router.get("/requests/{request_id}/history")
async def get_history(
    request_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1),
    current_user: User = Depends(require_permission(PERM_TICKETS_READ)),
):
    """Get change history for a ticket request in reverse chronological order."""
    pagination = Pagination(page=page, page_size=page_size)
    result = tickets_service.get_history(request_id=request_id, pagination=pagination)
    return _paged_payload(result)


# ---------------------------------------------------------------------------
# Attachment endpoints
# ---------------------------------------------------------------------------


@router.post("/requests/{request_id}/attachments", status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    request_id: int,
    file: UploadFile = File(...),
    file_type: str = Form("other"),
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    """Upload an attachment for a ticket request."""
    content = await file.read()
    try:
        return tickets_service.upload_attachment(
            request_id=request_id,
            file_name=file.filename or "attachment",
            file_content=content,
            file_type=file_type,
            user_id=current_user.id,
        )
    except TicketsNotFoundError as exc:
        raise _not_found(exc) from exc
    except TicketsValidationError as exc:
        status_code = (
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
            if any("exceeds maximum" in str(error) for error in exc.errors)
            else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        raise HTTPException(status_code=status_code, detail=exc.errors) from exc


@router.get("/requests/{request_id}/attachments")
async def list_attachments(
    request_id: int,
    current_user: User = Depends(require_permission(PERM_TICKETS_READ)),
):
    """List attachments for a ticket request."""
    try:
        return {"items": tickets_service.list_attachments(request_id)}
    except TicketsNotFoundError as exc:
        raise _not_found(exc) from exc


@router.get("/requests/{request_id}/attachments/{attachment_id}")
async def download_attachment(
    request_id: int,
    attachment_id: str,
    current_user: User = Depends(require_permission(PERM_TICKETS_READ)),
):
    """Download a ticket attachment."""
    try:
        attachments = tickets_service.list_attachments(request_id)
    except TicketsNotFoundError as exc:
        raise _not_found(exc) from exc

    attachment = next((item for item in attachments if item.get("id") == attachment_id), None)
    if attachment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Attachment with id={attachment_id} not found for request {request_id}",
        )

    path = Path(str(attachment.get("storage_path") or ""))
    if not path.exists() or not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attachment file is missing from storage",
        )
    return FileResponse(path=str(path), filename=str(attachment.get("file_name") or attachment_id))


@router.delete("/requests/{request_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attachment(
    request_id: int,
    attachment_id: str,
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    """Delete a ticket attachment."""
    try:
        tickets_service.delete_attachment(request_id, attachment_id, current_user.id)
    except TicketsNotFoundError as exc:
        raise _not_found(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Object and employee endpoints
# ---------------------------------------------------------------------------


@router.get("/objects")
async def list_objects(
    include_inactive: bool = Query(False),
    current_user: User = Depends(require_permission(PERM_TICKETS_READ)),
):
    return {"items": tickets_service.list_objects(include_inactive=include_inactive)}


@router.post("/objects", status_code=status.HTTP_201_CREATED)
async def create_object(
    body: ObjectBody,
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    try:
        return tickets_service.create_object(body.model_dump(exclude_unset=True), _user_dict(current_user))
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.patch("/objects/{object_id}")
async def update_object(
    object_id: int,
    body: ObjectBody,
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    try:
        return tickets_service.update_object(object_id, body.model_dump(exclude_unset=True), _user_dict(current_user))
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        detail = str(exc)
        code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(status_code=code, detail=detail) from exc


@router.get("/employees")
async def list_employees(
    search: Optional[str] = Query(None),
    employee_status: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1),
    current_user: User = Depends(require_permission(PERM_TICKETS_READ)),
):
    result = tickets_service.list_employees(
        search=search,
        status=employee_status,
        pagination=Pagination(page=page, page_size=page_size),
    )
    return _paged_payload(result)


@router.get("/employees/{employee_id}")
async def get_employee(
    employee_id: int,
    current_user: User = Depends(require_permission(PERM_TICKETS_READ)),
):
    try:
        return tickets_service.get_employee(employee_id, user_permissions=list(current_user.permissions or []))
    except TicketsNotFoundError as exc:
        raise _not_found(exc) from exc


@router.post("/employees", status_code=status.HTTP_201_CREATED)
async def create_employee(
    body: EmployeeBody,
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    try:
        return tickets_service.create_employee(
            body.model_dump(exclude_unset=True),
            user_permissions=list(current_user.permissions or []),
        )
    except TicketsValidationError as exc:
        raise _validation_error(exc) from exc


@router.patch("/employees/{employee_id}")
async def update_employee(
    employee_id: int,
    body: EmployeeBody,
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    try:
        return tickets_service.update_employee(
            employee_id,
            body.model_dump(exclude_unset=True),
            user_permissions=list(current_user.permissions or []),
        )
    except TicketsNotFoundError as exc:
        raise _not_found(exc) from exc
    except TicketsValidationError as exc:
        raise _validation_error(exc) from exc


# ---------------------------------------------------------------------------
# Import endpoints
# ---------------------------------------------------------------------------


@router.post("/import/upload", status_code=status.HTTP_201_CREATED)
async def upload_import_file(
    file: UploadFile = File(...),
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    """Upload an Excel workbook and create an import job."""
    file_name = file.filename or "tickets.xlsx"
    if not file_name.lower().endswith(".xlsx"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only .xlsx files are supported",
        )
    content = await file.read()
    if len(content) > MAX_IMPORT_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Import file exceeds 50 MB",
        )
    return tickets_import_service.upload_file(file_name, content, current_user.id)


@router.get("/import/{job_id}/preview")
async def get_import_preview(
    job_id: str,
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    try:
        return asdict(tickets_import_service.get_preview(job_id))
    except ValueError as exc:
        detail = str(exc)
        code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_409_CONFLICT
        raise HTTPException(status_code=code, detail=detail) from exc


@router.post("/import/{job_id}/execute")
async def execute_import(
    job_id: str,
    body: ImportExecuteBody,
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    settings = ImportSettings(
        color_map=body.color_map,
        duplicate_strategy=body.duplicate_strategy,
        sheet_object_map=body.sheet_object_map,
    )
    try:
        return asdict(tickets_import_service.execute_import(job_id, settings, current_user.id))
    except ValueError as exc:
        detail = str(exc)
        code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_409_CONFLICT
        raise HTTPException(status_code=code, detail=detail) from exc


# ---------------------------------------------------------------------------
# Reports, dashboard, kanban, financial ops, notifications
# ---------------------------------------------------------------------------


@router.get("/reports/losses")
async def get_losses_report(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    object_id: Optional[int] = Query(None),
    op_type: Optional[str] = Query(None),
    current_user: User = Depends(require_permission(PERM_TICKETS_READ)),
):
    try:
        return tickets_service.get_losses_report(
            filters={
                "date_from": date_from,
                "date_to": date_to,
                "object_id": object_id,
                "op_type": op_type,
            },
            pagination=Pagination(page=page, page_size=page_size),
        )
    except TicketsValidationError as exc:
        raise _validation_error(exc) from exc


@router.get("/reports/losses/export")
async def export_losses(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    object_id: Optional[int] = Query(None),
    op_type: Optional[str] = Query(None),
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    try:
        payload = tickets_service.export_losses_xlsx(
            filters={
                "date_from": date_from,
                "date_to": date_to,
                "object_id": object_id,
                "op_type": op_type,
            }
        )
    except TicketsValidationError as exc:
        raise _validation_error(exc) from exc
    return StreamingResponse(
        iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="ticket-losses.xlsx"'},
    )


@router.get("/reports/requests/export")
async def export_requests(
    object_ids: Optional[str] = Query(None),
    statuses: Optional[str] = Query(None),
    assignee_ids: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort_field: str = Query("created_at"),
    sort_dir: str = Query("desc"),
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    filters = RequestFilters(
        object_ids=_parse_int_list(object_ids),
        statuses=_parse_str_list(statuses),
        assignee_ids=_parse_assignee_list(assignee_ids),
        search=search or "",
        sort_field=sort_field,
        sort_dir=sort_dir,
    )
    payload = tickets_service.export_requests_xlsx(filters)
    return StreamingResponse(
        iter([payload]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="ticket-requests.xlsx"'},
    )


@router.get("/dashboard")
async def get_dashboard(
    current_user: User = Depends(require_permission(PERM_TICKETS_READ)),
):
    return tickets_service.get_dashboard()


@router.get("/kanban")
async def get_kanban(
    object_ids: Optional[str] = Query(None),
    assignee_ids: Optional[str] = Query(None),
    current_user: User = Depends(require_permission(PERM_TICKETS_READ)),
):
    return tickets_service.get_kanban({
        "object_ids": _parse_int_list(object_ids),
        "assignee_ids": _parse_int_list(assignee_ids),
    })


@router.post("/financial-ops", status_code=status.HTTP_201_CREATED)
async def create_financial_op(
    body: FinancialOpBody,
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    try:
        return tickets_service.create_financial_op(body.model_dump(exclude_unset=True), current_user.id)
    except TicketsValidationError as exc:
        raise _validation_error(exc) from exc


@router.get("/financial-ops")
async def list_financial_ops(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1),
    request_id: Optional[int] = Query(None),
    employee_id: Optional[int] = Query(None),
    object_id: Optional[int] = Query(None),
    op_type: Optional[str] = Query(None),
    refund_status: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    include_deleted: Optional[bool] = Query(False),
    current_user: User = Depends(require_permission(PERM_TICKETS_READ)),
):
    result = tickets_service.list_financial_ops(
        filters=FinOpFilters(
            request_id=request_id,
            employee_id=employee_id,
            object_id=object_id,
            op_type=op_type,
            refund_status=refund_status,
            date_from=_parse_date(date_from),
            date_to=_parse_date(date_to),
            include_deleted=_parse_bool(include_deleted),
        ),
        pagination=Pagination(page=page, page_size=page_size),
    )
    return _paged_payload(result)


@router.patch("/financial-ops/{op_id}")
async def update_financial_op(
    op_id: int,
    body: FinancialOpBody,
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    try:
        return tickets_service.update_financial_op(op_id, body.model_dump(exclude_unset=True), current_user.id)
    except TicketsNotFoundError as exc:
        raise _not_found(exc) from exc
    except TicketsValidationError as exc:
        raise _validation_error(exc) from exc


@router.delete("/financial-ops/{op_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_financial_op(
    op_id: int,
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    try:
        tickets_service.delete_financial_op(op_id, current_user.id)
    except TicketsNotFoundError as exc:
        raise _not_found(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/notifications/rules")
async def get_notification_rules(
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    return {"items": tickets_notification_service.get_rules()}


@router.patch("/notifications/rules/{rule_id}")
async def update_notification_rule(
    rule_id: int,
    body: NotificationRuleBody,
    current_user: User = Depends(require_permission(PERM_TICKETS_WRITE)),
):
    _admin_required(current_user)
    try:
        return tickets_notification_service.update_rule(rule_id, body.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise _not_found(exc) from exc


@router.get("/notifications/pending")
async def get_pending_notifications(
    current_user: User = Depends(require_permission(PERM_TICKETS_READ)),
):
    items = [item.to_dict() for item in tickets_notification_service.get_all_pending(_user_dict(current_user))]
    return {"items": items}


@router.post("/notifications/{notification_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_notification(
    notification_id: str,
    current_user: User = Depends(require_permission(PERM_TICKETS_READ)),
):
    tickets_notification_service.dismiss_notification(notification_id, _user_dict(current_user))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
