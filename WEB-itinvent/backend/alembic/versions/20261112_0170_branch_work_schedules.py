"""Per-branch work schedules used to reclassify DLP activity (lunch -> перерыв,
idle outside the workday -> вне смены).

Revision ID: 20261112_0170
Revises: 20261111_0169

Schedules are keyed by the resolved inventory ``branch_name``. ``tz_offset_minutes``
shifts server-local bucket times into branch-local time (Russia has no DST, so a
fixed offset is enough). Buckets are classified at query time, so a schedule
applies retroactively and the stored data stays untouched.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261112_0170"
down_revision = "20261111_0169"
branch_labels = None
depends_on = None

TABLE = "branch_work_schedules"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema() -> str | None:
    return "app" if op.get_bind().dialect.name == "postgresql" else None


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if sa.inspect(op.get_bind()).has_table(TABLE, schema=schema):
        return
    op.create_table(
        TABLE,
        sa.Column("branch_name", sa.String(255), nullable=False),
        sa.Column("work_start_min", sa.Integer(), nullable=False, server_default="540"),
        sa.Column("work_end_min", sa.Integer(), nullable=False, server_default="1080"),
        sa.Column("lunch_start_min", sa.Integer(), nullable=True),
        sa.Column("lunch_end_min", sa.Integer(), nullable=True),
        sa.Column("tz_offset_minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("workdays_mask", sa.Integer(), nullable=False, server_default="31"),
        sa.Column("updated_by", sa.String(255), nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("branch_name", name="pk_app_branch_work_schedules"),
        schema=schema,
    )


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if sa.inspect(op.get_bind()).has_table(TABLE, schema=schema):
        op.drop_table(TABLE, schema=schema)
