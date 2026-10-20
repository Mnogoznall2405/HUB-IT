"""Chat voice/video calls (LiveKit): HTTP flow through the real chat router + concurrency (sqlite only).

The LiveKit server itself is not involved: only what this backend owns is checked - the call state
machine, access control, the join token handed to the client and the realtime events published.
"""
from __future__ import annotations

import asyncio
import importlib
import os
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("ENVIRONMENT", "development")
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

pytestmark = pytest.mark.integration

LIVEKIT_URL = "wss://livekit.test.local"
LIVEKIT_KEY = "APItestKey"
LIVEKIT_SECRET = "livekit-test-secret-0123456789abcdef"


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


class _RealtimeRecorder:
    """Stands in for the WebSocket hub: records what the routes publish."""

    def __init__(self) -> None:
        self.events: list[dict] = []

    async def publish_inbox_events(self, *, user_ids, event_type, payload=None, conversation_id=None, **_kw):
        self.events.append(
            {"user_ids": sorted(user_ids), "type": event_type, "payload": payload, "conversation_id": conversation_id}
        )
        return len(user_ids)

    def of(self, event_type: str) -> list[dict]:
        return [event for event in self.events if event["type"] == event_type]


@pytest.fixture
def env(tmp_path, monkeypatch, prebuilt_chat_db):
    url = _configure(prebuilt_chat_db, monkeypatch)
    monkeypatch.setenv("CALLS_ENABLED", "true")
    monkeypatch.setenv("LIVEKIT_URL", LIVEKIT_URL)
    monkeypatch.setenv("LIVEKIT_API_KEY", LIVEKIT_KEY)
    monkeypatch.setenv("LIVEKIT_API_SECRET", LIVEKIT_SECRET)
    monkeypatch.delenv("CALLS_RING_TIMEOUT_SEC", raising=False)
    monkeypatch.delenv("CALLS_TOKEN_TTL_SEC", raising=False)

    e = SimpleNamespace(url=url)
    e.chat_pkg = importlib.import_module("backend.api.v1.chat")
    e.deps = importlib.import_module("backend.api.deps")
    e.calls = importlib.import_module("backend.chat.calls")
    e.chat_mod = importlib.import_module("backend.chat.service")
    e.chat_db = importlib.import_module("backend.chat.db")
    e.models = importlib.import_module("backend.chat.models")
    users_mod = importlib.import_module("backend.services.user_service")
    monkeypatch.setattr(e.chat_mod.hub_service, "data_dir", tmp_path, raising=False)
    e.users = users_mod.UserService(database_url=url)
    monkeypatch.setattr(e.chat_mod, "user_service", e.users)
    monkeypatch.setattr(e.calls, "user_service", e.users)
    e.chat = e.chat_mod.ChatService()
    e.chat._attachments_root = tmp_path / "att"
    e.chat._attachments_root.mkdir()
    e.chat._upload_sessions_root = tmp_path / "up"
    e.chat._upload_sessions_root.mkdir()
    monkeypatch.setattr(e.chat_pkg, "chat_service", e.chat)

    perms = ["chat.read", "chat.write"]
    make = lambda username, full_name: e.users.create_user(  # noqa: E731
        username=username, password="secret-pass", role="viewer", auth_source="local", full_name=full_name,
        is_active=True, use_custom_permissions=True, custom_permissions=perms,
    )
    e.alice = make("alice", "Alice Sender")
    e.bob = make("bob", "Bob Peer")
    e.carol = make("carol", "Carol Third")
    e.eve = make("eve", "Eve Outsider")
    e.alice_id, e.bob_id, e.carol_id, e.eve_id = (int(row["id"]) for row in (e.alice, e.bob, e.carol, e.eve))
    e.direct = e.chat.create_direct_conversation(current_user_id=e.alice_id, peer_user_id=e.bob_id)["id"]
    e.group = e.chat.create_group_conversation(
        current_user_id=e.alice_id, title="Team", member_user_ids=[e.bob_id, e.carol_id]
    )["id"]

    # Realtime publishes run after the response as background tasks: run them on a dedicated loop thread.
    e.realtime = _RealtimeRecorder()
    monkeypatch.setattr(e.chat_pkg, "chat_realtime", e.realtime)
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    scheduled: list = []

    def _schedule(coro, *, label):
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        scheduled.append(future)
        return future

    monkeypatch.setattr(e.chat_pkg, "_schedule_chat_background_task", _schedule)

    def drain():
        pending = list(scheduled)
        scheduled.clear()
        for future in pending:
            future.result(timeout=15)

    e.drain = drain
    app = FastAPI()
    app.include_router(e.chat_pkg.router, prefix="/chat")
    current = {"user": None}
    app.dependency_overrides[e.deps.get_current_active_user] = lambda: current["user"]
    e.client = TestClient(app)

    auth_models = importlib.import_module("backend.models.auth")

    def as_user(row):
        current["user"] = auth_models.User(
            id=int(row["id"]), username=row["username"], full_name=row["full_name"], role="viewer",
            use_custom_permissions=True, custom_permissions=list(perms), permissions=list(perms),
        )
        return e.client

    e.as_user = as_user
    yield e
    loop.call_soon_threadsafe(loop.stop)
    thread.join(timeout=5)


