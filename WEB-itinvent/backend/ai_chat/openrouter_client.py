from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Optional

from dotenv import dotenv_values

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None


logger = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[3]
ROOT_ENV_PATH = PROJECT_ROOT / ".env"
ROOT_ENV = dotenv_values(str(ROOT_ENV_PATH)) if ROOT_ENV_PATH.exists() else {}
DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_AI_MODEL = "openai/gpt-4o-mini"
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


class OpenRouterClientError(RuntimeError):
    """Raised when OpenRouter interaction fails."""


def _read_env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(name)
    if value not in (None, ""):
        return str(value).strip()
    root_value = ROOT_ENV.get(name)
    if root_value not in (None, ""):
        return str(root_value).strip()
    return default


def normalize_openrouter_base_url(raw_value: Any, default_base_url: str = DEFAULT_OPENROUTER_BASE_URL) -> str:
    raw = str(raw_value or "").strip()
    if not raw:
        return default_base_url
    value = raw.rstrip("/")
    lower = value.lower()
    if lower.endswith("/chat/completions"):
        value = value[: -len("/chat/completions")]
        lower = value.lower()
    elif lower.endswith("/completions"):
        value = value[: -len("/completions")]
        lower = value.lower()
    if lower.endswith("/api"):
        value = f"{value}/v1"
        lower = value.lower()
    if lower.endswith("/v1") and not lower.endswith("/api/v1"):
        value = re.sub(r"/v1$", "", value, flags=re.IGNORECASE)
        value = f"{value}/api/v1"
        lower = value.lower()
    if not lower.endswith("/api/v1"):
        value = f"{value}/api/v1"
    return value


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
            try:
                payload = json.loads(normalized[start : end + 1])
                return payload if isinstance(payload, dict) else {}
            except Exception:
                pass
        raise OpenRouterClientError("LLM returned invalid JSON payload.") from exc


def _is_json_mode_retryable_error(exc: Exception) -> bool:
    text = str(exc or "").lower()
    return any(marker in text for marker in JSON_RETRYABLE_ERROR_MARKERS)


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


class OpenRouterClient:
    def __init__(self, *, request_timeout_sec: float = 45.0) -> None:
        self.request_timeout_sec = float(request_timeout_sec)

    def is_configured(self) -> bool:
        return bool(self._resolve_api_key())

    def get_status(self) -> dict[str, Any]:
        return {
            "configured": self.is_configured(),
            "base_url": self._resolve_base_url(),
            "default_model": self._resolve_default_model(),
        }

    def _resolve_api_key(self) -> str:
        return str(_read_env("OPENROUTER_API_KEY") or _read_env("OPENAI_API_KEY") or "").strip()

    def _resolve_base_url(self) -> str:
        return normalize_openrouter_base_url(_read_env("OPENROUTER_BASE_URL", DEFAULT_OPENROUTER_BASE_URL))

    def _resolve_default_model(self) -> str:
        return (
            _read_env("OPENROUTER_MODEL_CHAT")
            or _read_env("OPENROUTER_MODEL_MARKDOWN")
            or _read_env("ACT_PARSE_MODEL")
            or _read_env("OCR_MODEL")
            or DEFAULT_AI_MODEL
        )

    def _build_client(self):
        if OpenAI is None:
            raise OpenRouterClientError("openai package is not installed.")
        api_key = self._resolve_api_key()
        if not api_key:
            raise OpenRouterClientError("OPENROUTER_API_KEY is not configured.")
        return OpenAI(
            api_key=api_key,
            base_url=self._resolve_base_url(),
            timeout=self.request_timeout_sec,
        )

    def complete_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        model: str = "",
        temperature: float = 0.2,
        max_tokens: int = 2000,
        response_schema: dict[str, Any] | None = None,
        schema_name: str = "ai_chat_response",
        strict_json_schema: bool = True,
        response_healing: bool = True,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        client = self._build_client()
        resolved_model = str(model or "").strip() or self._resolve_default_model()

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
                    {"role": "user", "content": str(user_prompt or "").strip()},
                ],
            }
            if use_response_healing:
                request_kwargs["extra_body"] = {"plugins": [{"id": "response-healing"}]}
            return client.chat.completions.create(**request_kwargs)

        try:
            completion = _request(
                use_schema=bool(response_schema),
                use_response_healing=bool(response_healing),
            )
        except Exception as exc:
            if (bool(response_schema) or bool(response_healing)) and _is_json_mode_retryable_error(exc):
                logger.warning(
                    "AI chat strict JSON mode failed; retrying with json_object: model=%s error=%s",
                    resolved_model,
                    exc,
                )
                try:
                    completion = _request(use_schema=False, use_response_healing=False)
                except Exception as fallback_exc:
                    logger.warning("AI chat completion failed: model=%s error=%s", resolved_model, fallback_exc)
                    raise OpenRouterClientError("Failed to call OpenRouter.") from fallback_exc
            else:
                logger.warning("AI chat completion failed: model=%s error=%s", resolved_model, exc)
                raise OpenRouterClientError("Failed to call OpenRouter.") from exc
        if completion is None:
            logger.warning("AI chat completion returned no response: model=%s", resolved_model)
            raise OpenRouterClientError("Failed to call OpenRouter.")
        payload = _extract_json_payload(_extract_completion_text(completion))
        usage = getattr(completion, "usage", None)
        return payload, {
            "model": resolved_model,
            "prompt_tokens": int(getattr(usage, "prompt_tokens", 0) or 0),
            "completion_tokens": int(getattr(usage, "completion_tokens", 0) or 0),
            "total_tokens": int(getattr(usage, "total_tokens", 0) or 0),
        }

    def extract_image_text(self, *, image_bytes: bytes, mime_type: str, prompt: str = "") -> str:
        client = self._build_client()
        resolved_model = self._resolve_default_model()
        import base64

        data_url = f"data:{str(mime_type or 'image/png').strip()};base64,{base64.b64encode(bytes(image_bytes or b'')).decode('ascii')}"
        user_content = [
            {
                "type": "text",
                "text": str(prompt or "").strip() or "Extract the full readable text from this image. Return plain text only.",
            },
            {
                "type": "image_url",
                "image_url": {"url": data_url},
            },
        ]
        try:
            completion = client.chat.completions.create(
                model=resolved_model,
                temperature=0.0,
                max_tokens=1800,
                messages=[
                    {"role": "system", "content": "You perform OCR. Return only the extracted text."},
                    {"role": "user", "content": user_content},
                ],
            )
        except Exception as exc:
            logger.warning("AI image OCR failed: model=%s error=%s", resolved_model, exc)
            return ""
        return _extract_completion_text(completion)


openrouter_client = OpenRouterClient()
