"""company structure org chart tables

Revision ID: 20260722_0070
Revises: 20260721_0069
Create Date: 2026-07-22 16:40:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260722_0070"
down_revision = "20260721_0069"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name, schema=schema)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not _has_table(schema, "org_structure_nodes"):
        op.create_table(
            "org_structure_nodes",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("parent_id", sa.String(length=64), nullable=True),
            sa.Column("node_type", sa.String(length=32), nullable=False, server_default="other"),
            sa.Column("title", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("person_name", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("person_position", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            schema=schema,
        )
        op.create_index(
            "ix_app_org_structure_nodes_parent",
            "org_structure_nodes",
            ["parent_id", "sort_order"],
            unique=False,
            schema=schema,
        )
        op.create_index(
            "ix_app_org_structure_nodes_active",
            "org_structure_nodes",
            ["is_active"],
            unique=False,
            schema=schema,
        )
    if not _has_table(schema, "org_structure_department_links"):
        op.create_table(
            "org_structure_department_links",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("node_id", sa.String(length=64), nullable=False),
            sa.Column("department_code", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "node_id",
                "department_code",
                name="uq_app_org_structure_department_link",
            ),
            schema=schema,
        )
        op.create_index(
            "ix_app_org_structure_dept_links_node",
            "org_structure_department_links",
            ["node_id"],
            unique=False,
            schema=schema,
        )
        op.create_index(
            "ix_app_org_structure_dept_links_code",
            "org_structure_department_links",
            ["department_code"],
            unique=False,
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if _has_table(schema, "org_structure_department_links"):
        try:
            op.drop_index(
                "ix_app_org_structure_dept_links_code",
                table_name="org_structure_department_links",
                schema=schema,
            )
        except Exception:
            pass
        try:
            op.drop_index(
                "ix_app_org_structure_dept_links_node",
                table_name="org_structure_department_links",
                schema=schema,
            )
        except Exception:
            pass
        op.drop_table("org_structure_department_links", schema=schema)
    if _has_table(schema, "org_structure_nodes"):
        try:
            op.drop_index(
                "ix_app_org_structure_nodes_active",
                table_name="org_structure_nodes",
                schema=schema,
            )
        except Exception:
            pass
        try:
            op.drop_index(
                "ix_app_org_structure_nodes_parent",
                table_name="org_structure_nodes",
                schema=schema,
            )
        except Exception:
            pass
        op.drop_table("org_structure_nodes", schema=schema)
