"""Central OpenRouter LLM gateway for HUB-IT."""
from __future__ import annotations

import base64
import json
import logging
import os
import random
import re
import time
from typing import Any, Optional, Union

from shared.llm.env import (
    DEFAULT_AI_MODEL,
    DEFAULT_OPENROUTER_BASE_URL,
    normalize_openrouter_base_url,
    read_env,
)
from shared.llm.errors import OpenRouterClientError
from shared.llm.models import resolve_model

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None


logger = logging.getLogger(__name__)

JSON_RETRYABLE_ERROR_MARKERS = (
    "response_format",
    "json_schema",
    "schema",
    "structured",
    "plugin",
    "response-healing",
    "unsupported",
    "not supported",
    "invalid parameter",
    "bad request",
)
TRANSIENT_ERROR_MARKERS = (
    "timeout",
    "timed out",
    "connection",
    "connect",
    "rate limit",
    "rate_limit",
    "429",
    "502",
    "503",
    "504",
    "bad gateway",
    "service unavailable",
    "gateway timeout",
    "temporarily",
    "internal server error",
    "500",
    "read timeout",
    "remote disconnected",
    "incomplete read",
)
IMAGE_UNSUPPORTED_MARKERS = (
    "support image input",
    "does not support vision",
    "doesn't support vision",
    "vision not supported",
    "multimodal",
    "unsupported content type",
    "image input",
    "images are not supported",
)
DEFAULT_MAX_TRANSIENT_RETRIES = int(os.environ.get("AI_OPENROUTER_MAX_RETRIES", "3"))
DEFAULT_RETRY_BASE_DELAY_SEC = float(os.environ.get("AI_OPENROUTER_RETRY_BASE_DELAY", "0.8"))
DEFAULT_RETRY_MAX_DELAY_SEC = float(os.environ.get("AI_OPENROUTER_RETRY_MAX_DELAY", "8.0"))

UserContent = Union[str, list[dict[str, Any]]]


def _extract_completion_text(completion: Any) -> str:
    try:
        message = completion.choices[0].message
    except Exception:
        return ""
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text") or item.get("content")
            else:
                text = getattr(item, "text", None) or getattr(item, "content", None)
            if text:
                parts.append(str(text))
        return "\n".join(parts).strip()
    return str(content or "").strip()


def _extract_json_payload(text: str) -> dict[str, Any]:
    normalized = str(text or "").strip()
    if not normalized:
        return {}
    wrapped = re.match(r"^```(?:json)?\s*([\s\S]*?)```$", normalized, flags=re.IGNORECASE)
    if wrapped:
        normalized = str(wrapped.group(1) or "").strip()
    try:
        payload = json.loads(normalized)
        return payload if isinstance(payload, dict) else {}
    except Exception as exc:
        start = normalized.find("{")
        end = normalized.rfind("}")
        if 0 <= start < end:
            candidate = normalized[start : end + 1]
            try:
                payload = json.loads(candidate)
                if isinstance(payload, dict):
                    return payload
            except Exception:
                pass
            try:
                cleaned = re.sub(r",\s*([}\]])", r"\1", candidate)
                payload = json.loads(cleaned)
                if isinstance(payload, dict):
                    return payload
            except Exception:
                pass
        raise OpenRouterClientError("LLM returned invalid JSON payload.") from exc


def _is_json_mode_retryable_error(exc: Exception) -> bool:
    text = str(exc or "").lower()
    return any(marker in text for marker in JSON_RETRYABLE_ERROR_MARKERS)


def _is_transient_error(exc: Exception) -> bool:
    text = str(exc or "").lower()
    if any(marker in text for marker in TRANSIENT_ERROR_MARKERS):
        return True
    if re.search(r"\b(?:5\d{2}|429)\b", text):
        return True
    return False


def is_image_unsupported_error(exc: BaseException | None) -> bool:
    """Detect provider errors that mean the model cannot accept image/vision input."""
    parts: list[str] = []
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        parts.append(str(current or ""))
        current = current.__cause__ or current.__context__
    text = " ".join(parts).lower()
    return any(marker in text for marker in IMAGE_UNSUPPORTED_MARKERS)


def provider_error_text(exc: BaseException | None) -> str:
    """Best-effort provider message for UI/warnings (prefer __cause__)."""
    if exc is None:
        return ""
    cause = getattr(exc, "__cause__", None)
    if cause is not None:
        text = str(cause).strip()
        if text:
            return text
    return str(exc).strip()


def _wrap_openrouter_error(exc: Exception) -> OpenRouterClientError:
    detail = str(exc).strip() or "unknown error"
    err = OpenRouterClientError(f"Failed to call OpenRouter: {detail}")
    err.__cause__ = exc
    return err


