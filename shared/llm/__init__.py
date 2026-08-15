"""Shared OpenAI-compatible LLM gateway.

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
    DEFAULT_ROUTERAI_BASE_URL,
    normalize_openrouter_base_url,
    read_env,
)
from shared.llm.errors import OpenRouterClientError
from shared.llm.models import resolve_model, resolve_model_candidates
from shared.llm.openai_gateway import (
    OpenAiChatCompletionRequest,
    OpenAiGatewayValidationError,
    iter_openai_sse,
    normalize_gateway_request,
)

__all__ = [
    "DEFAULT_AI_MODEL",
    "DEFAULT_OPENROUTER_BASE_URL",
    "DEFAULT_ROUTERAI_BASE_URL",
    "OpenRouterClient",
    "OpenRouterClientError",
    "OpenAiChatCompletionRequest",
    "OpenAiGatewayValidationError",
    "is_image_unsupported_error",
    "normalize_openrouter_base_url",
    "normalize_gateway_request",
    "openrouter_client",
    "provider_error_text",
    "iter_openai_sse",
    "read_env",
    "resolve_model",
    "resolve_model_candidates",
]
