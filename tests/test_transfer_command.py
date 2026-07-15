from __future__ import annotations

from shared.transfer_command import run_transfer_command


def test_shared_transfer_command_normalizes_ids_and_retries_only_explicit_refusals():
    calls: list[str] = []

    def execute(_item: str, item_id: str):
        calls.append(item_id)
        if item_id == "B-REJECTED":
            return {"success": False, "message": "blocked"}
        if item_id == "C-UNKNOWN":
            raise RuntimeError("connection dropped after submit")
        return {"success": True, "item_id": item_id}

    outcome = run_transfer_command(
        [" A-OK ", "A-OK", "", "B-REJECTED", "C-UNKNOWN"],
        item_id_getter=lambda item: item,
        item_id_key="serial",
        execute=execute,
        invalid_item_error="serial is required",
        duplicate_item_error="duplicate serial",
    )

    assert calls == ["A-OK", "B-REJECTED", "C-UNKNOWN"]
    assert outcome.requested_ids == ["A-OK", "B-REJECTED", "C-UNKNOWN"]
    assert [entry.item_id for entry in outcome.successes] == ["A-OK"]
    assert outcome.is_complete is False
    assert outcome.retry_item_ids == ["B-REJECTED"]
    assert [failure["retryable"] for failure in outcome.failed] == [False, False, True, False]