def _retry_delay_seconds(attempt_index: int) -> float:
    base = max(0.05, DEFAULT_RETRY_BASE_DELAY_SEC) * (2 ** max(0, attempt_index - 1))
    capped = min(DEFAULT_RETRY_MAX_DELAY_SEC, base)
    jitter = random.uniform(0.0, max(0.05, capped * 0.2))
    return capped + jitter


def _build_response_format(
    *,
    response_schema: dict[str, Any] | None,
    schema_name: str,
    strict_json_schema: bool,
) -> dict[str, Any]:
    schema = response_schema if isinstance(response_schema, dict) and response_schema else None
    if not schema:
        return {"type": "json_object"}
    return {
        "type": "json_schema",
        "json_schema": {
            "name": str(schema_name or "ai_chat_response").strip() or "ai_chat_response",
            "strict": bool(strict_json_schema),
            "schema": schema,
        },
    }


def _usage_dict(completion: Any, *, model: str) -> dict[str, Any]:
    usage = getattr(completion, "usage", None)
    return {
        "model": model,
        "prompt_tokens": int(getattr(usage, "prompt_tokens", 0) or 0),
        "completion_tokens": int(getattr(usage, "completion_tokens", 0) or 0),
        "total_tokens": int(getattr(usage, "total_tokens", 0) or 0),
    }


def _normalize_user_content(user_prompt: str = "", user_content: UserContent | None = None) -> UserContent:
    if user_content is not None:
        return user_content
    return str(user_prompt or "").strip()


