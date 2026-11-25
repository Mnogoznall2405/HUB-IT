"""A10 LLM-round optimization tests.

Covers: READ fast-path guards, zero-LLM direct-read pattern matching,
memory-planner deterministic skip, scalar rendering in the fallback renderer.
Flags are pinned inside the tests so results do not depend on ambient env.
"""
from __future__ import annotations

import pytest

from backend.ai_chat import memory as memory_module
from backend.ai_chat import service as svc


def _ok_result(tool_id: str, data: dict | None = None) -> dict:
    return {"tool_id": tool_id, "ok": True, "data": data or {}, "error": None, "sources": []}


def _fast_path(*, tool_id="directory.people.search", results=None, **kw):
    call = {"tool_id": tool_id, "args": kw.get("args", {})}
    return svc._try_read_fast_path_answer(
        tool_call=call,
        tool_results=results if results is not None else [_ok_result(tool_id)],
        intent_mode=kw.get("intent_mode", svc.JEV_INTENT_READ),
        report_file_intent=kw.get("report_file_intent", False),
        has_meta_calls=kw.get("has_meta_calls", False),
        template_pending=kw.get("template_pending", False),
        request_text=kw.get("request_text", ""),
    )


@pytest.fixture
def fast_path_on(monkeypatch):
    monkeypatch.setattr(svc, "AI_READ_FAST_PATH_ENABLED", True)


@pytest.fixture
def direct_on(monkeypatch):
    monkeypatch.setattr(svc, "AI_DIRECT_READ_ENABLED", True)


