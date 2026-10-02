import sys
from pathlib import Path
from types import SimpleNamespace

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.chat.notification_planner import build_chat_notification_recipient_plans


def test_notification_planner_skips_muted_member_without_mention():
    plans = build_chat_notification_recipient_plans(
        sender_user_id=1,
        conversation_kind="group",
        conversation_title="Ops",
        member_ids=[1, 2, 3],
        states_by_user_id={2: SimpleNamespace(is_muted=True), 3: SimpleNamespace(is_muted=False)},
        sender_name="Author",
        event_type="chat.message",
        title="New message",
        body="Hello",
        default_title="New message",
        default_group_title="Group chat",
        mention_prefix="Mentioned you",
    )

    assert [item.recipient_user_id for item in plans] == [3]
    assert plans[0].title == "Ops"
    assert plans[0].body == "Author: Hello"


def test_notification_planner_mentions_bypass_muted_state():
    plans = build_chat_notification_recipient_plans(
        sender_user_id=1,
        conversation_kind="group",
        conversation_title="Ops",
        member_ids=[1, 2],
        states_by_user_id={2: SimpleNamespace(is_muted=True, is_archived=True)},
        sender_name="Author",
        event_type="chat.message",
        title="New message",
        body="@assignee hello",
        mentioned_user_ids={2},
        default_title="New message",
        default_group_title="Group chat",
        mention_prefix="Mentioned you",
    )

    assert len(plans) == 1
    assert plans[0].recipient_user_id == 2
    assert plans[0].event_type == "chat.mention"
    assert plans[0].title == "Mentioned you: Ops"


def test_notification_planner_direct_custom_title_moves_to_body_prefix():
    plans = build_chat_notification_recipient_plans(
        sender_user_id=1,
        conversation_kind="direct",
        conversation_title="",
        member_ids=[1, 2],
        states_by_user_id={},
        sender_name="Author",
        event_type="chat.message",
        title="Task",
        body="Shared",
        default_title="New message",
        default_group_title="Group chat",
        mention_prefix="Mentioned you",
    )

    assert len(plans) == 1
    assert plans[0].title == "Author"
    assert plans[0].body == "[Task] Shared"


def test_ai_reply_notification_says_who_answered_and_shows_plain_beginning():
    """AG: a finished AI answer is a normal incoming message: "ИИ ответил: <beginning>"."""
    from backend.chat.notification_planner import ai_reply_preview

    answer = (
        "**Принтер Canon** настроен: см. [инструкцию](https://example.com/x) и `код`.\n\n"
        "_Учтена личная память: 2 факта_"
    )
    plans = build_chat_notification_recipient_plans(
        sender_user_id=900,
        conversation_kind="ai",
        conversation_title="HUB Ассистент",
        member_ids=[900, 5],
        states_by_user_id={},
        sender_name="HUB Ассистент",
        event_type="chat.message_received",
        title="Новое сообщение в чате",
        body=answer,
        default_title="Новое сообщение в чате",
        default_group_title="Групповой чат",
        mention_prefix="Вас упомянули",
    )

    assert [item.recipient_user_id for item in plans] == [5]
    assert plans[0].title == "ИИ ответил"
    assert plans[0].body == "Принтер Canon настроен: см. инструкцию и код."
    assert "Учтена" not in plans[0].body and "*" not in plans[0].body
    assert len(ai_reply_preview("слово " * 100)) <= 140
    assert ai_reply_preview("слово " * 100).endswith("…")
    assert ai_reply_preview("") == ""


def test_ai_reply_notification_respects_muted_and_archived_chat():
    plans = build_chat_notification_recipient_plans(
        sender_user_id=900,
        conversation_kind="ai",
        conversation_title="HUB Ассистент",
        member_ids=[900, 5, 6],
        states_by_user_id={5: SimpleNamespace(is_muted=True), 6: SimpleNamespace(is_archived=True)},
        sender_name="HUB Ассистент",
        event_type="chat.message_received",
        title="Новое сообщение в чате",
        body="Готово",
        default_title="Новое сообщение в чате",
        default_group_title="Групповой чат",
        mention_prefix="Вас упомянули",
    )
    assert plans == []
