"""Native construction work plan, daily journal and audit history.

Revision ID: 20260908_0108
Revises: 20260907_0107
"""
from alembic import op
import sqlalchemy as sa

revision = "20260908_0108"
down_revision = "20260907_0107"
branch_labels = None
depends_on = None


def _scope():
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all")


def upgrade():
    if _scope() == "chat":
        return
    schema = "app" if op.get_bind().dialect.name == "postgresql" else None
    target = "app.construction_work_items.id" if schema else "construction_work_items.id"
    op.create_table(
        "construction_work_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("object_id", sa.String(64), nullable=False),
        sa.Column("group_ref", sa.String(64), nullable=False),
        sa.Column("plan_json", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.CheckConstraint("version >= 1", name="ck_app_construction_work_version"),
        schema=schema,
    )
    op.create_index("ix_app_construction_work_scope", "construction_work_items", ["object_id", "group_ref"], schema=schema)
    op.create_table(
        "construction_work_entries",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("work_id", sa.String(36), sa.ForeignKey(target), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 4), nullable=False),
        sa.Column("details_json", sa.Text(), nullable=False),
        sa.UniqueConstraint("work_id", "work_date", name="uq_app_construction_work_day"),
        sa.CheckConstraint("quantity >= 0", name="ck_app_construction_work_quantity"),
        schema=schema,
    )
    op.create_table(
        "construction_work_audit",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("work_id", sa.String(36), sa.ForeignKey(target), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=False),
        sa.Column("actor_name", sa.String(255), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("before_json", sa.Text(), nullable=False),
        sa.Column("after_json", sa.Text(), nullable=False),
        schema=schema,
    )
    op.create_index("ix_app_construction_work_audit", "construction_work_audit", ["work_id", "id"], schema=schema)


def downgrade():
    if _scope() == "chat":
        return
    schema = "app" if op.get_bind().dialect.name == "postgresql" else None
    for table in ("construction_work_audit", "construction_work_entries", "construction_work_items"):
        op.drop_table(table, schema=schema)
