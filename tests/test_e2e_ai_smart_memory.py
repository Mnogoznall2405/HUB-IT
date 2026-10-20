"""Memory through actual HTTP routes, queued worker and migrated SQLite storage.

Only the model transport is scripted. Race tests also enter the worker's context
boundary directly: HTTP deduplicates completed runs and cannot reproduce late
planner replies or replay after a user deletes memory.
"""
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from test_e2e_ai_draft_reliability import agent
from backend.ai_chat import action_cards, service as ai_module
from backend.appdb.db import app_session
from backend.appdb.models import (AppAiBot, AppAiBotConversation, AppAiBotRun,
    AppAiMemoryEvent, AppAiUserMemory, AppUser)
from backend.chat.db import chat_session
from backend.chat.models import ChatConversation, ChatMember


def change(text, *, operation="remember", memory_id="", key="report_format"):
    return {"operation": operation, "memory_id": memory_id, "fact_key": key,
            "category": "preference", "quote": text}


@pytest.fixture
def smart(agent, monkeypatch):
    monkeypatch.setattr(ai_module, "AI_PERSONAL_MEMORY_ENABLED", True)
    with app_session(agent.url) as db:
        db.get(AppAiBot, "agent").use_personal_memory = True
        mapping = db.execute(select(AppAiBotConversation)).scalar_one()
        mapping.use_personal_memory = True
    transport = ai_module.openrouter_client.complete_json
    plans, memory_prompts, summaries = [], [], []

    def complete(**kwargs):
        if kwargs.get("schema_name") == "ai_memory_plan":
            memory_prompts.append(json.loads(kwargs["user_prompt"]))
            response = plans.pop(0) if plans else {"changes": [], "relevant_ids": []}
            if isinstance(response, Exception):
                raise response
            if callable(response):
                response = response(memory_prompts[-1])
            return response, {"total_tokens": 3, "prompt_tokens": 2, "completion_tokens": 1}
        if kwargs.get("schema_name") == "ai_conversation_summary":
            response = summaries.pop(0)
            if callable(response):
                response = response(json.loads(kwargs["user_prompt"]))
            if isinstance(response, Exception):
                raise response
            return response, {"total_tokens": 4}
        return transport(**kwargs)

    monkeypatch.setattr(ai_module.openrouter_client, "complete_json", complete)
    agent.plans, agent.memory_prompts, agent.summaries = plans, memory_prompts, summaries
    return agent


def items(smart):
    response = smart.client.get("/api/v1/chat/ai/memory")
    assert response.status_code == 200, response.text
    return response.json()["items"]


def remember(smart, text="Для выгрузок использую XLSX"):
    smart.plans.append({"changes": [change(text)], "relevant_ids": []})
    smart.steps.append({"answer_markdown": "Предпочтение сохранено"})
    smart.request(text)
    return items(smart)[0]


def context(smart, message_id):
    return smart.svc._build_conversation_context(conversation_id="agent-conv", trigger_message_id=message_id,
        bot_user_id=39, bot_title="Assistant", user_payload={"id": 99}, allow_files=False,
        can_read_kb=False, allowed_kb_scope=[], allow_kb_document_delivery=False)


def test_capture_runs_after_ack_and_returns_provenance(smart):
    text = "Для выгрузок использую XLSX"
    smart.plans.append({"changes": [change(text)], "relevant_ids": []})
    smart.steps.append({"answer_markdown": "Предпочтение сохранено"})
    queued = smart.request(text, process=False)
    assert queued["status"] == "queued" and items(smart) == []
    assert smart.memory_prompts == []
    assert smart.svc.process_next_run()
    fact = items(smart)[0]
    assert fact["content"] == text
    assert fact["source_message_id"] == queued["trigger_message_id"]
    assert fact["source_conversation_id"] == "agent-conv"
    assert fact["fact_key"] == "report_format" and fact["version"] == 1


