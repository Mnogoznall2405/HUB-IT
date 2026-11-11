"""R31/R34/R36: re-binding of a disabled bot's conversation happens only on send, the bot user
becomes a chat member in the same step, and the answer is really saved (sqlite only)."""
from __future__ import annotations

import importlib
import os
import sys
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

pytestmark = pytest.mark.integration


def _configure(database_path: Path, monkeypatch) -> str:
    url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("APP_DATABASE_URL", url)
    monkeypatch.setenv("CHAT_DATABASE_URL", url)
    monkeypatch.setenv("CHAT_ENABLED", "1")
    cfg = importlib.import_module("backend.config")
    appdb = importlib.import_module("backend.appdb.db")
    chatdb = importlib.import_module("backend.chat.db")
    for obj, attr, val in [
        (cfg.config.app_db, "database_url", url),
        (cfg.config.chat, "database_url", url),
        (cfg.config.chat, "enabled", True),
        (appdb.config.app_db, "database_url", url),
        (chatdb.config.app_db, "database_url", url),
        (chatdb.config.chat, "database_url", url),
        (chatdb.config.chat, "enabled", True),
    ]:
        monkeypatch.setattr(obj, attr, val, raising=False)
    appdb._engines.clear()
    appdb._session_factories.clear()
    chatdb._engines.clear()
    chatdb._session_factories.clear()
    chatdb._read_engines.clear()
    chatdb._read_session_factories.clear()
    chatdb._engine = None
    chatdb._session_factory = None
    chatdb._read_engine = None
    chatdb._read_session_factory = None
    return url


class Env:
    pass


@pytest.fixture
def env(tmp_path, monkeypatch, prebuilt_chat_db):
    url = _configure(prebuilt_chat_db, monkeypatch)
    e = Env()
    e.url = url
    e.ai = importlib.import_module("backend.ai_chat.service")
    e.chat_mod = importlib.import_module("backend.chat.service")
    e.chat_db = importlib.import_module("backend.chat.db")
    e.chat_models = importlib.import_module("backend.chat.models")
    e.app_models = importlib.import_module("backend.appdb.models")
    e.appdb = importlib.import_module("backend.appdb.db")
    users_mod = importlib.import_module("backend.services.user_service")

    monkeypatch.setattr(e.chat_mod.hub_service, "data_dir", tmp_path, raising=False)
    e.users = users_mod.UserService(database_url=url)
    e.chat = e.chat_mod.ChatService()
    e.chat._attachments_root = tmp_path / "att"
    e.chat._attachments_root.mkdir()
    e.chat._upload_sessions_root = tmp_path / "up"
    e.chat._upload_sessions_root.mkdir()
    e.svc = e.ai.AiChatService()
    monkeypatch.setattr(e.ai, "user_service", e.users)
    monkeypatch.setattr(e.chat_mod, "user_service", e.users)
    monkeypatch.setattr(e.ai, "chat_service", e.chat)
    monkeypatch.setattr(
        e.ai.openrouter_client,
        "complete_json",
        lambda **kwargs: ({"answer_markdown": "Ответ нового ассистента", "artifacts": []}, {"output_tokens": 5}),
    )
    monkeypatch.setattr(
        e.ai.openrouter_client, "get_status", lambda: {"configured": True, "default_model": "openai/gpt-4o-mini"}
    )
    monkeypatch.setattr(e.ai.ai_kb_retrieval_service, "ensure_index_fresh", lambda **kwargs: None)
    monkeypatch.setattr(e.ai.ai_kb_retrieval_service, "retrieve", lambda **kwargs: [])
    e.actor = e.users.create_user(
        username="u1",
        password="secret-pass",
        role="viewer",
        auth_source="local",
        full_name="U1",
        is_active=True,
        use_custom_permissions=True,
        custom_permissions=["chat.read", "chat.write", "chat.ai.use"],
    )
    return e


def _retire(env, bot_id: str, slug: str = "legacy-retired") -> None:
    with env.appdb.app_session(env.url) as db:
        row = db.get(env.app_models.AppAiBot, bot_id)
        row.slug = slug
        row.is_enabled = False


