"""
Service for converting plain text into Markdown using OpenRouter.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Optional

from backend.ai_chat.openrouter_client import OpenRouterClientError, openrouter_client, resolve_model


logger = logging.getLogger(__name__)


class MarkdownTransformConfigError(RuntimeError):
    """Raised when LLM configuration is incomplete or unavailable."""


class MarkdownTransformError(RuntimeError):
    """Raised when LLM request fails or returns invalid payload."""


def _to_int(value: Any) -> Optional[int]:
    try:
        if value in (None, "", "null"):
            return None
        return int(value)
    except Exception:
        return None


def _cleanup_markdown_wrapper(text: str) -> str:
    normalized = str(text or "").strip()
    if not normalized:
        return ""
    wrapped = re.match(r"^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$", normalized, flags=re.IGNORECASE)
    if wrapped:
        return str(wrapped.group(1) or "").strip()
    return normalized


class MarkdownTransformService:
    def __init__(self, *, request_timeout_sec: float = 20.0) -> None:
        self.request_timeout_sec = float(request_timeout_sec)

    def transform_text(self, *, text: str, context: str) -> dict[str, Any]:
        normalized_text = str(text or "").strip()
        normalized_context = str(context or "").strip().lower()

        if len(normalized_text) < 3:
            raise ValueError("Текст слишком короткий для преобразования.")
        if len(normalized_text) > 20000:
            raise ValueError("Текст слишком большой. Максимум 20000 символов.")
        if normalized_context not in {"announcement", "task"}:
            raise ValueError("Неверный context. Допустимо: announcement или task.")

        if not openrouter_client.is_configured():
            raise MarkdownTransformConfigError("OPENROUTER_API_KEY не задан.")

        model = resolve_model("markdown")

        if normalized_context == "announcement":
            context_emoji_rule = (
                "For announcement context, keep emoji usage neutral and sparse. "
                "Use emoji only for light structure accents when helpful (for example pin/info/check style accents)."
            )
        else:
            context_emoji_rule = (
                "For task context, use emoji only for functional highlights such as status or deadline emphasis "
                "(for example warning/check/clock style accents) when it improves scanability."
            )

        system_prompt = (
            "Convert user text into clean Markdown. "
            "Do not change facts or meaning. "
            "Improve readability with headings, lists, checklists, and tables only when appropriate. "
            "Emoji policy is moderate: use at most one emoji per heading or meaningful block, "
            "do not add emoji to every line or every bullet, and keep a professional tone. "
            "If text is short or formal, emoji may be omitted entirely. "
            f"{context_emoji_rule} "
            "Return only final Markdown without explanations."
        )
        user_prompt = (
            f"Context: {normalized_context}\n"
            "Requirements:\n"
            "- Preserve the original language.\n"
            "- Do not add new information.\n"
            "- Keep names, numbers, and dates accurate.\n"
            "- Emoji mode: moderate.\n\n"
            "Source text:\n"
            f"{normalized_text}"
        )

        try:
            markdown_raw, usage = openrouter_client.complete_text(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model=model,
                purpose="markdown",
                temperature=0.2,
                max_tokens=3000,
                timeout=self.request_timeout_sec,
            )
        except OpenRouterClientError as exc:
            logger.warning("Markdown transform request failed: context=%s error=%s", normalized_context, exc)
            raise MarkdownTransformError("Не удалось обратиться к LLM для преобразования текста.") from exc

        markdown = _cleanup_markdown_wrapper(markdown_raw)
        if not markdown:
            raise MarkdownTransformError("LLM вернул пустой ответ.")

        usage_payload = {
            "prompt_tokens": _to_int(usage.get("prompt_tokens")),
            "completion_tokens": _to_int(usage.get("completion_tokens")),
            "total_tokens": _to_int(usage.get("total_tokens")),
        }
        usage_payload = {k: v for k, v in usage_payload.items() if v is not None}

        logger.info(
            "Markdown transform done: context=%s model=%s input_len=%s output_len=%s",
            normalized_context,
            model,
            len(normalized_text),
            len(markdown),
        )
        return {
            "markdown": markdown,
            "provider": "openrouter",
            "model": model,
            "usage": usage_payload,
        }


markdown_transform_service = MarkdownTransformService()
