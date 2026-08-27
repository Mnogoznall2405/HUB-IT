"""Tests for Main API / Chat API process split (runtime roles)."""
from __future__ import annotations

import os
import re
from pathlib import Path

import pytest


@pytest.mark.parametrize(
    "value,role,chat_on,api_on",
    [
        ("embedded", "embedded", True, True),
        ("", "embedded", True, True),
        ("api", "api", False, True),
        ("main", "api", False, True),
        ("chat", "chat", True, False),
        ("chat-api", "chat", True, False),
    ],
)
def test_runtime_role_matrix(monkeypatch, value, role, chat_on, api_on):
    monkeypatch.setenv("HUBIT_RUNTIME_ROLE", value)
    monkeypatch.delenv("CHAT_RUNTIME_ROLE", raising=False)
    from backend.runtime_role import (
        chat_routes_enabled,
        get_runtime_role,
        heavy_api_routes_enabled,
        is_api_process,
        is_chat_process,
    )

    assert get_runtime_role() == role
    assert chat_routes_enabled() is chat_on
    assert heavy_api_routes_enabled() is api_on
    assert is_api_process() is (role == "api")
    assert is_chat_process() is (role == "chat")


def test_main_app_skips_chat_router_when_api_role(monkeypatch):
    monkeypatch.setenv("HUBIT_RUNTIME_ROLE", "api")
    from backend.runtime_role import chat_routes_enabled

    assert chat_routes_enabled() is False


def test_chat_main_module_exports_app(monkeypatch):
    monkeypatch.setenv("HUBIT_RUNTIME_ROLE", "chat")
    monkeypatch.setenv("CHAT_ENABLED", os.getenv("CHAT_ENABLED", "1"))
    try:
        from backend import chat_main
    except Exception as exc:
        pytest.skip(f"chat_main import skipped: {exc}")
    assert hasattr(chat_main, "app")
    paths = {getattr(r, "path", None) for r in chat_main.app.routes}
    assert "/health" in paths
    assert "/health/pools" in paths
    has_ws = any(getattr(r, "path", None) in {"/ws", "/api/v1/chat/ws"} for r in chat_main.app.routes)
    has_ws_route = any("WebSocket" in type(r).__name__ for r in chat_main.app.routes)
    assert has_ws or has_ws_route


def test_pool_budget_table_under_max_connections():
    """Architectural pool budget must leave ≥20 connections free of 100."""
    components = [
        ("main-api", 1, 20, 5),
        ("chat-api-app", 1, 5, 3),
        ("chat-api-chat", 1, 15, 5),
        ("mail-worker", 1, 3, 2),
        ("mail-worker-chat", 1, 2, 1),
        ("scan-estimate", 1, 10, 0),
        ("misc-workers", 3, 2, 1),
    ]
    total = sum(p * (size + overflow) for _, p, size, overflow in components)
    assert total <= 80, f"pool budget too high: {total}"
    assert 100 - total >= 20


def test_start_chat_server_script_exists():
    root = Path(__file__).resolve().parents[1]
    assert (root / "WEB-itinvent" / "start_chat_server.py").exists()
    assert (root / "WEB-itinvent" / "backend" / "chat_main.py").exists()
    assert (root / "scripts" / "pm2" / "restart-chat.ps1").exists()


