from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.chat.schemas import ChatConversationListResponse, ChatConversationSummary


def test_chat_conversation_summary_accepts_task_kind():
    payload = ChatConversationSummary(
        id="conv-task-1",
        kind="task",
        title="Задача: Проверить акт",
        task_id="task-42",
        task_title="Проверить акт",
        task_status="in_progress",
        task_assignee_full_name="Task Assignee",
        task_due_at="2026-06-20T12:00:00+00:00",
        task_completed_at=None,
        created_at="2026-06-18T10:00:00+00:00",
        updated_at="2026-06-18T10:00:00+00:00",
    )
    assert payload.kind == "task"
    assert payload.task_id == "task-42"
    assert payload.task_assignee_full_name == "Task Assignee"
    assert payload.task_due_at == "2026-06-20T12:00:00+00:00"


def test_chat_conversation_list_response_accepts_task_items():
    response = ChatConversationListResponse.model_validate({
        "items": [
            {
                "id": "conv-task-1",
                "kind": "task",
                "title": "Задача: Demo",
                "task_id": "task-1",
                "created_at": "2026-06-18T10:00:00+00:00",
                "updated_at": "2026-06-18T10:00:00+00:00",
            }
        ]
    })
    assert response.items[0].kind == "task"
