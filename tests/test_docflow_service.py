from __future__ import annotations

import asyncio
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import docflow as docflow_api  # noqa: E402
from backend.services import docflow_1c_client as docflow_1c_client_module  # noqa: E402
from backend.models.auth import User  # noqa: E402
from backend.models.docflow import DocflowTaskActionRequest  # noqa: E402
from backend.services.docflow_1c_client import (  # noqa: E402
    Docflow1CComClient,
    Docflow1CConflictError,
)
from backend.services.docflow_1c_client import (  # noqa: E402
    Docflow1CFileStorageUnavailableError,
    Docflow1CNotFoundError,
)
from backend.services.docflow_service import (  # noqa: E402
    DocflowActionOutcomeUnknown,
    Docflow1CAdapter,
    Docflow1CBridgePool,
    DocflowCredentialsInvalid,
    DocflowFileStorageUnavailable,
    DocflowService,
    DocflowStateConflict,
)
from backend.services.docflow_action_rules import configuration_fingerprint, load_action_rules  # noqa: E402
from backend.services.request_metrics_service import request_metrics_middleware  # noqa: E402
from backend.services.secret_crypto_service import (  # noqa: E402
    _build_fernet,
    decrypt_docflow_secret,
    encrypt_docflow_secret,
)
from backend.services.warehouse_1c_process_bridge import (  # noqa: E402
    Warehouse1CProcessBridgeRemoteError,
)


class FakeAdapter:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.error: Exception | None = None
        self.completed = False
        self.result = None

    async def call(self, operation: str, payload: dict):
        self.calls.append((operation, dict(payload)))
        if self.error is not None:
            raise self.error
        if operation == "test_connection":
            return {
                "connected": True,
                "configuration": "docflow",
                "verified_at": datetime.now(timezone.utc).isoformat(),
            }
        if operation == "tasks":
            return {
                "items": [],
                "returned": 0,
                "scope": payload.get("scope", "inbox"),
                "source": "live_1c",
                "as_of": datetime.now(timezone.utc).isoformat(),
                "truncated": False,
            }
        if operation in {"task_detail", "task_state"}:
            return {
                "ref": payload.get("task_ref"),
                "task_type": "ЗадачаИсполнителя",
                "task_type_label": "Задача исполнителя",
                "title": "HUB-IT TEST · Тестовое задание",
                "process_ref": "22222222-2222-2222-2222-222222222222",
                "process_type": "Согласование",
                "process_type_label": "Согласование",
                "result": self.result,
                "completed": self.completed,
                "files": [],
            }
        if operation == "task_action":
            self.completed = True
            self.result = str(payload.get("result_template") or "").replace(
                "{comment}",
                str(payload.get("comment") or ""),
            ).strip()
            return {
                "before": {"ref": payload.get("task_ref"), "completed": False},
                "task": {
                    "ref": payload.get("task_ref"),
                    "task_type": "ЗадачаИсполнителя",
                    "task_type_label": "Задача исполнителя",
                    "title": "HUB-IT TEST · Тестовое задание",
                    "process_type": "Согласование",
                    "result": self.result,
                    "completed": True,
                    "files": [],
                },
            }
        if operation == "assignment_documents":
            return {
                "items": [{
                    "ref": "33333333-3333-3333-3333-333333333333",
                    "document_type": "internal",
                    "document_type_label": "Внутренний документ",
                    "title": "HUB-IT TEST документ",
                    "number": "1",
                    "date": "2026-07-29T10:00:00",
                }],
                "returned": 1,
                "truncated": False,
                "as_of": datetime.now(timezone.utc).isoformat(),
            }
        if operation == "assignment_assignees":
            return {
                "items": [{
                    "ref": "44444444-4444-4444-4444-444444444444",
                    "name": "Тестовый исполнитель",
                    "department": "ИТ",
                }],
                "returned": 1,
                "truncated": False,
                "as_of": datetime.now(timezone.utc).isoformat(),
            }
        if operation == "assignment_create":
            return {
                "exists": True,
                "process_ref": payload.get("process_ref"),
                "task_ref": "55555555-5555-5555-5555-555555555555",
                "title": payload.get("title"),
                "state": "В работе",
                "task_completed": False,
            }
        if operation == "assignment_state":
            return {
                "exists": False,
                "process_ref": payload.get("process_ref"),
                "task_ref": None,
            }
        return {
            "configuration": "docflow",
            "task_types": [],
            "active_task_type": "ЗадачаИсполнителя",
            "mapping_ready": False,
        }

    def shutdown(self) -> None:
        return None


class FakeStore:
    def __init__(self) -> None:
        self.row = None
        self.audit_events: list[dict] = []

    def get(self, user_id: int):
        return self.row if self.row and self.row.user_id == user_id else None

    def upsert_valid(self, *, user_id: int, login: str, password_enc: str, verified_at: datetime):
        self.row = SimpleNamespace(
            user_id=user_id,
            login=login,
            password_enc=password_enc,
            credential_version=int(getattr(self.row, "credential_version", 0)) + 1,
            status="valid",
            last_error_code=None,
            last_verified_at=verified_at,
            updated_at=datetime.now(timezone.utc),
        )
        return self.row

    def set_status(self, *, user_id: int, status: str, error_code: str | None):
        if self.row and self.row.user_id == user_id:
            self.row.status = status
            self.row.last_error_code = error_code

    def delete(self, user_id: int) -> bool:
        existed = bool(self.row and self.row.user_id == user_id)
        if existed:
            self.row = None
        return existed

    def audit(self, **payload):
        self.audit_events.append(dict(payload))


class FakeCommandStore:
    def __init__(self) -> None:
        self.rows: dict[str, SimpleNamespace] = {}

    def get_by_key(self, *, user_id, idempotency_key):
        return next(
            (
                row for row in self.rows.values()
                if row.user_id == user_id and row.idempotency_key == idempotency_key
            ),
            None,
        )

    def begin(self, **payload):
        existing = self.get_by_key(
            user_id=payload["user_id"],
            idempotency_key=payload["idempotency_key"],
        )
        if existing is not None:
            return existing, False
        row = SimpleNamespace(
            id=f"{len(self.rows) + 1:032x}",
            status="pending",
            outcome=None,
            error_code=None,
            remote_after_json="{}",
            **payload,
        )
        self.rows[row.id] = row
        return row, True

    def get_for_user(self, *, user_id, command_id):
        row = self.rows.get(command_id)
        return row if row and row.user_id == user_id else None

    def finish(self, *, command_id, status, outcome, error_code, remote_after_json):
        row = self.rows[command_id]
        row.status = status
        row.outcome = outcome
        row.error_code = error_code
        row.remote_after_json = remote_after_json
        return row


def _service(monkeypatch):
    monkeypatch.setenv("DOCFLOW_CREDENTIALS_KEY", Fernet.generate_key().decode("ascii"))
    monkeypatch.setenv("DOCFLOW_TRANSPORT", "com")
    monkeypatch.setenv("DOCFLOW_WRITE_CREDENTIAL_MIN_VERSION", "0")
    _build_fernet.cache_clear()
    adapter = FakeAdapter()
    store = FakeStore()
    return DocflowService(adapter=adapter, store=store), adapter, store


def _action_service(monkeypatch):
    service, adapter, store = _service(monkeypatch)
    command_store = FakeCommandStore()
    service._command_store = command_store
    monkeypatch.setenv("DOCFLOW_WRITE_ENABLED", "1")
    monkeypatch.setenv("DOCFLOW_WRITE_PILOT_USER_IDS", "17")
    monkeypatch.setenv("DOCFLOW_WRITE_TEST_ONLY", "1")
    monkeypatch.setenv("DOCFLOW_WRITE_TEST_TITLE_PREFIX", "HUB-IT TEST")
    monkeypatch.setenv("DOCFLOW_ACTION_STATE_KEY", "test-state-key-that-is-longer-than-32-bytes")
    fingerprint = configuration_fingerprint(
        configuration="docflow",
        task_type="ЗадачаИсполнителя",
        process_type="Согласование",
    )
    monkeypatch.setenv(
        "DOCFLOW_ACTION_RULES_JSON",
        json.dumps({
            "rules": [{
                "configuration": "docflow",
                "task_type": "ЗадачаИсполнителя",
                "process_type": "Согласование",
                "configuration_fingerprint": fingerprint,
                "actions": {
                    "approve": {
                        "label": "Согласовать",
                        "result_value": "Согласовано{comment}",
                    },
                    "reject": {
                        "label": "Отклонить",
                        "result_value": "Отклонено: {comment}",
                    },
                },
            }],
        }, ensure_ascii=False),
    )
    return service, adapter, store, command_store