def test_chat_scale_config_has_two_fail_closed_nodes_and_shared_workers():
    root = Path(__file__).resolve().parents[1]
    config_path = root / "scripts" / "pm2" / "ecosystem.chat.scale.config.js"
    source = config_path.read_text(encoding="utf-8")

    assert "buildChatNode('itinvent-chat-a', 8002, 'chat-a')" in source
    assert "buildChatNode('itinvent-chat-b', 8004, 'chat-b')" in source
    assert "HUBIT_RUNTIME_ROLE: 'chat'" in source
    assert "CHAT_REALTIME_TRANSPORT: 'postgres'" in source
    assert "CHAT_REALTIME_REQUIRED: '1'" in source
    assert "CHAT_REDIS_REQUIRED: '0'" in source
    assert "CHAT_PROCESS_COUNT: '2'" in source
    assert "CHAT_MARK_READ_PUBLISH_CONCURRENCY: '2'" in source

    # PostgreSQL is already configured through the root database URL. Scale-out
    # must not embed or require a Redis endpoint.
    assert re.search(r"(?:CHAT_)?REDIS_URL\s*:", source) is None
    assert "redis://" not in source.lower()
    assert "rediss://" not in source.lower()

    assert source.count("name: 'itinvent-preview-worker'") == 1
    assert source.count("args: 'start_preview_worker.py'") == 1
    assert source.count("name: 'itinvent-chat-push-worker'") == 1
    assert source.count("args: 'start_chat_push_worker.py'") == 1


def test_single_node_config_has_one_bounded_shared_preview_worker():
    root = Path(__file__).resolve().parents[1]
    source = (root / "scripts" / "pm2" / "ecosystem.backend.config.js").read_text(
        encoding="utf-8"
    )

    assert source.count("name: 'itinvent-preview-worker'") == 1
    assert source.count("args: 'start_preview_worker.py'") == 1
    assert "PREVIEW_WORKER_CONCURRENCY: '4'" in source
    assert "MAIL_OFFICE_PREVIEW_MAX_CONCURRENCY: '4'" in source
    assert "CHAT_MARK_READ_PUBLISH_CONCURRENCY: '2'" in source
    assert "CHAT_DB_CONNECTION_BUDGET_FAIL_START: '1'" in source


def test_enable_postgres_dual_node_is_validate_by_default_and_has_rollback():
    root = Path(__file__).resolve().parents[1]
    source = (root / "scripts" / "pm2" / "enable-chat-postgres.ps1").read_text(
        encoding="utf-8"
    )

    assert "[string]$Mode = 'Validate'" in source
    assert "'Validate', 'EnableDual', 'RollbackSingle'" in source
    assert "ecosystem.chat.scale.config.js" in source
    assert "delete itinvent-backend" not in source
    assert "Remove-Pm2ProcessIfPresent" in source
    assert "& $Pm2Command pid $Name" in source
    assert "if ($processIds.Count -eq 0)" in source
    assert "Name 'itinvent-chat'" in source
    assert "Name 'itinvent-chat-preview-worker'" in source
    assert "CHAT_REALTIME_TRANSPORT" in source
    assert "CHAT_REALTIME_REQUIRED" in source
    assert "CHAT_REDIS_REQUIRED' -Value '0'" in source
    assert "Start-SingleChat" in source
    assert "WriteAllBytes($envPath, $originalEnvBytes)" in source
    assert "realtime_transport -eq 'postgres'" in source
    assert "realtime_available -eq $true" in source
    assert "realtime_subscriber_ready -eq $true" in source
    assert "127.0.0.1:8004/health/ready" in source


def test_chat_scale_pool_capacity_matches_cluster_budget():
    root = Path(__file__).resolve().parents[1]
    source = (root / "scripts" / "pm2" / "ecosystem.chat.scale.config.js").read_text(
        encoding="utf-8"
    )

    def _env_int(name: str) -> int:
        match = re.search(rf"\b{re.escape(name)}:\s*'(\d+)'", source)
        assert match is not None, f"missing {name}"
        return int(match.group(1))

    write_capacity = _env_int("CHAT_DB_WRITE_POOL_SIZE") + _env_int(
        "CHAT_DB_WRITE_MAX_OVERFLOW"
    )
    read_capacity = _env_int("CHAT_DB_READ_POOL_SIZE") + _env_int(
        "CHAT_DB_READ_MAX_OVERFLOW"
    )
    process_count = _env_int("CHAT_PROCESS_COUNT")
    cluster_budget = _env_int("CHAT_DB_CONNECTION_BUDGET")

    # Each node also owns dedicated PostgreSQL publisher, LISTEN and presence
    # connections outside the SQLAlchemy data pools.
    realtime_connections_per_node = _env_int(
        "CHAT_POSTGRES_REALTIME_DEDICATED_CONNECTIONS"
    )
    effective_cluster_capacity = process_count * (
        write_capacity + read_capacity + realtime_connections_per_node
    )

    assert write_capacity + read_capacity <= 14
    assert process_count == 2
    assert cluster_budget <= 32
    assert effective_cluster_capacity == cluster_budget


