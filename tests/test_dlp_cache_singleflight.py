"""Single-flight DLP cache: an ingest burst must not fan out identical scans.

Under load the aggregate queries take ~1min; before single-flight every
concurrent page request ran its own full-table scan, exhausting the pool.
A unit test is justified: the herd cannot be reproduced through the HTTP
boundary without timing-dependent concurrent load.
"""

import threading
from types import SimpleNamespace

from backend.services import fs_egress_store_service as service


def test_dlp_hosts_serves_stale_while_refresh_in_flight(monkeypatch):
    monkeypatch.setattr(
        service, "_dlp_cache", {"hosts": {"value": [{"computer_name": "h1"}], "expires": 0.0}}
    )
    monkeypatch.setattr(service, "_dlp_refreshing", set())
    started, release = threading.Event(), threading.Event()
    calls: list = []

    def slow_lister():
        calls.append(1)
        started.set()
        assert release.wait(10), "test harness: refresh never released"
        return [{"computer_name": "h2"}]

    monkeypatch.setattr(
        service,
        "get_egress_store",
        lambda: SimpleNamespace(list_dlp_host_stats=slow_lister),
    )

    worker = threading.Thread(target=service.list_dlp_hosts, daemon=True)
    worker.start()
    assert started.wait(10), "refresh did not start"

    stale = service.list_dlp_hosts()
    assert stale == [{"computer_name": "h1"}], "concurrent caller must get stale, not wait"

    release.set()
    worker.join(10)
    assert not worker.is_alive()
    assert len(calls) == 1, f"expected single-flight compute, got {len(calls)}"
    assert [r["computer_name"] for r in service._dlp_cache["hosts"]["value"]] == ["h2"]


def test_dlp_serve_returns_stale_on_compute_error(monkeypatch):
    monkeypatch.setattr(
        service, "_dlp_cache", {"k": {"value": "old", "expires": 0.0}}
    )
    monkeypatch.setattr(service, "_dlp_refreshing", set())

    def boom():
        raise RuntimeError("store down")

    assert service._dlp_serve("k", boom) == "old"
