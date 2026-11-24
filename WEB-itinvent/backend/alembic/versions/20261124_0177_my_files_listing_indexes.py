"""Composite indexes for My Files listing and quota paths (Performance V3).

Every folder navigation reads ``my_files`` filtered by
``(owner_user_id, deleted_at IS NULL, expires_at > now, folder_id)`` ordered by
``created_at`` — previously only a bare ``owner_user_id`` index existed, so each
listing scanned the whole owner partition. The same predicate shape drives the
per-folder counts, shared/public listings and trash; the quota endpoint sums
``original_size_bytes`` over the live owner partition on every navigation.

Two covering composites keep the hot paths inside the index:

- ``ix_app_my_files_owner_live_folder`` — owner + liveness + folder + sort key.
- ``ix_app_my_files_owner_quota_cover`` — owner + liveness + status + expiry +
  the summed column, so quota becomes an index-only aggregate.

Write cost: two extra B-tree inserts per row mutation; ``my_files`` writes are
per-file rather than bulk, so the trade-off favours read latency.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261124_0177"
down_revision = "20261118_0176"
branch_labels = None
depends_on = None


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _schema(name: str) -> str | None:
    return name if op.get_bind().dialect.name == "postgresql" else None


def _has_table(schema: str | None, table_name: str) -> bool:
    return bool(sa.inspect(op.get_bind()).has_table(table_name, schema=schema))


def _index_names(schema: str | None, table_name: str) -> set[str]:
    if not _has_table(schema, table_name):
        return set()
    return {
        str(item.get("name") or "")
        for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    }


def _create_index_if_missing(name: str, table_name: str, columns: list[str], *, schema: str | None) -> None:
    if name in _index_names(schema, table_name):
        return
    op.create_index(name, table_name, columns, schema=schema)


def _drop_index_if_present(name: str, table_name: str, *, schema: str | None) -> None:
    if name not in _index_names(schema, table_name):
        return
    op.drop_index(name, table_name=table_name, schema=schema)


_INDEXES = (
    (
        "ix_app_my_files_owner_live_folder",
        ["owner_user_id", "deleted_at", "folder_id", "created_at"],
    ),
    (
        "ix_app_my_files_owner_quota_cover",
        ["owner_user_id", "deleted_at", "status", "expires_at", "original_size_bytes"],
    ),
)


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema("app")
    if not _has_table(schema, "my_files"):
        return
    for index_name, columns in _INDEXES:
        _create_index_if_missing(index_name, "my_files", columns, schema=schema)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema("app")
    for index_name, _columns in _INDEXES:
        _drop_index_if_present(index_name, "my_files", schema=schema)
