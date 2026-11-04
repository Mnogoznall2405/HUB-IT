"""Captured agent failures through real chat routes, worker and SQLite storage.

Only LDAP, Exchange and the LLM transport are replaced; drafts, permissions,
message history, cancellation and confirmation run through production code.
"""
from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from test_ai_chat_runtime import _configure_local_backend_runtime, _make_user
from backend.api import deps
from backend.api.v1 import chat as chat_api
from backend.ai_chat import action_cards, service as ai_module
from backend.ai_chat.tools import ad, office
from backend.appdb.db import app_session
from backend.appdb.models import AppAiBot, AppAiBotAccess, AppAiBotConversation, AppAiBotRun, AppAiPendingAction, AppUser
from backend.chat import service as chat_module
from backend.chat.db import chat_session
from backend.chat.models import ChatConversation, ChatMember
from backend.services import address_book_service as address_module
from backend.services import user_service as user_module
from backend.services.user_service import UserService


TOOLS = ["directory.people.search", "office.mail.contacts.resolve", "office.action.mail_send_draft",
         "chat.action.message_send_draft", "ad.user.password_status"]
PERMISSIONS = ["chat.read", "chat.write", "chat.ai.use", "mail.access", "address_book.read", "ad_users.read"]


def call(tool_id, **args):
    return {"tool_id": tool_id, "args": args}


@pytest.fixture
def agent(tmp_path, monkeypatch):
    url = _configure_local_backend_runtime(tmp_path, monkeypatch, "agent_reliability.db")
    users = UserService(database_url=url)
    chat = chat_module.ChatService()
    svc = ai_module.AiChatService()
    monkeypatch.setenv("AI_JEV_ROUTING", "0")
    monkeypatch.setattr(ai_module, "user_service", users)
    monkeypatch.setattr(ai_module, "chat_service", chat)
    monkeypatch.setattr(ai_module, "ai_chat_service", svc)
    monkeypatch.setattr(chat_module, "user_service", users)
    monkeypatch.setattr(user_module, "user_service", users)
    monkeypatch.setattr(chat_api, "chat_service", chat)
    monkeypatch.setattr(chat_api, "_schedule_chat_message_side_effects", lambda **kwargs: None)
    monkeypatch.setattr(chat_api, "_schedule_ai_run_for_message", lambda **kwargs: None)
    monkeypatch.setattr(svc, "_enqueue_message_side_effects_after_send", lambda **kwargs: None)
    monkeypatch.setattr(svc, "_publish_status_event", lambda **kwargs: None)
    monkeypatch.setattr(svc, "_publish_response_preview", lambda **kwargs: None)
    monkeypatch.setattr(svc, "_enqueue_typing_event", lambda **kwargs: None)
    monkeypatch.setattr(ai_module.openrouter_client, "get_status", lambda: {"configured": True})
    monkeypatch.setattr(ai_module.ai_kb_retrieval_service, "ensure_index_fresh", lambda **kwargs: None)
    monkeypatch.setattr(ai_module.ai_kb_retrieval_service, "retrieve", lambda **kwargs: [])
    with app_session(url) as db:
        db.add_all([
            AppUser(id=99, username="actor", full_name="Actor", role="viewer", is_active=True,
                    use_custom_permissions=True, custom_permissions_json=json.dumps(PERMISSIONS)),
            AppUser(id=39, username="ai_test", full_name="Assistant", role="viewer", is_active=True),
            AppUser(id=848, username="recipient", full_name="Антонова Ольга Павловна", role="viewer", is_active=True),
            AppAiBot(id="agent", slug="corp-assistant", title="Assistant", bot_user_id=39,
                     enabled_tools_json=json.dumps(TOOLS), use_personal_memory=False,
                     tool_settings_json='{"max_tool_rounds":6,"max_tool_calls_per_round":3}'),
            AppAiBotAccess(bot_id="agent", user_id=99, allowed=True, updated_by=99),
            AppAiBotConversation(bot_id="agent", user_id=99, conversation_id="agent-conv", use_personal_memory=False),
        ])
    with chat_session() as db:
        db.add(ChatConversation(id="agent-conv", kind="ai", title="Assistant", created_by_user_id=99))
        db.flush()
        db.add_all([ChatMember(conversation_id="agent-conv", user_id=99), ChatMember(conversation_id="agent-conv", user_id=39)])

    app = FastAPI()
    app.include_router(chat_api.router, prefix="/api/v1/chat")
    app.dependency_overrides[deps.get_current_user] = lambda: _make_user(permissions=PERMISSIONS)
    app.dependency_overrides[deps.get_current_database_id] = lambda: "ITINVENT"
    steps = []
    prompts = []
    sent = []

    def complete(**kwargs):
        prompts.append(kwargs)
        assert steps, "unexpected extra LLM request"
        response = steps.pop(0)
        if isinstance(response, Exception):
            raise response
        return response, {"output_tokens": 10}

    monkeypatch.setattr(ai_module.openrouter_client, "complete_json", complete)
    monkeypatch.setattr(office.mail_service, "search_contacts", lambda *args, **kwargs: [
        {"name": "Антонова Ольга Павловна", "email": "antonova.op@example.test", "source": "gal"},
    ])
    monkeypatch.setattr(action_cards.mail_service, "send_message", lambda **kwargs: sent.append(kwargs) or {"ok": True, "message_id": "sent-1"})
    with TestClient(app) as client:
        def request(text, *, process=True, reply_to_message_id=None):
            response = client.post("/api/v1/chat/conversations/agent-conv/messages", json={"body": text, "reply_to_message_id": reply_to_message_id})
            assert response.status_code == 200, response.text
            queued = svc.queue_run_for_message(current_user_id=99, conversation_id="agent-conv",
                                               trigger_message_id=response.json()["id"], effective_database_id="ITINVENT")
            if process:
                assert svc.process_next_run()
            with app_session(url) as db:
                runs = list(db.execute(select(AppAiBotRun).order_by(AppAiBotRun.created_at.desc())).scalars())
                return json.loads(runs[0].result_json) if process else queued

        yield SimpleNamespace(client=client, steps=steps, prompts=prompts, sent=sent, request=request, url=url, svc=svc, chat=chat)


