"""Tickets Excel fields: employee department/position, split passport, request note/refund_loss, status migration."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260701_0062"
down_revision = "20260626_0061"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return name
    return None


def _qualified_table(schema_name: str | None, table_name: str) -> str:
    if schema_name:
        return f'"{schema_name}"."{table_name}"'
    return table_name


def _split_passport_series_number(value: str) -> tuple[str, str]:
    parts = str(value or "").strip().split(None, 1)
    if len(parts) == 2:
        return parts[0], parts[1]
    if len(parts) == 1:
        return parts[0], ""
    return "", ""


def _backfill_passport_fields(connection, schema_name: str | None) -> None:
    from backend.services.secret_crypto_service import decrypt_secret, encrypt_secret

    table = _qualified_table(schema_name, "ticket_employee_documents")
    rows = connection.execute(
        sa.text(
            f"""
            SELECT id, passport_series_number_enc, passport_series_enc, passport_number_enc
            FROM {table}
            """
        )
    ).fetchall()

    for row in rows:
        row_id = row[0]
        combined_enc = row[1] or ""
        series_enc = row[2] or ""
        number_enc = row[3] or ""
        if series_enc or number_enc or not combined_enc:
            continue
        combined = decrypt_secret(combined_enc) or ""
        series, number = _split_passport_series_number(combined)
        connection.execute(
            sa.text(
                f"""
                UPDATE {table}
                SET passport_series_enc = :series_enc,
                    passport_number_enc = :number_enc
                WHERE id = :row_id
                """
            ),
            {
                "series_enc": encrypt_secret(series) if series else "",
                "number_enc": encrypt_secret(number) if number else "",
                "row_id": row_id,
            },
        )


def _migrate_request_statuses(connection, schema_name: str | None) -> None:
    table = _qualified_table(schema_name, "ticket_requests")
    status_map = {
        "new": "not_started",
        "data_check": "not_started",
        "missing_data": "not_started",
        "ready_to_buy": "not_started",
        "in_progress": "at_cashier",
        "closed": "purchased",
        "refund": "refund_needed",
        "no_show": "refund_needed",
        "cancelled": "cancel_purchase",
        "archive": "cancel_purchase",
    }
    for old_status, new_status in status_map.items():
        connection.execute(
            sa.text(
                f"""
                UPDATE {table}
                SET status = :new_status
                WHERE status = :old_status
                """
            ),
            {"old_status": old_status, "new_status": new_status},
        )


def upgrade() -> None:
    if _scope() == "chat":
        return

    app_schema = _schema("app")

    with op.batch_alter_table("ticket_employees", schema=app_schema) as batch_op:
        batch_op.add_column(sa.Column("department", sa.String(length=200), nullable=True))
        batch_op.add_column(sa.Column("position", sa.String(length=150), nullable=True))

    with op.batch_alter_table("ticket_employee_documents", schema=app_schema) as batch_op:
        batch_op.add_column(sa.Column("passport_series_enc", sa.Text(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("passport_number_enc", sa.Text(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("issuer_code_enc", sa.Text(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("birth_place_enc", sa.Text(), nullable=False, server_default=""))

    with op.batch_alter_table("ticket_requests", schema=app_schema) as batch_op:
        batch_op.add_column(sa.Column("note", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("refund_loss", sa.Numeric(12, 2), nullable=False, server_default="0.00"))

    connection = op.get_bind()
    _backfill_passport_fields(connection, app_schema)
    _migrate_request_statuses(connection, app_schema)

    with op.batch_alter_table("ticket_requests", schema=app_schema) as batch_op:
        batch_op.alter_column("status", server_default="not_started")


def downgrade() -> None:
    if _scope() == "chat":
        return

    app_schema = _schema("app")

    with op.batch_alter_table("ticket_requests", schema=app_schema) as batch_op:
        batch_op.drop_column("refund_loss")
        batch_op.drop_column("note")
        batch_op.alter_column("status", server_default="new")

    with op.batch_alter_table("ticket_employee_documents", schema=app_schema) as batch_op:
        batch_op.drop_column("birth_place_enc")
        batch_op.drop_column("issuer_code_enc")
        batch_op.drop_column("passport_number_enc")
        batch_op.drop_column("passport_series_enc")

    with op.batch_alter_table("ticket_employees", schema=app_schema) as batch_op:
        batch_op.drop_column("position")
        batch_op.drop_column("department")
