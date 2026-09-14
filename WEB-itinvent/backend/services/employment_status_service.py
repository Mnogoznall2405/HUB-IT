# -*- coding: utf-8 -*-
"""Employment status from address book cache.

Convention:
- present in address book cache -> active (работает)
- absent from cache -> dismissed (уволен)
- empty/unavailable cache -> unknown
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Iterable

from backend.services.address_book_service import (
    address_book_service,
    normalize_search_text,
)
from backend.services.warehouse_1c_service import fio_person_match_score, person_name_tokens


STATUS_ACTIVE = "active"
STATUS_DISMISSED = "dismissed"
STATUS_UNKNOWN = "unknown"

_MIN_FIO_SCORE = 50
DEFAULT_ADDRESS_BOOK_MAX_AGE_SECONDS = 86_400


def _cache_max_age_seconds() -> int:
    try:
        return max(300, int(os.getenv("ADDRESS_BOOK_EMPLOYMENT_MAX_AGE_SECONDS", DEFAULT_ADDRESS_BOOK_MAX_AGE_SECONDS)))
    except (TypeError, ValueError):
        return DEFAULT_ADDRESS_BOOK_MAX_AGE_SECONDS


def is_employment_cache_fresh(payload: dict[str, Any]) -> bool:
    """Only a successful, recent HR snapshot can prove a dismissal.

    An incomplete or failed address-book sync must never turn a working
    employee into a dismissed one in warehouse reconciliation.
    """
    if not isinstance(payload, dict) or str(payload.get("last_error") or "").strip():
        return False
    raw_updated_at = str(payload.get("updated_at") or "").strip()
    if not raw_updated_at:
        return False
    try:
        parsed = datetime.fromisoformat(raw_updated_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    if parsed.tzinfo is None:
        return False
    age_seconds = (datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).total_seconds()
    return 0 <= age_seconds <= _cache_max_age_seconds()


def _build_name_index(items: list[dict[str, Any]]) -> dict[str, str]:
    index: dict[str, str] = {}
    for item in items or []:
        full_name = str(item.get("full_name") or "").strip()
        key = normalize_search_text(full_name)
        if key and key not in index:
            index[key] = full_name
    return index


def _build_surname_index(names: Iterable[str]) -> dict[str, list[str]]:
    index: dict[str, list[str]] = {}
    for name in names:
        tokens = person_name_tokens(name)
        if tokens:
            index.setdefault(tokens[0], []).append(name)
    return index


def _resolve_from_indexes(
    name: str,
    *,
    name_index: dict[str, str],
    surname_index: dict[str, list[str]],
) -> dict[str, Any]:
    exact_key = normalize_search_text(name)
    if exact_key in name_index:
        matched = name_index[exact_key]
        return {
            "status": STATUS_ACTIVE,
            "matched_name": matched,
            "label": "Сотрудник работает",
        }

    # Fuzzy: warehouse-style FIO ("Иванов И.И.") vs address-book full name.
    tokens = person_name_tokens(name)
    candidates = surname_index.get(tokens[0], []) if tokens else []
    best_score = 0
    best_name: str | None = None
    for book_name in candidates:
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
    if not items or not is_employment_cache_fresh(payload):
        return {
            "status": STATUS_UNKNOWN,
            "matched_name": None,
            "label": "",
        }

    name_index = _build_name_index(items)
    return _resolve_from_indexes(
        name,
        name_index=name_index,
        surname_index=_build_surname_index(name_index.values()),
    )


def resolve_employment_status_batch(
    names: Iterable[str],
    *,
    cache: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    """Resolve employment status for many names; keys are original name strings."""
    payload = cache if isinstance(cache, dict) else address_book_service.load_cache()
    unique_names = list(dict.fromkeys(
        str(raw or "").strip()
        for raw in names or []
        if str(raw or "").strip()
    ))
    items = list(payload.get("items") or [])
    if not items or not is_employment_cache_fresh(payload):
        return {
            name: {
                "status": STATUS_UNKNOWN,
                "matched_name": None,
                "label": "",
            }
            for name in unique_names
        }

    name_index = _build_name_index(items)
    surname_index = _build_surname_index(name_index.values())
    return {
        name: _resolve_from_indexes(
            name,
            name_index=name_index,
            surname_index=surname_index,
        )
        for name in unique_names
    }


employment_status_service = type(
    "EmploymentStatusService",
    (),
    {
        "resolve": staticmethod(resolve_employment_status),
        "resolve_batch": staticmethod(resolve_employment_status_batch),
    },
)()