def actions(agent):
    with app_session(agent.url) as db:
        return [{"id": row.id, "status": row.status, "action_type": row.action_type,
                 "payload": json.loads(row.payload_json), "result": json.loads(row.result_json)}
                for row in db.execute(select(AppAiPendingAction).order_by(AppAiPendingAction.created_at)).scalars()]


def test_cold_history_and_hydration_restore_mail_action(agent):
    message = agent.chat.send_message(current_user_id=39, conversation_id="agent-conv", body="Черновик готов")
    with app_session(agent.url) as db:
        db.add(AppAiPendingAction(
            id="cold-draft", action_type="office.mail.send", status="pending",
            conversation_id="agent-conv", run_id="cold-run", message_id=message["id"], requester_user_id=99,
            payload_json="{}", preview_json='{"mail":{"to":["recipient@example.test"],"body":"Example"}}',
            result_json="{}", expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        ))
    for lightweight in (0, 1):
        response = agent.client.get("/api/v1/chat/conversations/agent-conv/thread-bootstrap", params={"lightweight": lightweight})
        assert response.status_code == 200, response.text
        row = next(item for item in response.json()["items"] if item["id"] == message["id"])
        assert row["action_card"]["id"] == "cold-draft"
    response = agent.client.get("/api/v1/chat/conversations/agent-conv/messages/hydrate", params={"message_ids": message["id"]})
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["action_card"]["status"] == "pending"
    with app_session(agent.url) as db:
        db.get(AppAiPendingAction, "cold-draft").status = "cancelled"
    response = agent.client.get("/api/v1/chat/conversations/agent-conv/messages/hydrate", params={"message_ids": message["id"]})
    assert response.json()["items"][0]["action_card"]["status"] == "cancelled"
    cached = agent.client.get("/api/v1/chat/conversations/agent-conv/thread-bootstrap", params={"lightweight": 1})
    assert cached.status_code == 200, cached.text
    assert next(item for item in cached.json()["items"] if item["id"] == message["id"])["action_card"]["status"] == "cancelled"
    assert agent.sent == []


def test_mail_confirmation_passes_a_stable_operation_key(agent):
    card = action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
        run_id="mail-key", requester_user_id=99,
        payload={"to": ["recipient@example.test"], "subject": "Example", "body": "Example"})
    for _ in range(2):
        response = agent.client.post(f"/api/v1/chat/ai/actions/{card['id']}/confirm")
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "confirmed"
    assert len(agent.sent) == 1
    assert agent.sent[0]["idempotency_key"] == f"ai-action:{card['id']}"
    assert agent.sent[0]["require_idempotency"] is True


def test_mail_edits_are_durable_before_external_send(agent, monkeypatch):
    card = action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
        run_id="edited-mail", requester_user_id=99,
        payload={"to": ["recipient@example.test"], "subject": "Original", "body": "Original"})
    def send(**kwargs):
        with app_session(agent.url) as db:
            current = db.get(AppAiPendingAction, card["id"])
            assert current.status == "executing"
            assert json.loads(current.payload_json)["body"] == kwargs["body"] == "Confirmed edit"
        agent.sent.append(kwargs)
        return {"ok": True, "message_id": "edited-sent"}
    monkeypatch.setattr(action_cards.mail_service, "send_message", send)
    response = agent.client.post(f"/api/v1/chat/ai/actions/{card['id']}/confirm", json={"body": "Confirmed edit"})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "confirmed"
    assert len(agent.sent) == 1


def test_unknown_mail_send_is_not_offered_as_a_safe_failure_or_repeated(agent, monkeypatch):
    from backend.services.mail_service import MailServiceError
    card = action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
        run_id="unknown-mail", requester_user_id=99,
        payload={"to": ["recipient@example.test"], "subject": "Example", "body": "Example"})
    def send(**kwargs):
        agent.sent.append(kwargs)
        raise MailServiceError("Ambiguous timeout", code="MAIL_SEND_UNKNOWN", status_code=409)
    monkeypatch.setattr(action_cards.mail_service, "send_message", send)
    for _ in range(2):
        response = agent.client.post(f"/api/v1/chat/ai/actions/{card['id']}/confirm")
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "failed"
        assert response.json()["result"]["send_outcome"] == "unknown"
        assert "могло быть отправлено" in response.json()["error_text"]
    assert len(agent.sent) == 1


@pytest.mark.parametrize("ledger_status,expected", [("sent", "confirmed"), ("processing", "failed")])
def test_confirmation_recovers_after_crash_without_resending(agent, ledger_status, expected):
    from backend.appdb.models import AppMailSendIdempotency
    card = action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
        run_id="crashed-mail", requester_user_id=99,
        payload={"to": ["recipient@example.test"], "subject": "Example", "body": "Example"})
    # Persist the state left by a process killed after Exchange/ledger work,
    # before the final action transaction. The HTTP retry must only reconcile.
    with app_session(agent.url) as db:
        row = db.get(AppAiPendingAction, card["id"])
        row.status = "executing"
        row.updated_at = datetime.now(timezone.utc) - timedelta(minutes=6)
        db.add(AppMailSendIdempotency(id="crash-ledger", user_id=99, mailbox_id="primary",
            idempotency_key=f"ai-action:{card['id']}", request_payload_hash="test-hash", status=ledger_status,
            response_json=json.dumps({"ok": True, "message_id": "accepted-before-crash"}) if ledger_status == "sent" else "{}"))
    response = agent.client.post(f"/api/v1/chat/ai/actions/{card['id']}/confirm")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == expected
    if ledger_status == "sent":
        assert response.json()["result"]["message_id"] == "accepted-before-crash"
    else:
        assert response.json()["result"]["send_outcome"] == "unknown"
    assert agent.sent == []