def _assignment_service(monkeypatch):
    service, adapter, store = _service(monkeypatch)
    command_store = FakeCommandStore()
    service._command_store = command_store
    monkeypatch.setenv("DOCFLOW_WRITE_ENABLED", "1")
    monkeypatch.setenv("DOCFLOW_CREATE_ENABLED", "1")
    monkeypatch.setenv("DOCFLOW_CREATE_PILOT_USER_IDS", "17")
    monkeypatch.setenv("DOCFLOW_CREATE_TEST_ONLY", "1")
    monkeypatch.setenv("DOCFLOW_CREATE_TEST_TITLE_PREFIX", "HUB-IT TEST")
    return service, adapter, store, command_store


def test_acknowledgement_rule_allows_verified_empty_result():
    fingerprint = configuration_fingerprint(
        configuration="docflow",
        task_type="ЗадачаИсполнителя",
        process_type="Ознакомление",
    )
    rules = load_action_rules(json.dumps({
        "rules": [{
            "configuration": "docflow",
            "task_type": "ЗадачаИсполнителя",
            "process_type": "Ознакомление",
            "configuration_fingerprint": fingerprint,
            "actions": {
                "acknowledge": {"result_value": ""},
            },
        }],
    }, ensure_ascii=False))

    assert len(rules) == 1
    assert rules[0].action == "acknowledge"
    assert rules[0].result_value == ""


def test_versioned_default_rules_cover_all_pilot_processes(monkeypatch):
    monkeypatch.delenv("DOCFLOW_ACTION_RULES_JSON", raising=False)
    monkeypatch.delenv("DOCFLOW_ACTION_RULES_FILE", raising=False)

    rules = load_action_rules()
    actions_by_process = {}
    for rule in rules:
        actions_by_process.setdefault(rule.process_type, []).append(rule.action)

    assert actions_by_process == {
        "Ознакомление": ["acknowledge"],
        "Согласование": ["approve", "approve_with_comments", "reject", "acknowledge"],
        "Утверждение": ["approve", "reject"],
        "Исполнение": ["complete"],
        "Приглашение": ["accept_invitation", "decline_invitation"],
    }


def test_default_acquaintance_rule_matches_live_dmservice_task_type(monkeypatch):
    service, _adapter, _store = _service(monkeypatch)
    monkeypatch.delenv("DOCFLOW_ACTION_RULES_JSON", raising=False)
    monkeypatch.delenv("DOCFLOW_ACTION_RULES_FILE", raising=False)
    monkeypatch.setenv("DOCFLOW_WRITE_ENABLED", "1")
    monkeypatch.setenv("DOCFLOW_WRITE_ALL_USERS", "1")
    monkeypatch.setenv("DOCFLOW_WRITE_TEST_ONLY", "0")
    monkeypatch.setenv("DOCFLOW_ACTION_STATE_KEY", "test-state-key-that-is-longer-than-32-bytes")

    detail = service._decorate_task_actions(
        user_id=17,
        detail={
            "ref": "233c3a9c-8bff-11f1-bf5b-5cba2c62ec78",
            "task_type": "ЗадачаИсполнителя",
            "xdto_task_type": "DMBusinessProcessTask",
            "title": "ФИО, дата рождения, предполагаемая должность",
            "process_type": "Ознакомление",
            "xdto_process_type": "DMBusinessProcessAcquaintance",
            "dm_version": "2.1.37.5.CORP",
            "completed": False,
        },
        can_act=True,
    )

    assert [item["code"] for item in detail["available_actions"]] == ["acknowledge"]
    assert detail["state_token"]


def test_default_approval_checkup_rule_is_actionable_and_keeps_process_result(monkeypatch):
    class ApprovalCheckupAdapter(FakeAdapter):
        def __init__(self) -> None:
            super().__init__()
            self.result = "Согласовано"

        def task(self, task_ref: str) -> dict:
            return {
                "ref": task_ref,
                "task_type": "ЗадачаИсполнителя",
                "task_type_label": "Задание исполнителя",
                "title": "Ознакомиться с результатом согласования",
                "process_ref": "33333333-3333-3333-3333-333333333333",
                "process_type": "Согласование",
                "process_type_label": "Согласование",
                "xdto_process_type": "DMBusinessProcessApproval",
                "xdto_task_type": "DMBusinessProcessApprovalTaskCheckup",
                "dm_version": "2.1.37.5.CORP",
                "result": self.result,
                "completed": self.completed,
                "files": [],
            }

        async def call(self, operation: str, payload: dict):
            self.calls.append((operation, dict(payload)))
            if operation == "test_connection":
                return {
                    "connected": True,
                    "configuration": "docflow",
                    "verified_at": datetime.now(timezone.utc).isoformat(),
                }
            if operation in {"task_detail", "task_state"}:
                return self.task(str(payload.get("task_ref") or ""))
            if operation == "task_action":
                self.completed = True
                return {
                    "before": {"ref": payload.get("task_ref"), "completed": False},
                    "task": self.task(str(payload.get("task_ref") or "")),
                }
            return await super().call(operation, payload)

    monkeypatch.setenv("DOCFLOW_CREDENTIALS_KEY", Fernet.generate_key().decode("ascii"))
    monkeypatch.setenv("DOCFLOW_TRANSPORT", "com")
    monkeypatch.setenv("DOCFLOW_WRITE_CREDENTIAL_MIN_VERSION", "0")
    monkeypatch.setenv("DOCFLOW_WRITE_ENABLED", "1")
    monkeypatch.setenv("DOCFLOW_WRITE_ALL_USERS", "1")
    monkeypatch.setenv("DOCFLOW_WRITE_TEST_ONLY", "0")
    monkeypatch.setenv("DOCFLOW_ACTION_STATE_KEY", "test-state-key-that-is-longer-than-32-bytes")
    monkeypatch.delenv("DOCFLOW_ACTION_RULES_JSON", raising=False)
    monkeypatch.delenv("DOCFLOW_ACTION_RULES_FILE", raising=False)
    _build_fernet.cache_clear()

    adapter = ApprovalCheckupAdapter()
    store = FakeStore()
    service = DocflowService(adapter=adapter, store=store)
    command_store = FakeCommandStore()
    service._command_store = command_store
    asyncio.run(service.save_credentials(
        user_id=17,
        login="owner.login",
        password="temporary-test-password",
        correlation_id="save",
    ))
    task_ref = "68eb5751-9798-11f1-bf5b-5cba2c62ec78"

    detail = asyncio.run(service.get_task_detail(
        user_id=17,
        task_ref=task_ref,
        correlation_id="detail",
        can_act=True,
    ))
    assert [item["code"] for item in detail["available_actions"]] == ["acknowledge"]

    result = asyncio.run(service.apply_task_action(
        user_id=17,
        task_ref=task_ref,
        action="acknowledge",
        comment="",
        state_token=detail["state_token"],
        idempotency_key="approval-checkup-1",
        correlation_id="apply",
    ))

    assert result["status"] == "applied"
    assert result["task"]["completed"] is True
    assert result["task"]["result"] == "Согласовано"
    assert [operation for operation, _ in adapter.calls].count("task_action") == 1


