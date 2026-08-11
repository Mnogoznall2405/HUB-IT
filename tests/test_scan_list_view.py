import pytest
from fastapi.testclient import TestClient

import scan_server.app as scan_app
from scan_server.scan_view import InvalidScanView, normalize_scan_list_view


@pytest.mark.parametrize(
    "raw,default,expected",
    [
        (None, "detail", "detail"),
        ("", "detail", "detail"),
        ("   ", "summary", "summary"),
        ("summary", "detail", "summary"),
        ("SUMMARY", "detail", "summary"),
        ("detail", "summary", "detail"),
        ("Detail", "summary", "detail"),
    ],
)
def test_normalize_scan_list_view_accepts(raw, default, expected):
    assert normalize_scan_list_view(raw, default=default) == expected


@pytest.mark.parametrize("raw", ["light", "list", "chart", "foo", "unknown", " summaryx"])
def test_normalize_scan_list_view_rejects_unknown(raw):
    with pytest.raises(InvalidScanView):
        normalize_scan_list_view(raw, default="detail")


def _override_inbox_read_dependency():
    for route in scan_app.app.routes:
        if getattr(route, "path", "") == "/api/v1/scan/incidents/inbox-groups":
            for dependency in route.dependant.dependencies:
                scan_app.app.dependency_overrides[dependency.call] = lambda: {
                    "id": 1,
                    "role": "admin",
                    "permissions": ["scan.read"],
                }
            return
    raise AssertionError("inbox-groups route not found")


def test_inbox_unknown_view_is_422_not_detail(monkeypatch):
    calls = []

    class FakeStore:
        def list_incident_inbox_groups(self, **kwargs):
            calls.append(kwargs)
            return {
                "items": [],
                "total_hosts": 0,
                "total_incidents": 0,
                "view": kwargs.get("view"),
            }

    monkeypatch.setattr(scan_app, "store", FakeStore())
    _override_inbox_read_dependency()
    client = TestClient(scan_app.app)
    try:
        resp = client.get("/api/v1/scan/incidents/inbox-groups?view=garbage")
        assert resp.status_code == 422, resp.text
        assert calls == []

        resp_empty = client.get("/api/v1/scan/incidents/inbox-groups?view=")
        assert resp_empty.status_code == 200, resp_empty.text
        assert calls and calls[-1]["view"] == "detail"

        resp_sum = client.get("/api/v1/scan/incidents/inbox-groups?view=SUMMARY")
        assert resp_sum.status_code == 200, resp_sum.text
        assert calls[-1]["view"] == "summary"

        resp_space = client.get("/api/v1/scan/incidents/inbox-groups?view=%20%20")
        assert resp_space.status_code == 200, resp_space.text
        assert calls[-1]["view"] == "detail"
    finally:
        scan_app.app.dependency_overrides.clear()


def test_inbox_summary_omitted_files_per_host_defaults_to_zero(monkeypatch):
    calls = []

    class FakeStore:
        def list_incident_inbox_groups(self, **kwargs):
            calls.append(kwargs)
            return {
                "items": [],
                "total_hosts": 0,
                "total_incidents": 0,
                "files_per_host": kwargs.get("files_per_host"),
                "view": kwargs.get("view"),
            }

    monkeypatch.setattr(scan_app, "store", FakeStore())
    _override_inbox_read_dependency()
    client = TestClient(scan_app.app)
    try:
        resp = client.get("/api/v1/scan/incidents/inbox-groups?view=summary")
        assert resp.status_code == 200, resp.text
        assert calls[-1]["view"] == "summary"
        # API omits → None; store layer maps summary+None → 0.
        assert calls[-1]["files_per_host"] is None

        resp_detail = client.get("/api/v1/scan/incidents/inbox-groups?view=detail")
        assert resp_detail.status_code == 200, resp_detail.text
        assert calls[-1]["view"] == "detail"
        assert calls[-1]["files_per_host"] is None
    finally:
        scan_app.app.dependency_overrides.clear()


def test_store_inbox_summary_default_files_per_host_is_zero(temp_dir):
    from pathlib import Path

    from scan_server.database import ScanStore

    root = Path(temp_dir)
    store = ScanStore(
        db_path=root / "scan-server.db",
        archive_dir=root / "archive",
        task_ack_timeout_sec=300,
        agent_online_timeout_sec=1800,
    )
    out = store.list_incident_inbox_groups(view="summary")
    assert out["files_per_host"] == 0
    out_detail = store.list_incident_inbox_groups(view="detail")
    assert out_detail["files_per_host"] == 25


def test_store_rejects_unknown_view_before_sql(temp_dir):
    from pathlib import Path

    from scan_server.database import ScanStore

    root = Path(temp_dir)
    store = ScanStore(
        db_path=root / "scan-server.db",
        archive_dir=root / "archive",
        task_ack_timeout_sec=300,
        agent_online_timeout_sec=1800,
    )
    with pytest.raises(InvalidScanView):
        store.list_incomplete_jobs(view="nope")
    with pytest.raises(InvalidScanView):
        store.list_tasks(view="light")
