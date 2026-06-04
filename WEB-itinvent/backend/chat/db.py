"""Database runtime helpers for the chat domain."""
from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from backend.chat.models import Base, CHAT_SCHEMA, ChatEventOutbox, ChatPushOutbox
from backend.config import config
from backend.db_migrations import upgrade_internal_database


class ChatConfigurationError(RuntimeError):
    """Raised when chat runtime is disabled or misconfigured."""


class ChatSchemaConfigurationError(ChatConfigurationError):
    """Raised when production chat schema is not migration-ready."""


_engine = None
_session_factory = None
_engines: dict[str, object] = {}
_session_factories: dict[str, object] = {}


# Tables managed by _ensure_*() helpers are excluded from the automatic
# production schema check (_verify_production_schema). Add new tables here
# when they are introduced via _ensure_* instead of a pure Alembic migration.
_CHAT_SCHEMA_CHECK_EXCLUDED_TABLES: frozenset[str] = frozenset({
    "chat_message_reactions",
})

_CHAT_REQUIRED_COLUMNS = {
    table.name: {column.name for column in table.columns}
    for table in Base.metadata.sorted_tables
    if table.name not in _CHAT_SCHEMA_CHECK_EXCLUDED_TABLES
}


_CHAT_REQUIRED_INDEX_ALIASES = {
    "chat_conversations": {
        "last_message_seq": {"idx_chat_conversations_last_message_seq"},
    },
    "chat_messages": {
        "task_id": {"ix_chat_messages_task_id", "idx_chat_messages_task_id", "ix_chat_chat_messages_task_id"},
        "body_format": {"ix_chat_messages_body_format", "idx_chat_messages_body_format", "ix_chat_chat_messages_body_format"},
        "client_message_id": {"idx_chat_messages_client_message_id", "ix_chat_chat_messages_client_message_id"},
        "conversation_seq": {
            "idx_chat_messages_conversation_id_conversation_seq",
            "ix_chat_messages_conversation_id_conversation_seq",
        },
        "reply_to_message_id": {
            "ix_chat_messages_reply_to_message_id",
            "idx_chat_messages_reply_to_message_id",
            "ix_chat_chat_messages_reply_to_message_id",
        },
        "forward_from_message_id": {
            "ix_chat_messages_forward_from_message_id",
            "idx_chat_messages_forward_from_message_id",
            "ix_chat_chat_messages_forward_from_message_id",
        },
        "is_deleted": {"ix_chat_messages_is_deleted", "ix_chat_chat_messages_is_deleted"},
        "deleted_by_user_id": {"ix_chat_messages_deleted_by_user_id", "ix_chat_chat_messages_deleted_by_user_id"},
    },
    "chat_conversation_user_state": {
        "is_archived": {"idx_chat_conversation_user_state_is_archived"},
        "last_read_seq": {"idx_chat_conversation_user_state_last_read_seq"},
        "unread_count": {"idx_chat_conversation_user_state_unread_count"},
    },
}


def is_chat_enabled() -> bool:
    return bool(config.chat.enabled)


def get_chat_database_url(database_url: str | None = None) -> str:
    return str(database_url or config.chat.database_url or config.app_db.database_url or "").strip()


def ensure_chat_configured(database_url: str | None = None) -> str:
    if not is_chat_enabled():
        raise ChatConfigurationError("Chat module is disabled")
    database_url = get_chat_database_url(database_url)
    if not database_url:
        raise ChatConfigurationError("CHAT_DATABASE_URL is not configured")
    return database_url


def _build_engine(database_url: str):
    engine_kwargs = {
        "pool_pre_ping": True,
        "future": True,
    }
    if database_url.startswith("sqlite"):
        return create_engine(database_url, **engine_kwargs).execution_options(
            schema_translate_map={
                "app": None,
                "system": None,
                CHAT_SCHEMA: None,
            }
        )

    engine_kwargs["pool_size"] = max(1, int(config.chat.pool_size))
    engine_kwargs["max_overflow"] = max(0, int(config.chat.max_overflow))
    engine = create_engine(database_url, **engine_kwargs)
    if _should_use_legacy_public_chat_schema(engine):
        return engine.execution_options(
            schema_translate_map={
                CHAT_SCHEMA: None,
            }
        )
    return engine


def get_chat_engine(database_url: str | None = None):
    global _engine

    resolved_url = ensure_chat_configured(database_url)
    if database_url is None and _engine is not None:
        return _engine

    engine = _engines.get(resolved_url)
    if engine is None:
        engine = _build_engine(resolved_url)
        _engines[resolved_url] = engine

    if database_url is None:
        _engine = engine
    return engine


