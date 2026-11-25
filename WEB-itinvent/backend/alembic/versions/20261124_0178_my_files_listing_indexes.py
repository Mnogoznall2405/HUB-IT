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
  the summed column, so quota becomes an index-only aggregate. It also serves
  the cross-folder branches (search / favorites / recent) as the
  owner+live+expires bitmap source — verified against PostgreSQL 17.6 plans,
  which never picked an order-serving ``updated_at`` index (top-N heapsort over
  the owner partition is already cheap), so none is created.

Write cost: two extra B-tree inserts per row mutation; ``my_files`` writes are
per-file rather than bulk, so the trade-off favours read latency.

On PostgreSQL both indexes are built ``CONCURRENTLY`` inside an autocommit
block with a short ``lock_timeout``, matching the convention of
``20261117_0175_browser_probe_day_lookup`` — a plain ``CREATE INDEX`` would
take a SHARE lock that blocks row writes on a hot table.
"""

from alembic import op
import sqlalchemy as sa

revision = "20261124_0178"
down_revision = "20261124_0177"
branch_labels = None
depends_on = None

_TABLE = "my_files"

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


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def _schema() -> str | None:
    return "app" if _postgres() else None


def _index_names(schema: str | None, table_name: str) -> set[str]:
    if not sa.inspect(op.get_bind()).has_table(table_name, schema=schema):
        return set()
    return {
        str(item.get("name") or "")
        for item in sa.inspect(op.get_bind()).get_indexes(table_name, schema=schema)
    }


def _index_valid(schema: str | None, name: str) -> bool:
    if not _postgres():
        return True
    regclass = f"{schema}.{name}" if schema else name
    return bool(
        op.get_bind()
        .execute(
            sa.text("SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid = to_regclass(:name)"),
            {"name": regclass},
        )
        .scalar_one()
    )


def _change_index(name: str, columns: list[str], *, create: bool) -> None:
    postgres = _postgres()
    schema = _schema()

    def execute() -> None:
        options = {"postgresql_concurrently": True} if postgres else {}
        if create:
            op.create_index(name, _TABLE, columns, schema=schema, **options)
        else:
            op.drop_index(name, table_name=_TABLE, schema=schema, **options)

    if not postgres:
        execute()
        return
    # CONCURRENTLY cannot run inside a transaction; guard it with a short
    # lock_timeout so a queued build fails fast instead of stalling writes.
    with op.get_context().autocommit_block():
        bind = op.get_bind()
        previous = bind.execute(sa.text("SELECT current_setting('lock_timeout')")).scalar_one()
        bind.execute(sa.text("SELECT set_config('lock_timeout', '5s', false)"))
        try:
            execute()
        finally:
            bind.execute(sa.text("SELECT set_config('lock_timeout', :value, false)"), {"value": previous})


def upgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    if not sa.inspect(op.get_bind()).has_table(_TABLE, schema=schema):
        return
    existing = _index_names(schema, _TABLE)
    for index_name, columns in _INDEXES:
        if index_name in existing:
            match = next(
                item
                for item in sa.inspect(op.get_bind()).get_indexes(_TABLE, schema=schema)
                if item.get("name") == index_name
            )
            if list(match.get("column_names") or []) != columns:
                raise RuntimeError(f"Unexpected columns on {index_name}; inspect before retrying migration")
            if not _index_valid(schema, index_name):
                raise RuntimeError(f"Invalid index {index_name}; repair it before retrying migration")
            continue
        _change_index(index_name, columns, create=True)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = _schema()
    existing = _index_names(schema, _TABLE)
    for index_name, _columns in _INDEXES:
        if index_name not in existing:
            continue
        if not _index_valid(schema, index_name):
            raise RuntimeError(f"Invalid index {index_name}; repair it before retrying migration")
        _change_index(index_name, _columns, create=False)
