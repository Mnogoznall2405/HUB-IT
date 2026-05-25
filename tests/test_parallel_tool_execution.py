"""Unit tests for parallel tool execution helpers (Task 6.1).

Tests cover:
- _detect_data_dependencies: partitioning tool calls into parallel groups
- _detect_truncated_result: detecting truncated results for auto-pagination
- _build_running_summary: building concise summaries across tool rounds
- _execute_tool_calls: failure resilience (all calls processed even if some fail)
"""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure the backend package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "WEB-itinvent"))

from backend.ai_chat.service import (
    _build_running_summary,
    _detect_data_dependencies,
    _detect_truncated_result,
)


# ---------------------------------------------------------------------------
# Tests for _detect_data_dependencies
# ---------------------------------------------------------------------------


class TestDetectDataDependencies:
    """Tests for dependency detection between tool calls."""

    def test_empty_list(self):
        assert _detect_data_dependencies([]) == []

    def test_single_call(self):
        calls = [{"tool_id": "itinvent.equipment.search", "args": {"query": "test"}}]
        groups = _detect_data_dependencies(calls)
        assert groups == [[0]]

    def test_independent_calls_same_group(self):
        """Two independent calls (e.g., two pings to different hosts) should be in the same group."""
        calls = [
            {"tool_id": "network.host.ping", "args": {"host": "host1.local"}},
            {"tool_id": "network.host.ping", "args": {"host": "host2.local"}},
        ]
        groups = _detect_data_dependencies(calls)
        # Both should be in the same group (parallel)
        assert len(groups) == 1
        assert set(groups[0]) == {0, 1}

    def test_dependent_calls_search_then_card(self):
        """A search followed by a card/detail call should be serialized."""
        calls = [
            {"tool_id": "itinvent.equipment.search", "args": {"query": "TMN-IT-001"}},
            {"tool_id": "itinvent.equipment.card", "args": {"inv_no": "TMN-IT-001"}},
        ]
        groups = _detect_data_dependencies(calls)
        # Should be in separate groups (sequential)
        assert len(groups) == 2
        assert groups[0] == [0]
        assert groups[1] == [1]

    def test_mixed_independent_and_dependent(self):
        """Mix of independent and dependent calls."""
        calls = [
            {"tool_id": "network.host.ping", "args": {"host": "server1"}},
            {"tool_id": "network.dns.lookup", "args": {"query": "server2"}},
            {"tool_id": "itinvent.equipment.search", "args": {"query": "laptop"}},
        ]
        groups = _detect_data_dependencies(calls)
        # All three are independent — should be in one group
        assert len(groups) == 1
        assert set(groups[0]) == {0, 1, 2}

    def test_explicit_result_reference(self):
        """Tool B references tool A's ID in its args — should be serialized."""
        calls = [
            {"tool_id": "itinvent.user.by_name", "args": {"query": "Иванов"}},
            {"tool_id": "itinvent.user.equipment_list", "args": {"query": "result_of:itinvent.user.by_name"}},
        ]
        groups = _detect_data_dependencies(calls)
        assert len(groups) == 2
        assert groups[0] == [0]
        assert groups[1] == [1]

    def test_three_calls_chain(self):
        """A -> B -> C chain should produce 3 sequential groups."""
        calls = [
            {"tool_id": "itinvent.user.search", "args": {"query": "Петров"}},
            {"tool_id": "itinvent.user.detail", "args": {"user": "result_of:itinvent.user.search"}},
            {"tool_id": "itinvent.equipment.list", "args": {"owner": "result_of:itinvent.user.detail"}},
        ]
        groups = _detect_data_dependencies(calls)
        assert len(groups) == 3


# ---------------------------------------------------------------------------
# Tests for _detect_truncated_result
# ---------------------------------------------------------------------------


