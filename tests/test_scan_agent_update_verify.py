"""Unit tests for scan agent self_update verify marker lifecycle."""

from __future__ import annotations

from pathlib import Path

from scan_agent.agent import classify_msi_exit, evaluate_pending_update


def test_classify_msi_exit_codes():
    assert classify_msi_exit(None) == "pending"
    assert classify_msi_exit(0) == "success"
    assert classify_msi_exit(3010) == "success_reboot_required"
    assert classify_msi_exit(1603) == "fatal_install_error"
    assert classify_msi_exit(1618) == "another_install_in_progress"


def test_evaluate_pending_while_msiexec_running(tmp_path: Path):
    marker = {
        "task_id": "t1",
        "expected_version": "1.4.7",
        "previous_version": "1.4.6",
        "launched_at": 1000,
        "exit_code_path": str(tmp_path / "msiexec.exitcode"),
        "log_path": str(tmp_path / "msiexec.log"),
    }
    decision = evaluate_pending_update(marker, current_version="1.4.6", now_ts=1100)
    assert decision["status"] == "acknowledged"
    assert decision["phase"] == "verifying"
    assert decision["terminal"] is False
    assert decision["pending_update"] is True


def test_evaluate_pending_timeout(tmp_path: Path):
    marker = {
        "expected_version": "1.4.7",
        "previous_version": "1.4.6",
        "launched_at": 1000,
        "exit_code_path": str(tmp_path / "missing.exitcode"),
        "log_path": str(tmp_path / "missing.log"),
    }
    decision = evaluate_pending_update(
        marker,
        current_version="1.4.6",
        now_ts=1000 + 46 * 60,
        verify_timeout_sec=45 * 60,
    )
    assert decision["status"] == "failed"
    assert decision["terminal"] is True
    assert decision["msi_exit_class"] == "timeout"


def test_evaluate_verified_after_success_exit(tmp_path: Path):
    exit_path = tmp_path / "msiexec.exitcode"
    log_path = tmp_path / "msiexec.log"
    exit_path.write_text("0\n", encoding="utf-8")
    log_path.write_text("Product: HUB-IT Agent -- Installation completed successfully.\n", encoding="utf-8")
    marker = {
        "expected_version": "1.4.7",
        "previous_version": "1.4.6",
        "launched_at": 1000,
        "exit_code_path": str(exit_path),
        "log_path": str(log_path),
        "exit_recorded_at": 1200,
    }
    decision = evaluate_pending_update(marker, current_version="1.4.7", now_ts=1300)
    assert decision["status"] == "completed"
    assert decision["phase"] == "verified"
    assert decision["verified"] is True
    assert decision["msi_exit_code"] == 0
    assert "Installation completed" in decision["log_tail"]


def test_evaluate_failed_exit_1603(tmp_path: Path):
    exit_path = tmp_path / "msiexec.exitcode"
    exit_path.write_text("1603", encoding="utf-8")
    marker = {
        "expected_version": "1.4.7",
        "previous_version": "1.4.6",
        "launched_at": 1000,
        "exit_code_path": str(exit_path),
        "log_path": str(tmp_path / "msiexec.log"),
        "exit_recorded_at": 1100,
    }
    decision = evaluate_pending_update(marker, current_version="1.4.6", now_ts=1200)
    assert decision["status"] == "failed"
    assert decision["verified"] is False
    assert decision["msi_exit_code"] == 1603
    assert "fatal_install_error" in str(decision.get("error") or "")


def test_evaluate_version_mismatch_after_grace(tmp_path: Path):
    exit_path = tmp_path / "msiexec.exitcode"
    exit_path.write_text("0", encoding="utf-8")
    marker = {
        "expected_version": "1.4.7",
        "previous_version": "1.4.6",
        "launched_at": 1000,
        "exit_code_path": str(exit_path),
        "log_path": str(tmp_path / "msiexec.log"),
        "exit_recorded_at": 1100,
    }
    still_waiting = evaluate_pending_update(
        marker,
        current_version="1.4.6",
        now_ts=1100 + 60,
        post_exit_grace_sec=180,
    )
    assert still_waiting["status"] == "acknowledged"
    assert still_waiting["phase"] == "verifying"

    failed = evaluate_pending_update(
        marker,
        current_version="1.4.6",
        now_ts=1100 + 200,
        post_exit_grace_sec=180,
    )
    assert failed["status"] == "failed"
    assert failed["terminal"] is True