def test_default_invitation_rule_exposes_both_results_and_verifies_completion(monkeypatch):
    service, _adapter, _store = _service(monkeypatch)
    monkeypatch.delenv("DOCFLOW_ACTION_RULES_JSON", raising=False)
    monkeypatch.delenv("DOCFLOW_ACTION_RULES_FILE", raising=False)
    monkeypatch.setenv("DOCFLOW_WRITE_ENABLED", "1")
    monkeypatch.setenv("DOCFLOW_WRITE_ALL_USERS", "1")
    monkeypatch.setenv("DOCFLOW_WRITE_TEST_ONLY", "0")
    monkeypatch.setenv("DOCFLOW_ACTION_STATE_KEY", "test-state-key-that-is-longer-than-32-bytes")

    detail = service._decorate_task_actions(
        user_id=17,
        detail={
            "ref": "03649d11-97ac-11f1-8cfb-5cba2c62eea8",
            "task_type": "ЗадачаИсполнителя",
            "xdto_task_type": "DMBusinessProcessInvitationTaskInvitation",
            "title": "Тест",
            "process_type": "Приглашение",
            "xdto_process_type": "DMBusinessProcessInvitation",
            "dm_version": "2.1.37.5.CORP",
            "completed": False,
        },
        can_act=True,
    )

    assert [item["code"] for item in detail["available_actions"]] == [
        "accept_invitation",
        "decline_invitation",
    ]
    assert [item["label"] for item in detail["available_actions"]] == [
        "Принять",
        "Не принимать",
    ]
    assert detail["state_token"]
    assert service._action_outcome_matches(
        action="accept_invitation",
        expected_result_hash=service._result_hash("Принято"),
        detail={
            "completed": True,
            "result": None,
            "xdto_task_type": "DMBusinessProcessInvitationTaskInvitation",
        },
    )


def test_invitation_action_codes_are_accepted_by_api_model():
    for action in ("accept_invitation", "decline_invitation"):
        request = DocflowTaskActionRequest(
            action=action,
            comment="",
            state_token="signed-state-token",
        )
        assert request.action == action


def test_http_dmservice_keeps_write_actions_fail_closed(monkeypatch):
    service, adapter, _store, _command_store = _action_service(monkeypatch)
    monkeypatch.setenv("DOCFLOW_TRANSPORT", "dmservice")
    monkeypatch.setenv("DOCFLOW_DM_SERVICE_URL", "http://docflow.example/ws/DMService")
    monkeypatch.setenv("DOCFLOW_DM_ALLOW_INSECURE_WRITES", "0")

    detail = service._decorate_task_actions(
        user_id=17,
        detail={
            "ref": "11111111-1111-1111-1111-111111111111",
            "task_type": "ЗадачаИсполнителя",
            "title": "HUB-IT TEST · Тестовое задание",
            "process_type": "Согласование",
            "completed": False,
        },
        can_act=True,
    )

    assert detail["available_actions"] == []
    assert "без HTTPS" in detail["action_unavailable_reason"]


def test_write_requires_credentials_resaved_after_incident_barrier(monkeypatch):
    service, _adapter, _store, _command_store = _action_service(monkeypatch)
    monkeypatch.setenv("DOCFLOW_WRITE_CREDENTIAL_MIN_VERSION", "2")
    task_ref = "11111111-1111-1111-1111-111111111111"

    asyncio.run(service.save_credentials(
        user_id=17,
        login="owner.login",
        password="temporary-test-password",
        correlation_id="save-v1",
    ))
    blocked = asyncio.run(service.get_task_detail(
        user_id=17,
        task_ref=task_ref,
        correlation_id="blocked",
        can_act=True,
    ))
    assert blocked["available_actions"] == []
    assert "смените ранее опубликованный пароль" in blocked["action_unavailable_reason"]

    asyncio.run(service.save_credentials(
        user_id=17,
        login="owner.login",
        password="rotated-test-password",
        correlation_id="save-v2",
    ))
    ready = asyncio.run(service.get_task_detail(
        user_id=17,
        task_ref=task_ref,
        correlation_id="ready",
        can_act=True,
    ))
    assert [item["code"] for item in ready["available_actions"]] == ["approve", "reject"]


def test_assignment_capability_uses_same_credential_rotation_barrier(monkeypatch):
    service, _adapter, _store, _command_store = _assignment_service(monkeypatch)
    monkeypatch.setenv("DOCFLOW_WRITE_CREDENTIAL_MIN_VERSION", "2")

    asyncio.run(service.save_credentials(
        user_id=17,
        login="owner.login",
        password="temporary-test-password",
        correlation_id="save-v1",
    ))
    blocked = asyncio.run(service.assignment_capability(user_id=17))
    assert blocked["enabled"] is False
    assert "смените ранее опубликованный пароль" in blocked["reason"]

    asyncio.run(service.save_credentials(
        user_id=17,
        login="owner.login",
        password="rotated-test-password",
        correlation_id="save-v2",
    ))
    ready = asyncio.run(service.assignment_capability(user_id=17))
    assert ready["enabled"] is True
    assert ready["reason"] is None


def test_real_task_rollout_can_disable_only_the_title_prefix_guard(monkeypatch):
    service, _adapter, _store, _command_store = _action_service(monkeypatch)
    detail = {
        "ref": "11111111-1111-1111-1111-111111111111",
        "task_type": "ЗадачаИсполнителя",
        "title": "Согласовать рабочий документ",
        "process_ref": "22222222-2222-2222-2222-222222222222",
        "process_type": "Согласование",
        "completed": False,
        "files": [],
    }

    blocked = service._decorate_task_actions(user_id=17, detail=detail, can_act=True)
    assert blocked["available_actions"] == []
    assert "тестовых заданий" in blocked["action_unavailable_reason"]

    monkeypatch.setenv("DOCFLOW_WRITE_TEST_ONLY", "0")
    ready = service._decorate_task_actions(user_id=17, detail=detail, can_act=True)
    assert [item["code"] for item in ready["available_actions"]] == ["approve", "reject"]
    assert ready["state_token"]


def test_real_assignment_rollout_accepts_a_title_without_test_prefix(monkeypatch):
    service, adapter, _store, _command_store = _assignment_service(monkeypatch)
    monkeypatch.setenv("DOCFLOW_CREATE_TEST_ONLY", "0")
    asyncio.run(service.save_credentials(
        user_id=17,
        login="owner.login",
        password="rotated-test-password",
        correlation_id="save",
    ))
    adapter.calls.clear()

    result = asyncio.run(service.create_assignment(
        user_id=17,
        document_type="internal",
        document_ref="33333333-3333-3333-3333-333333333333",
        assignee_ref="44444444-4444-4444-4444-444444444444",
        controller_ref=None,
        due_at=datetime(2030, 7, 29, 10, 0, tzinfo=timezone.utc),
        importance="normal",
        title="Проверить служебную записку",
        description="Проверить документ и сообщить результат.",
        idempotency_key="real-assignment-key",
        correlation_id="create",
    ))

    assert result["status"] == "applied"
    assert [name for name, _ in adapter.calls].count("assignment_create") == 1


def test_metadata_descriptor_uses_object_metadata_without_global_typeof():
    metadata_item = SimpleNamespace(Name="Ознакомление", Synonym="Ознакомление")
    process_object = SimpleNamespace(Metadata=lambda: metadata_item)
    process_reference = SimpleNamespace(GetObject=lambda: process_object)
    connection = SimpleNamespace(String=lambda value: str(value))

    assert docflow_1c_client_module._metadata_descriptor_for_value(
        connection,
        process_reference,
    ) == ("Ознакомление", "Ознакомление")


def test_assignment_creation_is_pilot_gated_and_idempotent(monkeypatch):
    service, adapter, _store, command_store = _assignment_service(monkeypatch)
    asyncio.run(service.save_credentials(
        user_id=17,
        login="owner.login",
        password="temporary-test-password",
        correlation_id="save",
    ))
    adapter.calls.clear()
    payload = {
        "user_id": 17,
        "document_type": "internal",
        "document_ref": "33333333-3333-3333-3333-333333333333",
        "assignee_ref": "44444444-4444-4444-4444-444444444444",
        "controller_ref": None,
        "due_at": datetime(2030, 7, 29, 10, 0, tzinfo=timezone.utc),
        "importance": "normal",
        "title": "HUB-IT TEST · Поручение",
        "description": "Тестовое описание",
        "idempotency_key": "assignment-same-key",
    }
    first = asyncio.run(service.create_assignment(**payload, correlation_id="first"))
    second = asyncio.run(service.create_assignment(**payload, correlation_id="second"))

    assert first["status"] == "applied"
    assert second["status"] == "already_applied"
    assert first["assignment"]["task_ref"] == "55555555-5555-5555-5555-555555555555"
    assert [name for name, _ in adapter.calls].count("assignment_create") == 1
    assert len(command_store.rows) == 1
    ledger = next(iter(command_store.rows.values()))
    assert "Тестовое описание" not in ledger.remote_before_json
    assert "Тестовое описание" not in ledger.remote_after_json


