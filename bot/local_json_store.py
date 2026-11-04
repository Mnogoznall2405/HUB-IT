#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bot-side helper for shared local SQLite store.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from local_store import get_local_store

_store = get_local_store(data_dir=Path(__file__).resolve().parents[1] / "data")


def load_json_data(filename: str, default_content: Any = None) -> Any:
    return _store.load_json(Path(filename).name, default_content=default_content)


def save_json_data(filename: str, data: Any) -> bool:
    return _store.save_json(Path(filename).name, data)


def load_json_entry(filename: str, entry_key: str) -> Any:
    return _store.get_entry(Path(filename).name, entry_key)


def save_json_entry(filename: str, entry_key: str, payload: Any) -> bool:
    return _store.set_entry(Path(filename).name, entry_key, payload)


def append_json_data(filename: str, record: Any) -> bool:
    return _store.append_to_json(Path(filename).name, record)


def list_json_entry_keys_by_status(filename: str, *, status: str, updated_before: str, limit: int) -> list[str]:
    return _store.list_entry_keys_by_status(
        Path(filename).name, status=status, updated_before=updated_before, limit=limit
    )


def delete_json_entries(filename: str, entry_keys: list[str]) -> int:
    return _store.delete_entries(Path(filename).name, entry_keys)


def get_store():
    return _store

