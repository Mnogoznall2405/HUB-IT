"""Create inventory and JSON compatibility tables in app schema."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260327_0007"
down_revision = "20260327_0006"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return "app"
    return None


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()

    op.create_table(
        "inventory_hosts",
        sa.Column("mac_address", sa.String(length=64), nullable=False),
        sa.Column("hostname", sa.String(length=255), nullable=True),
        sa.Column("user_login", sa.String(length=255), nullable=True),
        sa.Column("user_full_name", sa.String(length=255), nullable=True),
        sa.Column("ip_primary", sa.String(length=64), nullable=True),
        sa.Column("report_type", sa.String(length=32), nullable=False, server_default="full_snapshot"),
        sa.Column("last_seen_at", sa.Integer(), nullable=True),
        sa.Column("last_full_snapshot_at", sa.Integer(), nullable=True),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("mac_address"),
        schema=schema,
    )
    op.create_index("ix_inventory_hosts_hostname", "inventory_hosts", ["hostname"], unique=False, schema=schema)
    op.create_index("ix_inventory_hosts_user_login", "inventory_hosts", ["user_login"], unique=False, schema=schema)
    op.create_index("ix_inventory_hosts_user_full_name", "inventory_hosts", ["user_full_name"], unique=False, schema=schema)
    op.create_index("ix_inventory_hosts_ip_primary", "inventory_hosts", ["ip_primary"], unique=False, schema=schema)
    op.create_index("ix_inventory_hosts_last_seen_at", "inventory_hosts", ["last_seen_at"], unique=False, schema=schema)

    op.create_table(
        "inventory_change_events",
        sa.Column("event_id", sa.String(length=160), nullable=False),
        sa.Column("mac_address", sa.String(length=64), nullable=True),
        sa.Column("hostname", sa.String(length=255), nullable=True),
        sa.Column("detected_at", sa.Integer(), nullable=False),
        sa.Column("report_type", sa.String(length=32), nullable=False, server_default="full_snapshot"),
        sa.Column("change_types_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("diff_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("before_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("after_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("event_id"),
        schema=schema,
    )
    op.create_index("ix_inventory_change_events_mac_address", "inventory_change_events", ["mac_address"], unique=False, schema=schema)
    op.create_index("ix_inventory_change_events_hostname", "inventory_change_events", ["hostname"], unique=False, schema=schema)
    op.create_index("ix_inventory_change_events_detected_at", "inventory_change_events", ["detected_at"], unique=False, schema=schema)

    op.create_table(
        "json_documents",
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="dict"),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="null"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("file_name"),
        schema=schema,
    )

    op.create_table(
        "json_records",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="null"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=schema,
    )
    op.create_index("ix_json_records_file_name", "json_records", ["file_name"], unique=False, schema=schema)
    op.create_index("ix_json_records_sort_order", "json_records", ["sort_order"], unique=False, schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()

    op.drop_index("ix_json_records_sort_order", table_name="json_records", schema=schema)
    op.drop_index("ix_json_records_file_name", table_name="json_records", schema=schema)
    op.drop_table("json_records", schema=schema)
    op.drop_table("json_documents", schema=schema)

    op.drop_index("ix_inventory_change_events_detected_at", table_name="inventory_change_events", schema=schema)
    op.drop_index("ix_inventory_change_events_hostname", table_name="inventory_change_events", schema=schema)
    op.drop_index("ix_inventory_change_events_mac_address", table_name="inventory_change_events", schema=schema)
    op.drop_table("inventory_change_events", schema=schema)

    op.drop_index("ix_inventory_hosts_last_seen_at", table_name="inventory_hosts", schema=schema)
    op.drop_index("ix_inventory_hosts_ip_primary", table_name="inventory_hosts", schema=schema)
    op.drop_index("ix_inventory_hosts_user_full_name", table_name="inventory_hosts", schema=schema)
    op.drop_index("ix_inventory_hosts_user_login", table_name="inventory_hosts", schema=schema)
    op.drop_index("ix_inventory_hosts_hostname", table_name="inventory_hosts", schema=schema)
    op.drop_table("inventory_hosts", schema=schema)