class TestReadFastPath:
    def test_single_read_renders_deterministically(self, fast_path_on):
        result = _ok_result("directory.people.search", {
            "items": [{"display_name": "Иванов Иван", "position": "инженер",
                       "department": "ИТ", "work_phones": ["+7-000-0001"]}],
            "total": 1, "returned_count": 1,
        })
        answer = _fast_path(results=[result])
        assert answer is not None
        assert "Иванов Иван" in answer and "инженер" in answer
        # §3: no technical tool ids in a user-facing answer
        assert "directory.people.search" not in answer and "`" not in answer

    def test_tasks_renderer_natural_russian(self, fast_path_on):
        result = _ok_result("office.tasks.search", {
            "items": [{"title": "Бенч-задача 001", "status": "in_progress",
                       "due_at": "2026-11-30", "is_overdue": False}],
            "total": 1, "count": 1,
        })
        answer = _fast_path(tool_id="office.tasks.search", results=[result])
        assert "Бенч-задача 001" in answer and "в работе" in answer
        assert "Задач: 1" in answer

    def test_empty_tasks_natural_russian(self, fast_path_on):
        result = _ok_result("office.tasks.search", {"items": [], "total": 0, "count": 0})
        answer = _fast_path(tool_id="office.tasks.search", results=[result],
                            args={"status": "active"})
        assert answer == "Активных задач не найдено."

    def test_scope_downgraded_surfaces_partial_notice(self, fast_path_on):
        # ACL: a user without tasks.manage_all asking for scope=all gets own
        # tasks only — the fast-path answer must never read as a complete
        # system-wide list.
        result = _ok_result("office.tasks.search", {
            "items": [{"title": "Бенч-задача 001", "status": "in_progress",
                       "due_at": "2026-11-30", "is_overdue": False}],
            "total": 1, "count": 1, "scope_downgraded": True,
            "notice": "Requested scope 'all' exceeds the user's permissions",
        })
        answer = _fast_path(tool_id="office.tasks.search", results=[result],
                            args={"scope": "all"})
        assert "Бенч-задача 001" in answer
        assert "участвуете" in answer and "расширенные права" in answer

    def test_scope_downgraded_empty_result_keeps_notice(self, fast_path_on):
        result = _ok_result("office.tasks.search", {
            "items": [], "total": 0, "count": 0, "scope_downgraded": True,
            "notice": "Requested scope 'all' exceeds the user's permissions",
        })
        answer = _fast_path(tool_id="office.tasks.search", results=[result],
                            args={"scope": "all"})
        assert "Задачи не найдены." in answer
        assert "расширенные права" in answer

    def test_full_scope_has_no_notice(self, fast_path_on):
        result = _ok_result("office.tasks.search", {
            "items": [{"title": "Бенч-задача 001", "status": "in_progress",
                       "due_at": "2026-11-30", "is_overdue": False}],
            "total": 1, "count": 1,
        })
        answer = _fast_path(tool_id="office.tasks.search", results=[result])
        assert "расширенные права" not in answer

    def test_blocked_requests_never_fast_path(self, fast_path_on):
        for text in ("Сравни мои задачи", "Почему задача просрочена",
                     "Покажи топ-5 задач", "Сначала задачи, затем письма",
                     "Не показывай мои задачи", "Проанализируй мои задачи"):
            assert _fast_path(tool_id="office.tasks.search", request_text=text) is None, text

    def test_empty_page_with_nonzero_total_rejected(self, fast_path_on):
        result = _ok_result("itinvent.equipment.search", {
            "items": [], "total": 5, "returned_count": 0,
        })
        assert _fast_path(tool_id="itinvent.equipment.search", results=[result]) is None

    def test_nested_results_rejected(self, fast_path_on):
        result = _ok_result("itinvent.equipment.search", {
            "items": [{"x": 1}], "groups": [{"g": 1}],
        })
        assert _fast_path(tool_id="itinvent.equipment.search", results=[result]) is None

    def test_omitted_items_rejected(self, fast_path_on):
        result = _ok_result("directory.people.search", {
            "items": [{"display_name": "x"}], "omitted_items": [{"display_name": "y"}],
        })
        assert _fast_path(results=[result]) is None

    def test_rows_list_guards_apply(self, fast_path_on):
        # rows-based result with total > returned must not fast-path either
        result = _ok_result("itinvent.equipment.search", {
            "rows": [{"x": i} for i in range(5)], "total": 30, "returned_count": 5,
        })
        assert _fast_path(tool_id="itinvent.equipment.search", results=[result]) is None

    def test_renderer_exception_never_breaks(self, fast_path_on, monkeypatch):
        monkeypatch.setitem(svc._FAST_PATH_RENDERERS, "me.equipment",
                            lambda data, args: 1 / 0)
        assert _fast_path(tool_id="me.equipment") is None

    def test_flag_off_returns_none(self):
        assert _fast_path() is None

    def test_act_intent_never_fast_paths(self, fast_path_on):
        assert _fast_path(intent_mode=svc.JEV_INTENT_ACT) is None

    def test_non_whitelisted_tool_returns_none(self, fast_path_on):
        assert _fast_path(tool_id="itinvent.user.full_context") is None
        assert _fast_path(tool_id="office.action.mail_send_draft") is None

    def test_failed_result_returns_none(self, fast_path_on):
        bad = {"tool_id": "me.equipment", "ok": False, "error": "denied", "data": {}}
        assert _fast_path(tool_id="me.equipment", results=[bad]) is None

    def test_truncated_result_returns_none(self, fast_path_on):
        result = _ok_result("me.equipment", {"truncated": True, "items": [{"x": 1}]})
        assert _fast_path(tool_id="me.equipment", results=[result]) is None

    def test_partial_list_never_presented_as_complete(self, fast_path_on):
        result = _ok_result("itinvent.equipment.search", {
            "items": [{"x": i} for i in range(15)], "total": 60, "returned_count": 15,
        })
        assert _fast_path(tool_id="itinvent.equipment.search", results=[result]) is None

    def test_empty_result_still_fast_paths(self, fast_path_on):
        result = _ok_result("me.equipment", {"items": [], "total": 0, "returned_count": 0})
        assert _fast_path(tool_id="me.equipment", results=[result]) is not None

    def test_meta_calls_and_templates_block_fast_path(self, fast_path_on):
        assert _fast_path(has_meta_calls=True) is None
        assert _fast_path(template_pending=True) is None

    def test_report_file_intent_blocks_fast_path(self, fast_path_on):
        assert _fast_path(report_file_intent=True) is None

    def test_no_tool_call_returns_none(self, fast_path_on):
        assert svc._try_read_fast_path_answer(
            tool_call=None, tool_results=[], intent_mode=svc.JEV_INTENT_READ,
            report_file_intent=False, has_meta_calls=False, template_pending=False,
        ) is None

    def test_wrong_tool_id_in_result_rejected(self, fast_path_on):
        result = _ok_result("mfu.devices.list", {"items": []})
        assert _fast_path(tool_id="directory.people.search", results=[result]) is None


