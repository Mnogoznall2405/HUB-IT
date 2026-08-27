from __future__ import annotations

from io import StringIO
from pathlib import Path

from alembic import command
from alembic.config import Config
import sqlalchemy as sa


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"


def test_mobile_biometric_migration_up_and_down(temp_dir):
    database_path = Path(temp_dir) / "mobile_biometric_migration.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    config = Config(str(WEB_ROOT / "backend" / "alembic.ini"))
    config.set_main_option("script_location", str(WEB_ROOT / "backend" / "alembic"))
    config.set_main_option("sqlalchemy.url", database_url)
    config.attributes["itinvent_scope"] = "app"
    config.attributes["configure_logger"] = False

    command.stamp(config, "20260822_0101")
    command.upgrade(config, "head")

    engine = sa.create_engine(database_url)
    inspector = sa.inspect(engine)
    assert inspector.has_table("mobile_biometric_credentials")
    assert {
        "uq_app_mobile_biometric_user_device",
        "uq_app_mobile_biometric_token_hash",
    }.issubset({item["name"] for item in inspector.get_unique_constraints("mobile_biometric_credentials")})

    command.downgrade(config, "20260822_0101")
    inspector = sa.inspect(engine)
    assert not inspector.has_table("mobile_biometric_credentials")
    engine.dispose()


def test_mobile_migrations_generate_postgresql_offline_sql():
    config = Config(str(WEB_ROOT / "backend" / "alembic.ini"))
    config.set_main_option("script_location", str(WEB_ROOT / "backend" / "alembic"))
    config.set_main_option(
        "sqlalchemy.url",
        "postgresql+psycopg://offline:offline@invalid/offline",
    )
    config.attributes["itinvent_scope"] = "app"
    config.attributes["configure_logger"] = False
    output = StringIO()
    config.output_buffer = output

    command.upgrade(config, "20260818_0100:20260823_0102", sql=True)

    ddl = output.getvalue()
    assert "CREATE TABLE app.push_outbox" in ddl
    assert "CREATE TABLE app.mobile_biometric_credentials" in ddl
    assert "uq_app_push_outbox_dedupe_key" in ddl
    assert "uq_app_mobile_biometric_token_hash" in ddl

    downgrade_output = StringIO()
    config.output_buffer = downgrade_output
    command.downgrade(config, "20260823_0102:20260818_0100", sql=True)
    downgrade_ddl = downgrade_output.getvalue()
    assert "DROP TABLE app.mobile_biometric_credentials" in downgrade_ddl
    assert "DROP TABLE app.push_outbox" in downgrade_ddl
