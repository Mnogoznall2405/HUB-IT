"""Manager runs observability: an explicit allowlist decides what crosses the boundary.

A manager (settings.ai.manage) must never receive other users content through the
runs endpoint — including secrets embedded in error/status text or tool traces.
Boundary: the service function that feeds the admin endpoint, real sqlite schema.
"""
from __future__ import annotations
import conftest  # noqa: F401  (sys.path bootstrap)

import importlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("ENVIRONMENT", "development")
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

SECRET_BODY = "SECRET-MAIL-BODY-7f3a"
SECRET_ERROR = "SECRET-RECIPIENT-ivanov@corp.example"
SECRET_STATUS = "SECRET-STATUS-FRAGMENT-9c1"


@pytest.fixture
def env(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'obs.db').as_posix()}"
    monkeypatch.setenv("APP_DATABASE_URL", url)
    cfg = importlib.import_module("backend.config")
    appdb = importlib.import_module("backend.appdb.db")
    monkeypatch.setattr(cfg.config.app_db, "database_url", url, raising=False)
    monkeypatch.setattr(appdb.config.app_db, "database_url", url, raising=False)
    appdb._engines.clear()
    appdb._session_factories.clear()
    appdb._initialized_schema_urls.clear()
    conftest.copy_app_schema_for_url(url)
    models = importlib.import_module("backend.appdb.models")
    now = datetime.now(timezone.utc)
    with appdb.app_session(url) as db:
        db.add(models.AppAiBot(
            id="agent", slug="agent", title="Assistant", is_enabled=True, surface="general",
            bot_user_id=100, created_at=now, updated_at=now,
        ))
        db.add(models.AppAiBotRun(
            id="run-secret", bot_id="agent", conversation_id="conv-1", user_id=2,
            trigger_message_id="msg-1", status="failed", stage="tools",
            status_text=f"Черновик письма: {SECRET_STATUS}",
            error_text=f"validation failed for recipient {SECRET_ERROR}",
            request_json=json.dumps({"prompt": f"перешли {SECRET_BODY}"}),
            result_json=json.dumps({"tool_traces": [
                {"status": "ok", "tool_id": "office.mail.get_message", "result": {"body": SECRET_BODY}},
                {"status": "error", "tool_id": "office.action.mail_send_draft", "error": SECRET_ERROR},
            ]}),
            usage_json=json.dumps({"input_tokens": 123, "output_tokens": 45, "model": "test-model"}),
            created_at=now, updated_at=now,
        ))
        db.commit()
    return url


def test_manager_runs_redact_all_content_fields(env):
    from backend.ai_chat.service import ai_chat_service

    items = ai_chat_service.list_recent_runs(bot_id="agent")
    assert len(items) == 1
    blob = json.dumps(items, ensure_ascii=False)
    assert SECRET_BODY not in blob
    assert SECRET_ERROR not in blob
    assert SECRET_STATUS not in blob
    # explicit allowlist: no free-text or payload keys at all
    forbidden_keys = {"request", "result", "error_text", "status_text", "tool_traces"}
    for key in forbidden_keys:
        assert key not in items[0], key
    # safe observability survives
    assert items[0]["status"] == "failed"
    assert items[0]["tool_traces_count"] == 2
    assert items[0]["tool_trace_errors_count"] == 1
    assert items[0]["usage"] == {"input_tokens": 123, "output_tokens": 45}
