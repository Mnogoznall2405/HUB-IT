"""Morning IT digest posted by the AI assistant (flag AI_IT_DIGEST_ENABLED, off by default).

Once a day, after AI_IT_DIGEST_HOUR (server local time), the AI worker builds a short
read-only summary for each employee in AI_IT_DIGEST_USER_IDS and posts it into that
employee's dialog with the assistant bot. Every section is collected with the recipient's
own portal permissions through the regular tool registry, so the digest never shows more
than the employee could ask the assistant for.

Single run per day across processes: the day is claimed by a compare-and-set on one JSON
document in app.app_settings (key ``ai.it_digest``) before anything is built; a crashed
attempt is not repeated the same day. No new tables, no new services, no LLM calls.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from sqlalchemy import update

from backend.appdb.db import app_session
from backend.appdb.models import AppGlobalSetting

logger = logging.getLogger(__name__)

DIGEST_STATE_KEY = "ai.it_digest"
SECTION_ROWS = 5


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _env_flag(name: str, default: bool = False) -> bool:
    raw = _normalize_text(os.environ.get(name, "1" if default else "0")).lower()
    return raw in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(_normalize_text(os.environ.get(name)) or default)
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def digest_settings() -> dict[str, Any]:
    user_ids: list[int] = []
    for part in _normalize_text(os.environ.get("AI_IT_DIGEST_USER_IDS")).replace(";", ",").split(","):
        try:
            value = int(part.strip())
        except ValueError:
            continue
        if value > 0 and value not in user_ids:
            user_ids.append(value)
    return {
        "enabled": _env_flag("AI_IT_DIGEST_ENABLED", False),
        "dry_run": _env_flag("AI_IT_DIGEST_DRY_RUN", False),
        "hour": _env_int("AI_IT_DIGEST_HOUR", 8, 0, 23),
        "weekdays_only": _env_flag("AI_IT_DIGEST_WEEKDAYS_ONLY", True),
        "bot_id": _normalize_text(os.environ.get("AI_IT_DIGEST_BOT_ID")) or None,
        "user_ids": user_ids,
    }


# ------------------------------------------------------------------ sections


def _rows(items: list[Any], render: Callable[[dict[str, Any]], str]) -> list[str]:
    lines = []
    for item in list(items or [])[:SECTION_ROWS]:
        if isinstance(item, dict):
            text = _normalize_text(render(item))
            if text:
                lines.append(f"- {text}")
    return lines


def _more(total: int) -> list[str]:
    return [f"- …и ещё {total - SECTION_ROWS}"] if total > SECTION_ROWS else []


def _section_ad(data: dict[str, Any]) -> tuple[int, list[str]]:
    users = [item for item in list(data.get("users") or []) if isinstance(item, dict)]
    total = int(data.get("total_found") or len(users))
    lines = _rows(
        users,
        lambda item: f"{_normalize_text(item.get('display_name')) or item.get('login')} — "
        f"{'истёк' if not item.get('days_to_expire') else str(item.get('days_to_expire')) + ' дн.'}",
    )
    return total, lines + _more(total)


def _section_toner(data: dict[str, Any]) -> tuple[int, list[str]]:
    items = [item for item in list(data.get("items") or []) if isinstance(item, dict)]
    total = int(data.get("total") or len(items))

    def _render(item: dict[str, Any]) -> str:
        supplies = ", ".join(
            f"{_normalize_text(row.get('name'))} {row.get('percent')}%"
            for row in list(item.get("low_supplies") or [])[:3]
            if isinstance(row, dict)
        )
        place = _normalize_text(item.get("location") or item.get("branch"))
        return f"{_normalize_text(item.get('model')) or item.get('inv_no')}{' (' + place + ')' if place else ''}: {supplies}"

    return total, _rows(items, _render) + _more(total)


def _section_reboot(data: dict[str, Any]) -> tuple[int, list[str]]:
    items = [item for item in list(data.get("items") or []) if isinstance(item, dict)]
    total = len(items)
    lines = _rows(
        items,
        lambda item: f"{item.get('hostname')}"
        f"{' — ' + _normalize_text(item.get('user')) if item.get('user') else ''}"
        f"{', аптайм ' + str(item.get('uptime_days')) + ' дн.' if item.get('uptime_days') is not None else ''}",
    )
    return total, lines + _more(total)


def _section_mailboxes(data: dict[str, Any]) -> tuple[int, list[str]]:
    items = [item for item in list(data.get("items") or []) if isinstance(item, dict)]
    total = int(data.get("total") or len(items))
    lines = _rows(
        items,
        lambda item: f"{_normalize_text(item.get('display_name')) or item.get('email')} — {item.get('used_percent')}%",
    )
    return total, lines + _more(total)


def _section_acts(data: dict[str, Any]) -> tuple[int, list[str]]:
    items = [item for item in list(data.get("items") or []) if isinstance(item, dict)]
    total = int(data.get("total") or len(items))
    lines = _rows(
        items,
        lambda item: f"{item.get('new_employee')} — {item.get('equipment_count')} ед., {item.get('days_open')} дн."
        f"{' (отв. ' + _normalize_text(item.get('responsible')) + ')' if item.get('responsible') else ''}",
    )
    return total, lines + _more(total)


def _section_requests(data: dict[str, Any]) -> tuple[int, list[str]]:
    items = [item for item in list(data.get("items") or []) if isinstance(item, dict)]
    total = int(data.get("total") or len(items))
    lines = _rows(
        items,
        lambda item: f"{item.get('number') or item.get('request_ref')} — {_normalize_text(item.get('initiator'))}, "
        f"срок {item.get('required_date') or '—'}, {_normalize_text(item.get('stage'))}",
    )
    return total, lines + _more(total)


# (title, tool id the employee must be allowed to use, tool args, renderer)
_SECTIONS: tuple[tuple[str, str, dict[str, Any], Callable[[dict[str, Any]], tuple[int, list[str]]]], ...] = (
    ("Пароли AD истекают в ближайшие 3 дня", "ad.users.expiring_soon", {"days_threshold": 3, "limit": 50}, _section_ad),
    ("Заканчивается тонер", "mfu.devices.low_toner", {"threshold_percent": 15, "limit": 30}, _section_toner),
    ("Компьютеры ждут перезагрузки", "itinvent.computers.search", {}, _section_reboot),
    ("Переполненные почтовые ящики", "office.mailbox.quota_report", {"filter": "over_quota", "limit": 50}, _section_mailboxes),
    ("Акты передачи не подписаны больше 3 дней", "itinvent.acts.pending", {"older_than_days": 3, "limit": 50}, _section_acts),
    ("Просроченные ИТ-заявки 1С", "warehouse.it_requests.search", {"overdue_only": True, "limit": 30}, _section_requests),
)


def _pending_reboot_data(context) -> dict[str, Any]:
    """Computers of the employee's scope waiting for a reboot (no dedicated tool: same scope as the page)."""
    from backend.ai_chat.tools.computers import build_computer_view
    from backend.ai_chat.tools.it_reports import _visible_computer_records

    items = []
    for record in _visible_computer_records(context):
        view = build_computer_view(record)
        health = view.get("health") or {}
        if not health.get("pending_reboot"):
            continue
        items.append(
            {
                "hostname": view.get("hostname"),
                "user": view.get("user_full_name") or view.get("current_user"),
                "uptime_days": health.get("uptime_days"),
            }
        )
    items.sort(key=lambda item: -(item.get("uptime_days") or 0))
    return {"items": items}


