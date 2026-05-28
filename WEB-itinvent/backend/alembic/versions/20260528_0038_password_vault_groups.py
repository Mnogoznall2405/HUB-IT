"""password vault groups

Revision ID: 20260528_0038
Revises: 20260528_0037
Create Date: 2026-05-28 17:10:00.000000
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = "20260528_0038"
down_revision = "20260528_0037"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _index_names(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    return {
        str(item.get("name") or "")
        for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    }


def _unique_names(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    return {
        str(item.get("name") or "")
        for item in sa.inspect(op.get_bind()).get_unique_constraints(table_name, schema=schema)
    }


def _qualified(schema: str | None, table_name: str) -> str:
    return f"{schema}.{table_name}" if schema else table_name


def upgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    if not _has_table(app_schema, "password_vault_groups"):
        op.create_table(
            "password_vault_groups",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False, server_default=""),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_by_user_id", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_by_username", sa.String(length=50), nullable=False, server_default=""),
            sa.Column("updated_by_user_id", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("updated_by_username", sa.String(length=50), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            schema=app_schema,
        )
    if "uq_app_password_vault_groups_name" not in _unique_names(app_schema, "password_vault_groups"):
        op.create_unique_constraint(
            "uq_app_password_vault_groups_name",
            "password_vault_groups",
            ["name"],
            schema=app_schema,
        )
    if "ix_app_password_vault_groups_active_sort" not in _index_names(app_schema, "password_vault_groups"):
        op.create_index(
            "ix_app_password_vault_groups_active_sort",
            "password_vault_groups",
            ["is_active", "sort_order", "name"],
            schema=app_schema,
        )

    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    source = _qualified(app_schema, "password_vault_entries")
    target = _qualified(app_schema, "password_vault_groups")
    rows = bind.execute(
        sa.text(
            f"""
            SELECT DISTINCT group_name
            FROM {source}
            WHERE COALESCE(TRIM(group_name), '') <> ''
            ORDER BY group_name ASC
            """
        )
    ).fetchall()
    for idx, row in enumerate(rows):
        name = str(row[0] or "").strip()[:120]
        if not name:
            continue
        bind.execute(
            sa.text(
                f"""
                INSERT INTO {target}
                    (id, name, is_active, sort_order, created_by_user_id, created_by_username, updated_by_user_id, updated_by_username, created_at, updated_at)
                VALUES
                    (:id, :name, :is_active, :sort_order, :created_by_user_id, :created_by_username, :updated_by_user_id, :updated_by_username, :created_at, :updated_at)
                ON CONFLICT (name) DO NOTHING
                """
                if bind.dialect.name == "postgresql"
                else f"""
                INSERT OR IGNORE INTO {target}
                    (id, name, is_active, sort_order, created_by_user_id, created_by_username, updated_by_user_id, updated_by_username, created_at, updated_at)
                VALUES
                    (:id, :name, :is_active, :sort_order, :created_by_user_id, :created_by_username, :updated_by_user_id, :updated_by_username, :created_at, :updated_at)
                """
            ),
            {
                "id": uuid.uuid4().hex,
                "name": name,
                "is_active": True,
                "sort_order": idx,
                "created_by_user_id": 0,
                "created_by_username": "migration",
                "updated_by_user_id": 0,
                "updated_by_username": "migration",
                "created_at": now,
                "updated_at": now,
            },
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    if not _has_table(app_schema, "password_vault_groups"):
        return
    if "ix_app_password_vault_groups_active_sort" in _index_names(app_schema, "password_vault_groups"):
        op.drop_index("ix_app_password_vault_groups_active_sort", table_name="password_vault_groups", schema=app_schema)
    if "uq_app_password_vault_groups_name" in _unique_names(app_schema, "password_vault_groups"):
        op.drop_constraint("uq_app_password_vault_groups_name", "password_vault_groups", schema=app_schema, type_="unique")
    op.drop_table("password_vault_groups", schema=app_schema)
