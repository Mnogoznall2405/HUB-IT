"""install_package: the server decides what is installed, the agent verifies and installs it silently.

Boundary scenarios only: what the task creator can and cannot influence, and what the agent refuses to run.
"""
from __future__ import annotations

import hashlib
import json
import shutil
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import scan_agent.agent as scan_agent
import scan_server.app as scan_app
from scan_server.database import ScanStore

INSTALLER = b"fake-hub-desktop-setup"
INSTALLER_SHA = hashlib.sha256(INSTALLER).hexdigest()


def _manifest(tmp_path: Path) -> Path:
    (tmp_path / "HUB-Desktop-Setup-0.1.50-win-x64.exe").write_bytes(INSTALLER)
    path = tmp_path / "install_packages.json"
    path.write_text(
        json.dumps(
            {
                "hub-desktop": {
                    "file": "HUB-Desktop-Setup-0.1.50-win-x64.exe",
                    "kind": "exe",
                    "args": ["/quiet", "/norestart"],
                    "version": "0.1.50",
                    "display_name": "HUB Desktop",
                }
            }
        ),
        encoding="utf-8",
    )
    return path


@pytest.fixture
def server(tmp_path, monkeypatch):
    store = ScanStore(
        db_path=tmp_path / "scan.db",
        archive_dir=tmp_path / "archive",
        task_ack_timeout_sec=300,
        agent_online_timeout_sec=1800,
    )
    monkeypatch.setattr(scan_app, "store", store)
    monkeypatch.setattr(scan_app, "config", replace(scan_app.config, install_manifest_path=str(_manifest(tmp_path))))
    return store


def _create(agent_id: str, payload: dict, command: str = "install_package"):
    return scan_app.create_task(
        scan_app.TaskCreatePayload(agent_id=agent_id, command=command, payload=payload, dedupe_key="dk"),
        {},
    )


def test_task_carries_only_manifest_data_whatever_the_caller_sends(server):
    result = _create(
        "agent-1",
        {
            "package_id": "HUB-Desktop",
            "url": "https://evil.example/setup.exe",
            "sha256": "0" * 64,
            "kind": "msi",
            "args": ["/s", "calc.exe"],
        },
    )

    assert result["task"]["status"] == "queued"
    polled = server.poll_tasks(agent_id="agent-1", limit=5)
    assert len(polled) == 1 and polled[0]["command"] == "install_package"
    payload = polled[0]["payload"]
    assert payload["url"] == "install-package?package_id=hub-desktop"
    assert payload["sha256"] == INSTALLER_SHA
    assert payload["kind"] == "exe"
    assert payload["args"] == ["/quiet", "/norestart"]


def test_unknown_package_and_bad_id_are_rejected_and_download_needs_the_agent_key(server):
    with pytest.raises(HTTPException) as unknown:
        _create("agent-1", {"package_id": "nope"})
    assert unknown.value.status_code == 404
    with pytest.raises(HTTPException) as bad:
        _create("agent-1", {"package_id": "../../windows/system32"})
    assert bad.value.status_code == 400

    with pytest.raises(HTTPException) as no_key:
        scan_app.download_install_package(package_id="hub-desktop", x_api_key="wrong")
    assert no_key.value.status_code in {401, 403}
    ok = scan_app.download_install_package(package_id="hub-desktop", x_api_key=scan_app.config.api_keys[0])
    assert Path(ok.path).read_bytes() == INSTALLER
    assert ok.headers["x-install-package-sha256"] == INSTALLER_SHA


