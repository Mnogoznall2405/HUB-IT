from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _load_module():
    path = PROJECT_ROOT / "scripts" / "check_postgres_connection_budget.py"
    spec = importlib.util.spec_from_file_location("check_postgres_connection_budget", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_connection_budget_evaluation_requires_live_reserve_but_reports_projection():
    module = _load_module()
    evaluation = module.evaluate_connection_budget(
        max_connections=100,
        total_connections=79,
        managed_connections=65,
        configured_managed_capacity=71,
        reserve=20,
    )

    assert evaluation["available_now"] == 21
    assert evaluation["reserve_available_now"] is True
    assert evaluation["unmanaged_connections"] == 14
    assert evaluation["projected_total_connections"] == 85
    assert evaluation["projected_reserve_available"] is False


def test_dual_chat_budget_counts_explicit_legacy_read_pools():
    result = subprocess.run(
        ["node", str(PROJECT_ROOT / "scripts" / "pm2" / "postgres_connection_budget.js")],
        check=True,
        capture_output=True,
        text=True,
        cwd=PROJECT_ROOT,
    )
    budget = json.loads(result.stdout)
    processes = {item["name"]: item for item in budget["processes"]}

    assert processes["itinvent-backend"]["chat_db_capacity"] == 4
    assert processes["itinvent-mail-notification-worker"]["chat_db_capacity"] == 4
    assert processes["itinvent-chat-push-worker"]["chat_db_capacity"] == 4
    assert "itinvent-backend-chat-read" in budget["managed_application_names"]
