"""PG startup must not emit DDL in either legacy/public or native schema mode.

SQLite/browser E2E cannot expose this dialect-specific deployment safety guard.
Every mutating boundary raises: the test cannot accidentally reach a real DB.
"""
from types import SimpleNamespace

import pytest


@pytest.mark.parametrize("production,allow_create", [(True, "1"), (False, "0")])
@pytest.mark.parametrize("missing_schema", [False, True])
@pytest.mark.parametrize("legacy", [False, True])
def test_postgres_startup_checks_schema_and_never_repairs_it(monkeypatch, production, allow_create, missing_schema, legacy):
    from backend.chat import db

    engine = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
    monkeypatch.setenv("APP_SCHEMA_DEV_AUTO_CREATE", allow_create)
    monkeypatch.setattr(db, "config", SimpleNamespace(app=SimpleNamespace(is_production=production)))
    monkeypatch.setattr(db, "get_chat_engine", lambda url: engine)
    monkeypatch.setattr(db, "ensure_chat_configured", lambda url: "postgresql://isolated-fixture")
    checked = []
    monkeypatch.setattr(db, "check_internal_database_revision", lambda *a, **kw: checked.append("revision"))

    def verify(_engine):
        if missing_schema:
            raise db.ChatSchemaConfigurationError("missing schema")
        checked.append("schema")

    monkeypatch.setattr(db, "_verify_production_schema", verify)

    def forbidden(*args, **kwargs):
        raise AssertionError("startup crossed a migration/DDL boundary")

    monkeypatch.setattr(db, "upgrade_internal_database", forbidden)
    monkeypatch.setattr(db.Base.metadata, "create_all", forbidden)
    monkeypatch.setattr(db, "_uses_legacy_public_chat_schema", lambda engine: legacy)
    for name in ("_ensure_chat_attachment_preview_table", "_ensure_chat_reactions_table",
                 "_ensure_chat_mentions_table", "_ensure_chat_message_columns",
                 "_ensure_chat_conversation_columns", "_ensure_chat_user_state_columns",
                 "_ensure_chat_attachment_columns", "_ensure_chat_push_outbox_columns"):
        monkeypatch.setattr(db, name, forbidden)
    if missing_schema:
        with pytest.raises(db.ChatSchemaConfigurationError, match="missing schema"):
            db.initialize_chat_schema("postgresql://isolated-fixture")
        assert checked == ["revision"]
    else:
        db.initialize_chat_schema("postgresql://isolated-fixture")
        assert checked == ["revision", "schema"]
