"""Add department and job_title to app.users."""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260328_0007"
down_revision = "20260327_0006"
branch_labels = None
depends_on = None


def _schema(name: str) -> str | None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        return name
    return None


def upgrade() -> None:
    app_schema = _schema("app")
    with op.batch_alter_table("users", schema=app_schema) as batch_op:
        batch_op.add_column(sa.Column("department", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("job_title", sa.String(length=255), nullable=True))


def downgrade() -> None:
    app_schema = _schema("app")
    with op.batch_alter_table("users", schema=app_schema) as batch_op:
        batch_op.drop_column("job_title")
        batch_op.drop_column("department")
