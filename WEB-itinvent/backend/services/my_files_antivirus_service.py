"""Fail-closed Microsoft Defender scanning for my-files spool payloads."""
from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from backend.config import config


@dataclass(frozen=True)
class SecurityScanResult:
    status: str
    engine: str
    detail: str = ""


class MyFilesAntivirusError(RuntimeError):
    """Raised when the configured antivirus cannot produce a trustworthy result."""


def _resolve_kaspersky_path(explicit_path: str = "") -> Path | None:
    candidates: list[Path] = []
    if str(explicit_path or "").strip():
        candidates.append(Path(str(explicit_path).strip()))

    for env_name in ("ProgramFiles(x86)", "ProgramFiles"):
        program_files_value = str(os.environ.get(env_name, "") or "").strip()
        if not program_files_value:
            continue
        program_files = Path(program_files_value)
        vendor_root = program_files / "Kaspersky Lab"
        if vendor_root.exists():
            candidates.extend(sorted(vendor_root.glob("*/avp.com"), reverse=True))

    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def _resolve_defender_path(explicit_path: str = "") -> Path | None:
    candidates: list[Path] = []
    if str(explicit_path or "").strip():
        candidates.append(Path(str(explicit_path).strip()))

    program_data = Path(os.environ.get("ProgramData", r"C:\ProgramData"))
    platform_root = program_data / "Microsoft" / "Windows Defender" / "Platform"
    if platform_root.exists():
        candidates.extend(
            sorted(
                (path / "MpCmdRun.exe" for path in platform_root.iterdir() if path.is_dir()),
                reverse=True,
            )
        )

    program_files = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
    candidates.append(program_files / "Windows Defender" / "MpCmdRun.exe")
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def _run_scan_command(args: list[str], *, timeout: int, scanner_name: str) -> subprocess.CompletedProcess[str]:
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    try:
        return subprocess.run(
            args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=max(1, int(timeout)),
            check=False,
            shell=False,
            creationflags=creation_flags,
        )
    except subprocess.TimeoutExpired as exc:
        raise MyFilesAntivirusError(f"{scanner_name} scan timed out") from exc
    except OSError as exc:
        raise MyFilesAntivirusError(f"{scanner_name} scan could not start") from exc


def _scan_with_defender(executable: Path, path: Path, *, timeout: int) -> SecurityScanResult:
    result = _run_scan_command(
        [
            str(executable),
            "-Scan",
            "-ScanType",
            "3",
            "-File",
            str(path),
            "-DisableRemediation",
        ],
        timeout=timeout,
        scanner_name="Microsoft Defender",
    )

    output = f"{result.stdout}\n{result.stderr}".strip().lower()
    if result.returncode == 0 and "found no threats" in output:
        return SecurityScanResult(status="clean", engine="microsoft-defender")
    if "threat" in output and "found no threats" not in output:
        return SecurityScanResult(status="blocked", engine="microsoft-defender", detail="Threat detected")
    raise MyFilesAntivirusError(f"Microsoft Defender scan failed with exit code {result.returncode}")


def _kaspersky_stat(output: str, label: str) -> int | None:
    match = re.search(rf"(?im)^\s*;?\s*{re.escape(label)}\s*:\s*(\d+)\s*$", output)
    return int(match.group(1)) if match else None


def _scan_with_kaspersky(executable: Path, path: Path, *, timeout: int) -> SecurityScanResult:
    result = _run_scan_command(
        [str(executable), "SCAN", str(path), "/i0"],
        timeout=timeout,
        scanner_name="Kaspersky",
    )
    output = f"{result.stdout}\n{result.stderr}".strip()
    detected = _kaspersky_stat(output, "Total detected")
    processed = _kaspersky_stat(output, "Processed objects")
    errors = _kaspersky_stat(output, "Errors")
    skipped = _kaspersky_stat(output, "Skipped")
    password_protected = _kaspersky_stat(output, "Password protected") or 0
    corrupted = _kaspersky_stat(output, "Corrupted") or 0

    if detected is not None and detected > 0:
        return SecurityScanResult(
            status="blocked",
            engine="kaspersky-endpoint-security",
            detail="Threat detected",
        )
    if (
        result.returncode == 0
        and re.search(r"(?im)^.*\bcompleted\s*$", output)
        and processed is not None
        and processed > 0
        and detected == 0
        and errors == 0
        and skipped == 0
        and password_protected == 0
        and corrupted == 0
    ):
        return SecurityScanResult(status="clean", engine="kaspersky-endpoint-security")
    raise MyFilesAntivirusError(f"Kaspersky scan failed with exit code {result.returncode}")


def scan_my_file(path: Path) -> SecurityScanResult:
    settings = config.my_files_security
    if not settings.antivirus_enabled:
        return SecurityScanResult(status="skipped", engine="disabled")
    if not path.exists() or not path.is_file():
        raise MyFilesAntivirusError("Security scan payload is missing")

    provider = str(settings.antivirus_provider or "auto").strip().lower()
    if provider not in {"auto", "kaspersky", "defender"}:
        raise MyFilesAntivirusError(f"Unsupported antivirus provider: {provider}")

    if provider in {"auto", "kaspersky"}:
        executable = _resolve_kaspersky_path(settings.kaspersky_path)
        if executable is not None:
            return _scan_with_kaspersky(executable, path, timeout=settings.antivirus_timeout_sec)
        if provider == "kaspersky":
            raise MyFilesAntivirusError("Kaspersky scanner is unavailable")

    executable = _resolve_defender_path(settings.defender_path)
    if executable is None:
        raise MyFilesAntivirusError("Microsoft Defender scanner is unavailable")
    return _scan_with_defender(executable, path, timeout=settings.antivirus_timeout_sec)