def test_unknown_assignment_outcome_is_not_replayed(monkeypatch):
    service, adapter, _store, command_store = _assignment_service(monkeypatch)
    asyncio.run(service.save_credentials(
        user_id=17,
        login="owner.login",
        password="temporary-test-password",
        correlation_id="save",
    ))
    adapter.calls.clear()
    original_call = adapter.call

    async def uncertain_call(operation, payload):
        if operation == "assignment_create":
            adapter.calls.append((operation, dict(payload)))
            raise DocflowActionOutcomeUnknown("unknown")
        return await original_call(operation, payload)

    adapter.call = uncertain_call
    payload = {
        "user_id": 17,
        "document_type": "internal",
        "document_ref": "33333333-3333-3333-3333-333333333333",
        "assignee_ref": "44444444-4444-4444-4444-444444444444",
        "controller_ref": None,
        "due_at": datetime(2030, 7, 29, 10, 0, tzinfo=timezone.utc),
        "importance": "normal",
        "title": "HUB-IT TEST · Неопределённый результат",
        "description": "Тест",
        "idempotency_key": "assignment-unknown-key",
    }
    first = asyncio.run(service.create_assignment(**payload, correlation_id="first"))
    second = asyncio.run(service.create_assignment(**payload, correlation_id="second"))

    assert first["status"] == "state_unknown"
    assert second["status"] == "state_unknown"
    assert [name for name, _ in adapter.calls].count("assignment_create") == 1
    assert len(command_store.rows) == 1


def test_bridge_pool_keeps_each_login_on_one_worker_and_parallelizes_users():
    barrier = threading.Barrier(2)

    class SerializedBridge:
        def __init__(self, name: str) -> None:
            self.name = name
            self.lock = threading.Lock()
            self.logins: list[str] = []

        def call(self, operation, payload, *, timeout):
            with self.lock:
                self.logins.append(payload["login"])
                barrier.wait(timeout=1)
                return {"worker": self.name, "operation": operation}

        def shutdown(self):
            return None

    bridges = [SerializedBridge("one"), SerializedBridge("two")]
    pool = Docflow1CBridgePool(bridges, routing_secret=b"test-routing-secret")
    first_login = "user-0"
    second_login = next(
        f"user-{index}"
        for index in range(1, 100)
        if pool._worker_index(f"user-{index}") != pool._worker_index(first_login)
    )

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(
            pool.call,
            "tasks",
            {"login": first_login},
            timeout=2,
        )
        second = executor.submit(
            pool.call,
            "tasks",
            {"login": second_login},
            timeout=2,
        )
        assert {first.result()["worker"], second.result()["worker"]} == {"one", "two"}

    routed_bridge = bridges[pool._worker_index(first_login)]
    assert routed_bridge.logins == [first_login]


def test_save_encrypts_password_and_profile_never_exposes_ciphertext(monkeypatch):
    service, adapter, store = _service(monkeypatch)

    profile = asyncio.run(
        service.save_credentials(
            user_id=7,
            login="test.user",
            password="temporary-test-password",
            correlation_id="test-correlation",
        )
    )

    assert profile == {
        "configured": True,
        "login": "test.user",
        "status": "valid",
        "last_error_code": None,
        "last_verified_at": store.row.last_verified_at,
        "updated_at": store.row.updated_at,
    }
    assert "password" not in profile
    assert "password_enc" not in profile
    assert store.row.password_enc != "temporary-test-password"
    assert decrypt_docflow_secret(store.row.password_enc) == "temporary-test-password"
    assert adapter.calls[0][0] == "test_connection"


def test_docflow_secret_uses_windows_dpapi_when_dedicated_key_is_absent(monkeypatch):
    if os.name != "nt":
        return
    monkeypatch.delenv("DOCFLOW_CREDENTIALS_KEY", raising=False)
    monkeypatch.delenv("DOCFLOW_CREDENTIALS_KEY_LEGACY", raising=False)
    _build_fernet.cache_clear()

    encrypted = encrypt_docflow_secret("temporary-test-password")

    assert encrypted.startswith("dpapi-user:v1:")
    assert "temporary-test-password" not in encrypted
    assert decrypt_docflow_secret(encrypted) == "temporary-test-password"


def test_task_read_uses_the_same_users_credentials_and_marks_invalid(monkeypatch):
    service, adapter, store = _service(monkeypatch)
    asyncio.run(
        service.save_credentials(
            user_id=11,
            login="owner.login",
            password="temporary-test-password",
            correlation_id="save",
        )
    )
    adapter.calls.clear()

    store.row.status = "unavailable"
    asyncio.run(
        service.list_tasks(
            user_id=11,
            scope="inbox",
            search="",
            limit=25,
            correlation_id="list",
        )
    )
    assert adapter.calls == [
        (
            "tasks",
            {
                "login": "owner.login",
                "password": "temporary-test-password",
                "scope": "inbox",
                "search": "",
                "limit": 25,
            },
        )
    ]
    assert store.row.status == "valid"
    assert store.row.last_error_code is None

    adapter.error = DocflowCredentialsInvalid("invalid")
    try:
        asyncio.run(
            service.list_tasks(
                user_id=11,
                scope="inbox",
                search="",
                limit=25,
                correlation_id="invalid",
            )
        )
    except DocflowCredentialsInvalid:
        pass
    else:  # pragma: no cover
        raise AssertionError("invalid credentials error was not raised")
    assert store.row.status == "invalid"
    assert store.row.last_error_code == "DOCFLOW_AUTH_INVALID"


def test_task_detail_uses_saved_personal_credentials_and_never_accepts_a_login(monkeypatch):
    service, adapter, _ = _service(monkeypatch)
    asyncio.run(
        service.save_credentials(
            user_id=17,
            login="owner.login",
            password="temporary-test-password",
            correlation_id="save",
        )
    )
    adapter.calls.clear()
    task_ref = "11111111-1111-1111-1111-111111111111"

    detail = asyncio.run(
        service.get_task_detail(
            user_id=17,
            task_ref=task_ref,
            correlation_id="detail",
        )
    )

    assert detail["ref"] == task_ref
    assert adapter.calls == [
        (
            "task_detail",
            {
                "login": "owner.login",
                "password": "temporary-test-password",
                "task_ref": task_ref,
            },
        )
    ]


def test_task_action_is_allowlisted_state_bound_and_idempotent(monkeypatch):
    service, adapter, _store, command_store = _action_service(monkeypatch)
    asyncio.run(
        service.save_credentials(
            user_id=17,
            login="owner.login",
            password="temporary-test-password",
            correlation_id="save",
        )
    )
    adapter.calls.clear()
    task_ref = "11111111-1111-1111-1111-111111111111"
    detail = asyncio.run(
        service.get_task_detail(
            user_id=17,
            task_ref=task_ref,
            correlation_id="detail",
            can_act=True,
        )
    )
    assert [item["code"] for item in detail["available_actions"]] == ["approve", "reject"]
    assert detail["state_token"]

    first = asyncio.run(
        service.apply_task_action(
            user_id=17,
            task_ref=task_ref,
            action="approve",
            comment="",
            state_token=detail["state_token"],
            idempotency_key="same-request-1",
            correlation_id="apply-1",
        )
    )
    second = asyncio.run(
        service.apply_task_action(
            user_id=17,
            task_ref=task_ref,
            action="approve",
            comment="",
            state_token=detail["state_token"],
            idempotency_key="same-request-1",
            correlation_id="apply-2",
        )
    )

    assert first["status"] == "applied"
    assert second["status"] == "already_applied"
    assert len(command_store.rows) == 1
    assert [operation for operation, _ in adapter.calls].count("task_action") == 1


def test_task_action_requires_comment_for_rejection_before_dispatch(monkeypatch):
    service, adapter, _store, command_store = _action_service(monkeypatch)
    asyncio.run(
        service.save_credentials(
            user_id=17,
            login="owner.login",
            password="temporary-test-password",
            correlation_id="save",
        )
    )
    detail = asyncio.run(
        service.get_task_detail(
            user_id=17,
            task_ref="11111111-1111-1111-1111-111111111111",
            correlation_id="detail",
            can_act=True,
        )
    )
    try:
        asyncio.run(
            service.apply_task_action(
                user_id=17,
                task_ref=detail["ref"],
                action="reject",
                comment="",
                state_token=detail["state_token"],
                idempotency_key="reject-without-comment",
                correlation_id="reject",
            )
        )
    except Exception as exc:
        assert getattr(exc, "code", "") == "DOCFLOW_ACTION_UNAVAILABLE"
    else:  # pragma: no cover
        raise AssertionError("empty rejection comment was accepted")
    assert command_store.rows == {}
    assert [operation for operation, _ in adapter.calls].count("task_action") == 0