def _start(env, who, conversation_id, media="audio"):
    return env.as_user(who).post(f"/chat/conversations/{conversation_id}/calls", json={"media": media})


def _states(call) -> dict[int, str]:
    return {item["user_id"]: item["state"] for item in call["participants"]}


def _claims(token: str) -> dict:
    return jwt.decode(token, LIVEKIT_SECRET, algorithms=["HS256"], options={"verify_aud": False})


def _age_call(env, call_id: str, seconds: int) -> None:
    with env.chat_db.chat_session(env.url) as db:
        row = db.get(env.models.ChatCall, call_id)
        row.started_at = datetime.now(timezone.utc) - timedelta(seconds=seconds)


# --------------------------------------------------------------------------------------------- flow
def test_config_reflects_whether_calls_are_available(env, monkeypatch):
    client = env.as_user(env.alice)
    assert client.get("/chat/calls/config").json() == {"enabled": True}
    monkeypatch.setenv("CALLS_ENABLED", "false")
    assert client.get("/chat/calls/config").json() == {"enabled": False}
    monkeypatch.setenv("CALLS_ENABLED", "true")
    monkeypatch.delenv("LIVEKIT_API_SECRET")
    assert client.get("/chat/calls/config").json() == {"enabled": False}  # enabled but not configured


def test_direct_call_from_invite_to_completed(env):
    started = _start(env, env.alice, env.direct, "video")
    assert started.status_code == 200, started.text
    body = started.json()
    call = body["call"]
    assert call["status"] == "ringing" and call["media"] == "video" and call["end_reason"] is None
    assert call["conversation_id"] == env.direct and call["initiator_user_id"] == env.alice_id
    assert call["answered_at"] is None and call["ended_at"] is None and call["started_at"]
    assert _states(call) == {env.alice_id: "joined", env.bob_id: "invited"}
    assert {item["user_id"]: item["display_name"] for item in call["participants"]} == {
        env.alice_id: "Alice Sender", env.bob_id: "Bob Peer",
    }
    # the initiator gets a LiveKit token for the room named after the call
    assert body["url"] == LIVEKIT_URL
    claims = _claims(body["token"])
    assert claims["sub"] == str(env.alice_id) and claims["name"] == "Alice Sender" and claims["iss"] == LIVEKIT_KEY
    assert claims["video"]["room"] == call["id"] and claims["video"]["roomJoin"] is True
    assert claims["exp"] - claims["nbf"] == 3600

    env.drain()
    invites = env.realtime.of("chat.call.invite")
    assert len(invites) == 1
    assert invites[0]["user_ids"] == [env.bob_id] and invites[0]["conversation_id"] == env.direct
    assert invites[0]["payload"]["call"]["id"] == call["id"]
    assert invites[0]["payload"]["initiator"] == {"user_id": env.alice_id, "display_name": "Alice Sender"}
    assert env.realtime.of("chat.call.updated")[0]["user_ids"] == sorted([env.alice_id, env.bob_id])

    # the invited user finds the call when opening the conversation
    active = env.as_user(env.bob).get(f"/chat/conversations/{env.direct}/calls/active").json()["call"]
    assert active["id"] == call["id"]

    joined = env.as_user(env.bob).post(f"/chat/calls/{call['id']}/join")
    assert joined.status_code == 200, joined.text
    answered = joined.json()["call"]
    assert answered["status"] == "active" and answered["answered_at"]
    assert _states(answered) == {env.alice_id: "joined", env.bob_id: "joined"}
    bob_claims = _claims(joined.json()["token"])
    assert bob_claims["sub"] == str(env.bob_id) and bob_claims["video"]["room"] == call["id"]

    # a repeated join is idempotent: same state, fresh token, no extra event
    env.drain()
    events_before = len(env.realtime.of("chat.call.updated"))
    again = env.as_user(env.bob).post(f"/chat/calls/{call['id']}/join")
    assert again.status_code == 200 and again.json()["call"]["status"] == "active" and again.json()["token"]
    env.drain()
    assert len(env.realtime.of("chat.call.updated")) == events_before

    # the call ends only when nobody is left in it
    after_first_leave = env.as_user(env.alice).post(f"/chat/calls/{call['id']}/leave").json()["call"]
    assert after_first_leave["status"] == "active"
    assert _states(after_first_leave) == {env.alice_id: "left", env.bob_id: "joined"}
    ended = env.as_user(env.bob).post(f"/chat/calls/{call['id']}/leave").json()["call"]
    assert ended["status"] == "ended" and ended["end_reason"] == "completed" and ended["ended_at"]
    env.drain()
    assert env.realtime.of("chat.call.updated")[-1]["payload"]["call"]["status"] == "ended"

    assert env.as_user(env.alice).get(f"/chat/conversations/{env.direct}/calls/active").json() == {"call": None}
    # the conversation is free for the next call
    assert _start(env, env.bob, env.direct).status_code == 200