def _agent(monkeypatch, tmp_path, installed_before="", installed_after="0.1.50", exit_code=0):
    monkeypatch.setattr(scan_agent, "INSTALL_STAGING_DIR", tmp_path / "stage")
    versions = iter([installed_before, installed_after])
    monkeypatch.setattr(scan_agent, "_installed_program_version", lambda name: next(versions, installed_after))
    ran = []
    monkeypatch.setattr(
        scan_agent.subprocess,
        "run",
        lambda cmd, **kw: ran.append(cmd) or SimpleNamespace(returncode=exit_code),
    )
    agent = scan_agent.ScanAgent(
        {
            "server_base": "https://hub.example/api/v1/scan",
            "api_key": "k",
            "poll_interval": 60,
            "poll_interval_slow": 300,
            "poll_jitter_sec": 30,
            "timeout": 20,
            "max_file_bytes": 1024,
            "run_scan_on_start": False,
            "watchdog_enabled": False,
            "watchdog_batch_size": 200,
            "roots_refresh_sec": 300,
            "branch": "",
            "patterns_file": "",
            "outbox_max_items": 5000,
            "outbox_max_age_days": 14,
            "outbox_max_total_mb": 512,
            "outbox_drain_batch": 50,
            "outbox_drain_batch_slow": 10,
            "outbox_drain_interval_sec": 10,
            "outbox_drain_interval_slow_sec": 120,
            "server_queue_slow_threshold": 2000,
        }
    )
    served = tmp_path / "served.exe"
    served.write_bytes(INSTALLER)
    monkeypatch.setattr(agent, "_download_agent_package", lambda url, dest: shutil.copy2(served, dest))
    return agent, ran, served


def _task_payload(**overrides):
    payload = {
        "package_id": "hub-desktop",
        "url": "install-package?package_id=hub-desktop",
        "sha256": INSTALLER_SHA,
        "kind": "exe",
        "args": ["/quiet", "/norestart"],
        "version": "0.1.50",
        "display_name": "HUB Desktop",
        "filename": "HUB-Desktop-Setup-0.1.50-win-x64.exe",
    }
    payload.update(overrides)
    return payload


def test_agent_installs_verifies_hash_runs_silently_and_reports_installed_version(monkeypatch, tmp_path):
    agent, ran, _ = _agent(monkeypatch, tmp_path)

    result = agent.run_install_package(_task_payload(), task_id="t1")

    assert result["phase"] == "installed" and result["verified"] is True and result["installed_version"] == "0.1.50"
    assert ran[0][1:] == ["/quiet", "/norestart"]
    assert not list((tmp_path / "stage").glob("*.exe")), "the installer must be removed after the run"


def test_agent_refuses_tampered_package_and_foreign_urls_without_running_anything(monkeypatch, tmp_path):
    agent, ran, served = _agent(monkeypatch, tmp_path)
    served.write_bytes(b"tampered")

    with pytest.raises(RuntimeError, match="SHA256 mismatch"):
        agent.run_install_package(_task_payload(), task_id="t1")
    for url in ("https://evil.example/setup.exe", "\\\\share\\setup.exe", "agent-package"):
        with pytest.raises(ValueError, match="server-relative"):
            agent.run_install_package(_task_payload(url=url), task_id="t2")

    assert ran == []


def test_agent_skips_download_when_the_version_is_already_installed(monkeypatch, tmp_path):
    agent, ran, _ = _agent(monkeypatch, tmp_path, installed_before="0.1.51")
    monkeypatch.setattr(agent, "_download_agent_package", lambda url, dest: pytest.fail("must not download"))

    result = agent.run_install_package(_task_payload(), task_id="t1")

    assert result["phase"] == "already_installed" and ran == []


def test_installer_failure_is_reported_as_failed(monkeypatch, tmp_path):
    agent, _, _ = _agent(monkeypatch, tmp_path, installed_after="", exit_code=1603)

    result = agent.run_install_package(_task_payload(), task_id="t1")

    assert result["phase"] == "failed" and result["exit_code"] == 1603 and result["verified"] is False


class _FakeStream:
    def __init__(self, status, chunks, fail_after_chunks=False):
        self.status_code = status
        self._chunks = chunks
        self._fail = fail_after_chunks

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def iter_content(self, chunk_size=0):
        for chunk in self._chunks:
            yield chunk
        if self._fail:
            raise scan_agent.requests.exceptions.ChunkedEncodingError("Connection broken: IncompleteRead")


