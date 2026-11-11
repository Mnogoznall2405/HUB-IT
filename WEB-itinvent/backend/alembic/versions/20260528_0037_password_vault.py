"""password vault

Revision ID: 20260528_0037
Revises: 20260527_0036
Create Date: 2026-05-28 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260528_0037"
down_revision = "20260527_0036"
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


def _create_index_if_missing(name: str, table_name: str, columns: list[str], *, schema: str | None) -> None:
    if name in _index_names(schema, table_name):
        return
    op.create_index(name, table_name, columns, schema=schema)


def upgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")

    if not _has_table(app_schema, "password_vault_entries"):
        op.create_table(
            "password_vault_entries",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("group_name", sa.String(length=120), nullable=False, server_default=""),
            sa.Column("tags_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("login", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("password_enc", sa.Text(), nullable=False, server_default=""),
            sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_by_user_id", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_by_username", sa.String(length=50), nullable=False, server_default=""),
            sa.Column("updated_by_user_id", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("updated_by_username", sa.String(length=50), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            schema=app_schema,
        )
    _create_index_if_missing(
        "ix_app_password_vault_entries_group_archived",
        "password_vault_entries",
        ["group_name", "is_archived"],
        schema=app_schema,
    )
    _create_index_if_missing(
        "ix_app_password_vault_entries_login_archived",
        "password_vault_entries",
        ["login", "is_archived"],
        schema=app_schema,
    )

    if not _has_table(app_schema, "password_vault_audit"):
        op.create_table(
            "password_vault_audit",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("entry_id", sa.String(length=64), nullable=True),
            sa.Column("action", sa.String(length=40), nullable=False),
            sa.Column("actor_user_id", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("actor_username", sa.String(length=50), nullable=False, server_default=""),
            sa.Column("entry_group", sa.String(length=120), nullable=False, server_default=""),
            sa.Column("entry_login", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("ip_address", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("user_agent", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            schema=app_schema,
        )
    _create_index_if_missing(
        "ix_app_password_vault_audit_entry_created",
        "password_vault_audit",
        ["entry_id", "created_at"],
        schema=app_schema,
    )
    _create_index_if_missing(
        "ix_app_password_vault_audit_actor_created",
        "password_vault_audit",
        ["actor_user_id", "created_at"],
        schema=app_schema,
    )
    _create_index_if_missing(
        "ix_app_password_vault_audit_action_created",
        "password_vault_audit",
        ["action", "created_at"],
        schema=app_schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    if _has_table(app_schema, "password_vault_audit"):
        for index_name in (
            "ix_app_password_vault_audit_action_created",
            "ix_app_password_vault_audit_actor_created",
            "ix_app_password_vault_audit_entry_created",
        ):
            if index_name in _index_names(app_schema, "password_vault_audit"):
                op.drop_index(index_name, table_name="password_vault_audit", schema=app_schema)
        op.drop_table("password_vault_audit", schema=app_schema)
    if _has_table(app_schema, "password_vault_entries"):
        for index_name in (
            "ix_app_password_vault_entries_login_archived",
            "ix_app_password_vault_entries_group_archived",
        ):
            if index_name in _index_names(app_schema, "password_vault_entries"):
                op.drop_index(index_name, table_name="password_vault_entries", schema=app_schema)
        op.drop_table("password_vault_entries", schema=app_schema)
