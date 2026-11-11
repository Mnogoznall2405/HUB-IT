from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.chat.chat_presence_service import ChatPresenceService
from backend.chat.schemas import ChatUserSummary


def test_chat_user_summary_includes_workplace_context() -> None:
    service = SimpleNamespace(
        _build_presence_payload=lambda **_kwargs: {
            "is_online": False,
            "last_seen_at": None,
            "status_text": "Не в сети",
        }
    )
    work_profile_resolver = SimpleNamespace(
        resolve_user=lambda _user: {
            "job_title": "Ведущий системный администратор",
            "department": "Управление ИТ",
            "city": "Тюмень",
            "corporate_email": "employee@zsgp.ru",
            "corporate_phone": "+7 (3452) 12-34-56",
            "source": "zup",
            "updated_at": "2026-08-20T08:00:00+00:00",
        }
    )
    serializer = ChatPresenceService(service, work_profile_resolver=work_profile_resolver)

    payload = serializer._serialize_user(
        {
            "id": 2,
            "username": "assignee",
            "full_name": "Иван Петров",
            "department": "ИТ",
            "job_title": "Системный администратор",
            "role": "operator",
            "is_active": True,
        }
    )
    validated = ChatUserSummary.model_validate(payload)

    assert validated.department == "Управление ИТ"
    assert validated.job_title == "Ведущий системный администратор"
    assert validated.city == "Тюмень"
    assert validated.corporate_email == "employee@zsgp.ru"
    assert validated.corporate_phone == "+7 (3452) 12-34-56"
    assert validated.work_profile_source == "zup"
    assert validated.work_profile_updated_at == "2026-08-20T08:00:00+00:00"


def test_chat_user_summary_keeps_hub_workplace_as_fallback() -> None:
    service = SimpleNamespace(
        _build_presence_payload=lambda **_kwargs: {
            "is_online": False,
            "last_seen_at": None,
            "status_text": "Не в сети",
        }
    )
    serializer = ChatPresenceService(
        service,
        work_profile_resolver=SimpleNamespace(resolve_user=lambda _user: None),
    )

    validated = ChatUserSummary.model_validate(
        serializer._serialize_user(
            {
                "id": 3,
                "username": "fallback",
                "department": "ИТ",
                "job_title": "Инженер",
            }
        )
    )

    assert validated.department == "ИТ"
    assert validated.job_title == "Инженер"
    assert validated.city is None
    assert validated.corporate_email is None
    assert validated.corporate_phone is None
    assert validated.work_profile_source == "hub"
