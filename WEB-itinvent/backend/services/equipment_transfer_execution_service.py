from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any, Callable, Optional

from backend.database import queries
from backend.database.equipment_db import invalidate_equipment_cache
from backend.services.transfer_act_reminder_service import transfer_act_reminder_service
from backend.services.transfer_service import (
    generate_transfer_acts,
    get_act_records,
    register_act_records,
)

# PM2 starts the Web backend from ``WEB-itinvent`` while the portable command
# contract lives at the monorepo root with the bot.  Keep that root importable
# without relying on another optional module's import side effect.
_MONOREPO_ROOT = Path(__file__).resolve().parents[3]
if str(_MONOREPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_MONOREPO_ROOT))

from shared.transfer_command import normalize_transfer_item_ids, run_transfer_command


logger = logging.getLogger(__name__)


class EquipmentTransferExecutionError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _payload_value(payload: Any, key: str, default: Any = None) -> Any:
    if isinstance(payload, dict):
        return payload.get(key, default)
    return getattr(payload, key, default)


def _to_int(value: Any) -> Optional[int]:
    if value in (None, "", "null"):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_inv_nos(raw_items: Any) -> list[str]:
    return normalize_transfer_item_ids(raw_items)


def _retry_inv_nos_from_failed(failed_items: Any) -> list[str]:
    """Return only explicit per-item failures safe for a follow-up request.

    Do not infer retry targets from a request-wide error: after an unknown
    failure the caller must inspect the operation instead of risking a second
    history row for an already moved item.
    """
    return normalize_transfer_item_ids(
        item.get("inv_no")
        for item in (failed_items or [])
        if isinstance(item, dict) and bool(item.get("retryable", True))
    )


def _user_attr(user: Any, key: str, default: Any = None) -> Any:
    if isinstance(user, dict):
        return user.get(key, default)
    return getattr(user, key, default)


def _default_reminder_result() -> dict[str, Any]:
    return {
        "created": False,
        "warning": None,
        "task_id": None,
        "reminder_id": None,
        "controller_username": None,
        "controller_fallback_used": False,
    }


