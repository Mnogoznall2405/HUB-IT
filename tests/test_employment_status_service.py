from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.employment_status_service import (  # noqa: E402
    STATUS_ACTIVE,
    STATUS_DISMISSED,
    STATUS_UNKNOWN,
    resolve_employment_status,
    resolve_employment_status_batch,
)


def test_resolve_employment_status_unknown_when_cache_empty():
    result = resolve_employment_status("Иванов Иван", cache={"items": []})
    assert result["status"] == STATUS_UNKNOWN


def test_resolve_employment_status_active_on_exact_name():
    cache = {"items": [{"full_name": "Иванов Иван Иванович"}]}
    result = resolve_employment_status("Иванов Иван Иванович", cache=cache)
    assert result["status"] == STATUS_ACTIVE
    assert result["label"] == "Сотрудник работает"


def test_resolve_employment_status_active_on_initials_match():
    cache = {"items": [{"full_name": "Рябов Александр Сергеевич"}]}
    result = resolve_employment_status("Рябов А.С.", cache=cache)
    assert result["status"] == STATUS_ACTIVE
    assert result["matched_name"] == "Рябов Александр Сергеевич"


def test_resolve_employment_status_dismissed_when_missing():
    cache = {"items": [{"full_name": "Петров Петр Петрович"}]}
    result = resolve_employment_status("Сидоров Сидор", cache=cache)
    assert result["status"] == STATUS_DISMISSED
    assert result["label"] == "Сотрудник уволен"


def test_resolve_employment_status_batch():
    cache = {
        "items": [
            {"full_name": "Иванов Иван Иванович"},
            {"full_name": "Рябов Александр Сергеевич"},
        ]
    }
    result = resolve_employment_status_batch(
        ["Иванов Иван Иванович", "Неизвестный", "Рябов А.С."],
        cache=cache,
    )
    assert result["Иванов Иван Иванович"]["status"] == STATUS_ACTIVE
    assert result["Неизвестный"]["status"] == STATUS_DISMISSED
    assert result["Рябов А.С."]["status"] == STATUS_ACTIVE