def build_digest_markdown(*, user_payload: dict[str, Any], bot_id: str = "", now: Optional[datetime] = None) -> Optional[str]:
    """Digest text for one employee, or None when none of the sections is available to them."""
    from backend.ai_chat.tool_permissions import user_can_use_tool
    from backend.ai_chat.tools import ai_tool_registry
    from backend.ai_chat.tools.context import AiToolExecutionContext, resolve_effective_database_id

    moment = now or datetime.now()
    section_tool_ids = [tool_id for _, tool_id, _, _ in _SECTIONS]
    context = AiToolExecutionContext(
        bot_id=_normalize_text(bot_id),
        bot_title="IT digest",
        conversation_id="",
        run_id="it-digest",
        user_id=int(user_payload.get("id") or 0),
        user_payload=user_payload,
        effective_database_id=resolve_effective_database_id(user_payload=user_payload, explicit_database_id=None),
        enabled_tools=section_tool_ids,
        tool_settings={},
        allow_generated_artifacts=False,
    )
    blocks: list[str] = []
    calm: list[str] = []
    for title, tool_id, args, render in _SECTIONS:
        if ai_tool_registry.get(tool_id) is None or not user_can_use_tool(tool_id, user_payload):
            continue
        try:
            if tool_id == "itinvent.computers.search":
                data = _pending_reboot_data(context)
            else:
                result, _ = ai_tool_registry.execute(tool_id=tool_id, raw_args=dict(args), context=context)
                if not result.ok:
                    blocks.append(f"**{title}:** нет данных ({_normalize_text(result.error)[:120] or 'ошибка источника'})")
                    continue
                data = result.data if isinstance(result.data, dict) else {}
            total, lines = render(data)
        except Exception as exc:
            logger.warning("IT digest section failed: section=%s error=%s", tool_id, type(exc).__name__)
            blocks.append(f"**{title}:** нет данных (источник недоступен)")
            continue
        if total <= 0:
            calm.append(title.lower())
            continue
        blocks.append("\n".join([f"**{title}: {total}**", *lines]))
    if not blocks and not calm:
        return None
    parts = [f"## Утренняя сводка IT — {moment.strftime('%d.%m.%Y')}"]
    parts.extend(blocks)
    if calm:
        parts.append("Без замечаний: " + "; ".join(calm) + ".")
    parts.append("_Спросите подробности, например: «покажи все неподписанные акты»._")
    return "\n\n".join(parts)


# ------------------------------------------------------------------ scheduling


