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


def _index_definitions(schema: str, table_name: str) -> dict[str, str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table_name, schema=schema):
        return {}
    rows = op.get_bind().execute(
        sa.text(
            "SELECT indexname, indexdef FROM pg_indexes "
            "WHERE schemaname = :schema AND tablename = :table_name"
        ),
        {"schema": schema, "table_name": table_name},
    )
    return {str(row.indexname or "").strip(): str(row.indexdef or "") for row in rows}


def _validate_existing_index(name: str, definition: str, *, required: tuple[str, ...], forbidden: tuple[str, ...] = ()) -> None:
    normalized = " ".join(str(definition or "").lower().split())
    missing = [fragment for fragment in required if fragment not in normalized]
    unexpected = [fragment for fragment in forbidden if fragment in normalized]
    if missing or unexpected:
        raise RuntimeError(
            f"Existing index {name} does not match the expected AI KB hybrid search definition; "
            "resolve the conflict manually instead of silently reusing it"
        )


def upgrade() -> None:
    if _scope() == "chat" or not _is_postgres():
        return
    if not sa.inspect(op.get_bind()).has_table("ai_kb_chunks", schema="app"):
        return
    existing = _index_definitions("app", "ai_kb_chunks")
    if FTS_INDEX_NAME in existing:
        _validate_existing_index(
            FTS_INDEX_NAME,
            existing[FTS_INDEX_NAME],
            required=("using gin", "to_tsvector('russian'::regconfig"),
            forbidden=("coalesce(",),
        )
    else:
        op.execute(
            f"""
            CREATE INDEX {FTS_INDEX_NAME}
            ON app.ai_kb_chunks
            USING GIN (
                to_tsvector('russian', title || ' ' || content)
            )
            """
        )
    if TRGM_INDEX_NAME in existing:
        _validate_existing_index(
            TRGM_INDEX_NAME,
            existing[TRGM_INDEX_NAME],
            required=("using gin", "lower(", "gin_trgm_ops"),
            forbidden=("coalesce(",),
        )
    else:
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        op.execute(
            f"""
            CREATE INDEX {TRGM_INDEX_NAME}
            ON app.ai_kb_chunks
            USING GIN (
                lower(title || ' ' || content) gin_trgm_ops
            )
            """
        )


def downgrade() -> None:
    if _scope() == "chat" or not _is_postgres():
        return
    op.execute(f"DROP INDEX IF EXISTS app.{TRGM_INDEX_NAME}")
    op.execute(f"DROP INDEX IF EXISTS app.{FTS_INDEX_NAME}")

