"""Notify the uploader that a checker rejected their equipment photo.

Best effort and never raising: the rejection is already stored, a failed
notification must not turn it into an error for the checker.

Recipient: the app user recorded at upload (valid only for the current FILES
fingerprint); otherwise FILES.CREATE_USER matched to a login or an exact,
unambiguous full name of an active user. No match -> nobody is notified.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

EVENT_TYPE = "equipment.photo_rejected"
ENTITY_TYPE = "equipment_photo"
MAX_BODY_LENGTH = 300


def _text(value: Any) -> str:
    return str(value or "").strip()


def _norm_name(value: Any) -> str:
    return " ".join(_text(value).lower().replace("ё", "е").split())


def _active(user: Optional[dict[str, Any]]) -> bool:
    return bool(user) and bool(user.get("is_active", True))


def resolve_uploader_id(
    *, state: dict[str, Any], created_by: str, users: Any
) -> Optional[int]:
    """App user id of the photo uploader, or None when it cannot be told for sure."""
    recorded = state.get("uploaded_by_user_id")
    if recorded is not None:
        try:
            user = users.get_by_id(int(recorded))
        except (TypeError, ValueError):
            user = None
        return int(user["id"]) if _active(user) else None

    name = _text(created_by)
    if not name:
        return None
    user = users.get_by_username(name)
    if _active(user):
        return int(user["id"])
    wanted = _norm_name(name)
    found = users.search_users(query=" ".join(name.split()), status="active", limit=10)
    matches = [
        item for item in (found.get("items") or [])
        if _norm_name(item.get("full_name")) == wanted
    ]
    # Two people with the same full name: guessing would notify a stranger.
    return int(matches[0]["id"]) if len(matches) == 1 else None


def notify_photo_rejected(
    *,
    db_id: Any,
    item_id: int,
    file_no: int,
    state: dict[str, Any],
    created_by: str,
    rejector_user_id: Any,
    get_item_rows: Optional[Callable] = None,
    users: Any = None,
    hub: Any = None,
) -> bool:
    """Create the hub notification for the uploader; True when one was created."""
    try:
        if users is None:
            from backend.services.user_service import user_service as users
        if hub is None:
            from backend.services.hub_service import hub_service as hub

        recipient = resolve_uploader_id(state=state, created_by=created_by, users=users)
        if recipient is None or recipient == _as_int(rejector_user_id):
            return False

        if get_item_rows is None:
            from backend.database import queries

            get_item_rows = queries.get_equipment_items_by_ids
        label: dict[str, Any] = {}
        for row in get_item_rows([item_id], db_id) or []:
            label = row
            break
        inv_no = _text(label.get("inv_no")) or str(item_id)
        model = _text(label.get("model_name"))
        reason = _text(state.get("reject_reason"))
        rejector = _text(state.get("rejected_by_name"))

        parts = []
        if model:
            parts.append(model)
        parts.append(f"Причина: {reason}" if reason else "Причина не указана")
        if rejector:
            parts.append(f"Проверяющий: {rejector}")
        body = ". ".join(parts)[:MAX_BODY_LENGTH]

        created = hub.create_user_notification(
            recipient_user_id=recipient,
            event_type=EVENT_TYPE,
            title=f"Фото отклонено: {inv_no}",
            body=body,
            entity_type=ENTITY_TYPE,
            entity_id=f"{_text(db_id)}:{inv_no}:{int(file_no)}",
            dedupe_same_day=True,
        )
        return created is not None
    except Exception:
        logger.warning(
            "Equipment photo rejection notification failed item_id=%s file_no=%s",
            item_id, file_no, exc_info=True,
        )
        return False


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0
