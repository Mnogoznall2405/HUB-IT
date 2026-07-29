from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend import internal_docflow_gateway as gateway  # noqa: E402


class _FakeGatewayService:
    def __init__(self) -> None:
        self.calls = []

    async def gateway_call(self, **payload):
        self.calls.append(payload)
        return {"items": [], "source": "live_1c"}

    def shutdown(self):
        return None


def test_gateway_is_loopback_token_protected_and_accepts_only_typed_operations(monkeypatch):
    token = "gateway-test-token-that-is-longer-than-thirty-two-bytes"
    monkeypatch.setenv("DOCFLOW_GATEWAY_TOKEN", token)
    service = _FakeGatewayService()
    monkeypatch.setattr(gateway, "docflow_service", service)

    with TestClient(gateway.app) as client:
        denied = client.post(
            "/internal/v1/call",
            json={"user_id": 17, "operation": "tasks", "payload": {}},
        )
        assert denied.status_code == 403

        accepted = client.post(
            "/internal/v1/call",
            headers={"X-Docflow-Gateway-Token": token},
            json={
                "user_id": 17,
                "operation": "tasks",
                "payload": {"scope": "inbox", "limit": 50},
                "correlation_id": "gateway-test",
            },
        )
        assert accepted.status_code == 200
        assert accepted.json()["result"]["source"] == "live_1c"
        assert service.calls == [{
            "user_id": 17,
            "operation": "tasks",
            "payload": {"scope": "inbox", "limit": 50},
        }]

        arbitrary = client.post(
            "/internal/v1/call",
            headers={"X-Docflow-Gateway-Token": token},
            json={"user_id": 17, "operation": "query", "payload": {"text": "..."}},
        )
        assert arbitrary.status_code == 422
