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

    service._mark_task_email_failed({'id': 'outbox-2', 'claim_token': 1}, 'smtp down')

    with service._lock, service._connect() as conn:
        row = conn.execute(
            f"SELECT status, last_error FROM {service._TASK_EMAIL_OUTBOX_TABLE} WHERE id = ?",
            ('outbox-2',),
        ).fetchone()
    assert dict(row)['status'] == 'pending'
    assert 'smtp down' in dict(row)['last_error']

    with service._lock, service._connect() as conn:
        conn.execute(
            f"UPDATE {service._TASK_EMAIL_OUTBOX_TABLE} SET status = 'sending', attempt_count = 3 WHERE id = 'outbox-2'"
        )
        conn.commit()
    service._mark_task_email_failed({'id': 'outbox-2', 'claim_token': 3}, 'smtp down again')

    with service._lock, service._connect() as conn:
        row = conn.execute(
            f"SELECT status FROM {service._TASK_EMAIL_OUTBOX_TABLE} WHERE id = ?",
            ('outbox-2',),
        ).fetchone()
    assert dict(row)['status'] == 'failed'


def _insert_outbox_row(service, row_id, *, status, attempt_count, updated_at):
    with service._lock, service._connect() as conn:
        conn.execute(
            f"""
            INSERT INTO {service._TASK_EMAIL_OUTBOX_TABLE}
            (id, dedupe_key, task_id, recipient_user_id, recipient_email, event_type,
             subject, body_text, body_html, status, attempt_count, available_at,
             created_at, updated_at, sent_at, last_error)
            VALUES (?, ?, 'task-x', 2, ?, 'task.assigned', 'Subject', 'Body', '', ?, ?,
                    '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00', ?, NULL, '')
            """,
            (row_id, f"dedupe-{row_id}", f"{row_id}@test.local", status, attempt_count, updated_at),
        )
        conn.commit()


def _outbox_status(service, row_id):
    with service._lock, service._connect() as conn:
        row = conn.execute(
            f"SELECT status, attempt_count FROM {service._TASK_EMAIL_OUTBOX_TABLE} WHERE id = ?",
            (row_id,),
        ).fetchone()
    return dict(row)


def test_dispatch_claims_row_once_and_recovers_only_stale_sending_rows(hub_service_instance, monkeypatch):
    from datetime import datetime, timedelta, timezone

    service = hub_service_instance
    other = hub_service_module.HubService()
    delivered = []
    monkeypatch.setattr(outbox_module.task_email_service, "is_enabled", lambda: True)
    monkeypatch.setattr(outbox_module.task_email_service, "max_attempts", lambda: 3)
    monkeypatch.setattr(
        outbox_module.task_email_service,
        "send_task_email",
        lambda **kwargs: delivered.append(kwargs["recipient_email"]) or True,
    )

    # Two dispatchers see the same pending row: the loser works from a stale SELECT snapshot.
    _insert_outbox_row(service, "race", status="pending", attempt_count=0, updated_at="2026-01-01T00:00:00+00:00")
    with service._lock, service._connect() as conn:
        snapshot = conn.execute(
            f"SELECT * FROM {service._TASK_EMAIL_OUTBOX_TABLE} WHERE id = 'race'"
        ).fetchall()
    assert other.dispatch_task_email_outbox()["sent"] == 1

    real_connect = service._connect

    class _StaleSelectConn:
        def __init__(self, conn):
            self._conn = conn

        def execute(self, sql, params=()):
            if "status = 'pending'" in sql and sql.lstrip().upper().startswith("SELECT"):
                return SimpleNamespace(fetchall=lambda: snapshot)
            return self._conn.execute(sql, params)

        def __getattr__(self, name):
            return getattr(self._conn, name)

        def __enter__(self):
            self._conn.__enter__()
            return self

        def __exit__(self, *exc):
            return self._conn.__exit__(*exc)

    monkeypatch.setattr(service, "_connect", lambda: _StaleSelectConn(real_connect()))
    assert service.dispatch_task_email_outbox()["sent"] == 0
    monkeypatch.setattr(service, "_connect", real_connect)
    assert delivered == ["race@test.local"]

    # Stale 'sending' claims are re-queued once; fresh ones and exhausted ones are not re-sent.
    delivered.clear()
    now = datetime.now(timezone.utc)
    old = (now - timedelta(hours=1)).isoformat()
    _insert_outbox_row(service, "stale", status="sending", attempt_count=1, updated_at=old)
    _insert_outbox_row(service, "poison", status="sending", attempt_count=3, updated_at=old)
    _insert_outbox_row(service, "fresh", status="sending", attempt_count=1, updated_at=now.isoformat())

    assert service.dispatch_task_email_outbox()["sent"] == 1
    assert service.dispatch_task_email_outbox()["sent"] == 0
    assert delivered == ["stale@test.local"]
    assert _outbox_status(service, "stale")["status"] == "sent"
    assert _outbox_status(service, "poison")["status"] == "failed"
    assert _outbox_status(service, "fresh")["status"] == "sending"