def _members(env, conversation_id: str) -> dict[int, object]:
    with env.chat_db.chat_session(env.url) as db:
        rows = list(
            db.execute(
                select(env.chat_models.ChatMember).where(env.chat_models.ChatMember.conversation_id == conversation_id)
            ).scalars()
        )
        for row in rows:
            db.expunge(row)
        return {int(row.user_id): row for row in rows}


def _bot_user_id(env, bot_id: str) -> int:
    with env.appdb.app_session(env.url) as db:
        return int(db.get(env.app_models.AppAiBot, bot_id).bot_user_id)


def test_getter_is_pure_and_send_rebinds_with_membership_and_saves_bot_answer(env):
    actor_id = int(env.actor["id"])
    old = env.svc.ensure_default_bot()
    conv = env.svc.create_bot_conversation(bot_id=old["id"], current_user_id=actor_id)
    _retire(env, old["id"])
    new = env.svc.ensure_default_bot()
    assert new["id"] != old["id"]

    # The getter / is_ai_conversation / status are reads: nothing is re-bound.
    runtime = env.svc._get_runtime_by_conversation(conv["id"])
    assert runtime is not None and runtime.bot.id == old["id"]
    assert env.svc.is_ai_conversation(conv["id"]) is True
    status = env.svc.get_conversation_status(conversation_id=conv["id"], current_user_id=actor_id)
    assert status["server_now"]
    with env.appdb.app_session(env.url) as db:
        mapping = db.execute(
            select(env.app_models.AppAiBotConversation).where(
                env.app_models.AppAiBotConversation.conversation_id == conv["id"]
            )
        ).scalar_one()
        assert mapping.bot_id == old["id"]
    new_bot_user_id = _bot_user_id(env, new["id"])
    assert new_bot_user_id not in _members(env, conv["id"])

    # A new user message re-binds the conversation and makes the new bot a member.
    message = env.chat.send_message(
        current_user_id=actor_id,
        conversation_id=conv["id"],
        body="Привет",
        body_format="plain",
        defer_push_notifications=True,
    )
    queued = env.svc.queue_run_for_message(
        conversation_id=conv["id"], trigger_message_id=message["id"], current_user_id=actor_id
    )
    assert queued is not None and queued["status"] == "queued" and queued["bot_id"] == new["id"]
    with env.appdb.app_session(env.url) as db:
        mapping = db.execute(
            select(env.app_models.AppAiBotConversation).where(
                env.app_models.AppAiBotConversation.conversation_id == conv["id"]
            )
        ).scalar_one()
        assert mapping.bot_id == new["id"]
    members = _members(env, conv["id"])
    assert new_bot_user_id in members and members[new_bot_user_id].left_at is None
    assert members[new_bot_user_id].member_role == "bot"

    # Full path: the run is executed and the answer is saved by the new bot user.
    assert env.svc.process_next_run() is True
    final_status = env.svc.get_conversation_status(conversation_id=conv["id"], current_user_id=actor_id)
    assert final_status["status"] == "completed"
    with env.chat_db.chat_session(env.url) as db:
        messages = list(
            db.execute(
                select(env.chat_models.ChatMessage)
                .where(env.chat_models.ChatMessage.conversation_id == conv["id"])
                .order_by(env.chat_models.ChatMessage.conversation_seq.asc())
            ).scalars()
        )
    assert messages[-1].sender_user_id == new_bot_user_id
    assert messages[-1].body.startswith("Ответ нового ассистента")

    # Re-sending / retrying does not add a second membership row.
    assert sum(1 for uid in _members(env, conv["id"]) if uid == new_bot_user_id) == 1
    retried = env.svc.retry_conversation_run(conversation_id=conv["id"], current_user_id=actor_id)
    assert retried["status"] == "queued"
    assert env.svc.process_next_run() is True
    assert len([1 for uid in _members(env, conv["id"]) if uid == new_bot_user_id]) == 1


