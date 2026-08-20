from __future__ import annotations

import logging
import re
import sys
from pathlib import Path
from typing import Any

_MONOREPO_ROOT = Path(__file__).resolve().parents[3]
if str(_MONOREPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_MONOREPO_ROOT))

from shared.llm import OpenRouterClientError, openrouter_client, resolve_model

from backend.services.mail_ai_privacy import (
    UNTRUSTED_EMAIL_SYSTEM_RULE,
    MailAiDisabledError,
    MailAiRateLimitedError,
    consume_mail_ai_rate_limit,
    record_mail_ai_call,
    redact_mail_ai_text,
    require_mail_ai_enabled,
)

logger = logging.getLogger(__name__)

MAX_BODY_CHARS = 6000
MAX_SUBJECT_CHARS = 300
SMART_REPLIES_MODEL = "deepseek/deepseek-v4-flash-0731"

SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
    },
    "required": ["summary"],
    "additionalProperties": False,
}

SMART_REPLIES_SCHEMA = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "maxItems": 3,
        },
    },
    "required": ["suggestions"],
    "additionalProperties": False,
}


class MailAiServiceError(Exception):
    def __init__(self, message: str, *, code: str = "MAIL_AI_ERROR", status_code: int = 400) -> None:
        super().__init__(message)
        self.code = str(code or "MAIL_AI_ERROR")
        self.status_code = int(status_code or 400)


def require_mail_ai_access(*, user_id: int) -> None:
    try:
        require_mail_ai_enabled()
        consume_mail_ai_rate_limit(int(user_id))
    except MailAiDisabledError as exc:
        raise MailAiServiceError(str(exc), code=exc.code, status_code=exc.status_code) from exc
    except MailAiRateLimitedError as exc:
        raise MailAiServiceError(str(exc), code=exc.code, status_code=exc.status_code) from exc


def _normalize_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    try:
        text = str(value).strip()
    except Exception:
        return default
    return text or default


def _strip_html(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", text).strip()


def _resolve_mail_model() -> str:
    return resolve_model("mail")


def _build_message_prompt(message: dict[str, Any]) -> tuple[str, str]:
    subject = redact_mail_ai_text(_normalize_text(message.get("subject"), "(без темы)"))[:MAX_SUBJECT_CHARS]
    body_text = _normalize_text(message.get("body_text"))
    if not body_text:
        body_text = _strip_html(_normalize_text(message.get("body_html") or message.get("body")))
    body_text = redact_mail_ai_text(body_text)[:MAX_BODY_CHARS]
    sender_person = message.get("sender_person") if isinstance(message.get("sender_person"), dict) else {}
    sender = redact_mail_ai_text(
        _normalize_text(
            sender_person.get("display")
            or message.get("sender_display")
            or message.get("sender_email")
            or message.get("sender"),
            "-",
        )
    )
    user_prompt = (
        f"Subject: {subject}\n"
        f"From: {sender}\n"
        f"Body:\n{body_text or '(empty)'}"
    )
    return subject, user_prompt


def _extract_summary(payload: dict[str, Any] | None) -> str:
    if not isinstance(payload, dict):
        return ""
    for key in ("summary", "text", "message", "content"):
        value = _normalize_text(payload.get(key))
        if value:
            return value
    return ""


class MailAiService:
    def _complete_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        response_schema: dict[str, Any],
        schema_name: str,
        max_tokens: int,
        temperature: float,
        model: str | None = None,
        thinking: bool | None = None,
    ) -> dict[str, Any]:
        resolved_model = model or _resolve_mail_model()
        request_kwargs: dict[str, Any] = {
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "purpose": "mail",
            "temperature": temperature,
            "max_tokens": max_tokens,
            "response_schema": response_schema,
            "schema_name": schema_name,
            "response_healing": False,
        }
        if resolved_model:
            request_kwargs["model"] = resolved_model
        if thinking is not None:
            request_kwargs["thinking"] = thinking
        payload, _usage = openrouter_client.complete_json(**request_kwargs)
        return payload if isinstance(payload, dict) else {}

    def summarize_message(self, message: dict[str, Any]) -> dict[str, str]:
        if not openrouter_client.is_configured():
            raise MailAiServiceError("AI не настроен: проверьте ROUTERAI_API_KEY в .env и перезапустите backend.")
        _subject, user_prompt = _build_message_prompt(message)
        record_mail_ai_call(chars=len(user_prompt))
        try:
            payload = self._complete_json(
                system_prompt=(
                    "You summarize business emails in Russian. "
                    "Return JSON only: {\"summary\": \"...\"}. "
                    "Keep the summary concise (2-4 sentences), factual, no markdown. "
                    + UNTRUSTED_EMAIL_SYSTEM_RULE
                ),
                user_prompt=user_prompt,
                temperature=0.2,
                max_tokens=400,
                response_schema=SUMMARY_SCHEMA,
                schema_name="mail_message_summary",
            )
        except OpenRouterClientError as exc:
            logger.warning("Mail summarize failed: %s", exc)
            raise MailAiServiceError(str(exc) or "Не удалось получить пересказ от AI.") from exc
        summary = _extract_summary(payload)
        if not summary:
            raise MailAiServiceError("AI вернул пустой пересказ.")
        return {"summary": summary}

    def smart_replies(self, message: dict[str, Any]) -> dict[str, list[str]]:
        if not openrouter_client.is_configured():
            raise MailAiServiceError("AI не настроен: проверьте ROUTERAI_API_KEY в .env и перезапустите backend.")
        _subject, user_prompt = _build_message_prompt(message)
        record_mail_ai_call(chars=len(user_prompt))
        try:
            payload = self._complete_json(
                system_prompt=(
                    "You generate short Russian email quick replies. "
                    "Return JSON only: {\"suggestions\": [\"...\", \"...\"]}. "
                    "Each suggestion must be one short sentence suitable as a draft the user can edit. "
                    "Do not assume the draft will be sent immediately. "
                    + UNTRUSTED_EMAIL_SYSTEM_RULE
                ),
                user_prompt=user_prompt,
                temperature=0.4,
                max_tokens=512,
                response_schema=SMART_REPLIES_SCHEMA,
                schema_name="mail_smart_replies",
                model=SMART_REPLIES_MODEL,
                thinking=False,
            )
        except OpenRouterClientError as exc:
            logger.warning("Mail smart replies failed: %s", exc)
            raise MailAiServiceError(str(exc) or "Не удалось получить подсказки от AI.") from exc
        raw = (payload or {}).get("suggestions") or []
        suggestions = [
            item[:180]
            for item in (_normalize_text(value) for value in raw)
            if item
        ][:3]
        if not suggestions:
            raise MailAiServiceError("AI не вернул варианты быстрого ответа.")
        return {"suggestions": suggestions}


mail_ai_service = MailAiService()
