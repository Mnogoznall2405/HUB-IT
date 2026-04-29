from __future__ import annotations

import logging
from typing import Any, Optional

from backend.database import queries
from backend.database.equipment_db import invalidate_equipment_cache
from backend.services.transfer_act_reminder_service import transfer_act_reminder_service
from backend.services.transfer_service import generate_transfer_acts


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
    inv_nos: list[str] = []
    for raw in raw_items or []:
        normalized = str(raw or "").strip()
        if normalized and normalized not in inv_nos:
            inv_nos.append(normalized)
    return inv_nos


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
    transferred: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []

    for inv_no in inv_nos:
        transfer_result = queries.transfer_equipment_by_inv_with_history(
            inv_no=inv_no,
            new_employee_no=target_employee_no,
            new_employee_name=target_employee_name,
            new_branch_no=target_branch_no,
            new_loc_no=target_loc_no,
            changed_by=changed_by,
            comment=_payload_value(payload, "comment"),
            db_id=db_id,
        )
        if transfer_result.get("success"):
            old_employee_no = transfer_result.get("old_employee_no")
            old_email = None
            if old_employee_no is not None:
                old_email = queries.get_owner_email_by_no(int(old_employee_no), db_id)
            transfer_result["old_employee_email"] = old_email
            transferred.append(transfer_result)
        else:
            failed.append(
                {
                    "inv_no": inv_no,
                    "error": transfer_result.get("message") or "Transfer failed",
                }
            )

    acts: list[dict[str, Any]] = []
    if transferred:
        acts = generate_transfer_acts(
            transferred_items=transferred,
            new_employee_name=target_employee_name,
            new_employee_dept=str(target_employee_dept or ""),
            new_employee_email=target_employee_email,
            db_id=db_id,
        )

    reminder_result = _default_reminder_result()
    if acts:
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

    return {
        "success_count": len(transferred),
        "failed_count": len(failed),
        "transferred": transferred,
        "failed": failed,
        "acts": acts,
        "upload_reminder_created": bool(reminder_result.get("created")),
        "upload_reminder_task_id": reminder_result.get("task_id"),
        "upload_reminder_id": reminder_result.get("reminder_id"),
        "upload_reminder_warning": reminder_result.get("warning"),
        "upload_reminder_controller_username": reminder_result.get("controller_username"),
        "upload_reminder_controller_fallback_used": bool(reminder_result.get("controller_fallback_used")),
    }
