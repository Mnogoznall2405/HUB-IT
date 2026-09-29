"""Add voice_assignment_statuses table."""
from alembic import op
import sqlalchemy as sa

revision = "20260928_0004"
down_revision = "20260927_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "voice_assignment_statuses",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("base_filename", sa.String(512), nullable=False),
        sa.Column("num", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("marked_by", sa.String(256), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        schema="voice",
    )
    op.create_index(
        "ix_voice_assignment_statuses_base",
        "voice_assignment_statuses",
        ["base_filename"],
        schema="voice",
    )
    op.create_unique_constraint(
        "uq_voice_assignment_statuses_base_num",
        "voice_assignment_statuses",
        ["base_filename", "num"],
        schema="voice",
    )


def downgrade() -> None:
    op.drop_table("voice_assignment_statuses", schema="voice")