def test_ensure_bot_member_is_idempotent_and_resets_left_at(env):
    actor_id = int(env.actor["id"])
    bot = env.svc.ensure_default_bot()
    conv = env.svc.create_bot_conversation(bot_id=bot["id"], current_user_id=actor_id)
    # A second assistant's bot user, not yet in the conversation.
    with env.appdb.app_session(env.url) as db:
        other = env.app_models.AppAiBot(id="other-bot", slug="other-bot", title="Other")
        db.add(other)
        db.flush()
        other_user_id = env.svc._ensure_bot_user(session=db, bot=other)

    assert env.svc._ensure_bot_member(conversation_id=conv["id"], user_id=actor_id, bot_user_id=other_user_id) is True
    assert env.svc._ensure_bot_member(conversation_id=conv["id"], user_id=actor_id, bot_user_id=other_user_id) is False
    with env.chat_db.chat_session(env.url) as db:
        member = db.execute(
            select(env.chat_models.ChatMember).where(
                env.chat_models.ChatMember.conversation_id == conv["id"],
                env.chat_models.ChatMember.user_id == other_user_id,
            )
        ).scalar_one()
        member.left_at = datetime.now(timezone.utc)
    assert env.svc._ensure_bot_member(conversation_id=conv["id"], user_id=actor_id, bot_user_id=other_user_id) is True
    assert _members(env, conv["id"])[other_user_id].left_at is None


def test_sandbox_conversation_of_disabled_agent_is_read_only(env):
    actor_id = int(env.actor["id"])
    with env.appdb.app_session(env.url) as db:
        db.add(
            env.app_models.AppAiBot(
                id="oc", slug="opencode", title="OpenCode", surface="sandbox", is_enabled=False
            )
        )
        db.add(env.app_models.AppAiBotConversation(bot_id="oc", user_id=actor_id, conversation_id="conv-oc"))
    env.svc.ensure_default_bot()  # an enabled corp assistant exists, but must not take OpenCode over

    assert env.svc.is_ai_conversation("conv-oc") is True
    # New messages into the read-only conversation are rejected before they are saved.
    access = importlib.import_module("backend.ai_chat.access")
    with pytest.raises(PermissionError, match="Агент отключён администратором"):
        access.require_conversation_access("conv-oc", actor_id, require_mapping=True)
    assert (
        env.svc.queue_run_for_message(
            conversation_id="conv-oc", trigger_message_id="m1", current_user_id=actor_id
        )
        is None
    )
    with env.appdb.app_session(env.url) as db:
        mapping = db.execute(
            select(env.app_models.AppAiBotConversation).where(
                env.app_models.AppAiBotConversation.conversation_id == "conv-oc"
            )
        ).scalar_one()
        assert mapping.bot_id == "oc"
        assert db.execute(select(env.app_models.AppAiBotRun)).first() is None


def test_run_of_deactivated_employee_fails_with_clear_text(env):
    actor_id = int(env.actor["id"])
    bot = env.svc.ensure_default_bot()
    conv = env.svc.create_bot_conversation(bot_id=bot["id"], current_user_id=actor_id)
    message = env.chat.send_message(
        current_user_id=actor_id,
        conversation_id=conv["id"],
        body="Привет",
        body_format="plain",
        defer_push_notifications=True,
    )
    queued = env.svc.queue_run_for_message(
        conversation_id=conv["id"], trigger_message_id=message["id"], current_user_id=actor_id
    )
    assert queued["status"] == "queued"
    env.users.update_user(actor_id, is_active=False)  # same path as the admin UI (drops the identity cache)

    assert env.svc.process_next_run() is True
    status = env.svc.get_conversation_status(conversation_id=conv["id"], current_user_id=actor_id)
    assert status["status"] == "failed"
    assert status["error_text"] == "Сотрудник отключён"
    with env.chat_db.chat_session(env.url) as db:
        senders = [
            int(row.sender_user_id or 0)
            for row in db.execute(
                select(env.chat_models.ChatMessage).where(env.chat_models.ChatMessage.conversation_id == conv["id"])
            ).scalars()
        ]
    assert senders == [actor_id]  # no bot answer was produced


