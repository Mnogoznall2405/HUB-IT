"""Add app-owned registry and audit tables for read-only 1C reconciliation."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260713_0063"
down_revision = "20260701_0062"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _table_exists(table_name: str, schema: str | None) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _create_table_if_missing(table_name: str, *columns, **kwargs) -> None:
    schema = kwargs.get("schema")
    if _table_exists(table_name, schema):
        return
    op.create_table(table_name, *columns, **kwargs)


def _create_index_if_missing(index_name: str, table_name: str, columns, **kwargs) -> None:
    schema = kwargs.get("schema")
    existing = {
        str(index.get("name") or "")
        for index in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    }
    if index_name in existing:
        return
    op.create_index(index_name, table_name, columns, **kwargs)


def _ensure_version_column(table_name: str, schema: str | None) -> None:
    columns = {
        str(column.get("name") or "")
        for column in sa.inspect(op.get_bind()).get_columns(table_name, schema=schema)
    }
    if "version" in columns:
        return
    op.add_column(
        table_name,
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        schema=schema,
    )


def upgrade() -> None:
    if _scope() == "chat":
        return

    schema = _schema()
    _create_table_if_missing(
        "one_c_item_links",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("hub_db_id", sa.String(length=128), nullable=False),
        sa.Column("hub_item_id", sa.String(length=64), nullable=False),
        sa.Column("source_base", sa.String(length=64), nullable=False, server_default="buh20"),
        sa.Column("nomenclature_ref", sa.String(length=64), nullable=True),
        sa.Column("nomenclature_code_snapshot", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_by", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("verified_by", sa.String(length=128), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint(
            "hub_db_id",
            "hub_item_id",
            "source_base",
            name="uq_app_one_c_item_links_hub_item_source",
        ),
        schema=schema,
    )
    _create_index_if_missing(
        "ix_app_one_c_item_links_nomenclature",
        "one_c_item_links",
        ["source_base", "nomenclature_ref"],
        schema=schema,
    )
    _create_index_if_missing(
        "ix_app_one_c_item_links_status",
        "one_c_item_links",
        ["hub_db_id", "status"],
        schema=schema,
    )

    _create_table_if_missing(
        "one_c_warehouse_owner_links",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source_base", sa.String(length=64), nullable=False, server_default="buh20"),
        sa.Column("warehouse_ref", sa.String(length=64), nullable=False),
        sa.Column("hub_db_id", sa.String(length=128), nullable=False),
        sa.Column("owner_no", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_by", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("verified_by", sa.String(length=128), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint(
            "source_base",
            "warehouse_ref",
            "hub_db_id",
            "owner_no",
            name="uq_app_one_c_warehouse_owner_links",
        ),
        schema=schema,
    )
    _ensure_version_column("one_c_warehouse_owner_links", schema)
    _create_index_if_missing(
        "ix_app_one_c_warehouse_owner_links_warehouse",
        "one_c_warehouse_owner_links",
        ["source_base", "warehouse_ref"],
        schema=schema,
    )
    _create_index_if_missing(
        "ix_app_one_c_warehouse_owner_links_owner",
        "one_c_warehouse_owner_links",
        ["hub_db_id", "owner_no"],
        schema=schema,
    )
    # A warehouse has one current owner per source/HUB database.  Historical
    # inactive/invalid decisions remain auditable and therefore stay outside
    # this partial unique index.
    _create_index_if_missing(
        "uq_app_one_c_warehouse_owner_links_active_warehouse",
        "one_c_warehouse_owner_links",
        ["source_base", "warehouse_ref", "hub_db_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
        sqlite_where=sa.text("status = 'active'"),
        schema=schema,
    )

    _create_table_if_missing(
        "one_c_employee_owner_links",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source_base", sa.String(length=64), nullable=False, server_default="zar31"),
        sa.Column("employee_code", sa.String(length=128), nullable=False),
        sa.Column("hub_db_id", sa.String(length=128), nullable=False),
        sa.Column("owner_no", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_by", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("verified_by", sa.String(length=128), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint(
            "source_base",
            "employee_code",
            "hub_db_id",
            "owner_no",
            name="uq_app_one_c_employee_owner_links",
        ),
        schema=schema,
    )
    _ensure_version_column("one_c_employee_owner_links", schema)
    _create_index_if_missing(
        "ix_app_one_c_employee_owner_links_employee",
        "one_c_employee_owner_links",
        ["source_base", "employee_code"],
        schema=schema,
    )
    _create_index_if_missing(
        "ix_app_one_c_employee_owner_links_owner",
        "one_c_employee_owner_links",
        ["hub_db_id", "owner_no"],
        schema=schema,
    )

    _create_table_if_missing(
        "one_c_reconcile_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("correlation_id", sa.String(length=64), nullable=False),
        sa.Column("hub_db_id", sa.String(length=128), nullable=True),
        sa.Column("hub_item_id", sa.String(length=64), nullable=True),
        sa.Column("actor", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("before_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("after_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        schema=schema,
    )
    _create_index_if_missing(
        "ix_app_one_c_reconcile_events_hub_item",
        "one_c_reconcile_events",
        ["hub_db_id", "hub_item_id", "created_at"],
        schema=schema,
    )
    _create_index_if_missing(
        "ix_app_one_c_reconcile_events_correlation",
        "one_c_reconcile_events",
        ["correlation_id"],
        schema=schema,
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            """
            CREATE OR REPLACE FUNCTION app.prevent_one_c_reconcile_event_mutation()
            RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'one_c_reconcile_events is append-only';
            END;
            $$ LANGUAGE plpgsql
            """
        )
        op.execute(
            """
            DROP TRIGGER IF EXISTS trg_one_c_reconcile_events_append_only ON app.one_c_reconcile_events
            """
        )
        op.execute(
            """
            CREATE TRIGGER trg_one_c_reconcile_events_append_only
            BEFORE UPDATE OR DELETE ON app.one_c_reconcile_events
            FOR EACH ROW EXECUTE FUNCTION app.prevent_one_c_reconcile_event_mutation()
            """
        )
    elif op.get_bind().dialect.name == "sqlite":
        op.execute(
            """
            DROP TRIGGER IF EXISTS trg_one_c_reconcile_events_no_update
            """
        )
        op.execute(
            """
            CREATE TRIGGER trg_one_c_reconcile_events_no_update
            BEFORE UPDATE ON one_c_reconcile_events
            BEGIN
                SELECT RAISE(ABORT, 'one_c_reconcile_events is append-only');
            END
            """
        )
        op.execute(
            """
            DROP TRIGGER IF EXISTS trg_one_c_reconcile_events_no_delete
            """
        )
        op.execute(
            """
            CREATE TRIGGER trg_one_c_reconcile_events_no_delete
            BEFORE DELETE ON one_c_reconcile_events
            BEGIN
                SELECT RAISE(ABORT, 'one_c_reconcile_events is append-only');
            END
            """
        )


def downgrade() -> None:
    if _scope() == "chat":
        return

    schema = _schema()
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS trg_one_c_reconcile_events_append_only ON app.one_c_reconcile_events")
        op.execute("DROP FUNCTION IF EXISTS app.prevent_one_c_reconcile_event_mutation()")
    elif op.get_bind().dialect.name == "sqlite":
        op.execute("DROP TRIGGER IF EXISTS trg_one_c_reconcile_events_no_update")
        op.execute("DROP TRIGGER IF EXISTS trg_one_c_reconcile_events_no_delete")
    op.drop_index("ix_app_one_c_reconcile_events_correlation", table_name="one_c_reconcile_events", schema=schema)
    op.drop_index("ix_app_one_c_reconcile_events_hub_item", table_name="one_c_reconcile_events", schema=schema)
    op.drop_table("one_c_reconcile_events", schema=schema)
    op.drop_index("ix_app_one_c_employee_owner_links_owner", table_name="one_c_employee_owner_links", schema=schema)
    op.drop_index("ix_app_one_c_employee_owner_links_employee", table_name="one_c_employee_owner_links", schema=schema)
    op.drop_table("one_c_employee_owner_links", schema=schema)
    op.drop_index("ix_app_one_c_warehouse_owner_links_owner", table_name="one_c_warehouse_owner_links", schema=schema)
    op.drop_index("ix_app_one_c_warehouse_owner_links_warehouse", table_name="one_c_warehouse_owner_links", schema=schema)
    op.drop_index("uq_app_one_c_warehouse_owner_links_active_warehouse", table_name="one_c_warehouse_owner_links", schema=schema)
    op.drop_table("one_c_warehouse_owner_links", schema=schema)
    op.drop_index("ix_app_one_c_item_links_status", table_name="one_c_item_links", schema=schema)
    op.drop_index("ix_app_one_c_item_links_nomenclature", table_name="one_c_item_links", schema=schema)
    op.drop_table("one_c_item_links", schema=schema)
