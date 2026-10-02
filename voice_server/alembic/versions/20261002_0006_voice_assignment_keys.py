"""Assignment statuses keyed by stable item key + linked hub task.

Statuses were keyed by row number (base_filename, num); regenerating the registry
renumbers rows, so a status could silently move to another assignment.

Revision ID: 20261002_0006
Revises: 20261002_0005
Create Date: 2026-10-02
"""
from alembic import op
import sqlalchemy as sa

revision = "20261002_0006"
down_revision = "20261002_0005"
branch_labels = None
depends_on = None

_TABLE = "voice_assignment_statuses"
_OLD_UQ = "uq_voice_assignment_statuses_base_num"
_NEW_UQ = "uq_voice_assignment_statuses_base_key"


def _inspect():
    return sa.inspect(op.get_bind())


def upgrade() -> None:
    insp = _inspect()
    columns = {c["name"] for c in insp.get_columns(_TABLE, schema="voice")}
    with op.batch_alter_table(_TABLE, schema="voice") as batch:
        if "item_key" not in columns:
            batch.add_column(sa.Column("item_key", sa.String(64), nullable=True))
        if "task_id" not in columns:
            batch.add_column(sa.Column("task_id", sa.String(64), nullable=True))
        # Rows are matched by key now; the same number may legitimately repeat
        # (legacy row + keyed row) after a registry regeneration.
        if any(u.get("name") == _OLD_UQ for u in insp.get_unique_constraints(_TABLE, schema="voice")):
            batch.drop_constraint(_OLD_UQ, type_="unique")
    insp = _inspect()
    if not any(i.get("name") == _NEW_UQ for i in insp.get_indexes(_TABLE, schema="voice")):
        op.create_index(_NEW_UQ, _TABLE, ["base_filename", "item_key"], unique=True, schema="voice")


def downgrade() -> None:
    op.drop_index(_NEW_UQ, table_name=_TABLE, schema="voice")
    with op.batch_alter_table(_TABLE, schema="voice") as batch:
        batch.drop_column("task_id")
        batch.drop_column("item_key")
    # Keyed rows may share a number now: keep the newest per (base, num) before restoring the constraint.
    op.execute(
        f"""
        DELETE FROM voice.{_TABLE} WHERE id IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY base_filename, num ORDER BY updated_at DESC
                ) AS rn FROM voice.{_TABLE}
            ) ranked WHERE rn > 1
        )
        """
    )
    with op.batch_alter_table(_TABLE, schema="voice") as batch:
        batch.create_unique_constraint(_OLD_UQ, ["base_filename", "num"])
