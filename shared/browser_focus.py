"""Stable identities for Browser Probe focus events across upload retries."""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any


def browser_focus_event_key(host: str, user: str, event: dict[str, Any]) -> str | None:
    event_id = event.get("event_id")
    if isinstance(event_id, str) and 0 < len(event_id.strip()) <= 128:
        identity = ("event", event_id.strip())
    else:
        # Older probes already send an end timestamp. Without it, identical
        # payloads could describe different focus intervals, so keep both.
        try:
            ended_at = float(event.get("ended_at"))
        except (TypeError, ValueError, OverflowError):
            return None
        if not math.isfinite(ended_at):
            return None
        identity = (
            "legacy",
            ended_at.hex(),
            str(event.get("browser") or "").strip().casefold(),
            str(event.get("url") or event.get("title") or "").strip(),
            str(event.get("hwnd") or ""),
            str(event.get("dwell_sec") or ""),
        )
    scope = (host.casefold(), user.casefold(), identity)
    return hashlib.sha256(json.dumps(scope, separators=(",", ":")).encode("ascii")).hexdigest()