def test_merge_script_adds_bot_members_dry_run_counts_and_is_idempotent(env):
    actor_id = int(env.actor["id"])
    corp = env.svc.ensure_default_bot()
    corp_user_id = _bot_user_id(env, corp["id"])
    with env.appdb.app_session(env.url) as db:
        legacy = env.app_models.AppAiBot(id="legacy-general", slug="general-ai", title="General", surface="general")
        db.add(legacy)
        db.flush()
        env.svc._ensure_bot_user(session=db, bot=legacy)
    convs = [
        env.svc._create_bot_conversation(bot_id="legacy-general", current_user_id=actor_id, allow_hidden=True)
        for _ in range(2)
    ]
    for conv in convs:
        assert corp_user_id not in _members(env, conv["id"])

    merge = importlib.import_module("backend.scripts.merge_ai_bots_into_corp_assistant")
    dry = merge.run_merge(database_url=env.url, chat_database_url=env.url, apply=False, out=lambda *_: None)
    assert dry["planned_moves"] == 2 and dry["members_to_add"] == 2 and dry["members_added"] == 0
    for conv in convs:
        assert corp_user_id not in _members(env, conv["id"])

    applied = merge.run_merge(database_url=env.url, chat_database_url=env.url, apply=True, out=lambda *_: None)
    assert applied["moved"] == 2 and applied["members_added"] == 2
    for conv in convs:
        members = _members(env, conv["id"])
        assert corp_user_id in members and members[corp_user_id].left_at is None

    again = merge.run_merge(database_url=env.url, chat_database_url=env.url, apply=True, out=lambda *_: None)
    assert again["moved"] == 0 and again["members_added"] == 0


def test_status_marks_agent_read_only_only_when_nobody_can_take_over(env):
    actor_id = int(env.actor["id"])
    with env.appdb.app_session(env.url) as db:
        db.add(env.app_models.AppAiBotConversation(bot_id="ghost-bot", user_id=actor_id, conversation_id="conv-ghost"))

    no_assistant = env.svc.get_conversation_status(conversation_id="conv-ghost", current_user_id=actor_id)
    assert no_assistant["agent_read_only"] is True

    env.svc.ensure_default_bot()
    with_assistant = env.svc.get_conversation_status(conversation_id="conv-ghost", current_user_id=actor_id)
    assert with_assistant["agent_read_only"] is False


def test_ensure_bot_member_treats_unique_conflict_as_already_added(env, monkeypatch):
    """R42: the loser of a membership race must not fail the send."""
    actor_id = int(env.actor["id"])
    bot = env.svc.ensure_default_bot()
    conv = env.svc.create_bot_conversation(bot_id=bot["id"], current_user_id=actor_id)
    with env.appdb.app_session(env.url) as db:
        other = env.app_models.AppAiBot(id="race-bot", slug="race-bot", title="Race")
        db.add(other)
        db.flush()
        other_user_id = env.svc._ensure_bot_user(session=db, bot=other)
    # The winner of the race has already committed its INSERT ...
    assert env.svc._ensure_bot_member(conversation_id=conv["id"], user_id=actor_id, bot_user_id=other_user_id) is True

    # ... while this call still sees "no member yet" on its first read.
    real_chat_session = env.ai.chat_session

    class StaleFirstRead:
        def __init__(self, real):
            self._real = real
            self._stale = True

        def execute(self, statement, *args, **kwargs):
            if self._stale:
                self._stale = False

                class Empty:
                    @staticmethod
                    def scalar_one_or_none():
                        return None

                return Empty()
            return self._real.execute(statement, *args, **kwargs)

        def __getattr__(self, name):
            return getattr(self._real, name)

    from contextlib import contextmanager

    @contextmanager
    def racing_session(*args, **kwargs):
        with real_chat_session(*args, **kwargs) as real:
            yield StaleFirstRead(real)

    monkeypatch.setattr(env.ai, "chat_session", racing_session)
    assert env.svc._ensure_bot_member(conversation_id=conv["id"], user_id=actor_id, bot_user_id=other_user_id) is False
    monkeypatch.setattr(env.ai, "chat_session", real_chat_session)
    members = _members(env, conv["id"])
    assert other_user_id in members and members[other_user_id].left_at is None


