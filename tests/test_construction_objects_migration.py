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
    / "20260901_0106_construction_objects.py"
)


def test_construction_objects_migration_up_and_down():
    namespace = runpy.run_path(str(REVISION))
    upgrade = namespace["upgrade"]
    downgrade = namespace["downgrade"]
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)

    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        for operation in (upgrade, downgrade):
            operation.__globals__["op"] = operations
            operation.__globals__["_scope"] = lambda: "app"

        upgrade()
        inspector = sa.inspect(connection)
        assert inspector.has_table("construction_objects")
        assert inspector.has_table("construction_object_1c_groups")
        assert inspector.has_table("construction_object_role_assignments")
        group_unique = {item["name"] for item in inspector.get_unique_constraints("construction_object_1c_groups")}
        assert "uq_app_construction_object_1c_group_ref" in group_unique
        role_indexes = {item["name"]: item for item in inspector.get_indexes("construction_object_role_assignments")}
        assert role_indexes["uq_app_construction_object_active_role"]["unique"] == 1

        downgrade()
        inspector = sa.inspect(connection)
        assert not inspector.has_table("construction_object_role_assignments")
        assert not inspector.has_table("construction_object_1c_groups")
        assert not inspector.has_table("construction_objects")
