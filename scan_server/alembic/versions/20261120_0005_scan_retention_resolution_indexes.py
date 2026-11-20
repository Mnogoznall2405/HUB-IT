"""Indexes for scan retention and incident resolution lookups.

Revision ID: 20261120_0005
Revises: 20261119_0004
Create Date: 2026-11-20

- ``scan_findings(created_at)``: hourly retention deletes findings by age; the
  batch WHERE had no supporting index, so every batch seq-scanned the table.
- ``scan_incidents(agent_id, file_path)``: the resolution-event fallback lookup
  filters exactly on this pair once per file-resolution event.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20261120_0005"
down_revision: Union[str, Sequence[str], None] = "20261119_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_scan_findings_created "
        "ON scan.scan_findings(created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_scan_incidents_agent_file_path "
        "ON scan.scan_incidents(agent_id, file_path)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS scan.idx_scan_incidents_agent_file_path")
    op.execute("DROP INDEX IF EXISTS scan.idx_scan_findings_created")
