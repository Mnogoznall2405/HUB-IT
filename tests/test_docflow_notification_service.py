from unittest.mock import ANY, AsyncMock, Mock

import pytest

from backend.services.docflow_notification_service import (
    DocflowNotificationService,
    hub_realtime_publisher,
)


@pytest.mark.asyncio
async def test_docflow_notifications_baseline_then_emit_only_new_assignments(monkeypatch):
    docflow = Mock()
    docflow.list_tasks = AsyncMock(
        side_effect=[
            {"items": [{"ref": "old", "title": "Старое задание"}]},
            {
                "items": [
                    {"ref": "new", "title": "Согласовать договор", "author": "Иванов И.И."},
                    {"ref": "old", "title": "Старое задание"},
                ]
            },
        ]
    )
    hub = Mock()
    hub.create_notifications_batch.return_value = 1
    push = Mock()
    push.enqueue_notification.return_value = Mock(accepted=True, sent=0)
    preferences = Mock()
    preferences.is_enabled.return_value = True
    checkpoint = Mock()
    checkpoint.read.return_value = {"payload": None}
    checkpoint.write_success.return_value = {"state": "ok"}
    service = DocflowNotificationService(
        docflow=docflow,
        hub=hub,
        push=push,
        preferences=preferences,
        checkpoint=checkpoint,
    )
    publish_realtime = Mock(return_value=True)
    monkeypatch.setattr(hub_realtime_publisher, "publish_user_event", publish_realtime)

    first = await service.poll_once(candidate_user_ids=[7])
    second = await service.poll_once(candidate_user_ids=[7])

    assert first["notifications"] == 0
    assert second["notifications"] == 1
    hub.create_notifications_batch.assert_called_once_with([
        {
            "recipient_user_id": 7,
            "event_type": "docflow.assigned",
            "title": "Новое задание в 1С ДО",
            "body": "Согласовать договор · Иванов И.И.",
            "entity_type": "docflow",
            "entity_id": "new",
        }
    ])
    push.enqueue_notification.assert_called_once_with(
        recipient_user_id=7,
        title="Новое задание в 1С ДО",
        body="Согласовать договор · Иванов И.И.",
        channel="docflow",
        route="/docflow?task=new",
        tag=ANY,
        data={"task_ref": "new", "entity_type": "docflow"},
        ttl=7 * 24 * 60 * 60,
    )
    publish_realtime.assert_called_once_with(
        recipient_user_id=7,
        event_type="docflow.task.changed",
        event_id=ANY,
        payload={
            "operation": "tasks.assigned",
            "task_refs": ["new"],
            "count": 1,
        },
    )


@pytest.mark.asyncio
async def test_docflow_notifications_resume_from_durable_checkpoint_after_restart():
    docflow = Mock()
    docflow.list_tasks = AsyncMock(return_value={
        "items": [
            {"ref": "new", "title": "Новое задание"},
            {"ref": "old", "title": "Старое задание"},
        ]
    })
    hub = Mock()
    hub.create_notifications_batch.return_value = 1
    push = Mock()
    push.enqueue_notification.return_value = Mock(accepted=True, sent=0)
    checkpoint = Mock()
    checkpoint.read.return_value = {"payload": {"refs": ["old"]}}
    checkpoint.write_success.return_value = {"state": "ok"}
    service = DocflowNotificationService(
        docflow=docflow,
        hub=hub,
        push=push,
        preferences=Mock(),
        checkpoint=checkpoint,
    )

    result = await service.poll_once(candidate_user_ids=[7])

    assert result == {"candidates": 1, "notifications": 1, "errors": 0}
    hub.create_notifications_batch.assert_called_once()
    assert hub.create_notifications_batch.call_args.args[0][0]["entity_id"] == "new"
    checkpoint.write_success.assert_called_with(
        user_id=7,
        mailbox_id="aggregate",
        snapshot_type="docflow_notification_checkpoint",
        context_key="inbox",
        payload={"refs": ["new", "old"]},
        ttl_seconds=30 * 24 * 60 * 60,
    )


@pytest.mark.asyncio
async def test_docflow_notification_candidates_rotate_without_starving_later_users(monkeypatch):
    monkeypatch.setenv("DOCFLOW_NOTIFICATION_BATCH_SIZE", "2")
    docflow = Mock()
    docflow.warmup_user_ids = AsyncMock(return_value=[1, 2, 3, 4])
    preferences = Mock()
    preferences.is_enabled.return_value = True
    service = DocflowNotificationService(docflow=docflow, preferences=preferences)
    service._active_push_user_ids = Mock(return_value=set())
    monkeypatch.setattr(
        "backend.services.docflow_notification_service.session_service.list_sessions",
        lambda active_only=True: [{"user_id": value} for value in (1, 2, 3, 4)],
    )
    monkeypatch.setattr(
        "backend.services.docflow_notification_service.user_service.list_users",
        lambda: [{"id": value, "role": "admin", "is_active": True} for value in (1, 2, 3, 4)],
    )
    monkeypatch.setattr(
        "backend.services.docflow_notification_service.authorization_service.has_permission",
        lambda *args, **kwargs: True,
    )

    assert await service._candidate_user_ids() == [1, 2]
    assert await service._candidate_user_ids() == [3, 4]