@pytest.mark.parametrize("crash_window", ["action_only", "message_unlinked", "message_linked"])
def test_worker_repairs_saved_draft_after_restart_without_llm_or_send(agent, monkeypatch, crash_window):
    from backend.chat import realtime_side_effects
    queued = agent.request("Напиши письмо", process=False)
    run_id = queued["run_id"]
    card = action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
        run_id=run_id, requester_user_id=99,
        payload={"to": ["recipient@example.test"], "subject": "Example", "body": "Example"})
    if crash_window != "action_only":
        message = agent.chat.send_message(current_user_id=39, conversation_id="agent-conv",
            body="Черновик готов", client_message_id=f"ai-run:{run_id}", defer_push_notifications=True)
        if crash_window == "message_linked":
            action_cards.attach_run_actions_to_message(run_id=run_id, message_id=message["id"])
    with app_session(agent.url) as db:
        run = db.get(AppAiBotRun, run_id)
        run.status = "running"
        run.updated_at = datetime.now(timezone.utc) - timedelta(hours=2)
    monkeypatch.setattr(realtime_side_effects, "chat_service", agent.chat)
    monkeypatch.setattr(agent.svc, "_enqueue_message_side_effects_after_send",
        ai_module.AiChatService._enqueue_message_side_effects_after_send.__get__(agent.svc))
    assert agent.svc.repair_result_deliveries() == 1
    assert agent.svc.repair_result_deliveries() == 0
    history = agent.client.get("/api/v1/chat/conversations/agent-conv/thread-bootstrap", params={"lightweight": 1})
    assert history.status_code == 200, history.text
    results = [item for item in history.json()["items"] if item.get("action_card")]
    assert len(results) == 1
    assert results[0]["action_card"]["id"] == card["id"]
    assert results[0]["action_card"]["status"] == "pending"
    assert agent.prompts == agent.sent == []


def test_two_clients_confirm_the_same_mail_without_second_send(agent, monkeypatch):
    entered, release = threading.Event(), threading.Event()
    card = action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
        run_id="concurrent-mail", requester_user_id=99,
        payload={"to": ["recipient@example.test"], "subject": "Example", "body": "Example"})
    def send(**kwargs):
        agent.sent.append(kwargs)
        entered.set()
        assert release.wait(5), "The competing confirmation did not finish"
        return {"ok": True, "message_id": "one-send"}
    monkeypatch.setattr(action_cards.mail_service, "send_message", send)
    path = f"/api/v1/chat/ai/actions/{card['id']}/confirm"
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(agent.client.post, path)
        try:
            assert entered.wait(5)
            second = agent.client.post(path)
            assert second.status_code == 200, second.text
            assert second.json()["status"] == "executing"
        finally:
            release.set()
        assert first.result(timeout=5).json()["status"] == "confirmed"
    assert len(agent.sent) == 1


def test_expired_mail_cannot_be_confirmed_from_an_old_client(agent):
    card = action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
        run_id="expired-mail", requester_user_id=99,
        payload={"to": ["recipient@example.test"], "subject": "Example", "body": "Example"})
    with app_session(agent.url) as db:
        db.get(AppAiPendingAction, card["id"]).expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    response = agent.client.post(f"/api/v1/chat/ai/actions/{card['id']}/confirm")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "expired"
    assert agent.sent == []


def test_transient_attachment_failure_is_repaired_with_an_enriched_event(agent, monkeypatch):
    from backend.chat import realtime_side_effects
    original = action_cards.attach_run_actions_to_message
    attempts = 0
    def attach(**kwargs):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("Temporary APP connection failure")
        return original(**kwargs)
    monkeypatch.setattr(action_cards, "attach_run_actions_to_message", attach)
    monkeypatch.setattr(realtime_side_effects, "chat_service", agent.chat)
    monkeypatch.setattr(agent.svc, "_enqueue_message_side_effects_after_send",
        ai_module.AiChatService._enqueue_message_side_effects_after_send.__get__(agent.svc))
    events = []
    monkeypatch.setattr(agent.svc, "_enqueue_realtime_jobs", lambda jobs: events.extend(jobs))
    agent.steps.extend([
        {"tool_calls": [call("office.mail.contacts.resolve", q="Антонова"),
                        call("office.action.mail_send_draft", to=["antonova.op@example.test"], subject="Example", body="Example")]},
        {"answer_markdown": "Готово"},
    ])
    result = agent.request("Напиши письмо Антоновой")
    assert "Восстанавливаю" in result["answer_markdown"]
    before = [job for job in events if job["event_type"] == "chat.message.created" and job["target_user_id"] == 99]
    assert len(before) == 1 and not before[0]["payload"].get("action_card")
    assert agent.svc.repair_result_deliveries() == 1
    after = [job for job in events if job["event_type"] == "chat.message.created" and job["target_user_id"] == 99]
    assert len(after) == 2
    assert after[1]["payload"]["id"] == after[0]["payload"]["id"]
    assert after[1]["payload"]["action_card"]["status"] == "pending"
    assert after[0]["dedupe_key"] != after[1]["dedupe_key"]
    assert agent.svc.repair_result_deliveries() == 0
    assert agent.sent == []


