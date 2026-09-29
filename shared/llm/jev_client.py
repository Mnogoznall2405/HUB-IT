"""System One typed-decision client (Jev) for HUB-IT.

Jev is a non-generative decision model: it takes a ``state`` plus a map of
typed questions and returns calibrated answers (probabilities/confidence)
instead of text. Transport is the OpenRouter System One endpoint
``POST {base}/systemone`` (https://openrouter.ai/api/v1/systemone); RouterAI
lists the model but does not proxy this endpoint.
"""
from __future__ import annotations

import logging
import random
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Mapping, Optional, Sequence, Union

import httpx

from shared.llm.env import read_env
from shared.llm.errors import OpenRouterClientError

logger = logging.getLogger(__name__)

DEFAULT_JEV_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_JEV_MODEL = "typesafe/jev-1.13"
JEV_SYSTEMONE_PATH = "/systemone"
JEV_DEFAULT_TIMEOUT_SEC = 15.0
JEV_DEFAULT_MAX_RETRIES = 2
JEV_RETRY_BASE_DELAY_SEC = 0.4
JEV_TRANSIENT_STATUSES = frozenset({408, 409, 425, 429, 500, 502, 503, 504, 529})
JEV_MAX_QUESTIONS = 255


class JevClientError(OpenRouterClientError):
    """Raised when a System One (Jev) request fails."""


@dataclass(frozen=True)
class JevNoulAnswer:
    """Yes/no question: probability that the answer is "yes"."""

    probability: float
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)


@dataclass(frozen=True)
class JevChoiceAnswer:
    choice: str
    probabilities: Mapping[str, float] = field(default_factory=dict)
    confidence: float = 0.0
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)


@dataclass(frozen=True)
class JevScoreAnswer:
    score: Any = None
    probabilities: Mapping[str, float] = field(default_factory=dict)
    confidence: float = 0.0
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False, compare=False)


@dataclass(frozen=True)
class JevRawAnswer:
    """Tolerant fallback for answer shapes added after this client."""

    raw: Any = None


JevAnswer = Union[JevNoulAnswer, JevChoiceAnswer, JevScoreAnswer, JevRawAnswer]


@dataclass(frozen=True)
class JevDecision:
    answers: Mapping[str, JevAnswer]
    model: str
    generation_id: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0


def jev_noul(instructions: str, *, true_label: str = "", false_label: str = "") -> dict[str, Any]:
    question: dict[str, Any] = {"type": "noul", "instructions": str(instructions or "")}
    if true_label or false_label:
        question["criteria"] = {}
        if true_label:
            question["criteria"]["true"] = str(true_label)
        if false_label:
            question["criteria"]["false"] = str(false_label)
    return question


def jev_choice(instructions: str, criteria: Mapping[str, str]) -> dict[str, Any]:
    return {
        "type": "choice",
        "instructions": str(instructions or ""),
        "criteria": {str(k): str(v) for k, v in dict(criteria or {}).items()},
    }


def jev_score(instructions: str, criteria: Sequence[str]) -> dict[str, Any]:
    return {
        "type": "score",
        "instructions": str(instructions or ""),
        "criteria": [str(item) for item in list(criteria or [])],
    }


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _parse_answer(raw: Any) -> JevAnswer:
    if not isinstance(raw, Mapping):
        return JevRawAnswer(raw=raw)
    qtype = str(raw.get("type") or "").strip().lower()
    if qtype == "noul":
        return JevNoulAnswer(probability=_to_float(raw.get("noul")), raw=raw)
    if qtype == "choice":
        probs = {
            str(key): _to_float(val)
            for key, val in dict(raw.get("probabilities") or {}).items()
        }
        choice = str(raw.get("choice") or raw.get("selected") or "").strip()
        if not choice and probs:
            choice = max(probs, key=probs.get)
        return JevChoiceAnswer(
            choice=choice,
            probabilities=probs,
            confidence=_to_float(raw.get("confidence")),
            raw=raw,
        )
    if qtype == "score":
        probs = {
            str(key): _to_float(val)
            for key, val in dict(raw.get("probabilities") or {}).items()
        }
        score = raw.get("score")
        if score is None and probs:
            score = max(probs, key=probs.get)
        return JevScoreAnswer(
            score=score,
            probabilities=probs,
            confidence=_to_float(raw.get("confidence")),
            raw=raw,
        )
    return JevRawAnswer(raw=raw)


def _provider_error_message(response: httpx.Response) -> str:
    detail = ""
    try:
        payload = response.json()
        error = payload.get("error") if isinstance(payload, Mapping) else None
        if isinstance(error, Mapping):
            detail = str(error.get("message") or "")
        elif isinstance(payload, Mapping):
            detail = str(payload.get("message") or "")
    except Exception:
        detail = ""
    return detail.strip()[:300]


