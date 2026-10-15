"""Schema checks HTTP tests cannot reach: idempotent upgrade, unique key, downgrade."""
import runpy
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

REVISION = (
    Path(__file__).resolve().parents[1]
    / "WEB-itinvent/backend/alembic/versions/20261012_0130_equipment_photo_checks.py"
)
INSERT = (
    "INSERT INTO equipment_photo_checks (db_id, item_id, file_no, file_created_at, created_at) "
    "VALUES ('main', 1, :file_no, '2026-10-12 10:00:00', CURRENT_TIMESTAMP)"
)


def _migration(connection, scope):
    namespace = runpy.run_path(str(REVISION))
    namespace["upgrade"].__globals__["op"] = Operations(MigrationContext.configure(connection))
    namespace["upgrade"].__globals__["_scope"] = lambda: scope
    return namespace


def test_upgrade_repeat_downgrade_keeps_one_row_per_photo():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        namespace = _migration(connection, "app")
        namespace["upgrade"]()
        namespace["upgrade"]()
        connection.execute(sa.text(INSERT), {"file_no": 7})
        with pytest.raises(sa.exc.IntegrityError):
            connection.execute(sa.text(INSERT), {"file_no": 7})
        namespace["downgrade"]()
        namespace["downgrade"]()
        assert not sa.inspect(connection).has_table("equipment_photo_checks")


def test_chat_only_migration_does_not_create_app_table():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _migration(connection, "chat")["upgrade"]()
        assert sa.inspect(connection).get_table_names() == []


OCR_REVISION = (
    Path(__file__).resolve().parents[1]
    / "WEB-itinvent/backend/alembic/versions/20261015_0136_equipment_photo_ocr.py"
)
OCR_INSERT = (
    "INSERT INTO equipment_photo_ocr (db_id, item_id, file_no, file_created_at, photo_type, "
    "serials_json, model, tokens_in, tokens_out, analyzed_at) "
    "VALUES ('main', 1, :file_no, '2026-10-15 10:00:00', 'label', '[]', 'm', 0, 0, CURRENT_TIMESTAMP)"
)


def test_ocr_table_upgrade_is_repeatable_keyed_per_photo_and_downgrades_cleanly():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        namespace = runpy.run_path(str(OCR_REVISION))
        namespace["upgrade"].__globals__["op"] = Operations(MigrationContext.configure(connection))
        namespace["upgrade"].__globals__["_scope"] = lambda: "app"
        namespace["upgrade"]()
        namespace["upgrade"]()
        connection.execute(sa.text(OCR_INSERT), {"file_no": 7})
        with pytest.raises(sa.exc.IntegrityError):
            connection.execute(sa.text(OCR_INSERT), {"file_no": 7})
        namespace["downgrade"]()
        namespace["downgrade"]()
        assert not sa.inspect(connection).has_table("equipment_photo_ocr")


REJECT_REVISION = (
    Path(__file__).resolve().parents[1]
    / "WEB-itinvent/backend/alembic/versions/20261014_0134_equipment_photo_rejects.py"
)


def test_reject_columns_upgrade_is_repeatable_and_downgrade_keeps_the_rows():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        base = _migration(connection, "app")
        base["upgrade"]()
        connection.execute(sa.text(INSERT), {"file_no": 7})

        namespace = runpy.run_path(str(REJECT_REVISION))
        namespace["upgrade"].__globals__["op"] = Operations(MigrationContext.configure(connection))
        namespace["upgrade"].__globals__["_scope"] = lambda: "app"
        namespace["upgrade"]()
        namespace["upgrade"]()
        columns = {column["name"] for column in sa.inspect(connection).get_columns("equipment_photo_checks")}
        assert {"rejected_by_user_id", "rejected_by_name", "rejected_at", "reject_reason"} <= columns

        namespace["downgrade"]()
        columns = {column["name"] for column in sa.inspect(connection).get_columns("equipment_photo_checks")}
        assert "reject_reason" not in columns
        assert connection.execute(sa.text("SELECT count(*) FROM equipment_photo_checks")).scalar() == 1
