"""Fail-closed Microsoft Defender scanning for my-files spool payloads."""
from __future__ import annotations

import os
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


def scan_my_file(path: Path) -> SecurityScanResult:
    settings = config.my_files_security
    if not settings.antivirus_enabled:
        return SecurityScanResult(status="skipped", engine="disabled")
    if not path.exists() or not path.is_file():
        raise MyFilesAntivirusError("Security scan payload is missing")

    executable = _resolve_defender_path(settings.defender_path)
    if executable is None:
        raise MyFilesAntivirusError("Microsoft Defender scanner is unavailable")

    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    try:
        result = subprocess.run(
            [
                str(executable),
                "-Scan",
                "-ScanType",
                "3",
                "-File",
                str(path),
                "-DisableRemediation",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=max(1, int(settings.antivirus_timeout_sec)),
            check=False,
            shell=False,
            creationflags=creation_flags,
        )
    except subprocess.TimeoutExpired as exc:
        raise MyFilesAntivirusError("Microsoft Defender scan timed out") from exc
    except OSError as exc:
        raise MyFilesAntivirusError("Microsoft Defender scan could not start") from exc

    output = f"{result.stdout}\n{result.stderr}".strip().lower()
    if result.returncode == 0 and "found no threats" in output:
        return SecurityScanResult(status="clean", engine="microsoft-defender")
    if "threat" in output and "found no threats" not in output:
        return SecurityScanResult(status="blocked", engine="microsoft-defender", detail="Threat detected")
    raise MyFilesAntivirusError(f"Microsoft Defender scan failed with exit code {result.returncode}")
