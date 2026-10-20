"""Durable "consume stock + write work record" operation.

The maintenance flow used to issue two independent requests: decrement
``ITEMS.QTY`` in SQL Server, then append a works record.  A failure between
them left stock consumed without a history entry, and a retry consumed the
consumable a second time.  This service wraps both steps in the same durable
job machinery that transfer acts use: a client-supplied ``operation_id``
makes retries replayable, ``checkpoint_processing_result`` records the
completed stage, and a resumed operation skips the consume step instead of
re-applying it.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from backend.database import queries as db_queries
from backend.services import transfer_act_job_service as jobs
from backend.services.equipment_recent_cards_service import equipment_recent_cards_service
from backend.services.transfer_act_job_service import TransferOperationConflict

logger = logging.getLogger(__name__)

OPERATION_CONSUMABLE_WORK = "consumable_work"
_WORK_KIND_COMPONENT = "component"
_WORK_KIND_CARTRIDGE = "cartridge"
_WORK_KINDS = {_WORK_KIND_COMPONENT, _WORK_KIND_CARTRIDGE}


class ConsumableOperationInProgress(Exception):
    """The same operation_id is being executed by another request."""


class ConsumableConsumeRejected(Exception):
    """Terminal consume failure (not found / insufficient / invalid)."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def _validated_work_kwargs(work: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """Validate the embedded works payload against the existing API contracts."""
    kind = str((work or {}).get("kind") or "").strip().lower()
    payload = (work or {}).get("payload") or {}
    if kind not in _WORK_KINDS:
        raise ValueError("work.kind must be 'component' or 'cartridge'")
    if not isinstance(payload, dict):
        raise ValueError("work.payload must be an object")
    if kind == _WORK_KIND_COMPONENT:
        from backend.models.json_operations import ComponentReplacementCreate

        model = ComponentReplacementCreate.model_validate(payload)
    else:
        from backend.models.json_operations import CartridgeReplacementCreate

        model = CartridgeReplacementCreate.model_validate(payload)
    return kind, model.model_dump()


def _find_existing_work_record(
    manager: Any,
    *,
    work_kind: str,
    operation_id: str,
) -> Optional[dict[str, Any]]:
    """Locate the record written by this operation (crash-safe resume)."""
    files = (
        [manager.COMPONENT_FILE, manager.CARTRIDGE_FILE]
        if work_kind == _WORK_KIND_COMPONENT
        else [manager.CARTRIDGE_FILE]
    )
    for filename in files:
        try:
            records = manager.data_manager.load_json(filename, default_content=[]) or []
        except Exception as exc:
            logger.warning("Cannot scan %s for dedupe of %s: %s", filename, operation_id, exc)
            continue
        if not isinstance(records, list):
            continue
        for record in records:
            if not isinstance(record, dict):
                continue
            extra = record.get("additional_data") or {}
            if isinstance(extra, dict) and str(extra.get("operation_id") or "") == operation_id:
                return record
    return None


def _touch_recent_card(user: Any, *, db_id: Optional[str], inv_no: Any, action_type: str, record: Any) -> None:
    """Mirror of the works endpoints' recent-card touch — same side effect."""
    try:
        user_id = int(getattr(user, "id", 0) or 0)
    except (TypeError, ValueError):
        user_id = 0
    if user_id <= 0:
        return
    try:
        equipment_recent_cards_service.touch(
            user_id=user_id,
            db_id=db_id,
            inv_no=inv_no,
            action_type=action_type,
            snapshot=record,
        )
    except Exception:
        logger.warning("Failed to record equipment recent card activity", exc_info=True)


def _record_work_once(
    *,
    work_kind: str,
    work_kwargs: dict[str, Any],
    operation_id: str,
    user: Any = None,
    db_id: Optional[str] = None,
) -> dict[str, Any]:
    """Append the works record unless this operation already wrote one."""
    from backend.json_db.works import WorksManager

    manager = WorksManager()
    existing = _find_existing_work_record(
        manager, work_kind=work_kind, operation_id=operation_id
    )
    if existing is not None:
        return existing
    kwargs = dict(work_kwargs)
    additional = dict(kwargs.get("additional_data") or {})
    additional["operation_id"] = operation_id
    kwargs["additional_data"] = additional
    if work_kind == _WORK_KIND_CARTRIDGE:
        record = manager.add_cartridge_replacement(**kwargs)
    else:
        record = manager.add_component_replacement(**kwargs)
    _touch_recent_card(
        user,
        db_id=str(kwargs.get("db_name") or db_id or "") or None,
        inv_no=kwargs.get("inv_no"),
        action_type=work_kind,
        record=record,
    )
    return record


