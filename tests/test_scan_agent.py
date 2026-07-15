from __future__ import annotations

from argparse import Namespace
from pathlib import Path
import re

import scan_agent.agent as scan_agent
from agent_version import AGENT_VERSION as SHARED_AGENT_VERSION


class _DummyResponse:
    def __init__(self, *, status_code: int = 200, data=None):
        self.status_code = status_code
        self._data = data or {}
        self.content = b"{}"
        self.text = ""

    def json(self):
        return self._data


def _make_config() -> dict:
    return {
        "server_base": "https://hubit.zsgp.ru/api/v1/scan",
        "api_key": "test-key",
        "poll_interval": 600,
        "poll_jitter_sec": 120,
        "timeout": 20,
        "max_file_bytes": 1024 * 1024,
        "run_scan_on_start": False,
        "watchdog_enabled": False,
        "watchdog_batch_size": 200,
        "roots_refresh_sec": 300,
        "branch": "",
        "patterns_file": "",
        "outbox_max_items": 5000,
        "outbox_max_age_days": 14,
        "outbox_max_total_mb": 512,
        "outbox_drain_batch": 10,
    }


def _make_pattern_defs(pattern: str) -> list[dict]:
    return [{"id": "p1", "name": "pattern", "weight": 1.0, "regex": re.compile(pattern)}]


def test_agent_patterns_detect_real_dsp_ocr_distortions():
    definitions = scan_agent._load_pattern_defs(Path(__file__).parents[1] / "patterns_strict.yaml")
    samples = {
        "Для служейного пользования": "dsp_ocr_variant",
        "Дли служа бного пользования": "dsp_ocr_variant",
        "Для служебного mn oA\nп. 37 Перечня сведений ВС\nЭкз. № 2": "dsp_ocr_context",
        "Tina ¢ тужеб ного пользования\nп. 161 Перечни сведений ac РФ": "dsp_ocr_context",
    }

    for sample, expected_rule in samples.items():
        matches = scan_agent.scan_text(sample, definitions)
        assert any(item["pattern"] == expected_rule for item in matches)


def test_read_env_defaults_to_on_demand(monkeypatch):
    monkeypatch.delenv("SCAN_AGENT_SCAN_ON_START", raising=False)
    monkeypatch.delenv("SCAN_AGENT_WATCHDOG_ENABLED", raising=False)
    monkeypatch.delenv("SCAN_AGENT_POLL_INTERVAL_SEC", raising=False)
    monkeypatch.delenv("SCAN_AGENT_POLL_JITTER_SEC", raising=False)
    monkeypatch.delenv("SCAN_AGENT_OUTBOX_DRAIN_BATCH", raising=False)
    monkeypatch.setenv("SCAN_AGENT_API_KEY", "configured-key")

    config = scan_agent._read_env()

    assert config["run_scan_on_start"] is False
    assert config["watchdog_enabled"] is False
    assert config["poll_interval"] == 600
    assert config["poll_jitter_sec"] == 120
    assert config["outbox_drain_batch"] == 10


def test_read_env_never_falls_back_to_a_shared_legacy_key(monkeypatch):
    monkeypatch.delenv("SCAN_AGENT_API_KEY", raising=False)
    monkeypatch.setenv("ITINV_AGENT_ALLOW_DEFAULT_KEY", "1")

    config = scan_agent._read_env()

    assert config["api_key"] == ""


