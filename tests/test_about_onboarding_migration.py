from __future__ import annotations

import runpy
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


ROOT = Path(__file__).resolve().parents[1]
REVISION = (
    ROOT
    / "WEB-itinvent"
    / "backend"
    / "alembic"
    / "versions"
    / "20260813_0096_about_onboarding.py"
)


def test_about_onboarding_migration_marks_existing_users_as_completed():
    namespace = runpy.run_path(str(REVISION))
    upgrade = namespace["upgrade"]
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)

    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(255) NOT NULL)"
        )
        connection.exec_driver_sql("INSERT INTO users (id, username) VALUES (1, 'existing-user')")
        operations = Operations(MigrationContext.configure(connection))
        upgrade.__globals__["op"] = operations
        upgrade.__globals__["_scope"] = lambda: "app"

        upgrade()

        columns = {item["name"] for item in sa.inspect(connection).get_columns("users")}
        completed_at = connection.execute(
            sa.text("SELECT about_onboarding_completed_at FROM users WHERE id = 1")
        ).scalar_one()

    assert "about_onboarding_completed_at" in columns
    assert completed_at is not None
