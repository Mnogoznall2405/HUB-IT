"""Create VCS and AD override tables."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260327_0006"
down_revision = "20260327_0005"
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

    op.create_table(
        "vcs_computers",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("ip_address", sa.String(length=50), nullable=False),
        sa.Column("location", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        schema=app_schema,
    )
    op.create_index("ix_vcs_computers_name", "vcs_computers", ["name"], unique=False, schema=app_schema)
    op.create_index("ix_vcs_computers_ip_address", "vcs_computers", ["ip_address"], unique=False, schema=app_schema)

    op.create_table(
        "ad_user_branch_overrides",
        sa.Column("login", sa.String(length=255), nullable=False),
        sa.Column("branch_no", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("login"),
        schema=app_schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    app_schema = _schema("app")

    op.drop_table("ad_user_branch_overrides", schema=app_schema)
    op.drop_index("ix_vcs_computers_ip_address", table_name="vcs_computers", schema=app_schema)
    op.drop_index("ix_vcs_computers_name", table_name="vcs_computers", schema=app_schema)
    op.drop_table("vcs_computers", schema=app_schema)