def test_iter_files_keeps_unreadable_paths_for_incomplete_accounting(monkeypatch, tmp_path):
    root = tmp_path / "root"
    inaccessible = root / "locked.pdf"
    monkeypatch.setattr(scan_agent.os, "walk", lambda value: [(str(root), [], [inaccessible.name])])
    original_stat = Path.stat

    def fake_stat(path, *args, **kwargs):
        if path == inaccessible:
            raise PermissionError("access denied")
        return original_stat(path, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", fake_stat)

    assert list(scan_agent._iter_files([root], 1024)) == [inaccessible]


def test_send_ingest_uses_multipart_endpoint_for_pdf_slice(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    calls = []
    payload = {
        "agent_id": "agent-1",
        "hostname": "HOST-01",
        "file_path": r"C:\Docs\slice.pdf",
        "file_name": "slice.pdf",
        "file_hash": "hash-1",
        "source_kind": "pdf_slice",
        "pdf_slice_b64": "JVBERi0xLjQK",
    }

    def fake_send(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _DummyResponse(data={"job_id": "job-1", "deduped": False})

    monkeypatch.setattr(agent, "_send", fake_send)

    result = agent._send_ingest(payload)

    assert result == {"success": True, "deduped": False, "fallback": False}
    assert len(calls) == 1
    assert calls[0][1].endswith("/ingest/pdf-slice")
    assert "json" not in calls[0][2]
    assert "metadata_json" in calls[0][2]["data"]
    assert calls[0][2]["files"]["pdf_slice"][1] == b"%PDF-1.4\n"


def test_send_ingest_falls_back_to_json_when_pdf_slice_endpoint_is_missing(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    calls = []
    payload = {
        "agent_id": "agent-1",
        "hostname": "HOST-01",
        "file_path": r"C:\Docs\slice.pdf",
        "file_name": "slice.pdf",
        "file_hash": "hash-1",
        "source_kind": "pdf_slice",
        "pdf_slice_b64": "JVBERi0xLjQK",
    }

    def fake_send(method, url, **kwargs):
        calls.append((method, url, kwargs))
        if url.endswith("/ingest/pdf-slice"):
            return _DummyResponse(status_code=404)
        return _DummyResponse(data={"job_id": "job-1", "deduped": True})

    monkeypatch.setattr(agent, "_send", fake_send)

    result = agent._send_ingest(payload)

    assert result == {"success": True, "deduped": True}
    assert [call[1].rsplit("/", 1)[-1] for call in calls] == ["pdf-slice", "ingest"]
    assert calls[1][2]["json"] is payload


def test_send_ingest_does_not_fallback_to_json_on_backpressure(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    calls = []
    payload = {
        "agent_id": "agent-1",
        "hostname": "HOST-01",
        "file_path": r"C:\Docs\slice.pdf",
        "file_name": "slice.pdf",
        "file_hash": "hash-1",
        "source_kind": "pdf_slice",
        "pdf_slice_b64": "JVBERi0xLjQK",
    }

    def fake_send(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _DummyResponse(status_code=429)

    monkeypatch.setattr(agent, "_send", fake_send)

    result = agent._send_ingest(payload)

    assert result == {"success": False, "deduped": False, "fallback": False}
    assert len(calls) == 1
    assert calls[0][1].endswith("/ingest/pdf-slice")


def test_poll_tasks_scan_now_keeps_task_acknowledged_until_server_processing_finishes(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    sent_payloads = []
    run_stats = {
        "phase": "server_processing",
        "ingest_complete": True,
        "scanned": 2,
        "queued": 2,
        "skipped": 1,
        "deferred": 0,
        "jobs_total": 2,
        "jobs_pending": 2,
        "jobs_done_clean": 0,
        "jobs_done_with_incident": 0,
        "jobs_failed": 0,
    }

    def fake_send(method, url, **kwargs):
        if url.endswith("/tasks/poll"):
            return _DummyResponse(
                data={"tasks": [{"task_id": "task-1", "command": "scan_now"}]}
            )
        sent_payloads.append((method, url, kwargs.get("json")))
        return _DummyResponse()

    monkeypatch.setattr(agent, "_send", fake_send)
    monkeypatch.setattr(agent, "run_scan_once", lambda scan_task_id=None, force_rescan=False: run_stats)

    agent.poll_tasks()

    acknowledged_payloads = [payload for _, _, payload in sent_payloads if payload and payload.get("status") == "acknowledged"]
    assert len(acknowledged_payloads) == 2
    assert acknowledged_payloads[0]["result"]["phase"] == "local_scan"
    assert acknowledged_payloads[0]["result"]["ingest_complete"] is False
    assert acknowledged_payloads[1]["result"] == run_stats
    assert acknowledged_payloads[1]["result"]["ingest_complete"] is True
    assert not any(payload and payload.get("status") == "completed" for _, _, payload in sent_payloads)


def test_poll_tasks_scan_now_completes_immediately_when_server_has_no_jobs(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    sent_payloads = []
    run_stats = {
        "phase": "completed",
        "scanned": 1,
        "queued": 0,
        "skipped": 3,
        "deferred": 0,
        "jobs_total": 0,
        "jobs_pending": 0,
        "jobs_done_clean": 0,
        "jobs_done_with_incident": 0,
        "jobs_failed": 0,
    }

    def fake_send(method, url, **kwargs):
        if url.endswith("/tasks/poll"):
            return _DummyResponse(
                data={"tasks": [{"task_id": "task-1", "command": "scan_now"}]}
            )
        sent_payloads.append((method, url, kwargs.get("json")))
        return _DummyResponse()

    monkeypatch.setattr(agent, "_send", fake_send)
    monkeypatch.setattr(agent, "run_scan_once", lambda scan_task_id=None, force_rescan=False: run_stats)

    agent.poll_tasks()

    assert any(payload and payload.get("status") == "completed" and payload.get("result") == run_stats for _, _, payload in sent_payloads)


def test_poll_tasks_scan_now_stays_acknowledged_when_files_are_deferred_to_outbox(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    sent_payloads = []
    run_stats = {
        "phase": "processing",
        "ingest_complete": False,
        "scanned": 2,
        "queued": 1,
        "skipped": 0,
        "deferred": 1,
        "jobs_total": 1,
        "jobs_pending": 1,
        "jobs_done_clean": 0,
        "jobs_done_with_incident": 0,
        "jobs_failed": 0,
    }

    def fake_send(method, url, **kwargs):
        if url.endswith("/tasks/poll"):
            return _DummyResponse(
                data={"tasks": [{"task_id": "task-1", "command": "scan_now"}]}
            )
        sent_payloads.append((method, url, kwargs.get("json")))
        return _DummyResponse()

    monkeypatch.setattr(agent, "_send", fake_send)
    monkeypatch.setattr(agent, "run_scan_once", lambda scan_task_id=None, force_rescan=False: run_stats)

    agent.poll_tasks()

    assert any(
        payload
        and payload.get("status") == "acknowledged"
        and payload.get("result") == run_stats
        for _, _, payload in sent_payloads
    )


def test_poll_tasks_passes_force_rescan_payload_to_scan_once(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    calls = []
    run_stats = {
        "phase": "completed",
        "scanned": 0,
        "queued": 0,
        "skipped": 0,
        "deferred": 0,
        "deduped": 0,
        "deleted_from_state": 0,
        "force_rescan": True,
        "jobs_total": 0,
        "jobs_pending": 0,
        "jobs_done_clean": 0,
        "jobs_done_with_incident": 0,
        "jobs_failed": 0,
    }

    def fake_send(method, url, **kwargs):
        if url.endswith("/tasks/poll"):
            return _DummyResponse(
                data={
                    "tasks": [
                        {
                            "task_id": "task-force",
                            "command": "scan_now",
                            "payload": {
                                "force_rescan": True,
                                "agent_pattern_ids": ["dsp_official_use", "dsp_ocr_variant"],
                                "scan_extensions": ["PDF", ".txt", ".docx", ".exe"],
                            },
                        }
                    ]
                }
            )
        return _DummyResponse()

    def fake_run_scan_once(scan_task_id=None, force_rescan=False, pattern_ids=None, scan_extensions=None):
        calls.append(
            {
                "scan_task_id": scan_task_id,
                "force_rescan": force_rescan,
                "pattern_ids": pattern_ids,
                "scan_extensions": scan_extensions,
            }
        )
        return run_stats

    monkeypatch.setattr(agent, "_send", fake_send)
    monkeypatch.setattr(agent, "run_scan_once", fake_run_scan_once)

    agent.poll_tasks()

    assert calls == [
        {
            "scan_task_id": "task-force",
            "force_rescan": True,
            "pattern_ids": ["dsp_ocr_variant", "dsp_official_use"],
            "scan_extensions": [".docx", ".pdf", ".txt"],
        }
    ]


def test_run_forever_does_not_scan_on_start_by_default(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    started = []

    class _StopLoop(RuntimeError):
        pass

    monkeypatch.setattr(agent, "refresh_roots", lambda force=False: None)
    monkeypatch.setattr(agent, "_start_watchdog", lambda: None)
    monkeypatch.setattr(agent, "run_scan_once", lambda scan_task_id=None: started.append("scan"))
    monkeypatch.setattr(agent, "heartbeat", lambda: None)
    monkeypatch.setattr(agent, "poll_tasks", lambda: (_ for _ in ()).throw(_StopLoop()))
    monkeypatch.setattr(agent, "_outbox_prune_limits", lambda: None)
    monkeypatch.setattr(agent, "_drain_outbox", lambda max_items=200: 0)
    monkeypatch.setattr(agent, "process_watchdog_queue", lambda max_items=200: {"scanned": 0, "queued": 0, "skipped": 0, "deferred": 0, "deduped": 0})
    monkeypatch.setattr(agent, "_persist_state", lambda: None)
    monkeypatch.setattr(agent, "_write_status", lambda force=False: None)
    monkeypatch.setattr(agent, "_stop_watchdog", lambda: None)

    try:
        agent.run_forever()
    except _StopLoop:
        pass

    assert started == []


def test_main_heartbeat_mode(monkeypatch):
    calls = []

    class DummyAgent:
        def __init__(self, config):
            self.pattern_defs = ["ok"]

        def heartbeat(self):
            calls.append("heartbeat")

        def run_scan_once(self):
            calls.append("once")
            return {}

        def run_forever(self):
            calls.append("forever")

    monkeypatch.setattr(scan_agent, "bootstrap_env_from_files", lambda: [])
    monkeypatch.setattr(scan_agent, "setup_logging", lambda: None)
    monkeypatch.setattr(scan_agent, "parse_args", lambda: Namespace(heartbeat=True, once=False, no_watchdog=False))
    monkeypatch.setattr(scan_agent, "_read_env", _make_config)
    monkeypatch.setattr(scan_agent, "ScanAgent", DummyAgent)

    assert scan_agent.main() == 0
    assert calls == ["heartbeat"]


def test_main_once_mode(monkeypatch):
    calls = []

    class DummyAgent:
        def __init__(self, config):
            self.pattern_defs = ["ok"]

        def heartbeat(self):
            calls.append("heartbeat")

        def run_scan_once(self):
            calls.append("once")
            return {"scanned": 1}

        def run_forever(self):
            calls.append("forever")

    monkeypatch.setattr(scan_agent, "bootstrap_env_from_files", lambda: [])
    monkeypatch.setattr(scan_agent, "setup_logging", lambda: None)
    monkeypatch.setattr(scan_agent, "parse_args", lambda: Namespace(heartbeat=False, once=True, no_watchdog=False))
    monkeypatch.setattr(scan_agent, "_read_env", _make_config)
    monkeypatch.setattr(scan_agent, "ScanAgent", DummyAgent)

    assert scan_agent.main() == 0
    assert calls == ["once"]


def test_setup_py_includes_watchdog_packages():
    setup_text = (Path(__file__).resolve().parents[1] / "agent" / "setup.py").read_text(encoding="utf-8")

    assert '"watchdog"' in setup_text
    assert '"watchdog.events"' in setup_text
    assert '"watchdog.observers"' in setup_text


def test_scan_agent_task_installer_forces_on_demand_and_hardened_scheduler():
    script_text = (Path(__file__).resolve().parents[1] / "scripts" / "install_scan_agent_task.ps1").read_text(
        encoding="utf-8"
    )

    assert "SCAN_AGENT_SCAN_ON_START" in script_text
    assert "SCAN_AGENT_WATCHDOG_ENABLED" in script_text
    assert "ExecutionTimeLimit" in script_text
    assert "MultipleInstances IgnoreNew" in script_text
    assert "MSFT_TaskRepetitionPattern" in script_text


def test_scan_agent_service_installer_forces_on_demand_defaults():
    script_text = (Path(__file__).resolve().parents[1] / "scripts" / "install_scan_agent_service.ps1").read_text(
        encoding="utf-8"
    )

    assert "SCAN_AGENT_SCAN_ON_START" in script_text
    assert "SCAN_AGENT_WATCHDOG_ENABLED" in script_text
    assert "SetEnvironmentVariable" in script_text


def test_unsupported_file_skips_hashing(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    image_path = Path(temp_dir) / "program.exe"
    image_path.write_bytes(b"binary-bytes")

    monkeypatch.setattr(scan_agent, "_sha256_file", lambda path: (_ for _ in ()).throw(AssertionError("hash should not be called")))

    result = agent._scan_path(image_path)

    assert result == {"scanned": 0, "queued": 0, "skipped": 1, "deferred": 0, "deduped": 0}


def test_scan_path_can_report_skip_reasons(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    image_path = Path(temp_dir) / "program.exe"
    image_path.write_bytes(b"binary-bytes")

    monkeypatch.setattr(scan_agent, "_sha256_file", lambda path: (_ for _ in ()).throw(AssertionError("hash should not be called")))

    result = agent._scan_path(image_path, include_reasons=True)

    assert result["files_seen"] == 1
    assert result["skipped"] == 1
    assert result["skipped_reasons"] == {"unsupported_extension": 1}


def test_scan_path_skips_supported_extension_excluded_by_task(temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    office_path = Path(temp_dir) / "document.docx"
    office_path.write_bytes(b"office-payload")

    result = agent._scan_path(
        office_path,
        include_reasons=True,
        scan_extensions=[".pdf", ".txt"],
    )

    assert result["scanned"] == 0
    assert result["skipped_reasons"] == {"excluded_extension": 1}


def test_cp1251_text_file_detects_patterns(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    agent.pattern_defs = _make_pattern_defs("пароль")
    text_path = Path(temp_dir) / "note.txt"
    text_path.write_bytes("пароль для почты".encode("cp1251"))
    sent_payloads = []

    monkeypatch.setattr(agent, "_send_ingest", lambda payload: sent_payloads.append(payload) or True)

    result = agent._scan_path(text_path)

    assert result["queued"] == 1
    assert len(sent_payloads) == 1
    assert sent_payloads[0]["local_pattern_hits"][0]["value"] == "пароль"


def test_identical_content_in_different_paths_creates_two_events(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    agent.pattern_defs = _make_pattern_defs("secret-token")
    first_path = Path(temp_dir) / "user1" / "Desktop" / "match.txt"
    second_path = Path(temp_dir) / "user2" / "Desktop" / "match.txt"
    first_path.parent.mkdir(parents=True, exist_ok=True)
    second_path.parent.mkdir(parents=True, exist_ok=True)
    first_path.write_text("secret-token", encoding="utf-8")
    second_path.write_text("secret-token", encoding="utf-8")
    sent_payloads = []

    monkeypatch.setattr(agent, "_send_ingest", lambda payload: sent_payloads.append(payload) or True)

    first_result = agent._scan_path(first_path)
    second_result = agent._scan_path(second_path)

    assert first_result["queued"] == 1
    assert second_result["queued"] == 1
    assert len(sent_payloads) == 2
    assert sent_payloads[0]["file_path"] != sent_payloads[1]["file_path"]
    assert sent_payloads[0]["event_id"] != sent_payloads[1]["event_id"]


def test_event_id_is_stable_across_scan_tasks(temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    path = Path(temp_dir) / "match.txt"
    path.write_text("secret-token", encoding="utf-8")
    stat_result = path.stat()
    file_hash = scan_agent._sha256_file(path)

    first = agent._build_event_id(path, file_hash, stat_result, scan_task_id="task-1")
    second = agent._build_event_id(path, file_hash, stat_result, scan_task_id="task-2")

    assert first == second


def test_event_id_changes_for_a_different_pattern_scope(temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    path = Path(temp_dir) / "match.txt"
    path.write_text("secret-token", encoding="utf-8")
    stat_result = path.stat()
    file_hash = scan_agent._sha256_file(path)

    dsp_only = agent._build_event_id(
        path,
        file_hash,
        stat_result,
        pattern_ids=["dsp_official_use"],
    )
    loan_only = agent._build_event_id(
        path,
        file_hash,
        stat_result,
        pattern_ids=["loan_keyword"],
    )

    assert dsp_only != loan_only


def test_event_id_changes_with_analysis_version(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    path = Path(temp_dir) / "match.txt"
    path.write_text("secret-token", encoding="utf-8")
    stat_result = path.stat()
    file_hash = scan_agent._sha256_file(path)

    first = agent._build_event_id(path, file_hash, stat_result)
    monkeypatch.setattr(scan_agent, "ANALYSIS_VERSION", "next-analysis-version")
    second = agent._build_event_id(path, file_hash, stat_result)

    assert first != second


def test_force_rescan_ignores_scanned_state(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    agent.pattern_defs = _make_pattern_defs("secret-token")
    path = Path(temp_dir) / "match.txt"
    path.write_text("secret-token", encoding="utf-8")
    sent_payloads = []

    monkeypatch.setattr(agent, "_send_ingest", lambda payload: sent_payloads.append(payload) or True)

    first = agent._scan_path(path)
    second = agent._scan_path(path)
    third = agent._scan_path(path, force_rescan=True)

    assert first["queued"] == 1
    assert second["skipped"] == 1
    assert third["queued"] == 1
    assert len(sent_payloads) == 2


def test_force_rescan_prunes_deleted_state(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    missing_path = Path(temp_dir) / "missing.txt"
    agent.state = {
        "files": {
            scan_agent._norm_path(missing_path): {
                "hash": "hash-missing",
                "mtime": 1,
                "size": 2,
                "ts": 3,
            }
        },
        "hashes": {"hash-missing": 3},
    }
    agent._roots = []

    monkeypatch.setattr(agent, "refresh_roots", lambda force=False: None)
    monkeypatch.setattr(agent, "_outbox_prune_limits", lambda: None)
    monkeypatch.setattr(agent, "_drain_outbox", lambda max_items=10: 0)
    monkeypatch.setattr(agent, "_persist_state", lambda: None)
    monkeypatch.setattr(agent, "_write_status", lambda force=False: None)

    summary = agent.run_scan_once(force_rescan=True)

    assert summary["force_rescan"] is True
    assert summary["deleted_from_state"] == 1
    assert agent.state["files"] == {}
    assert agent.state["hashes"] == {}


def test_force_rescan_reports_deleted_event_from_state(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    missing_path = Path(temp_dir) / "missing.txt"
    agent.state = {
        "files": {
            scan_agent._norm_path(missing_path): {
                "hash": "hash-missing",
                "event_id": "event-missing",
                "source_kind": "text",
                "mtime": 1,
                "size": 2,
                "ts": 3,
            }
        },
        "hashes": {"hash-missing": 3},
    }
    agent._roots = []

    monkeypatch.setattr(agent, "refresh_roots", lambda force=False: None)
    monkeypatch.setattr(agent, "_outbox_prune_limits", lambda: None)
    monkeypatch.setattr(agent, "_drain_outbox", lambda max_items=10: 0)
    monkeypatch.setattr(agent, "_persist_state", lambda: None)
    monkeypatch.setattr(agent, "_write_status", lambda force=False: None)

    summary = agent.run_scan_once(force_rescan=True)

    assert summary["deleted_from_state"] == 1
    assert summary["deleted_file_events"] == [
        {
            "file_path": scan_agent._norm_path(missing_path),
            "file_hash": "hash-missing",
            "event_id": "event-missing",
            "source_kind": "text",
        }
    ]


def test_force_rescan_reports_cleaned_event_for_previous_match(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    path = Path(temp_dir) / "cleaned.txt"
    path.write_text("no secrets here", encoding="utf-8")
    stat_result = path.stat()
    previous_hash = "old-match-hash"
    agent.state = {
        "files": {
            scan_agent._norm_path(path): {
                "hash": previous_hash,
                "event_id": "event-old-match",
                "source_kind": "text",
                "mtime": int(stat_result.st_mtime),
                "size": int(stat_result.st_size),
                "ts": 3,
            }
        },
        "hashes": {previous_hash: 3},
    }

    result = agent._scan_path(path, force_rescan=True, include_reasons=True)

    assert result["skipped_reasons"] == {"no_match": 1}
    assert result["cleaned_events"][0]["event_id"] == "event-old-match"
    assert result["cleaned_events"][0]["file_hash"] == previous_hash
    assert result["cleaned_events"][0]["file_path"] == str(path)


def test_run_scan_once_drains_outbox_once_after_failed_ingest(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    agent.pattern_defs = _make_pattern_defs("classified")
    root = Path(temp_dir) / "Users" / "tester" / "Documents"
    root.mkdir(parents=True, exist_ok=True)
    (root / "one.txt").write_text("classified one", encoding="utf-8")
    (root / "two.txt").write_text("classified two", encoding="utf-8")
    outbox_payloads = []
    prune_calls = []
    drain_calls = []

    agent._roots = [root]
    monkeypatch.setattr(agent, "refresh_roots", lambda force=False: None)
    monkeypatch.setattr(agent, "_send_ingest", lambda payload: False)
    monkeypatch.setattr(agent, "_outbox_enqueue", lambda payload, **kwargs: outbox_payloads.append(payload) or (root / "queued.json"))
    monkeypatch.setattr(agent, "_outbox_prune_limits", lambda: prune_calls.append("prune"))
    monkeypatch.setattr(agent, "_drain_outbox", lambda max_items=10: drain_calls.append(max_items) or 0)
    monkeypatch.setattr(agent, "_persist_state", lambda: None)
    monkeypatch.setattr(agent, "_write_status", lambda force=False: None)

    summary = agent.run_scan_once()

    assert summary["scanned"] == 2
    assert summary["deferred"] == 2
    assert summary["phase"] == "agent_outbox"
    assert summary["ingest_complete"] is False
    assert summary["jobs_total"] == 2
    assert len(outbox_payloads) == 2
    assert prune_calls == ["prune"]
    assert drain_calls == [10]


def test_failed_outbox_persistence_is_reported_as_incomplete(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    agent.pattern_defs = _make_pattern_defs("classified")
    path = Path(temp_dir) / "classified.txt"
    path.write_text("classified", encoding="utf-8")
    monkeypatch.setattr(agent, "_send_ingest", lambda payload: False)
    monkeypatch.setattr(agent, "_outbox_enqueue", lambda payload, **kwargs: None)

    result = agent._scan_path(path, include_reasons=True)

    assert result["deferred"] == 0
    assert result["persistence_failed"] == 1
    assert result["skipped_reasons"] == {"outbox_persistence_failed": 1}


def test_last_outbox_upload_sends_ingest_complete_before_removing_item(monkeypatch, temp_dir):
    pending = Path(temp_dir) / "outbox" / "pending"
    dead = Path(temp_dir) / "outbox" / "dead"
    pending.mkdir(parents=True)
    dead.mkdir(parents=True)
    monkeypatch.setattr(scan_agent, "OUTBOX_PENDING_PATH", pending)
    monkeypatch.setattr(scan_agent, "OUTBOX_DEAD_PATH", dead)

    agent = scan_agent.ScanAgent(_make_config())
    task_results = []
    payload = {
        "event_id": "event-1",
        "scan_task_id": "task-1",
        "source_kind": "text",
        "file_path": r"C:\Docs\classified.txt",
        "file_hash": "hash-1",
    }
    assert agent._outbox_enqueue(payload) is not None
    agent._attach_task_result_to_outbox(
        "task-1",
        {"phase": "agent_outbox", "ingest_complete": False, "jobs_total": 1},
    )
    monkeypatch.setattr(agent, "_send_ingest", lambda value: {"success": True})
    monkeypatch.setattr(agent, "_register_scanned_from_payload", lambda value: None)
    monkeypatch.setattr(
        agent,
        "_task_result",
        lambda task_id, status_value, result=None, error_text="": task_results.append(
            (task_id, status_value, result)
        )
        or True,
    )

    assert agent._drain_outbox(max_items=10) == 1
    assert agent._outbox_depth() == 0
    assert len(task_results) == 1
    assert task_results[0][0:2] == ("task-1", "acknowledged")
    assert task_results[0][2]["phase"] == "server_processing"
    assert task_results[0][2]["ingest_complete"] is True


def test_heartbeat_reports_shared_agent_version(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    sent_payloads = []

    def fake_send(method, url, **kwargs):
        sent_payloads.append(kwargs.get("json"))
        return _DummyResponse()

    monkeypatch.setattr(agent, "_send", fake_send)

    agent.heartbeat()

    assert sent_payloads[0]["version"] == SHARED_AGENT_VERSION


def test_pdf_with_usable_text_layer_always_builds_three_page_ocr_slice(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    pdf_path = Path(temp_dir) / "document.pdf"
    pdf_path.write_bytes(b"%PDF-placeholder")

    monkeypatch.setattr(scan_agent, "_extract_pdf_text", lambda path, max_pages=10: "ordinary text " * 30)
    monkeypatch.setattr(scan_agent, "_first_pdf_pages_b64", lambda path, pages=3: "c2xpY2U=")
    monkeypatch.setattr(scan_agent, "_pdf_pages_in_slice", lambda path, pages=3: 3)

    payload = agent._analyze_file(pdf_path, "hash", pdf_path.stat())

    assert payload is not None
    assert payload["source_kind"] == "pdf_slice"
    assert payload["pdf_slice_b64"] == "c2xpY2U="
    assert payload["metadata"]["ocr_page_limit"] == 3
    assert payload["metadata"]["text_page_limit"] == 10
    assert payload["metadata"]["pages_in_slice"] == 3
    assert payload["metadata"]["analysis_version"] == scan_agent.ANALYSIS_VERSION


def test_pdf_short_text_layer_is_still_checked_for_exact_dsp_phrase(monkeypatch, temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    agent.pattern_defs = _make_pattern_defs("Для служебного пользования")
    pdf_path = Path(temp_dir) / "short-stamp.pdf"
    pdf_path.write_bytes(b"%PDF-placeholder")

    monkeypatch.setattr(scan_agent, "_extract_pdf_text", lambda path, max_pages=10: "Для служебного пользования")
    monkeypatch.setattr(scan_agent, "_first_pdf_pages_b64", lambda path, pages=3: "c2xpY2U=")
    monkeypatch.setattr(scan_agent, "_pdf_pages_in_slice", lambda path, pages=3: 3)

    payload = agent._analyze_file(pdf_path, "hash", pdf_path.stat())

    assert payload is not None
    assert payload["local_pattern_hits"][0]["value"] == "Для служебного пользования"
    assert payload["metadata"]["extraction_outcomes"][0]["outcome"] == "text_extracted_low_quality"


def test_pdf_larger_than_upload_limit_is_still_analyzed_as_bounded_slice(monkeypatch, temp_dir):
    config = _make_config()
    config["max_file_bytes"] = 1
    agent = scan_agent.ScanAgent(config)
    pdf_path = Path(temp_dir) / "large-drawing.pdf"
    pdf_path.write_bytes(b"%PDF-placeholder")
    sent_payloads = []

    monkeypatch.setattr(scan_agent, "_sha256_file", lambda path: "hash")
    monkeypatch.setattr(scan_agent, "_extract_pdf_text", lambda path, max_pages=10: "ordinary text")
    monkeypatch.setattr(scan_agent, "_first_pdf_pages_b64", lambda path, pages=3: "c2xpY2U=")
    monkeypatch.setattr(scan_agent, "_pdf_pages_in_slice", lambda path, pages=3: 3)
    monkeypatch.setattr(agent, "_send_ingest", lambda payload: sent_payloads.append(payload) or True)

    result = agent._scan_path(pdf_path, force_rescan=True)

    assert result["scanned"] == 1
    assert result["queued"] == 1
    assert sent_payloads[0]["source_kind"] == "pdf_slice"
    assert sent_payloads[0]["metadata"]["pages_in_slice"] == 3


def test_agent_pattern_selection_filters_local_text_matches(temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    agent.pattern_defs = [
        {"id": "dsp_official_use", "name": "DSP", "weight": 10.0, "regex": re.compile("DSP")},
        {"id": "loan_keyword", "name": "Loan", "weight": 5.0, "regex": re.compile("LOAN")},
    ]
    text_path = Path(temp_dir) / "selected-patterns.txt"
    text_path.write_text("DSP and LOAN", encoding="utf-8")

    payload = agent._analyze_file(
        text_path,
        "hash",
        text_path.stat(),
        pattern_ids=["dsp_official_use"],
    )

    assert payload is not None
    assert [item["pattern"] for item in payload["local_pattern_hits"]] == ["dsp_official_use"]
    assert payload["metadata"]["agent_pattern_ids"] == ["dsp_official_use"]


def test_text_file_without_available_patterns_is_not_marked_clean(temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    agent.pattern_defs = []
    text_path = Path(temp_dir) / "unchecked.txt"
    text_path.write_text("Для служебного пользования", encoding="utf-8")

    payload = agent._analyze_file(text_path, "hash", text_path.stat())

    assert payload is not None
    assert payload["source_kind"] == "analysis_incomplete"
    assert payload["metadata"]["analysis_incomplete_reason"] == "patterns_unavailable"


def test_text_reader_scans_past_legacy_two_megabyte_limit(temp_dir):
    text_path = Path(temp_dir) / "large.txt"
    text_path.write_bytes((b"x" * (2 * 1024 * 1024 + 256)) + " Для служебного пользования".encode("utf-8"))

    text = scan_agent._read_text_file(text_path)

    assert "Для служебного пользования" in text


def test_scan_path_detects_match_after_first_two_megabytes(monkeypatch, temp_dir):
    config = _make_config()
    config["max_file_bytes"] = 4 * 1024 * 1024
    agent = scan_agent.ScanAgent(config)
    agent.pattern_defs = _make_pattern_defs("Для служебного пользования")
    text_path = Path(temp_dir) / "large-match.txt"
    text_path.write_bytes((b"x" * (2 * 1024 * 1024 + 256)) + " Для служебного пользования".encode("utf-8"))
    payloads = []
    monkeypatch.setattr(agent, "_send_ingest", lambda payload: payloads.append(payload) or True)

    result = agent._scan_path(text_path)

    assert result["queued"] == 1
    assert payloads[0]["local_pattern_hits"][0]["value"] == "Для служебного пользования"


def test_text_reader_supports_utf16(temp_dir):
    text_path = Path(temp_dir) / "utf16.txt"
    text_path.write_bytes("Для служебного пользования".encode("utf-16"))

    assert "Для служебного пользования" in scan_agent._read_text_file(text_path)


def test_document_upload_uses_multipart_endpoint(monkeypatch):
    agent = scan_agent.ScanAgent(_make_config())
    calls = []
    payload = {
        "agent_id": "agent-1",
        "hostname": "HOST-01",
        "file_path": r"C:\Docs\stamp.jpg",
        "file_name": "stamp.jpg",
        "file_hash": "hash-1",
        "source_kind": "image",
        "document_b64": "aW1hZ2U=",
    }

    def fake_send(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _DummyResponse(data={"job_id": "job-1", "deduped": False})

    monkeypatch.setattr(agent, "_send", fake_send)

    result = agent._send_ingest(payload)

    assert result["success"] is True
    assert calls[0][1].endswith("/ingest/document")
    assert calls[0][2]["files"]["document"][1] == b"image"


def test_image_is_prepared_for_server_ocr(temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    image_path = Path(temp_dir) / "stamp.jpg"
    image_path.write_bytes(b"image-bytes")

    payload = agent._analyze_file(image_path, "hash", image_path.stat())

    assert payload["source_kind"] == "image"
    assert payload["document_b64"] == "aW1hZ2UtYnl0ZXM="


def test_analysis_version_invalidates_old_scan_state(temp_dir):
    agent = scan_agent.ScanAgent(_make_config())
    path = Path(temp_dir) / "match.txt"
    path.write_text("ordinary", encoding="utf-8")
    stat_result = path.stat()
    file_hash = scan_agent._sha256_file(path)
    agent.state = {
        "files": {
            scan_agent._norm_path(path): {
                "hash": file_hash,
                "mtime": int(stat_result.st_mtime),
                "size": int(stat_result.st_size),
                "analysis_version": "old-rules",
            }
        },
        "hashes": {file_hash: 1},
    }

    assert agent._already_scanned(path, stat_result) is False