def test_unknown_action_outcome_is_never_replayed_automatically(monkeypatch):
    service, adapter, _store, command_store = _action_service(monkeypatch)
    asyncio.run(
        service.save_credentials(
            user_id=17,
            login="owner.login",
            password="temporary-test-password",
            correlation_id="save",
        )
    )
    detail = asyncio.run(
        service.get_task_detail(
            user_id=17,
            task_ref="11111111-1111-1111-1111-111111111111",
            correlation_id="detail",
            can_act=True,
        )
    )
    original_call = adapter.call

    async def timeout_action(operation, payload):
        if operation == "task_action":
            adapter.calls.append((operation, dict(payload)))
            raise DocflowActionOutcomeUnknown("timeout")
        return await original_call(operation, payload)

    adapter.call = timeout_action
    payload = dict(
        user_id=17,
        task_ref=detail["ref"],
        action="approve",
        comment="",
        state_token=detail["state_token"],
        idempotency_key="unknown-command-1",
        correlation_id="unknown",
    )
    first = asyncio.run(service.apply_task_action(**payload))
    second = asyncio.run(service.apply_task_action(**payload))

    assert first["status"] == "state_unknown"
    assert second["status"] == "state_unknown"
    assert len(command_store.rows) == 1
    assert [operation for operation, _ in adapter.calls].count("task_action") == 1


def test_explicit_command_check_releases_action_when_1c_state_is_unchanged(monkeypatch):
    service, adapter, _store, command_store = _action_service(monkeypatch)
    asyncio.run(service.save_credentials(
        user_id=17,
        login="owner.login",
        password="temporary-test-password",
        correlation_id="save",
    ))
    detail = asyncio.run(service.get_task_detail(
        user_id=17,
        task_ref="11111111-1111-1111-1111-111111111111",
        correlation_id="detail",
        can_act=True,
    ))
    original_call = adapter.call

    async def rejected_before_write(operation, payload):
        if operation == "task_action":
            adapter.calls.append((operation, dict(payload)))
            raise DocflowActionOutcomeUnknown("timeout")
        return await original_call(operation, payload)

    adapter.call = rejected_before_write
    result = asyncio.run(service.apply_task_action(
        user_id=17,
        task_ref=detail["ref"],
        action="approve",
        comment="",
        state_token=detail["state_token"],
        idempotency_key="unchanged-command-1",
        correlation_id="unknown",
    ))
    row = command_store.rows[result["command_id"]]
    row.updated_at = datetime.now(timezone.utc) - timedelta(seconds=10)

    checked = asyncio.run(service.get_command(
        user_id=17,
        command_id=result["command_id"],
        correlation_id="check",
    ))

    assert checked["status"] == "rejected"
    assert checked["correlation_id"] == "unknown"
    assert checked["error_code"] == "DOCFLOW_ACTION_NOT_APPLIED"
    assert checked["task"]["completed"] is False
    assert [item["code"] for item in checked["task"]["available_actions"]] == ["approve", "reject"]
    assert [operation for operation, _ in adapter.calls].count("task_action") == 1


def test_api_rejects_extra_fields_and_does_not_return_password(monkeypatch):
    service, adapter, _ = _service(monkeypatch)
    monkeypatch.setattr(docflow_api, "docflow_service", service)
    app = FastAPI()
    app.middleware("http")(request_metrics_middleware)
    app.include_router(docflow_api.router, prefix="/docflow")

    current_user = User(
        id=5,
        username="hub.user",
        role="viewer",
        permissions=["docflow.read"],
        use_custom_permissions=True,
        custom_permissions=["docflow.read"],
        is_active=True,
    )
    app.dependency_overrides[deps.get_current_active_user] = lambda: current_user

    with TestClient(app) as client:
        rejected = client.put(
            "/docflow/profile/credentials",
            json={
                "login": "test.user",
                "password": "temporary-test-password",
                "server": "attacker.example",
            },
        )
        assert rejected.status_code == 422

        response = client.put(
            "/docflow/profile/credentials",
            json={"login": "test.user", "password": "temporary-test-password"},
        )
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        body = response.json()
        assert body["configured"] is True
        assert body["login"] == "test.user"
        assert "password" not in body
        assert "password_enc" not in body

        task_ref = "11111111-1111-1111-1111-111111111111"
        detail = client.get(f"/docflow/tasks/{task_ref}")
        assert detail.status_code == 200
        assert detail.headers["cache-control"] == "no-store"
        assert detail.json()["ref"] == task_ref
        assert adapter.calls[-1] == (
            "task_detail",
            {
                "login": "test.user",
                "password": "temporary-test-password",
                "task_ref": task_ref,
            },
        )
        assert client.get("/docflow/tasks/not-a-uuid").status_code == 422

        action_denied = client.post(
            f"/docflow/tasks/{task_ref}/actions",
            headers={"Idempotency-Key": "permission-check-1"},
            json={
                "action": "approve",
                "comment": "",
                "state_token": "signed-state-token",
            },
        )
        assert action_denied.status_code == 403
        assert client.get("/docflow/assignments/capability").status_code == 403

        adapter.error = DocflowCredentialsInvalid("invalid")
        failed = client.post(
            "/docflow/profile/test",
            json={"login": "test.user", "password": "temporary-test-password"},
        )
        assert failed.status_code == 409
        assert failed.json()["detail"]["correlation_id"] == failed.headers["x-correlation-id"]

        metadata = client.get("/docflow/metadata")
        assert metadata.status_code == 403


class _FakeCollection:
    def __init__(self, items):
        self._items = list(items)

    def Count(self):
        return len(self._items)

    def Get(self, index):
        return self._items[index]


class _FakeQuerySelection:
    def Next(self):
        return False


class _FakeQuery:
    def __init__(self) -> None:
        self.Text = ""
        self.parameters = {}

    def SetParameter(self, name, value):
        self.parameters[name] = value

    def Execute(self):
        return SimpleNamespace(Select=lambda: _FakeQuerySelection())


class _FakeDocflowConnection:
    def __init__(self) -> None:
        fields = [
            SimpleNamespace(Name="Автор"),
            SimpleNamespace(Name="ДатаНачала"),
            SimpleNamespace(Name="СрокИсполнения"),
            SimpleNamespace(Name="ТекущийИсполнитель"),
            SimpleNamespace(Name="ПредметСтрокой"),
            SimpleNamespace(Name="Описание"),
            SimpleNamespace(Name="РезультатВыполнения"),
            SimpleNamespace(Name="СостояниеБизнесПроцесса"),
            SimpleNamespace(Name="Важность"),
            SimpleNamespace(Name="ПринятаКИсполнению"),
            SimpleNamespace(Name="ДатаИсполнения"),
        ]
        task_type = SimpleNamespace(
            Name="ЗадачаИсполнителя",
            Synonym="Задача исполнителя",
            Attributes=_FakeCollection(fields),
            StandardAttributes=_FakeCollection([]),
        )
        self.Metadata = SimpleNamespace(Tasks=_FakeCollection([task_type]))
        self.SessionParameters = SimpleNamespace()
        setattr(self.SessionParameters, "ТекущийПользователь", object())
        self.query = _FakeQuery()

    def NewObject(self, kind):
        assert kind == "Query"
        return self.query

    @staticmethod
    def String(value):
        return str(value)


