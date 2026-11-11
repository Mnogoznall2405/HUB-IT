"""Create session auth context table for AD-backed Exchange auth."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260330_0012"
down_revision = "20260328_0011"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return name
    return None


def _has_table(table_name: str, schema_name: str | None) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names(schema=schema_name)


def _has_index(table_name: str, index_name: str, schema_name: str | None) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(str(index.get("name") or "") == index_name for index in inspector.get_indexes(table_name, schema=schema_name))


def upgrade() -> None:
    if _scope() == "chat":
        return
    system_schema = _schema("system")

    if not _has_table("session_auth_context", system_schema):
        op.create_table(
            "session_auth_context",
            sa.Column("session_id", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("auth_source", sa.String(length=20), nullable=False, server_default="local"),
            sa.Column("exchange_login", sa.String(length=255), nullable=False),
            sa.Column("password_enc", sa.Text(), nullable=False, server_default=""),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("session_id"),
            schema=system_schema,
        )
    if not _has_index("session_auth_context", "idx_session_auth_context_user_id", system_schema):
        op.create_index(
            "idx_session_auth_context_user_id",
            "session_auth_context",
            ["user_id"],
            unique=False,
            schema=system_schema,
        )
    if not _has_index("session_auth_context", "idx_session_auth_context_expires_at", system_schema):
        op.create_index(
            "idx_session_auth_context_expires_at",
            "session_auth_context",
            ["expires_at"],
            unique=False,
            schema=system_schema,
        )


def downgrade() -> None:
    if _scope() == "chat":
        return
    system_schema = _schema("system")
    if _has_index("session_auth_context", "idx_session_auth_context_expires_at", system_schema):
        op.drop_index("idx_session_auth_context_expires_at", table_name="session_auth_context", schema=system_schema)
    if _has_index("session_auth_context", "idx_session_auth_context_user_id", system_schema):
        op.drop_index("idx_session_auth_context_user_id", table_name="session_auth_context", schema=system_schema)
    if _has_table("session_auth_context", system_schema):
        op.drop_table("session_auth_context", schema=system_schema)
