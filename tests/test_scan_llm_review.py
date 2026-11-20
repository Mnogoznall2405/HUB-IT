"""LLM second-opinion review queue: enqueue→claim→verdict, retry, prompt/parse."""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from scan_server.database import ScanStore
from scan_server.llm_review_worker import (
    LlmReviewWorker,
    ModelUnavailableError,
    SystemOneBackend,
    build_review_messages,
    parse_verdict,
)


def _make_store(temp_dir):
    root = Path(temp_dir)
    return ScanStore(
        db_path=root / "scan-llm.db",
        archive_dir=root / "archive",
        task_ack_timeout_sec=300,
        agent_online_timeout_sec=300,
    )


def _queue_incident(store):
    job = store.queue_job(
        {
            "agent_id": "agent-1",
            "hostname": "HOST-01",
            "file_path": r"C:\Docs\secret.pdf",
            "file_name": "secret.pdf",
            "file_hash": "h-llm-1",
            "file_size": 10,
            "source_kind": "text",
            "event_id": "evt-llm-1",
        }
    )
    with store._lock, store._connect() as conn:
        row = dict(conn.execute("SELECT * FROM scan_jobs WHERE id=?", (job["job_id"],)).fetchone())
    result = store.create_finding_and_incident(
        job=row,
        severity="high",
        category="policy_match",
        matched_patterns=[
            {"pattern": "dsp_header", "pattern_name": "ДСП", "value": "ДСП", "snippet": "гриф ДСП"}
        ],
        short_reason="dsp_header",
        llm_context="Для служебного пользования. Реестр сотрудников филиала.",
    )
    return job, result


def test_incident_creation_enqueues_llm_review(temp_dir):
    store = _make_store(temp_dir)
    _, result = _queue_incident(store)
    incident_id = result["incident_id"]
    assert incident_id

    claimed = store.claim_llm_reviews(1)
    assert len(claimed) == 1
    review = claimed[0]
    assert review["incident_id"] == incident_id
    assert review["status"] == "processing"
    payload = review["input"]
    assert payload["file_name"] == "secret.pdf"
    assert payload["matched_patterns"][0]["pattern_name"] == "ДСП"
    assert "служебного пользования" in payload["text_excerpt"]
    # Second claim returns nothing while the row is processing.
    assert store.claim_llm_reviews(1) == []


def test_complete_llm_review_annotates_incident_list(temp_dir):
    store = _make_store(temp_dir)
    _, result = _queue_incident(store)
    review = store.claim_llm_reviews(1)[0]

    assert store.complete_llm_review(
        review["id"],
        verdict="true_positive",
        confidence=0.9,
        severity_suggestion="high",
        reason="Гриф ДСП в заголовке",
        model="test-model",
    )

    verdicts = store.latest_llm_verdicts([result["incident_id"]])
    assert verdicts[result["incident_id"]]["llm_verdict"] == "true_positive"
    assert verdicts[result["incident_id"]]["llm_confidence"] == 0.9

    page = store.list_incidents(limit=10, view="detail")
    item = next(i for i in page["items"] if i["id"] == result["incident_id"])
    assert item["llm_verdict"] == "true_positive"
    assert item["llm_reason"] == "Гриф ДСП в заголовке"


def test_fail_llm_review_retries_then_fails(temp_dir):
    store = _make_store(temp_dir)
    _queue_incident(store)
    review = store.claim_llm_reviews(1)[0]

    assert store.fail_llm_review(review["id"], error_text="boom", max_attempts=2)
    # Requeued with backoff — not claimable yet.
    assert store.claim_llm_reviews(1) == []
    with store._lock, store._connect() as conn:
        conn.execute(
            "UPDATE scan_llm_reviews SET next_attempt_at=0 WHERE id=?", (review["id"],)
        )
    again = store.claim_llm_reviews(1)
    assert again and again[0]["id"] == review["id"]
    assert again[0]["attempt_count"] == 2
    # Second failure at cap → terminal failed.
    assert store.fail_llm_review(again[0]["id"], error_text="boom2", max_attempts=2)
    with store._lock, store._connect() as conn:
        row = conn.execute(
            "SELECT status, error_text FROM scan_llm_reviews WHERE id=?", (review["id"],)
        ).fetchone()
    assert row["status"] == "failed"


def test_release_llm_review_returns_to_queue(temp_dir):
    store = _make_store(temp_dir)
    _queue_incident(store)
    review = store.claim_llm_reviews(1)[0]
    assert store.release_llm_review(review["id"])
    with store._lock, store._connect() as conn:
        row = conn.execute(
            "SELECT status FROM scan_llm_reviews WHERE id=?", (review["id"],)
        ).fetchone()
    assert row["status"] == "queued"


