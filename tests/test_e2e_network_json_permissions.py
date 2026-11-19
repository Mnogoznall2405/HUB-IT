"""MED-01: read endpoints must enforce permissions, not bare authentication.

Every ``networks`` GET requires ``networks.read``; every ``/transfers`` and
``/works`` GET in json_operations requires ``database.read`` (the MFU
statistics keeps its own ``mfu.read``). The real ``require_permission``
dependency graph is checked per route and exercised through TestClient;
only the deepest boundaries (json managers, network service) are stubbed.
"""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import json_operations, networks  # noqa: E402
from backend.models.auth import User  # noqa: E402
from backend.services.authorization_service import (  # noqa: E402
    PERM_DATABASE_READ,
    PERM_MFU_READ,
    PERM_NETWORKS_READ,
)

VIEWER = User(id=7, username="ivanov", role="viewer", permissions=[])
OPERATOR = User(
    id=8,
    username="operator",
    role="operator",
    permissions=[PERM_DATABASE_READ, PERM_NETWORKS_READ],
)


class _StubTransferManager:
    def get_transfers(self, **kwargs):
        return [
            {
                "serial_number": "SN-1",
                "new_employee": "Petrov",
                "timestamp": "2026-01-01T00:00:00",
            }
        ]


@pytest.fixture
def perm_env(monkeypatch):
    branch_calls: list[str] = []
    monkeypatch.setattr(
        networks.network_service,
        "list_branches",
        lambda city: branch_calls.append(str(city)) or [{"id": 1, "branch_name": "HQ"}],
    )
    app = FastAPI()
    app.include_router(networks.router, prefix="/networks")
    app.include_router(json_operations.router, prefix="/json")
    # Deepest boundaries only: no real JSON/SQL stores are constructed.
    app.dependency_overrides[json_operations.get_transfer_manager] = _StubTransferManager
    app.dependency_overrides[json_operations.get_works_manager] = lambda: SimpleNamespace()
    app.dependency_overrides[json_operations.get_cartridge_database] = lambda: SimpleNamespace()
    app.dependency_overrides[deps.get_request_scoped_database_id] = lambda: None
    client = TestClient(app, raise_server_exceptions=False)

    def act_as(user: User) -> None:
        app.dependency_overrides[deps.get_current_active_user] = lambda: user

    return {"app": app, "client": client, "act_as": act_as, "branch_calls": branch_calls}


def _dependant_strings(dependant) -> set[str]:
    """String cells captured by dependency closures — require_permission's
    inner dependency carries the required permission constant."""
    found: set[str] = set()
    stack = [dependant]
    while stack:
        node = stack.pop()
        for cell in getattr(getattr(node, "call", None), "__closure__", None) or ():
            try:
                content = cell.cell_contents
            except ValueError:
                continue
            if isinstance(content, str):
                found.add(content)
        stack.extend(getattr(node, "dependencies", []) or [])
    return found


def _get_routes(router) -> list:
    return [r for r in router.routes if "GET" in (getattr(r, "methods", None) or set())]


def test_every_network_get_requires_networks_read():
    routes = _get_routes(networks.router)
    assert len(routes) == 12
    for route in routes:
        assert PERM_NETWORKS_READ in _dependant_strings(route.dependant), route.path


def test_every_transfers_and_works_get_requires_database_read():
    routes = [
        route
        for route in _get_routes(json_operations.router)
        if route.path.startswith("/transfers") or route.path.startswith("/works")
    ]
    assert len(routes) == 17
    for route in routes:
        required = PERM_MFU_READ if route.path == "/works/mfu/statistics" else PERM_DATABASE_READ
        assert required in _dependant_strings(route.dependant), route.path


@pytest.mark.parametrize(
    "path",
    [
        "/networks/branches",
        "/networks/branches/1/overview",
        "/networks/branches/1/ports",
        "/networks/audit",
        "/json/transfers",
        "/json/works",
        "/json/works/statistics/export",
        "/json/works/mfu/statistics",
    ],
)
def test_viewer_is_forbidden_on_protected_reads(perm_env, path):
    env = perm_env
    env["act_as"](VIEWER)

    assert env["client"].get(path).status_code == 403


def test_viewer_rejection_never_reaches_services(perm_env):
    env = perm_env
    env["act_as"](VIEWER)

    assert env["client"].get("/networks/branches").status_code == 403
    assert env["branch_calls"] == []


def test_operator_can_read_branches_and_transfers(perm_env):
    env = perm_env
    env["act_as"](OPERATOR)

    branches = env["client"].get("/networks/branches")
    assert branches.status_code == 200, branches.text
    assert branches.json()["branches"] == [{"id": 1, "branch_name": "HQ"}]
    assert env["branch_calls"] == ["tmn"]

    transfers = env["client"].get("/json/transfers")
    assert transfers.status_code == 200, transfers.text
    assert transfers.json()[0]["serial_number"] == "SN-1"
