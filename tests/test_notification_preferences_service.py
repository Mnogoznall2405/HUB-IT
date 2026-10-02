from pathlib import Path
from datetime import datetime, timezone

from backend.services.notification_preferences_service import (
    NotificationPreferencesService,
    chat_notification_channel,
)


def _service(temp_dir: str) -> NotificationPreferencesService:
    return NotificationPreferencesService(Path(temp_dir) / "notification_preferences.json")


def test_chat_notification_channel_maps_supported_conversation_kinds():
    assert chat_notification_channel("direct") == "chat_direct"
    assert chat_notification_channel("ai") == "chat_ai"
    assert chat_notification_channel("group") == "chat_group"
    assert chat_notification_channel("task") == "chat_task"
    assert chat_notification_channel("unknown") == "chat"


def test_chat_ai_channel_defaults_enabled_and_accepts_patch(temp_dir):
    service = _service(temp_dir)

    # Missing key counts as enabled: old profiles keep AI pushes by default.
    assert service.get_preferences(user_id=42)["channels"]["chat_ai"] is True
    assert service.is_enabled(user_id=42, channel="chat_ai") is True
    assert service.enabled_user_ids(user_ids=[42, 43], channel="chat_ai") == {42, 43}

    updated = service.update_preferences(user_id=42, patch={"chat_ai": False})

    assert updated["channels"]["chat_ai"] is False
    assert updated["channels"]["chat_direct"] is True
    assert service.is_enabled(user_id=42, channel="chat_ai") is False
    assert service.enabled_user_ids(user_ids=[42, 43], channel="chat_ai") == {43}

    reloaded = service.get_preferences(user_id=42)
    assert reloaded["channels"]["chat_ai"] is False


def test_master_chat_switch_and_legacy_payload_cover_chat_ai(temp_dir):
    service = _service(temp_dir)

    updated = service.update_preferences(user_id=7, patch={"chat": False})
    assert updated["channels"]["chat_ai"] is False

    # Payloads written before `chat_ai` existed still inherit the shared switch.
    service._save_all({"8": {"chat": False}})
    legacy = service.get_preferences(user_id=8)
    assert legacy["channels"]["chat_ai"] is False
    assert legacy["channels"]["chat_direct"] is False


def test_notification_preferences_patch_request_accepts_chat_ai():
    from backend.api.v1.settings import NotificationPreferencesPatchRequest

    payload = NotificationPreferencesPatchRequest.model_validate({"chat_ai": False})
    assert payload.model_dump(exclude_unset=True) == {"chat_ai": False}


def test_legacy_chat_preference_is_inherited_by_new_chat_categories(temp_dir):
    service = _service(temp_dir)

    updated = service.update_preferences(user_id=7, patch={"chat": False})

    assert updated["channels"]["chat_direct"] is False
    reloaded = service.get_preferences(user_id=7)
    assert reloaded["channels"]["chat_direct"] is False

    # Simulate the payload written by the version that only knew the shared
    # `chat` switch. Missing category keys must inherit that existing choice.
    service._save_all({"8": {"chat": False}})
    legacy = service.get_preferences(user_id=8)
    assert legacy["channels"]["chat_direct"] is False
    assert legacy["channels"]["chat_group"] is False
    assert legacy["channels"]["chat_task"] is False
    assert legacy["channels"]["docflow"] is True


def test_chat_categories_can_be_changed_independently(temp_dir):
    service = _service(temp_dir)

    updated = service.update_preferences(
        user_id=9,
        patch={
            "chat_direct": False,
            "chat_group": True,
            "chat_task": False,
        },
    )

    assert updated["channels"]["chat_direct"] is False
    assert updated["channels"]["chat_group"] is True
    assert updated["channels"]["chat_task"] is False
    assert updated["channels"]["chat"] is True
    assert service.enabled_user_ids(user_ids=[9, 10], channel="chat_direct") == {10}
    assert service.enabled_user_ids(user_ids=[9, 10], channel="chat_group") == {9, 10}

    # The shared `chat` switch stays on while the still-enabled chat_ai
    # category keeps at least one chat channel active.
    partial = service.update_preferences(user_id=9, patch={"chat_group": False})
    assert partial["channels"]["chat"] is True

    all_disabled = service.update_preferences(user_id=9, patch={"chat_ai": False})
    assert all_disabled["channels"]["chat"] is False


def test_quiet_hours_support_overnight_windows_and_keep_system_events_enabled(temp_dir):
    service = _service(temp_dir)
    updated = service.update_preferences(
        user_id=11,
        patch={
            "quiet_hours_enabled": True,
            "quiet_hours_start": "22:00",
            "quiet_hours_end": "07:00",
            "quiet_hours_timezone": "Asia/Yekaterinburg",
        },
    )

    assert updated["quiet_hours"] == {
        "enabled": True,
        "start": "22:00",
        "end": "07:00",
        "timezone": "Asia/Yekaterinburg",
    }
    assert service.is_quiet_hours_active(
        user_id=11,
        channel="chat",
        now_utc=datetime(2026, 8, 22, 18, 0, tzinfo=timezone.utc),
    ) is True  # 23:00 in Asia/Yekaterinburg
    assert service.is_quiet_hours_active(
        user_id=11,
        channel="mail",
        now_utc=datetime(2026, 8, 22, 7, 0, tzinfo=timezone.utc),
    ) is False  # 12:00 in Asia/Yekaterinburg
    assert service.is_quiet_hours_active(
        user_id=11,
        channel="system",
        now_utc=datetime(2026, 8, 22, 18, 0, tzinfo=timezone.utc),
    ) is False


def test_quiet_hours_reject_equal_start_and_end_when_enabled(temp_dir):
    service = _service(temp_dir)

    try:
        service.update_preferences(
            user_id=12,
            patch={
                "quiet_hours_enabled": True,
                "quiet_hours_start": "09:00",
                "quiet_hours_end": "09:00",
            },
        )
    except ValueError as exc:
        assert "must be different" in str(exc)
    else:
        raise AssertionError("equal quiet hours boundaries must be rejected")
