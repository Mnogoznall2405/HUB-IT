from fastapi.testclient import TestClient

import scan_server.app as scan_app


def _override_read_dependency(path: str) -> None:
    for route in scan_app.app.routes:
        if getattr(route, "path", "") != path:
            continue
        for dependency in route.dependant.dependencies:
            scan_app.app.dependency_overrides[dependency.call] = lambda: {
                "id": 1,
                "role": "admin",
                "permissions": ["scan.read"],
            }
        return
    raise AssertionError(f"route not found: {path}")


def test_mobile_projection_allowlists_sensitive_scan_fields():
    incident = scan_app._mobile_scan_page(
        {
            "items": [{
                "id": "incident-1",
                "hostname": "HOST-1",
                "file_name": "secret.pdf",
                "file_path": r"C:\Users\employee\Documents\secret.pdf",
                "matched_patterns": [{"value": "classified", "snippet": "secret text"}],
                "payload_json": {"pdf_slice_b64": "sensitive"},
            }],
            "total": 1,
        },
        "incident",
    )
    agent = scan_app._mobile_scan_page(
        {
            "items": [{
                "agent_id": "agent-1",
                "active_task": {
                    "command": "scan_now",
                    "status": "acknowledged",
                    "payload": {"paths": [r"C:\Sensitive"]},
                },
                "last_task": {"payload": "sensitive"},
            }],
            "total": 1,
        },
        "agent",
    )

    assert incident["items"] == [{"id": "incident-1", "hostname": "HOST-1", "file_name": "secret.pdf"}]
    assert agent["items"] == [{
        "agent_id": "agent-1",
        "active_task": {"command": "scan_now", "status": "acknowledged"},
    }]
    assert incident["view"] == "mobile"


def test_incidents_mobile_view_uses_summary_store_and_redacts_response(monkeypatch):
    calls = []

    class FakeStore:
        def list_incidents(self, **kwargs):
            calls.append(kwargs)
            return {
                "items": [{
                    "id": "incident-1",
                    "hostname": "HOST-1",
                    "file_name": "secret.pdf",
                    "file_path": r"C:\Users\employee\secret.pdf",
                    "matched_patterns": [{"value": "secret", "snippet": "secret"}],
                }],
                "total": 1,
                "view": kwargs.get("view"),
            }

    monkeypatch.setattr(scan_app, "store", FakeStore())
    _override_read_dependency("/api/v1/scan/incidents")
    try:
        response = TestClient(scan_app.app).get("/api/v1/scan/incidents?view=mobile&limit=10")
    finally:
        scan_app.app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    assert calls[-1]["view"] == "summary"
    assert response.json()["items"] == [{
        "id": "incident-1",
        "hostname": "HOST-1",
        "file_name": "secret.pdf",
    }]
    assert response.json()["view"] == "mobile"
