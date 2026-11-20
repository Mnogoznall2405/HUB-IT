"""Second-opinion LLM reviewer for Scan incidents.

Consumes ``scan_llm_reviews`` rows (enqueued inside ``create_finding_and_incident``),
asks a local chat model for a typed verdict and stores it next to the incident.
The verdict only annotates (shadow mode): incidents are never closed or re-scored
automatically. Backend is pluggable: today llama.cpp GGUF on CPU; a JEV-style
decision head or a GPU build plugs in behind the same interface later.
"""

from __future__ import annotations

import json
import logging
import re
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol

logger = logging.getLogger("scan-llm-worker")

VERDICTS = ("true_positive", "false_positive", "uncertain")
SEVERITIES = ("low", "medium", "high")
_VERDICT_ALIASES = {
    "true positive": "true_positive",
    "tp": "true_positive",
    "positive": "true_positive",
    "yes": "true_positive",
    "false positive": "false_positive",
    "fp": "false_positive",
    "negative": "false_positive",
    "no": "false_positive",
    "unknown": "uncertain",
    "not sure": "uncertain",
}

_SYSTEM_PROMPT = (
    "Ты — аудитор DLP-системы. Сканер уже отнес файл к категории по сработавшим "
    "правилам. Твоя задача — проверить корректность этой классификации, а не "
    "искать совпадения заново: true_positive — присвоенная категория верна "
    "и файл действительно содержит данные этой категории (грифы «для служебного "
    "пользования», «ДСП», «конфиденциально», «секретно», персональные данные, "
    "коммерческая тайна); false_positive — срабатывание ложное: пустой шаблон, "
    "публичный документ, методичка или инструкция про грифы, совпадение без "
    "реальных данных категории; uncertain — по фрагменту нельзя решить. Суди по "
    "смыслу документа: имя файла, тип источника, правила и фрагмент текста. "
    "Ответь строго одним JSON-объектом без пояснений."
)

_USER_TEMPLATE = """Файл: {file_name}
Источник: {source_kind}
Хост/филиал: {hostname} / {branch}
Пользователь: {user_login}
Присвоенная категория: {category}
Присвоенная серьёзность: {severity}
Сработавшие правила:
{patterns_block}
Фрагмент текста:
\"\"\"
{excerpt}
\"\"\"

Верни JSON строго такого вида:
{{"verdict": "true_positive" | "false_positive" | "uncertain",
 "confidence": <число 0..1>,
 "severity": "low" | "medium" | "high",
 "reason": "<одно предложение по-русски: почему категория верна или нет>"}}"""


def build_review_messages(input_payload: Dict[str, Any], max_chars: int = 1600) -> List[Dict[str, str]]:
    """Build chat messages for the second-opinion review. Input comes from
    ``scan_llm_reviews.input_json`` (capped at enqueue time)."""
    payload = input_payload if isinstance(input_payload, dict) else {}
    patterns = payload.get("matched_patterns") or []
    pattern_lines: List[str] = []
    for item in patterns[:8]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("pattern_name") or item.get("pattern") or "?")
        value = str(item.get("value") or "")[:160]
        snippet = str(item.get("snippet") or "")[:300]
        line = f"- {name}: «{value}»"
        if snippet:
            line += f" (контекст: «{snippet}»)"
        pattern_lines.append(line)
    patterns_block = "\n".join(pattern_lines) or "- (нет данных о срабатываниях)"
    excerpt = str(payload.get("text_excerpt") or "")[:max(1600, int(max_chars or 1600))] or "<текст не извлечён>"
    user = _USER_TEMPLATE.format(
        file_name=str(payload.get("file_name") or "?")[:200],
        source_kind=str(payload.get("source_kind") or "?"),
        hostname=str(payload.get("hostname") or "?")[:80],
        branch=str(payload.get("branch") or "?")[:80],
        user_login=str(payload.get("user_login") or "?")[:80],
        category=str(payload.get("category") or "policy_match")[:120],
        severity=str(payload.get("severity") or "?")[:20],
        patterns_block=patterns_block,
        excerpt=excerpt,
    )
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    """Return the first balanced {...} block that parses as a JSON object."""
    start = text.find("{")
    while start != -1:
        depth = 0
        for idx in range(start, len(text)):
            char = text[idx]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    try:
                        parsed = json.loads(text[start : idx + 1])
                    except json.JSONDecodeError:
                        break
                    return parsed if isinstance(parsed, dict) else None
        start = text.find("{", start + 1)
    return None


