"""Audit 01 (B3, B5, B9, B10): boundary checks for the hardened backend API paths."""
from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

WEB_ROOT = Path(__file__).resolve().parents[1] / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api.v1 import debug_client_log as debug_api  # noqa: E402
from backend.api.v1 import equipment as equipment_api  # noqa: E402
from backend.api.v1 import mailbox_quota as quota_api  # noqa: E402
from backend.utils import request_network  # noqa: E402


def _request(peer: str, forwarded: str | None) -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded is not None else []
    return Request({"type": "http", "headers": headers, "client": (peer, 5000), "method": "GET", "path": "/"})


def test_spoofed_left_forwarded_for_cannot_select_the_internal_zone():
    """B10: the proxy appends the real peer on the right; the client controls only the left."""
    spoofed = request_network.build_request_network_context(_request("127.0.0.1", "10.1.1.1, 203.0.113.5"))
    assert spoofed.client_ip == "203.0.113.5"
    assert spoofed.network_zone == "external"

    honest = request_network.build_request_network_context(_request("127.0.0.1", "10.1.1.1"))
    assert honest.client_ip == "10.1.1.1"
    assert honest.network_zone == "internal"

    chained = request_network.build_request_network_context(_request("127.0.0.1", "203.0.113.5, 127.0.0.1"))
    assert chained.client_ip == "203.0.113.5"

    untrusted_peer = request_network.build_request_network_context(_request("198.51.100.9", "10.1.1.1"))
    assert untrusted_peer.client_ip == "198.51.100.9"


class _BoomQuotaService:
    def import_snapshot(self, payload):
        raise RuntimeError(r"connection to C:\secret\path failed")


def _quota_client(monkeypatch) -> TestClient:
    app = FastAPI()
    app.include_router(quota_api.router, prefix="/mail")
    monkeypatch.setattr(quota_api, "mailbox_quota_service", _BoomQuotaService())
    return TestClient(app, raise_server_exceptions=False)


_BODY = {"exchange_server": "exch", "rows": [{"email": "a@example.test", "used_bytes": 1}]}


def test_rejected_import_key_leaves_no_key_fragment_in_the_log(monkeypatch, caplog):
    """B9: the log carries a one-way digest, never the first/last characters of the key."""
    monkeypatch.setenv("MAIL_QUOTA_IMPORT_API_KEY", "right-key-0000")
    client = _quota_client(monkeypatch)
    with caplog.at_level(logging.WARNING):
        response = client.post("/mail/mailbox-quota-snapshots", json=_BODY, headers={"X-API-Key": "ABCD-guessed-WXYZ"})
    assert response.status_code == 401
    assert "ABCD" not in caplog.text and "WXYZ" not in caplog.text


def test_import_failure_does_not_leak_internal_error_text(monkeypatch):
    """B9: an unexpected failure returns a generic 500, not the exception text."""
    monkeypatch.setenv("MAIL_QUOTA_IMPORT_API_KEY", "right-key-0000")
    client = _quota_client(monkeypatch)
    response = client.post("/mail/mailbox-quota-snapshots", json=_BODY, headers={"X-API-Key": "right-key-0000"})
    assert response.status_code == 500
    assert "secret" not in response.text


def _act_email_client(monkeypatch, *, owners: int, peak: dict) -> TestClient:
    app = FastAPI()
    app.include_router(equipment_api.router, prefix="/eq")
    route = next(r for r in app.routes if getattr(r, "path", "") == "/eq/acts/upload/email")
    for dep in route.dependant.dependencies:
        app.dependency_overrides[dep.call] = lambda: "db"
    monkeypatch.setattr(
        equipment_api.queries, "get_equipment_act_file",
        lambda doc_no, db_id=None: {"file_name": "a.pdf", "file_bytes": b"%PDF"},
    )
    monkeypatch.setattr(
        equipment_api.queries, "get_owner_by_no",
        lambda owner_no, db_id=None: {"OWNER_DISPLAY_NAME": f"Owner {owner_no}"},
    )
    monkeypatch.setattr(equipment_api.queries, "get_owner_email_by_no", lambda owner_no, db_id=None: f"o{owner_no}@example.test")
    state = {"now": 0}

    async def fake_send(**kwargs):
        state["now"] += 1
        peak["max"] = max(peak.get("max", 0), state["now"])
        await asyncio.sleep(0.02)
        state["now"] -= 1
        return True

    monkeypatch.setattr(equipment_api, "send_binary_file_email", fake_send)
    return TestClient(app, raise_server_exceptions=False)