def test_parallel_recovery_keeps_one_reply_and_one_card(agent, monkeypatch, caplog):
    from backend.chat import realtime_side_effects
    queued = agent.request("Напиши письмо", process=False)
    action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
        run_id=queued["run_id"], requester_user_id=99,
        payload={"to": ["recipient@example.test"], "subject": "Example", "body": "Example"})
    with app_session(agent.url) as db:
        run = db.get(AppAiBotRun, queued["run_id"])
        run.status = "running"
        run.updated_at = datetime.now(timezone.utc) - timedelta(hours=2)
    monkeypatch.setattr(realtime_side_effects, "chat_service", agent.chat)
    monkeypatch.setattr(agent.svc, "_enqueue_message_side_effects_after_send",
        ai_module.AiChatService._enqueue_message_side_effects_after_send.__get__(agent.svc))
    gate = threading.Barrier(2)
    def recover(_):
        gate.wait(timeout=5)
        return agent.svc.repair_result_deliveries()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(recover, range(2)))
    assert any(results)
    assert "AI result delivery repair failed" not in caplog.text
    response = agent.client.get("/api/v1/chat/conversations/agent-conv/thread-bootstrap", params={"lightweight": 1})
    assert response.status_code == 200, response.text
    replies = [item for item in response.json()["items"] if item.get("sender", {}).get("id") == 39]
    assert len(replies) == 1
    assert replies[0]["action_card"]["status"] == "pending"
    assert agent.prompts == agent.sent == []


def test_generic_retry_after_unknown_send_does_not_create_another_letter(agent, monkeypatch):
    from backend.services.mail_service import MailServiceError
    agent.steps.extend([
        {"tool_calls": [call("office.mail.contacts.resolve", q="Антонова"),
                        call("office.action.mail_send_draft", to=["antonova.op@example.test"], subject="Example", body="Example")]},
        {"answer_markdown": "Готово"},
    ])
    agent.request("Напиши письмо Антоновой")
    card = actions(agent)[0]
    def uncertain(**kwargs):
        agent.sent.append(kwargs)
        raise MailServiceError("Unknown result", code="MAIL_SEND_UNKNOWN", status_code=409)
    monkeypatch.setattr(action_cards.mail_service, "send_message", uncertain)
    response = agent.client.post(f"/api/v1/chat/ai/actions/{card['id']}/confirm")
    assert response.json()["result"]["send_outcome"] == "unknown"
    prompt_count = len(agent.prompts)
    result = agent.request("Давай ещё раз")
    assert "результат" in result["answer_markdown"].lower()
    assert "повтор" in result["answer_markdown"].lower()
    assert len(actions(agent)) == 1
    assert len(agent.prompts) == prompt_count
    assert len(agent.sent) == 1


def test_large_repeated_context_finishes_recipient_lookup_and_draft(agent, monkeypatch):
    responses = [
        {"tool_calls": [call("office.mail.contacts.resolve", q="Антонова")]},
        {"tool_calls": [call("office.action.mail_send_draft", to=["antonova.op@example.test"],
                             subject="ЗУП", body="Добавьте employee@example.test в ЗУП")]},
        {"answer_markdown": "Готово"},
    ]
    calls = []
    def complete(**kwargs):
        calls.append(kwargs)
        return responses.pop(0), {"prompt_tokens": 16000, "completion_tokens": 200}
    monkeypatch.setattr(ai_module.openrouter_client, "complete_json", complete)
    result = agent.request("Напиши письмо Антоновой: добавьте employee@example.test в ЗУП")
    assert len(calls) == 3
    assert len(actions(agent)) == 1
    assert "подтвердите" in result["answer_markdown"]
    messages = agent.client.get("/api/v1/chat/conversations/agent-conv/messages").json()["items"]
    reply = next(item for item in messages if item["body"] == result["answer_markdown"])
    assert reply["action_card"]["id"] == actions(agent)[0]["id"]
    assert agent.sent == []


@pytest.mark.parametrize("text", ["Давай еще раз", "Попробуй снова", "Не вижу черновик"])
def test_retry_redisplays_same_pending_draft_without_llm_or_send(agent, text):
    old = action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
        run_id="legacy", requester_user_id=99,
        payload={"to": ["antonova.op@example.test"], "subject": "ЗУП", "body": "Добавьте employee@example.test"})
    result = agent.request(text)
    assert len(actions(agent)) == 1
    assert actions(agent)[0]["status"] == "pending"
    assert actions(agent)[0]["payload"]["body"] == "Добавьте employee@example.test"
    response = agent.client.get("/api/v1/chat/conversations/agent-conv/messages")
    assert response.status_code == 200
    reply = next(item for item in response.json()["items"] if item["body"] == result["answer_markdown"])
    assert reply["action_card"]["id"] == old["id"]
    assert datetime.fromisoformat(reply["action_card"]["expires_at"]).replace(tzinfo=timezone.utc) == (
        datetime.fromisoformat(old["expires_at"]).replace(tzinfo=timezone.utc))
    assert agent.prompts == []
    assert agent.sent == []


@pytest.mark.parametrize("usage", [
    {"prompt_tokens": 31000, "completion_tokens": 10},
    {"prompt_tokens": 10, "completion_tokens": 31000},
])
def test_token_limits_still_stop_work_before_creating_a_draft(agent, monkeypatch, usage):
    responses = [
        {"tool_calls": [call("office.mail.contacts.resolve", q="Антонова"),
                        call("office.action.mail_send_draft", to=["antonova.op@example.test"], subject="ЗУП", body="Письмо")]},
    ]
    def complete(**kwargs):
        return responses.pop(0), usage
    monkeypatch.setattr(ai_module.openrouter_client, "complete_json", complete)
    result = agent.request("Напиши письмо Антоновой")
    assert actions(agent) == []
    assert result["tool_traces"] == []
    assert "лимит" in result["answer_markdown"]
    assert agent.sent == []