def _extract_fields_by_regex(text: str) -> Dict[str, Any]:
    """Salvage verdict fields from truncated/tail-position JSON.

    Some models (Bespoke-Nimble, reasoning dumps) emit reasoning first and the
    ``{"verdict": ...}`` block last — sometimes clipped by max_tokens. Pull the
    known fields individually instead of requiring a balanced object.
    """
    out: Dict[str, Any] = {}
    match = re.search(r'"verdict"\s*:\s*"([^"}]+)"', text)
    if match:
        out["verdict"] = match.group(1)
    match = re.search(r'"confidence"\s*:\s*([0-9.]+)', text)
    if match:
        out["confidence"] = match.group(1)
    match = re.search(r'"severity(?:_suggestion)?"\s*:\s*"([^"}]+)"', text)
    if match:
        out["severity"] = match.group(1)
    match = re.search(r'"reason"\s*:\s*"([^"}]*)', text)
    if match:
        out["reason"] = match.group(1)
    return out


def parse_verdict(raw_text: str) -> Dict[str, Any]:
    """Normalize model output into {verdict, confidence, severity_suggestion, reason}.
    Garbage/non-JSON output degrades to ``uncertain`` with the raw reason trimmed."""
    raw = str(raw_text or "")
    parsed = _extract_json_object(raw) or _extract_fields_by_regex(raw)
    verdict = str(parsed.get("verdict") or "").strip().lower().replace("-", "_")
    verdict = _VERDICT_ALIASES.get(verdict, verdict)
    if verdict not in VERDICTS:
        verdict = "uncertain"
    try:
        confidence = float(parsed.get("confidence"))
        confidence = max(0.0, min(1.0, confidence))
    except (TypeError, ValueError):
        confidence = None
    severity = str(parsed.get("severity") or parsed.get("severity_suggestion") or "").strip().lower()
    if severity not in SEVERITIES:
        severity = None
    reason = str(parsed.get("reason") or "").strip()[:500]
    if not reason and not parsed:
        reason = str(raw_text or "").strip()[:500]
    return {
        "verdict": verdict,
        "confidence": confidence,
        "severity_suggestion": severity,
        "reason": reason,
    }


class ModelUnavailableError(RuntimeError):
    """Model file or llama.cpp backend is not usable right now."""


class ChatBackend(Protocol):
    model_label: str

    def generate(self, messages: List[Dict[str, str]]) -> str:
        ...


class LlamaCppBackend:
    """llama.cpp GGUF chat backend. CPU today; ``n_gpu_layers`` flips it to CUDA
    after the driver update — no code change."""

    def __init__(
        self,
        *,
        model_path: str,
        ctx_size: int = 4096,
        max_tokens: int = 320,
        gpu_layers: int = 0,
        no_think: bool = True,
    ) -> None:
        path = Path(str(model_path or "").strip())
        if not path.is_file():
            raise ModelUnavailableError(f"model file not found: {path}")
        try:
            from llama_cpp import Llama
        except ImportError as exc:
            raise ModelUnavailableError("llama-cpp-python is not installed") from exc
        self._max_tokens = max_tokens
        self.model_label = f"llama.cpp/{path.name}"
        # Qwen3 hybrid-thinking GGUFs spend the whole budget on <think> unless
        # told otherwise; llama.cpp applies the embedded template natively, so
        # chat_template_kwargs never reach it — "/no_think" is the working switch.
        # Thinking stays enabled only for models that support it (GPU builds want
        # the better verdicts: 4/4 on the bake-off at ~15 s/review).
        self._no_think = bool(no_think) and "qwen3" in path.name.lower()
        try:
            self._llm = Llama(
                model_path=str(path),
                n_ctx=ctx_size,
                n_gpu_layers=gpu_layers,
                n_threads=max(1, min(8, __import__("os").cpu_count() or 4)),
                verbose=False,
            )
        except Exception as exc:  # noqa: BLE001
            raise ModelUnavailableError(f"llama.cpp init failed: {exc}") from exc

    def generate(self, messages: List[Dict[str, str]]) -> str:
        prompt = messages
        if self._no_think and prompt and prompt[-1].get("role") == "user":
            prompt = [
                *prompt[:-1],
                {**prompt[-1], "content": f"{prompt[-1].get('content', '')}\n\n/no_think"},
            ]
        response = self._llm.create_chat_completion(
            messages=prompt,
            max_tokens=self._max_tokens,
            temperature=0.1,
        )
        choices = response.get("choices") or []
        if not choices:
            return ""
        return str((choices[0].get("message") or {}).get("content") or "")


