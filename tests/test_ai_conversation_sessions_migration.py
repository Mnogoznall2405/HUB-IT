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
    / "20260814_0097_ai_conversation_sessions.py"
)


def test_ai_conversation_sessions_migration_allows_multiple_dialogs_per_agent():
    namespace = runpy.run_path(str(REVISION))
    upgrade = namespace["upgrade"]
    downgrade = namespace["downgrade"]
    engine = sa.create_engine("sqlite+pysqlite:///:memory:", future=True)

    with engine.begin() as connection:
        connection.exec_driver_sql(
            """
            CREATE TABLE ai_bot_conversations (
                id INTEGER PRIMARY KEY,
                bot_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                conversation_id INTEGER NOT NULL,
                updated_at DATETIME NOT NULL,
                CONSTRAINT uq_app_ai_bot_conversations_bot_user UNIQUE (bot_id, user_id)
            )
            """
        )
        connection.exec_driver_sql(
            """
            INSERT INTO ai_bot_conversations
                (id, bot_id, user_id, conversation_id, updated_at)
            VALUES
                (1, 7, 11, 101, '2026-08-14 10:00:00')
            """
        )
        operations = Operations(MigrationContext.configure(connection))
        for operation in (upgrade, downgrade):
            operation.__globals__["op"] = operations
            operation.__globals__["_scope"] = lambda: "app"

        upgrade()

        inspector = sa.inspect(connection)
        unique_names = {
            item["name"]
            for item in inspector.get_unique_constraints("ai_bot_conversations")
        }
        index_names = {
            item["name"] for item in inspector.get_indexes("ai_bot_conversations")
        }
        assert "uq_app_ai_bot_conversations_bot_user" not in unique_names
        assert "ix_app_ai_bot_conversations_user_bot_updated" in index_names

        connection.exec_driver_sql(
            """
            INSERT INTO ai_bot_conversations
                (id, bot_id, user_id, conversation_id, updated_at)
            VALUES
                (2, 7, 11, 102, '2026-08-14 11:00:00')
            """
        )
        count = connection.execute(
            sa.text(
                "SELECT COUNT(*) FROM ai_bot_conversations "
                "WHERE bot_id = 7 AND user_id = 11"
            )
        ).scalar_one()
        assert count == 2

        connection.exec_driver_sql("DELETE FROM ai_bot_conversations WHERE id = 2")
        downgrade()

        downgraded_unique_names = {
            item["name"]
            for item in sa.inspect(connection).get_unique_constraints("ai_bot_conversations")
        }
        assert "uq_app_ai_bot_conversations_bot_user" in downgraded_unique_names