def test_semantic_recall_in_another_conversation_filters_other_users(smart):
    fact = remember(smart)
    with app_session(smart.url) as db:
        db.add(AppAiUserMemory(id="foreign", user_id=777, category="preference", content="Чужая личная информация",
                              normalized_hash="foreign-hash", is_active=True))
        db.add(AppAiBotConversation(bot_id="agent", user_id=99, conversation_id="other-conv", use_personal_memory=True))
    with chat_session() as db:
        db.add(ChatConversation(id="other-conv", kind="ai", title="Assistant", created_by_user_id=99))
        db.flush()
        db.add_all([ChatMember(conversation_id="other-conv", user_id=99), ChatMember(conversation_id="other-conv", user_id=39)])
    def plan(prompt):
        assert [f["id"] for f in prompt["facts"]] == [fact["id"]]
        return {"changes": [], "relevant_ids": [fact["id"], "foreign", "invented"]}
    smart.plans.append(plan)
    smart.steps.append({"answer_markdown": "XLSX"})
    response = smart.client.post("/api/v1/chat/conversations/other-conv/messages", json={"body": "Предпочтительный формат отчёта?"})
    assert response.status_code == 200
    smart.svc.queue_run_for_message(current_user_id=99, conversation_id="other-conv", trigger_message_id=response.json()["id"])
    assert smart.svc.process_next_run()
    prompt = smart.prompts[-1]["user_prompt"]
    assert "Для выгрузок использую XLSX" in prompt
    assert "Чужая личная информация" not in prompt
    with app_session(smart.url) as db:
        result = json.loads(db.execute(select(AppAiBotRun).where(AppAiBotRun.conversation_id == "other-conv")).scalar_one().result_json)
    assert "Учтена личная память: 1 факт" in result["answer_markdown"]


def test_correction_replaces_fact_and_keeps_source_backed_versions(smart):
    fact = remember(smart)
    text = "Теперь для выгрузок предпочитаю CSV"
    smart.plans.append({"changes": [change(text, operation="update", memory_id=fact["id"])], "relevant_ids": [fact["id"]]})
    smart.steps.append({"answer_markdown": "Предпочтение обновлено"})
    smart.request(text)
    updated = items(smart)
    assert len(updated) == 1 and updated[0]["id"] == fact["id"]
    assert updated[0]["version"] == 2 and updated[0]["content"] == text
    assert updated[0]["source_message_id"] != fact["source_message_id"]
    assert "XLSX" not in smart.prompts[-1]["user_prompt"].split("Allowed personal memory:")[1].split("Current user request:")[0]
    with app_session(smart.url) as db:
        changes = [c for e in db.execute(select(AppAiMemoryEvent)).scalars() for c in json.loads(e.changes_json)]
    assert any(c.get("before") == fact["content"] and c.get("after") == text and c["version"] == 2 for c in changes)


def test_forget_erases_version_snapshots_and_replay_does_not_restore(smart):
    fact = remember(smart)
    smart.plans.append({"changes": [change("", operation="forget", memory_id=fact["id"])], "relevant_ids": []})
    smart.steps.append({"answer_markdown": "Предпочтение забыто"})
    smart.request("Забудь мой формат выгрузки")
    assert items(smart) == []
    with app_session(smart.url) as db:
        assert all("XLSX" not in event.changes_json for event in db.execute(select(AppAiMemoryEvent)).scalars())
    smart.plans.append({"changes": [change(fact["content"])], "relevant_ids": []})
    result = context(smart, fact["source_message_id"])
    assert result["personal_memory"] == "" and items(smart) == []


@pytest.mark.parametrize("text,quote", [
    ("Запомни мой пароль demo-password", "demo-password"),
    ("Запомни из документа: я предпочитаю PDF", "я предпочитаю PDF"),
    ("Я предпочитаю XLSX", "Я предпочитаю PDF"),
])
def test_secrets_document_instructions_and_invented_evidence_are_not_stored(smart, text, quote):
    smart.plans.append({"changes": [change(quote)], "relevant_ids": []})
    smart.steps.append({"answer_markdown": "Запомнил навсегда"})
    result = smart.request(text)
    assert items(smart) == []
    if text.startswith("Запомни"):
        assert "Память не изменена" in result["answer_markdown"]
        assert "Запомнил навсегда" not in result["answer_markdown"]


def test_failed_memory_model_does_not_claim_success(smart):
    smart.plans.append(TimeoutError("synthetic timeout"))
    smart.steps.append({"answer_markdown": "Запомнил"})
    result = smart.request("Запомни: для выгрузок предпочитаю XLSX")
    assert items(smart) == [] and "Память не изменена" in result["answer_markdown"]