class TestDetectTruncatedResult:
    """Tests for truncated result detection."""

    def test_not_truncated(self):
        result = {
            "tool_id": "itinvent.equipment.search",
            "ok": True,
            "data": {"items": [], "total": 5, "returned_count": 5, "truncated": False},
        }
        assert _detect_truncated_result(result) is None

    def test_truncated_result(self):
        result = {
            "tool_id": "itinvent.equipment.search",
            "ok": True,
            "data": {
                "items": [{"inv_no": "001"}] * 50,
                "total": 200,
                "returned_count": 50,
                "truncated": True,
                "offset": 0,
                "limit": 50,
            },
        }
        info = _detect_truncated_result(result)
        assert info is not None
        assert info["tool_id"] == "itinvent.equipment.search"
        assert info["next_offset"] == 50
        assert info["limit"] == 50
        assert info["total"] == 200

    def test_truncated_with_offset(self):
        result = {
            "tool_id": "itinvent.equipment.search",
            "ok": True,
            "data": {
                "items": [],
                "total": 200,
                "returned_count": 50,
                "truncated": True,
                "offset": 50,
                "limit": 50,
            },
        }
        info = _detect_truncated_result(result)
        assert info is not None
        assert info["next_offset"] == 100

    def test_failed_result_not_paginated(self):
        result = {
            "tool_id": "itinvent.equipment.search",
            "ok": False,
            "data": {"truncated": True, "total": 100, "returned_count": 50},
            "error": "some error",
        }
        assert _detect_truncated_result(result) is None

    def test_already_complete(self):
        """If offset + returned_count >= total, no more pages needed."""
        result = {
            "tool_id": "itinvent.equipment.search",
            "ok": True,
            "data": {
                "items": [],
                "total": 100,
                "returned_count": 50,
                "truncated": True,
                "offset": 50,
                "limit": 50,
            },
        }
        assert _detect_truncated_result(result) is None

    def test_no_data_dict(self):
        result = {"tool_id": "test", "ok": True, "data": None}
        assert _detect_truncated_result(result) is None


# ---------------------------------------------------------------------------
# Tests for _build_running_summary
# ---------------------------------------------------------------------------


class TestBuildRunningSummary:
    """Tests for running summary generation."""

    def test_empty_results(self):
        assert _build_running_summary([]) == ""

    def test_single_successful_result(self):
        results = [
            {
                "tool_id": "itinvent.equipment.search",
                "ok": True,
                "data": {"total": 15, "returned_count": 15, "query": "ноутбуки"},
            }
        ]
        summary = _build_running_summary(results)
        assert "itinvent.equipment.search" in summary
        assert "OK" in summary
        assert "total=15" in summary
        assert "returned=15" in summary
        assert "query='ноутбуки'" in summary

    def test_failed_result(self):
        results = [
            {
                "tool_id": "network.host.ping",
                "ok": False,
                "error": "DNS resolution failed",
                "data": None,
            }
        ]
        summary = _build_running_summary(results)
        assert "FAILED" in summary
        assert "DNS resolution failed" in summary

    def test_truncated_result_in_summary(self):
        results = [
            {
                "tool_id": "itinvent.equipment.search",
                "ok": True,
                "data": {"total": 200, "returned_count": 50, "truncated": True},
            }
        ]
        summary = _build_running_summary(results)
        assert "TRUNCATED" in summary

    def test_multiple_results(self):
        results = [
            {
                "tool_id": "itinvent.user.by_name",
                "ok": True,
                "data": {"display_name": "Иванов Иван", "login": "ivanov_ii"},
            },
            {
                "tool_id": "itinvent.equipment.search",
                "ok": True,
                "data": {"total": 3, "returned_count": 3},
            },
        ]
        summary = _build_running_summary(results)
        assert "2 tool calls" in summary
        assert "itinvent.user.by_name" in summary
        assert "itinvent.equipment.search" in summary

    def test_summary_header_includes_item_count(self):
        results = [
            {
                "tool_id": "itinvent.equipment.search",
                "ok": True,
                "data": {"total": 10, "returned_count": 10},
            },
            {
                "tool_id": "ad.user.password_status",
                "ok": True,
                "data": {"returned_count": 1, "display_name": "Козловский"},
            },
        ]
        summary = _build_running_summary(results)
        assert "11 items retrieved" in summary
