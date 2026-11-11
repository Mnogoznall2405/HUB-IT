"""MFU list tool: counts of ALL printers with online/offline from the persisted monitor state.

The answer to «сколько МФУ онлайн» depended on a keyword filter (one device matched «МФУ» in its model name)
and on an in-memory cache the AI worker process does not have; both gave wrong or empty answers.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
for _p in (str(_ROOT), str(_ROOT / "WEB-itinvent")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

mfu = importlib.import_module("backend.ai_chat.tools.mfu")
context_module = importlib.import_module("backend.ai_chat.tools.context")

ROWS = [
    {"inv_no": "1", "type_name": "Принтер лазерный", "model_name": "HP LaserJet 402", "branch_name": "Москва", "ip_address": "10.0.0.1"},
    {"inv_no": "2", "type_name": "МФУ", "model_name": "Ricoh 22", "branch_name": "Москва", "ip_address": "10.0.0.2"},
    {"inv_no": "3", "type_name": "Принтер", "model_name": "Canon 03", "branch_name": "Тюмень", "ip_address": "10.0.0.3"},
    {"inv_no": "4", "type_name": "Ноутбук", "model_name": "ThinkPad", "branch_name": "Москва", "ip_address": ""},
]


def _ctx():
    return context_module.AiToolExecutionContext(
        bot_id="b", bot_title="t", conversation_id="c", run_id="r", user_id=5,
        user_payload={"id": 5, "role": "admin", "username": "u"},
        effective_database_id="ITINVENT", enabled_tools=[], tool_settings={},
    )


def _run(monkeypatch, **args):
    monkeypatch.setattr(mfu, "get_all_equipment_flat", lambda db_id, limit: ROWS)
    key = lambda inv: f"ITINVENT|{inv}"  # noqa: E731
    states = {
        key("1"): {"runtime": {"ping": {"status": "online", "checked_at": "2026-10-05T10:00:00Z"}}},
        key("2"): {"runtime": {"ping": {"status": "offline"}}},
    }
    monkeypatch.setattr(mfu, "_persisted_ping_states", lambda: states)
    monkeypatch.setattr(
        "backend.services.mfu_device_rows.normalize_device_row",
        lambda row, db_id: {"key": key(row["inv_no"])},
    )
    return mfu.MfuDevicesListTool().execute(context=_ctx(), args=mfu.MfuDevicesListArgs(**args))


def test_no_query_counts_every_printer_with_online_offline_unknown(monkeypatch):
    data = _run(monkeypatch).data
    assert data["total"] == 3  # the laptop is not a printer
    assert (data["ping_online"], data["ping_offline"], data["ping_unknown"]) == (1, 1, 1)
    assert {item["inv_no"]: item["ping"] for item in data["items"]} == {"1": "online", "2": "offline", "3": "unknown"}


def test_query_matches_device_type_not_only_model(monkeypatch):
    # «МФУ» is in the type of device 2 only (its model name has no such word)
    data = _run(monkeypatch, query="МФУ").data
    assert [item["inv_no"] for item in data["items"]] == ["2"]


def test_branch_limits_counts(monkeypatch):
    data = _run(monkeypatch, branch="Москва").data
    assert data["total"] == 2 and data["ping_online"] == 1 and data["ping_offline"] == 1