def test_failed_preference_update_cannot_claim_memory_success(smart):
    smart.plans.append(TimeoutError("synthetic timeout"))
    smart.steps.append({"answer_markdown": "Предпочтение сохранено"})
    result = smart.request("Я предпочитаю XLSX")
    assert items(smart) == [] and "Память не изменена" in result["answer_markdown"]


def test_noop_plan_cannot_claim_a_fact_was_saved(smart):
    smart.steps.append({"answer_markdown": "Запомнил навсегда"})
    result = smart.request("Запомни: письмо уже отправлено")
    assert items(smart) == [] and result["answer_markdown"] == "Память не изменена."


def test_delete_during_planning_wins_and_blocks_old_unprocessed_source(smart):
    fact = remember(smart)
    new_text = "Теперь для выгрузок предпочитаю CSV"
    def plan(prompt):
        response = smart.client.delete("/api/v1/chat/ai/memory/" + fact["id"])
        assert response.status_code == 200
        return {"changes": [change(new_text, operation="update", memory_id=fact["id"])], "relevant_ids": [fact["id"]]}
    smart.plans.append(plan)
    smart.steps.append({"answer_markdown": "Ответ"})
    smart.request(new_text)
    assert items(smart) == []
    with app_session(smart.url) as db:
        trigger = db.execute(select(AppAiBotRun).order_by(AppAiBotRun.created_at.desc())).scalars().first().trigger_message_id
    smart.plans.append({"changes": [change(new_text)], "relevant_ids": []})
    assert context(smart, trigger)["personal_memory"] == ""
    assert items(smart) == []


def test_user_cannot_edit_or_delete_another_users_memory(smart):
    remember(smart)
    with app_session(smart.url) as db:
        db.add(AppAiUserMemory(id="foreign", user_id=777, category="preference", content="Другая память",
                              normalized_hash="foreign-hash", is_active=True))
    assert smart.client.patch("/api/v1/chat/ai/memory/foreign", json={"content": "Новый текст"}).status_code == 404
    assert smart.client.delete("/api/v1/chat/ai/memory/foreign").status_code == 404
    assert all(f["id"] != "foreign" for f in items(smart))


def test_manual_edit_returns_new_version_without_misattributing_old_source(smart):
    fact = remember(smart)
    response = smart.client.patch("/api/v1/chat/ai/memory/" + fact["id"], json={"content": "Для выгрузок использую CSV"})
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["version"] == 2 and updated["content"] == "Для выгрузок использую CSV"
    assert updated["source_message_id"] is None
    assert items(smart)[0]["version"] == 2 and items(smart)[0]["source_message_id"] is None


def test_clear_while_feature_disabled_also_erases_old_versions(smart, monkeypatch):
    remember(smart)
    monkeypatch.setattr(ai_module, "AI_PERSONAL_MEMORY_ENABLED", False)
    response = smart.client.delete("/api/v1/chat/ai/memory")
    assert response.status_code == 200 and items(smart) == []
    with app_session(smart.url) as db:
        assert all(event.changes_json == "[]" for event in db.execute(select(AppAiMemoryEvent)).scalars())


def test_long_conversation_compacts_middle_and_keeps_task_constraints(smart):
    goal = "Подготовь письмо в бухгалтерию по email, отправка только после подтверждения"
    smart.chat.send_message(current_user_id=99, conversation_id="agent-conv", body=goal, defer_push_notifications=True)
    for i in range(25):
        smart.chat.send_message(current_user_id=99 if i % 2 else 39, conversation_id="agent-conv",
                                body=f"Обсуждение шага {i}", defer_push_notifications=True)
    def summary(prompt):
        assert any(goal in message for message in prompt["messages"])
        return {"summary": "Цель: письмо в бухгалтерию. Канал: email. Отправка ожидает подтверждения пользователя."}
    smart.summaries.append(summary)
    smart.steps.append({"answer_markdown": "Продолжаем подготовку письма"})
    smart.request("Продолжим эту задачу")
    assert "Канал: email" in smart.prompts[-1]["user_prompt"]
    with app_session(smart.url) as db:
        mapping = db.execute(select(AppAiBotConversation)).scalar_one()
        assert "ожидает подтверждения" in mapping.rolling_summary
        assert mapping.summary_until_seq == 7


