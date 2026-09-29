"""Share links table for time-limited public report access.

Revision ID: 20260927_0002
Revises: 20260926_0001
Create Date: 2026-09-27
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from voice_server.db import VOICE_SCHEMA

revision: str = "20260927_0002"
down_revision: Union[str, Sequence[str], None] = "20260926_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "share_links",
        sa.Column("token", sa.String(64), primary_key=True),
        sa.Column("base_filename", sa.String(512), nullable=False),
        sa.Column("created_by", sa.String(256), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        schema=VOICE_SCHEMA,
    )
    op.create_index(
        "ix_share_links_expires_at", "share_links", ["expires_at"], schema=VOICE_SCHEMA
    )


def downgrade() -> None:
    op.drop_index("ix_share_links_expires_at", table_name="share_links", schema=VOICE_SCHEMA)
    op.drop_table("share_links", schema=VOICE_SCHEMA)
