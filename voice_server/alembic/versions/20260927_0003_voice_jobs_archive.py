"""voice_jobs: warm-storage archive markers.

Revision ID: 20260927_0003
Revises: 20260927_0002
Create Date: 2026-09-27
"""
from alembic import op
import sqlalchemy as sa


revision = "20260927_0003"
down_revision = "20260927_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "voice_jobs", sa.Column("archive_path", sa.Text(), nullable=True), schema="voice"
    )
    op.add_column(
        "voice_jobs",
        sa.Column("archive_at", sa.DateTime(timezone=True), nullable=True),
        schema="voice",
    )
    op.create_index(
        "ix_voice_jobs_archive_at", "voice_jobs", ["archive_at"], schema="voice"
    )


def downgrade() -> None:
    op.drop_index("ix_voice_jobs_archive_at", table_name="voice_jobs", schema="voice")
    op.drop_column("voice_jobs", "archive_at", schema="voice")
    op.drop_column("voice_jobs", "archive_path", schema="voice")
