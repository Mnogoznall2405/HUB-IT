"""Structured message kinds: location/contact body normalization (F-GEO/F-CONTACT)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.chat.service import (  # noqa: E402
    ChatService,
    _normalize_contact_body,
    _normalize_location_body,
)


def test_location_body_normalizes_coordinates():
    body = _normalize_location_body(json.dumps({
        "latitude": 55.751244, "longitude": 37.618423, "title": "Офис", "junk": "drop-me",
    }))
    data = json.loads(body)
    assert data == {"latitude": 55.751244, "longitude": 37.618423, "title": "Офис"}


@pytest.mark.parametrize("body", [
    "not-json",
    "{}",
    json.dumps({"latitude": "abc", "longitude": 10}),
    json.dumps({"latitude": 120, "longitude": 10}),
    json.dumps({"latitude": 10, "longitude": 999}),
    json.dumps([1, 2]),
])
def test_location_body_rejects_invalid(body):
    with pytest.raises(ValueError):
        _normalize_location_body(body)


def test_contact_body_requires_name_and_keeps_phone():
    body = _normalize_contact_body(json.dumps({
        "name": "  Иван Петров ", "phone": "+7 900 123-45-67", "junk": 1,
    }))
    data = json.loads(body)
    assert data == {"name": "Иван Петров", "phone": "+7 900 123-45-67"}


@pytest.mark.parametrize("body", [
    "not-json",
    "{}",
    json.dumps({"name": "   "}),
    json.dumps(["x"]),
])
def test_contact_body_rejects_invalid(body):
    with pytest.raises(ValueError):
        _normalize_contact_body(body)


def test_message_kind_normalizer_accepts_structured_kinds():
    assert ChatService._normalize_message_kind("location") == "location"
    assert ChatService._normalize_message_kind("contact") == "contact"
    assert ChatService._normalize_message_kind("task_share") == "task_share"
    assert ChatService._normalize_message_kind("evil-kind") == "text"
    assert ChatService._normalize_message_kind(None) == "text"
