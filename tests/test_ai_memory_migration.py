from __future__ import annotations

import runpy
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


ROOT = Path(__file__).resolve().parents[1]
REVISION = ROOT / "WEB-itinvent" / "backend" / "alembic" / "versions" / "20260814_0098_ai_memory_and_bot_catalog.py"


def test_ai_memory_migration_adds_context_catalog_and_memory_tables():
    namespace = runpy.run_path(str(REVISION))
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)

    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE ai_bots (id VARCHAR(64) PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE ai_bot_conversations (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, "
            "bot_id VARCHAR(64) NOT NULL, conversation_id VARCHAR(36) NOT NULL, updated_at DATETIME NOT NULL)"
        )
        connection.exec_driver_sql("CREATE TABLE user_settings (user_id INTEGER PRIMARY KEY, updated_at DATETIME NOT NULL)")
        operations = Operations(MigrationContext.configure(connection))
        for name in ("upgrade", "downgrade"):
            namespace[name].__globals__["op"] = operations
            namespace[name].__globals__["_scope"] = lambda: "app"

        namespace["upgrade"]()

        inspector = sa.inspect(connection)
        assert {
            "surface", "placement", "sort_order", "required_permission", "use_personal_memory"
        }.issubset({item["name"] for item in inspector.get_columns("ai_bots")})
        assert {
            "rolling_summary", "summary_until_seq", "context_reset_seq", "use_personal_memory", "title_source"
        }.issubset({item["name"] for item in inspector.get_columns("ai_bot_conversations")})
        assert "ai_personal_memory_enabled" in {item["name"] for item in inspector.get_columns("user_settings")}
        assert inspector.has_table("ai_user_memories")
        assert inspector.has_table("ai_user_memory_sources")
        assert "uq_app_ai_user_memories_user_hash" in {
            item["name"] for item in inspector.get_unique_constraints("ai_user_memories")
        }

        namespace["downgrade"]()
        inspector = sa.inspect(connection)
        assert not inspector.has_table("ai_user_memories")
        assert "rolling_summary" not in {item["name"] for item in inspector.get_columns("ai_bot_conversations")}


def test_ai_memory_migration_skips_chat_scope():
    namespace = runpy.run_path(str(REVISION))
    namespace["upgrade"].__globals__["_scope"] = lambda: "chat"
    namespace["upgrade"]()
