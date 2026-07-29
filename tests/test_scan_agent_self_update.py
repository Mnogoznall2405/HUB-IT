"""Tests for agent self_update package resolution and task whitelist."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from scan_server.agent_package import package_payload, resolve_agent_package
from scan_server.database import ScanStore


def test_resolve_agent_package_from_local_file(tmp_path: Path):
    msi = tmp_path / "HUB-IT Agent-1.4.0-win64.msi"
    content = b"fake-msi-content"
    msi.write_bytes(content)
    expected_sha = hashlib.sha256(content).hexdigest()

    info = resolve_agent_package(package_path=str(msi))
    assert info.msi_url == "agent-package"
    assert info.msi_sha256 == expected_sha
    assert info.filename == msi.name
    assert info.local_path == msi
    assert info.expected_version

    payload = package_payload(info)
    assert payload["msi_url"] == "agent-package"
    assert payload["msi_sha256"] == expected_sha


def test_resolve_agent_package_url_requires_sha():
    with pytest.raises(ValueError, match="SHA256"):
        resolve_agent_package(package_url="\\\\share\\agent.msi")


def test_resolve_agent_package_url_with_sha():
    sha = "a" * 64
    info = resolve_agent_package(
        package_url="\\\\fileserver\\itinvent\\agent.msi",
        package_sha256=sha,
    )
    assert info.msi_url.startswith("\\\\")
    assert info.msi_sha256 == sha
    assert info.local_path is None


def test_create_task_accepts_self_update(tmp_path: Path):
    db_path = tmp_path / "scan.db"
    store = ScanStore(
        db_path=db_path,
        archive_dir=tmp_path / "archive",
        task_ack_timeout_sec=300,
        agent_online_timeout_sec=1800,
        resolve_agent_sql_context=False,
        job_processing_timeout_sec=1800,
    )
    created = store.create_task(
        agent_id="agent-1",
        command="self_update",
        payload={"msi_url": "agent-package", "msi_sha256": "b" * 64, "expected_version": "1.4.0"},
        dedupe_key="self_update:agent-1",
    )
    assert created["status"] == "queued"
    assert created["command"] == "self_update"

    again = store.create_task(
        agent_id="agent-1",
        command="self_update",
        payload={"msi_url": "agent-package", "msi_sha256": "b" * 64},
        dedupe_key="self_update:agent-1",
    )
    assert again["id"] == created["id"]
