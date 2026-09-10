from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api.v1.equipment import (
    _is_unknown_employee_name,
    _is_plausible_name_match,
    _resolve_owner_no_by_name,
)


def test_is_unknown_employee_name_detects_placeholders():
    assert _is_unknown_employee_name("Без") is True
    assert _is_unknown_employee_name("Без В.") is True
    assert _is_unknown_employee_name("Б/н") is True
    assert _is_unknown_employee_name("N/A") is True
    assert _is_unknown_employee_name("-") is True
    assert _is_unknown_employee_name("") is True
    assert _is_unknown_employee_name("  ") is True
    assert _is_unknown_employee_name("Безлепкин Сергей Валериевич") is False
    assert _is_unknown_employee_name("Зубков А.А.") is False
    assert _is_unknown_employee_name("Зубков Андрей Алексеевич") is False


def test_is_plausible_name_match_rejects_short_fragments():
    assert _is_plausible_name_match("Без", "Безлепкин Сергей Валериевич") is False
    assert _is_plausible_name_match("Без", "Безруков Иван") is False
    assert _is_plausible_name_match("Без", "Без") is True
    assert _is_plausible_name_match("Безлепкин", "Безлепкин Сергей Валериевич") is True


def test_is_plausible_name_match_accepts_initials():
    assert _is_plausible_name_match("Зубков А.А.", "Зубков Андрей Алексеевич") is True
    assert _is_plausible_name_match("Безлепкин С.В.", "Безлепкин Сергей Валериевич") is True
    assert _is_plausible_name_match("Зубков", "Зубков Андрей Алексеевич") is True


def test_resolve_owner_no_by_name_rejects_placeholders(monkeypatch):
    calls = []

    def fake_get_owner_no_by_name(name, strict=True, db_id=None):
        calls.append(("no", name, strict))
        return None

    def fake_get_owner_by_no(owner_no, db_id=None):
        calls.append(("by_no", owner_no))
        return None

    monkeypatch.setattr(
        "backend.database.queries.get_owner_no_by_name",
        fake_get_owner_no_by_name,
    )
    monkeypatch.setattr(
        "backend.database.queries.get_owner_by_no",
        fake_get_owner_by_no,
    )

    assert _resolve_owner_no_by_name("Без", db_id=None) is None
    assert _resolve_owner_no_by_name("Без В.", db_id=None) is None
    assert _resolve_owner_no_by_name("-", db_id=None) is None
    assert calls == []


def test_resolve_owner_no_by_name_validates_non_strict_match(monkeypatch):
    def fake_get_owner_no_by_name(name, strict=True, db_id=None):
        if strict:
            return None
        # Non-strict returns Bezlepkin for fragment "Без".
        return 2413

    def fake_get_owner_by_no(owner_no, db_id=None):
        return {"OWNER_DISPLAY_NAME": "Безлепкин Сергей Валериевич"}

    monkeypatch.setattr(
        "backend.database.queries.get_owner_no_by_name",
        fake_get_owner_no_by_name,
    )
    monkeypatch.setattr(
        "backend.database.queries.get_owner_by_no",
        fake_get_owner_by_no,
    )

    assert _resolve_owner_no_by_name("Без", db_id=None) is None
    assert _resolve_owner_no_by_name("Безлепкин", db_id=None) == 2413


def test_resolve_owner_no_by_name_accepts_initials_match(monkeypatch):
    def fake_get_owner_no_by_name(name, strict=True, db_id=None):
        if strict and name == "Зубков А.А.":
            return None
        if not strict and name == "Зубков А.А.":
            return 2747
        return None

    def fake_get_owner_by_no(owner_no, db_id=None):
        return {"OWNER_DISPLAY_NAME": "Зубков Андрей Алексеевич"}

    monkeypatch.setattr(
        "backend.database.queries.get_owner_no_by_name",
        fake_get_owner_no_by_name,
    )
    monkeypatch.setattr(
        "backend.database.queries.get_owner_by_no",
        fake_get_owner_by_no,
    )

    assert _resolve_owner_no_by_name("Зубков А.А.", db_id=None) == 2747