def test_com_query_is_fixed_to_current_1c_assignee(monkeypatch):
    for name in (
        "DOCFLOW_1C_TASK_TYPE",
        "DOCFLOW_1C_TASK_ASSIGNEE_FIELD",
        "DOCFLOW_1C_TASK_COMPLETED_FIELD",
        "DOCFLOW_1C_TASK_DATE_FIELD",
        "DOCFLOW_1C_TASK_SUBJECT_FIELD",
    ):
        monkeypatch.delenv(name, raising=False)
    connection = _FakeDocflowConnection()
    connector = SimpleNamespace(Connect=lambda _connection_string: connection)
    client = Docflow1CComClient(connector_factory=lambda: connector)

    result = client.list_tasks(
        login="test.user",
        password="temporary-test-password",
        scope="inbox",
        search="",
        limit=25,
    )

    assert result["items"] == []
    assert "Задание.ТекущийИсполнитель = &ТекущийПользователь" in connection.query.Text
    assert "Задание.Выполнена КАК Выполнено" in connection.query.Text
    assert "Задание.ДатаНачала КАК Дата" in connection.query.Text
    assert "ПРЕДСТАВЛЕНИЕ(Задание.ПредметСтрокой) КАК Предмет" in connection.query.Text
    assert connection.query.parameters["ТекущийПользователь"] is not None
    assert connection.query.parameters["Завершено"] is False


def test_com_client_reuses_an_authenticated_connection_without_storing_plain_credentials(monkeypatch):
    for name in (
        "DOCFLOW_1C_TASK_TYPE",
        "DOCFLOW_1C_TASK_ASSIGNEE_FIELD",
        "DOCFLOW_1C_TASK_COMPLETED_FIELD",
        "DOCFLOW_1C_TASK_DATE_FIELD",
        "DOCFLOW_1C_TASK_SUBJECT_FIELD",
    ):
        monkeypatch.delenv(name, raising=False)
    connection = _FakeDocflowConnection()
    connect_calls = []

    def connect(connection_string):
        connect_calls.append(connection_string)
        return connection

    connector = SimpleNamespace(Connect=connect)
    client = Docflow1CComClient(
        connector_factory=lambda: connector,
        cache_connections=True,
        max_cached_connections=2,
    )

    client.test_connection(login="test.user", password="temporary-test-password")
    client.list_tasks(
        login="test.user",
        password="temporary-test-password",
        scope="inbox",
        search="",
        limit=25,
    )

    assert len(connect_calls) == 1
    assert client.cached_connection_count == 1
    assert not hasattr(client, "password")
    client.close()
    assert client.cached_connection_count == 0


def test_com_client_fails_over_between_ordered_1c_nodes(monkeypatch):
    monkeypatch.setenv("DOCFLOW_1C_SERVER", "fast-node.example,backup-node.example")
    connection = _FakeDocflowConnection()
    attempts = []

    def connect(connection_string):
        attempts.append(connection_string)
        if 'Srvr="fast-node.example"' in connection_string:
            raise RuntimeError("node unavailable")
        return connection

    client = Docflow1CComClient(
        connector_factory=lambda: SimpleNamespace(Connect=connect),
    )

    result = client.test_connection(login="test.user", password="temporary-test-password")

    assert result["connected"] is True
    assert len(attempts) == 2
    assert 'Srvr="fast-node.example"' in attempts[0]
    assert 'Srvr="backup-node.example"' in attempts[1]


def test_com_action_accepts_new_task_before_executing_it(monkeypatch):
    """1C agreement tasks must be accepted before ExecuteTask is called."""
    for name in (
        "DOCFLOW_1C_TASK_TYPE",
        "DOCFLOW_1C_TASK_RESULT_FIELD",
        "DOCFLOW_1C_TASK_ACCEPTED_FIELD",
    ):
        monkeypatch.delenv(name, raising=False)

    class AgreementTask:
        def __init__(self) -> None:
            self.completed = False
            setattr(self, "ПринятаКИсполнению", False)
            setattr(self, "РезультатВыполнения", "")

        def ExecuteTask(self):
            if not getattr(self, "ПринятаКИсполнению"):
                raise RuntimeError("Задание не принято к исполнению")
            self.completed = True

    task = AgreementTask()
    task_reference = SimpleNamespace(GetObject=lambda: task)
    client = Docflow1CComClient()
    monkeypatch.setattr(client, "_connect", lambda **_kwargs: object())
    monkeypatch.setattr(client, "_reference_from_uuid", lambda *_args, **_kwargs: task_reference)

    def task_context(_connection, *, task_ref):
        return ({
            "ref": task_ref,
            "task_type": "ЗадачаИсполнителя",
            "process_ref": "22222222-2222-2222-2222-222222222222",
            "process_type": "Согласование",
            "business_state": "Активен",
            "result": getattr(task, "РезультатВыполнения"),
            "accepted": getattr(task, "ПринятаКИсполнению"),
            "completed": task.completed,
        }, object())

    monkeypatch.setattr(client, "_task_context", task_context)

    result = client.apply_task_action(
        login="test.user",
        password="temporary-test-password",
        task_ref="11111111-1111-1111-1111-111111111111",
        action="approve",
        result_template="Согласовано",
        comment="",
    )

    assert getattr(task, "ПринятаКИсполнению") is True
    assert getattr(task, "РезультатВыполнения") == "Согласовано"
    assert result["task"]["completed"] is True


def test_com_action_reports_a_definite_conflict_when_1c_rolls_back_the_write(monkeypatch):
    """A rejected and rolled-back 1C call is not an unknown write outcome."""
    for name in (
        "DOCFLOW_1C_TASK_TYPE",
        "DOCFLOW_1C_TASK_RESULT_FIELD",
        "DOCFLOW_1C_TASK_ACCEPTED_FIELD",
    ):
        monkeypatch.delenv(name, raising=False)

    class RejectedAgreementTask:
        def __init__(self) -> None:
            self.completed = False
            self.accepted = False
            self.result = ""

        @property
        def ПринятаКИсполнению(self):
            return self.accepted

        @ПринятаКИсполнению.setter
        def ПринятаКИсполнению(self, value):
            self.accepted = value

        @property
        def РезультатВыполнения(self):
            return self.result

        @РезультатВыполнения.setter
        def РезультатВыполнения(self, value):
            self.result = value

        def ExecuteTask(self):
            # 1C rolls the attempted changes back before returning its error.
            self.accepted = False
            self.result = ""
            raise RuntimeError("Нарушение прав доступа!")

    task = RejectedAgreementTask()
    task_reference = SimpleNamespace(GetObject=lambda: task)
    client = Docflow1CComClient()
    monkeypatch.setattr(client, "_connect", lambda **_kwargs: object())
    monkeypatch.setattr(client, "_reference_from_uuid", lambda *_args, **_kwargs: task_reference)

    def task_context(_connection, *, task_ref):
        return ({
            "ref": task_ref,
            "task_type": "ЗадачаИсполнителя",
            "process_ref": "22222222-2222-2222-2222-222222222222",
            "process_type": "Согласование",
            "business_state": "Активен",
            "result": task.result,
            "accepted": task.accepted,
            "completed": task.completed,
        }, object())

    monkeypatch.setattr(client, "_task_context", task_context)

    try:
        client.apply_task_action(
            login="test.user",
            password="temporary-test-password",
            task_ref="11111111-1111-1111-1111-111111111111",
            action="approve",
            result_template="Согласовано",
            comment="",
        )
    except Docflow1CConflictError as exc:
        assert "внешнее соединение" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("a rolled-back 1C action was reported as successful or unknown")


def test_docflow_adapter_preserves_the_safe_external_connection_denial():
    mapped = Docflow1CAdapter._map_error(
        Warehouse1CProcessBridgeRemoteError(
            "Docflow1CConflictError: 1С запретила выполнение задания через внешнее соединение"
        )
    )

    assert isinstance(mapped, DocflowStateConflict)
    assert "внешнее соединение" in str(mapped)


class _FakeRef:
    def __init__(self, value: str, *, obj=None) -> None:
        self.value = value
        self.obj = obj

    def UUID(self):
        return self.value

    def GetObject(self):
        return self.obj

    def __str__(self) -> str:
        return self.value


class _FakeManager:
    @staticmethod
    def GetRef(identifier):
        return identifier


class _RowsSelection:
    def __init__(self, rows):
        self.rows = list(rows)
        self.index = -1

    def Next(self):
        self.index += 1
        return self.index < len(self.rows)

    def __getattr__(self, name):
        if 0 <= self.index < len(self.rows):
            return self.rows[self.index].get(name, "")
        raise AttributeError(name)


