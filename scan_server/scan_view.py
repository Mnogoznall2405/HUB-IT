"""Fail-closed scan list view normalization (summary|detail only)."""
from __future__ import annotations

from enum import Enum
from typing import Any, Literal, Optional


class ScanListView(str, Enum):
    summary = "summary"
    detail = "detail"


ScanViewName = Literal["summary", "detail"]


class InvalidScanView(ValueError):
    """Raised when view is present but not summary|detail."""


def normalize_scan_list_view(
    value: Any,
    *,
    default: ScanViewName = "detail",
) -> ScanViewName:
    """Normalize list/view projection.

    - Missing / blank → documented default (never invents detail from garbage).
    - summary|detail (any case) → accepted.
    - Any other non-empty token → InvalidScanView (fail-closed; never detail).
    """
    if default not in ("summary", "detail"):
        raise ValueError("default must be 'summary' or 'detail'")
    if value is None:
        return default
    if isinstance(value, ScanListView):
        return value.value  # type: ignore[return-value]
    text = str(value).strip().lower()
    if not text:
        return default
    if text == "summary":
        return "summary"
    if text == "detail":
        return "detail"
    raise InvalidScanView("view must be 'summary' or 'detail'")


def coerce_optional_metrics_view(value: Optional[str]) -> Optional[str]:
    """Metrics endpoint accepts chart|summary|light|detail or blank; unknown ignored (None)."""
    text = str(value or "").strip().lower()
    if not text:
        return None
    if text in {"chart", "summary", "light", "detail"}:
        return text
    return None