def _latest_done_result(job_id: str) -> Optional[dict[str, Any]]:
    latest = jobs.get_job(job_id)
    if latest and str(latest.get("status") or "").strip() == "done":
        result = dict(latest.get("result") or {})
        result.setdefault("operation_id", job_id)
        return result
    return None


def execute_consume_with_work(
    *,
    db_id: Optional[str],
    user: Any,
    item_id: Optional[int],
    inv_no: Optional[str],
    qty: int,
    reason: Optional[str] = None,
    operation_id: Optional[str] = None,
    work: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Consume stock and (optionally) write the works record as one operation.

    ``operation_id`` dedupes retries: the first attempt persists each stage,
    so a repeated call replays the stored result or resumes from the
    checkpoint instead of consuming the item again.
    """
    # Validate the works payload *before* any stock mutation — the old flow
    # discovered invalid component data only after the quantity was spent.
    work_kind: Optional[str] = None
    work_kwargs: Optional[dict[str, Any]] = None
    if work:
        work_kind, work_kwargs = _validated_work_kwargs(work)

    canonical_payload = {
        "item_id": item_id,
        "inv_no": str(inv_no or "").strip() or None,
        "qty": int(qty),
        "reason": str(reason or "").strip() or None,
        "work": {"kind": work_kind, "payload": work_kwargs} if work_kind else None,
    }
    job = jobs.create_job(
        operation=OPERATION_CONSUMABLE_WORK,
        payload=canonical_payload,
        db_id=db_id,
        user=user,
        request_count=1,
        operation_id=operation_id,
    )
    job_id = str(job["id"])
    status_now = str(job.get("status") or "").strip()

    if status_now == "done":
        return _latest_done_result(job_id) or {"success": True, "operation_id": job_id}
    if status_now == "processing":
        # create_job already attempted a stale-lease requeue; still processing
        # means another request genuinely owns the execution right now.
        raise ConsumableOperationInProgress(job_id)
    if status_now == "failed" and not jobs.requeue_failed_job(
        job_id, status_text="Повтор списания расходника"
    ):
        done = _latest_done_result(job_id)
        if done is not None:
            return done
        raise ConsumableOperationInProgress(job_id)
    if not jobs.claim_for_execution(job_id, status_text="Списание расходника выполняется"):
        done = _latest_done_result(job_id)
        if done is not None:
            return done
        raise ConsumableOperationInProgress(job_id)

    stage_result: dict[str, Any] = {}
    try:
        stage_result = dict((jobs.get_job(job_id) or {}).get("result") or {})
        consume_result = stage_result.get("consume_result")
        if not (stage_result.get("stock_consumed") and isinstance(consume_result, dict)):
            consume_result = db_queries.consume_consumable_stock(
                db_id=db_id,
                item_id=item_id,
                inv_no=inv_no,
                qty=int(qty),
                changed_by=str(getattr(user, "username", "") or "IT-WEB"),
            )
            if not consume_result.get("success"):
                message = str(consume_result.get("message") or "Failed to consume consumable")
                jobs.mark_failed(job_id, message, stage_result)
                raise ConsumableConsumeRejected(message)
            stage_result = {
                "stock_consumed": True,
                "consume_result": consume_result,
            }
            jobs.checkpoint_processing_result(
                job_id,
                stage_result,
                status_text="Расходник списан; записывается работа",
            )

        work_status = "none"
        work_record = None
        if work_kind and work_kwargs is not None:
            work_record = _record_work_once(
                work_kind=work_kind,
                work_kwargs=work_kwargs,
                operation_id=job_id,
                user=user,
                db_id=db_id,
            )
            work_status = "recorded"

        final = {
            "success": True,
            "item_id": consume_result.get("item_id"),
            "inv_no": consume_result.get("inv_no"),
            "qty_old": consume_result.get("qty_old"),
            "qty_new": consume_result.get("qty_new"),
            "message": str(consume_result.get("message") or "Consumable stock updated"),
            "operation_id": job_id,
            "work_status": work_status,
            "work_record": work_record,
        }
        jobs.mark_done(job_id, final, status_text="Списание и запись работы завершены")
        return final
    except (ConsumableConsumeRejected, ConsumableOperationInProgress):
        raise
    except Exception as exc:
        jobs.mark_failed(job_id, str(exc), stage_result or None)
        raise


__all__ = [
    "OPERATION_CONSUMABLE_WORK",
    "ConsumableConsumeRejected",
    "ConsumableOperationInProgress",
    "TransferOperationConflict",
    "execute_consume_with_work",
]