def test_stale_processing_review_is_reclaimed(temp_dir):
    """Worker death between claim and verdict must not orphan the row forever."""
    store = _make_store(temp_dir)
    _queue_incident(store)
    review = store.claim_llm_reviews(1)[0]
    # Fresh claim is not reclaimable.
    assert store.claim_llm_reviews(1) == []
    # Age it past the processing lease → the next claim picks it up again.
    stale_ts = int(time.time()) - store.llm_review_processing_lease_sec - 1
    with store._lock, store._connect() as conn:
        conn.execute(
            "UPDATE scan_llm_reviews SET started_at=? WHERE id=?", (stale_ts, review["id"])
        )
    again = store.claim_llm_reviews(1)
    assert again and again[0]["id"] == review["id"]
    assert again[0]["attempt_count"] == 2


class _FakeBackend:
    model_label = "fake/model"

    def __init__(self, raw: str):
        self._raw = raw
        self.calls = 0

    def generate(self, messages):
        self.calls += 1
        return self._raw


def test_worker_process_one_writes_verdict(temp_dir):
    store = _make_store(temp_dir)
    _, result = _queue_incident(store)
    backend = _FakeBackend('{"verdict": "false_positive", "confidence": 0.8, "severity": "low", "reason": "шаблон"}')
    worker = LlmReviewWorker(store=store, config=object(), backend=backend)

    assert worker.process_one() is True
    verdicts = store.latest_llm_verdicts([result["incident_id"]])
    assert verdicts[result["incident_id"]]["llm_verdict"] == "false_positive"
    assert verdicts[result["incident_id"]]["llm_model"] == "fake/model"


def test_worker_releases_review_when_backend_unavailable(temp_dir):
    store = _make_store(temp_dir)
    _queue_incident(store)
    worker = LlmReviewWorker(store=store, config=object(), backend=None)

    def _boom():
        raise ModelUnavailableError("no model")

    worker._get_backend = _boom
    assert worker.process_one() is False
    with store._lock, store._connect() as conn:
        row = conn.execute(
            "SELECT status FROM scan_llm_reviews LIMIT 1"
        ).fetchone()
    assert row["status"] == "queued"


def test_parse_verdict_variants():
    ok = parse_verdict('текст {"verdict": "true_positive", "confidence": 0.7, "severity": "high", "reason": "гриф"} ещё текст')
    assert ok["verdict"] == "true_positive"
    assert ok["confidence"] == 0.7
    assert ok["severity_suggestion"] == "high"
    assert ok["reason"] == "гриф"

    aliased = parse_verdict('{"verdict": "false positive", "confidence": "0.95", "severity": "LOW"}')
    assert aliased["verdict"] == "false_positive"
    assert aliased["confidence"] == 0.95
    assert aliased["severity_suggestion"] == "low"

    garbage = parse_verdict("совсем не json")
    assert garbage["verdict"] == "uncertain"
    assert garbage["confidence"] is None
    assert garbage["reason"] == "совсем не json"


def test_build_review_messages_caps_and_content():
    payload = {
        "file_name": "doc.pdf",
        "source_kind": "pdf_slice",
        "hostname": "H1",
        "branch": "B",
        "user_login": "u",
        "category": "policy_match",
        "severity": "high",
        "matched_patterns": [
            {"pattern": "p", "pattern_name": "ДСП", "value": "v", "snippet": "s"}
        ]
        * 20,
        "text_excerpt": "x" * 5000,
    }
    messages = build_review_messages(payload)
    assert messages[0]["role"] == "system"
    user = messages[1]["content"]
    assert "doc.pdf" in user
    assert "policy_match" in user
    assert "high" in user
    assert user.count("pattern_name") == 0  # pattern names, not keys
    assert user.count("- ДСП") == 8  # capped at 8
    assert len(user) < 4000


class _SystemOneResponder:
    """Fake /v1/systemone server: tags probe + per-model scripted answers."""

    def __init__(self, answers_by_model):
        self._answers = answers_by_model
        self.requests = []

    def __call__(self, req, timeout=None):
        url = getattr(req, "full_url", "")
        body = getattr(req, "data", b"") or b""

        class _Resp:
            def __init__(self, payload):
                self._payload = payload

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self):
                return json.dumps(self._payload).encode("utf-8")

        if url.endswith("/api/tags"):
            return _Resp({"models": []})
        payload = json.loads(body.decode("utf-8"))
        self.requests.append(payload)
        answer = self._answers[payload["model"]]
        return _Resp({"answers": {"verdict": answer}})


