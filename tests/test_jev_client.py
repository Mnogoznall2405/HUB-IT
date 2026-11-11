"""Unit tests for shared/llm/jev_client (System One / Jev decisions)."""
from __future__ import annotations

import importlib
import json

import httpx
import pytest

# shared.llm exports the singleton under the same name, so resolve the module explicitly.
jev_mod = importlib.import_module("shared.llm.jev_client")
from shared.llm.jev_client import (
    JevChoiceAnswer,
    JevClient,
    JevClientError,
    JevNoulAnswer,
    JevScoreAnswer,
    jev_choice,
    jev_noul,
    jev_score,
)


@pytest.fixture()
def fake_env(monkeypatch):
    values = {
        "JEV_API_KEY": "test-key",
        "JEV_BASE_URL": "https://jev.test/api/v1",
        "JEV_MODEL": "typesafe/jev-1.13",
    }
    monkeypatch.setattr(jev_mod, "read_env", lambda name, default=None: values.get(name, default))
    return values


def _client(handler, monkeypatch) -> JevClient:
    client = JevClient()
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        client,
        "_build_client",
        lambda timeout: httpx.Client(transport=transport, timeout=timeout),
    )
    return client


def _decision_payload() -> dict:
    return {
        "model": "typesafe/jev-1.13-20260917",
        "id": "gen-dec-1",
        "provider": "TypeSafe",
        "answers": {
            "needs_files": {"type": "noul", "noul": 0.98},
            "queue": {
                "type": "choice",
                "choice": "hardware",
                "probabilities": {"hardware": 0.9, "software": 0.1},
                "confidence": 0.9,
            },
            "urgency": {
                "type": "score",
                "score": 2,
                "probabilities": {"0": 0.0, "1": 0.2, "2": 0.8},
                "confidence": 0.69,
            },
        },
        "usage": {"input_tokens": 300, "output_tokens": 21, "cost": 0.0000126},
    }


def test_decide_parses_typed_answers(fake_env, monkeypatch):
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(200, json=_decision_payload())

    client = _client(handler, monkeypatch)
    decision = client.decide(
        state={"user_message": "сделай отчёт"},
        questions={
            "needs_files": jev_noul("Нужен файл?"),
            "queue": jev_choice("Куда?", {"hardware": "железо", "software": "ПО"}),
            "urgency": jev_score("Срочность?", ["низкая", "средняя", "высокая"]),
        },
    )
    assert captured["url"] == "https://jev.test/api/v1/systemone"
    assert captured["body"]["model"] == "typesafe/jev-1.13"
    assert captured["body"]["state"] == {"user_message": "сделай отчёт"}
    assert set(captured["body"]["questions"]) == {"needs_files", "queue", "urgency"}
    assert captured["body"]["questions"]["needs_files"]["type"] == "noul"
    assert captured["body"]["questions"]["queue"]["criteria"]["hardware"] == "железо"
    assert captured["body"]["questions"]["urgency"]["criteria"] == ["низкая", "средняя", "высокая"]

    noul = decision.answers["needs_files"]
    assert isinstance(noul, JevNoulAnswer) and noul.probability == pytest.approx(0.98)
    choice = decision.answers["queue"]
    assert isinstance(choice, JevChoiceAnswer)
    assert choice.choice == "hardware" and choice.confidence == pytest.approx(0.9)
    score = decision.answers["urgency"]
    assert isinstance(score, JevScoreAnswer)
    assert score.score == 2 and score.probabilities["2"] == pytest.approx(0.8)
    assert decision.model == "typesafe/jev-1.13-20260917"
    assert decision.input_tokens == 300
    assert decision.cost_usd == pytest.approx(0.0000126)


def test_decide_requires_api_key(monkeypatch):
    monkeypatch.setattr(jev_mod, "read_env", lambda name, default=None: default)
    client = JevClient()
    assert not client.is_configured()
    with pytest.raises(JevClientError):
        client.decide(state="x", questions={"q": jev_noul("?")})


def test_decide_retries_transient_status(fake_env, monkeypatch):
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] == 1:
            return httpx.Response(529, json={"error": {"message": "overloaded"}})
        return httpx.Response(200, json=_decision_payload())

    client = _client(handler, monkeypatch)
    monkeypatch.setattr(jev_mod.time, "sleep", lambda _s: None)
    decision = client.decide(state="x", questions={"needs_files": jev_noul("?")})
    assert calls["count"] == 2
    assert decision.answers["needs_files"].probability == pytest.approx(0.98)


def test_decide_non_transient_raises_immediately(fake_env, monkeypatch):
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(422, json={"error": {"message": "bad question"}})

    client = _client(handler, monkeypatch)
    with pytest.raises(JevClientError, match="422"):
        client.decide(state="x", questions={"q": jev_noul("?")})
    assert calls["count"] == 1


def test_decide_network_error_is_transient(fake_env, monkeypatch):
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        raise httpx.ConnectError("boom")

    client = _client(handler, monkeypatch)
    monkeypatch.setattr(jev_mod.time, "sleep", lambda _s: None)
    with pytest.raises(JevClientError):
        client.decide(state="x", questions={"q": jev_noul("?")})
    assert calls["count"] == 2  # JEV_MAX_RETRIES default


def test_decide_rejects_empty_questions(fake_env):
    client = JevClient()
    with pytest.raises(JevClientError):
        client.decide(state="x", questions={})


def test_base_url_appends_v1_and_strips_systemone(fake_env, monkeypatch):
    client = JevClient()
    monkeypatch.setattr(
        jev_mod,
        "read_env",
        lambda name, default=None: {"JEV_BASE_URL": "https://jev.test/api"}.get(name, default),
    )
    assert client._resolve_base_url() == "https://jev.test/api/v1"
    monkeypatch.setattr(
        jev_mod,
        "read_env",
        lambda name, default=None: {
            "JEV_BASE_URL": "https://jev.test/api/v1/systemone"
        }.get(name, default),
    )
    assert client._resolve_base_url() == "https://jev.test/api/v1"
