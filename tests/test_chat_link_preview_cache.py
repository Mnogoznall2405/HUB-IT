"""Link previews are cached (success 1 h, failure 10 min): an unreachable site used to cost a
full 5 s fetch on every client request. Unit test because the cache TTL/negative-caching
behaviour is invisible through the HTTP boundary (no network in tests)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.chat import link_preview_service as svc


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    svc._preview_cache.clear()
    monkeypatch.setattr(svc, "assert_public_http_url", lambda url: None)
    yield
    svc._preview_cache.clear()


class _Response:
    headers = {"Content-Type": "text/html"}

    def __init__(self, html: str) -> None:
        self._html = html.encode()

    def read(self, _n):
        return self._html

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_successful_preview_is_fetched_once(monkeypatch):
    calls: list[str] = []

    def opener(request, timeout):
        calls.append(request.full_url)
        assert timeout == svc._PREVIEW_FETCH_TIMEOUT_SEC
        return _Response('<title>Отчёт</title><meta property="og:site_name" content="Hub">')

    monkeypatch.setattr(svc._LINK_PREVIEW_OPENER, "open", opener)
    first = svc.fetch_link_preview("https://example.org/a")
    second = svc.fetch_link_preview("https://example.org/a")
    assert first == second and first["title"] == "Отчёт" and first["site_name"] == "Hub"
    assert calls == ["https://example.org/a"]
    second["title"] = "mutated"  # callers cannot corrupt the cache
    assert svc.fetch_link_preview("https://example.org/a")["title"] == "Отчёт"


def test_unreachable_site_is_remembered_and_expires(monkeypatch):
    calls: list[str] = []

    def opener(request, timeout):
        calls.append(request.full_url)
        raise OSError("unreachable")

    monkeypatch.setattr(svc._LINK_PREVIEW_OPENER, "open", opener)
    for _ in range(3):
        with pytest.raises(HTTPException) as caught:
            svc.fetch_link_preview("https://down.example/x")
        assert caught.value.status_code == 422
    assert len(calls) == 1

    now = svc.time.monotonic()
    monkeypatch.setattr(svc.time, "monotonic", lambda: now + svc._PREVIEW_FAILURE_TTL_SEC + 1)
    with pytest.raises(HTTPException):
        svc.fetch_link_preview("https://down.example/x")
    assert len(calls) == 2
