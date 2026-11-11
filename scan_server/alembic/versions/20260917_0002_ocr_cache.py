"""OCR result dedup cache (complete results only; rules re-applied on hit).

Revision ID: 20260917_0002
Revises: 20260717_0001
Create Date: 2026-09-17
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260917_0002"
down_revision: Union[str, Sequence[str], None] = "20260717_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS scan.scan_ocr_cache (
            content_hash TEXT NOT NULL,
            analysis_version TEXT NOT NULL DEFAULT '',
            ocr_profile TEXT NOT NULL DEFAULT '',
            ocr_text TEXT NOT NULL DEFAULT '',
            page_outcomes_json TEXT NOT NULL DEFAULT '[]',
            ocr_metrics_json TEXT NOT NULL DEFAULT '{}',
            hit_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT 0,
            last_hit_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (content_hash, analysis_version, ocr_profile)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_scan_ocr_cache_created "
        "ON scan.scan_ocr_cache(created_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS scan.scan_ocr_cache")
