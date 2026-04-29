import importlib
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def test_chat_ws_rate_limiter_allows_burst_then_limits(monkeypatch):
    chat_api = importlib.import_module("backend.api.v1.chat")
    now = 1000.0
    monkeypatch.setattr(chat_api.time, "monotonic", lambda: now)
    limiter = chat_api._ChatWsCommandRateLimiter(rate_per_sec=20, burst=2)

    assert limiter.allow()[0] is True
    assert limiter.allow()[0] is True

    allowed, retry_after_ms = limiter.allow()

    assert allowed is False
    assert retry_after_ms >= 1000
    assert limiter.violations == 1


def test_chat_ws_rate_limiter_refills_over_time(monkeypatch):
    chat_api = importlib.import_module("backend.api.v1.chat")
    current = {"now": 1000.0}
    monkeypatch.setattr(chat_api.time, "monotonic", lambda: current["now"])
    limiter = chat_api._ChatWsCommandRateLimiter(rate_per_sec=2, burst=1)

    assert limiter.allow()[0] is True
    assert limiter.allow()[0] is False

    current["now"] += 0.5

    assert limiter.allow()[0] is True
