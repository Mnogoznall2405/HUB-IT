"""Tests for the worker-log run-profile exporter (A5.1 cycle 3).

Reproduces the confirmed P1 defect: Python-formatted lists with spaces
(``used_tools=['a', 'b']``) lost every element after the first because the
``key=value`` regex could not see past the space.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = REPO_ROOT / "WEB-itinvent"
sys.path.insert(0, str(WEB_ROOT))

from backend.scripts import ai_run_profile_export as ex  # noqa: E402


def _line(run_id: str, **kv) -> str:
    parts = [f"{k}={v}" for k, v in kv.items()]
    return f"ai_run_profile_final run_id={run_id} " + " ".join(parts)


def _export(lines: list[str]) -> dict:
    """Parse log lines through the real exporter code path (stdin)."""
    import io

    old_argv, old_stdin = sys.argv, sys.stdin
    try:
        sys.argv = ["export", "--log", "-"]
        sys.stdin = io.StringIO("\n".join(lines))
        import contextlib

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            assert ex.main() == 0
        return json.loads(buf.getvalue())
    finally:
        sys.argv, sys.stdin = old_argv, old_stdin


def test_p1_multi_tool_list_with_spaces_is_not_truncated():
    """Reproduction: the exact reviewed line must yield executed=2, error=2."""
    out = _export([
        _line(
            "run-001",
            outcome="completed",
            queue_wait_ms="15.0",
            processing_ms="240.0",
            server_total_ms="255.0",
            intent="read",
            mode_denied="0",
            used_tools="['directory.people.search', 'office.mail.search']",
            error_tools="['office.tasks.search', 'kb.articles.search']",
            meta_calls="0",
            prompt_tokens="100",
            completion_tokens="20",
            total_tokens="120",
        )
    ])
    assert out["tools"]["executed_calls"] == 2
    assert out["tools"]["error_calls"] == 2
    assert out["tools"]["mode_denied_calls"] == 0
    assert out["tools"]["meta_calls"] == 0


def test_single_tool_in_used_tools():
    out = _export([_line("r1", intent="read", server_total_ms="10.0",
                         used_tools="['directory.people.search']", error_tools="[]")])
    assert out["tools"]["executed_calls"] == 1
    assert out["tools"]["error_calls"] == 0


def test_empty_lists_parse_as_zero():
    out = _export([_line("r1", intent="chat", used_tools="[]", error_tools="[]",
                         server_total_ms="5.0")])
    assert out["tools"]["executed_calls"] == 0
    assert out["tools"]["error_calls"] == 0


def test_mixed_ok_and_error_tools():
    out = _export([_line(
        "r1", intent="read",
        used_tools="['directory.people.search']",
        error_tools="['office.tasks.search']",
        server_total_ms="50.0",
    )])
    assert out["tools"]["executed_calls"] == 1
    assert out["tools"]["error_calls"] == 1


def test_interleaved_run_ids_are_separated():
    out = _export([
        "ai_chat.run.queue_wait duration_ms=10.0 run_id=a",
        "ai_chat.run.queue_wait duration_ms=20.0 run_id=b",
        "ai_chat.run.context duration_ms=100.0 run_id=a",
        "ai_chat.run.context duration_ms=200.0 run_id=b",
        _line("a", intent="chat", server_total_ms="300.0"),
        _line("b", intent="read", server_total_ms="600.0"),
    ])
    assert out["runs"] == 2
    assert out["stages"]["context"]["count"] == 2
    assert out["by_intent_mode"]["chat"]["server_total"]["p50_ms"] == 300.0
    assert out["by_intent_mode"]["read"]["server_total"]["p50_ms"] == 600.0


def test_incomplete_run_without_final_profile():
    out = _export([
        "ai_chat.run.queue_wait duration_ms=5.0 run_id=lost",
        "ai_chat.run.context duration_ms=10.0 run_id=lost",
    ])
    assert out["profiles"] == {"complete": 0, "incomplete": 1}
    assert out["stages"]["context"]["count"] == 1


def test_corrupted_line_does_not_stop_processing():
    out = _export([
        "ai_run_profile_final run_id=broken garbage!!! = = not-a-line",
        _line("good", intent="chat", server_total_ms="42.0"),
    ])
    assert out["profiles"]["complete"] == 1
    assert out["by_intent_mode"]["chat"]["count"] == 1


def test_cache_hit_miss_and_jev_latency():
    out = _export([
        "ai_jev_routing_cache miss mode=groups run_id=m1",
        "ai_jev_routing probs={'office': 0.9} routed=['office'] intent=read latency_ms=410.5 model=jev run_id=m1",
        _line("m1", intent="read", server_total_ms="1000.0"),
        "ai_jev_routing_cache hit mode=groups routed=['office'] run_id=m2",
        _line("m2", intent="read", server_total_ms="400.0"),
        _line("m3", intent="chat", server_total_ms="100.0"),
    ])
    assert out["jev_cache"] == {"hit": 1, "miss": 1, "none": 1}
    assert out["by_cache"]["miss"]["jev_ms"]["p50_ms"] == 410.5
    assert out["by_cache"]["hit"]["server_total_ms"]["p50_ms"] == 400.0


def test_multi_round_laps_aggregate_per_run_not_double_counted():
    out = _export([
        "ai_chat.run.llm_followup duration_ms=300.0 run_id=r1 round=1",
        "ai_chat.run.llm_followup duration_ms=250.0 run_id=r1 round=2",
        "ai_chat.run.tools duration_ms=100.0 run_id=r1 round=1",
        "ai_chat.run.tools duration_ms=80.0 run_id=r1 round=2",
        _line("r1", intent="read", server_total_ms="1000.0"),
    ])
    # per-run totals: followup 550 (two rounds), tools 180 — counted once each
    assert out["stages"]["llm_followup"]["count"] == 1
    assert out["stages"]["llm_followup"]["p50_ms"] == 550.0
    assert out["stages"]["llm_followup"]["rounds"] == 2
    assert out["stages"]["tools"]["p50_ms"] == 180.0


def test_outcome_split_and_server_total():
    out = _export([
        _line("ok1", outcome="completed", intent="read", server_total_ms="500.0"),
        _line("bad", outcome="failed", intent="-", server_total_ms="50.0"),
        _line("cx", outcome="cancelled", intent="chat", server_total_ms="30.0"),
    ])
    assert out["by_outcome"]["completed"]["count"] == 1
    assert out["by_outcome"]["failed"]["count"] == 1
    assert out["by_outcome"]["cancelled"]["count"] == 1
    assert out["stages"]["server_total"]["count"] == 3


def test_legacy_a5_format_fields_still_parse():
    """Older A5 lines (elapsed_ms only, no outcome/split fields) keep working."""
    out = _export([
        "ai_run_profile_final run_id=old intent=chat mode_denied=0 "
        "used_tools=[] elapsed_ms=700.0 total_tokens=10",
    ])
    assert out["stages"]["server_total"]["p50_ms"] == 700.0
    assert out["by_intent_mode"]["chat"]["count"] == 1


def test_real_cli_invocation_on_log_file(tmp_path):
    """Full path: file on disk -> subprocess CLI -> JSON stdout."""
    log = tmp_path / "worker.log"
    log.write_text("\n".join([
        "ai_chat.run.queue_wait duration_ms=15.0 run_id=run-001",
        "ai_jev_routing_cache miss mode=groups run_id=run-001",
        _line(
            "run-001", outcome="completed", queue_wait_ms="15.0",
            processing_ms="240.0", server_total_ms="255.0", intent="read",
            mode_denied="0",
            used_tools="['directory.people.search', 'office.mail.search']",
            error_tools="['office.tasks.search', 'kb.articles.search']",
            meta_calls="0", prompt_tokens="100", completion_tokens="20",
            total_tokens="120",
        ),
    ]), encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, "-m", "backend.scripts.ai_run_profile_export",
         "--log", str(log)],
        cwd=str(WEB_ROOT), capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout)
    assert out["tools"]["executed_calls"] == 2
    assert out["tools"]["error_calls"] == 2
    assert out["stages"]["server_total"]["p50_ms"] == 255.0
