from __future__ import annotations

import asyncio
import json
import time

import pytest

from backend.services.mail_observability import (
    mail_metrics_export_enabled,
    mail_observability_snapshot,
    mail_op_name,
    record_mail_attachment_bytes,
    record_mail_call,
    record_mail_create_account_ms,
    record_mail_protocol_cache,
    record_mail_send_state,
    record_mail_source,
    record_mail_cancelled_wait,
    reset_mail_observability,
    send_state_from_error_code,
)


@pytest.fixture(autouse=True)
def _reset_mail_sli():
    reset_mail_observability()
    yield
    reset_mail_observability()


def test_mail_metrics_export_defaults_and_rollback(monkeypatch):
    monkeypatch.delenv("MAIL_METRICS_EXPORT", raising=False)
    assert mail_metrics_export_enabled() is True
    assert mail_metrics_export_enabled("") is True
    assert mail_metrics_export_enabled("1") is True
    assert mail_metrics_export_enabled("0") is False
    assert mail_metrics_export_enabled("nope") is False


def test_mail_op_name_is_bounded():
    class _Fn:
        def __init__(self, name):
            self.__name__ = name

    assert mail_op_name(_Fn("get_bootstrap")) == "bootstrap"
    assert mail_op_name(_Fn("_list_messages_payload")) == "list"
    assert mail_op_name(_Fn("send_message")) == "send"
    assert mail_op_name(_Fn("download_attachment")) == "download"
    assert mail_op_name(_Fn("unexpected_helper")) == "other"


def test_record_mail_call_exports_wait_cache_and_call(monkeypatch):
    monkeypatch.setenv("MAIL_METRICS_EXPORT", "1")
    record_mail_call(
        op="list",
        semaphore_wait_ms=12.0,
        executor_wait_ms=4.0,
        call_ms=80.0,
        metrics={"cache_hit": 1, "singleflight_hit": 1, "account_reused": 1},
    )
    record_mail_call(
        op="list",
        semaphore_wait_ms=20.0,
        executor_wait_ms=6.0,
        call_ms=120.0,
        metrics={"cache_hit": 0, "account_reused": 0},
        error=True,
    )
    snapshot = mail_observability_snapshot()
    assert snapshot["enabled"] is True
    row = snapshot["ops"]["list"]
    assert row["count"] == 2
    assert row["error_count"] == 1
    assert row["cache_hits"] == 1
    assert row["cache_misses"] == 1
    assert row["cache_hit_rate"] == 0.5
    assert row["singleflight_hits"] == 1
    assert row["account_reused"] == 1
    assert row["account_created"] == 1
    assert row["semaphore_wait"]["max_ms"] == 20.0
    assert row["call"]["max_ms"] == 120.0
    dumped = json.dumps(snapshot)
    assert "mailbox_id" not in dumped
    assert "user_id" not in dumped
    assert "@" not in dumped


def test_record_source_send_state_and_attachment(monkeypatch):
    monkeypatch.setenv("MAIL_METRICS_EXPORT", "1")
    record_mail_source("app_snapshot")
    record_mail_source("exchange")
    record_mail_send_state("sent")
    record_mail_send_state("timeout")
    record_mail_attachment_bytes(1024)
    record_mail_attachment_bytes(4096)
    record_mail_create_account_ms(35.5)
    record_mail_cancelled_wait()
    snapshot = mail_observability_snapshot()
    assert snapshot["source"]["snapshot"] == 1
    assert snapshot["source"]["exchange"] == 1
    assert snapshot["send_state"]["sent"] == 1
    assert snapshot["send_state"]["timeout"] == 1
    assert snapshot["attachment_bytes"]["count"] == 2
    assert snapshot["attachment_bytes"]["max"] == 4096
    assert snapshot["create_account"]["count"] == 1
    assert snapshot["create_account"]["p50_ms"] == 35.5
    assert snapshot["cancelled_wait"] == 1