_SYSTEMONE_QUESTION = {
    "type": "choice",
    "instructions": "Проверь, верна ли присвоенная файлу DLP-категория. "
    "Категория верна, только если документ действительно содержит данные этой "
    "категории: грифы ДСП/конфиденциально/секретно, персональные данные, "
    "коммерческая тайна. Ложным считай срабатывание на шаблоны, публичные "
    "документы, методички и инструкции про грифы без реальных данных.",
    "criteria": {
        "верна": "Документ действительно содержит данные присвоенной категории.",
        "ложное": "Срабатывание ложное: шаблон, публичный или методический документ.",
        "неясно": "По фрагменту нельзя однозначно решить.",
    },
}
_SYSTEMONE_TO_VERDICT = {
    "верна": "true_positive",
    "ложное": "false_positive",
    "неясно": "uncertain",
}


class SystemOneBackend:
    """Ollama ``/v1/systemone`` typed-decision backend (nimble/d3 class).

    Unlike the chat path the model gets a structured ``state`` and returns a
    calibrated option + per-option probabilities — no JSON parsing, and the
    confidence is real. An optional fallback model takes a second vote when the
    primary is unsure; disagreement degrades to ``uncertain`` for the human queue.
    """

    def __init__(
        self,
        *,
        url: str,
        model: str,
        fallback_model: str = "",
        timeout_sec: int = 60,
        second_opinion_confidence: float = 0.55,
        text_max_chars: int = 10000,
        fallback_text_chars: int = 5000,
    ) -> None:
        self._url = str(url or "").strip().rstrip("/")
        self._model = str(model or "").strip()
        self._fallback_model = str(fallback_model or "").strip()
        self._timeout = max(5, int(timeout_sec or 60))
        self._second_opinion_confidence = max(0.0, min(1.0, float(second_opinion_confidence)))
        # nimble runs with num_ctx~8k so ~10k Cyrillic chars is near its safe
        # budget; the fallback model (d3, 4k ctx) gets a narrower window.
        self._text_max_chars = max(1600, int(text_max_chars or 10000))
        self._fallback_text_chars = max(
            1600, min(self._text_max_chars, int(fallback_text_chars or 5000))
        )
        if not self._url or not self._model:
            raise ModelUnavailableError("systemone backend needs url and model")
        self.model_label = f"systemone/{self._model}"
        self._check_server()

    def _check_server(self) -> None:
        base = re.sub(r"/v1/systemone/?$", "", self._url)
        try:
            with urllib.request.urlopen(
                urllib.request.Request(f"{base}/api/tags"), timeout=10
            ) as resp:
                json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            raise ModelUnavailableError(f"systemone server unreachable: {exc}") from exc

    def _ask(self, model: str, state: Dict[str, Any]) -> Dict[str, Any]:
        body = json.dumps(
            {"model": model, "state": state, "questions": {"verdict": _SYSTEMONE_QUESTION}},
            ensure_ascii=False,
        ).encode("utf-8")
        req = urllib.request.Request(
            self._url, data=body, headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=self._timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        answer = (data.get("answers") or {}).get("verdict") or {}
        choice = str(answer.get("choice") or "")
        probabilities = answer.get("probabilities") or {}
        verdict = _SYSTEMONE_TO_VERDICT.get(choice, "uncertain")
        confidence = answer.get("confidence")
        try:
            confidence = max(0.0, min(1.0, float(confidence)))
        except (TypeError, ValueError):
            confidence = None
        return {"verdict": verdict, "confidence": confidence, "probabilities": probabilities}

    def _state(self, input_payload: Dict[str, Any], text_chars: Optional[int] = None) -> Dict[str, Any]:
        payload = input_payload if isinstance(input_payload, dict) else {}
        cap = self._text_max_chars if text_chars is None else max(1600, int(text_chars))
        patterns = []
        for item in (payload.get("matched_patterns") or [])[:8]:
            if not isinstance(item, dict):
                continue
            name = str(item.get("pattern_name") or item.get("pattern") or "?")
            value = str(item.get("value") or "")[:160]
            patterns.append(f"{name}: «{value}»" if value else name)
        return {
            "файл": str(payload.get("file_name") or "?")[:200],
            "источник": str(payload.get("source_kind") or "?"),
            "присвоенная_категория": str(payload.get("category") or "policy_match")[:120],
            "серьёзность": str(payload.get("severity") or "?")[:20],
            "сработавшие_правила": ", ".join(patterns) or "-",
            "фрагмент_текста": str(payload.get("text_excerpt") or "")[:cap] or "<текст не извлечён>",
        }

    def decide(self, input_payload: Dict[str, Any]) -> Dict[str, Any]:
        state = self._state(input_payload)
        primary = self._ask(self._model, state)
        verdict = primary["verdict"]
        confidence = primary["confidence"]
        reason = ""
        needs_second = (
            bool(self._fallback_model)
            and (
                verdict == "uncertain"
                or confidence is None
                or confidence < self._second_opinion_confidence
            )
        )
        if needs_second:
            second_state = state
            if self._fallback_text_chars < self._text_max_chars:
                second_state = self._state(input_payload, text_chars=self._fallback_text_chars)
            second = self._ask(self._fallback_model, second_state)
            if second["verdict"] == verdict:
                if second["confidence"] is not None:
                    confidence = max(confidence or 0.0, second["confidence"])
                reason = f"second opinion confirmed ({self._fallback_model})"
            else:
                verdict = "uncertain"
                confidence = min(confidence or 1.0, second["confidence"] or 1.0)
                reason = (
                    f"models disagree: {self._model}={primary['verdict']} vs "
                    f"{self._fallback_model}={second['verdict']}"
                )
        return {
            "verdict": verdict,
            "confidence": confidence,
            "severity_suggestion": None,
            "reason": reason or json.dumps(primary["probabilities"], ensure_ascii=False)[:300],
        }


class LlmReviewWorker:
    """Claims queued reviews one at a time, asks the backend, stores the verdict."""

    def __init__(
        self,
        *,
        store: Any,
        config: Any,
        backend: Optional[ChatBackend] = None,
        stop_event: Optional[Any] = None,
    ) -> None:
        self.store = store
        self.config = config
        self._backend = backend
        self._backend_failed_at = 0.0
        import threading

        self.stop_event = stop_event or threading.Event()

    def _get_backend(self) -> ChatBackend:
        if self._backend is None:
            if str(getattr(self.config, "llm_review_backend", "llama_cpp") or "llama_cpp") == "systemone":
                self._backend = SystemOneBackend(
                    url=str(getattr(self.config, "llm_review_systemone_url", "") or ""),
                    model=str(getattr(self.config, "llm_review_systemone_model", "") or ""),
                    fallback_model=str(getattr(self.config, "llm_review_systemone_fallback_model", "") or ""),
                    timeout_sec=int(getattr(self.config, "llm_review_systemone_timeout_sec", 60) or 60),
                    second_opinion_confidence=float(
                        getattr(self.config, "llm_review_second_opinion_confidence", 0.55) or 0.55
                    ),
                    text_max_chars=int(getattr(self.config, "llm_review_text_max_chars", 10000) or 10000),
                    fallback_text_chars=int(
                        getattr(self.config, "llm_review_fallback_text_chars", 5000) or 5000
                    ),
                )
            else:
                self._backend = LlamaCppBackend(
                    model_path=str(getattr(self.config, "llm_review_model_path", "") or ""),
                    ctx_size=int(getattr(self.config, "llm_review_ctx_size", 4096) or 4096),
                    max_tokens=int(getattr(self.config, "llm_review_max_tokens", 320) or 320),
                    gpu_layers=int(getattr(self.config, "llm_review_gpu_layers", 0) or 0),
                    no_think=bool(getattr(self.config, "llm_review_no_think", True)),
                )
            logger.info("LLM backend ready: %s", self._backend.model_label)
        return self._backend

    def process_one(self) -> bool:
        """Process at most one queued review. Returns True when a verdict was written."""
        reviews = self.store.claim_llm_reviews(1)
        if not reviews:
            return False
        review = reviews[0]
        review_id = str(review.get("id") or "")
        try:
            backend = self._get_backend()
        except ModelUnavailableError as exc:
            # Model not ready: put the row back and don't burn attempts. Backoff is
            # handled by the caller's idle sleep, not by per-row retries.
            logger.warning("LLM backend unavailable, review %s released: %s", review_id, exc)
            self.store.release_llm_review(review_id)
            self._backend_failed_at = time.monotonic()
            return False
        except Exception as exc:  # noqa: BLE001
            logger.exception("LLM backend init crashed")
            self.store.release_llm_review(review_id)
            self._backend_failed_at = time.monotonic()
            return False
        started = time.perf_counter()
        try:
            if isinstance(backend, SystemOneBackend):
                verdict = backend.decide(review.get("input"))
            else:
                ctx = int(getattr(self.config, "llm_review_ctx_size", 4096) or 4096)
                text_cap = min(
                    int(getattr(self.config, "llm_review_text_max_chars", 10000) or 10000),
                    ctx * 2,
                )
                raw = backend.generate(
                    build_review_messages(review.get("input"), max_chars=text_cap)
                )
                verdict = parse_verdict(raw)
        except Exception as exc:  # noqa: BLE001
            logger.warning("LLM inference failed for review %s: %s", review_id, exc)
            self.store.fail_llm_review(
                review_id,
                error_text=f"inference:{type(exc).__name__}",
                max_attempts=int(getattr(self.config, "llm_review_max_attempts", 3) or 3),
            )
            return True
        self.store.complete_llm_review(
            review_id,
            verdict=verdict["verdict"],
            confidence=verdict["confidence"],
            severity_suggestion=verdict["severity_suggestion"],
            reason=verdict["reason"],
            model=backend.model_label,
            auto_dismiss_fp=bool(getattr(self.config, "llm_review_auto_dismiss_fp", True)),
            auto_dismiss_confidence=float(
                getattr(self.config, "llm_review_auto_dismiss_confidence", 0.9) or 0.9
            ),
        )
        logger.info(
            "LLM review %s done: verdict=%s confidence=%s elapsed=%.1fs",
            review_id,
            verdict["verdict"],
            verdict["confidence"],
            time.perf_counter() - started,
        )
        return True

    def backend_recently_failed(self) -> bool:
        return bool(self._backend_failed_at) and (time.monotonic() - self._backend_failed_at) < 120.0


def build_default_store(config: Any):
    from .database import ScanStore

    return ScanStore(
        db_path=config.db_path,
        archive_dir=config.archive_dir,
        task_ack_timeout_sec=config.task_ack_timeout_sec,
        agent_online_timeout_sec=config.agent_online_timeout_sec,
        resolve_agent_sql_context=config.resolve_agent_sql_context,
        job_processing_timeout_sec=config.job_processing_timeout_sec,
        llm_review_processing_lease_sec=getattr(config, "llm_review_processing_lease_sec", 600),
        database_url=config.database_url,
    )
