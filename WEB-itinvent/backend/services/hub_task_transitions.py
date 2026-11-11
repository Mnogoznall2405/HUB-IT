"""Hub task status transition matrix, conflicts, and in-process metrics (TASK-P0-1)."""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("backend.hub.task_transitions")

TASK_STATUSES = frozenset({"new", "in_progress", "review", "done"})

# Single source of truth for workflow transitions.
# Keys are operation names used in metrics/logs.
TRANSITION_MATRIX: dict[str, dict[str, Any]] = {
    "start": {
        "from": frozenset({"new"}),
        "to": "in_progress",
        "notes": "start∥start → second request conflicts",
    },
    "submit": {
        "from": frozenset({"new", "in_progress"}),
        "to": "review",
        "notes": "allows submit without explicit start (legacy UX)",
    },
    "approve": {
        "from": frozenset({"review"}),
        "to": "done",
    },
    "reject": {
        "from": frozenset({"review"}),
        "to": "in_progress",
    },
    "reopen": {
        "from": frozenset({"done"}),
        "to": "in_progress",
    },
    "complete_direct": {
        "from": frozenset({"new", "in_progress", "review"}),
        "to": "done",
        "notes": "integration/admin auto-close; already-done is idempotent no-op",
    },
}

# Human labels for API/FE messages (ru).
STATUS_LABELS_RU = {
    "new": "Новое",
    "in_progress": "В работе",
    "review": "На проверке",
    "done": "Готово",
}


class TaskTransitionConflict(Exception):
    """Raised when conditional status UPDATE matches zero rows."""

    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = dict(payload or {})
        code = str(self.payload.get("code") or "task_transition_conflict")
        current = str(self.payload.get("current_status") or "")
        super().__init__(f"{code}: current_status={current}")


@dataclass
class _TransitionMetrics:
    lock: threading.Lock = field(default_factory=threading.Lock)
    # label key → count; labels limited cardinality (no task_id)
    attempts: dict[str, int] = field(default_factory=dict)
    success: dict[str, int] = field(default_factory=dict)
    conflicts: dict[str, int] = field(default_factory=dict)
    invalid: dict[str, int] = field(default_factory=dict)
    side_effect_failures: dict[str, int] = field(default_factory=dict)

    @staticmethod
    def _key(*, operation: str, expected_status: str, target_status: str, result: str) -> str:
        return "|".join(
            (
                str(operation or ""),
                str(expected_status or ""),
                str(target_status or ""),
                str(result or ""),
            )
        )

    def _bump(self, bucket: dict[str, int], key: str) -> None:
        bucket[key] = int(bucket.get(key) or 0) + 1

    def note(
        self,
        *,
        kind: str,
        operation: str,
        expected_status: str,
        target_status: str,
        result: str,
    ) -> None:
        key = self._key(
            operation=operation,
            expected_status=expected_status,
            target_status=target_status,
            result=result,
        )
        with self.lock:
            if kind == "attempt":
                self._bump(self.attempts, key)
            elif kind == "success":
                self._bump(self.success, key)
            elif kind == "conflict":
                self._bump(self.conflicts, key)
            elif kind == "invalid":
                self._bump(self.invalid, key)
            elif kind == "side_effect_failure":
                self._bump(self.side_effect_failures, key)

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "hub_task_transition_attempts": dict(self.attempts),
                "hub_task_transition_success": dict(self.success),
                "hub_task_transition_conflicts": dict(self.conflicts),
                "hub_task_transition_invalid": dict(self.invalid),
                "hub_task_transition_side_effect_failures": dict(self.side_effect_failures),
            }

    def reset(self) -> None:
        with self.lock:
            self.attempts.clear()
            self.success.clear()
            self.conflicts.clear()
            self.invalid.clear()
            self.side_effect_failures.clear()


transition_metrics = _TransitionMetrics()


def expected_status_label(expected: frozenset[str] | set[str] | list[str]) -> str:
    values = sorted({str(item).strip().lower() for item in expected if str(item).strip()})
    if not values:
        return ""
    if len(values) == 1:
        return values[0]
    return "|".join(values)


def build_conflict_payload(
    *,
    task_id: str,
    operation: str,
    expected_statuses: frozenset[str] | set[str],
    requested_status: str,
    current_status: str | None,
    current_updated_at: str | None = None,
    current_version: int | None = None,
) -> dict[str, Any]:
    expected = frozenset(str(s).strip().lower() for s in expected_statuses if str(s).strip())
    return {
        "code": "task_transition_conflict",
        "task_id": str(task_id or ""),
        "operation": str(operation or ""),
        "expected_status": expected_status_label(expected),
        "expected_statuses": sorted(expected),
        "requested_status": str(requested_status or "").strip().lower(),
        "current_status": str(current_status or "").strip().lower() or None,
        "current_updated_at": current_updated_at,
        "current_version": current_version,
    }


def note_transition_attempt(*, operation: str, expected_status: str, target_status: str) -> None:
    transition_metrics.note(
        kind="attempt",
        operation=operation,
        expected_status=expected_status,
        target_status=target_status,
        result="attempt",
    )


def note_transition_success(*, operation: str, expected_status: str, target_status: str) -> None:
    transition_metrics.note(
        kind="success",
        operation=operation,
        expected_status=expected_status,
        target_status=target_status,
        result="success",
    )


def note_transition_conflict(*, operation: str, expected_status: str, target_status: str) -> None:
    transition_metrics.note(
        kind="conflict",
        operation=operation,
        expected_status=expected_status,
        target_status=target_status,
        result="conflict",
    )


def note_transition_invalid(*, operation: str, expected_status: str, target_status: str) -> None:
    transition_metrics.note(
        kind="invalid",
        operation=operation,
        expected_status=expected_status,
        target_status=target_status,
        result="invalid",
    )


def note_side_effect_failure(*, operation: str, target_status: str = "") -> None:
    transition_metrics.note(
        kind="side_effect_failure",
        operation=operation,
        expected_status="",
        target_status=target_status,
        result="side_effect_failure",
    )
    logger.error(
        "hub.task.transition_side_effect_failure operation=%s target_status=%s",
        operation,
        target_status,
    )


def get_transition_metrics_snapshot() -> dict[str, Any]:
    return transition_metrics.snapshot()


def reset_transition_metrics() -> None:
    transition_metrics.reset()
