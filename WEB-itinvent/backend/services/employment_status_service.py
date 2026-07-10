# -*- coding: utf-8 -*-
"""Employment status from address book cache.

Convention:
- present in address book cache -> active (работает)
- absent from cache -> dismissed (уволен)
- empty/unavailable cache -> unknown
"""
from __future__ import annotations

from typing import Any, Iterable

from backend.services.address_book_service import (
    address_book_service,
    normalize_search_text,
)
from backend.services.warehouse_1c_service import fio_person_match_score


STATUS_ACTIVE = "active"
STATUS_DISMISSED = "dismissed"
STATUS_UNKNOWN = "unknown"

_MIN_FIO_SCORE = 50


def _build_name_index(items: list[dict[str, Any]]) -> dict[str, str]:
    index: dict[str, str] = {}
    for item in items or []:
        full_name = str(item.get("full_name") or "").strip()
        key = normalize_search_text(full_name)
        if key and key not in index:
            index[key] = full_name
    return index


def resolve_employment_status(
    full_name: str,
    *,
    cache: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Resolve employment status for one display name."""
    name = str(full_name or "").strip()
    if not name:
        return {
            "status": STATUS_UNKNOWN,
            "matched_name": None,
            "label": "",
        }

    payload = cache if isinstance(cache, dict) else address_book_service.load_cache()
    items = list(payload.get("items") or [])
    if not items:
        return {
            "status": STATUS_UNKNOWN,
            "matched_name": None,
            "label": "",
        }

    name_index = _build_name_index(items)
    exact_key = normalize_search_text(name)
    if exact_key in name_index:
        matched = name_index[exact_key]
        return {
            "status": STATUS_ACTIVE,
            "matched_name": matched,
            "label": "Сотрудник работает",
        }

    # Fuzzy: warehouse-style FIO ("Иванов И.И.") vs address-book full name.
    best_score = 0
    best_name: str | None = None
    for book_name in name_index.values():
        score = fio_person_match_score(book_name, name)
        if score > best_score:
            best_score = score
            best_name = book_name
    if best_score >= _MIN_FIO_SCORE and best_name:
        return {
            "status": STATUS_ACTIVE,
            "matched_name": best_name,
            "label": "Сотрудник работает",
        }

    return {
        "status": STATUS_DISMISSED,
        "matched_name": None,
        "label": "Сотрудник уволен",
    }


def resolve_employment_status_batch(
    names: Iterable[str],
    *,
    cache: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    """Resolve employment status for many names; keys are original name strings."""
    payload = cache if isinstance(cache, dict) else address_book_service.load_cache()
    result: dict[str, dict[str, Any]] = {}
    for raw in names or []:
        name = str(raw or "").strip()
        if not name or name in result:
            continue
        result[name] = resolve_employment_status(name, cache=payload)
    return result


employment_status_service = type(
    "EmploymentStatusService",
    (),
    {
        "resolve": staticmethod(resolve_employment_status),
        "resolve_batch": staticmethod(resolve_employment_status_batch),
    },
)()