def test_retry_with_several_pending_drafts_asks_which_one(agent):
    for name in ("first", "second"):
        action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
            run_id=name, requester_user_id=99,
            payload={"to": ["antonova.op@example.test"], "subject": name, "body": "Письмо"})
    result = agent.request("Давай ещё раз")
    assert "несколько" in result["answer_markdown"].lower()
    assert all(card["status"] == "pending" for card in actions(agent))
    assert agent.prompts == []
    assert agent.sent == []


def test_generic_retry_does_not_redisplay_a_letter_after_an_unrelated_request(agent):
    agent.steps.extend([
        {"tool_calls": [call("office.mail.contacts.resolve", q="Антонова"),
                        call("office.action.mail_send_draft", to=["antonova.op@example.test"], subject="ЗУП", body="Письмо")]},
        {"answer_markdown": "Готово"},
    ])
    agent.request("Напиши письмо Антоновой")
    agent.steps.append({"answer_markdown": "Данные техники недоступны."})
    agent.request("Покажи технику сотрудника")
    agent.steps.append({"answer_markdown": "Данные техники всё ещё недоступны."})
    result = agent.request("Давай ещё раз")
    assert result["answer_markdown"] == "Данные техники всё ещё недоступны."
    assert len(actions(agent)) == 1
    assert actions(agent)[0]["status"] == "pending"
    assert agent.sent == []


def test_retry_cannot_redisplay_a_draft_confirmed_during_publication(agent, monkeypatch):
    old = action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
        run_id="legacy", requester_user_id=99,
        payload={"to": ["antonova.op@example.test"], "subject": "ЗУП", "body": "Письмо"})
    original = action_cards.redisplay_pending_action
    def raced(**kwargs):
        with app_session(agent.url) as db:
            db.get(AppAiPendingAction, old["id"]).status = "confirmed"
        return original(**kwargs)
    monkeypatch.setattr(action_cards, "redisplay_pending_action", raced)
    result = agent.request("Давай ещё раз")
    assert "уже отправлен" in result["answer_markdown"]
    messages = agent.client.get("/api/v1/chat/conversations/agent-conv/messages").json()["items"]
    assert any(item["body"] == result["answer_markdown"] for item in messages)
    assert not any("Показываю" in item["body"] for item in messages)
    assert actions(agent)[0]["status"] == "confirmed"
    assert agent.sent == []


def test_worker_realtime_response_contains_the_persisted_draft(agent, monkeypatch):
    from backend.chat import realtime_side_effects
    monkeypatch.setattr(realtime_side_effects, "chat_service", agent.chat)
    deliveries = []
    monkeypatch.setattr(agent.svc, "_enqueue_message_side_effects_after_send",
                        ai_module.AiChatService._enqueue_message_side_effects_after_send.__get__(agent.svc))
    monkeypatch.setattr(agent.svc, "_enqueue_realtime_jobs", lambda jobs: deliveries.extend(jobs))
    agent.steps.extend([
        {"tool_calls": [call("office.mail.contacts.resolve", q="Антонова"),
                        call("office.action.mail_send_draft", to=["antonova.op@example.test"], subject="ЗУП", body="Письмо")]},
        {"answer_markdown": "Готово"},
    ])
    result = agent.request("Напиши письмо Антоновой")
    message = next(job["payload"] for job in deliveries
                   if job["event_type"] == "chat.message.created" and job["target_user_id"] == 99)
    assert message["body"] == result["answer_markdown"]
    assert message["action_card"]["id"] == actions(agent)[0]["id"]
    assert message["action_card"]["status"] == "pending"
    assert agent.sent == []


@pytest.mark.parametrize("employee_email", [None, "invented@example.test", "employee@example.test"])
def test_employee_email_in_mail_body_must_be_present_and_verified(agent, employee_email):
    body = "Прошу внести почтовый электронный адрес сотрудника Лэйлы Гарифуллиной"
    if employee_email:
        body += f": {employee_email}"
    agent.steps.extend([
        {"tool_calls": [call("office.mail.contacts.resolve", q="Антонова"),
                        call("office.action.mail_send_draft", to=["antonova.op@example.test"], subject="ЗУП", body=body)]},
        {"answer_markdown": "Черновик готов"},
    ])
    result = agent.request("Напиши Антоновой письмо: нужно внести почтовый электронный адрес Лэйлы Гарифуллиной. employee@example.test")
    if employee_email == "employee@example.test":
        assert len(actions(agent)) == 1
        assert "подтвердите" in result["answer_markdown"]
    else:
        assert actions(agent) == []
        assert "Черновик не создан" in result["answer_markdown"]
        assert "адрес" in result["answer_markdown"].lower()
    assert agent.sent == []


def test_claude_transport_keeps_recipient_arguments_through_http_worker(agent, monkeypatch):
    from shared.llm import OpenRouterClient

    with app_session(agent.url) as db:
        db.get(AppAiBot, "agent").model = "anthropic/claude-haiku-5.5"
    responses = [
        {"tool_calls": [call("office.mail.contacts.resolve", q="Антонова Ольга Павловна")]},
        {"tool_calls": [call("office.action.mail_send_draft", to=["antonova.op@example.test"], subject="ЗУП", body="Добавить почту")]},
        {"answer_markdown": "Черновик подготовлен"},
    ]
    formats = []
    def provider(**kwargs):
        formats.append(kwargs["response_format"]["type"])
        payload = responses.pop(0)
        # RouterAI accepts this schema but silently closes arbitrary args maps.
        if kwargs["response_format"]["type"] == "json_schema":
            for item in payload.get("tool_calls", []):
                item["args"] = {}
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload)))],
            usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1, total_tokens=2))
    client = ai_module.openrouter_client
    monkeypatch.setattr(client, "_build_client", lambda **kwargs: SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=provider))))
    monkeypatch.setattr(client, "complete_json", OpenRouterClient.complete_json.__get__(client))
    result = agent.request("Напиши письмо Антоновой Ольге Павловне: добавьте почту в ЗУП")
    cards = actions(agent)
    assert len(cards) == 1
    assert cards[0]["status"] == "pending"
    assert cards[0]["payload"]["to"] == ["antonova.op@example.test"]
    assert result["tool_traces"][0]["args"]["q"] == "Антонова Ольга Павловна"
    assert "подтвердите" in result["answer_markdown"]
    assert formats == ["json_object"] * 3
    assert agent.sent == []