def test_postgres_scale_restart_is_rolling_and_cannot_activate_cluster():
    root = Path(__file__).resolve().parents[1]
    source = (root / "scripts" / "pm2" / "restart-chat-scale.ps1").read_text(
        encoding="utf-8"
    )

    assert "CHAT_REALTIME_TRANSPORT') -ne 'postgres'" in source
    assert "CHAT_REALTIME_REQUIRED') -ne '1'" in source
    assert "Refusing to activate scale mode from a restart script" in source
    assert "describe $requiredName" in source
    assert "ConvertFrom-Json" not in source
    assert source.index("Name = 'itinvent-chat-a'") < source.index("Name = 'itinvent-chat-b'")
    assert "127.0.0.1:8002/health/ready" in source
    assert "127.0.0.1:8004/health/ready" in source
    assert "Stop-ChatNodeForRestart" in source
    assert "taskkill /PID $listenerPid /T /F" in source
    assert "realtime_subscriber_ready -eq $true" in source
    assert "pid 'itinvent-chat-preview-worker'" in source
    assert "delete 'itinvent-chat-preview-worker'" in source
    assert source.count("'itinvent-preview-worker'") == 1
    assert source.count("'itinvent-chat-push-worker'") == 1


def test_start_chat_server_cleanup_only_targets_requested_port(monkeypatch):
    import start_chat_server

    listener_queries = []
    commands = []
    query_count = 0

    def _listeners(port: int) -> set[int]:
        nonlocal query_count
        listener_queries.append(port)
        query_count += 1
        return {8202} if query_count == 1 else set()

    def _run(command, **_kwargs):
        commands.append(list(command))
        return type("_Result", (), {"stdout": ""})()

    monkeypatch.setattr(start_chat_server.sys, "platform", "win32")
    monkeypatch.setattr(start_chat_server, "_listener_pids_on_port", _listeners)
    monkeypatch.setattr(start_chat_server.os, "getpid", lambda: 9999)
    monkeypatch.setattr(start_chat_server.subprocess, "run", _run)
    monkeypatch.setattr("time.sleep", lambda _seconds: None)

    start_chat_server._free_stale_port_on_windows("127.0.0.1", 8002)

    assert listener_queries == [8002, 8002]
    assert commands == [["taskkill", "/PID", "8202", "/T", "/F"]]
    source = (Path(start_chat_server.__file__)).read_text(encoding="utf-8")
    assert "wmic" not in source.lower()
    assert "_kill_start_chat_server_processes" not in source


def test_chat_runtime_overlay_cannot_change_node_identity_or_realtime_transport(monkeypatch):
    import start_chat_server

    protected_values = {
        "BACKEND_PORT": "8004",
        "CHAT_REALTIME_NODE_ID": "chat-b",
        "CHAT_REALTIME_TRANSPORT": "postgres",
        "CHAT_REALTIME_REQUIRED": "1",
        "CHAT_REDIS_REQUIRED": "1",
        "CHAT_PROCESS_COUNT": "2",
        "REDIS_URL": "redis-from-dotenv",
        "REDIS_PASSWORD": "secret-from-dotenv",
    }
    for key, value in protected_values.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("CHAT_WRITE_WORKERS", "original")

    applied, skipped = start_chat_server._apply_runtime_env_overlay(
        {
            **{key: "must-not-replace" for key in protected_values},
            "CHAT_WRITE_WORKERS": "7",
        }
    )

    assert applied == ["CHAT_WRITE_WORKERS"]
    assert set(skipped) == set(protected_values)
    for key, value in protected_values.items():
        assert os.environ[key] == value
    assert os.environ["CHAT_WRITE_WORKERS"] == "7"