def test_two_parallel_first_messages_after_rebind_create_two_runs(env):
    """R42: two near-simultaneous first messages of a re-bound conversation -> two runs, one membership."""
    import threading

    actor_id = int(env.actor["id"])
    old = env.svc.ensure_default_bot()
    conv = env.svc.create_bot_conversation(bot_id=old["id"], current_user_id=actor_id)
    _retire(env, old["id"])
    new = env.svc.ensure_default_bot()
    new_bot_user_id = _bot_user_id(env, new["id"])
    messages = [
        env.chat.send_message(
            current_user_id=actor_id,
            conversation_id=conv["id"],
            body=f"Сообщение {index}",
            body_format="plain",
            defer_push_notifications=True,
        )
        for index in range(2)
    ]
    barrier = threading.Barrier(2)
    results: list[object] = []

    def worker(message_id: str) -> None:
        barrier.wait()
        try:
            results.append(
                env.svc.queue_run_for_message(
                    conversation_id=conv["id"], trigger_message_id=message_id, current_user_id=actor_id
                )
            )
        except Exception as exc:  # noqa: BLE001 - the test reports whatever escaped
            results.append(exc)

    threads = [threading.Thread(target=worker, args=(item["id"],)) for item in messages]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)

    assert not [item for item in results if isinstance(item, Exception)], results
    assert sorted(item["trigger_message_id"] for item in results) == sorted(item["id"] for item in messages)
    with env.appdb.app_session(env.url) as db:
        runs = list(db.execute(select(env.app_models.AppAiBotRun)).scalars())
    assert len(runs) == 2 and {run.bot_id for run in runs} == {new["id"]}
    assert sum(1 for uid in _members(env, conv["id"]) if uid == new_bot_user_id) == 1


def test_conversation_of_deleted_opencode_bot_stays_read_only(env):
    """R43: with the bot row gone, a sandbox session is the only trace of the OpenCode surface."""
    actor_id = int(env.actor["id"])
    sandbox_models = importlib.import_module("backend.ai_sandbox.models")
    now = datetime.now(timezone.utc)
    with env.appdb.app_session(env.url) as db:
        db.add(env.app_models.AppAiBotConversation(bot_id="oc-gone", user_id=actor_id, conversation_id="conv-oc-gone"))
        db.add(
            sandbox_models.AppAiSandboxSession(
                id="sbx-1",
                conversation_id="conv-oc-gone",
                user_id=actor_id,
                workspace_key="ws-conv-oc-gone",
                status="stopped",
                expires_at=now,
            )
        )
    env.svc.ensure_default_bot()  # an enabled corp assistant exists, but must not take OpenCode over

    runtime = env.svc._get_runtime_by_conversation("conv-oc-gone")
    assert runtime is not None and runtime.bot.surface == "sandbox" and runtime.bot.is_enabled is False
    status = env.svc.get_conversation_status(conversation_id="conv-oc-gone", current_user_id=actor_id)
    assert status["agent_read_only"] is True
    with env.appdb.app_session(env.url) as db:
        mapping = db.execute(
            select(env.app_models.AppAiBotConversation).where(
                env.app_models.AppAiBotConversation.conversation_id == "conv-oc-gone"
            )
        ).scalar_one()
        assert mapping.bot_id == "oc-gone"
    # Cancel is a harmless read of the same state, and the chat can still be deleted.
    cancelled = env.svc.cancel_active_run(conversation_id="conv-oc-gone", current_user_id=actor_id)
    assert cancelled["agent_read_only"] is True
    assert env.svc.is_ai_conversation("conv-oc-gone") is True
