"""In-process pacing for agents whose unacknowledged data stays on disk."""

from __future__ import annotations

import math
from datetime import timezone
from email.utils import parsedate_to_datetime
from random import uniform
from time import monotonic, time


class UploadSchedule:
    def __init__(self, interval: float) -> None:
        self.interval = max(1.0, float(interval))
        self.failures = 0
        self.next_attempt_at = monotonic() + uniform(0, self.interval)

    def ready(self) -> bool:
        return monotonic() >= self.next_attempt_at

    def succeeded(self) -> None:
        self.failures = 0
        self.next_attempt_at = monotonic() + uniform(self.interval * 0.8, self.interval * 1.2)

    def failed(self, status: int | None = None, retry_after: str | None = None) -> None:
        self.failures = min(self.failures + 1, 10)
        ceiling = min(300.0, self.interval * 2 ** self.failures)
        delay = uniform(ceiling / 2, ceiling)
        if status is not None and 400 <= status < 500 and status not in (408, 429):
            # Bad credentials/payloads need repair, not a three-second retry loop.
            delay = uniform(300, 900)
        if retry_after:
            try:
                seconds = float(retry_after)
            except (ValueError, TypeError):
                try:
                    when = parsedate_to_datetime(retry_after)
                    if when.tzinfo is None:
                        when = when.replace(tzinfo=timezone.utc)
                    seconds = when.timestamp() - time()
                except (ValueError, TypeError, OverflowError, OSError):
                    seconds = 0.0
            if math.isfinite(seconds) and seconds > 0:
                delay = max(delay, seconds) + uniform(0, self.interval)
        self.next_attempt_at = monotonic() + delay
