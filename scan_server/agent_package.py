"""Resolve MSI package metadata for agent self_update tasks."""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from agent_version import AGENT_VERSION

logger = logging.getLogger("scan-server")

_SHA_CACHE: dict[str, tuple[float, int, str]] = {}


@dataclass(frozen=True)
class AgentPackageInfo:
    msi_url: str
    msi_sha256: str
    expected_version: str
    filename: str
    local_path: Optional[Path] = None


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _cached_sha256(path: Path) -> str:
    key = str(path.resolve())
    stat = path.stat()
    cached = _SHA_CACHE.get(key)
    if cached and cached[0] == stat.st_mtime and cached[1] == stat.st_size:
        return cached[2]
    value = _sha256_file(path)
    _SHA_CACHE[key] = (stat.st_mtime, stat.st_size, value)
    return value


def resolve_agent_package(
    *,
    package_path: str = "",
    package_url: str = "",
    package_sha256: str = "",
) -> AgentPackageInfo:
    """
    Build server-controlled self_update payload fields.

    Priority:
    1. Local MSI path (SCAN_AGENT_PACKAGE_PATH) — preferred; can serve via /agent-package
    2. External URL (SCAN_AGENT_PACKAGE_URL) — UNC or https; requires SHA256
    """
    path_text = str(package_path or "").strip()
    url_text = str(package_url or "").strip()
    sha_text = str(package_sha256 or "").strip().lower()
    expected = str(AGENT_VERSION or "").strip() or "unknown"

    local_path: Optional[Path] = None
    if path_text:
        candidate = Path(path_text)
        if candidate.is_file():
            local_path = candidate
        else:
            raise FileNotFoundError(f"Agent package file not found: {candidate}")

    if local_path is not None:
        sha = sha_text or _cached_sha256(local_path)
        msi_url = url_text or "agent-package"
        return AgentPackageInfo(
            msi_url=msi_url,
            msi_sha256=sha,
            expected_version=expected,
            filename=local_path.name,
            local_path=local_path,
        )

    if url_text:
        if not sha_text or len(sha_text) != 64:
            raise ValueError(
                "SCAN_AGENT_PACKAGE_SHA256 (64 hex chars) is required when using SCAN_AGENT_PACKAGE_URL without a local file"
            )
        filename = Path(url_text.replace("\\", "/").rstrip("/")).name or f"IT-Invent-Agent-{expected}-win64.msi"
        return AgentPackageInfo(
            msi_url=url_text,
            msi_sha256=sha_text,
            expected_version=expected,
            filename=filename,
            local_path=None,
        )

    raise FileNotFoundError(
        "Agent package is not configured. Set SCAN_AGENT_PACKAGE_PATH to an MSI file "
        "(recommended) or SCAN_AGENT_PACKAGE_URL + SCAN_AGENT_PACKAGE_SHA256."
    )


def package_payload(info: AgentPackageInfo) -> dict:
    return {
        "msi_url": info.msi_url,
        "msi_sha256": info.msi_sha256,
        "expected_version": info.expected_version,
        "filename": info.filename,
    }