def execute_equipment_transfer(
    *,
    payload: Any,
    db_id: Optional[str],
    current_user: Any,
    allow_create_owner: bool = True,
    checkpoint: Callable[[dict[str, Any]], None] | None = None,
    recovered_result: dict[str, Any] | None = None,
) -> dict[str, Any]:
    inv_nos = _normalize_inv_nos(_payload_value(payload, "inv_nos", []))
    if not inv_nos:
        raise EquipmentTransferExecutionError(400, "No inventory numbers provided")

    target_employee_name = str(_payload_value(payload, "new_employee", "") or "").strip()
    target_employee_dept_input = str(_payload_value(payload, "new_employee_dept", "") or "").strip()
    target_employee_no = _to_int(_payload_value(payload, "new_employee_no"))

    if target_employee_no is None and not allow_create_owner:
        raise EquipmentTransferExecutionError(400, "new_employee_no is required")

    if len(target_employee_name) < 2 and target_employee_no is None:
        raise EquipmentTransferExecutionError(400, "new_employee is required")

    if target_employee_no is not None:
        owner_row = queries.get_owner_by_no(target_employee_no, db_id)
        if not owner_row:
            raise EquipmentTransferExecutionError(400, "Invalid new_employee_no")
        target_employee_name = str(
            owner_row.get("OWNER_DISPLAY_NAME")
            or owner_row.get("owner_display_name")
            or owner_row.get("employee_name")
            or target_employee_name
        ).strip()
    else:
        target_employee_no = queries.get_owner_no_by_name(target_employee_name, strict=True, db_id=db_id)
        if target_employee_no is None:
            target_employee_no = queries.get_owner_no_by_name(target_employee_name, strict=False, db_id=db_id)
        if target_employee_no is None and allow_create_owner:
            target_employee_no = queries.create_owner(
                target_employee_name,
                department=(target_employee_dept_input or None),
                db_id=db_id,
            )
        if target_employee_no is None:
            if allow_create_owner:
                raise EquipmentTransferExecutionError(500, "Failed to resolve or create target employee")
            raise EquipmentTransferExecutionError(400, "Target employee is not resolved")

    target_owner = queries.get_owner_by_no(target_employee_no, db_id) or {}
    target_employee_dept = (
        target_owner.get("OWNER_DEPT")
        or target_owner.get("owner_dept")
        or target_owner.get("employee_dept")
        or target_employee_dept_input
        or ""
    )
    target_employee_email = queries.get_owner_email_by_no(target_employee_no, db_id)

    target_branch_no = _payload_value(payload, "branch_no")
    target_loc_no = _payload_value(payload, "loc_no")

    if target_branch_no is not None and not queries.get_branch_by_no(target_branch_no, db_id):
        raise EquipmentTransferExecutionError(400, "Invalid branch_no")

    if target_loc_no is not None and not queries.get_location_by_no(target_loc_no, db_id):
        raise EquipmentTransferExecutionError(400, "Invalid loc_no")

    changed_by = str(_user_attr(current_user, "username", "") or "").strip() or "IT-WEB"
    operation_id = str(_payload_value(payload, "operation_id", "") or "").strip()

    def _execute_inventory_item(_raw_item: str, inv_no: str) -> dict[str, Any]:
        try:
            return queries.transfer_equipment_by_inv_with_history(
                inv_no=inv_no,
                new_employee_no=target_employee_no,
                new_employee_name=target_employee_name,
                new_branch_no=target_branch_no,
                new_loc_no=target_loc_no,
                changed_by=changed_by,
                comment=_payload_value(payload, "comment"),
                operation_id=operation_id or None,
                db_id=db_id,
            )
        except Exception as exc:
            logger.exception("Inventory transfer failed inv_no=%s", inv_no)
            # An exception does not prove the database rejected the item.  Do
            # not offer it for automatic retry; the operation id must be
            # inspected/recovered first.
            return {
                "success": False,
                "message": str(exc) or "Transfer failed",
                "retryable": False,
            }

    command = run_transfer_command(
        inv_nos,
        item_id_getter=lambda inv_no: inv_no,
        item_id_key="inv_no",
        execute=_execute_inventory_item,
        invalid_item_error="Inventory number is required",
        duplicate_item_error="Duplicate inventory number in transfer request",
        unknown_result_error="Transfer failed",
    )
    transferred: list[dict[str, Any]] = []
    for success in command.successes:
        transfer_result = success.result
        old_employee_no = transfer_result.get("old_employee_no")
        old_email = None
        if old_employee_no is not None:
            old_email = queries.get_owner_email_by_no(int(old_employee_no), db_id)
        transfer_result["old_employee_email"] = old_email
        transferred.append(transfer_result)
    failed = command.failed

    prior_result = dict(recovered_result or {})
    prior_acts = [dict(act) for act in list(prior_result.get("acts") or []) if isinstance(act, dict)]
    prior_records = [
        dict(record)
        for record in list(prior_result.get("_act_records") or [])
        if isinstance(record, dict)
    ]
    if prior_records:
        # The job row stores the physical-path records privately.  Rehydrate
        # them before a recovered worker attempts a reminder or a download.
        register_act_records(prior_records)

    acts: list[dict[str, Any]] = []
    # A request with failed inventory moves must not produce a document for a
    # partial transfer. The already successful per-item moves are reported so
    # the operator can reconcile them, but there is no misleading act/reminder.
    if command.is_complete:
        # A durable checkpoint produced before a worker restart is authoritative
        # for this operation.  If a crash happened just before that checkpoint,
        # ``generate_transfer_acts`` still reuses deterministic operation files
        # and act IDs rather than emitting another document.
        acts = prior_acts or generate_transfer_acts(
            transferred_items=transferred,
            new_employee_name=target_employee_name,
            new_employee_dept=str(target_employee_dept or ""),
            new_employee_email=target_employee_email,
            db_id=db_id,
            operation_id=operation_id or None,
        )
        if acts and checkpoint is not None:
            checkpoint(
                {
                    "success_count": len(transferred),
                    "failed_count": 0,
                    "transferred": transferred,
                    "failed": [],
                    "retry_inv_nos": [],
                    "acts": acts,
                    "_act_records": get_act_records(
                        [str(act.get("act_id") or "").strip() for act in acts]
                    ),
                    "execution_stage": "acts_generated",
                    "one_c_sync_state": "not_requested",
                }
            )

    reminder_result = _default_reminder_result()
    if acts:
        if prior_result.get("upload_reminder_created"):
            reminder_result = {
                "created": True,
                "warning": prior_result.get("upload_reminder_warning"),
                "task_id": prior_result.get("upload_reminder_task_id"),
                "reminder_id": prior_result.get("upload_reminder_id"),
                "controller_username": prior_result.get("upload_reminder_controller_username"),
                "controller_fallback_used": bool(
                    prior_result.get("upload_reminder_controller_fallback_used")
                ),
            }
        else:
            try:
                reminder_result = transfer_act_reminder_service.create_transfer_reminder(
                    db_id=db_id,
                    transferred_items=transferred,
                    acts=acts,
                    new_employee_no=target_employee_no,
                    new_employee_name=target_employee_name,
                    actor_user=current_user,
                )
            except Exception as exc:
                logger.exception("Failed to create transfer act upload reminder")
                reminder_result = _default_reminder_result()
                reminder_result["warning"] = f"Напоминание о загрузке акта не создано: {exc}"

    if transferred:
        invalidate_equipment_cache(db_id)

    result = {
        "success_count": len(transferred),
        "failed_count": len(failed),
        "transferred": transferred,
        "failed": failed,
        "retry_inv_nos": command.retry_item_ids,
        "acts": acts,
        "upload_reminder_created": bool(reminder_result.get("created")),
        "upload_reminder_task_id": reminder_result.get("task_id"),
        "upload_reminder_id": reminder_result.get("reminder_id"),
        "upload_reminder_warning": reminder_result.get("warning"),
        "upload_reminder_controller_username": reminder_result.get("controller_username"),
        "upload_reminder_controller_fallback_used": bool(reminder_result.get("controller_fallback_used")),
        # HUB does not submit anything to 1C in this integration. A future
        # outbound path must be a separate, idempotent outbox project.
        "one_c_sync_state": "not_requested",
    }
    if acts and checkpoint is not None:
        checkpoint(
            {
                **result,
                "_act_records": get_act_records(
                    [str(act.get("act_id") or "").strip() for act in acts]
                ),
                "execution_stage": "reminder_processed",
            }
        )
    return result