def test_directory_alias_and_verified_recipient_in_same_round(agent, monkeypatch):
    searched = []
    def search(query, limit, **kwargs):
        searched.append(query)
        return {"items": [{"full_name": "Антонова Ольга Павловна", "work_emails": [{"value": "antonova.op@example.test"}]}], "total": 1}
    monkeypatch.setattr(address_module.address_book_service, "search", search)
    agent.steps.extend([
        {"tool_calls": [call("directory.people.search", q="Антонова Ольга Павловна"),
                        call("office.action.mail_send_draft", to=["antonova.op@example.test"], subject="ЗУП", body="Добавить почту")]},
        {"answer_markdown": "Письмо уже отправлено"},
    ])
    result = agent.request("Напиши письмо Антоновой Ольге Павловне")
    assert searched == ["Антонова Ольга Павловна"]
    assert actions(agent)[0]["payload"]["to"] == ["antonova.op@example.test"]
    assert "подтвердите" in result["answer_markdown"]
    assert "уже отправлено" not in result["answer_markdown"]
    assert result["tool_traces"][0]["sources"] == [{"system": "1c_zup_address_book"}]
    assert agent.sent == []


def test_invented_address_is_rejected_even_after_successful_lookup(agent):
    agent.steps.extend([
        {"tool_calls": [call("office.mail.contacts.resolve", q="Антонова"),
                        call("office.action.mail_send_draft", to=["antonova.o@example.test"], subject="ЗУП", body="Добавить почту")]},
        {"answer_markdown": "Черновик успешно подготовлен"},
    ])
    result = agent.request("Напиши письмо Антоновой")
    assert actions(agent) == []
    assert "Черновик не создан" in result["answer_markdown"]
    assert result["tool_traces"][1]["status"] == "error"
    assert agent.sent == []


def test_correction_cancels_old_card_and_confirm_is_idempotent(agent):
    old = action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
        run_id="legacy", requester_user_id=99, payload={"to": ["antonova.o@example.test"], "subject": "ЗУП", "body": "Добавить почту"})
    agent.steps.extend([
        {"tool_calls": [call("office.mail.contacts.resolve", q="Антонова"),
                        call("office.action.mail_send_draft", to=["antonova.op@example.test"], subject="ЗУП", body="Добавить почту")]},
        {"answer_markdown": "Исправлено"},
    ])
    agent.request("Исправь адрес Антоновой, ты букву пропустил")
    cards = actions(agent)
    assert cards[0]["status"] == "cancelled"
    assert cards[0]["result"]["superseded_by"] == cards[1]["id"]
    old_confirm = agent.client.post(f"/api/v1/chat/ai/actions/{old['id']}/confirm")
    assert old_confirm.status_code == 200
    assert old_confirm.json()["status"] == "cancelled"
    assert agent.sent == []
    for _ in range(2):
        confirmed = agent.client.post(f"/api/v1/chat/ai/actions/{cards[1]['id']}/confirm")
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["status"] == "confirmed"
    assert len(agent.sent) == 1
    assert agent.sent[0]["to"] == ["antonova.op@example.test"]


def test_parallel_corrections_only_one_can_replace_a_card(agent):
    """A deterministic parallel claim checks the race that UI E2E cannot schedule."""
    old = action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
        run_id="legacy", requester_user_id=99, payload={"to": ["old@example.test"], "subject": "ЗУП", "body": "Почта"})
    barrier = threading.Barrier(2)
    def replace(index):
        barrier.wait(timeout=10)
        try:
            return action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
                run_id=f"correction-{index}", requester_user_id=99,
                payload={"replace_action_id": old["id"], "to": ["new@example.test"], "subject": "ЗУП", "body": "Почта"})
        except ValueError:
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(replace, [1, 2]))
    assert sum(result is not None for result in results) == 1
    cards = actions(agent)
    assert [card["status"] for card in cards] == ["cancelled", "pending"]
    assert cards[0]["result"]["superseded_by"] == cards[1]["id"]
    assert agent.sent == []


def test_reply_selects_one_draft_without_cancelling_an_unrelated_letter(agent):
    for run_id in ("selected-letter", "other-letter"):
        action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
            run_id=run_id, requester_user_id=99, payload={"to": ["old@example.test"], "subject": run_id, "body": "Почта"})
    message = agent.chat.send_message(current_user_id=39, conversation_id="agent-conv", body="Первый черновик", defer_push_notifications=True)
    action_cards.attach_run_actions_to_message(run_id="selected-letter", message_id=message["id"])
    agent.steps.extend([
        {"tool_calls": [call("office.mail.contacts.resolve", q="Антонова"),
                        call("office.action.mail_send_draft", to=["antonova.op@example.test"], subject="ЗУП", body="Добавить почту")]},
        {"answer_markdown": "Готово"},
    ])
    agent.request("Исправь адрес получателя", reply_to_message_id=message["id"])
    assert [card["status"] for card in actions(agent)] == ["cancelled", "pending", "pending"]
    assert agent.sent == []


