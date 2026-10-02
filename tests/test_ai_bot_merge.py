"""AG-3: тесты скрипта merge_ai_bots_into_corp_assistant (sqlite, без внешних сервисов)."""
from __future__ import annotations

import importlib
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import select

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("ENVIRONMENT", "development")

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def _configure_app_db(tmp_path: Path, monkeypatch, name: str = "ai_bot_merge.db") -> str:
    database_url = f"sqlite:///{(tmp_path / name).as_posix()}"
    monkeypatch.setenv("APP_DATABASE_URL", database_url)
    monkeypatch.setenv("CHAT_DATABASE_URL", database_url)
    monkeypatch.setenv("CHAT_ENABLED", "1")

    backend_config = importlib.import_module("backend.config")
    appdb_db = importlib.import_module("backend.appdb.db")
    chat_db = importlib.import_module("backend.chat.db")
    for obj, attr, val in [
        (backend_config.config.app_db, "database_url", database_url),
        (backend_config.config.chat, "database_url", database_url),
        (backend_config.config.chat, "enabled", True),
        (appdb_db.config.app_db, "database_url", database_url),
        (chat_db.config.app_db, "database_url", database_url),
        (chat_db.config.chat, "database_url", database_url),
        (chat_db.config.chat, "enabled", True),
    ]:
        monkeypatch.setattr(obj, attr, val, raising=False)
    appdb_db._engines.clear()
    appdb_db._session_factories.clear()
    appdb_db._initialized_schema_urls.clear()
    chat_db._engines.clear()
    chat_db._session_factories.clear()
    chat_db._read_engines.clear()
    chat_db._read_session_factories.clear()
    chat_db._engine = None
    chat_db._session_factory = None
    chat_db._read_engine = None
    chat_db._read_session_factory = None
    return database_url


def _bot(*, slug: str, enabled: bool = True, placement: str = "pinned"):
    from backend.appdb.models import AppAiBot

    now = datetime.now(timezone.utc)
    return AppAiBot(
        id=str(uuid.uuid4()),
        slug=slug,
        title=slug,
        description="",
        system_prompt="",
        model="m",
        temperature=0.2,
        max_tokens=1000,
        allowed_kb_scope_json="[]",
        enabled_tools_json="[]",
        tool_settings_json="{}",
        is_enabled=enabled,
        placement=placement,
        created_at=now,
        updated_at=now,
    )


def _mapping(*, bot_id: str, user_id: int, conversation_id: str):
    from backend.appdb.models import AppAiBotConversation

    now = datetime.now(timezone.utc)
    return AppAiBotConversation(
        bot_id=bot_id,
        user_id=user_id,
        conversation_id=conversation_id,
        created_at=now,
        updated_at=now,
    )


def _seed(tmp_path, monkeypatch) -> dict:
    database_url = _configure_app_db(tmp_path, monkeypatch)
    appdb_db = importlib.import_module("backend.appdb.db")
    models = importlib.import_module("backend.appdb.models")
    appdb_db.ensure_app_schema_initialized(database_url)
    importlib.import_module("backend.chat.db").initialize_chat_schema(database_url)
    corp = _bot(slug="corp-assistant")
    corp.bot_user_id = 900  # R31: the corp-assistant bot user that must join the moved chats
    bots = {
        "corp": corp,
        "general": _bot(slug="general-ai"),
        "doc": _bot(slug="document-converter"),
        "opencode": _bot(slug="opencode"),
    }
    with appdb_db.app_session(database_url) as session:
        session.add(models.AppUser(id=900, username="bot-corp-assistant", role="viewer", is_active=True))
        session.add_all(bots.values())
        session.add_all(
            [
                _mapping(bot_id=bots["general"].id, user_id=1, conversation_id="conv-g1"),
                _mapping(bot_id=bots["general"].id, user_id=2, conversation_id="conv-g2"),
                _mapping(bot_id=bots["doc"].id, user_id=1, conversation_id="conv-d1"),
                _mapping(bot_id=bots["corp"].id, user_id=1, conversation_id="conv-c1"),
                _mapping(bot_id=bots["opencode"].id, user_id=1, conversation_id="conv-oc"),
            ]
        )
    return {"url": database_url, "bots": bots, "models": models, "db": appdb_db}


def test_merge_dry_run_changes_nothing(tmp_path, monkeypatch):
    env = _seed(tmp_path, monkeypatch)
    merge = importlib.import_module("backend.scripts.merge_ai_bots_into_corp_assistant")

    summary = merge.run_merge(database_url=env["url"], chat_database_url=env["url"], apply=False)
    assert summary["planned_moves"] == 3
    assert summary["moved"] == 0
    # The seeded mappings have no chat conversations: dry-run reports them as orphans, adds nobody.
    assert summary["members_to_add"] == 0
    assert summary["orphan_conversations"] == 3

    with env["db"].app_session(env["url"]) as session:
        rows = session.execute(select(env["models"].AppAiBotConversation)).scalars().all()
        by_conv = {r.conversation_id: r.bot_id for r in rows}
        assert by_conv["conv-g1"] == env["bots"]["general"].id
        general = session.execute(
            select(env["models"].AppAiBot).where(env["models"].AppAiBot.slug == "general-ai")
        ).scalar_one()
        assert general.is_enabled is True


def test_merge_apply_rebinds_and_disables(tmp_path, monkeypatch):
    env = _seed(tmp_path, monkeypatch)
    merge = importlib.import_module("backend.scripts.merge_ai_bots_into_corp_assistant")

    summary = merge.run_merge(database_url=env["url"], chat_database_url=env["url"], apply=True, batch_size=2)
    assert summary["moved"] == 3
    assert summary["bots_disabled"] == 2

    with env["db"].app_session(env["url"]) as session:
        rows = session.execute(select(env["models"].AppAiBotConversation)).scalars().all()
        by_conv = {r.conversation_id: r.bot_id for r in rows}
        corp_id = env["bots"]["corp"].id
        assert by_conv["conv-g1"] == corp_id
        assert by_conv["conv-g2"] == corp_id
        assert by_conv["conv-d1"] == corp_id
        # corp-диалог и OpenCode не тронуты
        assert by_conv["conv-c1"] == corp_id
        assert by_conv["conv-oc"] == env["bots"]["opencode"].id

        bots = {b.slug: b for b in session.execute(select(env["models"].AppAiBot)).scalars()}
        for slug in ("general-ai", "document-converter"):
            assert bots[slug].is_enabled is False
            assert bots[slug].placement == "hidden"
        # OpenCode отдельно — не тронут
        assert bots["opencode"].is_enabled is True
        assert bots["corp-assistant"].is_enabled is True


def test_merge_is_idempotent(tmp_path, monkeypatch):
    env = _seed(tmp_path, monkeypatch)
    merge = importlib.import_module("backend.scripts.merge_ai_bots_into_corp_assistant")

    merge.run_merge(database_url=env["url"], chat_database_url=env["url"], apply=True)
    second = merge.run_merge(database_url=env["url"], chat_database_url=env["url"], apply=True)
    assert second["moved"] == 0
    assert second["planned_moves"] == 0
    assert second["bots_disabled"] == 0
