"""Migration 0151 drops the "series" indexes that duplicate a unique constraint.

Why a migration test: a wrong drop leaves a 5.5M-row table without the index its lookups need, and
the failure only shows up as slow production queries. The guard (never drop the only index) and the
downgrade are not reachable through an HTTP boundary."""
from __future__ import annotations

import runpy
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


ROOT = Path(__file__).resolve().parents[1]
REVISION = ROOT / "WEB-itinvent" / "backend" / "alembic" / "versions" / "20261029_0151_monitoring_drop_duplicate_series_indexes.py"


def _migration(connection, *, scope: str = "app"):
    namespace = runpy.run_path(str(REVISION))
    operations = Operations(MigrationContext.configure(connection))
    for name in ("upgrade", "downgrade"):
        namespace[name].__globals__["op"] = operations
        namespace[name].__globals__["_scope"] = lambda: scope
    return namespace


def _tables(connection, *, with_unique: bool) -> None:
    metadata = sa.MetaData()
    unique = lambda *columns, name: [sa.UniqueConstraint(*columns, name=name)] if with_unique else []
    sa.Table("monitoring_samples", metadata,
             sa.Column("id", sa.String(36), primary_key=True), sa.Column("target_id", sa.String(36)),
             sa.Column("interface_id", sa.String(36)), sa.Column("observed_at", sa.DateTime()),
             *unique("target_id", "interface_id", "observed_at", name="uq_monitoring_sample"))
    sa.Table("monitoring_aggregates", metadata,
             sa.Column("id", sa.String(36), primary_key=True), sa.Column("target_id", sa.String(36)),
             sa.Column("interface_id", sa.String(36)), sa.Column("resolution", sa.Integer()),
             sa.Column("bucket_at", sa.DateTime()),
             *unique("target_id", "interface_id", "resolution", "bucket_at", name="uq_monitoring_aggregate"))
    metadata.create_all(connection)
    connection.execute(sa.text("CREATE INDEX ix_monitoring_samples_series ON monitoring_samples (target_id, interface_id, observed_at)"))
    connection.execute(sa.text("CREATE INDEX ix_monitoring_aggregates_series ON monitoring_aggregates (target_id, interface_id, resolution, bucket_at)"))


def _index_names(connection, table: str) -> set[str]:
    return {item["name"] for item in sa.inspect(connection).get_indexes(table)}


def test_duplicates_are_dropped_the_unique_index_stays_and_downgrade_restores_them() -> None:
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        _tables(connection, with_unique=True)
        migration = _migration(connection)

        migration["upgrade"]()
        assert "ix_monitoring_samples_series" not in _index_names(connection, "monitoring_samples")
        assert "ix_monitoring_aggregates_series" not in _index_names(connection, "monitoring_aggregates")
        assert sa.inspect(connection).get_unique_constraints("monitoring_samples")[0]["name"] == "uq_monitoring_sample"
        assert sa.inspect(connection).get_unique_constraints("monitoring_aggregates")[0]["name"] == "uq_monitoring_aggregate"

        migration["upgrade"]()  # re-running is a no-op
        migration["downgrade"]()
        assert "ix_monitoring_samples_series" in _index_names(connection, "monitoring_samples")
        assert "ix_monitoring_aggregates_series" in _index_names(connection, "monitoring_aggregates")


def test_an_index_is_kept_when_no_unique_constraint_covers_the_same_columns() -> None:
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        _tables(connection, with_unique=False)
        _migration(connection)["upgrade"]()
        assert "ix_monitoring_samples_series" in _index_names(connection, "monitoring_samples")
        assert "ix_monitoring_aggregates_series" in _index_names(connection, "monitoring_aggregates")


def test_chat_scope_leaves_the_app_schema_alone() -> None:
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)
    with engine.begin() as connection:
        _tables(connection, with_unique=True)
        _migration(connection, scope="chat")["upgrade"]()
        assert "ix_monitoring_samples_series" in _index_names(connection, "monitoring_samples")