def test_adding_address_to_chat_body_preserves_channel(agent):
    action_cards.build_chat_message_draft(conversation_id="agent-conv", run_id="legacy", requester_user_id=99,
        payload={"peer_user_id": 848, "text": "Добавить почту Елены в ЗУП"})
    agent.steps.extend([
        {"tool_calls": [call("office.action.mail_send_draft", to=["elena@example.test"], subject="ЗУП", body="Добавить почту")]},
        {"tool_calls": [call("chat.action.message_send_draft", peer_user_id=848, text="Добавить elena@example.test в ЗУП")]},
        {"answer_markdown": "Письмо отправлено"},
    ])
    result = agent.request("elena@example.test")
    cards = actions(agent)
    assert [card["action_type"] for card in cards] == ["chat.message.send", "chat.message.send"]
    assert [card["status"] for card in cards] == ["cancelled", "pending"]
    assert "сообщения в чате" in result["answer_markdown"]
    assert "elena@example.test" in cards[1]["payload"]["text"]
    assert agent.sent == []


@pytest.mark.parametrize("channel", ["mail", "chat"])
def test_explicit_channel_change_replaces_the_previous_draft(agent, channel):
    if channel == "mail":
        action_cards.build_chat_message_draft(conversation_id="agent-conv", run_id="legacy", requester_user_id=99,
            payload={"peer_user_id": 848, "text": "Добавить почту"})
        text = "Вместо сообщения в чате отправь письмо Антоновой"
        draft = call("office.action.mail_send_draft", to=["antonova.op@example.test"], subject="ЗУП", body="Добавить почту")
    else:
        action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
            run_id="legacy", requester_user_id=99, payload={"to": ["antonova.op@example.test"], "subject": "ЗУП", "body": "Добавить почту"})
        text = "Вместо письма напиши Антоновой в чат"
        draft = call("chat.action.message_send_draft", peer_user_id=848, text="Добавить почту")
    agent.steps.extend([
        {"tool_calls": [call("office.mail.contacts.resolve", q="Антонова"), draft]},
        {"answer_markdown": "Готово"},
    ])
    agent.request(text)
    cards = actions(agent)
    assert [card["status"] for card in cards] == ["cancelled", "pending"]
    assert cards[1]["action_type"] == ("office.mail.send" if channel == "mail" else "chat.message.send")


def test_explicit_ad_request_uses_ldap_email_and_records_actual_source(agent, monkeypatch):
    queries = []
    def lookup(query, *, limit):
        queries.append(query)
        return {"status": "matched", "user": {"display_name": "Елена Пещерских", "mail": "elena@example.test"}}
    monkeypatch.setattr(ad, "lookup_ad_user_password_status", lookup)
    monkeypatch.setattr(address_module.address_book_service, "search", lambda *args, **kwargs: pytest.fail("1C is not AD"))
    agent.steps.extend([
        {"tool_calls": [call("directory.people.search", query="Елена Пещерских")]},
        {"answer_markdown": "В AD: elena@example.test"},
    ])
    result = agent.request("В AD посомтри")
    assert queries == ["Елена Пещерских"]
    assert result["tool_traces"][0]["tool_id"] == "ad.user.password_status"
    assert result["tool_traces"][0]["sources"] == [{"system": "active_directory"}]
    assert "elena@example.test" in result["answer_markdown"]


def test_explicit_ad_lookup_keeps_the_portal_permission_gate(agent, monkeypatch):
    with app_session(agent.url) as db:
        db.get(AppUser, 99).custom_permissions_json = json.dumps([p for p in PERMISSIONS if p != "ad_users.read"])
    monkeypatch.setattr(ad, "lookup_ad_user_password_status", lambda *args, **kwargs: pytest.fail("AD access must stay denied"))
    agent.steps.extend([
        {"tool_calls": [call("directory.people.search", query="Елена Пещерских")]},
        {"answer_markdown": "В AD адрес отсутствует"},
    ])
    result = agent.request("В AD посомтри")
    assert result["tool_traces"][0]["status"] == "error"
    assert "Данные Active Directory не проверены" in result["answer_markdown"]


def test_ad_claim_without_lookup_and_future_email_are_not_trusted(agent):
    agent.steps.extend([
        {"tool_calls": [call("office.action.mail_send_draft", to=["future@example.test"], subject="ЗУП", body="Добавить почту")]},
        {"answer_markdown": "Успешно"},
    ])
    agent.request("Напиши письмо Антоновой", process=False)
    agent.request("future@example.test", process=False)
    assert agent.svc.process_next_run()
    assert actions(agent) == []
    agent.steps[:] = [{"answer_markdown": "Включая AD, адрес нигде не указан"}]
    # Process the already queued second message, then the explicit AD request.
    assert agent.svc.process_next_run()
    agent.steps[:] = [{"answer_markdown": "Включая AD, адрес нигде не указан"}]
    result = agent.request("В AD посмотри")
    assert "Данные Active Directory не проверены" in result["answer_markdown"]


@pytest.mark.parametrize("origin", ["database", "provider"])
def test_worker_persists_distinct_timeout_failures_without_drafts(agent, monkeypatch, origin):
    if origin == "database":
        from sqlalchemy.exc import TimeoutError
        def fail_context(**kwargs):
            raise TimeoutError("QueuePool limit of size 1 overflow 0 reached, timeout 30.00")
        monkeypatch.setattr(agent.svc, "_build_conversation_context", fail_context)
    else:
        from backend.ai_chat.openrouter_client import OpenRouterClientError
        agent.steps[:] = [OpenRouterClientError("request timed out")]
    agent.request("Привет")
    with app_session(agent.url) as db:
        run = db.execute(select(AppAiBotRun)).scalar_one()
        assert run.status == "failed"
        assert run.completed_at is not None
        assert "базой данных" in run.error_text if origin == "database" else "Провайдер ИИ" in run.error_text
    assert actions(agent) == []
    assert agent.sent == []