def test_download_resumes_from_the_received_bytes_after_a_broken_connection(monkeypatch, tmp_path):
    agent, _, _ = _agent(monkeypatch, tmp_path)
    monkeypatch.setattr(scan_agent.time, "sleep", lambda *_: None)
    body = bytes(range(256)) * 40
    cut = 3000
    seen = []

    def open_stream(headers):
        seen.append(dict(headers))
        if not headers:
            return _FakeStream(200, [body[:cut]], fail_after_chunks=True)
        start = int(headers["Range"].split("=")[1].rstrip("-"))
        return _FakeStream(206, [body[start:]])

    target = tmp_path / "pkg.bin"
    agent._download_with_resume(open_stream, target)

    assert target.read_bytes() == body
    assert seen == [{}, {"Range": f"bytes={cut}-"}]


def test_download_gives_up_after_the_attempt_limit(monkeypatch, tmp_path):
    agent, _, _ = _agent(monkeypatch, tmp_path)
    monkeypatch.setattr(scan_agent.time, "sleep", lambda *_: None)

    with pytest.raises(RuntimeError, match="failed after 3 attempts"):
        agent._download_with_resume(
            lambda headers: _FakeStream(200, [b"x"], fail_after_chunks=True), tmp_path / "pkg.bin", attempts=3
        )


def test_disable_message_probes_stops_tasks_processes_and_persists_flags(monkeypatch, tmp_path):
    agent, _, _ = _agent(monkeypatch, tmp_path)
    import agent_installer

    stopped_tasks = []
    monkeypatch.setattr(agent_installer, "stop_scheduled_task", lambda name, *a, **k: stopped_tasks.append(name))
    monkeypatch.setattr(agent_installer, "stop_agent_processes", lambda *a, **k: [111, 222])
    env_file = tmp_path / "agent.env"
    monkeypatch.setattr(agent_installer, "resolve_install_dir", lambda raw: tmp_path)
    monkeypatch.setattr(agent_installer, "resolve_env_file_path", lambda install_dir, raw: env_file)
    monkeypatch.setattr(agent_installer, "read_runtime_env_map", lambda path, install_dir: {"ITINV_TELEGRAM_PROBE_ENABLED": "1", "ITINV_MAX_PROBE_ENABLED": "1", "OTHER_KEY": "x"})
    written = {}
    monkeypatch.setattr(agent_installer, "upsert_env_file", lambda path, values: written.update(values))

    result = agent.run_disable_message_probes()

    assert result["phase"] == "disabled"
    assert set(stopped_tasks) == {agent_installer.TELEGRAM_PROBE_TASK_NAME, agent_installer.MAX_PROBE_TASK_NAME}
    assert result["stopped_pids"] == [111, 222]
    assert result["persisted"] is True
    assert written["ITINV_TELEGRAM_PROBE_ENABLED"] == "0"
    assert written["ITINV_MAX_PROBE_ENABLED"] == "0"
    assert written["OTHER_KEY"] == "x"


def test_disable_message_probes_task_reports_completed(monkeypatch, tmp_path):
    agent, _, _ = _agent(monkeypatch, tmp_path)
    monkeypatch.setattr(
        agent,
        "run_disable_message_probes",
        lambda: {"phase": "disabled", "stopped_tasks": ["HUB-IT Telegram Probe"], "stopped_pids": [], "persisted": True},
    )
    sent = []

    def fake_send(method, url, **kwargs):
        if url.endswith("/tasks/poll"):
            return SimpleNamespace(status_code=200, content=b"1", json=lambda: {"tasks": [{"task_id": "t1", "command": "disable_message_probes"}]})
        sent.append((method, url, kwargs.get("json")))
        return SimpleNamespace(status_code=200, content=b"1", json=lambda: {"success": True})

    monkeypatch.setattr(agent, "_send", fake_send)

    agent.poll_tasks()

    results = [payload.get("status") for _, url, payload in sent if "/result" in url]
    assert results == ["acknowledged", "completed"]