def test_stale_owner_cannot_touch_or_fail_a_reclaimed_row(hub_service_instance, monkeypatch):
    service = hub_service_instance
    monkeypatch.setattr(outbox_module.task_email_service, "max_attempts", lambda: 5)
    # Row was recovered and re-claimed: the new owner holds token 2, the old worker still holds 1.
    _insert_outbox_row(service, "reclaimed", status="sending", attempt_count=2, updated_at="2026-01-01T00:00:00+00:00")

    assert service._touch_task_email_claim("reclaimed", 1) is False
    service._mark_task_email_failed({"id": "reclaimed", "claim_token": 1}, "old worker failed")
    assert _outbox_status(service, "reclaimed")["status"] == "sending"

    assert service._touch_task_email_claim("reclaimed", 2) is True
    service._mark_task_email_failed({"id": "reclaimed", "claim_token": 2}, "new owner failed")
    assert _outbox_status(service, "reclaimed")["status"] == "pending"


def test_late_sent_ack_from_stale_owner_is_kept_to_prevent_a_resend(hub_service_instance):
    # Deliberate departure from a full token guard: the stale worker really sent the mail.
    service = hub_service_instance
    _insert_outbox_row(service, "late-ack", status="pending", attempt_count=1, updated_at="2026-01-01T00:00:00+00:00")
    service._mark_task_email_sent("late-ack")
    assert _outbox_status(service, "late-ack")["status"] == "sent"


def test_unknown_delivery_outcome_is_never_resent_automatically(hub_service_instance, monkeypatch):
    from datetime import datetime, timedelta, timezone

    service = hub_service_instance
    sends = []
    monkeypatch.setattr(outbox_module.task_email_service, "is_enabled", lambda: True)
    monkeypatch.setattr(outbox_module.task_email_service, "max_attempts", lambda: 5)

    def flaky_send(**kwargs):
        sends.append(kwargs["recipient_email"])
        raise outbox_module.EmailDeliveryOutcomeUnknownError("read timed out after DATA")

    monkeypatch.setattr(outbox_module.task_email_service, "send_task_email", flaky_send)

    # 1) the sender cannot tell whether the mail left: no retry, row is parked as 'unknown'.
    _insert_outbox_row(service, "timeout", status="pending", attempt_count=0, updated_at="2026-01-01T00:00:00+00:00")
    first = service.dispatch_task_email_outbox()
    assert first["unknown"] == 1 and first["failed"] == 0
    service.dispatch_task_email_outbox()
    assert sends == ["timeout@test.local"]
    assert _outbox_status(service, "timeout")["status"] == "unknown"

    # 2) a worker that died after the send started leaves 'send_started': parked, not requeued.
    #    A claim that never reached the send is still safely requeued.
    sends.clear()
    monkeypatch.setattr(
        outbox_module.task_email_service, "send_task_email", lambda **kw: sends.append(kw["recipient_email"]) or True
    )
    old = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    _insert_outbox_row(service, "died-sending", status="sending", attempt_count=1, updated_at=old)
    _insert_outbox_row(service, "never-started", status="sending", attempt_count=1, updated_at=old)
    with service._lock, service._connect() as conn:
        conn.execute(
            f"UPDATE {service._TASK_EMAIL_OUTBOX_TABLE} SET last_error = 'send_started' WHERE id = 'died-sending'"
        )
        conn.commit()

    service.dispatch_task_email_outbox()
    assert sends == ["never-started@test.local"]
    assert _outbox_status(service, "died-sending")["status"] == "unknown"
    assert _outbox_status(service, "never-started")["status"] == "sent"


def test_smtp_failure_after_data_phase_is_unknown_but_refusal_is_definite():
    import smtplib
    from email.message import EmailMessage

    from backend.services.task_email_service import EmailDeliveryOutcomeUnknownError, TaskEmailService

    msg = EmailMessage()

    class _Server:
        def __init__(self, error):
            self.error = error

        def send_message(self, _msg):
            raise self.error

    # Not covered by a boundary test: a real server cannot be made to time out mid-DATA here.
    with pytest.raises(EmailDeliveryOutcomeUnknownError):
        TaskEmailService._smtp_deliver(_Server(TimeoutError("timed out")), msg, "a@x", "b@x")
    with pytest.raises(smtplib.SMTPRecipientsRefused):
        TaskEmailService._smtp_deliver(_Server(smtplib.SMTPRecipientsRefused({"b@x": (550, b"no")})), msg, "a@x", "b@x")
