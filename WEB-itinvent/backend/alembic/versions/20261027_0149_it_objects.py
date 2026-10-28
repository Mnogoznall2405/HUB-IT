"""Add IT objects registry with owners, per-section grants and audit.

Revision ID: 20261027_0149
Revises: 20261027_0148

Created "if missing". The it-objects API answers 503 until this migration is applied explicitly at
release time; nothing else in the application depends on these tables.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261027_0149"
down_revision = "20261027_0148"
branch_labels = None
depends_on = None

OBJECTS_TABLE = "it_objects"
OWNERS_TABLE = "it_object_owners"
GRANTS_TABLE = "it_object_grants"
AUDIT_TABLE = "it_object_audit"


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
    now = sa.func.now()

    if not _has_table(schema, OBJECTS_TABLE):
        op.create_table(
            OBJECTS_TABLE,
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("source_type", sa.String(length=32), nullable=False),
            sa.Column("source_ref", sa.String(length=128), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.PrimaryKeyConstraint("id", name="pk_app_it_objects"),
            sa.UniqueConstraint("source_type", "source_ref", name="uq_app_it_objects_source"),
            schema=schema,
        )

    if not _has_table(schema, OWNERS_TABLE):
        op.create_table(
            OWNERS_TABLE,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("object_id", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("user_name", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("valid_to", sa.DateTime(timezone=True), nullable=True),
            sa.Column("assigned_by_user_id", sa.Integer(), nullable=False),
            sa.PrimaryKeyConstraint("id", name="pk_app_it_object_owners"),
            schema=schema,
        )
        op.create_index(
            "uq_app_it_object_active_owner",
            OWNERS_TABLE,
            ["object_id"],
            unique=True,
            schema=schema,
            postgresql_where=sa.text("valid_to IS NULL"),
            sqlite_where=sa.text("valid_to IS NULL"),
        )
        op.create_index("ix_app_it_object_owners_user", OWNERS_TABLE, ["user_id"], schema=schema)

    if not _has_table(schema, GRANTS_TABLE):
        op.create_table(
            GRANTS_TABLE,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("object_id", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("user_name", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("section", sa.String(length=32), nullable=False),
            sa.Column("level", sa.String(length=16), nullable=False),
            sa.Column("granted_by_user_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_by_user_id", sa.Integer(), nullable=True),
            sa.CheckConstraint("level IN ('view', 'manage')", name="ck_app_it_object_grants_level"),
            sa.PrimaryKeyConstraint("id", name="pk_app_it_object_grants"),
            schema=schema,
        )
        op.create_index(
            "uq_app_it_object_active_grant",
            GRANTS_TABLE,
            ["object_id", "user_id", "section"],
            unique=True,
            schema=schema,
            postgresql_where=sa.text("revoked_at IS NULL"),
            sqlite_where=sa.text("revoked_at IS NULL"),
        )
        op.create_index("ix_app_it_object_grants_user", GRANTS_TABLE, ["user_id"], schema=schema)

    if not _has_table(schema, AUDIT_TABLE):
        op.create_table(
            AUDIT_TABLE,
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("object_id", sa.String(length=64), nullable=False),
            sa.Column("action", sa.String(length=40), nullable=False),
            sa.Column("actor_user_id", sa.Integer(), nullable=False),
            sa.Column("target_user_id", sa.Integer(), nullable=True),
            sa.Column("section", sa.String(length=32), nullable=True),
            sa.Column("level", sa.String(length=16), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=now),
            sa.PrimaryKeyConstraint("id", name="pk_app_it_object_audit"),
            schema=schema,
        )
        op.create_index(
            "ix_app_it_object_audit_object_created",
            AUDIT_TABLE,
            ["object_id", "created_at"],
            schema=schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    for table_name in (AUDIT_TABLE, GRANTS_TABLE, OWNERS_TABLE, OBJECTS_TABLE):
        if _has_table(schema, table_name):
            op.drop_table(table_name, schema=schema)