class OpenRouterClient:
    def __init__(self, *, request_timeout_sec: float = 45.0) -> None:
        self.request_timeout_sec = float(request_timeout_sec)
        self._cached_client: Any = None
        self._cached_client_key: tuple[str, str, float] | None = None

    def is_configured(self) -> bool:
        return bool(self._resolve_api_key())

    def get_status(self) -> dict[str, Any]:
        return {
            "configured": self.is_configured(),
            "base_url": self._resolve_base_url(),
            "default_model": self._resolve_default_model(),
        }

    def _resolve_api_key(self) -> str:
        return str(read_env("OPENROUTER_API_KEY") or read_env("OPENAI_API_KEY") or "").strip()

    def _resolve_base_url(self) -> str:
        return normalize_openrouter_base_url(read_env("OPENROUTER_BASE_URL", DEFAULT_OPENROUTER_BASE_URL))

    def _resolve_default_model(self) -> str:
        return resolve_model("chat", default=DEFAULT_AI_MODEL)

    def _resolve_timeout(self, timeout: float | None) -> float:
        if timeout is None:
            return float(self.request_timeout_sec)
        return float(timeout)

    def _build_client(self, *, timeout: float | None = None):
        if OpenAI is None:
            raise OpenRouterClientError("openai package is not installed.")
        api_key = self._resolve_api_key()
        if not api_key:
            raise OpenRouterClientError("OPENROUTER_API_KEY is not configured.")
        base_url = self._resolve_base_url()
        resolved_timeout = self._resolve_timeout(timeout)
        cache_key = (api_key, base_url, resolved_timeout)
        if self._cached_client is not None and self._cached_client_key == cache_key:
            return self._cached_client
        client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=resolved_timeout,
        )
        self._cached_client = client
        self._cached_client_key = cache_key
        return client

    def _with_transient_retry(self, *, model: str, call):
        last_exc: Exception | None = None
        attempts = max(1, DEFAULT_MAX_TRANSIENT_RETRIES)
        for attempt in range(1, attempts + 1):
            try:
                return call()
            except Exception as exc:
                last_exc = exc
                if not _is_transient_error(exc) or attempt >= attempts:
                    raise
                delay = _retry_delay_seconds(attempt)
                logger.warning(
                    "OpenRouter transient error; retrying in %.2fs: model=%s attempt=%s/%s error=%s",
                    delay,
                    model,
                    attempt,
                    attempts,
                    exc,
                )
                time.sleep(delay)
        if last_exc is not None:
            raise last_exc
        raise OpenRouterClientError("Failed to call OpenRouter (no response).")

    def complete_text(
        self,
        *,
        system_prompt: str = "",
        user_prompt: str = "",
        user_content: UserContent | None = None,
        model: str = "",
        purpose: str = "chat",
        temperature: float = 0.2,
        max_tokens: int = 2000,
        timeout: float | None = None,
    ) -> tuple[str, dict[str, Any]]:
        client = self._build_client(timeout=timeout)
        resolved_model = str(model or "").strip() or resolve_model(purpose)
        content = _normalize_user_content(user_prompt, user_content)
        messages: list[dict[str, Any]] = []
        system = str(system_prompt or "").strip()
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": content})

        def _request():
            return client.chat.completions.create(
                model=resolved_model,
                temperature=float(temperature),
                max_tokens=int(max_tokens),
                messages=messages,
            )

        try:
            completion = self._with_transient_retry(model=resolved_model, call=_request)
        except Exception as exc:
            logger.warning("OpenRouter text completion failed: model=%s error=%s", resolved_model, exc)
            raise _wrap_openrouter_error(exc)
        text = _extract_completion_text(completion)
        return text, _usage_dict(completion, model=resolved_model)

    def complete_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str = "",
        user_content: UserContent | None = None,
        model: str = "",
        purpose: str = "chat",
        temperature: float = 0.2,
        max_tokens: int = 2000,
        response_schema: dict[str, Any] | None = None,
        schema_name: str = "ai_chat_response",
        strict_json_schema: bool = True,
        response_healing: bool = True,
        timeout: float | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        client = self._build_client(timeout=timeout)
        resolved_model = str(model or "").strip() or resolve_model(purpose)
        content = _normalize_user_content(user_prompt, user_content)

        def _request(*, use_schema: bool, use_response_healing: bool):
            request_kwargs: dict[str, Any] = {
                "model": resolved_model,
                "temperature": float(temperature),
                "max_tokens": int(max_tokens),
                "response_format": _build_response_format(
                    response_schema=response_schema if use_schema else None,
                    schema_name=schema_name,
                    strict_json_schema=strict_json_schema,
                ),
                "messages": [
                    {"role": "system", "content": str(system_prompt or "").strip()},
                    {"role": "user", "content": content},
                ],
            }
            if use_response_healing:
                request_kwargs["extra_body"] = {"plugins": [{"id": "response-healing"}]}
            return client.chat.completions.create(**request_kwargs)

        def _request_with_transient_retry(*, use_schema: bool, use_response_healing: bool):
            return self._with_transient_retry(
                model=resolved_model,
                call=lambda: _request(use_schema=use_schema, use_response_healing=use_response_healing),
            )

        try:
            completion = _request_with_transient_retry(
                use_schema=bool(response_schema),
                use_response_healing=bool(response_healing),
            )
        except Exception as exc:
            if (bool(response_schema) or bool(response_healing)) and _is_json_mode_retryable_error(exc):
                logger.warning(
                    "OpenRouter strict JSON mode failed; retrying with json_object: model=%s error=%s",
                    resolved_model,
                    exc,
                )
                try:
                    completion = _request_with_transient_retry(use_schema=False, use_response_healing=False)
                except Exception as fallback_exc:
                    logger.warning("OpenRouter completion failed: model=%s error=%s", resolved_model, fallback_exc)
                    raise _wrap_openrouter_error(fallback_exc)
            else:
                logger.warning("OpenRouter completion failed: model=%s error=%s", resolved_model, exc)
                raise _wrap_openrouter_error(exc)
        if completion is None:
            logger.warning("OpenRouter completion returned no response: model=%s", resolved_model)
            raise OpenRouterClientError("Failed to call OpenRouter: empty response.")
        payload = _extract_json_payload(_extract_completion_text(completion))
        return payload, _usage_dict(completion, model=resolved_model)

    def complete_vision(
        self,
        *,
        image_bytes: bytes | None = None,
        mime_type: str = "image/png",
        image_data_url: str = "",
        prompt: str = "",
        system_prompt: str | None = None,
        model: str = "",
        purpose: str = "ocr",
        temperature: float = 0.0,
        max_tokens: int = 1800,
        timeout: float | None = None,
    ) -> tuple[str, dict[str, Any]]:
        data_url = str(image_data_url or "").strip()
        if not data_url:
            encoded = base64.b64encode(bytes(image_bytes or b"")).decode("ascii")
            data_url = f"data:{str(mime_type or 'image/png').strip()};base64,{encoded}"
        user_content: list[dict[str, Any]] = [
            {
                "type": "text",
                "text": str(prompt or "").strip()
                or "Extract the full readable text from this image. Return plain text only.",
            },
            {"type": "image_url", "image_url": {"url": data_url}},
        ]
        if system_prompt is None:
            resolved_system = "You perform OCR. Return only the extracted text."
        else:
            resolved_system = str(system_prompt).strip()
        return self.complete_text(
            system_prompt=resolved_system,
            user_content=user_content,
            model=model,
            purpose=purpose,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
        )

    def extract_image_text(self, *, image_bytes: bytes, mime_type: str, prompt: str = "") -> str:
        try:
            text, _usage = self.complete_vision(
                image_bytes=image_bytes,
                mime_type=mime_type,
                prompt=prompt,
                purpose="ocr",
            )
            return text
        except OpenRouterClientError as exc:
            logger.warning("AI image OCR failed: error=%s", exc)
            return ""


openrouter_client = OpenRouterClient()