def test_record_protocol_cache_has_no_identity_labels(monkeypatch):
    monkeypatch.setenv("MAIL_METRICS_EXPORT", "1")
    record_mail_protocol_cache(hit=False, size=0)
    record_mail_protocol_cache(hit=True, size=2)
    record_mail_protocol_cache(hit=False, errored=True, size=2)
    snapshot = mail_observability_snapshot()
    row = snapshot["protocol_cache"]
    assert row["hits"] == 1
    assert row["misses"] == 2
    assert row["errors"] == 1
    assert row["last_size"] == 2
    assert row["hit_rate"] == pytest.approx(1 / 3, rel=0, abs=0.0001)
    dumped = json.dumps(snapshot)
    assert "mailbox_id" not in dumped
    assert "user_id" not in dumped
    assert "@" not in dumped
    assert "service_endpoint" not in dumped
    assert "credentials" not in dumped


def test_mail_metrics_export_off_records_nothing(monkeypatch):
    monkeypatch.setenv("MAIL_METRICS_EXPORT", "0")
    record_mail_call(op="list", semaphore_wait_ms=10, executor_wait_ms=1, call_ms=50, metrics={"cache_hit": 1})
    record_mail_source("exchange")
    record_mail_send_state("sent")
    record_mail_protocol_cache(hit=True, size=3)
    snapshot = mail_observability_snapshot()
    assert snapshot == {"enabled": False}


def test_send_state_from_error_code():
    assert send_state_from_error_code("MAIL_SEND_TIMEOUT") == "timeout"
    assert send_state_from_error_code("MAIL_SEND_UNKNOWN") == "unknown"
    assert send_state_from_error_code("MAIL_SEND_IN_FLIGHT") == "in_flight"
    assert send_state_from_error_code("MAIL_IDEMPOTENCY_CONFLICT") == "conflict"
    assert send_state_from_error_code("MAIL_ERROR") == "failed"


@pytest.mark.asyncio
async def test_run_mail_call_records_semaphore_and_call_stages(monkeypatch):
    from backend.api.v1 import mail as mail_api

    monkeypatch.setenv("MAIL_METRICS_EXPORT", "1")
    mail_api._MAIL_CALL_LIMITER = None
    mail_api._MAIL_CALL_LIMITER_LIMIT = 0
    mail_api._MAIL_CALL_LIMITER_LOOP = None

    def _work():
        time.sleep(0.02)
        return "ok"

    _work.__name__ = "get_message"
    result = await mail_api._run_mail_call(_work)
    assert result == "ok"
    snapshot = mail_observability_snapshot()
    row = snapshot["ops"]["detail"]
    assert row["count"] == 1
    assert row["call"]["p50_ms"] >= 15
    assert "mailbox_id" not in json.dumps(snapshot)
    mail_api._MAIL_CALL_LIMITER = None
    mail_api._MAIL_CALL_LIMITER_LIMIT = 0
    mail_api._MAIL_CALL_LIMITER_LOOP = None


@pytest.mark.asyncio
async def test_run_mail_call_records_cancelled_wait_on_client_abort(monkeypatch):
    from backend.api.v1 import mail as mail_api

    monkeypatch.setenv("MAIL_METRICS_EXPORT", "1")
    mail_api._MAIL_CALL_LIMITER = None
    mail_api._MAIL_CALL_LIMITER_LIMIT = 0
    mail_api._MAIL_CALL_LIMITER_LOOP = None

    def _work():
        time.sleep(0.3)
        return "ok"

    _work.__name__ = "get_message"

    async def _run():
        return await mail_api._run_mail_call(_work)

    task = asyncio.create_task(_run())
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert mail_observability_snapshot()["cancelled_wait"] == 1
    mail_api._MAIL_CALL_LIMITER = None
    mail_api._MAIL_CALL_LIMITER_LIMIT = 0
    mail_api._MAIL_CALL_LIMITER_LOOP = None


def test_request_metrics_snapshot_includes_mail_sli(monkeypatch):
    from backend.services.request_metrics_service import request_metrics_service

    monkeypatch.setenv("MAIL_METRICS_EXPORT", "1")
    monkeypatch.setenv("REQUEST_METRICS_ENABLED", "1")
    record_mail_call(op="bootstrap", semaphore_wait_ms=1, executor_wait_ms=1, call_ms=10)
    snapshot = request_metrics_service.snapshot(limit=10)
    assert snapshot["mail"]["enabled"] is True
    assert snapshot["mail"]["ops"]["bootstrap"]["count"] == 1
    request_metrics_service.reset()
    after = request_metrics_service.snapshot(limit=10)
    assert after["mail"]["ops"] == {}
