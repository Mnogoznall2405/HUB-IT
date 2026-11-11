"""Initial voice schema tables.

Revision ID: 20260926_0001
Revises:
Create Date: 2026-09-26
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

from voice_server.db import VOICE_SCHEMA
from voice_server.models import Base

revision: str = "20260926_0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql(f"CREATE SCHEMA IF NOT EXISTS {VOICE_SCHEMA}")
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