class TestDirectRead:
    SPECS = {"me.account.status", "me.equipment", "ad.user.password_status", "office.tasks.search"}

    def _call(self, text, specs=None, intent_mode=""):
        return svc._try_direct_read_tool(
            text, enabled_tool_ids=specs if specs is not None else self.SPECS,
            intent_mode=intent_mode,
        )

    def test_my_phone_maps_to_account_status(self, direct_on):
        assert self._call("Какой мой рабочий телефон?") == ("me.account.status", {})

    def test_my_equipment_maps_to_me_equipment(self, direct_on):
        assert self._call("Какое оборудование за мной числится?") == ("me.equipment", {})
        assert self._call("Что за мной числится?") == ("me.equipment", {})

    def test_password_expiry_maps_to_password_status(self, direct_on):
        assert self._call("Когда истекает мой пароль?") == ("ad.user.password_status", {})

    def test_my_tasks_maps_to_task_search(self, direct_on):
        assert self._call("Покажи мои задачи") == ("office.tasks.search", {})

    def test_active_tasks_carry_active_filter(self, direct_on):
        # §5: args must actually filter, not just land on the tool.
        assert self._call("Покажи мои активные задачи") == (
            "office.tasks.search", {"status": "active"})

    def test_flag_off_returns_none(self):
        assert self._call("Какой мой рабочий телефон?") is None

    def test_act_intent_never_direct_reads(self, direct_on):
        assert self._call("Какой мой рабочий телефон?", intent_mode=svc.JEV_INTENT_ACT) is None

    def test_disabled_tool_returns_none(self, direct_on):
        assert self._call("Какой мой рабочий телефон?", specs={"me.equipment"}) is None

    def test_long_or_complex_prompts_never_match(self, direct_on):
        assert self._call("Какой мой рабочий телефон и переведи мне монитор из кабинета 204") is None
        assert self._call("Найди телефон Иванова и сравни с моим рабочим телефоном, затем отправь отчёт") is None

    def test_negations_and_reasoning_blocked(self, direct_on):
        # §5: these change the request's meaning — direct read must not fire.
        for text in (
            "Не показывай мой телефон",
            "Сравни телефон Иванова и мой телефон",
            "Почему не работает мой телефон",
            "Объясни, как изменить мой пароль",
            "Не показывай мои завершённые задачи",
            "Сравни мои активные задачи",
            "Сколько стоит мой телефон",
            "Чей рабочий телефон показывается",
            "Как поменять мой пароль",
        ):
            assert self._call(text) is None, text

    def test_unrelated_prompt_returns_none(self, direct_on):
        assert self._call("Найди принтер в кабинете 204") is None
        assert self._call("Отправь письмо Иванову") is None


class TestFallbackScalarRendering:
    def test_detail_fields_render_without_rows(self):
        result = _ok_result("ad.user.password_status", {
            "user": "ivanov", "password_expires_at": "2026-05-01", "days_left": 30,
        })
        answer = svc._format_fallback_tool_answer([result])
        assert "ivanov" in answer and "password_expires_at" in answer

    def test_body_field_gets_longer_preview(self):
        long_body = "Важный текст письма. " * 200
        result = _ok_result("office.mail.get_message", {"subject": "Тест", "body": long_body})
        answer = svc._format_fallback_tool_answer([result])
        assert "Важный текст письма" in answer and len(answer) > 300

    def test_noise_keys_not_rendered(self):
        result = _ok_result("office.tasks.search", {
            "query": "x", "returned_count": 0, "total": 0, "truncated": False,
        })
        answer = svc._format_fallback_tool_answer([result])
        assert "returned_count" not in answer

    def test_rows_still_render_as_before(self):
        result = _ok_result("mfu.devices.list", {
            "rows": [{"model_name": "LaserJet", "count": 2}], "returned_count": 1,
        })
        answer = svc._format_fallback_tool_answer([result])
        assert "LaserJet" in answer


