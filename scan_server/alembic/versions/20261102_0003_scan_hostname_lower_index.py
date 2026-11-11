"""Hostname search index, previously created by the Scan startup.

Revision ID: 20261102_0003
Revises: 20260917_0002
Create Date: 2026-11-02

Scan no longer runs DDL at startup (it only compares ``scan.alembic_version`` with this head), so the
functional index that ``ensure_scan_schema`` used to add to existing databases moves here. It is
declared on the model too, so a fresh database gets it from 0001; "if not exists" makes this a no-op
there. ``downgrade`` is intentionally empty: the index belongs to the model, not to this revision.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20261102_0003"
down_revision: Union[str, Sequence[str], None] = "20260917_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_scan_incidents_hostname_lower_created "
        "ON scan.scan_incidents (LOWER(hostname), created_at DESC)"
    )


def downgrade() -> None:
    pass