def execute_equipment_location_transfer(
    *,
    payload: Any,
    db_id: Optional[str],
    current_user: Any,
    operation_id: Optional[str],
) -> dict[str, Any]:
    """Run a location-only move through the common per-item command contract.

    The SQL adapter owns the immutable ``ITEMS.ID`` replay marker.  This layer
    only collects confirmed item results and exposes retry targets explicitly,
    matching the ownership-transfer command used by the Web and bot flows.
    """
    inv_nos = _normalize_inv_nos(_payload_value(payload, "inv_nos", []))
    if not inv_nos:
        raise EquipmentTransferExecutionError(400, "No inventory numbers provided")

    target_branch_no = _payload_value(payload, "branch_no")
    target_loc_no = _payload_value(payload, "loc_no")
    if not queries.get_branch_by_no(target_branch_no, db_id):
        raise EquipmentTransferExecutionError(400, "Invalid branch_no")
    if not queries.get_location_by_no(target_loc_no, db_id):
        raise EquipmentTransferExecutionError(400, "Invalid loc_no")
    if not queries.is_location_in_branch(target_loc_no, target_branch_no, db_id):
        raise EquipmentTransferExecutionError(400, "loc_no does not belong to branch_no")

    changed_by = str(_user_attr(current_user, "username", "") or "").strip() or "IT-WEB"
    normalized_operation_id = str(operation_id or _payload_value(payload, "operation_id", "") or "").strip()

    def _execute_location_item(_raw_item: str, inv_no: str) -> dict[str, Any]:
        try:
            return queries.transfer_equipment_location_by_inv_with_history(
                inv_no=inv_no,
                new_branch_no=target_branch_no,
                new_loc_no=target_loc_no,
                changed_by=changed_by,
                comment=_payload_value(payload, "comment"),
                operation_id=normalized_operation_id or None,
                db_id=db_id,
            )
        except Exception as exc:
            logger.exception("Location transfer failed inv_no=%s", inv_no)
            # A timeout/error does not prove that SQL rolled the change back.
            # Only a known adapter rejection is retryable.
            return {
                "success": False,
                "message": str(exc) or "Location transfer failed",
                "retryable": False,
            }

    command = run_transfer_command(
        inv_nos,
        item_id_getter=lambda inv_no: inv_no,
        item_id_key="inv_no",
        execute=_execute_location_item,
        invalid_item_error="Inventory number is required",
        duplicate_item_error="Duplicate inventory number in transfer request",
        unknown_result_error="Location transfer failed",
    )
    transferred = [entry.result for entry in command.successes]
    if transferred:
        invalidate_equipment_cache(db_id)

    return {
        "success_count": len(transferred),
        "failed_count": len(command.failed),
        "transferred": transferred,
        "failed": command.failed,
        "retry_inv_nos": command.retry_item_ids,
        "acts": [],
        "one_c_sync_state": "not_requested",
    }
