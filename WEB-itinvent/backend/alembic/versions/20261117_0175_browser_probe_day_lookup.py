"""Index cross-host daily DLP queries concurrently on PostgreSQL.

Revision ID: 20261117_0175
Revises: 20261117_0174
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261117_0175"
down_revision = "20261117_0174"
branch_labels = None
depends_on = None

TABLE = "browser_probe_visits"
INDEX = "ix_app_browser_probe_visits_visited_computer"
COLUMNS = ["visited_at", "computer_name"]


def _scope() -> str:
    return str(op.get_context().config.attributes.get("itinvent_scope", "all") or "all").strip().lower()


def _change_index(*, create: bool) -> None:
    postgres = op.get_bind().dialect.name == "postgresql"
    schema = "app" if postgres else None

    def execute() -> None:
        options = {"postgresql_concurrently": True} if postgres else {}
        if create:
            op.create_index(INDEX, TABLE, COLUMNS, schema=schema, **options)
        else:
            op.drop_index(INDEX, table_name=TABLE, schema=schema, **options)

    if not postgres:
        execute()
        return
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
    postgres = op.get_bind().dialect.name == "postgresql"
    indexes = sa.inspect(op.get_bind()).get_indexes(TABLE, schema="app" if postgres else None)
    existing = next((index for index in indexes if index["name"] == INDEX), None)
    if existing:
        if existing["column_names"] != COLUMNS:
            raise RuntimeError(f"Unexpected columns on {INDEX}; inspect before retrying migration")
        if postgres:
            valid = op.get_bind().execute(sa.text(
                "SELECT indisvalid AND indisready FROM pg_index "
                "WHERE indexrelid = to_regclass(:name)"
            ), {"name": f"app.{INDEX}"}).scalar_one()
            if not valid:
                raise RuntimeError(f"Invalid index {INDEX}; repair it before retrying migration")
        return
    _change_index(create=True)


def downgrade() -> None:
    if _scope() == "chat":
        return
    schema = "app" if op.get_bind().dialect.name == "postgresql" else None
    if any(index["name"] == INDEX for index in sa.inspect(op.get_bind()).get_indexes(TABLE, schema=schema)):
        _change_index(create=False)
