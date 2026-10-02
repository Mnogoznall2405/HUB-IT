"""Add label_projects table (manual diarization labeling).

Revision ID: 20261002_0005
Revises: 20260928_0004
Create Date: 2026-10-02
"""
from alembic import op
import sqlalchemy as sa

revision = "20261002_0005"
down_revision = "20260928_0004"
branch_labels = None
depends_on = None

_TABLE = "label_projects"


def upgrade() -> None:
    # Runtime bootstrap (db.get_voice_engine -> create_all) may have created it already.
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table(_TABLE, schema="voice"):
        return
    op.create_table(
        _TABLE,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("original_filename", sa.String(1024), nullable=True),
        sa.Column("media_path", sa.Text(), nullable=True),
        sa.Column("audio_path", sa.Text(), nullable=True),
        sa.Column("duration", sa.Float(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("job_id", sa.String(36), nullable=True),
        sa.Column("settings", sa.JSON(), nullable=True),
        sa.Column("auto_segments", sa.JSON(), nullable=True),
        sa.Column("segments", sa.JSON(), nullable=True),
        sa.Column("speakers", sa.JSON(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(256), nullable=True),
        sa.Column("updated_by", sa.String(256), nullable=True),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        schema="voice",
    )
    op.create_index(
        "ix_label_projects_created_at", _TABLE, ["created_at"], schema="voice"
    )


def downgrade() -> None:
    op.drop_table(_TABLE, schema="voice")