def test_act_email_rejects_an_oversized_recipient_list(monkeypatch):
    """B3: 201 recipients is refused before any DB or SMTP work."""
    client = _act_email_client(monkeypatch, owners=201, peak={})
    response = client.post(
        "/eq/acts/upload/email",
        json={"doc_no": 1, "mode": "selected", "owner_nos": list(range(1, 202))},
    )
    assert response.status_code == 422


def test_act_email_sends_with_bounded_parallelism(monkeypatch):
    """B3: all recipients are served, but never more than the configured number of SMTP sends at once."""
    monkeypatch.setenv("TRANSFER_EMAIL_CONCURRENCY", "3")
    peak: dict = {}
    client = _act_email_client(monkeypatch, owners=30, peak=peak)
    response = client.post(
        "/eq/acts/upload/email",
        json={"doc_no": 1, "mode": "selected", "owner_nos": list(range(1, 31))},
    )
    assert response.status_code == 200, response.text
    assert response.json()["success_count"] == 30
    assert 1 < peak["max"] <= 3


def test_debug_relay_needs_an_explicit_session_and_checks_it(monkeypatch, tmp_path):
    """B5: no repository-wide default secret; the configured one is required."""
    app = FastAPI()
    app.include_router(debug_api.router, prefix="/dbg")
    client = TestClient(app)
    body = {"location": "x", "message": "m"}

    monkeypatch.setattr(debug_api, "_ENABLED", True)
    monkeypatch.setattr(debug_api, "_ALLOWED_SESSION", "s3cret")
    monkeypatch.setattr(debug_api, "_LOG_FILE", tmp_path / "debug.log")
    monkeypatch.setattr(debug_api, "_MIN_WRITE_INTERVAL_SEC", 0.0)

    assert client.post("/dbg/client-log", json=body, headers={"X-Debug-Session-Id": "20cb37"}).status_code == 403
    assert client.post("/dbg/client-log", json=body, headers={"X-Debug-Session-Id": "s3cret"}).status_code == 200
    assert (tmp_path / "debug.log").read_text(encoding="utf-8").count("\n") == 1

    huge = {"location": "x", "message": "m", "data": {"blob": "z" * 40000}}
    assert client.post("/dbg/client-log", json=huge, headers={"X-Debug-Session-Id": "s3cret"}).status_code == 413


def _metrics_request(peer: str, forwarded: str | None) -> Request:
    return _request(peer, forwarded)


def test_local_metrics_loopback_check_uses_the_real_client_behind_iis(monkeypatch):
    from backend.api.v1 import system as system_api

    monkeypatch.setattr(request_network.config.security, "trusted_proxy_cidrs", ["127.0.0.1/32", "::1/128"])

    # IIS on the same host: socket peer is always 127.0.0.1, the real caller is in X-Forwarded-For.
    assert system_api._is_loopback_client(_metrics_request("127.0.0.1", "203.0.113.9")) is False
    assert system_api._is_loopback_client(_metrics_request("127.0.0.1", "10.1.2.3")) is False
    assert system_api._is_loopback_client(_metrics_request("127.0.0.1", None)) is True
    assert system_api._is_loopback_client(_metrics_request("::1", "127.0.0.1")) is True
    assert system_api._is_loopback_client(_metrics_request("198.51.100.7", None)) is False


def test_agent_ingest_refuses_oversized_body_before_parsing_it(monkeypatch):
    from backend.api.v1 import fs_egress as egress_api

    stored: list = []
    monkeypatch.setenv("ITINV_AGENT_API_KEY", "k-test")
    monkeypatch.setenv("ITINV_AGENT_INGEST_MAX_BYTES", "1024")
    monkeypatch.setattr(egress_api.store, "ingest_events", lambda events: stored.append(events) or len(events))
    app = FastAPI()
    app.include_router(egress_api.router, prefix="/e")
    client = TestClient(app, raise_server_exceptions=False)
    headers = {"X-API-Key": "k-test"}

    big = client.post("/e/fs-egress", headers=headers, json={"events": [{"p": "x" * 4096}]})
    assert big.status_code == 413
    assert stored == []

    no_key = client.post("/e/fs-egress", json={"events": []})
    assert no_key.status_code == 401

    ok = client.post("/e/fs-egress", headers=headers, json={"events": [{"p": "x"}]})
    assert ok.status_code == 200 and ok.json()["inserted"] == 1

    bad = client.post("/e/fs-egress", headers=headers, content=b"{not json", )
    assert bad.status_code == 400


