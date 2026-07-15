from __future__ import annotations

from typing import Any, Dict, Tuple


INCIDENT_PATTERN_FILTER_GROUPS: Dict[str, Dict[str, Any]] = {
    "dsp": {
        "name": "ДСП",
        "pattern_ids": (
            "dsp_official_use",
            "dsp_ocr_variant",
            "dsp_ocr_context",
            "dsp_with_exclusion",
        ),
    },
}

_PATTERN_TO_FILTER_ID = {
    pattern_id: filter_id
    for filter_id, group in INCIDENT_PATTERN_FILTER_GROUPS.items()
    for pattern_id in group["pattern_ids"]
}


def incident_pattern_filter_metadata(pattern_id: Any, pattern_name: Any = "") -> Dict[str, str]:
    normalized_id = str(pattern_id or "").strip().lower()
    filter_id = _PATTERN_TO_FILTER_ID.get(normalized_id, normalized_id)
    group = INCIDENT_PATTERN_FILTER_GROUPS.get(filter_id)
    return {
        "id": filter_id,
        "name": str(group.get("name") or filter_id) if group else str(pattern_name or pattern_id or "").strip(),
    }


def expand_incident_pattern_filter(pattern_filter_id: Any) -> Tuple[str, ...]:
    normalized_id = str(pattern_filter_id or "").strip().lower()
    if not normalized_id:
        return ()
    group = INCIDENT_PATTERN_FILTER_GROUPS.get(normalized_id)
    if group:
        return tuple(str(item).strip().lower() for item in group["pattern_ids"] if str(item).strip())
    return (normalized_id,)
