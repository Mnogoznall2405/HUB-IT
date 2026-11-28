"""Hybrid Russian FTS and trigram indexes for AI KB chunks.

The existing simple FTS index remains in place for rollback/compatibility.
These expression indexes intentionally match the SQL shapes used by
backend.ai_chat.retrieval_interface; changing either side without the other
can silently degrade retrieval back to sequential scans.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261129_0187"
down_revision = "20261128_0186"
branch_labels = None
depends_on = None

FTS_INDEX_NAME = "ix_app_ai_kb_chunks_fts_russian"
TRGM_INDEX_NAME = "ix_app_ai_kb_chunks_trgm_lower"


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _is_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _index_names(schema: str, table_name: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name, schema=schema):
        return set()
    return {str(item.get("name") or "").strip() for item in inspector.get_indexes(table_name, schema=schema)}


def upgrade() -> None:
    if _scope() == "chat" or not _is_postgres():
        return
    if not sa.inspect(op.get_bind()).has_table("ai_kb_chunks", schema="app"):
        return
    existing = _index_names("app", "ai_kb_chunks")
    if FTS_INDEX_NAME not in existing:
        op.execute(
            f"""
            CREATE INDEX {FTS_INDEX_NAME}
            ON app.ai_kb_chunks
            USING GIN (
                to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(content, ''))
            )
            """
        )
    if TRGM_INDEX_NAME not in existing:
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        op.execute(
            f"""
            CREATE INDEX {TRGM_INDEX_NAME}
            ON app.ai_kb_chunks
            USING GIN (
                lower(coalesce(title, '') || ' ' || coalesce(content, '')) gin_trgm_ops
            )
            """
        )


def downgrade() -> None:
    if _scope() == "chat" or not _is_postgres():
        return
    op.execute(f"DROP INDEX IF EXISTS app.{TRGM_INDEX_NAME}")
    op.execute(f"DROP INDEX IF EXISTS app.{FTS_INDEX_NAME}")

