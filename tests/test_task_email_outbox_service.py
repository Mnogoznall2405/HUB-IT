"""Unit tests for task email outbox helpers."""

from __future__ import annotations

import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

outbox_module = importlib.import_module("backend.services.task_email_outbox_service")
hub_service_module = importlib.import_module("backend.services.hub_service")


@pytest.fixture
def hub_service_instance(temp_dir, monkeypatch):
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub_outbox.db"),
        data_dir=str(Path(temp_dir) / "data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    return hub_service_module.HubService()


def test_normalize_email_deadline_remind_hours_accepts_valid_values():
    assert outbox_module._normalize_email_deadline_remind_hours(24) == 24
    assert outbox_module._normalize_email_deadline_remind_hours(0) == 0
    assert outbox_module._normalize_email_deadline_remind_hours(None) is None


def test_normalize_email_deadline_remind_hours_rejects_invalid_values():
    with pytest.raises(ValueError):
        outbox_module._normalize_email_deadline_remind_hours(200)


def test_resolve_email_deadline_remind_hours_uses_task_value():
    task = {"email_deadline_remind_hours": 12}
    assert outbox_module._resolve_email_deadline_remind_hours(task) == 12.0


def test_resolve_email_deadline_remind_hours_disabled_when_zero():
    task = {"email_deadline_remind_hours": 0}
    assert outbox_module._resolve_email_deadline_remind_hours(task) is None


def test_mark_task_email_sent_updates_row_status(hub_service_instance):
    service = hub_service_instance
    with service._lock, service._connect() as conn:
        conn.execute(
            f"""
            INSERT INTO {service._TASK_EMAIL_OUTBOX_TABLE}
            (id, dedupe_key, task_id, recipient_user_id, recipient_email, event_type,
             subject, body_text, body_html, status, attempt_count, available_at,
             created_at, updated_at, sent_at, last_error)
            VALUES ('outbox-1', 'dedupe-1', 'task-1', 2, 'a@test.local', 'task.assigned',
                    'Subject', 'Body', '', 'sending', 1, '2026-01-01T00:00:00+00:00',
                    '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00', NULL, '')
            """
        )
        conn.commit()

    service._mark_task_email_sent('outbox-1')

    with service._lock, service._connect() as conn:
        row = conn.execute(
            f"SELECT status, sent_at, last_error FROM {service._TASK_EMAIL_OUTBOX_TABLE} WHERE id = ?",
            ('outbox-1',),
        ).fetchone()
    assert dict(row)['status'] == 'sent'
    assert dict(row)['sent_at']
    assert dict(row)['last_error'] == ''


def test_mark_task_email_failed_requeues_until_max_attempts(hub_service_instance, monkeypatch):
    service = hub_service_instance
    monkeypatch.setattr(
        outbox_module.task_email_service,
        'max_attempts',
        lambda: 3,
    )
    with service._lock, service._connect() as conn:
        conn.execute(
            f"""
            INSERT INTO {service._TASK_EMAIL_OUTBOX_TABLE}
            (id, dedupe_key, task_id, recipient_user_id, recipient_email, event_type,
             subject, body_text, body_html, status, attempt_count, available_at,
             created_at, updated_at, sent_at, last_error)
            VALUES ('outbox-2', 'dedupe-2', 'task-2', 2, 'b@test.local', 'task.assigned',
                    'Subject', 'Body', '', 'sending', 1, '2026-01-01T00:00:00+00:00',
                    '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00', NULL, '')
            """
        )
        conn.commit()

    service._mark_task_email_failed({'id': 'outbox-2', 'attempt_count': 1}, 'smtp down')

    with service._lock, service._connect() as conn:
        row = conn.execute(
            f"SELECT status, last_error FROM {service._TASK_EMAIL_OUTBOX_TABLE} WHERE id = ?",
            ('outbox-2',),
        ).fetchone()
    assert dict(row)['status'] == 'pending'
    assert 'smtp down' in dict(row)['last_error']

    service._mark_task_email_failed({'id': 'outbox-2', 'attempt_count': 3}, 'smtp down again')

    with service._lock, service._connect() as conn:
        row = conn.execute(
            f"SELECT status FROM {service._TASK_EMAIL_OUTBOX_TABLE} WHERE id = ?",
            ('outbox-2',),
        ).fetchone()
    assert dict(row)['status'] == 'failed'
