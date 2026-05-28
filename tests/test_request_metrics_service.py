from __future__ import annotations

import importlib
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

metrics_module = importlib.import_module("backend.services.request_metrics_service")
system_api_module = importlib.import_module("backend.api.v1.system")
auth_models_module = importlib.import_module("backend.models.auth")


def _build_admin_user():
    return auth_models_module.User(
        id=1,
        username="admin",
        email="admin@example.com",
        full_name="Admin",
        role="admin",
        is_active=True,
        permissions=[],
        use_custom_permissions=False,
        custom_permissions=[],
        auth_source="local",
        telegram_id=None,
        assigned_database=None,
    )


def test_request_metrics_middleware_records_templated_routes(monkeypatch):
    monkeypatch.setenv("REQUEST_METRICS_ENABLED", "1")
    metrics_module.request_metrics_service.reset()

    app = FastAPI()
    app.middleware("http")(metrics_module.request_metrics_middleware)

    @app.get("/items/{item_id}")
    async def get_item(item_id: int):
        return {"id": item_id}

    client = TestClient(app)
    response = client.get("/items/123")

    assert response.status_code == 200
    snapshot = metrics_module.request_metrics_service.snapshot(limit=10)
    routes = {(item["method"], item["path"]): item for item in snapshot["routes"]}
    assert routes[("GET", "/items/{item_id}")]["count"] == 1


def test_request_metrics_snapshot_reports_hotspots(monkeypatch):
    monkeypatch.setenv("REQUEST_METRICS_ENABLED", "1")
    monkeypatch.setenv("REQUEST_METRICS_SLOW_MS", "1000")
    metrics_module.request_metrics_service.reset()

    metrics_module.request_metrics_service.record(
        method="GET",
        path="/api/v1/mail/bootstrap",
        status_code=200,
        duration_ms=1500,
    )

    snapshot = metrics_module.request_metrics_service.snapshot(limit=10)
    assert snapshot["total_requests"] == 1
    assert snapshot["routes"][0]["p95_ms"] == 1500
    assert snapshot["hotspots"][0]["reason"] == "slow_p95"
    assert snapshot["hotspots"][0]["path"] == "/api/v1/mail/bootstrap"


def test_system_request_metrics_endpoint_is_admin_only_with_override(monkeypatch):
    monkeypatch.setenv("REQUEST_METRICS_ENABLED", "1")
    metrics_module.request_metrics_service.reset()
    metrics_module.request_metrics_service.record(
        method="POST",
        path="/api/v1/mail/messages/send",
        status_code=500,
        duration_ms=50,
    )

    app = FastAPI()
    app.include_router(system_api_module.router, prefix="/system")
    app.dependency_overrides[system_api_module.get_current_admin_user] = lambda: _build_admin_user()
    client = TestClient(app)

    response = client.get("/system/request-metrics", params={"sort_by": "server_error_count"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_requests"] == 1
    assert payload["total_server_errors"] == 1
    assert payload["routes"][0]["path"] == "/api/v1/mail/messages/send"
