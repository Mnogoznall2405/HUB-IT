import json
from types import SimpleNamespace

import pytest

from shared.llm.client import OpenRouterClient
from shared.llm.json_stream import extract_json_string_field


def _stream_in_chunks(text: str, size: int):
    """Feed the extractor chunk by chunk like a model stream and return every distinct result."""
    seen = []
    for end in range(size, len(text) + size, size):
        result = extract_json_string_field(text[:end], "answer_markdown")
        if result is not None and (not seen or seen[-1] != result):
            seen.append(result)
    return seen


@pytest.mark.parametrize("size", [1, 2, 3, 5, 7])
def test_extractor_handles_escapes_split_across_chunks(size):
    # Unicode escapes, a surrogate pair, escaped quotes and newlines split at any boundary.
    original = 'Привет "мир"\nстрока 2 \\ 😀 конец'
    raw = json.dumps({"answer_markdown": original, "tool_calls": []})  # ensure_ascii -> \uXXXX pairs
    seen = _stream_in_chunks(raw, size)
    texts = [text for text, _ in seen]
    # Cumulative text only grows; a partial escape never leaks garbage into it.
    for previous, current in zip(texts, texts[1:]):
        assert current.startswith(previous)
    assert seen[-1] == (original, True)
    assert all("\\u" not in text and "\ud83d" not in text for text in texts)


def test_extractor_waits_for_key_and_ignores_key_inside_tool_args():
    assert extract_json_string_field('{"tool_calls": [{"tool_id": "x", "args": {"q": "\\"answer_markdown\\": \\"no\\""}}], ', "answer_markdown") is None
    raw = '{"tool_calls": [], "answer_markdown": "после"}'
    assert extract_json_string_field(raw, "answer_markdown") == ("после", True)


def _chunk(content=None, usage=None):
    choices = [SimpleNamespace(delta=SimpleNamespace(content=content))] if content is not None else []
    return SimpleNamespace(choices=choices, usage=usage)


def _client_with_stream(monkeypatch, chunks, *, fail_on_stream=False):
    client = OpenRouterClient()
    calls = []

    def create(**kwargs):
        calls.append(kwargs)
        if kwargs.get("stream"):
            if fail_on_stream:
                raise RuntimeError("stream unsupported")
            return iter(chunks)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"answer_markdown": "plain"}'))],
            usage=SimpleNamespace(prompt_tokens=1, completion_tokens=2, total_tokens=3),
        )

    monkeypatch.setattr(
        client, "_build_client",
        lambda **kw: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))),
    )
    return client, calls


def test_complete_json_streams_text_and_reads_usage(monkeypatch):
    usage = SimpleNamespace(prompt_tokens=10, completion_tokens=20, total_tokens=30)
    chunks = [
        _chunk('{"answer_markdown": "Пер'),
        _chunk('вый ответ", "tool_calls": []}'),
        _chunk(usage=usage),
    ]
    client, calls = _client_with_stream(monkeypatch, chunks)
    deltas = []

    payload, got_usage = client.complete_json(
        system_prompt="s", user_prompt="u", model="m", on_text_delta=deltas.append,
    )

    assert payload == {"answer_markdown": "Первый ответ", "tool_calls": []}
    assert deltas == ["Пер", "Первый ответ"]
    assert got_usage["total_tokens"] == 30
    assert calls[0]["stream"] is True and calls[0]["stream_options"] == {"include_usage": True}


def test_complete_json_falls_back_to_plain_request_when_stream_fails(monkeypatch):
    client, calls = _client_with_stream(monkeypatch, [], fail_on_stream=True)
    deltas = []

    payload, _ = client.complete_json(system_prompt="s", user_prompt="u", model="m", on_text_delta=deltas.append)

    assert payload == {"answer_markdown": "plain"}
    assert [bool(call.get("stream")) for call in calls][-1] is False


def test_callback_exception_propagates_and_stream_is_closed(monkeypatch):
    closed = []

    class Stream:
        def __iter__(self):
            yield _chunk('{"answer_markdown": "текст')
            yield _chunk(' ещё"}')

        def close(self):
            closed.append(True)

    client, _ = _client_with_stream(monkeypatch, [])
    monkeypatch.setattr(
        client, "_build_client",
        lambda **kw: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **k: Stream()))),
    )

    class Cancelled(Exception):
        pass

    def on_delta(_text):
        raise Cancelled()

    with pytest.raises(Cancelled):
        client.complete_json(system_prompt="s", user_prompt="u", model="m", on_text_delta=on_delta)
    assert closed == [True]
