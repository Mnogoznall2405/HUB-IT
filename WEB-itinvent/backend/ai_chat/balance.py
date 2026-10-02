"""AG: provider balance warning.

Decision of the user (section 26): no per-employee limits, only a warning.
- the AI worker checks the provider balance on a schedule (flag AI_BALANCE_CHECK_ENABLED, off by default);
- balance below the threshold -> a notification to the AI managers (settings.ai.manage / admins)
  and a line in the AI settings; repeated at most once per cooldown while it stays low;
- an HTTP 402 in a run -> the same managers are told (throttled), the employee sees a clear text.

State is one JSON document in app.app_settings (key ``ai.balance``): no new tables, no new services.
Nothing here logs prompts, answers, keys or the provider response.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from sqlalchemy import select

from backend.appdb.db import app_session
from backend.appdb.models import AppGlobalSetting, AppUser
from backend.services.authorization_service import PERM_SETTINGS_AI_MANAGE, has_permission

logger = logging.getLogger(__name__)

BALANCE_STATE_KEY = "ai.balance"
BALANCE_EVENT_TYPE = "ai.balance"
LOW_BALANCE_REPEAT_SEC = 24 * 3600
INSUFFICIENT_FUNDS_REPEAT_SEC = 3600
INSUFFICIENT_FUNDS_USER_TEXT = "ИИ временно недоступен, администраторы уведомлены. Попробуйте позже."


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _number(value: object) -> Optional[float]:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if number == number and number not in (float("inf"), float("-inf")) else None


def parse_balance(payload: object) -> Optional[float]:
    """Remaining balance from the provider's /credits answer (OpenRouter-compatible shapes):
    {"data": {"total_credits": 10, "total_usage": 3}} -> 7, {"balance": 7} -> 7."""
    if not isinstance(payload, dict):
        return None
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    for key in ("balance", "credits", "available", "remaining"):
        value = _number(data.get(key))
        if value is not None:
            return value
    total = _number(data.get("total_credits"))
    if total is not None:
        return total - (_number(data.get("total_usage")) or 0.0)
    return None


def _default_threshold() -> float:
    return max(0.0, _number(os.environ.get("AI_BALANCE_WARN_THRESHOLD")) or 0.0)


def _default_credits_provider() -> dict[str, Any]:
    from backend.ai_chat.openrouter_client import openrouter_client

    return openrouter_client.get_credits()


class AiBalanceService:
    def __init__(self, *, credits_provider: Optional[Callable[[], dict[str, Any]]] = None) -> None:
        self._credits_provider = credits_provider or _default_credits_provider

    # -- state -----------------------------------------------------------------------------
    def _load(self) -> dict[str, Any]:
        with app_session() as session:
            row = session.get(AppGlobalSetting, BALANCE_STATE_KEY)
            raw = getattr(row, "value_json", None) if row is not None else None
        try:
            value = json.loads(raw) if raw else {}
        except (TypeError, ValueError):
            value = {}
        return value if isinstance(value, dict) else {}

    def _save(self, state: dict[str, Any]) -> None:
        text = json.dumps(state, ensure_ascii=False)
        with app_session() as session:
            row = session.get(AppGlobalSetting, BALANCE_STATE_KEY)
            if row is None:
                session.add(AppGlobalSetting(key=BALANCE_STATE_KEY, value_json=text, updated_at=_utc_now()))
            else:
                row.value_json = text
                row.updated_at = _utc_now()

    def get_state(self) -> dict[str, Any]:
        state = self._load()
        threshold = _number(state.get("threshold"))
        if threshold is None:
            threshold = _default_threshold()
        balance = _number(state.get("balance"))
        return {
            "balance": balance,
            "threshold": threshold,
            "low": bool(threshold > 0 and balance is not None and balance < threshold),
            "status": str(state.get("status") or "unknown"),
            "checked_at": state.get("checked_at"),
            "alerted_at": state.get("alerted_at"),
            "error": state.get("error"),
            "check_enabled": os.environ.get("AI_BALANCE_CHECK_ENABLED", "0").strip().lower() in {"1", "true", "yes", "on"},
        }

    def set_threshold(self, threshold: object) -> dict[str, Any]:
        value = _number(threshold)
        if value is None or value < 0:
            raise ValueError("Порог должен быть числом не меньше 0")
        state = self._load()
        state["threshold"] = value
        state["alerted_at"] = None  # a new threshold is judged afresh
        self._save(state)
        return self.get_state()

    # -- checks ----------------------------------------------------------------------------
    def check(self, *, notify: bool = True) -> dict[str, Any]:
        """Ask the provider for the balance, store the result, warn the managers when it is low."""
        state = self._load()
        now = _utc_now()
        try:
            balance = parse_balance(self._credits_provider())
        except Exception as exc:  # network / auth / unsupported provider: keep the last balance
            state["status"] = "error"
            state["error"] = str(exc)[:200]
            state["checked_at"] = now.isoformat()
            self._save(state)
            logger.warning("AI balance check failed: %s", type(exc).__name__)
            return self.get_state()
        state["checked_at"] = now.isoformat()
        state["error"] = None
        if balance is None:
            state["status"] = "unknown"
            self._save(state)
            return self.get_state()
        state["balance"] = balance
        state["status"] = "ok"
        threshold = _number(state.get("threshold"))
        if threshold is None:
            threshold = _default_threshold()
        low = threshold > 0 and balance < threshold
        if low:
            state["status"] = "low"
            alerted_at = self._parse_time(state.get("alerted_at"))
            if notify and (alerted_at is None or (now - alerted_at).total_seconds() >= LOW_BALANCE_REPEAT_SEC):
                if self._notify_managers(
                    title="Баланс ИИ ниже порога",
                    body=f"Остаток {balance:g} при пороге {threshold:g}. Пополните баланс провайдера.",
                ):
                    state["alerted_at"] = now.isoformat()
        else:
            state["alerted_at"] = None
        self._save(state)
        return self.get_state()

    def report_insufficient_funds(self) -> bool:
        """A run failed with 402: tell the managers (at most once per hour). True if notified."""
        state = self._load()
        now = _utc_now()
        last = self._parse_time(state.get("insufficient_notified_at"))
        if last is not None and (now - last).total_seconds() < INSUFFICIENT_FUNDS_REPEAT_SEC:
            return False
        sent = self._notify_managers(
            title="ИИ недоступен: не хватает средств",
            body="Провайдер ИИ ответил «недостаточно средств» (402). Пополните баланс.",
        )
        if sent:
            state["insufficient_notified_at"] = now.isoformat()
            state["status"] = "low"
            self._save(state)
        return sent

    # -- helpers ---------------------------------------------------------------------------
    @staticmethod
    def _parse_time(value: object) -> Optional[datetime]:
        if not value:
            return None
        try:
            parsed = datetime.fromisoformat(str(value))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

    @staticmethod
    def manager_user_ids() -> list[int]:
        """Active admins and users holding settings.ai.manage (custom permissions respected)."""
        ids: list[int] = []
        with app_session() as session:
            rows = list(session.execute(select(AppUser).where(AppUser.is_active.is_(True))).scalars())
            for user in rows:
                if user.role == "admin":
                    ids.append(int(user.id))
                    continue
                try:
                    custom = json.loads(user.custom_permissions_json or "[]")
                except (TypeError, ValueError):
                    custom = []
                if has_permission(
                    user.role,
                    PERM_SETTINGS_AI_MANAGE,
                    use_custom_permissions=bool(user.use_custom_permissions),
                    custom_permissions=custom if isinstance(custom, list) else [],
                ):
                    ids.append(int(user.id))
        return ids

    def _notify_managers(self, *, title: str, body: str) -> bool:
        recipients = self.manager_user_ids()
        if not recipients:
            return False
        try:
            from backend.services.hub_service import hub_service

            hub_service.create_notifications_batch([
                {
                    "recipient_user_id": user_id,
                    "event_type": BALANCE_EVENT_TYPE,
                    "title": title,
                    "body": body,
                    "entity_type": "ai_settings",
                    "entity_id": "balance",
                }
                for user_id in recipients
            ])
        except Exception:
            logger.exception("AI balance notification failed")
            return False
        return True


ai_balance_service = AiBalanceService()
