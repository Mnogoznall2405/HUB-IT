from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from backend.config import config
from backend.services import my_files_antivirus_service as antivirus


@pytest.fixture
def enabled_antivirus(monkeypatch):
    settings = config.my_files_security
    monkeypatch.setattr(settings, "antivirus_enabled", True)
    monkeypatch.setattr(settings, "antivirus_provider", "auto", raising=False)
    monkeypatch.setattr(settings, "antivirus_timeout_sec", 30)
    monkeypatch.setattr(settings, "defender_path", "")
    monkeypatch.setattr(settings, "kaspersky_path", "", raising=False)
    return settings


def _completed(args, stdout: str, *, returncode: int = 0) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=args, returncode=returncode, stdout=stdout, stderr="")


def _kaspersky_output(*, detected: int = 0, errors: int = 0, skipped: int = 0) -> str:
    return (
        "Scan_Objects completed\n"
        "; --- Statistics ---\n"
        "; Processed objects:\t1\n"
        f"; Total detected:\t{detected}\n"
        f"; Skipped:\t{skipped}\n"
        "; Password protected:\t0\n"
        "; Corrupted:\t0\n"
        f"; Errors:\t{errors}\n"
    )


def test_auto_provider_prefers_kaspersky_when_installed(tmp_path, monkeypatch, enabled_antivirus):
    payload = tmp_path / "payload.txt"
    payload.write_text("safe", encoding="utf-8")
    kaspersky_path = Path(r"C:\Kaspersky\avp.com")
    defender_path = Path(r"C:\Defender\MpCmdRun.exe")
    calls: list[list[str]] = []

    monkeypatch.setattr(antivirus, "_resolve_kaspersky_path", lambda _path="": kaspersky_path, raising=False)
    monkeypatch.setattr(antivirus, "_resolve_defender_path", lambda _path="": defender_path)

    def fake_run(args, **_kwargs):
        calls.append(args)
        if args[0] == str(kaspersky_path):
            return _completed(args, _kaspersky_output())
        return _completed(args, "Found no threats")

    monkeypatch.setattr(antivirus.subprocess, "run", fake_run)

    result = antivirus.scan_my_file(payload)

    assert result == antivirus.SecurityScanResult(status="clean", engine="kaspersky-endpoint-security")
    assert calls == [[str(kaspersky_path), "SCAN", str(payload), "/i0"]]


def test_kaspersky_detection_is_blocked(tmp_path, monkeypatch, enabled_antivirus):
    payload = tmp_path / "payload.bin"
    payload.write_bytes(b"payload")
    kaspersky_path = Path(r"C:\Kaspersky\avp.com")
    enabled_antivirus.antivirus_provider = "kaspersky"
    monkeypatch.setattr(antivirus, "_resolve_kaspersky_path", lambda _path="": kaspersky_path, raising=False)
    monkeypatch.setattr(
        antivirus.subprocess,
        "run",
        lambda args, **_kwargs: _completed(args, _kaspersky_output(detected=1)),
    )

    result = antivirus.scan_my_file(payload)

    assert result == antivirus.SecurityScanResult(
        status="blocked",
        engine="kaspersky-endpoint-security",
        detail="Threat detected",
    )


@pytest.mark.parametrize(
    "stdout,returncode",
    [
        (_kaspersky_output(errors=1), 0),
        (_kaspersky_output(skipped=1), 0),
        ("Scan_Objects completed\n", 0),
        (_kaspersky_output(), 2),
    ],
)
def test_kaspersky_uncertain_result_fails_closed(
    tmp_path,
    monkeypatch,
    enabled_antivirus,
    stdout,
    returncode,
):
    payload = tmp_path / "payload.bin"
    payload.write_bytes(b"payload")
    kaspersky_path = Path(r"C:\Kaspersky\avp.com")
    enabled_antivirus.antivirus_provider = "kaspersky"
    monkeypatch.setattr(antivirus, "_resolve_kaspersky_path", lambda _path="": kaspersky_path, raising=False)
    monkeypatch.setattr(
        antivirus.subprocess,
        "run",
        lambda args, **_kwargs: _completed(args, stdout, returncode=returncode),
    )

    with pytest.raises(antivirus.MyFilesAntivirusError, match="Kaspersky scan failed"):
        antivirus.scan_my_file(payload)


def test_auto_provider_falls_back_to_defender(tmp_path, monkeypatch, enabled_antivirus):
    payload = tmp_path / "payload.txt"
    payload.write_text("safe", encoding="utf-8")
    defender_path = Path(r"C:\Defender\MpCmdRun.exe")
    monkeypatch.setattr(antivirus, "_resolve_kaspersky_path", lambda _path="": None, raising=False)
    monkeypatch.setattr(antivirus, "_resolve_defender_path", lambda _path="": defender_path)
    monkeypatch.setattr(
        antivirus.subprocess,
        "run",
        lambda args, **_kwargs: _completed(args, "Found no threats"),
    )

    result = antivirus.scan_my_file(payload)

    assert result == antivirus.SecurityScanResult(status="clean", engine="microsoft-defender")


def test_resolve_kaspersky_path_from_standard_installation(tmp_path, monkeypatch):
    program_files_x86 = tmp_path / "Program Files (x86)"
    executable = program_files_x86 / "Kaspersky Lab" / "KES.14.1.0" / "avp.com"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"")
    monkeypatch.setenv("ProgramFiles(x86)", str(program_files_x86))
    monkeypatch.setenv("ProgramFiles", str(tmp_path / "Program Files"))

    assert antivirus._resolve_kaspersky_path() == executable
