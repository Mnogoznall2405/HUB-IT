"""Shared OpenRouter LLM gateway.

All production LLM calls in HUB-IT must go through this package.
"""
from shared.llm.client import (
    OpenRouterClient,
    is_image_unsupported_error,
    openrouter_client,
    provider_error_text,
)
from shared.llm.env import (
    DEFAULT_AI_MODEL,
    DEFAULT_OPENROUTER_BASE_URL,
    normalize_openrouter_base_url,
    read_env,
)
from shared.llm.errors import OpenRouterClientError
from shared.llm.models import resolve_model, resolve_model_candidates

__all__ = [
    "DEFAULT_AI_MODEL",
    "DEFAULT_OPENROUTER_BASE_URL",
    "OpenRouterClient",
    "OpenRouterClientError",
    "is_image_unsupported_error",
    "normalize_openrouter_base_url",
    "openrouter_client",
    "provider_error_text",
    "read_env",
    "resolve_model",
    "resolve_model_candidates",
]
