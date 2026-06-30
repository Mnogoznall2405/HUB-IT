"""Unit tests for task participant / observer helpers."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

participant_module = importlib.import_module("backend.services.task_participant_service")


class _ParticipantStub(participant_module.TaskParticipantMixin):
    def _as_int(self, value, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _json_load_list(self, value):
        if value is None:
            return []
        if isinstance(value, list):
            return value
        return []

    def _unique_ints(self, values):
        out: list[int] = []
        seen: set[int] = set()
        for item in values or []:
            try:
                num = int(item)
            except (TypeError, ValueError):
                continue
            if num <= 0 or num in seen:
                continue
            seen.add(num)
            out.append(num)
        return out

    def _serialize_json_list(self, values):
        import json

        return json.dumps(list(values or []))

    def _users_by_id(self):
        return {}

    def _uses_postgresql(self) -> bool:
        return False


@pytest.fixture
def participant_stub(monkeypatch):
    stub = _ParticipantStub()
    monkeypatch.setattr(
        participant_module.user_service,
        "get_by_id",
        lambda user_id: {
            "id": int(user_id),
            "username": f"user{user_id}",
            "full_name": f"User {user_id}",
            "is_active": True,
        },
    )
    monkeypatch.setattr(
        participant_module.user_service,
        "get_delegate_user_ids",
        lambda assignee_user_id: [int(assignee_user_id) + 100] if int(assignee_user_id or 0) == 2 else [],
    )
    return stub


def test_task_participant_user_ids_includes_assignee_creator_controller(participant_stub):
    task = {
        "assignee_user_id": 2,
        "created_by_user_id": 1,
        "controller_user_id": 3,
    }
    assert participant_stub._task_participant_user_ids(task, include_delegates=False) == {1, 2, 3}


def test_task_participant_user_ids_includes_delegates(participant_stub):
    task = {
        "assignee_user_id": 2,
        "created_by_user_id": 1,
        "controller_user_id": 0,
    }
    assert participant_stub._task_participant_user_ids(task, include_delegates=True) == {1, 2, 102}


def test_task_observer_and_viewer_user_ids(participant_stub):
    task = {
        "assignee_user_id": 2,
        "created_by_user_id": 1,
        "controller_user_id": 0,
        "observer_user_ids": [4, 5, 4],
    }
    assert participant_stub._task_observer_user_ids(task) == {4, 5}
    assert participant_stub._task_viewer_user_ids(task) == {1, 2, 4, 5, 102}
    assert participant_stub._task_discussion_user_ids(task) == {1, 2, 4, 5, 102}


def test_normalize_observer_user_ids_excludes_participants(participant_stub):
    normalized = participant_stub._normalize_observer_user_ids(
        [1, 2, 4, 4],
        creator_user_id=1,
        assignee_user_id=2,
        controller_user_id=0,
    )
    assert normalized == [4]


def test_enrich_task_observer_fields(participant_stub):
    item = {"observer_user_ids": [4]}
    enriched = participant_stub._enrich_task_observer_fields(item)
    assert enriched["observer_user_ids"] == [4]
    assert enriched["observers"] == [
        {"user_id": 4, "username": "user4", "full_name": "User 4"},
    ]


def test_observer_membership_clause_sqlite(participant_stub):
    clause, params = participant_stub._observer_membership_clause(7)
    assert "json_each" in clause
    assert params == [7]
