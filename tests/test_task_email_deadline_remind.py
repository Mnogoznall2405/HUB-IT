from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

hub_service_module = importlib.import_module("backend.services.hub_service")


def test_normalize_email_deadline_remind_hours_accepts_default_off_and_custom():
    assert hub_service_module._normalize_email_deadline_remind_hours(None) is None
    assert hub_service_module._normalize_email_deadline_remind_hours("") is None
    assert hub_service_module._normalize_email_deadline_remind_hours(0) == 0
    assert hub_service_module._normalize_email_deadline_remind_hours(48) == 48
    assert hub_service_module._normalize_email_deadline_remind_hours("12") == 12

    with pytest.raises(ValueError):
        hub_service_module._normalize_email_deadline_remind_hours(200)

    with pytest.raises(ValueError):
        hub_service_module._normalize_email_deadline_remind_hours("bad")


def test_resolve_email_deadline_remind_hours_uses_task_or_global_default(monkeypatch):
    monkeypatch.setattr(
        hub_service_module.task_email_service,
        "deadline_soon_hours",
        lambda: 24.0,
    )

    assert hub_service_module._resolve_email_deadline_remind_hours({}) == 24.0
    assert hub_service_module._resolve_email_deadline_remind_hours({"email_deadline_remind_hours": None}) == 24.0
    assert hub_service_module._resolve_email_deadline_remind_hours({"email_deadline_remind_hours": 0}) is None
    assert hub_service_module._resolve_email_deadline_remind_hours({"email_deadline_remind_hours": 48}) == 48.0