class JevClient:
    """Thin System One client; thread-safe via thread-local httpx clients."""

    def __init__(self, *, request_timeout_sec: float = JEV_DEFAULT_TIMEOUT_SEC) -> None:
        self.request_timeout_sec = float(request_timeout_sec)
        self._thread_local = threading.local()

    def is_configured(self) -> bool:
        return bool(self._resolve_api_key())

    def get_status(self) -> dict[str, Any]:
        return {
            "configured": self.is_configured(),
            "provider": "openrouter-systemone",
            "base_url": self._resolve_base_url(),
            "model": self._resolve_model(""),
        }

    def _resolve_api_key(self) -> str:
        return str(read_env("JEV_API_KEY") or read_env("OPENROUTER_API_KEY") or "").strip()

    def _resolve_base_url(self) -> str:
        raw = str(
            read_env("JEV_BASE_URL") or read_env("OPENROUTER_BASE_URL") or DEFAULT_JEV_BASE_URL
        ).strip().rstrip("/")
        if raw.lower().endswith(JEV_SYSTEMONE_PATH):
            raw = raw[: -len(JEV_SYSTEMONE_PATH)].rstrip("/")
        if not raw.lower().endswith("/v1"):
            raw = f"{raw}/v1"
        return raw or DEFAULT_JEV_BASE_URL

    def _resolve_model(self, model: str) -> str:
        return str(model or read_env("JEV_MODEL") or DEFAULT_JEV_MODEL).strip() or DEFAULT_JEV_MODEL

    def _resolve_timeout(self, timeout: Optional[float]) -> float:
        if timeout is None:
            env_timeout = _to_float(read_env("JEV_TIMEOUT_SEC"), self.request_timeout_sec)
            return max(1.0, env_timeout)
        return max(1.0, float(timeout))

    def _resolve_max_retries(self) -> int:
        return max(1, int(_to_float(read_env("JEV_MAX_RETRIES"), JEV_DEFAULT_MAX_RETRIES)))

    def _build_client(self, timeout: float) -> httpx.Client:
        cached_client = getattr(self._thread_local, "client", None)
        cached_key = getattr(self._thread_local, "client_key", None)
        if cached_client is not None and cached_key == timeout:
            return cached_client
        client = httpx.Client(timeout=timeout)
        self._thread_local.client = client
        self._thread_local.client_key = timeout
        return client

    def decide(
        self,
        *,
        state: Any,
        questions: Mapping[str, Mapping[str, Any]],
        model: str = "",
        timeout: Optional[float] = None,
    ) -> JevDecision:
        """Evaluate all questions against the state in one round trip."""
        if not isinstance(questions, Mapping) or not questions:
            raise JevClientError("Jev decision requires at least one question.")
        if len(questions) > JEV_MAX_QUESTIONS:
            raise JevClientError(f"Jev decision exceeds {JEV_MAX_QUESTIONS} questions.")
        api_key = self._resolve_api_key()
        if not api_key:
            raise JevClientError("JEV_API_KEY is not configured.")
        resolved_model = self._resolve_model(model)
        resolved_timeout = self._resolve_timeout(timeout)
        url = f"{self._resolve_base_url()}{JEV_SYSTEMONE_PATH}"
        payload = {
            "model": resolved_model,
            "state": state,
            "questions": dict(questions),
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        client = self._build_client(resolved_timeout)
        attempts = self._resolve_max_retries()
        last_exc: Optional[Exception] = None
        for attempt in range(1, attempts + 1):
            try:
                response = client.post(url, json=payload, headers=headers)
            except httpx.HTTPError as exc:
                last_exc = JevClientError(f"Jev request failed: {exc}")
                transient = True
            else:
                if response.status_code < 400:
                    try:
                        return self._parse_decision(response.json(), resolved_model)
                    except JevClientError as exc:
                        last_exc = exc
                        transient = False
                else:
                    transient = response.status_code in JEV_TRANSIENT_STATUSES
                    detail = _provider_error_message(response)
                    suffix = f": {detail}" if detail else ""
                    last_exc = JevClientError(
                        f"Jev request failed with HTTP {response.status_code}{suffix}"
                    )
            if not transient or attempt >= attempts:
                assert last_exc is not None
                raise last_exc
            delay = JEV_RETRY_BASE_DELAY_SEC * attempt + random.uniform(0.0, 0.1)
            logger.warning(
                "Jev transient failure; retrying in %.2fs: model=%s attempt=%s/%s error=%s",
                delay,
                resolved_model,
                attempt,
                attempts,
                last_exc,
            )
            time.sleep(delay)
        assert last_exc is not None
        raise last_exc

    @staticmethod
    def _parse_decision(data: Any, resolved_model: str) -> JevDecision:
        if not isinstance(data, Mapping):
            raise JevClientError("Jev returned an invalid response payload.")
        answers_raw = data.get("answers")
        if not isinstance(answers_raw, Mapping):
            raise JevClientError("Jev response does not contain 'answers'.")
        answers = {str(name): _parse_answer(answer) for name, answer in answers_raw.items()}
        usage = data.get("usage") if isinstance(data.get("usage"), Mapping) else {}
        return JevDecision(
            answers=answers,
            model=str(data.get("model") or resolved_model),
            generation_id=str(data.get("id") or ""),
            input_tokens=int(_to_float(usage.get("input_tokens"))),
            output_tokens=int(_to_float(usage.get("output_tokens"))),
            cost_usd=_to_float(usage.get("cost")),
        )


jev_client = JevClient()
