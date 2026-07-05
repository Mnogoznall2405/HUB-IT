"""Service layer for the Tickets/Logistics module.

Provides business logic for managing travel requests, objects, employees,
attachments, financial operations, and related entities.
"""
from __future__ import annotations

import logging
import os
import uuid as uuid_mod
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import String as SAString, and_, case, func, or_, select
from sqlalchemy.orm import joinedload, selectinload

from backend.appdb.db import app_session
from backend.appdb.tickets_models import (
    TicketAttachment,
    TicketChangeHistory,
    TicketComment,
    TicketEmployee,
    TicketEmployeeDocument,
    TicketFinancialOp,
    TicketObject,
    TicketRequest,
)
from backend.services.authorization_service import PERM_TICKETS_PERSONAL_DATA_READ
from backend.services.secret_crypto_service import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VALID_PAGE_SIZES = (20, 25, 50, 100)
DEFAULT_PAGE_SIZE = 25
DEFAULT_SORT_FIELD = "created_at"
DEFAULT_SORT_DIR = "desc"
MIN_SEARCH_LENGTH = 2

EMPLOYEE_STATUSES = {"active", "dismissed", "archived"}
MASKED_VALUE = "** **** ******"

VALID_COMMENT_TYPES = {"normal", "problem", "clarification", "system"}
COMMENT_MIN_LENGTH = 1
COMMENT_MAX_LENGTH = 2000
HISTORY_PAGE_SIZE = 20

# Valid financial operation types
VALID_FIN_OP_TYPES = {"refund", "exchange", "loss"}
FIN_OP_MAX_AMOUNT = Decimal("9999999999.99")

# Fields tracked for change history when update_request() modifies them
TRACKED_FIELDS = {
    "status",
    "assignee_id",
    "departure_date",
    "arrival_date",
    "total_cost",
    "route",
    "note",
    "refund_loss",
    "submitted_at",
}

# All valid ticket request statuses (simplified Excel workflow)
VALID_STATUSES = {
    "not_started",
    "at_cashier",
    "purchased",
    "exchange_needed",
    "cancel_purchase",
    "refund_needed",
}

STATUS_LABELS: dict[str, str] = {
    "not_started": "Билет ещё не запущен в работу",
    "at_cashier": "Билет на стадии оформления (в кассах)",
    "purchased": "Билет куплен",
    "exchange_needed": "Необходимо заменить билет",
    "cancel_purchase": "Необходимо отменить покупку",
    "refund_needed": "Необходим возврат билета",
}

# State machine: allowed transitions from each status
STATUS_TRANSITIONS: dict[str, list[str]] = {
    "not_started": ["at_cashier"],
    "at_cashier": ["purchased", "cancel_purchase"],
    "purchased": ["exchange_needed", "refund_needed"],
    "exchange_needed": ["at_cashier", "refund_needed"],
    "cancel_purchase": [],
    "refund_needed": [],
}

# Sortable columns mapping: external name -> TicketRequest attribute name
SORTABLE_COLUMNS = {
    "id": "id",
    "created_at": "created_at",
    "updated_at": "updated_at",
    "status": "status",
    "departure_date": "departure_date",
    "arrival_date": "arrival_date",
    "submitted_at": "submitted_at",
    "total_cost": "total_cost",
    "is_urgent": "is_urgent",
}

# Attachment constants
ALLOWED_ATTACHMENT_EXTENSIONS = {"pdf", "jpg", "jpeg", "png", "doc", "docx", "xls", "xlsx"}
MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024  # 20 MB
MAX_ATTACHMENTS_PER_REQUEST = 10
VALID_ATTACHMENT_TYPES = {"itinerary", "pdf_ticket", "receipt", "voucher", "other"}
DEFAULT_UPLOAD_DIR = "uploads/tickets"


# ---------------------------------------------------------------------------
# Data Transfer Objects
# ---------------------------------------------------------------------------


@dataclass
class Pagination:
    """Pagination parameters with validation."""

    page: int = 1
    page_size: int = DEFAULT_PAGE_SIZE

    def __post_init__(self) -> None:
        if self.page < 1:
            self.page = 1
        if self.page_size not in VALID_PAGE_SIZES:
            self.page_size = DEFAULT_PAGE_SIZE

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


@dataclass
class RequestFilters:
    """Filter parameters for list_requests. All filters combined with AND logic."""

    object_ids: list[int] = field(default_factory=list)
    statuses: list[str] = field(default_factory=list)
    assignee_ids: list[int | None] = field(default_factory=list)
    search: str = ""
    sort_field: str = DEFAULT_SORT_FIELD
    sort_dir: str = DEFAULT_SORT_DIR

    def __post_init__(self) -> None:
        self.search = str(self.search or "").strip()
        if self.sort_field not in SORTABLE_COLUMNS:
            self.sort_field = DEFAULT_SORT_FIELD
        if self.sort_dir not in ("asc", "desc"):
            self.sort_dir = DEFAULT_SORT_DIR


@dataclass
class PagedResult:
    """Paginated result container."""

    items: list[dict]
    total: int
    page: int
    page_size: int

    @property
    def total_pages(self) -> int:
        if self.total == 0:
            return 0
        return (self.total + self.page_size - 1) // self.page_size


@dataclass
class CreateRequestDTO:
    """Data for creating a new ticket request."""

    employee_id: int
    object_id: int
    status: str = "not_started"
    assignee_id: int | None = None
    submitted_at: datetime | None = None
    departure_date: datetime | None = None
    arrival_date: datetime | None = None
    route: str | None = None
    total_cost: Decimal = field(default_factory=lambda: Decimal("0.00"))
    note: str | None = None
    refund_loss: Decimal = field(default_factory=lambda: Decimal("0.00"))
    is_urgent: bool = False
    source: str = "manual"


@dataclass
class UpdateRequestDTO:
    """Data for updating an existing ticket request.

    Only fields listed in _provided_fields will be applied.
    """

    assignee_id: int | None = None
    departure_date: datetime | None = None
    arrival_date: datetime | None = None
    route: str | None = None
    total_cost: Decimal | None = None
    note: str | None = None
    refund_loss: Decimal | None = None
    submitted_at: datetime | None = None
    is_urgent: bool | None = None
    needs_review: bool | None = None
    _provided_fields: set = field(default_factory=set)