def _make_systemone_backend(monkeypatch, answers_by_model, **kwargs):
    import scan_server.llm_review_worker as worker_mod

    responder = _SystemOneResponder(answers_by_model)
    monkeypatch.setattr(worker_mod.urllib.request, "urlopen", responder)
    backend = SystemOneBackend(
        url="http://127.0.0.1:11434/v1/systemone",
        model="nimble:9b",
        fallback_model=kwargs.pop("fallback_model", "d3:4b"),
        second_opinion_confidence=kwargs.pop("second_opinion_confidence", 0.55),
        text_max_chars=kwargs.pop("text_max_chars", 10000),
        fallback_text_chars=kwargs.pop("fallback_text_chars", 5000),
    )
    return backend, responder


def test_systemone_decide_maps_choice_and_confidence(monkeypatch):
    backend, responder = _make_systemone_backend(
        monkeypatch,
        {"nimble:9b": {"choice": "верна", "confidence": 0.93, "probabilities": {"верна": 0.93}}},
        fallback_model="",
    )
    out = backend.decide(
        {
            "file_name": "ТЗ.pdf",
            "source_kind": "pdf_slice",
            "category": "policy_match",
            "severity": "high",
            "matched_patterns": [{"pattern_name": "ДСП", "value": "Для служебного пользования"}],
            "text_excerpt": "Для служебного пользования Экз.",
        }
    )
    assert out["verdict"] == "true_positive"
    assert out["confidence"] == pytest.approx(0.93)
    assert len(responder.requests) == 1
    state = responder.requests[0]["state"]
    assert state["присвоенная_категория"] == "policy_match"
    assert "Для служебного пользования" in state["сработавшие_правила"]
    assert "Для служебного пользования" in state["фрагмент_текста"]


def test_systemone_second_opinion_disagreement_goes_uncertain(monkeypatch):
    backend, responder = _make_systemone_backend(
        monkeypatch,
        {
            "nimble:9b": {"choice": "верна", "confidence": 0.4, "probabilities": {}},
            "d3:4b": {"choice": "ложное", "confidence": 0.7, "probabilities": {}},
        },
    )
    out = backend.decide({"file_name": "x.pdf", "text_excerpt": "текст"})
    # low primary confidence triggers the fallback vote; disagreement degrades.
    assert len(responder.requests) == 2
    assert out["verdict"] == "uncertain"
    assert "disagree" in out["reason"]


def test_systemone_second_opinion_agreement_keeps_verdict(monkeypatch):
    backend, _ = _make_systemone_backend(
        monkeypatch,
        {
            "nimble:9b": {"choice": "неясно", "confidence": 0.3, "probabilities": {}},
            "d3:4b": {"choice": "неясно", "confidence": 0.5, "probabilities": {}},
        },
    )
    out = backend.decide({"file_name": "x.pdf", "text_excerpt": "обрыв"})
    assert out["verdict"] == "uncertain"
    assert out["confidence"] == pytest.approx(0.5)
    assert "confirmed" in out["reason"]


def test_systemone_high_confidence_skips_fallback(monkeypatch):
    backend, responder = _make_systemone_backend(
        monkeypatch,
        {
            "nimble:9b": {"choice": "ложное", "confidence": 0.9, "probabilities": {}},
            "d3:4b": {"choice": "верна", "confidence": 0.9, "probabilities": {}},
        },
    )
    out = backend.decide({"file_name": "x.pdf", "text_excerpt": "текст"})
    assert out["verdict"] == "false_positive"
    assert len(responder.requests) == 1  # no second call when confident


def test_systemone_state_caps_text_to_configured_limit(monkeypatch):
    backend, responder = _make_systemone_backend(
        monkeypatch,
        {"nimble:9b": {"choice": "верна", "confidence": 0.9, "probabilities": {}}},
        fallback_model="",
        text_max_chars=2000,
    )
    backend.decide({"file_name": "x.pdf", "text_excerpt": "я" * 9000})
    assert len(responder.requests[0]["state"]["фрагмент_текста"]) == 2000


def test_systemone_fallback_gets_narrower_text_window(monkeypatch):
    backend, responder = _make_systemone_backend(
        monkeypatch,
        {
            "nimble:9b": {"choice": "неясно", "confidence": 0.3, "probabilities": {}},
            "d3:4b": {"choice": "неясно", "confidence": 0.5, "probabilities": {}},
        },
        text_max_chars=8000,
        fallback_text_chars=2500,
    )
    backend.decide({"file_name": "x.pdf", "text_excerpt": "д" * 9000})
    assert len(responder.requests) == 2
    assert len(responder.requests[0]["state"]["фрагмент_текста"]) == 8000
    assert len(responder.requests[1]["state"]["фрагмент_текста"]) == 2500


def test_build_review_messages_respects_max_chars():
    messages = build_review_messages({"text_excerpt": "я" * 5000}, max_chars=3000)
    assert ("я" * 3000) in messages[1]["content"]
    assert ("я" * 3001) not in messages[1]["content"]