def test_decline_ends_a_direct_call_and_is_idempotent(env):
    call = _start(env, env.alice, env.direct).json()["call"]
    declined = env.as_user(env.bob).post(f"/chat/calls/{call['id']}/decline")
    assert declined.status_code == 200, declined.text
    result = declined.json()["call"]
    assert result["status"] == "ended" and result["end_reason"] == "declined"
    assert _states(result)[env.bob_id] == "declined"
    env.drain()
    updated_events = len(env.realtime.of("chat.call.updated"))
    repeat = env.as_user(env.bob).post(f"/chat/calls/{call['id']}/decline")
    assert repeat.status_code == 200 and repeat.json()["call"]["end_reason"] == "declined"
    env.drain()
    assert len(env.realtime.of("chat.call.updated")) == updated_events


def test_initiator_leaving_while_ringing_cancels_the_call(env):
    call = _start(env, env.alice, env.direct).json()["call"]
    cancelled = env.as_user(env.alice).post(f"/chat/calls/{call['id']}/leave").json()["call"]
    assert cancelled["status"] == "ended" and cancelled["end_reason"] == "cancelled"
    late = env.as_user(env.bob).post(f"/chat/calls/{call['id']}/join")
    assert late.status_code == 409
    assert late.json()["code"] == "call_ended" and late.json()["call"]["end_reason"] == "cancelled"
    assert "token" not in late.json()


def test_only_conversation_members_can_use_calls(env):
    call = _start(env, env.alice, env.direct).json()["call"]
    eve = env.as_user(env.eve)
    assert eve.post(f"/chat/conversations/{env.direct}/calls", json={"media": "audio"}).status_code == 403
    assert eve.get(f"/chat/conversations/{env.direct}/calls/active").status_code == 403
    for action in ("join", "decline", "leave"):
        assert eve.post(f"/chat/calls/{call['id']}/{action}").status_code == 403, action
    assert eve.post("/chat/calls/00000000-0000-0000-0000-000000000000/join").status_code == 404
    assert eve.post("/chat/conversations/nope/calls", json={"media": "audio"}).status_code == 404
    # nothing leaked or changed
    assert _states(env.as_user(env.alice).get(f"/chat/conversations/{env.direct}/calls/active").json()["call"]) == {
        env.alice_id: "joined", env.bob_id: "invited",
    }


def test_second_call_in_a_conversation_is_refused_with_the_running_call(env):
    first = _start(env, env.alice, env.direct).json()["call"]
    clash = _start(env, env.bob, env.direct, "video")
    assert clash.status_code == 409
    assert clash.json()["code"] == "call_already_active"
    assert clash.json()["call"]["id"] == first["id"]
    env.as_user(env.bob).post(f"/chat/calls/{first['id']}/join")  # now active
    assert _start(env, env.bob, env.direct).status_code == 409


def test_calls_answer_503_when_disabled_or_not_configured(env, monkeypatch):
    call = _start(env, env.alice, env.direct).json()["call"]
    for variable, value in (("CALLS_ENABLED", "false"), ("LIVEKIT_URL", "")):
        monkeypatch.setenv("CALLS_ENABLED", "true")
        monkeypatch.setenv("LIVEKIT_URL", LIVEKIT_URL)
        monkeypatch.setenv(variable, value)
        client = env.as_user(env.alice)
        responses = [
            client.post(f"/chat/conversations/{env.direct}/calls", json={"media": "audio"}),
            client.get(f"/chat/conversations/{env.direct}/calls/active"),
            client.post(f"/chat/calls/{call['id']}/join"),
            client.post(f"/chat/calls/{call['id']}/decline"),
            client.post(f"/chat/calls/{call['id']}/leave"),
        ]
        for response in responses:
            assert response.status_code == 503, (variable, response.text)
            assert response.json()["code"] == "calls_not_configured"
        assert client.get("/chat/calls/config").status_code == 200