def get_chat_session_factory(database_url: str | None = None):
    global _session_factory

    resolved_url = ensure_chat_configured(database_url)
    if database_url is None and _session_factory is not None:
        return _session_factory

    session_factory = _session_factories.get(resolved_url)
    if session_factory is None:
        session_factory = sessionmaker(
            bind=get_chat_engine(database_url),
            autoflush=False,
            autocommit=False,
            expire_on_commit=False,
        )
        _session_factories[resolved_url] = session_factory

    if database_url is None:
        _session_factory = session_factory
    return session_factory


@contextmanager
def chat_session(database_url: str | None = None) -> Session:
    session = get_chat_session_factory(database_url)()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def initialize_chat_schema(database_url: str | None = None) -> None:
    engine = get_chat_engine(database_url)
    if engine.dialect.name == "postgresql":
        if _uses_legacy_public_chat_schema(engine):
            _ensure_chat_reactions_table(engine)
            if config.app.is_production:
                _verify_production_schema(engine)
                return
            Base.metadata.create_all(bind=engine, tables=[ChatPushOutbox.__table__, ChatEventOutbox.__table__])
            _ensure_chat_message_columns(engine)
            _ensure_chat_conversation_columns(engine)
            _ensure_chat_user_state_columns(engine)
            _ensure_chat_attachment_columns(engine)
            return
        upgrade_internal_database(ensure_chat_configured(database_url), scope="chat")
        if config.app.is_production:
            _verify_production_schema(engine)
            return
        Base.metadata.create_all(bind=engine, tables=[ChatEventOutbox.__table__])
        return
    Base.metadata.create_all(bind=engine)
    _ensure_chat_message_columns(engine)
    _ensure_chat_conversation_columns(engine)
    _ensure_chat_user_state_columns(engine)
    _ensure_chat_attachment_columns(engine)
    _ensure_chat_reactions_table(engine)


def _verify_production_schema(engine) -> None:
    try:
        inspector = inspect(engine)
        schema = _runtime_schema(engine)
        missing_tables = sorted(
            table_name
            for table_name in _CHAT_REQUIRED_COLUMNS
            if not inspector.has_table(table_name, schema=schema)
        )
        missing_columns: list[str] = []
        missing_indexes: list[str] = []
        for table_name, required_columns in _CHAT_REQUIRED_COLUMNS.items():
            if table_name in missing_tables:
                continue
            existing_columns = {
                str(column.get("name") or "").strip().lower()
                for column in inspector.get_columns(table_name, schema=schema)
            }
            for column_name in sorted(required_columns):
                if column_name.lower() not in existing_columns:
                    missing_columns.append(f"{table_name}.{column_name}")
        for table_name, required_indexes in _CHAT_REQUIRED_INDEX_ALIASES.items():
            if table_name in missing_tables:
                continue
            existing_indexes = {
                str(index.get("name") or "").strip().lower()
                for index in inspector.get_indexes(table_name, schema=schema)
            }
            for logical_name, accepted_names in sorted(required_indexes.items()):
                if not {item.lower() for item in accepted_names}.intersection(existing_indexes):
                    missing_indexes.append(f"{table_name}.{logical_name}")
    except ChatSchemaConfigurationError:
        raise
    except Exception as exc:
        raise ChatSchemaConfigurationError(
            "Production chat schema could not be inspected; "
            "verify CHAT_DATABASE_URL/APP_DATABASE_URL and backend Alembic migrations."
        ) from exc

    if missing_tables or missing_columns or missing_indexes:
        details: list[str] = []
        if missing_tables:
            details.append("missing tables: " + ", ".join(missing_tables))
        if missing_columns:
            details.append("missing columns: " + ", ".join(missing_columns))
        if missing_indexes:
            details.append("missing indexes: " + ", ".join(missing_indexes))
        raise ChatSchemaConfigurationError(
            "Production chat schema is incomplete; "
            "run backend Alembic migrations before startup. "
            + "; ".join(details)
        )


def _ensure_chat_conversation_columns(engine) -> None:
    inspector = inspect(engine)
    table_schema = _runtime_schema(engine)
    if not inspector.has_table("chat_conversations", schema=table_schema):
        return
    columns = {str(item.get("name")) for item in inspector.get_columns("chat_conversations", schema=table_schema)}
    statements: list[str] = []
    table_name = _qualified_table("chat_conversations", engine=engine)
    if "last_message_seq" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN last_message_seq BIGINT NOT NULL DEFAULT 0")
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        connection.execute(
            text(f"CREATE INDEX IF NOT EXISTS idx_chat_conversations_last_message_seq ON {table_name}(last_message_seq)")
        )
        if engine.dialect.name == "postgresql":
            message_table = _qualified_table("chat_messages", engine=engine)
            message_columns = {
                str(item.get("name"))
                for item in inspector.get_columns("chat_messages", schema=table_schema)
            }
            if "conversation_seq" not in message_columns:
                return
            connection.execute(
                text(
                    f"UPDATE {table_name} conv "
                    "SET last_message_seq = COALESCE(msg.max_seq, 0) "
                    f"FROM (SELECT conversation_id, MAX(conversation_seq) AS max_seq FROM {message_table} GROUP BY conversation_id) msg "
                    "WHERE conv.id = msg.conversation_id"
                )
            )


