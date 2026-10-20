"""Service layer for ITINVENT reference data: store calls, audit log, cache invalidation."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from backend.database import itinvent_reference_writes as store
from backend.database.equipment_db import invalidate_equipment_cache

logger = logging.getLogger(__name__)

ReferenceDataError = store.ReferenceDataError
KINDS = store.KINDS
MANAGED_CI_TYPES = store.MANAGED_CI_TYPES


def _audit(action: str, *, actor: str, db_id: Optional[str], kind: str, **details: Any) -> None:
    # Secret-free audit trail: who changed which reference row in which database.
    logger.info(
        "itinvent_reference_%s actor=%s db=%s kind=%s details=%s",
        action,
        actor,
        db_id or "default",
        kind,
        details,
    )


def list_references(kind: str, db_id: Optional[str], **filters: Any) -> List[dict]:
    return store.list_references(kind, db_id, **filters)


def get_usage(kind: str, ref_id: Any, db_id: Optional[str], *, ci_type: Any = None) -> dict:
    return store.get_reference_usage(kind, ref_id, db_id, ci_type=ci_type)


def create(kind: str, payload: Dict[str, Any], db_id: Optional[str], *, actor: str) -> dict:
    row = store.create_reference(kind, payload, db_id)
    invalidate_equipment_cache(db_id)
    _audit("created", actor=actor, db_id=db_id, kind=kind, row=row)
    return row


def update(kind: str, ref_id: Any, payload: Dict[str, Any], db_id: Optional[str], *, actor: str, ci_type: Any = None) -> dict:
    changed = store.update_reference(kind, ref_id, payload, db_id, ci_type=ci_type)
    invalidate_equipment_cache(db_id)
    _audit("updated", actor=actor, db_id=db_id, kind=kind, before=changed["before"], after=changed["after"])
    return changed["after"]


def delete(kind: str, ref_id: Any, db_id: Optional[str], *, actor: str, ci_type: Any = None) -> dict:
    row = store.delete_reference(kind, ref_id, db_id, ci_type=ci_type)
    invalidate_equipment_cache(db_id)
    _audit("deleted", actor=actor, db_id=db_id, kind=kind, row=row)
    return row
