"""LLM second-opinion review queue for scan incidents.

Revision ID: 20261119_0004
Revises: 20261102_0003
Create Date: 2026-11-19

``scan_llm_reviews`` holds one queued review per incident (enqueue happens inside
``create_finding_and_incident``'s transaction) plus the verdict the local model
writes back. The incident itself is annotated through the read path (latest done
review), so failure or absence of the LLM worker never blocks incident flow.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20261119_0004"
down_revision: Union[str, Sequence[str], None] = "20261102_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS scan.scan_llm_reviews (
            id TEXT PRIMARY KEY,
            incident_id TEXT NOT NULL,
            finding_id TEXT NOT NULL DEFAULT '',
            job_id TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'queued',
            input_json TEXT NOT NULL DEFAULT '{}',
            verdict TEXT NULL,
            confidence REAL NULL,
            severity_suggestion TEXT NULL,
            reason TEXT NULL,
            model TEXT NULL,
            created_at INTEGER NOT NULL,
            started_at INTEGER NULL,
            finished_at INTEGER NULL,
            next_attempt_at INTEGER NOT NULL DEFAULT 0,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            error_text TEXT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_scan_llm_reviews_status_created "
        "ON scan.scan_llm_reviews(status, next_attempt_at, created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_scan_llm_reviews_incident "
        "ON scan.scan_llm_reviews(incident_id, finished_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS scan.scan_llm_reviews")
