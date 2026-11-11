"""Create all ticket_* tables for the Tickets/Logistics module."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260511_0032"
down_revision = "20260510_0031"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return name
    return None


def upgrade() -> None:
    if _scope() == "chat":
        return

    app_schema = _schema("app")

    # 1. ticket_objects (no FK dependencies on other ticket tables)
    op.create_table(
        "ticket_objects",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(length=10), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("short_name", sa.String(length=50), nullable=True),
        sa.Column("region", sa.String(length=100), nullable=False),
        sa.Column("default_assignee_id", sa.Integer(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("code", name="uq_ticket_objects_code"),
        sa.ForeignKeyConstraint(
            ["default_assignee_id"],
            [f"{'app.' if app_schema else ''}users.id"],
            ondelete="SET NULL",
        ),
        schema=app_schema,
    )
    op.create_index("ix_ticket_objects_code", "ticket_objects", ["code"], schema=app_schema)
    op.create_index("ix_ticket_objects_is_active", "ticket_objects", ["is_active"], schema=app_schema)

    # 2. ticket_employees (FK to users only)
    op.create_table(
        "ticket_employees",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("full_name", sa.String(length=150), nullable=False),
        sa.Column("date_of_birth_enc", sa.Text(), nullable=False, server_default=""),
        sa.Column("phone", sa.String(length=30), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("app_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["app_user_id"],
            [f"{'app.' if app_schema else ''}users.id"],
            ondelete="SET NULL",
        ),
        schema=app_schema,
    )
    op.create_index("ix_ticket_employees_full_name", "ticket_employees", ["full_name"], schema=app_schema)
    op.create_index("ix_ticket_employees_status", "ticket_employees", ["status"], schema=app_schema)
    op.create_index("ix_ticket_employees_app_user_id", "ticket_employees", ["app_user_id"], schema=app_schema)

    # 3. ticket_employee_documents (FK to ticket_employees)
    op.create_table(
        "ticket_employee_documents",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("passport_series_number_enc", sa.Text(), nullable=False, server_default=""),
        sa.Column("issued_by_enc", sa.Text(), nullable=False, server_default=""),
        sa.Column("issue_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("registration_address_enc", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            [f"{'app.' if app_schema else ''}ticket_employees.id"],
            ondelete="CASCADE",
        ),
        schema=app_schema,
    )
    op.create_index("ix_ticket_employee_documents_employee_id", "ticket_employee_documents", ["employee_id"], schema=app_schema)
    op.create_index("ix_ticket_employee_documents_is_current", "ticket_employee_documents", ["is_current"], schema=app_schema)

    # 4. ticket_requests (FK to ticket_employees, ticket_objects, users)
    op.create_table(
        "ticket_requests",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("object_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="new"),
        sa.Column("assignee_id", sa.Integer(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("departure_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("arrival_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("route", sa.String(length=500), nullable=True),
        sa.Column("total_cost", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0.00"),
        sa.Column("is_urgent", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="manual"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            [f"{'app.' if app_schema else ''}ticket_employees.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["object_id"],
            [f"{'app.' if app_schema else ''}ticket_objects.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["assignee_id"],
            [f"{'app.' if app_schema else ''}users.id"],
            ondelete="SET NULL",
        ),
        schema=app_schema,
    )
    op.create_index("ix_ticket_requests_status", "ticket_requests", ["status"], schema=app_schema)
    op.create_index("ix_ticket_requests_object_id", "ticket_requests", ["object_id"], schema=app_schema)
    op.create_index("ix_ticket_requests_assignee_id", "ticket_requests", ["assignee_id"], schema=app_schema)
    op.create_index("ix_ticket_requests_created_at", "ticket_requests", ["created_at"], schema=app_schema)
    op.create_index("ix_ticket_requests_employee_id", "ticket_requests", ["employee_id"], schema=app_schema)

    # 5. ticket_items (FK to ticket_requests)
    op.create_table(
        "ticket_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("transport_type", sa.String(length=20), nullable=False),
        sa.Column("route", sa.String(length=500), nullable=True),
        sa.Column("departure_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cost", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0.00"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["request_id"],
            [f"{'app.' if app_schema else ''}ticket_requests.id"],
            ondelete="CASCADE",
        ),
        schema=app_schema,
    )
    op.create_index("ix_ticket_items_request_id", "ticket_items", ["request_id"], schema=app_schema)

    # 6. ticket_comments (FK to ticket_requests, users)
    op.create_table(
        "ticket_comments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("author_id", sa.Integer(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("comment_type", sa.String(length=20), nullable=False, server_default="normal"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["request_id"],
            [f"{'app.' if app_schema else ''}ticket_requests.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["author_id"],
            [f"{'app.' if app_schema else ''}users.id"],
            ondelete="SET NULL",
        ),
        schema=app_schema,
    )
    op.create_index("ix_ticket_comments_request_id", "ticket_comments", ["request_id"], schema=app_schema)
    op.create_index("ix_ticket_comments_request_id_created_at", "ticket_comments", ["request_id", "created_at"], schema=app_schema)

    # 7. ticket_change_history (FK to ticket_requests, users)
    op.create_table(
        "ticket_change_history",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("field_name", sa.String(length=50), nullable=False),
        sa.Column("old_value", sa.String(length=1000), nullable=True),
        sa.Column("new_value", sa.String(length=1000), nullable=True),
        sa.Column("changed_by_id", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(length=20), nullable=False, server_default="manual"),
        sa.Column("comment", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["request_id"],
            [f"{'app.' if app_schema else ''}ticket_requests.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["changed_by_id"],
            [f"{'app.' if app_schema else ''}users.id"],
            ondelete="SET NULL",
        ),
        schema=app_schema,
    )
    op.create_index("ix_ticket_change_history_request_id", "ticket_change_history", ["request_id"], schema=app_schema)
    op.create_index("ix_ticket_change_history_request_id_created_at", "ticket_change_history", ["request_id", "created_at"], schema=app_schema)

    # 8. ticket_financial_ops (FK to ticket_requests, ticket_employees, ticket_objects)
    op.create_table(
        "ticket_financial_ops",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("request_id", sa.Integer(), nullable=True),
        sa.Column("employee_id", sa.Integer(), nullable=True),
        sa.Column("object_id", sa.Integer(), nullable=True),
        sa.Column("op_type", sa.String(length=20), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False, server_default="0.00"),
        sa.Column("reason", sa.String(length=500), nullable=True),
        sa.Column("refund_status", sa.String(length=30), nullable=True),
        sa.Column("op_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["request_id"],
            [f"{'app.' if app_schema else ''}ticket_requests.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["employee_id"],
            [f"{'app.' if app_schema else ''}ticket_employees.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["object_id"],
            [f"{'app.' if app_schema else ''}ticket_objects.id"],
            ondelete="SET NULL",
        ),
        schema=app_schema,
    )
    op.create_index("ix_ticket_financial_ops_request_id", "ticket_financial_ops", ["request_id"], schema=app_schema)
    op.create_index("ix_ticket_financial_ops_op_type_date", "ticket_financial_ops", ["op_type", "op_date"], schema=app_schema)
    op.create_index("ix_ticket_financial_ops_is_deleted", "ticket_financial_ops", ["is_deleted"], schema=app_schema)

    # 9. ticket_attachments (FK to ticket_requests, users)
    op.create_table(
        "ticket_attachments",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("request_id", sa.Integer(), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_type", sa.String(length=30), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("uploaded_by_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["request_id"],
            [f"{'app.' if app_schema else ''}ticket_requests.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["uploaded_by_id"],
            [f"{'app.' if app_schema else ''}users.id"],
            ondelete="SET NULL",
        ),
        schema=app_schema,
    )
    op.create_index("ix_ticket_attachments_request_id", "ticket_attachments", ["request_id"], schema=app_schema)

    # 10. ticket_import_jobs (no FK to other ticket tables)
    op.create_table(
        "ticket_import_jobs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="uploaded"),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("preview_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("result_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        schema=app_schema,
    )

    # 11. ticket_import_raw_traces (FK to ticket_import_jobs, ticket_requests)
    op.create_table(
        "ticket_import_raw_traces",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.String(length=64), nullable=False),
        sa.Column("request_id", sa.Integer(), nullable=True),
        sa.Column("source_file", sa.String(length=255), nullable=False),
        sa.Column("sheet_name", sa.String(length=100), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("raw_cells_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("cell_colors_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("cell_formulas_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("cell_comments_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("cell_hyperlinks_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("cell_addresses_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("sheet_visibility", sa.String(length=20), nullable=False, server_default="visible"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["job_id"],
            [f"{'app.' if app_schema else ''}ticket_import_jobs.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["request_id"],
            [f"{'app.' if app_schema else ''}ticket_requests.id"],
            ondelete="SET NULL",
        ),
        schema=app_schema,
    )
    op.create_index("ix_ticket_import_raw_traces_job_id", "ticket_import_raw_traces", ["job_id"], schema=app_schema)
    op.create_index("ix_ticket_import_raw_traces_request_id", "ticket_import_raw_traces", ["request_id"], schema=app_schema)

    # 12. ticket_notification_rules (standalone)
    op.create_table(
        "ticket_notification_rules",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("rule_type", sa.String(length=50), nullable=False, unique=True),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("threshold_days", sa.Integer(), nullable=True),
        sa.Column("notify_roles", sa.String(length=200), nullable=False, server_default="admin,operator"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        schema=app_schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return

    app_schema = _schema("app")

    # Drop in reverse dependency order
    op.drop_table("ticket_notification_rules", schema=app_schema)

    op.drop_index("ix_ticket_import_raw_traces_request_id", table_name="ticket_import_raw_traces", schema=app_schema)
    op.drop_index("ix_ticket_import_raw_traces_job_id", table_name="ticket_import_raw_traces", schema=app_schema)
    op.drop_table("ticket_import_raw_traces", schema=app_schema)

    op.drop_table("ticket_import_jobs", schema=app_schema)

    op.drop_index("ix_ticket_attachments_request_id", table_name="ticket_attachments", schema=app_schema)
    op.drop_table("ticket_attachments", schema=app_schema)

    op.drop_index("ix_ticket_financial_ops_is_deleted", table_name="ticket_financial_ops", schema=app_schema)
    op.drop_index("ix_ticket_financial_ops_op_type_date", table_name="ticket_financial_ops", schema=app_schema)
    op.drop_index("ix_ticket_financial_ops_request_id", table_name="ticket_financial_ops", schema=app_schema)
    op.drop_table("ticket_financial_ops", schema=app_schema)

    op.drop_index("ix_ticket_change_history_request_id_created_at", table_name="ticket_change_history", schema=app_schema)
    op.drop_index("ix_ticket_change_history_request_id", table_name="ticket_change_history", schema=app_schema)
    op.drop_table("ticket_change_history", schema=app_schema)

    op.drop_index("ix_ticket_comments_request_id_created_at", table_name="ticket_comments", schema=app_schema)
    op.drop_index("ix_ticket_comments_request_id", table_name="ticket_comments", schema=app_schema)
    op.drop_table("ticket_comments", schema=app_schema)

    op.drop_index("ix_ticket_items_request_id", table_name="ticket_items", schema=app_schema)
    op.drop_table("ticket_items", schema=app_schema)

    op.drop_index("ix_ticket_requests_employee_id", table_name="ticket_requests", schema=app_schema)
    op.drop_index("ix_ticket_requests_created_at", table_name="ticket_requests", schema=app_schema)
    op.drop_index("ix_ticket_requests_assignee_id", table_name="ticket_requests", schema=app_schema)
    op.drop_index("ix_ticket_requests_object_id", table_name="ticket_requests", schema=app_schema)
    op.drop_index("ix_ticket_requests_status", table_name="ticket_requests", schema=app_schema)
    op.drop_table("ticket_requests", schema=app_schema)

    op.drop_index("ix_ticket_employee_documents_is_current", table_name="ticket_employee_documents", schema=app_schema)
    op.drop_index("ix_ticket_employee_documents_employee_id", table_name="ticket_employee_documents", schema=app_schema)
    op.drop_table("ticket_employee_documents", schema=app_schema)

    op.drop_index("ix_ticket_employees_app_user_id", table_name="ticket_employees", schema=app_schema)
    op.drop_index("ix_ticket_employees_status", table_name="ticket_employees", schema=app_schema)
    op.drop_index("ix_ticket_employees_full_name", table_name="ticket_employees", schema=app_schema)
    op.drop_table("ticket_employees", schema=app_schema)

    op.drop_index("ix_ticket_objects_is_active", table_name="ticket_objects", schema=app_schema)
    op.drop_index("ix_ticket_objects_code", table_name="ticket_objects", schema=app_schema)
    op.drop_table("ticket_objects", schema=app_schema)