class _RowsQuery:
    def __init__(self, rows) -> None:
        self.Text = ""
        self.parameters = {}
        self.rows = rows

    def SetParameter(self, name, value):
        self.parameters[name] = value

    def Execute(self):
        return SimpleNamespace(Select=lambda: _RowsSelection(self.rows))


class _DetailDocflowConnection(_FakeDocflowConnection):
    def __init__(self, queued_rows) -> None:
        super().__init__()
        self.queued_rows = list(queued_rows)
        self.queries = []
        self.Tasks = SimpleNamespace()
        setattr(self.Tasks, "ЗадачаИсполнителя", _FakeManager())
        self.Catalogs = SimpleNamespace()
        setattr(self.Catalogs, "Файлы", _FakeManager())

    def NewObject(self, kind, *args):
        if kind in {"UUID", "УникальныйИдентификатор"}:
            return _FakeRef(str(args[0]))
        assert kind == "Query"
        query = _RowsQuery(self.queued_rows.pop(0))
        self.queries.append(query)
        return query


def _task_detail_row(task_ref: str, process_ref: str, *, process_object=None):
    return {
        "Ссылка": _FakeRef(task_ref),
        "Представление": "Согласовать договор",
        "Выполнено": False,
        "БизнесПроцесс": _FakeRef(process_ref, obj=process_object),
        "Процесс": "Согласование договора",
        "Предмет": "Согласовать договор",
        "Описание": "Полное описание из 1С",
        "Автор": "Иванов И.И.",
        "Важность": "Высокая",
        "Принято": True,
    }


def test_task_detail_and_files_are_constrained_by_assignee_task_and_process(monkeypatch):
    for name in (
        "DOCFLOW_1C_TASK_TYPE",
        "DOCFLOW_1C_TASK_ASSIGNEE_FIELD",
        "DOCFLOW_1C_SESSION_USER_FIELD",
    ):
        monkeypatch.delenv(name, raising=False)
    task_ref = "11111111-1111-1111-1111-111111111111"
    process_ref = "22222222-2222-2222-2222-222222222222"
    file_ref = "33333333-3333-3333-3333-333333333333"
    connection = _DetailDocflowConnection(
        [
            [_task_detail_row(task_ref, process_ref)],
            [{
                "Ссылка": _FakeRef(file_ref),
                "Представление": "Договор",
                "ПолноеНаименование": "Договор",
                "Описание": "Приложение",
                "ДатаСоздания": datetime(2026, 7, 28, tzinfo=timezone.utc),
                "Размер": 2048,
                "Расширение": "docx",
            }],
        ]
    )
    client = Docflow1CComClient(
        connector_factory=lambda: SimpleNamespace(Connect=lambda _value: connection)
    )

    detail = client.get_task_detail(
        login="test.user",
        password="temporary-test-password",
        task_ref=task_ref,
    )

    assert detail["description"] == "Полное описание из 1С"
    assert detail["process_name"] == "Согласование договора"
    assert detail["files"] == [{
        "ref": file_ref,
        "name": "Договор.docx",
        "extension": "docx",
        "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "size": 2048,
        "created_at": "2026-07-28T00:00:00+00:00",
        "description": "Приложение",
        "preview_supported": True,
    }]
    detail_query, files_query = connection.queries
    assert "Задание.ТекущийИсполнитель = &ТекущийПользователь" in detail_query.Text
    assert "Задание.Ссылка = &Задание" in detail_query.Text
    assert detail_query.parameters["Задание"].value == task_ref
    assert "Файл.ВладелецФайла = &Владелец" in files_query.Text
    assert files_query.parameters["Владелец"].value == process_ref


def test_file_export_rejects_a_file_that_is_not_owned_by_the_tasks_process(monkeypatch):
    task_ref = "11111111-1111-1111-1111-111111111111"
    process_ref = "22222222-2222-2222-2222-222222222222"
    file_ref = "33333333-3333-3333-3333-333333333333"
    connection = _DetailDocflowConnection(
        [[_task_detail_row(task_ref, process_ref)], []]
    )
    client = Docflow1CComClient(
        connector_factory=lambda: SimpleNamespace(Connect=lambda _value: connection)
    )

    try:
        client.export_file(
            login="test.user",
            password="temporary-test-password",
            task_ref=task_ref,
            file_ref=file_ref,
        )
    except Docflow1CNotFoundError:
        pass
    else:  # pragma: no cover
        raise AssertionError("a foreign file reference must be rejected")

    file_query = connection.queries[1]
    assert "Файл.ВладелецФайла = &Владелец" in file_query.Text
    assert "Файл.Ссылка = &Файл" in file_query.Text
    assert file_query.parameters["Владелец"].value == process_ref
    assert file_query.parameters["Файл"].value == file_ref


def test_task_detail_includes_files_owned_by_a_business_process_subject(monkeypatch):
    task_ref = "11111111-1111-1111-1111-111111111111"
    process_ref = "22222222-2222-2222-2222-222222222222"
    subject_ref = "44444444-4444-4444-4444-444444444444"
    file_ref = "55555555-5555-5555-5555-555555555555"
    subject = _FakeRef(subject_ref)
    process_object = SimpleNamespace(
        Предметы=_FakeCollection([SimpleNamespace(Предмет=subject)])
    )
    connection = _DetailDocflowConnection(
        [
            [_task_detail_row(task_ref, process_ref, process_object=process_object)],
            [],
            [{
                "Ссылка": _FakeRef(file_ref),
                "Представление": "Приложение",
                "ПолноеНаименование": "Приложение",
                "Описание": "",
                "ДатаСоздания": datetime(2026, 7, 28, tzinfo=timezone.utc),
                "Размер": 4096,
                "Расширение": "pdf",
            }],
        ]
    )
    client = Docflow1CComClient(
        connector_factory=lambda: SimpleNamespace(Connect=lambda _value: connection)
    )

    detail = client.get_task_detail(
        login="test.user",
        password="temporary-test-password",
        task_ref=task_ref,
    )

    assert [item["ref"] for item in detail["files"]] == [file_ref]
    assert connection.queries[2].parameters["Владелец"].value == subject_ref


def test_file_export_uses_the_standard_1c_file_module_for_disk_volumes(monkeypatch, tmp_path):
    task_ref = "11111111-1111-1111-1111-111111111111"
    process_ref = "22222222-2222-2222-2222-222222222222"
    subject_ref = "44444444-4444-4444-4444-444444444444"
    file_ref = "55555555-5555-5555-5555-555555555555"
    version_ref = "66666666-6666-6666-6666-666666666666"
    subject = _FakeRef(subject_ref)
    process_object = SimpleNamespace(
        Предметы=_FakeCollection([SimpleNamespace(Предмет=subject)])
    )
    storage = SimpleNamespace(Get=lambda: None)
    version_object = SimpleNamespace(ФайлХранилище=storage)
    connection = _DetailDocflowConnection(
        [
            [_task_detail_row(task_ref, process_ref, process_object=process_object)],
            [],
            [{
                "Ссылка": _FakeRef(file_ref),
                "ПолноеНаименование": "Приложение",
                "Версия": _FakeRef(version_ref, obj=version_object),
                "Размер": 12,
                "Расширение": "pdf",
            }],
        ]
    )
    requested_refs = []
    connection.РаботаСФайлами = SimpleNamespace(
        ДвоичныеДанныеФайла=lambda ref, _raise_error: requested_refs.append(ref.value) or b"%PDF-fixture"
    )
    monkeypatch.setattr(
        docflow_1c_client_module,
        "docflow_export_root",
        lambda: tmp_path / "docflow-files",
    )
    client = Docflow1CComClient(
        connector_factory=lambda: SimpleNamespace(Connect=lambda _value: connection)
    )

    exported = client.export_file(
        login="test.user",
        password="temporary-test-password",
        task_ref=task_ref,
        file_ref=file_ref,
    )
    exported_path = Path(exported["temporary_path"])
    try:
        assert exported_path.read_bytes() == b"%PDF-fixture"
        assert requested_refs == [file_ref]
        assert connection.queries[2].parameters["Владелец"].value == subject_ref
    finally:
        exported_path.unlink(missing_ok=True)


