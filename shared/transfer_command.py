"""Pure, shared result contract for HUB inventory-transfer commands.

The Web API and Telegram bot reach different database adapters, but an
operation must have the same observable semantics in both places:

* identifiers are trimmed and de-duplicated before a command is executed;
* only an adapter's explicit per-item rejection is offered for retry;
* malformed, duplicate or unknown-exception items remain failures but are not
  silently retried; and
* document/ledger code can decide from one ``is_complete`` flag whether the
  whole requested command was confirmed.

This module intentionally has no database, FastAPI, Telegram or 1C imports.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Generic, Iterable, Mapping, TypeVar


T = TypeVar("T")


def normalize_transfer_item_ids(values: Iterable[Any] | None) -> list[str]:
    """Return non-empty, stable, first-seen transfer identifiers.

    The function deliberately does not change case: inventory and serial
    identifiers are owned by the source HUB database and can be case-sensitive
    in integrations.  It only removes surrounding whitespace and duplicates.
    """

    normalized: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        item_id = str(value or "").strip()
        if item_id and item_id not in seen:
            seen.add(item_id)
            normalized.append(item_id)
    return normalized


@dataclass(frozen=True)
class TransferCommandSuccess(Generic[T]):
    """One confirmed per-item transfer result."""

    item_id: str
    item: T
    result: dict[str, Any]


@dataclass
class TransferCommandOutcome(Generic[T]):
    """Collected per-item result of one requested transfer command."""

    item_id_key: str
    requested_ids: list[str] = field(default_factory=list)
    successes: list[TransferCommandSuccess[T]] = field(default_factory=list)
    failed: list[dict[str, Any]] = field(default_factory=list)

    @property
    def is_complete(self) -> bool:
        """Whether every requested, normalized item was explicitly confirmed."""

        return bool(self.requested_ids) and not self.failed and len(self.successes) == len(self.requested_ids)

    @property
    def retry_item_ids(self) -> list[str]:
        """Only explicitly rejected, retryable item identifiers.

        An exception can happen after a backend has committed an item.  It is
        therefore not an automatic retry target.  Callers can still inspect it
        in ``failed`` and rely on the operation idempotency key for recovery.
        """

        return normalize_transfer_item_ids(
            failure.get(self.item_id_key)
            for failure in self.failed
            if bool(failure.get("retryable"))
        )

    @property
    def succeeded_items(self) -> list[T]:
        return [entry.item for entry in self.successes]


def run_transfer_command(
    items: Iterable[T] | None,
    *,
    item_id_getter: Callable[[T], Any],
    item_id_key: str,
    execute: Callable[[T, str], Mapping[str, Any] | None],
    invalid_item_error: str,
    duplicate_item_error: str,
    unknown_result_error: str = "Transfer result is unknown",
) -> TransferCommandOutcome[T]:
    """Run synchronous per-item work under one portable result contract.

    ``execute`` must return ``{"success": True}`` for a confirmed move or an
    explicit ``{"success": False, "message": ...}`` refusal.  Exceptions and
    malformed responses are retained for diagnostics, but deliberately marked
    non-retryable: a caller must resolve their actual state first.
    """

    outcome: TransferCommandOutcome[T] = TransferCommandOutcome(item_id_key=item_id_key)
    seen: set[str] = set()

    for item in items or []:
        item_id = str(item_id_getter(item) or "").strip()
        if not item_id:
            outcome.failed.append(
                {
                    item_id_key: "",
                    "error": invalid_item_error,
                    "retryable": False,
                }
            )
            continue

        if item_id in seen:
            outcome.failed.append(
                {
                    item_id_key: item_id,
                    "error": duplicate_item_error,
                    "retryable": False,
                }
            )
            continue

        seen.add(item_id)
        outcome.requested_ids.append(item_id)

        try:
            result = execute(item, item_id)
        except Exception as exc:  # pragma: no cover - adapters decide logging
            outcome.failed.append(
                {
                    item_id_key: item_id,
                    "error": str(exc) or unknown_result_error,
                    "retryable": False,
                }
            )
            continue

        if not isinstance(result, Mapping):
            outcome.failed.append(
                {
                    item_id_key: item_id,
                    "error": unknown_result_error,
                    "retryable": False,
                }
            )
            continue

        result_payload = dict(result)
        if bool(result_payload.get("success")):
            outcome.successes.append(
                TransferCommandSuccess(item_id=item_id, item=item, result=result_payload)
            )
            continue

        outcome.failed.append(
            {
                item_id_key: item_id,
                "error": str(result_payload.get("message") or unknown_result_error),
                # An adapter can explicitly prohibit retry for a known
                # conflict; otherwise a returned failure is a retry candidate.
                "retryable": bool(result_payload.get("retryable", True)),
            }
        )

    return outcome