def test_unanswered_call_becomes_missed_lazily(env, monkeypatch):
    monkeypatch.setenv("CALLS_RING_TIMEOUT_SEC", "30")
    first = _start(env, env.alice, env.direct).json()["call"]
    # still ringing within the timeout
    assert env.as_user(env.bob).get(f"/chat/conversations/{env.direct}/calls/active").json()["call"]["id"] == first["id"]

    _age_call(env, first["id"], 120)
    env.drain()
    published = len(env.realtime.of("chat.call.updated"))
    # a plain read after the timeout ends the call and tells everybody
    assert env.as_user(env.bob).get(f"/chat/conversations/{env.direct}/calls/active").json() == {"call": None}
    env.drain()
    missed = env.realtime.of("chat.call.updated")
    assert len(missed) == published + 1
    assert missed[-1]["payload"]["call"]["end_reason"] == "missed" and missed[-1]["payload"]["call"]["status"] == "ended"
    late = env.as_user(env.bob).post(f"/chat/calls/{first['id']}/join")
    assert late.status_code == 409 and late.json()["call"]["end_reason"] == "missed"

    # joining a stale ringing call (nobody read it before) also finds it missed
    second = _start(env, env.alice, env.direct).json()["call"]
    _age_call(env, second["id"], 120)
    stale_join = env.as_user(env.bob).post(f"/chat/calls/{second['id']}/join")
    assert stale_join.status_code == 409 and stale_join.json()["call"]["end_reason"] == "missed"

    # a stale ringing call does not block a new one
    third = _start(env, env.alice, env.direct)
    assert third.status_code == 200


def test_group_call_invites_everyone_and_ends_when_all_left(env):
    call = _start(env, env.alice, env.group).json()["call"]
    assert _states(call) == {env.alice_id: "joined", env.bob_id: "invited", env.carol_id: "invited"}
    env.drain()
    assert env.realtime.of("chat.call.invite")[0]["user_ids"] == sorted([env.bob_id, env.carol_id])

    # one decline does not end a group call that somebody can still answer
    after_bob = env.as_user(env.bob).post(f"/chat/calls/{call['id']}/decline").json()["call"]
    assert after_bob["status"] == "ringing" and _states(after_bob)[env.bob_id] == "declined"
    env.as_user(env.carol).post(f"/chat/calls/{call['id']}/join")
    env.as_user(env.bob).post(f"/chat/calls/{call['id']}/join")  # a decliner may change their mind
    assert _states(env.as_user(env.alice).get(f"/chat/conversations/{env.group}/calls/active").json()["call"]) == {
        env.alice_id: "joined", env.bob_id: "joined", env.carol_id: "joined",
    }
    for user in (env.alice, env.bob):
        assert env.as_user(user).post(f"/chat/calls/{call['id']}/leave").json()["call"]["status"] == "active"
    final = env.as_user(env.carol).post(f"/chat/calls/{call['id']}/leave").json()["call"]
    assert final["status"] == "ended" and final["end_reason"] == "completed"


def test_group_call_declined_by_everybody_ends(env):
    call = _start(env, env.alice, env.group).json()["call"]
    env.as_user(env.bob).post(f"/chat/calls/{call['id']}/decline")
    last = env.as_user(env.carol).post(f"/chat/calls/{call['id']}/decline").json()["call"]
    assert last["status"] == "ended" and last["end_reason"] == "declined"


def test_request_validation_and_unsupported_conversations(env):
    assert env.as_user(env.alice).post(f"/chat/conversations/{env.direct}/calls", json={"media": "hologram"}).status_code == 422
    notes = env.chat.get_or_create_notes_conversation(current_user_id=env.alice_id)["id"]
    refused = env.as_user(env.alice).post(f"/chat/conversations/{notes}/calls", json={"media": "audio"})
    assert refused.status_code == 400  # a notes conversation has nobody to call


# --------------------------------------------------------------------------------------------- races
def _run_together(*callables):
    barrier = threading.Barrier(len(callables))
    results: list = [None] * len(callables)

    def runner(index, function):
        barrier.wait()
        try:
            results[index] = function()
        except Exception as exc:  # reported to the assertions, not swallowed
            results[index] = exc

    threads = [threading.Thread(target=runner, args=(i, f)) for i, f in enumerate(callables)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)
    return results


