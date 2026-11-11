"""add user mailboxes storage

Revision ID: 20260407_0016
Revises: 20260406_0015
Create Date: 2026-04-07 14:30:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260407_0016"
down_revision = "20260406_0015"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return name
    return None


def _table_names(schema: str | None) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {
        str(item or "").strip().lower()
        for item in inspector.get_table_names(schema=schema)
    }


def _index_names(schema: str | None, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {
        str(item.get("name") or "").strip().lower()
        for item in inspector.get_indexes(table_name, schema=schema)
    }


def upgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    table_names = _table_names(app_schema)
    if "user_mailboxes" not in table_names:
        op.create_table(
            "user_mailboxes",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("label", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("mailbox_email", sa.String(length=255), nullable=False),
            sa.Column("mailbox_login", sa.String(length=255), nullable=True),
            sa.Column("mailbox_password_enc", sa.Text(), nullable=False, server_default=""),
            sa.Column("auth_mode", sa.String(length=32), nullable=False, server_default="stored_credentials"),
            sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("last_selected_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "mailbox_email", name="uq_app_user_mailboxes_user_email"),
            schema=app_schema,
        )

    index_names = _index_names(app_schema, "user_mailboxes")
    if "ix_app_user_mailboxes_user_id" not in index_names:
        op.create_index("ix_app_user_mailboxes_user_id", "user_mailboxes", ["user_id"], unique=False, schema=app_schema)
    if "ix_app_user_mailboxes_user_id_is_active" not in index_names:
        op.create_index(
            "ix_app_user_mailboxes_user_id_is_active",
            "user_mailboxes",
            ["user_id", "is_active"],
            unique=False,
            schema=app_schema,
        )
    if "ix_app_user_mailboxes_user_id_is_primary" not in index_names:
        op.create_index(
            "ix_app_user_mailboxes_user_id_is_primary",
            "user_mailboxes",
            ["user_id", "is_primary"],
            unique=False,
            schema=app_schema,
        )

    bind = op.get_bind()
    bool_true = "TRUE" if bind.dialect.name == "postgresql" else "1"
    schema_prefix = f"{app_schema}." if app_schema else ""
    bind.execute(sa.text(
        f"""
        INSERT INTO {schema_prefix}user_mailboxes (
            id,
            user_id,
            label,
            mailbox_email,
            mailbox_login,
            mailbox_password_enc,
            auth_mode,
            is_primary,
            is_active,
            sort_order,
            last_selected_at,
            created_at,
            updated_at
        )
        SELECT
            'legacy-' || CAST(u.id AS VARCHAR(64)) AS id,
            u.id,
            COALESCE(NULLIF(TRIM(COALESCE(u.mailbox_email, u.email, '')), ''), 'Основной ящик') AS label,
            COALESCE(NULLIF(TRIM(COALESCE(u.mailbox_email, u.email, '')), ''), '') AS mailbox_email,
            NULLIF(TRIM(COALESCE(u.mailbox_login, '')), '') AS mailbox_login,
            COALESCE(u.mailbox_password_enc, '') AS mailbox_password_enc,
            CASE
                WHEN LOWER(COALESCE(u.auth_source, 'local')) = 'ldap' THEN 'primary_session'
                ELSE 'stored_credentials'
            END AS auth_mode,
            {bool_true} AS is_primary,
            {bool_true} AS is_active,
            0 AS sort_order,
            NULL AS last_selected_at,
            COALESCE(u.created_at, CURRENT_TIMESTAMP) AS created_at,
            COALESCE(u.updated_at, CURRENT_TIMESTAMP) AS updated_at
        FROM {schema_prefix}users u
        WHERE COALESCE(NULLIF(TRIM(COALESCE(u.mailbox_email, u.email, '')), ''), '') <> ''
          AND NOT EXISTS (
              SELECT 1
              FROM {schema_prefix}user_mailboxes m
              WHERE m.user_id = u.id
          )
        """
    ))

    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            f"""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_app_user_mailboxes_primary_per_user
            ON {schema_prefix}user_mailboxes (user_id)
            WHERE is_primary = true
            """
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")
    index_names = _index_names(app_schema, "user_mailboxes") if "user_mailboxes" in _table_names(app_schema) else set()
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS app.uq_app_user_mailboxes_primary_per_user" if app_schema else "DROP INDEX IF EXISTS uq_app_user_mailboxes_primary_per_user")
    if "ix_app_user_mailboxes_user_id_is_primary" in index_names:
        op.drop_index("ix_app_user_mailboxes_user_id_is_primary", table_name="user_mailboxes", schema=app_schema)
    if "ix_app_user_mailboxes_user_id_is_active" in index_names:
        op.drop_index("ix_app_user_mailboxes_user_id_is_active", table_name="user_mailboxes", schema=app_schema)
    if "ix_app_user_mailboxes_user_id" in index_names:
        op.drop_index("ix_app_user_mailboxes_user_id", table_name="user_mailboxes", schema=app_schema)
    if "user_mailboxes" in _table_names(app_schema):
        op.drop_table("user_mailboxes", schema=app_schema)