class ItDigestService:
    def __init__(self) -> None:
        self._now: Callable[[], datetime] = datetime.now

    def _load(self) -> tuple[Optional[str], dict[str, Any]]:
        with app_session() as session:
            row = session.get(AppGlobalSetting, DIGEST_STATE_KEY)
            raw = getattr(row, "value_json", None) if row is not None else None
        if raw is None:
            return None, {}
        try:
            value = json.loads(raw)
        except (TypeError, ValueError):
            value = {}
        return raw, value if isinstance(value, dict) else {}

    def _claim_day(self, day: str) -> bool:
        """Compare-and-set: only one process wins the day, even with several workers."""
        raw, state = self._load()
        if _normalize_text(state.get("last_date")) == day:
            return False
        new_state = {**state, "last_date": day, "status": "running", "claimed_at": datetime.now(timezone.utc).isoformat()}
        new_raw = json.dumps(new_state, ensure_ascii=False)
        try:
            with app_session() as session:
                if raw is None:
                    session.add(AppGlobalSetting(key=DIGEST_STATE_KEY, value_json=new_raw, updated_at=datetime.now(timezone.utc)))
                    session.flush()
                    return True
                result = session.execute(
                    update(AppGlobalSetting)
                    .where(AppGlobalSetting.key == DIGEST_STATE_KEY, AppGlobalSetting.value_json == raw)
                    .values(value_json=new_raw, updated_at=datetime.now(timezone.utc))
                )
                return int(result.rowcount or 0) == 1
        except Exception:
            # Lost the insert race (primary key) or the database is busy: another process owns the day.
            logger.info("IT digest day claim skipped: day=%s", day)
            return False

    def _finish(self, *, status: str, sent: int, failed: int) -> None:
        _, state = self._load()
        state.update(
            {
                "status": status,
                "sent": sent,
                "failed": failed,
                "finished_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        with app_session() as session:
            row = session.get(AppGlobalSetting, DIGEST_STATE_KEY)
            if row is not None:
                row.value_json = json.dumps(state, ensure_ascii=False)
                row.updated_at = datetime.now(timezone.utc)

    def is_due(self, settings: dict[str, Any], now: datetime) -> bool:
        if not settings.get("enabled") or not settings.get("user_ids"):
            return False
        if settings.get("weekdays_only") and now.weekday() >= 5:
            return False
        return now.hour >= int(settings.get("hour") or 0)

    def run_if_due(self, *, post: Optional[Callable[[str, int, str], None]] = None) -> dict[str, Any]:
        settings = digest_settings()
        now = self._now()
        if not self.is_due(settings, now):
            return {"status": "not_due"}
        day = now.date().isoformat()
        if not self._claim_day(day):
            return {"status": "already_done", "day": day}
        bot_id = settings.get("bot_id") or ""
        deliver = post or _post_to_bot_dialog
        sent = failed = 0
        for user_id in settings["user_ids"]:
            try:
                from backend.services.user_service import user_service

                user_payload = user_service.get_by_id(int(user_id)) or {}
                if not user_payload or not bool(user_payload.get("is_active", True)):
                    continue
                text = build_digest_markdown(user_payload=user_payload, bot_id=bot_id, now=now)
                if not text:
                    continue
                if settings.get("dry_run"):
                    logger.info("IT digest dry-run: user_id=%s chars=%s", user_id, len(text))
                    continue
                deliver(bot_id, int(user_id), text)
                sent += 1
            except Exception as exc:
                failed += 1
                logger.warning("IT digest delivery failed: user_id=%s error=%s", user_id, type(exc).__name__)
        status = "dry_run" if settings.get("dry_run") else ("ok" if not failed else "partial")
        try:
            self._finish(status=status, sent=sent, failed=failed)
        except Exception:
            logger.exception("IT digest state save failed")
        logger.info("IT digest finished: day=%s status=%s sent=%s failed=%s", day, status, sent, failed)
        return {"status": status, "day": day, "sent": sent, "failed": failed}


def _post_to_bot_dialog(bot_id: str, user_id: int, text: str) -> None:
    """Post the digest as the bot into the employee's dialog with it (opened or created like in the UI)."""
    from backend.ai_chat.service import ai_chat_service
    from backend.chat.service import chat_service

    resolved_bot_id = _normalize_text(bot_id) or _normalize_text(ai_chat_service.ensure_default_bot().get("id"))
    conversation = ai_chat_service.open_bot_conversation(bot_id=resolved_bot_id, current_user_id=int(user_id))
    conversation_id = _normalize_text(conversation.get("id"))
    from backend.appdb.models import AppAiBot

    with app_session() as session:
        bot = session.get(AppAiBot, resolved_bot_id)
        bot_user_id = int(getattr(bot, "bot_user_id", 0) or 0) if bot is not None else 0
    if not conversation_id or bot_user_id <= 0:
        raise LookupError("AI bot dialog is not available")
    message = chat_service.send_message(
        current_user_id=int(bot_user_id),
        conversation_id=conversation_id,
        body=text,
        body_format="markdown",
        defer_push_notifications=True,
    )
    ai_chat_service._enqueue_message_side_effects_after_send(
        conversation_id=conversation_id,
        message_id=_normalize_text(message.get("id")),
        message=message,
    )


it_digest_service = ItDigestService()
