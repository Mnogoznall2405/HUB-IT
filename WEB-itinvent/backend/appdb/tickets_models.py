"""SQLAlchemy models for the Tickets/Logistics module."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.appdb.models import APP_SCHEMA, AppBase, _table_args, utcnow


# ---------------------------------------------------------------------------
# TicketObject — Справочник объектов
# ---------------------------------------------------------------------------


class TicketObject(AppBase):
    __tablename__ = "ticket_objects"
    __table_args__ = _table_args(
        UniqueConstraint("code", name="uq_ticket_objects_code"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    short_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    region: Mapped[str] = mapped_column(String(100), nullable=False)
    default_assignee_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("app.users.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    # Relationships
    default_assignee = relationship("AppUser", foreign_keys=[default_assignee_id])


# ---------------------------------------------------------------------------
# TicketEmployee — Сотрудники
# ---------------------------------------------------------------------------


class TicketEmployee(AppBase):
    __tablename__ = "ticket_employees"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False, index=True)
    date_of_birth_enc: Mapped[str] = mapped_column(Text, nullable=False, default="")
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", index=True)
    app_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("app.users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    # Relationships
    app_user = relationship("AppUser", foreign_keys=[app_user_id])
    documents = relationship("TicketEmployeeDocument", back_populates="employee")


# ---------------------------------------------------------------------------
# TicketEmployeeDocument — Документы сотрудника (шифрованные)
# ---------------------------------------------------------------------------


class TicketEmployeeDocument(AppBase):
    __tablename__ = "ticket_employee_documents"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("app.ticket_employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    passport_series_number_enc: Mapped[str] = mapped_column(Text, nullable=False, default="")
    issued_by_enc: Mapped[str] = mapped_column(Text, nullable=False, default="")
    issue_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    registration_address_enc: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    # Relationships
    employee = relationship("TicketEmployee", back_populates="documents")


# ---------------------------------------------------------------------------
# TicketRequest — Заявка на билет
# ---------------------------------------------------------------------------


class TicketRequest(AppBase):
    __tablename__ = "ticket_requests"
    __table_args__ = _table_args(
        Index("ix_ticket_requests_status", "status"),
        Index("ix_ticket_requests_object_id", "object_id"),
        Index("ix_ticket_requests_assignee_id", "assignee_id"),
        Index("ix_ticket_requests_created_at", "created_at"),
        Index("ix_ticket_requests_employee_id", "employee_id"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("app.ticket_employees.id", ondelete="RESTRICT"), nullable=False
    )
    object_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("app.ticket_objects.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="new")
    assignee_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("app.users.id", ondelete="SET NULL"), nullable=True
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    departure_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    arrival_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    route: Mapped[str | None] = mapped_column(String(500), nullable=True)
    total_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    is_urgent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    needs_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    # Relationships
    employee = relationship("TicketEmployee", foreign_keys=[employee_id])
    object = relationship("TicketObject", foreign_keys=[object_id])
    assignee = relationship("AppUser", foreign_keys=[assignee_id])
    items = relationship("TicketItem", back_populates="request")
    comments = relationship("TicketComment", back_populates="request")
    history = relationship("TicketChangeHistory", back_populates="request")
    attachments = relationship("TicketAttachment", back_populates="request")
    financial_ops = relationship("TicketFinancialOp", back_populates="request")


# ---------------------------------------------------------------------------
# TicketItem — Конкретный билет
# ---------------------------------------------------------------------------


class TicketItem(AppBase):
    __tablename__ = "ticket_items"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("app.ticket_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    transport_type: Mapped[str] = mapped_column(String(20), nullable=False)  # air, rail, bus
    route: Mapped[str | None] = mapped_column(String(500), nullable=True)
    departure_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    # Relationships
    request = relationship("TicketRequest", back_populates="items")


# ---------------------------------------------------------------------------
# TicketComment — Комментарии
# ---------------------------------------------------------------------------


class TicketComment(AppBase):
    __tablename__ = "ticket_comments"
    __table_args__ = _table_args(
        Index("ix_ticket_comments_request_id_created_at", "request_id", "created_at"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("app.ticket_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("app.users.id", ondelete="SET NULL"), nullable=True
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    comment_type: Mapped[str] = mapped_column(String(20), nullable=False, default="normal")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    # Relationships
    request = relationship("TicketRequest", back_populates="comments")
    author = relationship("AppUser", foreign_keys=[author_id])


# ---------------------------------------------------------------------------
# TicketChangeHistory — История изменений
# ---------------------------------------------------------------------------


class TicketChangeHistory(AppBase):
    __tablename__ = "ticket_change_history"
    __table_args__ = _table_args(
        Index("ix_ticket_change_history_request_id_created_at", "request_id", "created_at"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("app.ticket_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field_name: Mapped[str] = mapped_column(String(50), nullable=False)
    old_value: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    new_value: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    changed_by_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("app.users.id", ondelete="SET NULL"), nullable=True
    )
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    comment: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    # Relationships
    request = relationship("TicketRequest", back_populates="history")
    changed_by = relationship("AppUser", foreign_keys=[changed_by_id])


# ---------------------------------------------------------------------------
# TicketFinancialOp — Финансовые операции (потери/возвраты/обмены)
# ---------------------------------------------------------------------------


class TicketFinancialOp(AppBase):
    __tablename__ = "ticket_financial_ops"
    __table_args__ = _table_args(
        Index("ix_ticket_financial_ops_request_id", "request_id"),
        Index("ix_ticket_financial_ops_op_type_date", "op_type", "op_date"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("app.ticket_requests.id", ondelete="SET NULL"), nullable=True
    )
    employee_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("app.ticket_employees.id", ondelete="SET NULL"), nullable=True
    )
    object_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("app.ticket_objects.id", ondelete="SET NULL"), nullable=True
    )
    op_type: Mapped[str] = mapped_column(String(20), nullable=False)  # refund, exchange, loss
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    refund_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    op_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    # Relationships
    request = relationship("TicketRequest", back_populates="financial_ops")
    employee = relationship("TicketEmployee", foreign_keys=[employee_id])
    object = relationship("TicketObject", foreign_keys=[object_id])


# ---------------------------------------------------------------------------
# TicketAttachment — Вложения
# ---------------------------------------------------------------------------


class TicketAttachment(AppBase):
    __tablename__ = "ticket_attachments"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("app.ticket_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_type: Mapped[str] = mapped_column(String(30), nullable=False)  # itinerary, pdf_ticket, receipt, voucher, other
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    uploaded_by_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("app.users.id", ondelete="SET NULL"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    # Relationships
    request = relationship("TicketRequest", back_populates="attachments")
    uploaded_by = relationship("AppUser", foreign_keys=[uploaded_by_id])


# ---------------------------------------------------------------------------
# TicketImportJob — Задания импорта
# ---------------------------------------------------------------------------


class TicketImportJob(AppBase):
    __tablename__ = "ticket_import_jobs"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="uploaded")
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    preview_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    result_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


# ---------------------------------------------------------------------------
# TicketImportRawTrace — Сырые данные импорта
# ---------------------------------------------------------------------------


class TicketImportRawTrace(AppBase):
    __tablename__ = "ticket_import_raw_traces"
    __table_args__ = _table_args(
        Index("ix_ticket_import_raw_traces_job_id", "job_id"),
        Index("ix_ticket_import_raw_traces_request_id", "request_id"),
        schema=APP_SCHEMA,
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("app.ticket_import_jobs.id", ondelete="CASCADE"), nullable=False
    )
    request_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("app.ticket_requests.id", ondelete="SET NULL"), nullable=True
    )
    source_file: Mapped[str] = mapped_column(String(255), nullable=False)
    sheet_name: Mapped[str] = mapped_column(String(100), nullable=False)
    row_number: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_cells_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    cell_colors_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    cell_formulas_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    cell_comments_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    cell_hyperlinks_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    cell_addresses_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    sheet_visibility: Mapped[str] = mapped_column(String(20), nullable=False, default="visible")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    # Relationships
    job = relationship("TicketImportJob", foreign_keys=[job_id])
    request = relationship("TicketRequest", foreign_keys=[request_id])


# ---------------------------------------------------------------------------
# TicketNotificationRule — Правила уведомлений
# ---------------------------------------------------------------------------


class TicketNotificationRule(AppBase):
    __tablename__ = "ticket_notification_rules"
    __table_args__ = _table_args(schema=APP_SCHEMA)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_type: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    # departure_soon, missing_data_stale, stuck_request, new_loss
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    threshold_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notify_roles: Mapped[str] = mapped_column(String(200), nullable=False, default="admin,operator")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