@dataclass
class FinOpFilters:
    """Filter parameters for list_financial_ops. All filters combined with AND logic."""

    request_id: int | None = None
    employee_id: int | None = None
    object_id: int | None = None
    op_type: str | None = None
    refund_status: str | None = None
    date_from: datetime | None = None
    date_to: datetime | None = None
    include_deleted: bool = False


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_date(value: Any) -> datetime | None:
    """Parse a date value from string or datetime. Returns timezone-aware datetime or None."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
    raw = str(value).strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(raw, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return None


def split_passport_series_number(value: str) -> tuple[str, str]:
    """Split combined passport 'series number' into separate parts."""
    parts = str(value or "").strip().split(None, 1)
    if len(parts) == 2:
        return parts[0], parts[1]
    if len(parts) == 1:
        return parts[0], ""
    return "", ""


def _get_current_document(employee: TicketEmployee | None) -> TicketEmployeeDocument | None:
    if employee is None:
        return None
    documents = list(employee.documents or [])
    if not documents:
        return None
    for doc in documents:
        if doc.is_current:
            return doc
    return documents[0]


def _document_personal_fields(
    doc: TicketEmployeeDocument | None,
    *,
    decrypt: bool = False,
) -> dict[str, str | None]:
    empty = {
        "passport_series": "",
        "passport_number": "",
        "passport_series_number": "",
        "issued_by": "",
        "issuer_code": "",
        "birth_place": "",
        "registration_address": "",
    }
    if doc is None:
        return empty

    if decrypt:
        series = decrypt_secret(doc.passport_series_enc) or ""
        number = decrypt_secret(doc.passport_number_enc) or ""
        combined = decrypt_secret(doc.passport_series_number_enc) or ""
        if not series and not number and combined:
            series, number = split_passport_series_number(combined)
        passport_series_number = combined or " ".join(part for part in (series, number) if part).strip()
        return {
            "passport_series": series,
            "passport_number": number,
            "passport_series_number": passport_series_number,
            "issued_by": decrypt_secret(doc.issued_by_enc) or "",
            "issuer_code": decrypt_secret(doc.issuer_code_enc) or "",
            "birth_place": decrypt_secret(doc.birth_place_enc) or "",
            "registration_address": decrypt_secret(doc.registration_address_enc) or "",
        }

    has_passport = bool(
        doc.passport_series_enc
        or doc.passport_number_enc
        or doc.passport_series_number_enc
    )
    mask = MASKED_VALUE if has_passport else ""
    return {
        "passport_series": mask if (doc.passport_series_enc or doc.passport_series_number_enc) else "",
        "passport_number": mask if (doc.passport_number_enc or doc.passport_series_number_enc) else "",
        "passport_series_number": mask if has_passport else "",
        "issued_by": MASKED_VALUE if doc.issued_by_enc else "",
        "issuer_code": MASKED_VALUE if doc.issuer_code_enc else "",
        "birth_place": MASKED_VALUE if doc.birth_place_enc else "",
        "registration_address": MASKED_VALUE if doc.registration_address_enc else "",
    }


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class TicketsServiceError(RuntimeError):
    """Base exception for TicketsService errors."""


class TicketsValidationError(TicketsServiceError):
    """Raised when input validation fails."""

    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("; ".join(errors))


class TicketsNotFoundError(TicketsServiceError):
    """Raised when a requested entity is not found."""


class TicketsConflictError(TicketsServiceError):
    """Raised when optimistic locking detects a version conflict (HTTP 409)."""

    def __init__(self, current_version: int, expected_version: int, current_status: str):
        self.current_version = current_version
        self.expected_version = expected_version
        self.current_status = current_status
        super().__init__(
            f"Version conflict: expected {expected_version}, "
            f"but current is {current_version}. Current status: {current_status}"
        )


class TicketsTransitionError(TicketsServiceError):
    """Raised when a status transition is not allowed by the state machine."""

    def __init__(self, current_status: str, new_status: str, allowed: list[str]):
        self.current_status = current_status
        self.new_status = new_status
        self.allowed = allowed
        super().__init__(
            f"Transition from '{current_status}' to '{new_status}' is not allowed. "
            f"Allowed transitions: {allowed}"
        )


def _request_to_dict(req: TicketRequest) -> dict[str, Any]:
    """Convert a TicketRequest ORM object to a plain dict for API responses."""
    employee_name = ""
    object_code = ""
    object_name = ""
    assignee_name = ""

    if req.employee:
        employee_name = req.employee.full_name or ""
    if req.object:
        object_code = req.object.code or ""
        object_name = req.object.name or ""
    if req.assignee:
        assignee_name = req.assignee.full_name or req.assignee.username or ""

    return {
        "id": req.id,
        "employee_id": req.employee_id,
        "employee_name": employee_name,
        "object_id": req.object_id,
        "object_code": object_code,
        "object_name": object_name,
        "status": req.status,
        "assignee_id": req.assignee_id,
        "assignee_name": assignee_name,
        "submitted_at": req.submitted_at.isoformat() if req.submitted_at else None,
        "departure_date": req.departure_date.isoformat() if req.departure_date else None,
        "arrival_date": req.arrival_date.isoformat() if req.arrival_date else None,
        "route": req.route,
        "note": req.note,
        "total_cost": str(req.total_cost),
        "refund_loss": str(req.refund_loss),
        "is_urgent": req.is_urgent,
        "needs_review": req.needs_review,
        "source": req.source,
        "version": req.version,
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "updated_at": req.updated_at.isoformat() if req.updated_at else None,
    }


def _kanban_card_to_dict(req: TicketRequest) -> dict[str, Any]:
    """Convert a TicketRequest ORM object to a kanban card dict.

    Card fields: id, employee_name, object_name, departure_date, route,
    is_urgent, assignee_name, status.
    """
    employee_name = ""
    object_name = ""
    assignee_name = ""

    if req.employee:
        employee_name = req.employee.full_name or ""
    if req.object:
        object_name = req.object.name or ""
    if req.assignee:
        assignee_name = req.assignee.full_name or req.assignee.username or ""

    return {
        "id": req.id,
        "employee_name": employee_name,
        "object_name": object_name,
        "departure_date": req.departure_date.isoformat() if req.departure_date else None,
        "route": req.route,
        "is_urgent": req.is_urgent,
        "assignee_name": assignee_name,
        "status": req.status,
    }


def _request_list_row_to_dict(
    req: TicketRequest,
    *,
    decrypt_personal: bool = False,
) -> dict[str, Any]:
    """Convert request with denormalized employee/document fields for list/export."""
    base = _request_to_dict(req)
    employee = req.employee
    document = _get_current_document(employee)
    personal = _document_personal_fields(document, decrypt=decrypt_personal)

    date_of_birth = None
    if employee is not None:
        if decrypt_personal and employee.date_of_birth_enc:
            date_of_birth = decrypt_secret(employee.date_of_birth_enc) or None
        elif employee.date_of_birth_enc:
            date_of_birth = MASKED_VALUE

    base.update(
        {
            "department": employee.department if employee else None,
            "position": employee.position if employee else None,
            "phone": employee.phone if employee else None,
            "passport_series": personal["passport_series"],
            "passport_number": personal["passport_number"],
            "passport_series_number": personal["passport_series_number"],
            "issue_date": document.issue_date.isoformat() if document and document.issue_date else None,
            "issued_by": personal["issued_by"],
            "issuer_code": personal["issuer_code"],
            "date_of_birth": date_of_birth,
            "birth_place": personal["birth_place"],
            "registration_address": personal["registration_address"],
        }
    )
    return base


# ---------------------------------------------------------------------------
# TicketsService
# ---------------------------------------------------------------------------


class TicketsService:
    """Main service for the Tickets/Logistics module (singleton)."""

    def __init__(self, database_url: str | None = None) -> None:
        self._database_url = database_url

    # ==================================================================
    # Requests — CRUD with pagination, sorting, filtering, search
    # ==================================================================

    def list_requests(
        self,
        filters: RequestFilters | None = None,
        pagination: Pagination | None = None,
        user_permissions: list[str] | None = None,
    ) -> PagedResult:
        """List ticket requests with pagination, sorting, and combined filters.

        Filters are combined with AND logic:
        - object_ids: filter by object (IN list)
        - statuses: filter by status (IN list)
        - assignee_ids: filter by assignee (IN list; None means unassigned)
        - search: case-insensitive substring on full_name, phone, object_code,
                  request id (min 2 chars)

        Pagination: page_size must be 25, 50, or 100 (default 25).
        Sorting: by any sortable column, default created_at DESC.
        """
        if filters is None:
            filters = RequestFilters()
        if pagination is None:
            pagination = Pagination()

        can_read_personal = self._can_read_personal_data(user_permissions)

        with app_session(self._database_url) as session:
            # Determine if we need explicit joins for search
            needs_search_joins = (
                filters.search and len(filters.search) >= MIN_SEARCH_LENGTH
            )

            # Base query
            query = select(TicketRequest)

            # Add explicit joins for search if needed
            if needs_search_joins:
                query = query.join(
                    TicketEmployee,
                    TicketRequest.employee_id == TicketEmployee.id,
                    isouter=True,
                ).join(
                    TicketObject,
                    TicketRequest.object_id == TicketObject.id,
                    isouter=True,
                )

            # --- Apply filters (AND logic) ---

            # Filter by object_ids
            if filters.object_ids:
                query = query.where(TicketRequest.object_id.in_(filters.object_ids))

            # Filter by statuses
            if filters.statuses:
                query = query.where(TicketRequest.status.in_(filters.statuses))

            # Filter by assignee_ids (supports None for unassigned)
            if filters.assignee_ids:
                has_none = None in filters.assignee_ids
                non_none_ids = [aid for aid in filters.assignee_ids if aid is not None]
                if has_none and non_none_ids:
                    query = query.where(
                        or_(
                            TicketRequest.assignee_id.in_(non_none_ids),
                            TicketRequest.assignee_id.is_(None),
                        )
                    )
                elif has_none:
                    query = query.where(TicketRequest.assignee_id.is_(None))
                else:
                    query = query.where(TicketRequest.assignee_id.in_(non_none_ids))

            # Search filter (min 2 chars, case-insensitive substring)
            if needs_search_joins:
                search_term = f"%{filters.search.lower()}%"
                query = query.where(
                    or_(
                        func.lower(TicketEmployee.full_name).like(search_term),
                        func.lower(func.coalesce(TicketEmployee.phone, "")).like(search_term),
                        func.lower(TicketObject.code).like(search_term),
                        func.cast(TicketRequest.id, SAString).like(search_term),
                    )
                )

            # --- Count total before pagination ---
            count_query = select(func.count()).select_from(query.subquery())
            total = session.execute(count_query).scalar() or 0

            # --- Apply sorting ---
            sort_attr_name = SORTABLE_COLUMNS.get(filters.sort_field, "created_at")
            sort_attr = getattr(TicketRequest, sort_attr_name, TicketRequest.created_at)
            if filters.sort_dir == "asc":
                query = query.order_by(sort_attr.asc())
            else:
                query = query.order_by(sort_attr.desc())

            # --- Apply pagination ---
            query = query.offset(pagination.offset).limit(pagination.page_size)

            # Add eager loading for response serialization
            query = query.options(
                joinedload(TicketRequest.employee).selectinload(TicketEmployee.documents),
                joinedload(TicketRequest.object),
                joinedload(TicketRequest.assignee),
            )

            rows = session.execute(query).unique().scalars().all()
            items = [
                _request_list_row_to_dict(r, decrypt_personal=can_read_personal)
                for r in rows
            ]

        return PagedResult(
            items=items,
            total=total,
            page=pagination.page,
            page_size=pagination.page_size,
        )

    # ------------------------------------------------------------------
    # get_request
    # ------------------------------------------------------------------

    def get_request(self, request_id: int) -> dict[str, Any] | None:
        """Get a single ticket request by ID. Returns None if not found."""
        with app_session(self._database_url) as session:
            query = (
                select(TicketRequest)
                .options(
                    joinedload(TicketRequest.employee),
                    joinedload(TicketRequest.object),
                    joinedload(TicketRequest.assignee),
                )
                .where(TicketRequest.id == request_id)
            )
            req = session.execute(query).unique().scalars().first()
            if req is None:
                return None
            return _request_to_dict(req)

    # ------------------------------------------------------------------
    # create_request
    # ------------------------------------------------------------------

    def create_request(self, data: CreateRequestDTO) -> dict[str, Any]:
        """Create a new ticket request. Returns the created request as a dict."""
        now = _utcnow()
        with app_session(self._database_url) as session:
            req = TicketRequest(
                employee_id=data.employee_id,
                object_id=data.object_id,
                status=data.status or "not_started",
                assignee_id=data.assignee_id,
                submitted_at=data.submitted_at or now,
                departure_date=data.departure_date,
                arrival_date=data.arrival_date,
                route=data.route,
                note=data.note,
                total_cost=data.total_cost,
                refund_loss=data.refund_loss,
                is_urgent=data.is_urgent,
                needs_review=False,
                source=data.source or "manual",
                version=1,
                created_at=now,
                updated_at=now,
            )
            session.add(req)
            session.flush()

            # Reload with relationships for response
            session.refresh(req)
            _ = req.employee
            _ = req.object
            _ = req.assignee
            result = _request_to_dict(req)

        return result

    # ------------------------------------------------------------------
    # update_request
    # ------------------------------------------------------------------

    def update_request(
        self,
        request_id: int,
        data: UpdateRequestDTO,
        user_id: int | None = None,
        change_source: str = "manual",
    ) -> dict[str, Any] | None:
        """Update fields of an existing ticket request.

        Only updates fields listed in data._provided_fields.
        Tracked fields (status, assignee_id, departure_date, arrival_date,
        total_cost, route) generate TicketChangeHistory records.
        Returns the updated request dict, or None if not found.
        """
        now = _utcnow()
        with app_session(self._database_url) as session:
            query = (
                select(TicketRequest)
                .options(
                    joinedload(TicketRequest.employee),
                    joinedload(TicketRequest.object),
                    joinedload(TicketRequest.assignee),
                )
                .where(TicketRequest.id == request_id)
            )
            req = session.execute(query).unique().scalars().first()
            if req is None:
                return None

            # Collect old values for tracked fields before applying changes
            old_values: dict[str, Any] = {}
            for field_name in TRACKED_FIELDS:
                if field_name in data._provided_fields:
                    old_values[field_name] = getattr(req, field_name, None)

            # Apply only explicitly provided fields
            if "assignee_id" in data._provided_fields:
                req.assignee_id = data.assignee_id
            if "departure_date" in data._provided_fields:
                req.departure_date = data.departure_date
            if "arrival_date" in data._provided_fields:
                req.arrival_date = data.arrival_date
            if "route" in data._provided_fields:
                req.route = data.route
            if "note" in data._provided_fields:
                req.note = data.note
            if "total_cost" in data._provided_fields and data.total_cost is not None:
                req.total_cost = data.total_cost
            if "refund_loss" in data._provided_fields and data.refund_loss is not None:
                req.refund_loss = data.refund_loss
            if "submitted_at" in data._provided_fields:
                req.submitted_at = data.submitted_at
            if "is_urgent" in data._provided_fields and data.is_urgent is not None:
                req.is_urgent = data.is_urgent
            if "needs_review" in data._provided_fields and data.needs_review is not None:
                req.needs_review = data.needs_review

            req.updated_at = now

            # Create history records for tracked field changes
            for field_name, old_val in old_values.items():
                new_val = getattr(req, field_name, None)
                # Convert to string for comparison and storage
                old_str = self._value_to_history_str(old_val)
                new_str = self._value_to_history_str(new_val)
                if old_str != new_str:
                    history_record = TicketChangeHistory(
                        request_id=request_id,
                        field_name=field_name,
                        old_value=old_str,
                        new_value=new_str,
                        changed_by_id=user_id,
                        source=change_source,
                        created_at=now,
                    )
                    session.add(history_record)

            session.flush()

            # Reload relationships for response
            session.refresh(req)
            _ = req.employee
            _ = req.object
            _ = req.assignee
            result = _request_to_dict(req)

        return result

    # ==================================================================
    # Status change — state machine with optimistic locking
    # ==================================================================

    def change_status(
        self,
        request_id: int,
        new_status: str,
        user: dict[str, Any],
        expected_version: int,
        comment: str | None = None,
    ) -> dict[str, Any]:
        """Change the status of a ticket request with state machine validation
        and optimistic locking.

        Args:
            request_id: ID of the ticket request.
            new_status: Target status to transition to.
            user: Current user dict with keys 'id' and 'role'.
            expected_version: Expected version for optimistic locking.
            comment: Optional comment to attach to the status change (max 500 chars).

        Returns:
            Updated request as dict.

        Raises:
            TicketsNotFoundError: If request not found.
            TicketsConflictError: If version mismatch (HTTP 409 equivalent).
            TicketsTransitionError: If transition is not allowed by state machine.
            TicketsValidationError: If new_status is not a valid status.
        """
        # Validate new_status is a known status
        if new_status not in VALID_STATUSES:
            raise TicketsValidationError(
                [f"Invalid status '{new_status}'. Valid statuses: {sorted(VALID_STATUSES)}"]
            )

        # Truncate comment to 500 chars if provided
        if comment:
            comment = comment[:500]

        now = _utcnow()
        is_admin = str(user.get("role") or "").strip().lower() == "admin"
        user_id = user.get("id")

        with app_session(self._database_url) as session:
            # Load the request
            req = session.scalars(
                select(TicketRequest).where(TicketRequest.id == request_id)
            ).first()

            if req is None:
                raise TicketsNotFoundError(f"Request with id={request_id} not found")

            old_status = req.status

            # Optimistic locking: check version
            if req.version != expected_version:
                raise TicketsConflictError(
                    current_version=req.version,
                    expected_version=expected_version,
                    current_status=req.status,
                )

            # State machine validation (admin bypasses)
            if not is_admin:
                allowed = STATUS_TRANSITIONS.get(old_status, [])
                if new_status not in allowed:
                    raise TicketsTransitionError(
                        current_status=old_status,
                        new_status=new_status,
                        allowed=allowed,
                    )

            # No-op if same status (still valid, just no change needed)
            if old_status == new_status:
                # Reload with relationships for response
                session.refresh(req)
                query = (
                    select(TicketRequest)
                    .options(
                        joinedload(TicketRequest.employee),
                        joinedload(TicketRequest.object),
                        joinedload(TicketRequest.assignee),
                    )
                    .where(TicketRequest.id == request_id)
                )
                req = session.execute(query).unique().scalars().first()
                return _request_to_dict(req)

            # Apply status change
            req.status = new_status
            req.version += 1
            req.updated_at = now

            # Create history record
            history_record = TicketChangeHistory(
                request_id=request_id,
                field_name="status",
                old_value=old_status,
                new_value=new_status,
                changed_by_id=user_id,
                source="manual",
                comment=comment,
                created_at=now,
            )
            session.add(history_record)

            # Create system comment
            system_comment_text = (
                f"Статус изменён: {old_status} → {new_status}"
            )
            if comment:
                system_comment_text += f". Комментарий: {comment}"

            system_comment = TicketComment(
                request_id=request_id,
                author_id=user_id,
                text=system_comment_text,
                comment_type="system",
                created_at=now,
            )
            session.add(system_comment)

            session.flush()

            # Reload with relationships for response
            query = (
                select(TicketRequest)
                .options(
                    joinedload(TicketRequest.employee),
                    joinedload(TicketRequest.object),
                    joinedload(TicketRequest.assignee),
                )
                .where(TicketRequest.id == request_id)
            )
            req = session.execute(query).unique().scalars().first()
            result = _request_to_dict(req)

        return result

    # ==================================================================
    # Comments
    # ==================================================================

    def add_comment(
        self,
        request_id: int,
        text: str,
        comment_type: str = "normal",
        user_id: int | None = None,
    ) -> dict[str, Any]:
        """Add a comment to a ticket request.

        Args:
            request_id: ID of the ticket request.
            text: Comment text (1–2000 characters).
            comment_type: One of normal, problem, clarification, system.
            user_id: ID of the comment author.

        Returns:
            Created comment as dict.

        Raises:
            TicketsValidationError: If text or comment_type is invalid.
            TicketsNotFoundError: If request not found.
        """
        # Validate text
        errors: list[str] = []
        if text is None or not isinstance(text, str):
            errors.append(
                f"Comment text must be between {COMMENT_MIN_LENGTH} and {COMMENT_MAX_LENGTH} characters"
            )
        else:
            if len(text) < COMMENT_MIN_LENGTH or len(text) > COMMENT_MAX_LENGTH:
                errors.append(
                    f"Comment text must be between {COMMENT_MIN_LENGTH} and {COMMENT_MAX_LENGTH} characters"
                )

        # Validate comment_type
        if comment_type not in VALID_COMMENT_TYPES:
            errors.append(
                f"comment_type must be one of: {', '.join(sorted(VALID_COMMENT_TYPES))}"
            )

        if errors:
            raise TicketsValidationError(errors)

        now = _utcnow()
        with app_session(self._database_url) as session:
            # Verify request exists
            req = session.get(TicketRequest, request_id)
            if req is None:
                raise TicketsNotFoundError(f"Request with id={request_id} not found")

            comment = TicketComment(
                request_id=request_id,
                author_id=user_id,
                text=text,
                comment_type=comment_type,
                created_at=now,
            )
            session.add(comment)
            session.flush()

            result = self._comment_to_dict(comment)

        return result

    def get_comments(
        self,
        request_id: int,
        pagination: Pagination | None = None,
    ) -> PagedResult:
        """Get comments for a ticket request in chronological order (oldest first).

        Args:
            request_id: ID of the ticket request.
            pagination: Pagination parameters.

        Returns:
            PagedResult with comments ordered by created_at ASC.
        """
        if pagination is None:
            pagination = Pagination()

        with app_session(self._database_url) as session:
            base_query = select(TicketComment).where(
                TicketComment.request_id == request_id
            )

            # Count total
            count_query = select(func.count()).select_from(base_query.subquery())
            total = session.execute(count_query).scalar() or 0

            # Fetch page — chronological order (oldest first)
            query = (
                base_query.order_by(TicketComment.created_at.asc())
                .offset(pagination.offset)
                .limit(pagination.page_size)
            )
            rows = session.scalars(query).all()
            items = [self._comment_to_dict(c) for c in rows]

        return PagedResult(
            items=items,
            total=total,
            page=pagination.page,
            page_size=pagination.page_size,
        )

    # ==================================================================
    # History
    # ==================================================================

    def get_history(
        self,
        request_id: int,
        pagination: Pagination | None = None,
    ) -> PagedResult:
        """Get change history for a ticket request in reverse chronological order.

        Default page size is 20 records per page.
        History records are immutable — no edit/delete methods are provided.

        Args:
            request_id: ID of the ticket request.
            pagination: Pagination parameters. Default page_size is 20.

        Returns:
            PagedResult with history records ordered by created_at DESC.
        """
        if pagination is None:
            pagination = Pagination(page_size=HISTORY_PAGE_SIZE)
        # Override page_size to 20 for history if default was used
        if pagination.page_size not in VALID_PAGE_SIZES:
            pagination.page_size = HISTORY_PAGE_SIZE

        with app_session(self._database_url) as session:
            base_query = select(TicketChangeHistory).where(
                TicketChangeHistory.request_id == request_id
            )

            # Count total
            count_query = select(func.count()).select_from(base_query.subquery())
            total = session.execute(count_query).scalar() or 0

            # Fetch page — reverse chronological (newest first)
            query = (
                base_query.order_by(TicketChangeHistory.created_at.desc())
                .offset(pagination.offset)
                .limit(pagination.page_size)
            )
            rows = session.scalars(query).all()
            items = [self._history_to_dict(h) for h in rows]

        return PagedResult(
            items=items,
            total=total,
            page=pagination.page,
            page_size=pagination.page_size,
        )

    # ------------------------------------------------------------------
    # Private helpers — Comments & History
    # ------------------------------------------------------------------

    @staticmethod
    def _comment_to_dict(comment: TicketComment) -> dict[str, Any]:
        """Convert a TicketComment model to a plain dict."""
        return {
            "id": comment.id,
            "request_id": comment.request_id,
            "author_id": comment.author_id,
            "text": comment.text,
            "comment_type": comment.comment_type,
            "created_at": comment.created_at.isoformat() if comment.created_at else None,
        }

    @staticmethod
    def _history_to_dict(history: TicketChangeHistory) -> dict[str, Any]:
        """Convert a TicketChangeHistory model to a plain dict."""
        return {
            "id": history.id,
            "request_id": history.request_id,
            "field_name": history.field_name,
            "old_value": history.old_value,
            "new_value": history.new_value,
            "changed_by_id": history.changed_by_id,
            "source": history.source,
            "comment": history.comment,
            "created_at": history.created_at.isoformat() if history.created_at else None,
        }

    @staticmethod
    def _value_to_history_str(value: Any) -> str | None:
        """Convert a field value to a string for history storage.

        Returns None for None values, ISO format for datetimes,
        str() for everything else.
        """
        if value is None:
            return None
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, Decimal):
            return str(value)
        return str(value)

    # ==================================================================
    # Objects (Travel destinations) — admin only
    # ==================================================================

    def list_objects(self, include_inactive: bool = False) -> list[dict[str, Any]]:
        """Return list of travel objects.

        Args:
            include_inactive: If True, include deactivated objects.
                              Default False returns only active objects.
        """
        with app_session(self._database_url) as session:
            stmt = select(TicketObject).order_by(TicketObject.name.asc())
            if not include_inactive:
                stmt = stmt.where(TicketObject.is_active.is_(True))
            rows = session.scalars(stmt).all()
            return [self._object_to_dict(obj) for obj in rows]

    def create_object(self, data: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
        """Create a new travel object. Only admin role can create objects.

        Args:
            data: Dict with keys: code, name, short_name, region, default_assignee_id.
            user: Current user dict (must have role='admin').

        Returns:
            Created object as dict.

        Raises:
            PermissionError: If user is not admin.
            ValueError: If code is invalid or already exists.
        """
        self._require_admin(user)
        code = self._validate_object_code(data.get("code", ""))
        name = self._validate_object_name(data.get("name", ""))
        region = self._validate_object_region(data.get("region", ""))
        short_name = (data.get("short_name") or "")[:50] or None
        default_assignee_id = data.get("default_assignee_id")

        with app_session(self._database_url) as session:
            existing = session.scalars(
                select(TicketObject).where(TicketObject.code == code)
            ).first()
            if existing is not None:
                raise ValueError(f"Object with code '{code}' already exists")

            obj = TicketObject(
                code=code,
                name=name,
                short_name=short_name,
                region=region,
                default_assignee_id=default_assignee_id,
                is_active=True,
                created_at=_utcnow(),
                updated_at=_utcnow(),
            )
            session.add(obj)
            session.flush()
            result = self._object_to_dict(obj)
        return result

    def update_object(self, object_id: int, data: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
        """Update an existing travel object. Only admin role can update.

        Deactivation preserves existing request links but excludes from new selection.
        Activation returns the object to the available list.

        Raises:
            PermissionError: If user is not admin.
            ValueError: If object not found or validation fails.
        """
        self._require_admin(user)

        with app_session(self._database_url) as session:
            obj = session.get(TicketObject, object_id)
            if obj is None:
                raise ValueError(f"Object with id={object_id} not found")

            if "name" in data:
                obj.name = self._validate_object_name(data["name"])
            if "short_name" in data:
                obj.short_name = (data["short_name"] or "")[:50] or None
            if "region" in data:
                obj.region = self._validate_object_region(data["region"])
            if "default_assignee_id" in data:
                obj.default_assignee_id = data["default_assignee_id"]
            if "is_active" in data:
                obj.is_active = bool(data["is_active"])

            obj.updated_at = _utcnow()
            session.flush()
            result = self._object_to_dict(obj)
        return result

    # ==================================================================
    # Employees — CRUD with encryption and masking
    # ==================================================================

    def list_employees(
        self,
        search: str | None = None,
        status: str | None = None,
        pagination: Pagination | None = None,
    ) -> PagedResult:
        """List employees with optional search and pagination.

        Search is case-insensitive substring match on full_name (min 2 chars).
        """
        if pagination is None:
            pagination = Pagination()

        with app_session(self._database_url) as session:
            query = select(TicketEmployee)

            # Filter by status
            if status and status in EMPLOYEE_STATUSES:
                query = query.where(TicketEmployee.status == status)

            # Search by name (min 2 chars)
            if search and len(search) >= MIN_SEARCH_LENGTH:
                # Use LIKE with both lower-cased and original patterns for cross-DB compatibility
                # PostgreSQL: func.lower works with Unicode
                # SQLite: LIKE is case-insensitive for ASCII only, so we also try contains
                search_lower = search.lower()
                search_pattern = f"%{search_lower}%"
                query = query.where(
                    or_(
                        func.lower(TicketEmployee.full_name).like(search_pattern),
                        TicketEmployee.full_name.contains(search),
                    )
                )

            # Count total
            count_query = select(func.count()).select_from(query.subquery())
            total = session.execute(count_query).scalar() or 0

            # Apply pagination and ordering
            query = (
                query.order_by(TicketEmployee.full_name.asc())
                .offset(pagination.offset)
                .limit(pagination.page_size)
            )

            rows = session.scalars(query).all()
            items = [self._employee_to_dict(emp) for emp in rows]

        return PagedResult(
            items=items,
            total=total,
            page=pagination.page,
            page_size=pagination.page_size,
        )

    def get_employee(self, employee_id: int, user_permissions: list[str] | None = None) -> dict[str, Any]:
        """Get employee by ID with documents.

        Personal data is decrypted if user has tickets.personal_data.read permission,
        otherwise masked values are returned.

        Raises:
            TicketsNotFoundError: If employee not found.
        """
        can_read_personal = self._can_read_personal_data(user_permissions)

        with app_session(self._database_url) as session:
            employee = session.scalars(
                select(TicketEmployee)
                .options(selectinload(TicketEmployee.documents))
                .where(TicketEmployee.id == int(employee_id))
            ).first()

            if employee is None:
                raise TicketsNotFoundError(f"Employee with id={employee_id} not found")

            result = self._employee_to_dict(employee, decrypt=can_read_personal, include_personal=True)
            result["documents"] = [
                self._document_to_dict(doc, decrypt=can_read_personal)
                for doc in employee.documents
            ]

        return result

    def create_employee(self, data: dict[str, Any], user_permissions: list[str] | None = None) -> dict[str, Any]:
        """Create a new employee with optional documents.

        Args:
            data: Dict with keys: full_name, phone, email, status, app_user_id,
                  date_of_birth, documents (list of document dicts)
            user_permissions: List of user permissions for masking control

        Returns:
            Created employee dict with documents.

        Raises:
            TicketsValidationError: If validation fails.
        """
        errors = self._validate_employee_data(data)
        if errors:
            raise TicketsValidationError(errors)

        can_read_personal = self._can_read_personal_data(user_permissions)
        now = _utcnow()

        with app_session(self._database_url) as session:
            employee = TicketEmployee(
                full_name=str(data["full_name"]).strip()[:150],
                department=self._normalize_optional_str(data.get("department"), max_len=200),
                position=self._normalize_optional_str(data.get("position"), max_len=150),
                phone=self._normalize_optional_str(data.get("phone"), max_len=30),
                email=self._normalize_optional_str(data.get("email"), max_len=255),
                status=data.get("status") if data.get("status") in EMPLOYEE_STATUSES else "active",
                app_user_id=data.get("app_user_id") or None,
                date_of_birth_enc=encrypt_secret(data.get("date_of_birth", "")) if data.get("date_of_birth") else "",
                created_at=now,
                updated_at=now,
            )
            session.add(employee)
            session.flush()

            # Create documents if provided
            documents_data = data.get("documents") or []
            for doc_data in documents_data:
                doc_errors = self._validate_document_data(doc_data)
                if doc_errors:
                    raise TicketsValidationError(doc_errors)
                doc = self._create_document_from_data(employee.id, doc_data, now)
                session.add(doc)

            session.flush()

            # Reload with documents
            employee_with_docs = session.scalars(
                select(TicketEmployee)
                .options(selectinload(TicketEmployee.documents))
                .where(TicketEmployee.id == employee.id)
            ).first()

            result = self._employee_to_dict(employee_with_docs, decrypt=can_read_personal, include_personal=True)
            result["documents"] = [
                self._document_to_dict(doc, decrypt=can_read_personal)
                for doc in employee_with_docs.documents
            ]

        return result

    def update_employee(
        self, employee_id: int, data: dict[str, Any], user_permissions: list[str] | None = None
    ) -> dict[str, Any]:
        """Update an existing employee and/or their documents.

        Args:
            employee_id: ID of the employee to update
            data: Dict with optional keys: full_name, phone, email, status, app_user_id,
                  date_of_birth, documents (list of document updates)
            user_permissions: List of user permissions for masking control

        Returns:
            Updated employee dict with documents.

        Raises:
            TicketsNotFoundError: If employee or document not found.
            TicketsValidationError: If validation fails.
        """
        can_read_personal = self._can_read_personal_data(user_permissions)
        now = _utcnow()

        with app_session(self._database_url) as session:
            employee = session.scalars(
                select(TicketEmployee)
                .options(selectinload(TicketEmployee.documents))
                .where(TicketEmployee.id == int(employee_id))
            ).first()

            if employee is None:
                raise TicketsNotFoundError(f"Employee with id={employee_id} not found")

            # Validate update data
            errors = self._validate_employee_update_data(data)
            if errors:
                raise TicketsValidationError(errors)

            # Update employee fields
            if "full_name" in data:
                employee.full_name = str(data["full_name"]).strip()[:150]
            if "department" in data:
                employee.department = self._normalize_optional_str(data.get("department"), max_len=200)
            if "position" in data:
                employee.position = self._normalize_optional_str(data.get("position"), max_len=150)
            if "phone" in data:
                employee.phone = self._normalize_optional_str(data.get("phone"), max_len=30)
            if "email" in data:
                employee.email = self._normalize_optional_str(data.get("email"), max_len=255)
            if "status" in data and data["status"] in EMPLOYEE_STATUSES:
                employee.status = data["status"]
            if "app_user_id" in data:
                employee.app_user_id = data["app_user_id"] or None
            if "date_of_birth" in data:
                dob = data["date_of_birth"]
                if dob not in (None, "", MASKED_VALUE):
                    employee.date_of_birth_enc = encrypt_secret(dob)
                elif dob in ("", None):
                    employee.date_of_birth_enc = ""

            employee.updated_at = now

            # Handle document updates
            if "documents" in data:
                documents_data = data["documents"] or []
                for doc_data in documents_data:
                    doc_id = doc_data.get("id")
                    if doc_id:
                        # Update existing document
                        doc = next(
                            (d for d in employee.documents if d.id == int(doc_id)),
                            None,
                        )
                        if doc is None:
                            raise TicketsNotFoundError(
                                f"Document with id={doc_id} not found for employee {employee_id}"
                            )
                        doc_errors = self._validate_document_data(doc_data, is_update=True)
                        if doc_errors:
                            raise TicketsValidationError(doc_errors)
                        self._update_document_from_data(doc, doc_data, now)
                    else:
                        # Create new document
                        doc_errors = self._validate_document_data(doc_data)
                        if doc_errors:
                            raise TicketsValidationError(doc_errors)
                        new_doc = self._create_document_from_data(employee.id, doc_data, now)
                        session.add(new_doc)

            session.flush()

            # Expire and reload with documents to pick up newly added ones
            session.expire(employee)
            employee_with_docs = session.scalars(
                select(TicketEmployee)
                .options(selectinload(TicketEmployee.documents))
                .where(TicketEmployee.id == employee.id)
            ).first()

            result = self._employee_to_dict(employee_with_docs, decrypt=can_read_personal, include_personal=True)
            result["documents"] = [
                self._document_to_dict(doc, decrypt=can_read_personal)
                for doc in employee_with_docs.documents
            ]

        return result

    # ==================================================================
    # Attachments — upload, delete, list
    # ==================================================================

    def upload_attachment(
        self,
        request_id: int,
        file_name: str,
        file_content: bytes,
        file_type: str,
        user_id: int,
        base_upload_dir: str | None = None,
    ) -> dict[str, Any]:
        """Upload an attachment to a ticket request.

        Validates:
        - File extension: pdf, jpg, jpeg, png, doc, docx, xls, xlsx (case-insensitive)
        - File size: ≤ 20 MB
        - Count: max 10 attachments per request

        Args:
            request_id: ID of the ticket request.
            file_name: Original file name (e.g. "ticket.pdf").
            file_content: Raw file bytes.
            file_type: Attachment type (itinerary, pdf_ticket, receipt, voucher, other).
            user_id: ID of the uploading user.
            base_upload_dir: Override base directory for file storage (for testing).

        Returns:
            Attachment dict with metadata.

        Raises:
            TicketsNotFoundError: If request not found.
            TicketsValidationError: If validation fails.
        """
        errors: list[str] = []

        # Validate file extension
        ext = self._get_file_extension(file_name)
        if ext not in ALLOWED_ATTACHMENT_EXTENSIONS:
            errors.append(
                f"File format '{ext}' is not allowed. "
                f"Allowed formats: {', '.join(sorted(ALLOWED_ATTACHMENT_EXTENSIONS))}"
            )

        # Validate file size
        file_size = len(file_content)
        if file_size > MAX_ATTACHMENT_SIZE:
            errors.append(
                f"File size {file_size} bytes exceeds maximum of {MAX_ATTACHMENT_SIZE} bytes (20 MB)"
            )

        # Validate file_type
        if file_type not in VALID_ATTACHMENT_TYPES:
            errors.append(
                f"Invalid file_type '{file_type}'. "
                f"Must be one of: {', '.join(sorted(VALID_ATTACHMENT_TYPES))}"
            )

        if errors:
            raise TicketsValidationError(errors)

        upload_dir = base_upload_dir or DEFAULT_UPLOAD_DIR

        with app_session(self._database_url) as session:
            # Verify request exists
            req = session.get(TicketRequest, request_id)
            if req is None:
                raise TicketsNotFoundError(f"Request with id={request_id} not found")

            # Validate attachment count
            existing_count = session.execute(
                select(func.count()).where(TicketAttachment.request_id == request_id)
            ).scalar() or 0

            if existing_count >= MAX_ATTACHMENTS_PER_REQUEST:
                raise TicketsValidationError(
                    [f"Maximum {MAX_ATTACHMENTS_PER_REQUEST} attachments per request reached"]
                )

            # Generate UUID and storage path
            attachment_id = uuid_mod.uuid4().hex
            storage_path = str(
                Path(upload_dir) / str(request_id) / f"{attachment_id}.{ext}"
            )

            # Save file to disk
            full_path = Path(storage_path)
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_bytes(file_content)

            # Create DB record
            now = _utcnow()
            attachment = TicketAttachment(
                id=attachment_id,
                request_id=request_id,
                file_name=file_name,
                file_type=file_type,
                file_size=file_size,
                storage_path=storage_path,
                uploaded_by_id=user_id,
                created_at=now,
            )
            session.add(attachment)
            session.flush()

            result = self._attachment_to_dict(attachment)

        return result

    def delete_attachment(
        self,
        request_id: int,
        attachment_id: str,
        user_id: int,
    ) -> None:
        """Delete an attachment from a ticket request.

        Removes the file from disk, deletes the DB record, and creates
        a change history entry documenting the deletion.

        Args:
            request_id: ID of the ticket request.
            attachment_id: UUID of the attachment.
            user_id: ID of the user performing the deletion.

        Raises:
            TicketsNotFoundError: If request or attachment not found.
        """
        with app_session(self._database_url) as session:
            # Verify request exists
            req = session.get(TicketRequest, request_id)
            if req is None:
                raise TicketsNotFoundError(f"Request with id={request_id} not found")

            # Find attachment and verify it belongs to the request
            attachment = session.get(TicketAttachment, attachment_id)
            if attachment is None or attachment.request_id != request_id:
                raise TicketsNotFoundError(
                    f"Attachment with id={attachment_id} not found for request {request_id}"
                )

            file_name = attachment.file_name
            storage_path = attachment.storage_path

            # Delete file from disk (ignore if already missing)
            try:
                file_path = Path(storage_path)
                if file_path.exists():
                    file_path.unlink()
            except OSError as e:
                logger.warning(
                    "Failed to delete attachment file %s: %s", storage_path, e
                )

            # Delete DB record
            session.delete(attachment)

            # Create change history record
            now = _utcnow()
            history_record = TicketChangeHistory(
                request_id=request_id,
                field_name="attachment_deleted",
                old_value=file_name,
                new_value=None,
                changed_by_id=user_id,
                source="manual",
                comment=f"Deleted attachment: {file_name}",
                created_at=now,
            )
            session.add(history_record)
            session.flush()

    def list_attachments(self, request_id: int) -> list[dict[str, Any]]:
        """List all attachments for a ticket request.

        Args:
            request_id: ID of the ticket request.

        Returns:
            List of attachment dicts.

        Raises:
            TicketsNotFoundError: If request not found.
        """
        with app_session(self._database_url) as session:
            # Verify request exists
            req = session.get(TicketRequest, request_id)
            if req is None:
                raise TicketsNotFoundError(f"Request with id={request_id} not found")

            attachments = session.scalars(
                select(TicketAttachment)
                .where(TicketAttachment.request_id == request_id)
                .order_by(TicketAttachment.created_at.asc())
            ).all()

            return [self._attachment_to_dict(att) for att in attachments]

    # ------------------------------------------------------------------
    # Private helpers — Attachments
    # ------------------------------------------------------------------

    @staticmethod
    def _get_file_extension(file_name: str) -> str:
        """Extract and normalize file extension from a file name."""
        if not file_name or "." not in file_name:
            return ""
        return file_name.rsplit(".", 1)[-1].lower()

    @staticmethod
    def _attachment_to_dict(attachment: TicketAttachment) -> dict[str, Any]:
        """Convert a TicketAttachment model instance to a plain dict."""
        return {
            "id": attachment.id,
            "request_id": attachment.request_id,
            "file_name": attachment.file_name,
            "file_type": attachment.file_type,
            "file_size": attachment.file_size,
            "storage_path": attachment.storage_path,
            "uploaded_by_id": attachment.uploaded_by_id,
            "created_at": attachment.created_at.isoformat() if attachment.created_at else None,
        }

    # ------------------------------------------------------------------
    # Private helpers — Employee
    # ------------------------------------------------------------------

    @staticmethod
    def _can_read_personal_data(user_permissions: list[str] | None) -> bool:
        """Check if user has permission to read personal data."""
        if user_permissions is None:
            return False
        return PERM_TICKETS_PERSONAL_DATA_READ in user_permissions

    @staticmethod
    def _employee_to_dict(
        employee: TicketEmployee,
        *,
        decrypt: bool = False,
        include_personal: bool = False,
    ) -> dict[str, Any]:
        """Convert employee model to dict (without documents)."""
        result = {
            "id": employee.id,
            "full_name": employee.full_name,
            "department": employee.department,
            "position": employee.position,
            "phone": employee.phone,
            "email": employee.email,
            "status": employee.status,
            "app_user_id": employee.app_user_id,
            "created_at": employee.created_at.isoformat() if employee.created_at else None,
            "updated_at": employee.updated_at.isoformat() if employee.updated_at else None,
        }
        if include_personal:
            if decrypt and employee.date_of_birth_enc:
                result["date_of_birth"] = decrypt_secret(employee.date_of_birth_enc) or None
            elif employee.date_of_birth_enc:
                result["date_of_birth"] = MASKED_VALUE
            else:
                result["date_of_birth"] = None
        return result

    @staticmethod
    def _document_to_dict(doc: TicketEmployeeDocument, *, decrypt: bool = False) -> dict[str, Any]:
        """Convert document model to dict, decrypting or masking personal data."""
        personal = _document_personal_fields(doc, decrypt=decrypt)
        return {
            "id": doc.id,
            "employee_id": doc.employee_id,
            "passport_series_number": personal["passport_series_number"],
            "passport_series": personal["passport_series"],
            "passport_number": personal["passport_number"],
            "issued_by": personal["issued_by"],
            "issuer_code": personal["issuer_code"],
            "birth_place": personal["birth_place"],
            "issue_date": doc.issue_date.isoformat() if doc.issue_date else None,
            "registration_address": personal["registration_address"],
            "is_current": doc.is_current,
            "created_at": doc.created_at.isoformat() if doc.created_at else None,
            "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
        }

    @staticmethod
    def _resolve_passport_fields(data: dict[str, Any]) -> tuple[str, str, str]:
        series = str(data.get("passport_series") or "").strip()
        number = str(data.get("passport_number") or "").strip()
        combined = str(data.get("passport_series_number") or "").strip()
        if not series and not number and combined and combined != MASKED_VALUE:
            series, number = split_passport_series_number(combined)
        if not combined and (series or number):
            combined = " ".join(part for part in (series, number) if part).strip()
        return series, number, combined

    @staticmethod
    def _validate_employee_data(data: dict[str, Any]) -> list[str]:
        """Validate employee creation data. Returns list of error messages."""
        errors: list[str] = []
        full_name = str(data.get("full_name") or "").strip()
        if not full_name:
            errors.append("full_name is required")
        elif len(full_name) > 150:
            errors.append("full_name must not exceed 150 characters")

        status = data.get("status")
        if status and status not in EMPLOYEE_STATUSES:
            errors.append(f"status must be one of: {', '.join(sorted(EMPLOYEE_STATUSES))}")

        return errors

    @staticmethod
    def _validate_employee_update_data(data: dict[str, Any]) -> list[str]:
        """Validate employee update data. Returns list of error messages."""
        errors: list[str] = []
        if "full_name" in data:
            full_name = str(data["full_name"] or "").strip()
            if not full_name:
                errors.append("full_name cannot be empty")
            elif len(full_name) > 150:
                errors.append("full_name must not exceed 150 characters")

        if "status" in data and data["status"] not in EMPLOYEE_STATUSES:
            errors.append(f"status must be one of: {', '.join(sorted(EMPLOYEE_STATUSES))}")

        return errors

    @staticmethod
    def _validate_document_data(data: dict[str, Any], *, is_update: bool = False) -> list[str]:
        """Validate employee document data.

        Mandatory fields for creation: passport_series_number, issued_by, issue_date.
        issue_date must not be in the future.
        """
        errors: list[str] = []

        if not is_update:
            series, number, combined = TicketsService._resolve_passport_fields(data)
            if not combined:
                errors.append("passport_series_number or passport_series/passport_number is required")

            issued_by = str(data.get("issued_by") or "").strip()
            if not issued_by:
                errors.append("issued_by is required")

            issue_date_raw = data.get("issue_date")
            if not issue_date_raw:
                errors.append("issue_date is required")
            else:
                issue_date = _parse_date(issue_date_raw)
                if issue_date is None:
                    errors.append("issue_date has invalid format")
                elif issue_date > _utcnow():
                    errors.append("issue_date must not be in the future")
        else:
            if any(
                key in data
                for key in ("passport_series_number", "passport_series", "passport_number")
            ):
                series, number, combined = TicketsService._resolve_passport_fields(data)
                if not combined or combined == MASKED_VALUE:
                    errors.append("passport_series_number cannot be empty")

            if "issued_by" in data:
                issued_by = str(data["issued_by"] or "").strip()
                if not issued_by:
                    errors.append("issued_by cannot be empty")

            if "issue_date" in data:
                issue_date_raw = data["issue_date"]
                if not issue_date_raw:
                    errors.append("issue_date cannot be empty")
                else:
                    issue_date = _parse_date(issue_date_raw)
                    if issue_date is None:
                        errors.append("issue_date has invalid format")
                    elif issue_date > _utcnow():
                        errors.append("issue_date must not be in the future")

        return errors

    @staticmethod
    def _create_document_from_data(
        employee_id: int, data: dict[str, Any], now: datetime
    ) -> TicketEmployeeDocument:
        """Create a TicketEmployeeDocument instance from data dict."""
        issue_date = _parse_date(data.get("issue_date"))
        series, number, combined = TicketsService._resolve_passport_fields(data)

        return TicketEmployeeDocument(
            employee_id=employee_id,
            passport_series_number_enc=encrypt_secret(combined),
            passport_series_enc=encrypt_secret(series) if series else "",
            passport_number_enc=encrypt_secret(number) if number else "",
            issuer_code_enc=encrypt_secret(str(data.get("issuer_code") or "").strip()),
            birth_place_enc=encrypt_secret(str(data.get("birth_place") or "").strip()),
            issued_by_enc=encrypt_secret(str(data.get("issued_by") or "").strip()),
            issue_date=issue_date,
            registration_address_enc=encrypt_secret(
                str(data.get("registration_address") or "").strip()
            ),
            is_current=bool(data.get("is_current", True)),
            created_at=now,
            updated_at=now,
        )

    @staticmethod
    def _update_document_from_data(
        doc: TicketEmployeeDocument, data: dict[str, Any], now: datetime
    ) -> None:
        """Update an existing TicketEmployeeDocument from data dict."""
        if any(
            key in data
            for key in ("passport_series_number", "passport_series", "passport_number")
        ):
            series, number, combined = TicketsService._resolve_passport_fields(data)
            if combined and combined != MASKED_VALUE:
                doc.passport_series_number_enc = encrypt_secret(combined)
                doc.passport_series_enc = encrypt_secret(series) if series else ""
                doc.passport_number_enc = encrypt_secret(number) if number else ""
        if "issuer_code" in data:
            value = str(data["issuer_code"] or "").strip()
            if value and value != MASKED_VALUE:
                doc.issuer_code_enc = encrypt_secret(value)
        if "birth_place" in data:
            value = str(data["birth_place"] or "").strip()
            if value and value != MASKED_VALUE:
                doc.birth_place_enc = encrypt_secret(value)
        if "issued_by" in data:
            value = str(data["issued_by"] or "").strip()
            if value and value != MASKED_VALUE:
                doc.issued_by_enc = encrypt_secret(value)
        if "issue_date" in data:
            doc.issue_date = _parse_date(data["issue_date"])
        if "registration_address" in data:
            value = str(data["registration_address"] or "").strip()
            if value and value != MASKED_VALUE:
                doc.registration_address_enc = encrypt_secret(value)
        if "is_current" in data:
            doc.is_current = bool(data["is_current"])
        doc.updated_at = now

    @staticmethod
    def _normalize_optional_str(value: Any, *, max_len: int = 255) -> str | None:
        """Normalize an optional string field: strip, truncate, return None if empty."""
        if value is None:
            return None
        result = str(value).strip()[:max_len]
        return result if result else None

    # ------------------------------------------------------------------
    # Private helpers — Objects
    # ------------------------------------------------------------------

    @staticmethod
    def _require_admin(user: dict[str, Any]) -> None:
        """Raise PermissionError if user is not admin."""
        role = str(user.get("role") or "").strip().lower()
        if role != "admin":
            raise PermissionError("Only admin can manage objects")

    @staticmethod
    def _validate_object_code(code: Any) -> str:
        """Validate object code: 2-10 characters, stripped."""
        code = str(code or "").strip()
        if len(code) < 2 or len(code) > 10:
            raise ValueError(
                f"Object code must be between 2 and 10 characters, got {len(code)}"
            )
        return code

    @staticmethod
    def _validate_object_name(name: Any) -> str:
        """Validate object name: non-empty, up to 150 chars."""
        raw_name = str(name or "")
        if not raw_name.strip():
            raise ValueError("Object name is required")
        if len(raw_name) > 150:
            raise ValueError(
                f"Object name must be at most 150 characters, got {len(raw_name)}"
            )
        return raw_name

    @staticmethod
    def _validate_object_region(region: Any) -> str:
        """Validate object region: non-empty, up to 100 chars."""
        raw_region = str(region or "")
        if not raw_region.strip():
            raise ValueError("Object region is required")
        if len(raw_region) > 100:
            raise ValueError(
                f"Object region must be at most 100 characters, got {len(raw_region)}"
            )
        return raw_region

    @staticmethod
    def _object_to_dict(obj: TicketObject) -> dict[str, Any]:
        """Convert a TicketObject model instance to a plain dict."""
        return {
            "id": obj.id,
            "code": obj.code,
            "name": obj.name,
            "short_name": obj.short_name,
            "region": obj.region,
            "default_assignee_id": obj.default_assignee_id,
            "is_active": obj.is_active,
            "created_at": obj.created_at.isoformat() if obj.created_at else None,
            "updated_at": obj.updated_at.isoformat() if obj.updated_at else None,
        }

    # ==================================================================
    # Financial Operations — CRUD with soft delete
    # ==================================================================

    def create_financial_op(self, data: dict[str, Any], user_id: int) -> dict[str, Any]:
        """Create a new financial operation.

        Args:
            data: Dict with fields: op_type (required), amount, request_id,
                  employee_id, object_id, reason, refund_status, op_date.
            user_id: ID of the user performing the action.

        Returns:
            Created financial operation as dict.

        Raises:
            TicketsValidationError: If op_type is invalid or amount is negative.
        """
        errors = self._validate_financial_op_data(data, is_create=True)
        if errors:
            raise TicketsValidationError(errors)

        now = _utcnow()
        amount = Decimal(str(data.get("amount") or "0.00"))
        op_date = _parse_date(data.get("op_date"))

        with app_session(self._database_url) as session:
            op = TicketFinancialOp(
                request_id=data.get("request_id"),
                employee_id=data.get("employee_id"),
                object_id=data.get("object_id"),
                op_type=data["op_type"],
                amount=amount,
                reason=self._normalize_optional_str(data.get("reason"), max_len=500),
                refund_status=self._normalize_optional_str(data.get("refund_status"), max_len=30),
                op_date=op_date,
                is_deleted=False,
                created_at=now,
                updated_at=now,
            )
            session.add(op)
            session.flush()
            session.refresh(op)
            result = self._financial_op_to_dict(op)

        return result

    def update_financial_op(self, op_id: int, data: dict[str, Any], user_id: int) -> dict[str, Any]:
        """Update an existing financial operation.

        Allowed fields: amount, reason, refund_status, op_date, op_type.

        Args:
            op_id: ID of the financial operation to update.
            data: Dict with fields to update.
            user_id: ID of the user performing the action.

        Returns:
            Updated financial operation as dict.

        Raises:
            TicketsNotFoundError: If operation not found or is soft-deleted.
            TicketsValidationError: If provided data is invalid.
        """
        errors = self._validate_financial_op_data(data, is_create=False)
        if errors:
            raise TicketsValidationError(errors)

        now = _utcnow()
        with app_session(self._database_url) as session:
            op = session.scalars(
                select(TicketFinancialOp).where(TicketFinancialOp.id == int(op_id))
            ).first()

            if op is None or op.is_deleted:
                raise TicketsNotFoundError(f"Financial operation with id={op_id} not found")

            # Apply allowed fields
            if "op_type" in data:
                op.op_type = data["op_type"]
            if "amount" in data:
                op.amount = Decimal(str(data["amount"]))
            if "reason" in data:
                op.reason = self._normalize_optional_str(data["reason"], max_len=500)
            if "refund_status" in data:
                op.refund_status = self._normalize_optional_str(data["refund_status"], max_len=30)
            if "op_date" in data:
                op.op_date = _parse_date(data["op_date"])

            op.updated_at = now
            session.flush()
            session.refresh(op)
            result = self._financial_op_to_dict(op)

        return result

    def list_financial_ops(
        self,
        filters: FinOpFilters | None = None,
        pagination: Pagination | None = None,
    ) -> PagedResult:
        """List financial operations with filters and pagination.

        Args:
            filters: Filter parameters (request_id, employee_id, object_id,
                     op_type, refund_status, date_from, date_to, include_deleted).
            pagination: Pagination parameters.

        Returns:
            PagedResult with financial operations.
        """
        if filters is None:
            filters = FinOpFilters()
        if pagination is None:
            pagination = Pagination()

        with app_session(self._database_url) as session:
            query = select(TicketFinancialOp)

            # Exclude soft-deleted by default
            if not filters.include_deleted:
                query = query.where(TicketFinancialOp.is_deleted.is_(False))

            # Apply filters
            if filters.request_id is not None:
                query = query.where(TicketFinancialOp.request_id == filters.request_id)
            if filters.employee_id is not None:
                query = query.where(TicketFinancialOp.employee_id == filters.employee_id)
            if filters.object_id is not None:
                query = query.where(TicketFinancialOp.object_id == filters.object_id)
            if filters.op_type is not None:
                query = query.where(TicketFinancialOp.op_type == filters.op_type)
            if filters.refund_status is not None:
                query = query.where(TicketFinancialOp.refund_status == filters.refund_status)
            if filters.date_from is not None:
                query = query.where(TicketFinancialOp.op_date >= filters.date_from)
            if filters.date_to is not None:
                query = query.where(TicketFinancialOp.op_date <= filters.date_to)

            # Count total
            count_query = select(func.count()).select_from(query.subquery())
            total = session.execute(count_query).scalar() or 0

            # Apply ordering and pagination
            query = (
                query.order_by(TicketFinancialOp.op_date.desc().nullslast(), TicketFinancialOp.id.desc())
                .offset(pagination.offset)
                .limit(pagination.page_size)
            )

            rows = session.scalars(query).all()
            items = [self._financial_op_to_dict(op) for op in rows]

        return PagedResult(
            items=items,
            total=total,
            page=pagination.page,
            page_size=pagination.page_size,
        )

    def delete_financial_op(self, op_id: int, user_id: int) -> None:
        """Soft-delete a financial operation (set is_deleted=True).

        Args:
            op_id: ID of the financial operation to delete.
            user_id: ID of the user performing the action.

        Raises:
            TicketsNotFoundError: If operation not found or already deleted.
        """
        now = _utcnow()
        with app_session(self._database_url) as session:
            op = session.scalars(
                select(TicketFinancialOp).where(TicketFinancialOp.id == int(op_id))
            ).first()

            if op is None or op.is_deleted:
                raise TicketsNotFoundError(f"Financial operation with id={op_id} not found")

            op.is_deleted = True
            op.updated_at = now
            session.flush()

    # ==================================================================
    # Reports — Loss report and exports
    # ==================================================================

    LOSS_REPORT_MAX_PERIOD_DAYS = 366
    LOSS_REPORT_DEFAULT_PAGE_SIZE = 50
    EXPORT_MAX_RECORDS = 50_000

    def get_losses_report(
        self,
        filters: dict[str, Any] | None = None,
        pagination: Pagination | None = None,
    ) -> dict[str, Any]:
        """Generate loss report with filtering and totals.

        Filters:
            - date_from / date_to: period (max 366 days, default current month)
            - object_id: filter by object
            - op_type: filter by operation type (refund, exchange, loss)

        Returns dict with:
            - items: list of financial op dicts (paginated, max 50/page)
            - totals: {total_losses: Decimal, total_refunds: Decimal, balance: Decimal}
            - pagination: {page, page_size, total, total_pages}
        """
        if filters is None:
            filters = {}
        if pagination is None:
            pagination = Pagination(page=1, page_size=self.LOSS_REPORT_DEFAULT_PAGE_SIZE)

        # Enforce page_size max 50 for loss report
        if pagination.page_size > 50:
            pagination.page_size = 50

        # Parse and validate date range
        date_from = _parse_date(filters.get("date_from"))
        date_to = _parse_date(filters.get("date_to"))

        # Default to current month if no dates provided
        if date_from is None and date_to is None:
            now = _utcnow()
            date_from = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            # End of current month
            if now.month == 12:
                date_to = now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
            else:
                date_to = now.replace(month=now.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
        elif date_from is None:
            date_from = date_to - timedelta(days=30)
        elif date_to is None:
            date_to = date_from + timedelta(days=30)

        # Validate max period (366 days)
        if (date_to - date_from).days > self.LOSS_REPORT_MAX_PERIOD_DAYS:
            raise TicketsValidationError(
                [f"Period must not exceed {self.LOSS_REPORT_MAX_PERIOD_DAYS} days"]
            )

        object_id = filters.get("object_id")
        op_type = filters.get("op_type")

        with app_session(self._database_url) as session:
            # Base query — non-deleted financial ops within date range
            base_conditions = [
                TicketFinancialOp.is_deleted.is_(False),
                TicketFinancialOp.op_date >= date_from,
                TicketFinancialOp.op_date < date_to,
            ]

            if object_id is not None:
                base_conditions.append(TicketFinancialOp.object_id == int(object_id))
            if op_type is not None:
                if op_type in VALID_FIN_OP_TYPES:
                    base_conditions.append(TicketFinancialOp.op_type == op_type)

            where_clause = and_(*base_conditions)

            # Calculate totals using Decimal aggregation
            totals_query = select(
                func.coalesce(
                    func.sum(
                        case(
                            (TicketFinancialOp.op_type == "loss", TicketFinancialOp.amount),
                            else_=Decimal("0.00"),
                        )
                    ),
                    Decimal("0.00"),
                ).label("total_losses"),
                func.coalesce(
                    func.sum(
                        case(
                            (TicketFinancialOp.op_type == "refund", TicketFinancialOp.amount),
                            else_=Decimal("0.00"),
                        )
                    ),
                    Decimal("0.00"),
                ).label("total_refunds"),
            ).where(where_clause)

            totals_row = session.execute(totals_query).one()
            total_losses = Decimal(str(totals_row.total_losses or "0.00"))
            total_refunds = Decimal(str(totals_row.total_refunds or "0.00"))
            balance = total_losses - total_refunds

            # Count total records
            count_query = select(func.count(TicketFinancialOp.id)).where(where_clause)
            total = session.execute(count_query).scalar() or 0

            # Fetch paginated items
            items_query = (
                select(TicketFinancialOp)
                .where(where_clause)
                .options(
                    joinedload(TicketFinancialOp.employee),
                    joinedload(TicketFinancialOp.object),
                )
                .order_by(TicketFinancialOp.op_date.desc().nullslast(), TicketFinancialOp.id.desc())
                .offset(pagination.offset)
                .limit(pagination.page_size)
            )

            rows = session.execute(items_query).unique().scalars().all()
            items = [self._loss_report_item_to_dict(op) for op in rows]

        total_pages = (total + pagination.page_size - 1) // pagination.page_size if total > 0 else 0

        return {
            "items": items,
            "totals": {
                "total_losses": str(total_losses),
                "total_refunds": str(total_refunds),
                "balance": str(balance),
            },
            "pagination": {
                "page": pagination.page,
                "page_size": pagination.page_size,
                "total": total,
                "total_pages": total_pages,
            },
        }

    def export_losses_xlsx(self, filters: dict[str, Any] | None = None) -> bytes:
        """Export loss report to .xlsx file.

        Generates an openpyxl Workbook with columns:
        ФИО, Объект, Дата, Сумма, Причина, Тип операции, Статус возврата

        Max 50,000 records. Returns bytes (workbook saved to BytesIO).

        Args:
            filters: Same filters as get_losses_report (date_from, date_to, object_id, op_type)

        Returns:
            bytes: The .xlsx file content.
        """
        from io import BytesIO

        from openpyxl import Workbook

        if filters is None:
            filters = {}

        # Parse and validate date range (same logic as get_losses_report)
        date_from = _parse_date(filters.get("date_from"))
        date_to = _parse_date(filters.get("date_to"))

        if date_from is None and date_to is None:
            now = _utcnow()
            date_from = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            if now.month == 12:
                date_to = now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
            else:
                date_to = now.replace(month=now.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
        elif date_from is None:
            date_from = date_to - timedelta(days=30)
        elif date_to is None:
            date_to = date_from + timedelta(days=30)

        if (date_to - date_from).days > self.LOSS_REPORT_MAX_PERIOD_DAYS:
            raise TicketsValidationError(
                [f"Period must not exceed {self.LOSS_REPORT_MAX_PERIOD_DAYS} days"]
            )

        object_id = filters.get("object_id")
        op_type = filters.get("op_type")

        with app_session(self._database_url) as session:
            base_conditions = [
                TicketFinancialOp.is_deleted.is_(False),
                TicketFinancialOp.op_date >= date_from,
                TicketFinancialOp.op_date < date_to,
            ]

            if object_id is not None:
                base_conditions.append(TicketFinancialOp.object_id == int(object_id))
            if op_type is not None:
                if op_type in VALID_FIN_OP_TYPES:
                    base_conditions.append(TicketFinancialOp.op_type == op_type)

            query = (
                select(TicketFinancialOp)
                .where(and_(*base_conditions))
                .options(
                    joinedload(TicketFinancialOp.employee),
                    joinedload(TicketFinancialOp.object),
                )
                .order_by(TicketFinancialOp.op_date.desc().nullslast(), TicketFinancialOp.id.desc())
                .limit(self.EXPORT_MAX_RECORDS)
            )

            rows = session.execute(query).unique().scalars().all()

            # Build workbook
            wb = Workbook()
            ws = wb.active
            ws.title = "Потери и возвраты"

            # Header row
            headers = ["ФИО", "Объект", "Дата", "Сумма", "Причина", "Тип операции", "Статус возврата"]
            ws.append(headers)

            # Data rows
            op_type_labels = {"refund": "Возврат", "exchange": "Обмен", "loss": "Потеря"}
            for op in rows:
                employee_name = op.employee.full_name if op.employee else ""
                object_name = op.object.name if op.object else ""
                op_date_str = op.op_date.strftime("%d.%m.%Y") if op.op_date else ""
                amount_val = float(op.amount) if op.amount else 0.0
                reason = op.reason or ""
                op_type_label = op_type_labels.get(op.op_type, op.op_type)
                refund_status = op.refund_status or ""

                ws.append([employee_name, object_name, op_date_str, amount_val, reason, op_type_label, refund_status])

        # Save to bytes
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        return output.read()

    def export_requests_xlsx(
        self,
        filters: RequestFilters | None = None,
        user_permissions: list[str] | None = None,
    ) -> bytes:
        """Export general request list to .xlsx file (Excel template columns)."""
        from io import BytesIO

        from openpyxl import Workbook

        if filters is None:
            filters = RequestFilters()

        can_read_personal = self._can_read_personal_data(user_permissions)

        with app_session(self._database_url) as session:
            query = select(TicketRequest)

            # Apply search joins if needed
            needs_search_joins = (
                filters.search and len(filters.search) >= MIN_SEARCH_LENGTH
            )
            if needs_search_joins:
                query = query.join(
                    TicketEmployee,
                    TicketRequest.employee_id == TicketEmployee.id,
                    isouter=True,
                ).join(
                    TicketObject,
                    TicketRequest.object_id == TicketObject.id,
                    isouter=True,
                )

            # Apply filters (same logic as list_requests)
            if filters.object_ids:
                query = query.where(TicketRequest.object_id.in_(filters.object_ids))
            if filters.statuses:
                query = query.where(TicketRequest.status.in_(filters.statuses))
            if filters.assignee_ids:
                has_none = None in filters.assignee_ids
                non_none_ids = [aid for aid in filters.assignee_ids if aid is not None]
                if has_none and non_none_ids:
                    query = query.where(
                        or_(
                            TicketRequest.assignee_id.in_(non_none_ids),
                            TicketRequest.assignee_id.is_(None),
                        )
                    )
                elif has_none:
                    query = query.where(TicketRequest.assignee_id.is_(None))
                else:
                    query = query.where(TicketRequest.assignee_id.in_(non_none_ids))
            if needs_search_joins:
                search_term = f"%{filters.search.lower()}%"
                query = query.where(
                    or_(
                        func.lower(TicketEmployee.full_name).like(search_term),
                        func.lower(func.coalesce(TicketEmployee.phone, "")).like(search_term),
                        func.lower(TicketObject.code).like(search_term),
                        func.cast(TicketRequest.id, SAString).like(search_term),
                    )
                )

            # Sort and limit
            sort_attr_name = SORTABLE_COLUMNS.get(filters.sort_field, "created_at")
            sort_attr = getattr(TicketRequest, sort_attr_name, TicketRequest.created_at)
            if filters.sort_dir == "asc":
                query = query.order_by(sort_attr.asc())
            else:
                query = query.order_by(sort_attr.desc())

            query = query.limit(self.EXPORT_MAX_RECORDS)

            # Eager load relationships
            query = query.options(
                joinedload(TicketRequest.employee).selectinload(TicketEmployee.documents),
                joinedload(TicketRequest.object),
                joinedload(TicketRequest.assignee),
            )

            rows = session.execute(query).unique().scalars().all()

            # Build workbook
            wb = Workbook()
            ws = wb.active
            ws.title = "Заявки"

            headers = [
                "№ п/п",
                "Дата подачи",
                "ФИО",
                "Подразделение",
                "Должность",
                "Серия",
                "Номер",
                "Дата выдачи",
                "Кем выдан",
                "Код подр.",
                "Дата рождения",
                "Место рождения",
                "Прописка",
                "Телефон",
                "Прибытие / город",
                "№ заявки",
                "Шифр объекта",
                "Примечание",
                "Стоимость",
                "Возврат",
                "Статус",
            ]
            ws.append(headers)

            for index, req in enumerate(rows, start=1):
                row = _request_list_row_to_dict(req, decrypt_personal=can_read_personal)
                arrival = row.get("arrival_date") or ""
                route = row.get("route") or ""
                arrival_route = " / ".join(
                    part for part in (
                        arrival[:10] if arrival else "",
                        route,
                    ) if part
                )
                submitted = row.get("submitted_at") or ""
                issue_date = row.get("issue_date") or ""
                dob = row.get("date_of_birth") or ""
                ws.append([
                    index,
                    submitted[:10] if submitted else "",
                    row.get("employee_name") or "",
                    row.get("department") or "",
                    row.get("position") or "",
                    row.get("passport_series") or "",
                    row.get("passport_number") or "",
                    issue_date[:10] if issue_date else "",
                    row.get("issued_by") or "",
                    row.get("issuer_code") or "",
                    dob[:10] if dob and dob != MASKED_VALUE else dob,
                    row.get("birth_place") or "",
                    row.get("registration_address") or "",
                    row.get("phone") or "",
                    arrival_route,
                    row.get("id"),
                    row.get("object_code") or "",
                    row.get("note") or "",
                    float(row.get("total_cost") or 0),
                    float(row.get("refund_loss") or 0),
                    STATUS_LABELS.get(row.get("status"), row.get("status")),
                ])

        # Save to bytes
        output = BytesIO()
        wb.save(output)
        output.seek(0)
        return output.read()

    @staticmethod
    def _loss_report_item_to_dict(op: TicketFinancialOp) -> dict[str, Any]:
        """Convert a TicketFinancialOp to a loss report item dict."""
        op_type_labels = {"refund": "Возврат", "exchange": "Обмен", "loss": "Потеря"}
        return {
            "id": op.id,
            "employee_name": op.employee.full_name if op.employee else "",
            "object_name": op.object.name if op.object else "",
            "op_date": op.op_date.isoformat() if op.op_date else None,
            "amount": str(op.amount),
            "reason": op.reason,
            "op_type": op.op_type,
            "op_type_label": op_type_labels.get(op.op_type, op.op_type),
            "refund_status": op.refund_status,
        }

    # ==================================================================
    # Dashboard
    # ==================================================================

    # Active statuses for dashboard metrics
    ACTIVE_STATUSES = {
        "not_started",
        "at_cashier",
        "purchased",
        "exchange_needed",
    }
    # Problematic statuses — requests needing attention
    PROBLEMATIC_STATUSES = {"exchange_needed", "cancel_purchase", "refund_needed"}

    def get_dashboard(self) -> dict[str, Any]:
        """Return dashboard data with metrics, per-object breakdown, and top lists.

        Returns a dict with keys:
        - metrics: overall counts and sums
        - per_object: list of per-object breakdowns
        - top_problems: top 5 objects by problematic count
        - top_assignees: top 5 assignees by active request count
        """
        now = _utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        tomorrow_start = today_start + timedelta(days=1)
        day_after_tomorrow_start = today_start + timedelta(days=2)
        three_days_end = today_start + timedelta(days=3)

        with app_session(self._database_url) as session:
            # ----------------------------------------------------------
            # Overall metrics
            # ----------------------------------------------------------
            active_statuses = list(self.ACTIVE_STATUSES)
            problematic_statuses = list(self.PROBLEMATIC_STATUSES)

            # Total active requests
            total_active = session.scalar(
                select(func.count(TicketRequest.id)).where(
                    TicketRequest.status.in_(active_statuses)
                )
            ) or 0

            # Count by specific statuses
            new_count = session.scalar(
                select(func.count(TicketRequest.id)).where(
                    TicketRequest.status == "not_started"
                )
            ) or 0

            in_progress_count = session.scalar(
                select(func.count(TicketRequest.id)).where(
                    TicketRequest.status == "at_cashier"
                )
            ) or 0

            purchased_count = session.scalar(
                select(func.count(TicketRequest.id)).where(
                    TicketRequest.status == "purchased"
                )
            ) or 0

            problematic_count = session.scalar(
                select(func.count(TicketRequest.id)).where(
                    TicketRequest.status.in_(problematic_statuses)
                )
            ) or 0

            # Departures today / tomorrow / 3 days
            departures_today = session.scalar(
                select(func.count(TicketRequest.id)).where(
                    and_(
                        TicketRequest.status.in_(active_statuses),
                        TicketRequest.departure_date >= today_start,
                        TicketRequest.departure_date < tomorrow_start,
                    )
                )
            ) or 0

            departures_tomorrow = session.scalar(
                select(func.count(TicketRequest.id)).where(
                    and_(
                        TicketRequest.status.in_(active_statuses),
                        TicketRequest.departure_date >= tomorrow_start,
                        TicketRequest.departure_date < day_after_tomorrow_start,
                    )
                )
            ) or 0

            departures_3_days = session.scalar(
                select(func.count(TicketRequest.id)).where(
                    and_(
                        TicketRequest.status.in_(active_statuses),
                        TicketRequest.departure_date >= today_start,
                        TicketRequest.departure_date < three_days_end,
                    )
                )
            ) or 0

            # Refunds and exchanges count
            refunds_exchanges = session.scalar(
                select(func.count(TicketFinancialOp.id)).where(
                    and_(
                        TicketFinancialOp.is_deleted == False,  # noqa: E712
                        TicketFinancialOp.op_type.in_(["refund", "exchange"]),
                    )
                )
            ) or 0

            # Ticket sum (total_cost of active requests)
            ticket_sum = session.scalar(
                select(func.coalesce(func.sum(TicketRequest.total_cost), Decimal("0.00"))).where(
                    TicketRequest.status.in_(active_statuses)
                )
            ) or Decimal("0.00")

            # Loss sum (sum of financial ops with type 'loss')
            loss_sum = session.scalar(
                select(func.coalesce(func.sum(TicketFinancialOp.amount), Decimal("0.00"))).where(
                    and_(
                        TicketFinancialOp.is_deleted == False,  # noqa: E712
                        TicketFinancialOp.op_type == "loss",
                    )
                )
            ) or Decimal("0.00")

            metrics = {
                "total_active": total_active,
                "new": new_count,
                "in_progress": in_progress_count,
                "purchased": purchased_count,
                "problematic": problematic_count,
                "departures_today": departures_today,
                "departures_tomorrow": departures_tomorrow,
                "departures_3_days": departures_3_days,
                "refunds_exchanges": refunds_exchanges,
                "ticket_sum": str(ticket_sum),
                "loss_sum": str(loss_sum),
            }

            # ----------------------------------------------------------
            # Per-object breakdown
            # ----------------------------------------------------------
            from backend.appdb.models import AppUser

            # Get all active objects
            objects = session.scalars(
                select(TicketObject).where(TicketObject.is_active == True)  # noqa: E712
            ).all()

            per_object: list[dict[str, Any]] = []
            for obj in objects:
                # Assignee name
                assignee_name = ""
                if obj.default_assignee_id:
                    assignee = session.get(AppUser, obj.default_assignee_id)
                    if assignee:
                        assignee_name = assignee.full_name or assignee.username or ""

                # Counts per object
                obj_active = session.scalar(
                    select(func.count(TicketRequest.id)).where(
                        and_(
                            TicketRequest.object_id == obj.id,
                            TicketRequest.status.in_(active_statuses),
                        )
                    )
                ) or 0

                obj_new = session.scalar(
                    select(func.count(TicketRequest.id)).where(
                        and_(
                            TicketRequest.object_id == obj.id,
                            TicketRequest.status == "not_started",
                        )
                    )
                ) or 0

                obj_in_progress = session.scalar(
                    select(func.count(TicketRequest.id)).where(
                        and_(
                            TicketRequest.object_id == obj.id,
                            TicketRequest.status == "at_cashier",
                        )
                    )
                ) or 0

                obj_purchased = session.scalar(
                    select(func.count(TicketRequest.id)).where(
                        and_(
                            TicketRequest.object_id == obj.id,
                            TicketRequest.status == "purchased",
                        )
                    )
                ) or 0

                obj_problematic = session.scalar(
                    select(func.count(TicketRequest.id)).where(
                        and_(
                            TicketRequest.object_id == obj.id,
                            TicketRequest.status.in_(problematic_statuses),
                        )
                    )
                ) or 0

                # Nearest departure for this object (active requests only)
                nearest_departure = session.scalar(
                    select(func.min(TicketRequest.departure_date)).where(
                        and_(
                            TicketRequest.object_id == obj.id,
                            TicketRequest.status.in_(active_statuses),
                            TicketRequest.departure_date >= today_start,
                        )
                    )
                )

                # Ticket sum for this object (active requests)
                obj_ticket_sum = session.scalar(
                    select(func.coalesce(func.sum(TicketRequest.total_cost), Decimal("0.00"))).where(
                        and_(
                            TicketRequest.object_id == obj.id,
                            TicketRequest.status.in_(active_statuses),
                        )
                    )
                ) or Decimal("0.00")

                # Loss sum for this object
                obj_loss_sum = session.scalar(
                    select(func.coalesce(func.sum(TicketFinancialOp.amount), Decimal("0.00"))).where(
                        and_(
                            TicketFinancialOp.object_id == obj.id,
                            TicketFinancialOp.is_deleted == False,  # noqa: E712
                            TicketFinancialOp.op_type == "loss",
                        )
                    )
                ) or Decimal("0.00")

                per_object.append({
                    "object_id": obj.id,
                    "object_name": obj.name,
                    "object_code": obj.code,
                    "assignee_name": assignee_name,
                    "active": obj_active,
                    "new": obj_new,
                    "in_progress": obj_in_progress,
                    "purchased": obj_purchased,
                    "problematic": obj_problematic,
                    "nearest_departure": nearest_departure.isoformat() if nearest_departure else None,
                    "ticket_sum": str(obj_ticket_sum),
                    "loss_sum": str(obj_loss_sum),
                })

            # ----------------------------------------------------------
            # Top objects by problems (top 5)
            # ----------------------------------------------------------
            top_problems = sorted(
                [o for o in per_object if o["problematic"] > 0],
                key=lambda x: x["problematic"],
                reverse=True,
            )[:5]

            # ----------------------------------------------------------
            # Top assignees by load (active request count, top 5)
            # ----------------------------------------------------------
            assignee_load_rows = session.execute(
                select(
                    TicketRequest.assignee_id,
                    func.count(TicketRequest.id).label("active_count"),
                ).where(
                    and_(
                        TicketRequest.status.in_(active_statuses),
                        TicketRequest.assignee_id.isnot(None),
                    )
                ).group_by(TicketRequest.assignee_id)
                .order_by(func.count(TicketRequest.id).desc())
                .limit(5)
            ).all()

            top_assignees: list[dict[str, Any]] = []
            for row in assignee_load_rows:
                assignee_id = row[0]
                active_count = row[1]
                assignee = session.get(AppUser, assignee_id)
                assignee_name = ""
                if assignee:
                    assignee_name = assignee.full_name or assignee.username or ""
                top_assignees.append({
                    "assignee_id": assignee_id,
                    "assignee_name": assignee_name,
                    "active_count": active_count,
                })

        return {
            "metrics": metrics,
            "per_object": per_object,
            "top_problems": top_problems,
            "top_assignees": top_assignees,
        }

    # ==================================================================
    # Kanban
    # ==================================================================

    def get_kanban(self, filters: dict[str, Any] | None = None) -> dict[str, list[dict[str, Any]]]:
        """Return kanban board data — requests grouped by status columns.

        Kanban columns:
        - "Не запущен": new, data_check, missing_data, ready_to_buy
        - "В работе": in_progress
        - "Куплен": purchased
        - "Возврат/обмен": exchange_needed, refund
        - "Отмена": cancelled
        - "Проблема": no_show (+ any request with needs_review=True or is_urgent=True)

        Filters (AND logic):
        - object_ids: list[int] — filter by object
        - assignee_ids: list[int] — filter by assignee

        Returns:
            Dict with column names as keys, each containing a list of card dicts.
        """
        if filters is None:
            filters = {}

        object_ids: list[int] = filters.get("object_ids") or []
        assignee_ids: list[int] = filters.get("assignee_ids") or []

        with app_session(self._database_url) as session:
            # Build base query — exclude archived and closed (not shown on kanban)
            query = (
                select(TicketRequest)
                .options(
                    joinedload(TicketRequest.employee),
                    joinedload(TicketRequest.object),
                    joinedload(TicketRequest.assignee),
                )
            )

            # Apply filters (AND logic)
            if object_ids:
                query = query.where(TicketRequest.object_id.in_(object_ids))
            if assignee_ids:
                query = query.where(TicketRequest.assignee_id.in_(assignee_ids))

            # Only fetch statuses relevant to kanban + problematic flags
            kanban_statuses = set(VALID_STATUSES)
            query = query.where(
                or_(
                    TicketRequest.status.in_(kanban_statuses),
                    TicketRequest.needs_review.is_(True),
                    TicketRequest.is_urgent.is_(True),
                )
            )

            rows = session.execute(query).unique().scalars().all()

            # Define column structure
            columns: dict[str, list[dict[str, Any]]] = {
                "Не запущен": [],
                "В кассах": [],
                "Куплен": [],
                "Возврат/обмен": [],
                "Отмена": [],
                "Проблема": [],
            }

            status_column_map: dict[str, str] = {
                "not_started": "Не запущен",
                "at_cashier": "В кассах",
                "purchased": "Куплен",
                "exchange_needed": "Возврат/обмен",
                "refund_needed": "Возврат/обмен",
                "cancel_purchase": "Отмена",
            }

            for req in rows:
                card = _kanban_card_to_dict(req)

                # Determine column: "Проблема" takes priority for flagged items
                if req.needs_review or req.is_urgent:
                    columns["Проблема"].append(card)
                else:
                    column_name = status_column_map.get(req.status)
                    if column_name:
                        columns[column_name].append(card)

            return columns

    # ------------------------------------------------------------------
    # Private helpers — Financial Operations
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_financial_op_data(data: dict[str, Any], *, is_create: bool) -> list[str]:
        """Validate financial operation data. Returns list of error messages."""
        errors: list[str] = []

        if is_create:
            # op_type is required on create
            op_type = str(data.get("op_type") or "").strip()
            if not op_type:
                errors.append("op_type is required")
            elif op_type not in VALID_FIN_OP_TYPES:
                errors.append(
                    f"op_type must be one of: {', '.join(sorted(VALID_FIN_OP_TYPES))}"
                )
        else:
            # On update, validate op_type only if provided
            if "op_type" in data:
                op_type = str(data["op_type"] or "").strip()
                if not op_type:
                    errors.append("op_type cannot be empty")
                elif op_type not in VALID_FIN_OP_TYPES:
                    errors.append(
                        f"op_type must be one of: {', '.join(sorted(VALID_FIN_OP_TYPES))}"
                    )

        # Validate amount if provided
        if "amount" in data and data.get("amount") is not None:
            try:
                amount = Decimal(str(data["amount"]))
                if amount < Decimal("0"):
                    errors.append("amount must not be negative")
                if amount > FIN_OP_MAX_AMOUNT:
                    errors.append(f"amount must not exceed {FIN_OP_MAX_AMOUNT}")
            except Exception:
                errors.append("amount must be a valid decimal number")

        return errors

    @staticmethod
    def _financial_op_to_dict(op: TicketFinancialOp) -> dict[str, Any]:
        """Convert a TicketFinancialOp model instance to a plain dict."""
        return {
            "id": op.id,
            "request_id": op.request_id,
            "employee_id": op.employee_id,
            "object_id": op.object_id,
            "op_type": op.op_type,
            "amount": str(op.amount),
            "reason": op.reason,
            "refund_status": op.refund_status,
            "op_date": op.op_date.isoformat() if op.op_date else None,
            "is_deleted": op.is_deleted,
            "created_at": op.created_at.isoformat() if op.created_at else None,
            "updated_at": op.updated_at.isoformat() if op.updated_at else None,
        }


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

tickets_service = TicketsService()