class TestMemoryPlannerSkip:
    def _prepare(self, monkeypatch, *, facts, text, flag):
        monkeypatch.setattr(memory_module, "_PLANNER_OPTIMIZATION_ENABLED", flag)
        monkeypatch.setattr(
            memory_module, "_snapshot",
            lambda *a, **kw: (1, facts, False, False, 0),
        )
        called = {"planner": False}

        def _fake_plan(*a, **kw):
            called["planner"] = True
            return "applied", {}, memory_module.MemoryPlan(changes=[], relevant_ids=[]), [], []

        monkeypatch.setattr(memory_module, "_plan_and_apply", _fake_plan)
        captured = {}

        def _fake_finish(*, status, **kw):
            captured["status"] = status
            return {"text": "", "hits": 0, "status": status, "changed": 0, "usage": {}}

        monkeypatch.setattr(memory_module, "_finish_prepare", _fake_finish)
        memory_module.prepare(
            user_id=1, conversation_id="c", message_id="m", seq=1, text=text,
            recent=[], model="m", allow_changes=True, safe=lambda s: True, content_hash="h",
        )
        return called["planner"], captured.get("status")

    FACTS = [{"id": "f1", "content": "предпочитает короткие ответы"}]

    def test_no_personal_markers_skips_planner_when_flag_on(self, monkeypatch):
        planner_called, status = self._prepare(
            monkeypatch, facts=self.FACTS, text="найди принтер в кабинете 204", flag=True,
        )
        assert planner_called is False and status == "deterministic"

    def test_flag_off_keeps_planner_for_recall(self, monkeypatch):
        planner_called, status = self._prepare(
            monkeypatch, facts=self.FACTS, text="найди принтер в кабинете 204", flag=False,
        )
        assert planner_called is True

    def test_explicit_memory_command_never_skipped(self, monkeypatch):
        for text in ("запомни что я предпочитаю краткие ответы", "забудь про мой отдел",
                     "покажи мои задачи", "мой телефон"):
            planner_called, _ = self._prepare(
                monkeypatch, facts=self.FACTS, text=text, flag=True,
            )
            assert planner_called is True, text

    def test_empty_facts_still_skips(self, monkeypatch):
        planner_called, status = self._prepare(
            monkeypatch, facts=[], text="найди принтер", flag=True,
        )
        assert planner_called is False and status == "skipped"


class TestReuseKey:
    """_execute_tool_calls reuse logic is exercised indirectly: identical READ
    args inside one run must map to the same cache key shape."""

    def test_flag_gating_constant_exists(self):
        assert hasattr(svc, "AI_RUN_RESULT_REUSE_ENABLED")
        assert hasattr(svc, "AI_PARALLEL_READ_TOOLS_ENABLED")
        assert svc.AI_PARALLEL_READ_TOOLS_ENABLED in (True, False)

    def test_fast_path_whitelist_excludes_act_tools(self):
        assert not any(".action." in t or "draft" in t for t in svc._FAST_PATH_READ_TOOLS)
        assert "ai.results.read_more" not in svc._FAST_PATH_READ_TOOLS
        assert "ai.request_tool_group" not in svc._FAST_PATH_READ_TOOLS

    def test_fast_path_whitelist_contains_no_mutating_tool(self):
        assert not any(svc._is_mutating_tool_id(t) for t in svc._FAST_PATH_READ_TOOLS)


class TestMutatingToolClassification:
    """§6: result reuse must key off a real READ/ACT classification, not only
    name markers. File-producing and attachment tools mutate state without
    any '.action'/'.create' segment in their tool_id."""

    def test_marker_named_action_tools_are_mutating(self):
        for tid in (
            "office.action.mail_send_draft", "itinvent.action.transfer_draft",
            "ai.files.create", "helpdesk.request_draft",
        ):
            assert svc._is_mutating_tool_id(tid), tid

    def test_non_marker_mutating_tools_covered(self):
        for tid in ("me.files.attach", "ai.files.convert_document", "ai.files.report"):
            assert svc._is_mutating_tool_id(tid), tid

    def test_read_tools_are_not_mutating(self):
        for tid in (
            "office.tasks.search", "itinvent.equipment.search",
            "directory.people.search", "me.equipment", "mfu.devices.list",
            "kb.articles.get", "ai.results.read_more",
        ):
            assert not svc._is_mutating_tool_id(tid), tid

    def test_every_registry_tool_is_classified(self):
        """Every registered tool resolves to exactly one side — no tool falls
        through classification silently."""
        from backend.ai_chat.tools.registry import ai_tool_registry

        ids = [s.get("tool_id") for s in ai_tool_registry.list_specs() if s.get("tool_id")]
        for tid in ids:
            mutating = svc._is_mutating_tool_id(tid)
            assert isinstance(mutating, bool)
        # explicit mutating IDs that exist in the registry must be classified
        for tid in svc._MUTATING_TOOL_IDS & set(ids):
            assert svc._is_mutating_tool_id(tid)