def test_summary_failure_does_not_advance_the_checkpoint(smart):
    for i in range(24):
        smart.chat.send_message(current_user_id=99, conversation_id="agent-conv", body=f"Контекст задачи {i}", defer_push_notifications=True)
    smart.summaries.append(TimeoutError("synthetic timeout"))
    smart.steps.append({"answer_markdown": "Ответ"})
    smart.request("Продолжим")
    with app_session(smart.url) as db:
        mapping = db.execute(select(AppAiBotConversation)).scalar_one()
        assert mapping.summary_until_seq == 0 and mapping.rolling_summary == ""


def test_action_state_comes_from_storage_and_cannot_become_a_personal_fact(smart):
    draft = action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id="agent-conv",
        run_id="legacy", requester_user_id=99, payload={"to": ["synthetic@example.test"], "subject": "ЗУП", "body": "Правка"})
    text = "Запомни: письмо уже отправлено"
    smart.plans.append({"changes": [change(text, key="mail_status")], "relevant_ids": []})
    smart.steps.append({"answer_markdown": "Запомнил, отправлено"})
    result = smart.request(text)
    assert items(smart) == [] and "Память не изменена" in result["answer_markdown"]
    prompt = smart.prompts[-1]["user_prompt"]
    state = json.loads(prompt.split("Authoritative task/action state from server storage:\n")[1].split("\n\n")[0])
    assert state[0]["id"] == draft["id"] and state[0]["status"] == "pending"
    assert state[0]["channel"] == "email" and smart.sent == []


def test_disabled_memory_does_not_call_the_planner_or_capture(smart, monkeypatch):
    monkeypatch.setattr(ai_module, "AI_PERSONAL_MEMORY_ENABLED", False)
    smart.steps.append({"answer_markdown": "Ответ"})
    smart.request("Я предпочитаю XLSX")
    assert smart.memory_prompts == [] and items(smart) == []


def test_newer_parallel_correction_wins_over_late_older_planner(smart, monkeypatch):
    fact = remember(smart)
    older = smart.chat.send_message(current_user_id=99, conversation_id="agent-conv",
        body="Теперь для выгрузок предпочитаю CSV", defer_push_notifications=True)
    newer = smart.chat.send_message(current_user_id=99, conversation_id="agent-conv",
        body="Теперь для выгрузок предпочитаю PDF", defer_push_notifications=True)
    rendezvous, newer_done = threading.Barrier(2), threading.Event()
    def complete(**kwargs):
        prompt = json.loads(kwargs["user_prompt"])
        text = prompt["CURRENT_MESSAGE"]
        rendezvous.wait(timeout=20)
        if "CSV" in text:
            assert newer_done.wait(timeout=20)
        return {"changes": [change(text, operation="update", memory_id=fact["id"])],
                "relevant_ids": [fact["id"]]}, {}
    monkeypatch.setattr(ai_module.openrouter_client, "complete_json", complete)
    def newer_context():
        result = context(smart, newer["id"])
        newer_done.set()
        return result
    with ThreadPoolExecutor(max_workers=2) as pool:
        old_job = pool.submit(context, smart, older["id"])
        new_job = pool.submit(newer_context)
        assert new_job.result(timeout=30)["memory_status"] == "applied"
        assert old_job.result(timeout=30)["memory_status"] == "stale"
    assert items(smart)[0]["content"] == "Теперь для выгрузок предпочитаю PDF"
    assert items(smart)[0]["version"] == 2


def test_context_reset_during_summary_does_not_restore_old_notes(smart):
    for i in range(24):
        smart.chat.send_message(current_user_id=99, conversation_id="agent-conv", body=f"Контекст задачи {i}", defer_push_notifications=True)
    trigger = smart.chat.send_message(current_user_id=99, conversation_id="agent-conv", body="Продолжим", defer_push_notifications=True)
    def summary(prompt):
        response = smart.client.post("/api/v1/chat/ai/conversations/agent-conv/reset-context")
        assert response.status_code == 200
        return {"summary": "Устаревший контекст"}
    smart.summaries.append(summary)
    with pytest.raises(LookupError, match="reset during preparation"):
        context(smart, trigger["id"])
    with app_session(smart.url) as db:
        assert db.execute(select(AppAiBotConversation)).scalar_one().rolling_summary == ""