def test_file_export_falls_back_to_the_service_ad_volume_reader(monkeypatch, tmp_path):
    task_ref = "11111111-1111-1111-1111-111111111111"
    process_ref = "22222222-2222-2222-2222-222222222222"
    subject_ref = "44444444-4444-4444-4444-444444444444"
    file_ref = "55555555-5555-5555-5555-555555555555"
    version_ref = "66666666-6666-6666-6666-666666666666"
    subject = _FakeRef(subject_ref)
    process_object = SimpleNamespace(
        Предметы=_FakeCollection([SimpleNamespace(Предмет=subject)])
    )
    version_object = SimpleNamespace(
        ФайлХранилище=SimpleNamespace(Get=lambda: None),
        ПутьКФайлу=r"20260728\Приложение_fixture.1.pdf",
        Том=SimpleNamespace(),
    )
    connection = _DetailDocflowConnection(
        [
            [_task_detail_row(task_ref, process_ref, process_object=process_object)],
            [],
            [{
                "Ссылка": _FakeRef(file_ref),
                "ПолноеНаименование": "Приложение",
                "Версия": _FakeRef(version_ref, obj=version_object),
                "Размер": 12,
                "Расширение": "pdf",
            }],
        ]
    )

    def unavailable_from_1c(_ref, _raise_error):
        raise RuntimeError("Файл не найден в хранилище файлов")

    connection.РаботаСФайлами = SimpleNamespace(
        ДвоичныеДанныеФайла=unavailable_from_1c
    )
    copied = []

    def fake_volume_copy(conn, version, destination, *, maximum_size):
        copied.append((conn, version, maximum_size))
        destination.write_bytes(b"%PDF-volume")

    monkeypatch.setattr(
        docflow_1c_client_module,
        "_copy_docflow_volume_file",
        fake_volume_copy,
    )
    monkeypatch.setattr(
        docflow_1c_client_module,
        "docflow_export_root",
        lambda: tmp_path / "docflow-files",
    )
    client = Docflow1CComClient(
        connector_factory=lambda: SimpleNamespace(Connect=lambda _value: connection)
    )

    exported = client.export_file(
        login="test.user",
        password="temporary-test-password",
        task_ref=task_ref,
        file_ref=file_ref,
    )
    exported_path = Path(exported["temporary_path"])
    try:
        assert exported_path.read_bytes() == b"%PDF-volume"
        assert copied == [(connection, version_object, 50 * 1024 * 1024)]
    finally:
        exported_path.unlink(missing_ok=True)


def test_docflow_volume_path_rejects_traversal_outside_the_allowed_root(monkeypatch):
    allowed_root = r"\\tmn-srv-db-01\DOC$\docflow"
    monkeypatch.setenv("DOCFLOW_FILE_VOLUME_ROOTS", allowed_root)
    volume_object = SimpleNamespace(ПолныйПутьWindows=allowed_root)
    version_object = SimpleNamespace(
        ПутьКФайлу=r"..\secret.txt",
        Том=_FakeRef("77777777-7777-7777-7777-777777777777", obj=volume_object),
    )
    connection = SimpleNamespace()

    try:
        docflow_1c_client_module._docflow_volume_source_path(connection, version_object)
    except Docflow1CFileStorageUnavailableError:
        pass
    else:  # pragma: no cover
        raise AssertionError("a 1C relative path must not escape the configured volume root")


def test_docflow_volume_path_requires_the_1c_volume_to_be_allowlisted(monkeypatch):
    monkeypatch.setenv(
        "DOCFLOW_FILE_VOLUME_ROOTS",
        r"\\tmn-srv-db-01\DOC$\docflow",
    )
    volume_object = SimpleNamespace(
        ПолныйПутьWindows=r"\\untrusted-server\share\docflow"
    )
    version_object = SimpleNamespace(
        ПутьКФайлу=r"20260728\Приложение.pdf",
        Том=_FakeRef("77777777-7777-7777-7777-777777777777", obj=volume_object),
    )
    connection = SimpleNamespace()

    try:
        docflow_1c_client_module._docflow_volume_source_path(connection, version_object)
    except Docflow1CFileStorageUnavailableError:
        pass
    else:  # pragma: no cover
        raise AssertionError("a storage volume outside the allowlist must be rejected")


def test_docflow_volume_path_maps_the_declared_1c_root_to_an_allowlisted_ip_root(monkeypatch):
    declared_root = r"\\tmn-srv-db-01\DOC$\docflow"
    accessible_root = r"\\10.103.0.170\doc$\docflow"
    monkeypatch.setenv("DOCFLOW_FILE_VOLUME_ROOTS", "")
    monkeypatch.setenv(
        "DOCFLOW_FILE_VOLUME_MAPPINGS",
        f"{declared_root}=>{accessible_root}",
    )
    volume_object = SimpleNamespace(ПолныйПутьWindows=declared_root)
    version_object = SimpleNamespace(
        ПутьКФайлу=r"20260728\Приложение.pdf",
        Том=_FakeRef("77777777-7777-7777-7777-777777777777", obj=volume_object),
    )

    source = docflow_1c_client_module._docflow_volume_source_path(
        SimpleNamespace(),
        version_object,
    )

    assert str(source) == accessible_root + r"\20260728\Приложение.pdf"


def test_docflow_process_identity_does_not_open_an_ad_credential_connection(monkeypatch):
    monkeypatch.setenv("DOCFLOW_FILE_USE_PROCESS_IDENTITY", "1")
    monkeypatch.delenv("DOCFLOW_FILE_AD_USER", raising=False)
    monkeypatch.delenv("DOCFLOW_FILE_AD_PASSWORD", raising=False)
    monkeypatch.setenv("DOCFLOW_FILE_USE_LDAP_SYNC_CREDENTIALS", "0")

    def unexpected_connection(**_kwargs):  # pragma: no cover
        raise AssertionError("process identity must not create a credentialed SMB connection")

    monkeypatch.setattr(
        docflow_1c_client_module,
        "_connect_windows_share",
        unexpected_connection,
    )

    docflow_1c_client_module._ensure_docflow_share_connection(
        Path(r"\\10.103.0.170\doc$\docflow\20260728\Приложение.pdf")
    )


def test_docflow_adapter_maps_volume_access_failures_to_a_specific_safe_error():
    mapped = Docflow1CAdapter._map_error(
        Docflow1CFileStorageUnavailableError("sensitive low-level detail")
    )

    assert isinstance(mapped, DocflowFileStorageUnavailable)
    assert mapped.code == "DOCFLOW_FILE_STORAGE_UNAVAILABLE"
    assert mapped.status_code == 503
    assert "sensitive low-level detail" not in str(mapped)


def test_docflow_volume_credentials_do_not_reuse_ldap_without_explicit_opt_in(monkeypatch):
    monkeypatch.delenv("DOCFLOW_FILE_AD_USER", raising=False)
    monkeypatch.delenv("DOCFLOW_FILE_AD_PASSWORD", raising=False)
    monkeypatch.delenv("DOCFLOW_FILE_USE_LDAP_SYNC_CREDENTIALS", raising=False)
    monkeypatch.setenv("LDAP_SYNC_USER", "fixture-sync@domain.test")
    monkeypatch.setenv("LDAP_SYNC_PASSWORD", "fixture-password")

    try:
        docflow_1c_client_module._docflow_file_network_credentials()
    except Docflow1CFileStorageUnavailableError:
        pass
    else:  # pragma: no cover
        raise AssertionError("LDAP sync credentials must require explicit docflow opt-in")


def test_docflow_volume_credentials_prefer_a_dedicated_account(monkeypatch):
    monkeypatch.setenv("DOCFLOW_FILE_USE_LDAP_SYNC_CREDENTIALS", "1")
    monkeypatch.setenv("LDAP_SYNC_USER", "fixture-sync@domain.test")
    monkeypatch.setenv("LDAP_SYNC_PASSWORD", "fixture-ldap-password")
    monkeypatch.setenv("DOCFLOW_FILE_AD_USER", r"DOMAIN\fixture-docflow")
    monkeypatch.setenv("DOCFLOW_FILE_AD_PASSWORD", "fixture-docflow-password")
    monkeypatch.setenv("DOCFLOW_FILE_AD_DOMAIN", "domain.test")

    credentials = docflow_1c_client_module._docflow_file_network_credentials()

    assert credentials == (
        r"DOMAIN\fixture-docflow",
        "fixture-docflow-password",
        "domain.test",
    )
