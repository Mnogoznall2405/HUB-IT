"""Best-effort hub bell notification when a voice job finishes.

Writes a row into ``<hub_schema>.hub_notifications`` on the same PostgreSQL
instance (hub app schema, ``VOICE_HUB_SCHEMA``, default ``app``). Idempotent:
INSERT ... WHERE NOT EXISTS keyed by (event_type, entity_id=job_id,
recipient_user_id). Notification failures never affect the job result.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import text

from .config import config
from .db import get_voice_engine

logger = logging.getLogger("voice-server")

HUB_SCHEMA = str(os.getenv("VOICE_HUB_SCHEMA", "app") or "app").strip() or "app"
EVENT_TYPE = "voice.protocol_ready"
ENTITY_TYPE = "voice_meeting"


def _resolve_recipient(conn, actor: str) -> Optional[int]:
    row = conn.execute(
        text(
            f"SELECT id FROM {HUB_SCHEMA}.users "
            "WHERE is_active AND (username = :v OR email = :v OR full_name = :v) "
            "ORDER BY (username = :v) DESC, id LIMIT 1"
        ),
        {"v": actor},
    ).first()
    return int(row[0]) if row else None


def notify_protocol_ready(job: Dict[str, Any]) -> None:
    """Insert a bell notification for the job owner; dedupe by job id."""
    actor = str(job.get("created_by") or "").strip()
    if not actor:
        return
    base = str(job.get("base_filename") or "").strip()
    job_id = str(job.get("id") or "").strip()
    if not job_id:
        return
    try:
        engine = get_voice_engine(config.database_url)
        with engine.begin() as conn:
            recipient = _resolve_recipient(conn, actor)
            if recipient is None:
                logger.info("notify: no hub user for actor %r (job %s)", actor, job_id)
                return
            title = "Протокол готов"
            body = base or "Обработка записи завершена"
            conn.execute(
                text(
                    f"INSERT INTO {HUB_SCHEMA}.hub_notifications "
                    "(id, recipient_user_id, event_type, title, body, entity_type, entity_id, created_at) "
                    "SELECT :id, :uid, :etype, :title, :body, :ent, :eid, :ts "
                    f"WHERE NOT EXISTS ("
                    f"    SELECT 1 FROM {HUB_SCHEMA}.hub_notifications "
                    "    WHERE event_type = :etype AND entity_id = :eid AND recipient_user_id = :uid"
                    ")"
                ),
                {
                    "id": uuid.uuid4().hex,
                    "uid": recipient,
                    "etype": EVENT_TYPE,
                    "title": title,
                    "body": body,
                    "ent": ENTITY_TYPE,
                    "eid": job_id,
                    "ts": datetime.now(timezone.utc).isoformat(),
                },
            )
        logger.info("notify: protocol-ready queued for user=%s job=%s", recipient, job_id)
    except Exception:
        logger.warning("notify: failed for job %s", job_id, exc_info=True)