def _ensure_chat_message_columns(engine) -> None:
    inspector = inspect(engine)
    table_schema = _runtime_schema(engine)
    if not inspector.has_table("chat_messages", schema=table_schema):
        return
    columns = {str(item.get("name")) for item in inspector.get_columns("chat_messages", schema=table_schema)}
    statements: list[str] = []
    table_name = _qualified_table("chat_messages", engine=engine)
    if "kind" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN kind VARCHAR(20) NOT NULL DEFAULT 'text'")
    if "body_format" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN body_format VARCHAR(16) NOT NULL DEFAULT 'plain'")
    if "task_id" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN task_id VARCHAR(64)")
    if "task_preview_json" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN task_preview_json TEXT")
    if "conversation_seq" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN conversation_seq BIGINT NOT NULL DEFAULT 0")
    if "client_message_id" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN client_message_id VARCHAR(128)")
    if "reply_to_message_id" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN reply_to_message_id VARCHAR(36)")
    if "forward_from_message_id" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN forward_from_message_id VARCHAR(36)")
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        connection.execute(text(f"CREATE INDEX IF NOT EXISTS idx_chat_messages_task_id ON {table_name}(task_id)"))
        connection.execute(text(f"CREATE INDEX IF NOT EXISTS idx_chat_messages_body_format ON {table_name}(body_format)"))
        connection.execute(text(f"CREATE INDEX IF NOT EXISTS idx_chat_messages_client_message_id ON {table_name}(client_message_id)"))
        connection.execute(
            text(f"CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id_conversation_seq ON {table_name}(conversation_id, conversation_seq)")
        )
        connection.execute(
            text(f"CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to_message_id ON {table_name}(reply_to_message_id)")
        )
        connection.execute(
            text(f"CREATE INDEX IF NOT EXISTS idx_chat_messages_forward_from_message_id ON {table_name}(forward_from_message_id)")
        )
        if engine.dialect.name == "postgresql":
            connection.execute(
                text(
                    f"UPDATE {table_name} current_messages "
                    "SET conversation_seq = seq_table.row_num "
                    "FROM ("
                    f"SELECT id, ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at ASC, id ASC) AS row_num FROM {table_name}"
                    ") AS seq_table "
                    "WHERE current_messages.id = seq_table.id "
                    "AND COALESCE(current_messages.conversation_seq, 0) = 0"
                )
            )
        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_conversation_sender_client_message "
                f"ON {table_name}(conversation_id, sender_user_id, client_message_id)"
            )
        )
        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_conversation_seq "
                f"ON {table_name}(conversation_id, conversation_seq)"
            )
        )


def _ensure_chat_user_state_columns(engine) -> None:
    inspector = inspect(engine)
    table_schema = _runtime_schema(engine)
    if not inspector.has_table("chat_conversation_user_state", schema=table_schema):
        return
    columns = {
        str(item.get("name"))
        for item in inspector.get_columns("chat_conversation_user_state", schema=table_schema)
    }
    statements: list[str] = []
    table_name = _qualified_table("chat_conversation_user_state", engine=engine)
    if "is_archived" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE")
    if "last_read_seq" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN last_read_seq BIGINT NOT NULL DEFAULT 0")
    if "unread_count" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN unread_count INTEGER NOT NULL DEFAULT 0")
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        connection.execute(
            text(f"CREATE INDEX IF NOT EXISTS idx_chat_conversation_user_state_is_archived ON {table_name}(is_archived)")
        )
        connection.execute(
            text(f"CREATE INDEX IF NOT EXISTS idx_chat_conversation_user_state_last_read_seq ON {table_name}(last_read_seq)")
        )
        connection.execute(
            text(f"CREATE INDEX IF NOT EXISTS idx_chat_conversation_user_state_unread_count ON {table_name}(unread_count)")
        )
        if engine.dialect.name == "postgresql":
            message_table = _qualified_table("chat_messages", engine=engine)
            conversation_table = _qualified_table("chat_conversations", engine=engine)
            connection.execute(
                text(
                    f"UPDATE {table_name} state "
                    "SET last_read_seq = COALESCE(msg.conversation_seq, state.last_read_seq, 0) "
                    f"FROM {message_table} msg "
                    "WHERE state.last_read_message_id IS NOT NULL "
                    "AND msg.id = state.last_read_message_id "
                    "AND COALESCE(state.last_read_seq, 0) = 0"
                )
            )
            connection.execute(
                text(
                    f"UPDATE {table_name} state "
                    "SET unread_count = GREATEST(COALESCE(conv.last_message_seq, 0) - COALESCE(state.last_read_seq, 0), 0) "
                    f"FROM {conversation_table} conv "
                    "WHERE conv.id = state.conversation_id"
                )
            )


