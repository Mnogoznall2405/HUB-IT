"""AG: provider balance warning (threshold, managers notified, 402 text) on sqlite only."""
from __future__ import annotations

import importlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("ENVIRONMENT", "development")
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


@pytest.fixture
def env(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'balance.db').as_posix()}"
    monkeypatch.setenv("APP_DATABASE_URL", url)
    monkeypatch.delenv("AI_BALANCE_WARN_THRESHOLD", raising=False)
    cfg = importlib.import_module("backend.config")
    appdb = importlib.import_module("backend.appdb.db")
    monkeypatch.setattr(cfg.config.app_db, "database_url", url, raising=False)
    monkeypatch.setattr(appdb.config.app_db, "database_url", url, raising=False)
    appdb._engines.clear()
    appdb._session_factories.clear()
    appdb._initialized_schema_urls.clear()
    appdb.initialize_app_schema(url)
    models = importlib.import_module("backend.appdb.models")
    now = datetime.now(timezone.utc)

    def add_user(user_id, username, role, *, active=True, perms=None):
        with appdb.app_session(url) as db:
            db.add(models.AppUser(
                id=user_id, username=username, full_name=username, is_active=active, role=role,
                use_custom_permissions=perms is not None,
                custom_permissions_json=json.dumps(perms or []), created_at=now, updated_at=now,
            ))

    add_user(1, "admin", "admin")
    add_user(2, "ai-manager", "viewer", perms=["chat.read", "settings.ai.manage"])
    add_user(3, "plain", "viewer", perms=["chat.read"])
    add_user(4, "off-admin", "admin", active=False)

    balance = importlib.import_module("backend.ai_chat.balance")
    sent: list[dict] = []
    hub_module = importlib.import_module("backend.services.hub_service")
    monkeypatch.setattr(
        hub_module.hub_service, "create_notifications_batch", lambda items, **kw: sent.extend(items) or len(items)
    )
    return type("Env", (), {"balance": balance, "sent": sent, "appdb": appdb, "url": url, "models": models})


def _service(env, provider):
    return env.balance.AiBalanceService(credits_provider=provider)


def test_parse_balance_understands_provider_shapes():
    parse = importlib.import_module("backend.ai_chat.balance").parse_balance
    assert parse({"data": {"total_credits": 10, "total_usage": 3.5}}) == 6.5
    assert parse({"balance": "7.25"}) == 7.25
    assert parse({"data": {"credits": 12}}) == 12.0
    assert parse({"data": {}}) is None
    assert parse({"balance": True}) is None
    assert parse("nope") is None


def test_low_balance_notifies_only_ai_managers_and_only_once_per_day(env):
    service = _service(env, lambda: {"data": {"total_credits": 100, "total_usage": 95}})
    assert service.set_threshold(10)["threshold"] == 10

    state = service.check()
    assert state["balance"] == 5.0 and state["low"] is True and state["status"] == "low"
    assert sorted(item["recipient_user_id"] for item in env.sent) == [1, 2]  # admin + settings.ai.manage, not plain/inactive
    assert env.sent[0]["entity_type"] == "ai_settings" and env.sent[0]["event_type"] == "ai.balance"

    service.check()  # still low, cooldown not over -> no second alert
    assert len(env.sent) == 2

    # a day later the warning is repeated
    stored = service._load()
    stored["alerted_at"] = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
    service._save(stored)
    service.check()
    assert len(env.sent) == 4


def test_recovered_balance_resets_the_alert_and_zero_threshold_never_warns(env):
    balances = iter([5, 50, 5])
    service = _service(env, lambda: {"balance": next(balances)})
    service.set_threshold(10)
    service.check()
    assert len(env.sent) == 2
    assert service.check()["low"] is False and service.get_state()["alerted_at"] is None
    service.check()  # low again after recovery -> a fresh warning
    assert len(env.sent) == 4

    off = _service(env, lambda: {"balance": 0.01})
    off.set_threshold(0)
    assert off.check()["low"] is False
    assert len(env.sent) == 4


def test_provider_failure_keeps_last_balance_and_reports_error(env):
    state = {"ok": True}

    def provider():
        if state["ok"]:
            return {"balance": 42}
        raise RuntimeError("Failed to call RouterAI: 401")

    service = _service(env, provider)
    assert service.check()["balance"] == 42.0
    state["ok"] = False
    result = service.check()
    assert result["status"] == "error" and result["balance"] == 42.0 and "401" in result["error"]
    assert env.sent == []


def test_unparseable_answer_is_unknown_not_low(env):
    service = _service(env, lambda: {"data": {"something": "else"}})
    service.set_threshold(10)
    result = service.check()
    assert result["status"] == "unknown" and result["low"] is False
    assert env.sent == []


def test_threshold_validation_and_default_from_environment(env, monkeypatch):
    service = _service(env, lambda: {"balance": 1})
    with pytest.raises(ValueError):
        service.set_threshold(-1)
    with pytest.raises(ValueError):
        service.set_threshold("abc")
    monkeypatch.setenv("AI_BALANCE_WARN_THRESHOLD", "25")
    assert service.get_state()["threshold"] == 25.0
    assert service.set_threshold(3)["threshold"] == 3.0  # an explicit value beats the environment


def test_insufficient_funds_run_error_notifies_managers_once_per_hour(env):
    service = _service(env, lambda: {})
    assert service.report_insufficient_funds() is True
    assert sorted(item["recipient_user_id"] for item in env.sent) == [1, 2]
    assert service.report_insufficient_funds() is False  # throttled
    stored = service._load()
    stored["insufficient_notified_at"] = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    service._save(stored)
    assert service.report_insufficient_funds() is True


def test_user_text_for_402_and_detection():
    service_module = importlib.import_module("backend.ai_chat.service")
    friendly = service_module._friendly_run_error_text
    assert "администраторы уведомлены" in friendly(Exception("HTTP 402 Payment Required"))
    assert service_module._is_insufficient_funds_error(Exception("insufficient credits"))
    assert not service_module._is_insufficient_funds_error(Exception("HTTP 4025 weird"))
    assert not service_module._is_insufficient_funds_error(Exception("timeout"))
