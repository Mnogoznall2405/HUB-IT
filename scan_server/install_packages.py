"""Server-side registry of software the agents may install (``install_package`` tasks).

The manifest is a JSON file controlled by the administrator (``SCAN_INSTALL_MANIFEST_PATH``); nothing about a
package - file, installer kind, arguments, hash - ever comes from the task creator or the agent::

    {
      "hub-desktop": {
        "file": "HUB-Desktop-Setup-0.1.50-win-x64.exe",
        "kind": "exe",
        "args": ["/quiet", "/norestart"],
        "version": "0.1.50",
        "display_name": "HUB Desktop"
      }
    }

``file`` is relative to the manifest directory (absolute paths are allowed). ``sha256`` is optional: when it
is missing the hash of the file is computed (and cached by mtime/size).
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

PACKAGE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
INSTALLER_KINDS = {"msi", "exe"}

_SHA_CACHE: Dict[str, Tuple[float, int, str]] = {}


class InstallPackageError(ValueError):
    """Manifest or package problem (maps to HTTP 503/404 at the API layer)."""


@dataclass(frozen=True)
class InstallPackageInfo:
    package_id: str
    local_path: Path
    sha256: str
    kind: str
    args: Tuple[str, ...]
    version: str
    display_name: str
    filename: str


def _sha256_cached(path: Path) -> str:
    key = str(path.resolve())
    stat = path.stat()
    cached = _SHA_CACHE.get(key)
    if cached and cached[0] == stat.st_mtime and cached[1] == stat.st_size:
        return cached[2]
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    value = digest.hexdigest()
    _SHA_CACHE[key] = (stat.st_mtime, stat.st_size, value)
    return value


def _load_manifest(manifest_path: str) -> Tuple[Path, Dict[str, Any]]:
    text = str(manifest_path or "").strip()
    if not text:
        raise InstallPackageError("Install packages are not configured (SCAN_INSTALL_MANIFEST_PATH is empty)")
    path = Path(text)
    if not path.is_file():
        raise InstallPackageError(f"Install manifest not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise InstallPackageError(f"Install manifest is unreadable: {exc}") from exc
    if not isinstance(data, dict):
        raise InstallPackageError("Install manifest must be a JSON object")
    return path, data


def resolve_install_package(manifest_path: str, package_id: str) -> InstallPackageInfo:
    pid = str(package_id or "").strip().lower()
    if not PACKAGE_ID_RE.match(pid):
        raise InstallPackageError("Invalid package_id")
    base, manifest = _load_manifest(manifest_path)
    entry = manifest.get(pid)
    if not isinstance(entry, dict):
        raise InstallPackageError(f"Unknown package: {pid}")

    kind = str(entry.get("kind") or "").strip().lower()
    if kind not in INSTALLER_KINDS:
        raise InstallPackageError(f"Package {pid}: kind must be one of {sorted(INSTALLER_KINDS)}")
    raw_args = entry.get("args") or []
    if kind == "msi":
        raw_args = []  # msiexec arguments are fixed by the agent
    if not isinstance(raw_args, list) or not all(isinstance(item, str) for item in raw_args):
        raise InstallPackageError(f"Package {pid}: args must be a list of strings")
    args: List[str] = [item for item in raw_args if item.strip()]

    file_text = str(entry.get("file") or "").strip()
    if not file_text:
        raise InstallPackageError(f"Package {pid}: file is not set")
    file_path = Path(file_text)
    if not file_path.is_absolute():
        file_path = base.parent / file_path
    if not file_path.is_file():
        raise InstallPackageError(f"Package {pid}: file not found: {file_path}")

    sha = str(entry.get("sha256") or "").strip().lower()
    if not sha:
        sha = _sha256_cached(file_path)
    if len(sha) != 64 or any(ch not in "0123456789abcdef" for ch in sha):
        raise InstallPackageError(f"Package {pid}: sha256 must be 64 hex characters")

    return InstallPackageInfo(
        package_id=pid,
        local_path=file_path,
        sha256=sha,
        kind=kind,
        args=tuple(args),
        version=str(entry.get("version") or "").strip(),
        display_name=str(entry.get("display_name") or "").strip(),
        filename=file_path.name,
    )


def install_task_payload(info: InstallPackageInfo) -> Dict[str, Any]:
    return {
        "package_id": info.package_id,
        # Relative to the scan API base; the agent downloads it with its API key.
        "url": f"install-package?package_id={info.package_id}",
        "sha256": info.sha256,
        "kind": info.kind,
        "args": list(info.args),
        "version": info.version,
        "display_name": info.display_name,
        "filename": info.filename,
    }