def _ensure_chat_attachment_columns(engine) -> None:
    inspector = inspect(engine)
    table_schema = _runtime_schema(engine)
    if not inspector.has_table("chat_message_attachments", schema=table_schema):
        return
    columns = {str(item.get("name")) for item in inspector.get_columns("chat_message_attachments", schema=table_schema)}
    statements: list[str] = []
    table_name = _qualified_table("chat_message_attachments", engine=engine)
    if "width" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN width INTEGER")
    if "height" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN height INTEGER")
    if "media_kind" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN media_kind VARCHAR(20)")
    if "duration_seconds" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN duration_seconds INTEGER")
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def _ensure_chat_reactions_table(engine) -> None:
    inspector = inspect(engine)
    table_schema = _runtime_schema(engine)
    table_name = _qualified_table("chat_message_reactions", engine=engine)
    if not inspector.has_table("chat_message_reactions", schema=table_schema):
        with engine.begin() as connection:
            connection.execute(text(
                f"CREATE TABLE IF NOT EXISTS {table_name} ("
                "id SERIAL PRIMARY KEY, "
                "message_id VARCHAR(36) NOT NULL, "
                "conversation_id VARCHAR(36) NOT NULL, "
                "user_id INTEGER NOT NULL, "
                "emoji VARCHAR(32) NOT NULL, "
                "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), "
                "CONSTRAINT uq_chat_message_reactions_message_user_emoji UNIQUE (message_id, user_id, emoji))"
            ))
            connection.execute(text(f"CREATE INDEX IF NOT EXISTS ix_chat_message_reactions_message_id ON {table_name}(message_id)"))
            connection.execute(text(f"CREATE INDEX IF NOT EXISTS ix_chat_message_reactions_user_id ON {table_name}(user_id)"))
            connection.execute(text(f"CREATE INDEX IF NOT EXISTS ix_chat_message_reactions_conversation_id ON {table_name}(conversation_id)"))
        return
    columns = {str(item.get("name")) for item in inspector.get_columns("chat_message_reactions", schema=table_schema)}
    statements: list[str] = []
    if "conversation_id" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(36) NOT NULL DEFAULT ''")
    if "emoji" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS emoji VARCHAR(32) NOT NULL DEFAULT ''")
    if "user_id" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS user_id INTEGER NOT NULL DEFAULT 0")
    if "message_id" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS message_id VARCHAR(36) NOT NULL DEFAULT ''")
    if "created_at" not in columns:
        statements.append(f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        if engine.dialect.name == "postgresql":
            connection.execute(text(f"ALTER TABLE {table_name} ALTER COLUMN reaction_emoji DROP NOT NULL") if "reaction_emoji" in columns else text("SELECT 1"))
            connection.execute(text(f"ALTER TABLE {table_name} ALTER COLUMN updated_at DROP NOT NULL") if "updated_at" in columns else text("SELECT 1"))
        connection.execute(text(f"CREATE INDEX IF NOT EXISTS ix_chat_message_reactions_message_id ON {table_name}(message_id)"))
        connection.execute(text(f"CREATE INDEX IF NOT EXISTS ix_chat_message_reactions_user_id ON {table_name}(user_id)"))
        connection.execute(text(f"CREATE INDEX IF NOT EXISTS ix_chat_message_reactions_conversation_id ON {table_name}(conversation_id)"))


def _runtime_schema(engine) -> str | None:
    if engine.dialect.name == "sqlite":
        return None
    schema_translate_map = engine.get_execution_options().get("schema_translate_map") or {}
    if CHAT_SCHEMA in schema_translate_map:
        return schema_translate_map.get(CHAT_SCHEMA)
    return CHAT_SCHEMA


def _should_use_legacy_public_chat_schema(engine) -> bool:
    if engine.dialect.name != "postgresql":
        return False
    inspector = inspect(engine)
    if inspector.has_table("chat_conversations", schema=CHAT_SCHEMA):
        return False
    return inspector.has_table("chat_conversations", schema=None)


def _uses_legacy_public_chat_schema(engine) -> bool:
    return engine.dialect.name == "postgresql" and _runtime_schema(engine) is None


def _qualified_table(table_name: str, *, engine=None) -> str:
    schema = CHAT_SCHEMA if engine is None else _runtime_schema(engine)
    if schema:
        return f"{schema}.{table_name}"
    return table_name


def ping_chat_database(database_url: str | None = None) -> None:
    with get_chat_engine(database_url).connect() as connection:
        connection.execute(text("SELECT 1"))
