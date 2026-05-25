"""Shared utilities for the chat domain."""
from __future__ import annotations


def normalize_text(value: object, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default
