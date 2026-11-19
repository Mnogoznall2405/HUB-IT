"""ForegroundTracker: active/idle split, periodic flush, blind gaps, stop flush.

The tracker's segment state machine (input-idle split via GetLastInputInfo,
periodic intermediate flushes, stalled-loop gaps, agent-stop flush) cannot be
reproduced through the ingest boundary — a unit test on the state machine is
the only way to pin each transition.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from browser_probe import foreground

WALL0 = 1_700_000_000.0


class _Clock:
    """Monotonic + wall clock driven by the test; wall = WALL0 + t."""

    def __init__(self) -> None:
        self.t = 0.0

    def monotonic(self) -> float:
        return self.t

    def time(self) -> float:
        return WALL0 + self.t


def _snap(title: str, url: str = "", hwnd: int = 100, browser: str = "edge"):
    return foreground.ForegroundSnapshot(
        hwnd=hwnd,
        browser=browser,
        process_name="msedge.exe",
        title=title,
        page_title=title,
        pid=1,
        url=url,
    )


class _Foreground:
    def __init__(self, snap=None):
        self.snap = snap

    def __call__(self, **kw):
        return self.snap


@pytest.fixture()
def clock(monkeypatch):
    c = _Clock()
    monkeypatch.setattr(foreground.time, "monotonic", c.monotonic)
    monkeypatch.setattr(foreground.time, "time", c.time)
    return c


def test_active_user_tab_change_reports_dwell_and_zero_idle(monkeypatch, clock):
    fg = _Foreground(_snap("Tab A", url="https://a.example"))
    monkeypatch.setattr(foreground, "get_foreground_browser", fg)
    monkeypatch.setattr(foreground, "get_idle_seconds", lambda **_kwargs: 0.0)
    tracker = foreground.ForegroundTracker()

    # Poll every 3 s (the production interval) — deltas above the blind-gap
    # threshold would not count as observed dwell.
    for tick in range(0, 30, 3):
        clock.t = float(tick)
        tracker.poll()
    clock.t = 30.0
    fg.snap = _snap("Tab B", url="https://b.example")
    _, closed = tracker.poll()

    assert closed is not None
    assert closed["dwell_sec"] == 30.0
    assert closed["idle_sec"] == 0.0
    assert closed["session_dwell_sec"] == 30.0
    assert closed["schema"] == 2
    assert closed["source"] == "focus"
    assert closed["ended_at"] == pytest.approx(WALL0 + 30.0)


def test_idle_beyond_threshold_moves_to_idle_not_dwell(monkeypatch, clock):
    fg = _Foreground(_snap("Tab", url="https://a.example"))
    monkeypatch.setattr(foreground, "get_foreground_browser", fg)
    idle = {"sec": 0.0}
    monkeypatch.setattr(foreground, "get_idle_seconds", lambda **_kwargs: idle["sec"])
    tracker = foreground.ForegroundTracker()

    # Same tab for 10 min, poll every 3 s; last input was at t=0 so idle
    # grows 0 -> 600. The first 5 min count as active reading, the rest idle.
    events = []
    for tick in range(0, 601, 3):
        clock.t = float(tick)
        idle["sec"] = float(tick)
        _, closed = tracker.poll()
        if closed:
            events.append(closed)
    # The last 5 min are pure idle: they stay in the still-open segment until
    # the slower idle flush interval — emit it via the agent-stop flush.
    closed = tracker.flush()
    if closed:
        events.append(closed)

    assert sum(e["dwell_sec"] for e in events) == pytest.approx(300.0, abs=5.0)
    assert sum(e["idle_sec"] for e in events) == pytest.approx(300.0, abs=5.0)


def test_periodic_flush_emits_minute_segments_with_running_session(monkeypatch, clock):
    monkeypatch.setattr(
        foreground, "get_foreground_browser",
        _Foreground(_snap("Tab", url="https://a.example")),
    )
    monkeypatch.setattr(foreground, "get_idle_seconds", lambda **_kwargs: 0.0)
    # Production default is 300 s; minute segments keep the assertion readable.
    monkeypatch.setattr(foreground, "FLUSH_SEC", 60.0)
    tracker = foreground.ForegroundTracker()

    events = []
    for tick in range(0, 181, 3):
        clock.t = float(tick)
        _, closed = tracker.poll()
        if closed:
            events.append(closed)

    assert [e["dwell_sec"] for e in events] == [60.0, 60.0, 60.0]
    assert events[-1]["session_dwell_sec"] == 180.0
    assert len({e["event_id"] for e in events}) == len(events)
    # The same key is still tracked after the flushes.
    assert tracker._key is not None
    assert tracker._started == 180.0


def test_pure_idle_segment_flushes_on_the_slower_idle_interval(monkeypatch, clock):
    monkeypatch.setattr(
        foreground, "get_foreground_browser",
        _Foreground(_snap("Tab", url="https://a.example")),
    )
    # Always past the idle threshold: the machine is unattended (screen-locked
    # user, forgotten tab). Keeps the production FLUSH_SEC/IDLE_FLUSH_SEC.
    monkeypatch.setattr(foreground, "get_idle_seconds", lambda **_kwargs: 100_000.0)
    tracker = foreground.ForegroundTracker()

    events = []
    for tick in range(0, 1801, 3):  # 30 min, poll every 3 s
        clock.t = float(tick)
        _, closed = tracker.poll()
        if closed:
            events.append(closed)

    # Pure-idle segments flush only every IDLE_FLUSH_SEC (900 s): 2 events,
    # all idle, no active dwell — an unattended PC must not spam dedup rows.
    assert len(events) == 2
    assert [e["idle_sec"] for e in events] == [900.0, 900.0]
    assert [e["dwell_sec"] for e in events] == [0.0, 0.0]
    assert len({e["event_id"] for e in events}) == 2


def test_blind_gap_closes_at_last_observation_and_excludes_the_gap(monkeypatch, clock):
    fg = _Foreground(_snap("Tab", url="https://a.example"))
    monkeypatch.setattr(foreground, "get_foreground_browser", fg)
    monkeypatch.setattr(foreground, "get_idle_seconds", lambda **_kwargs: 0.0)
    tracker = foreground.ForegroundTracker()

    clock.t = 0.0
    tracker.poll()
    clock.t = 3.0
    tracker.poll()
    # ~66 min stall (history hang / session lock), same window still foreground.
    clock.t = 4003.0
    snap, closed = tracker.poll()

    assert closed is not None
    # Only observed time counts: the event ends at the last real poll (t=3).
    assert closed["dwell_sec"] == 3.0
    assert closed["idle_sec"] == 0.0
    assert closed["ended_at"] == pytest.approx(WALL0 + 3.0)
    # Tracking restarts from now with a fresh segment and session.
    assert tracker._key == tracker._focus_key(snap)
    assert tracker._started == 4003.0
    assert tracker._session_active == 0.0


def test_late_omnibox_url_does_not_split_segment(monkeypatch, clock):
    fg = _Foreground(_snap("Tab", url=""))
    monkeypatch.setattr(foreground, "get_foreground_browser", fg)
    monkeypatch.setattr(foreground, "get_idle_seconds", lambda **_kwargs: 0.0)
    tracker = foreground.ForegroundTracker()

    for tick in range(0, 30, 3):
        clock.t = float(tick)
        tracker.poll()
    # Omnibox filled in late: same hwnd/browser/title, URL now known —
    # the segment must keep accruing instead of splitting into two events.
    fg.snap = _snap("Tab", url="https://a.example")
    clock.t = 30.0
    _, closed = tracker.poll()
    assert closed is None

    clock.t = 33.0
    fg.snap = _snap("Other", url="https://b.example", hwnd=200)
    _, closed = tracker.poll()
    assert closed is not None
    assert closed["dwell_sec"] == 33.0
    assert closed["url"] == "https://a.example"


def test_first_poll_emits_nothing(monkeypatch, clock):
    fg = _Foreground(_snap("Tab", url="https://a.example"))
    monkeypatch.setattr(foreground, "get_foreground_browser", fg)
    monkeypatch.setattr(foreground, "get_idle_seconds", lambda **_kwargs: 0.0)
    tracker = foreground.ForegroundTracker()

    clock.t = 10_000.0
    _, closed = tracker.poll()

    assert closed is None
    assert tracker._started == 10_000.0


def test_zero_interval_close_emits_no_event(monkeypatch, clock):
    fg = _Foreground(_snap("Tab", url="https://a.example"))
    monkeypatch.setattr(foreground, "get_foreground_browser", fg)
    monkeypatch.setattr(foreground, "get_idle_seconds", lambda **_kwargs: 0.0)
    tracker = foreground.ForegroundTracker()

    clock.t = 0.0
    tracker.poll()
    fg.snap = None  # browser leaves foreground within the same instant
    _, closed = tracker.poll()

    assert closed is None


def test_flush_returns_open_segment_once_then_none(monkeypatch, clock):
    fg = _Foreground(_snap("Tab", url="https://a.example"))
    monkeypatch.setattr(foreground, "get_foreground_browser", fg)
    monkeypatch.setattr(foreground, "get_idle_seconds", lambda **_kwargs: 0.0)
    tracker = foreground.ForegroundTracker()

    for tick in range(0, 31, 3):
        clock.t = float(tick)
        tracker.poll()

    closed = tracker.flush()
    assert closed is not None
    assert closed["dwell_sec"] == 30.0
    assert closed["ended_at"] == pytest.approx(WALL0 + 30.0)
    assert tracker.flush() is None
    assert tracker._key is None


def test_flush_without_segment_returns_none(monkeypatch, clock):
    monkeypatch.setattr(foreground, "get_idle_seconds", lambda **_kwargs: 0.0)
    tracker = foreground.ForegroundTracker()
    assert tracker.flush() is None

def test_sensor_failure_closes_focus_at_last_observation(monkeypatch, clock):
    fg = _Foreground(_snap("Tab", url="https://a.example"))
    monkeypatch.setattr(foreground, "get_foreground_browser", fg)
    idle = {"sec": 0.0}
    monkeypatch.setattr(foreground, "get_idle_seconds", lambda **_kwargs: idle["sec"])
    tracker = foreground.ForegroundTracker()

    clock.t = 0.0
    tracker.poll()
    clock.t = 3.0
    _, closed = tracker.poll()
    assert closed is None

    # Sensor read fails: the interval is unknown — close at the last real
    # observation (t=3) instead of treating it as active dwell.
    idle["sec"] = None
    clock.t = 6.0
    _, closed = tracker.poll()
    assert closed is not None
    assert closed["dwell_sec"] == pytest.approx(3.0)
    assert closed["ended_at"] == pytest.approx(WALL0 + 3.0)

    # The sensor recovers: a fresh segment/session starts from the recovery
    # poll — the unknown interval must not be bridged into either counter.
    idle["sec"] = 0.0
    clock.t = 9.0
    _, closed = tracker.poll()
    assert closed is None
    closed = tracker.flush()
    assert closed is not None
    assert closed["dwell_sec"] == pytest.approx(3.0)
    assert closed["session_dwell_sec"] == pytest.approx(3.0)


def test_omnibox_cache_refreshes_stale_url_after_30s(monkeypatch, clock):
    urls = iter(("https://old.example", "https://new.example"))
    calls = []
    monkeypatch.setattr(
        foreground, "read_omnibox_url",
        lambda _hwnd: calls.append(clock.t) or next(urls),
    )
    foreground._omnibox_cache.clear()

    assert foreground._omnibox_url_cached(1, "Tab") == "https://old.example"
    clock.t = 3.0
    assert foreground._omnibox_url_cached(1, "Tab") == "https://old.example"
    clock.t = 29.0
    assert foreground._omnibox_url_cached(1, "Tab") == "https://old.example"
    assert calls == [0.0]  # positive URL: at most one UIA read per 30 s

    clock.t = 30.0
    assert foreground._omnibox_url_cached(1, "Tab") == "https://new.example"
    assert calls == [0.0, 30.0]
    clock.t = 31.0
    assert foreground._omnibox_url_cached(1, "Tab") == "https://new.example"
    assert calls == [0.0, 30.0]
    foreground._omnibox_cache.clear()


def test_same_title_spa_url_change_splits_segment_on_refresh(monkeypatch, clock):
    fg = _Foreground(_snap("Same Title", url="https://old.example"))
    monkeypatch.setattr(foreground, "get_foreground_browser", fg)
    monkeypatch.setattr(foreground, "get_idle_seconds", lambda **_kwargs: 0.0)
    tracker = foreground.ForegroundTracker()

    clock.t = 0.0
    tracker.poll()
    clock.t = 3.0
    _, closed = tracker.poll()
    assert closed is None
    clock.t = 6.0
    _, closed = tracker.poll()
    assert closed is None  # still the cached URL — no fabricated extra event

    # The refresh exposes a same-title SPA navigation: the old segment closes
    # at the observation point and a new one opens for the new URL.
    fg.snap = _snap("Same Title", url="https://new.example")
    clock.t = 9.0
    _, closed = tracker.poll()
    assert closed is not None
    assert closed["url"] == "https://old.example"
    assert closed["dwell_sec"] == pytest.approx(9.0)

    clock.t = 12.0
    tracker.poll()
    closed = tracker.flush()
    assert closed is not None
    assert closed["url"] == "https://new.example"
    assert closed["dwell_sec"] == pytest.approx(3.0)


def test_get_idle_seconds_native_failure_returns_on_error_default_zero(monkeypatch):
    import ctypes

    windll = getattr(ctypes, "windll", None)
    if windll is None:
        pytest.skip("GetLastInputInfo is Windows-only")
    monkeypatch.setattr(windll.user32, "GetLastInputInfo", lambda *_: 0, raising=False)
    assert foreground.get_idle_seconds(on_error=None) is None
    assert foreground.get_idle_seconds() == 0.0
