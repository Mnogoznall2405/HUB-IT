"""Slow synchronous service calls must not freeze the event loop of the API process.

A blocking call inside an `async def` handler stops every other request, WebSocket and chat
connection of the process. The loop is probed by a ticker running next to the request.
"""
from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

import httpx
from fastapi import FastAPI

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import auth as auth_api
from backend.api.v1 import departments as departments_api
from backend.api.v1 import hub as hub_api
from backend.api.v1 import json_operations as json_operations_api
from backend.api.v1 import vcs as vcs_api
from backend.models.auth import User
from backend.services.authorization_service import PERM_SETTINGS_READ

SLOW_SECONDS = 0.4
MAX_ALLOWED_LOOP_GAP = 0.2


def _user() -> User:
    return User(
        id=77,
        username="loop-probe",
        role="viewer",
        is_active=True,
        permissions=[PERM_SETTINGS_READ],
        use_custom_permissions=True,
        custom_permissions=[PERM_SETTINGS_READ],
    )


def _slow(result):
    def call(*_args, **_kwargs):
        time.sleep(SLOW_SECONDS)
        return result
    return call


async def _max_loop_gap_during(app: FastAPI, method: str, url: str, **kwargs) -> tuple[int, float]:
    gaps: list[float] = []
    stop = asyncio.Event()

    async def ticker() -> None:
        last = time.perf_counter()
        while not stop.is_set():
            await asyncio.sleep(0.01)
            now = time.perf_counter()
            gaps.append(now - last)
            last = now

    task = asyncio.create_task(ticker())
    await asyncio.sleep(0.05)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.request(method, url, **kwargs)
    stop.set()
    await task
    return response.status_code, max(gaps)


def test_change_password_does_not_block_the_event_loop(monkeypatch):
    app = FastAPI()
    app.include_router(auth_api.router, prefix="/auth")
    app.dependency_overrides[deps.get_current_active_user] = _user
    monkeypatch.setattr(auth_api.user_service, "change_password", _slow(True))
    monkeypatch.setattr(auth_api.session_service, "close_user_sessions", lambda *_a, **_k: 0)
    monkeypatch.setattr(auth_api.session_service, "list_sessions", lambda *_a, **_k: [])
    monkeypatch.setattr(auth_api.trusted_device_service, "revoke_all_user_devices", lambda *_a, **_k: 0)
    monkeypatch.setattr(auth_api.mobile_biometric_session_service, "revoke_all_user_credentials", lambda *_a, **_k: 0)

    status, gap = asyncio.run(_max_loop_gap_during(
        app, "POST", "/auth/change-password", json={"old_password": "old-secret", "new_password": "new-secret"},
    ))

    assert status == 200
    assert gap < MAX_ALLOWED_LOOP_GAP, f"event loop was blocked for {gap:.2f}s"


def test_department_members_do_not_block_the_event_loop(monkeypatch):
    app = FastAPI()
    app.include_router(departments_api.router, prefix="/departments")
    app.dependency_overrides[deps.get_current_active_user] = _user
    monkeypatch.setattr(departments_api.department_service, "get_department", _slow({"id": "it", "name": "IT"}))
    monkeypatch.setattr(departments_api.department_service, "list_memberships", lambda **_k: [])
    monkeypatch.setattr(departments_api.user_service, "get_users_map_by_ids", lambda *_a, **_k: {})

    status, gap = asyncio.run(_max_loop_gap_during(app, "GET", "/departments/it/members"))

    assert status == 200
    assert gap < MAX_ALLOWED_LOOP_GAP, f"event loop was blocked for {gap:.2f}s"


def test_markdown_transform_llm_call_does_not_block_the_event_loop(monkeypatch):
    app = FastAPI()
    app.include_router(hub_api.router, prefix="/hub")
    app.dependency_overrides[deps.get_current_active_user] = _user
    monkeypatch.setattr(hub_api, "ensure_user_permission", lambda *_a, **_k: None)
    monkeypatch.setattr(hub_api, "ensure_user_any_permission", lambda *_a, **_k: None)
    monkeypatch.setattr(hub_api.markdown_transform_service, "transform_text", _slow({"markdown": "ok"}))

    status, gap = asyncio.run(_max_loop_gap_during(
        app, "POST", "/hub/markdown/transform", json={"context": "task", "text": "some text to format"},
    ))

    assert status == 200
    assert gap < MAX_ALLOWED_LOOP_GAP, f"event loop was blocked for {gap:.2f}s"


def test_vcs_launch_token_storage_does_not_block_the_event_loop(monkeypatch):
    app = FastAPI()
    app.include_router(vcs_api.router, prefix="/vcs")
    app.dependency_overrides[deps.get_current_active_user] = lambda: User(
        id=78, username="vcs-probe", role="admin", is_active=True, permissions=[],
    )
    monkeypatch.setattr(vcs_api, "_find_vcs_computer", _slow({"id": "c1", "ip_address": "10.0.0.1"}))
    monkeypatch.setattr(vcs_api.auth_runtime_store_service, "set_json", _slow(None))

    status, gap = asyncio.run(_max_loop_gap_during(app, "POST", "/vcs/computers/c1/launch-token"))

    assert status == 200
    assert gap < MAX_ALLOWED_LOOP_GAP, f"event loop was blocked for {gap:.2f}s"


def test_auth_rate_limit_counter_does_not_block_the_event_loop(monkeypatch):
    app = FastAPI()
    app.include_router(auth_api.router, prefix="/auth")
    app.dependency_overrides[deps.get_current_active_user] = _user
    app.dependency_overrides[auth_api.get_current_session_id] = lambda: "probe-session"
    monkeypatch.setattr(auth_api.auth_runtime_store_service, "increment_counter", _slow({"count": 1}))
    monkeypatch.setattr(auth_api.config.security, "webauthn_rp_id", "", raising=False)

    status, gap = asyncio.run(_max_loop_gap_during(
        app, "POST", "/auth/trusted-devices/register/options", json={},
    ))

    assert status == 503
    assert gap < MAX_ALLOWED_LOOP_GAP, f"event loop was blocked for {gap:.2f}s"


def test_cartridge_database_file_read_does_not_block_the_event_loop(monkeypatch):
    app = FastAPI()
    app.include_router(json_operations_api.router, prefix="/json")
    app.dependency_overrides[deps.get_current_active_user] = _user
    monkeypatch.setattr(json_operations_api.CartridgeDatabase, "is_color_printer", _slow(True))

    status, gap = asyncio.run(_max_loop_gap_during(app, "GET", "/json/cartridges/is-color/HP-M404"))

    assert status == 200
    assert gap < MAX_ALLOWED_LOOP_GAP, f"event loop was blocked for {gap:.2f}s"


def test_works_manager_storage_calls_do_not_block_the_event_loop():
    from types import SimpleNamespace

    app = FastAPI()
    app.include_router(json_operations_api.router, prefix="/json")
    app.dependency_overrides[deps.get_current_active_user] = _user
    app.dependency_overrides[json_operations_api.get_works_manager] = lambda: SimpleNamespace(
        get_all_works=_slow({"cartridge": [], "battery": [], "component": [], "cleaning": []}),
    )

    status, gap = asyncio.run(_max_loop_gap_during(app, "GET", "/json/works"))

    assert status == 200
    assert gap < MAX_ALLOWED_LOOP_GAP, f"event loop was blocked for {gap:.2f}s"