def test_quota_import_checks_the_key_before_reading_the_body_and_caps_its_size(monkeypatch):
    monkeypatch.setenv("MAIL_QUOTA_IMPORT_API_KEY", "q-key")
    monkeypatch.setenv("MAIL_QUOTA_IMPORT_API_KEYS", "")
    monkeypatch.setenv("MAIL_QUOTA_MAX_UPLOAD_MB", "1")
    imported: list = []
    monkeypatch.setattr(
        quota_api.mailbox_quota_service, "import_snapshot", lambda payload: imported.append(payload) or {}
    )
    app = FastAPI()
    app.include_router(quota_api.router, prefix="/q")
    client = TestClient(app, raise_server_exceptions=False)
    huge = {"rows": [{"x": "y" * 64}] * 20000, "junk": "z" * (2 * 1024 * 1024)}

    # Unauthenticated: refused as 401 without the body ever being validated (old code answered 422/413).
    assert client.post("/q/mailbox-quota-snapshots", json=huge).status_code == 401
    # Authenticated but over the byte cap: 413 before parsing.
    assert client.post("/q/mailbox-quota-snapshots", headers={"X-API-Key": "q-key"}, json=huge).status_code == 413
    # Authenticated, small but malformed: still a 422 validation error.
    bad = client.post("/q/mailbox-quota-snapshots", headers={"X-API-Key": "q-key"}, json={"rows": "nope"})
    assert bad.status_code == 422
    assert imported == []


def test_identify_workspace_looks_up_the_real_client_ip_not_the_forwarded_claim(monkeypatch):
    from backend.api.v1 import discovery as discovery_api

    queried: list = []

    class _Db:
        def execute_query(self, query, params=()):
            queried.append(params)
            return []

    monkeypatch.setattr(request_network.config.security, "trusted_proxy_cidrs", ["127.0.0.1/32", "::1/128"])
    monkeypatch.setattr(discovery_api, "get_db", lambda db_id: _Db())
    app = FastAPI()
    app.include_router(discovery_api.router, prefix="/d")
    route = next(r for r in app.routes if getattr(r, "path", "") == "/d/identify-workspace")
    for dep in route.dependant.dependencies:
        app.dependency_overrides[dep.call] = lambda: "db1" if dep.call is discovery_api.get_current_database_id else SimpleNamespace(id=1)
    client = TestClient(app, client=("127.0.0.1", 5000))

    # IIS appends the real peer on the right; the left part is attacker-controlled.
    response = client.get("/d/identify-workspace", headers={"X-Forwarded-For": "10.105.0.42, 203.0.113.9"})
    assert response.status_code == 200
    assert response.json()["client_ip"] == "203.0.113.9"
    assert queried == [("203.0.113.9",)]


def test_employee_photo_requires_a_signed_in_user(monkeypatch, tmp_path):
    from backend.api.v1 import address_book as book_api
    from backend.api import deps
    from backend.services import employee_photo_service

    photo = tmp_path / "E1.jpg"
    photo.write_bytes(b"\xff\xd8\xff")
    monkeypatch.setattr(employee_photo_service, "employee_photo_file", lambda code: photo)
    app = FastAPI()
    app.include_router(book_api.router, prefix="/ab")
    client = TestClient(app, raise_server_exceptions=False)

    # No cookie / bearer: refused (old code answered 200 to anyone).
    assert client.get("/ab/photos/E1").status_code == 401

    app.dependency_overrides[deps.get_current_active_user] = lambda: SimpleNamespace(id=1)
    allowed = client.get("/ab/photos/E1")
    assert allowed.status_code == 200
    assert allowed.headers["cache-control"].startswith("private")