def test_watchdog_failure_stops_late_worker_progress(agent):
    from backend.ai_chat.service import AiRunCancelled
    agent.request("Привет", process=False)
    with app_session(agent.url) as db:
        run = db.execute(select(AppAiBotRun)).scalar_one()
        run.status = "failed"
        run.error_text = "Выполнение прервано"
        run_id = run.id
    with pytest.raises(AiRunCancelled):
        agent.svc._raise_if_run_cancelled(run_id)
    agent.svc._set_run_progress(run_id=run_id, conversation_id="agent-conv", user_id=99,
        bot=SimpleNamespace(id="agent", title="Assistant"), status="running", stage="generating_answer")
    with app_session(agent.url) as db:
        run = db.get(AppAiBotRun, run_id)
        assert run.status == "failed"
        assert run.error_text == "Выполнение прервано"


@pytest.mark.parametrize("stage", ["initial", "followup"])
def test_invalid_json_recovers_without_replaying_a_draft(agent, stage):
    from backend.ai_chat.openrouter_client import OpenRouterClientError
    draft_step = {"tool_calls": [call("office.mail.contacts.resolve", q="Антонова"),
        call("office.action.mail_send_draft", to=["antonova.op@example.test"], subject="ЗУП", body="Добавить почту")]}
    invalid = OpenRouterClientError("LLM returned invalid JSON payload.")
    agent.steps[:] = [invalid, draft_step, {"answer_markdown": "Готово"}] if stage == "initial" else [draft_step, invalid, {"answer_markdown": "Готово"}]
    result = agent.request("Напиши письмо Антоновой")
    assert len(agent.prompts) == 3
    assert len(actions(agent)) == 1
    assert actions(agent)[0]["status"] == "pending"
    assert "подтвердите" in result["answer_markdown"]
    assert agent.sent == []


@pytest.mark.parametrize("outcome", ["success", "error"])
def test_worker_finalization_preserves_concurrent_watchdog_failure(agent, monkeypatch, outcome):
    from contextlib import contextmanager
    from datetime import datetime, timezone
    from sqlalchemy import update

    armed = False
    injected = False
    published = []
    original_session = ai_module.app_session
    monkeypatch.setattr(agent.svc, "_publish_status_event", lambda **kwargs: published.append(kwargs))

    @contextmanager
    def racing_session():
        nonlocal injected
        with original_session() as db:
            original_get = db.get
            def get(model, identity, *args, **kwargs):
                nonlocal injected
                row = original_get(model, identity, *args, **kwargs)
                if armed and not injected and model is AppAiBotRun:
                    injected = True
                    db.execute(update(AppAiBotRun).where(AppAiBotRun.id == identity).values(
                        status="failed", error_text="Watchdog stopped this run",
                        completed_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
                    ).execution_options(synchronize_session=False))
                return row
            db.get = get
            yield db

    monkeypatch.setattr(ai_module, "app_session", racing_session)
    if outcome == "success":
        original_touch = agent.svc._touch_conversation_mapping
        def touch(**kwargs):
            nonlocal armed
            original_touch(**kwargs)
            armed = True
        monkeypatch.setattr(agent.svc, "_touch_conversation_mapping", touch)
        agent.steps[:] = [{"answer_markdown": "Готово"}]
    else:
        def fail(**kwargs):
            nonlocal armed
            armed = True
            raise RuntimeError("Provider failed after watchdog timeout")
        monkeypatch.setattr(ai_module.openrouter_client, "complete_json", fail)
    agent.request("Привет")
    with app_session(agent.url) as db:
        run = db.execute(select(AppAiBotRun)).scalar_one()
        assert run.status == "failed"
        assert run.error_text == "Watchdog stopped this run"
    assert injected
    assert not any(event["status"] in {"completed", "failed"} for event in published)


def test_cancel_that_loses_the_race_to_confirm_does_not_overwrite_the_claim(agent, monkeypatch):
    """DAI-02: confirm claims the card (executing) between cancel's read and its write."""
    card = action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
        run_id="cancel-race", requester_user_id=99,
        payload={"to": ["recipient@example.test"], "subject": "Example", "body": "Example"})
    real_now = action_cards._utc_now
    claimed = []

    def now_after_concurrent_claim():
        if not claimed:
            claimed.append(True)
            with app_session(agent.url) as db:
                db.get(AppAiPendingAction, card["id"]).status = "executing"
        return real_now()

    monkeypatch.setattr(action_cards, "_utc_now", now_after_concurrent_claim)
    result = action_cards.cancel_action(action_id=card["id"], current_user=SimpleNamespace(id=99, role="viewer"))

    assert result["status"] == "executing"
    with app_session(agent.url) as db:
        assert db.get(AppAiPendingAction, card["id"]).status == "executing"


def test_abandoned_non_mail_execution_becomes_an_explicit_unknown_and_is_not_rerun(agent):
    """DAI-08: a card left in executing after a crash must not stay executing forever."""
    with app_session(agent.url) as db:
        db.add(AppAiPendingAction(
            id="stuck-transfer", action_type="equipment.transfer", status="executing",
            conversation_id="agent-conv", run_id="stuck-run", message_id="m-stuck", requester_user_id=99,
            payload_json="{}", preview_json="{}", result_json="{}",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            updated_at=datetime.now(timezone.utc) - timedelta(minutes=30),
        ))
    response = agent.client.post("/api/v1/chat/ai/actions/stuck-transfer/confirm")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "failed"
    assert body["result"]["outcome"] == "unknown"