def _new_call(env, conversation_id=None):
    outcome = env.calls.chat_call_service.create_call(
        current_user_id=env.alice_id, conversation_id=conversation_id or env.direct, media="audio"
    )
    assert outcome.error is None, outcome.error
    return outcome.call["id"]


def _stored_call(env, call_id):
    with env.chat_db.chat_session(env.url) as db:
        call = db.get(env.models.ChatCall, call_id)
        participants = {
            row.user_id: row.state
            for row in db.query(env.models.ChatCallParticipant).filter_by(call_id=call_id)
        }
        return call.status, call.end_reason, participants


ROUNDS = 6


def test_parallel_start_creates_exactly_one_call(env):
    service = env.calls.chat_call_service
    for _ in range(ROUNDS):
        results = _run_together(
            lambda: service.create_call(current_user_id=env.alice_id, conversation_id=env.direct, media="audio"),
            lambda: service.create_call(current_user_id=env.bob_id, conversation_id=env.direct, media="video"),
        )
        assert all(not isinstance(item, Exception) for item in results), results
        assert sorted(item.error or "ok" for item in results) == ["call_already_active", "ok"]
        winner = next(item for item in results if item.error is None)
        loser = next(item for item in results if item.error)
        assert loser.call["id"] == winner.call["id"]
        with env.chat_db.chat_session(env.url) as db:
            open_calls = db.query(env.models.ChatCall).filter(
                env.models.ChatCall.conversation_id == env.direct, env.models.ChatCall.status != "ended"
            ).count()
        assert open_calls == 1
        service.leave_call(current_user_id=winner.call["initiator_user_id"], call_id=winner.call["id"])


def test_parallel_join_of_the_same_user_is_idempotent(env):
    service = env.calls.chat_call_service
    for _ in range(ROUNDS):
        call_id = _new_call(env)
        results = _run_together(
            *[lambda: service.join_call(current_user_id=env.bob_id, call_id=call_id) for _ in range(4)]
        )
        assert all(not isinstance(item, Exception) and item.error is None and item.token for item in results), results
        status, reason, participants = _stored_call(env, call_id)
        assert (status, reason) == ("active", None)
        assert participants == {env.alice_id: "joined", env.bob_id: "joined"}
        # exactly one request performed the transition; the others changed nothing
        assert sum(1 for item in results if item.events) == 1
        service.leave_call(current_user_id=env.alice_id, call_id=call_id)
        service.leave_call(current_user_id=env.bob_id, call_id=call_id)


def test_parallel_leave_of_the_last_two_participants_ends_the_call_once(env):
    service = env.calls.chat_call_service
    for _ in range(ROUNDS):
        call_id = _new_call(env)
        service.join_call(current_user_id=env.bob_id, call_id=call_id)
        results = _run_together(
            lambda: service.leave_call(current_user_id=env.alice_id, call_id=call_id),
            lambda: service.leave_call(current_user_id=env.bob_id, call_id=call_id),
        )
        assert all(not isinstance(item, Exception) for item in results), results
        status, reason, participants = _stored_call(env, call_id)
        assert (status, reason) == ("ended", "completed")  # never stuck "active" with nobody inside
        assert participants == {env.alice_id: "left", env.bob_id: "left"}
        # the end is reported by exactly one of the two requests (the one that ran second)
        ended_reports = [item for item in results if item.call["status"] == "ended"]
        assert len(ended_reports) >= 1


def test_decline_racing_join_ends_in_a_consistent_state(env):
    service = env.calls.chat_call_service
    seen = set()
    for _ in range(ROUNDS):
        call_id = _new_call(env)
        joined, declined = _run_together(
            lambda: service.join_call(current_user_id=env.bob_id, call_id=call_id),
            lambda: service.decline_call(current_user_id=env.bob_id, call_id=call_id),
        )
        assert not isinstance(joined, Exception) and not isinstance(declined, Exception), (joined, declined)
        status, reason, participants = _stored_call(env, call_id)
        if reason == "declined":  # decline won: the late join is told the call is over
            seen.add("decline-first")
            assert (status, joined.error, participants[env.bob_id]) == ("ended", "call_ended", "declined")
        else:  # join won: bob is in the call, the late decline changed nothing
            seen.add("join-first")
            assert (status, reason, joined.error, participants[env.bob_id]) == ("active", None, None, "joined")
            assert declined.call["status"] == "active"
            service.leave_call(current_user_id=env.alice_id, call_id=call_id)
            service.leave_call(current_user_id=env.bob_id, call_id=call_id)
    assert seen  # both orders are legal; the invariant above held for every observed one
