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

An entry may instead point at an update feed ``latest.json`` (as published for HUB Desktop)::

    {
      "hub-desktop": {
        "feed": "C:/inetpub/wwwroot/hub-desktop-updates/stable/latest.json",
        "kind": "exe",
        "args": ["/quiet", "/norestart"],
        "display_name": "HUB Desktop"
      }
    }

The feed lives at ``<root>/<channel>/latest.json`` and its ``relative_path`` is resolved against ``<root>``;
``version`` and ``sha256`` come from the feed, so publishing a new release updates the package automatically.
Explicit ``file``/``version``/``sha256`` in the entry override the feed values.
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
    size_bytes: int = 0
    channel: str = ""
    published_at: str = ""


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


def _resolve_feed_entry(base: Path, entry: Dict[str, Any], pid: str) -> Dict[str, Any]:
    """Fill ``file``/``version``/``sha256`` of a manifest entry from an update feed ``latest.json``."""
    feed_text = str(entry.get("feed") or "").strip()
    if not feed_text:
        return entry
    feed_path = Path(feed_text)
    if not feed_path.is_absolute():
        feed_path = base.parent / feed_path
    if not feed_path.is_file():
        raise InstallPackageError(f"Package {pid}: update feed not found: {feed_path}")
    try:
        feed = json.loads(feed_path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise InstallPackageError(f"Package {pid}: update feed unreadable: {exc}") from exc
    if not isinstance(feed, dict):
        raise InstallPackageError(f"Package {pid}: update feed must be a JSON object")

    # latest.json sits at <root>/<channel>/latest.json; relative_path is from <root>.
    feed_root = feed_path.parent.parent.resolve()
    rel = str(feed.get("relative_path") or "").strip().replace("/", "\\")
    if not rel or rel.startswith(("\\", "~")) or Path(rel).is_absolute():
        raise InstallPackageError(f"Package {pid}: feed relative_path is invalid")
    file_path = (feed_root / rel).resolve()
    if feed_root != file_path and feed_root not in file_path.parents:
        raise InstallPackageError(f"Package {pid}: feed relative_path escapes the feed root")

    merged = dict(entry)
    if not str(merged.get("file") or "").strip():
        merged["file"] = str(file_path)
    if not str(merged.get("version") or "").strip():
        merged["version"] = str(feed.get("version") or "").strip()
    if not str(merged.get("sha256") or "").strip():
        merged["sha256"] = str(feed.get("sha256") or "").strip()
    merged.setdefault("channel", str(feed.get("channel") or "").strip())
    merged.setdefault("published_at", str(feed.get("published_at") or "").strip())
    return merged


def resolve_install_package(manifest_path: str, package_id: str) -> InstallPackageInfo:
    pid = str(package_id or "").strip().lower()
    if not PACKAGE_ID_RE.match(pid):
        raise InstallPackageError("Invalid package_id")
    base, manifest = _load_manifest(manifest_path)
    entry = manifest.get(pid)
    if not isinstance(entry, dict):
        raise InstallPackageError(f"Unknown package: {pid}")
    entry = _resolve_feed_entry(base, entry, pid)

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
    if sha:
        if len(sha) != 64 or any(ch not in "0123456789abcdef" for ch in sha):
            raise InstallPackageError(f"Package {pid}: sha256 must be 64 hex characters")
        # Fail fast while the manifest/feed is served, not after agents pulled 200 MB of a bad file.
        if _sha256_cached(file_path) != sha:
            raise InstallPackageError(f"Package {pid}: file does not match sha256")
    else:
        sha = _sha256_cached(file_path)

    return InstallPackageInfo(
        package_id=pid,
        local_path=file_path,
        sha256=sha,
        kind=kind,
        args=tuple(args),
        version=str(entry.get("version") or "").strip(),
        display_name=str(entry.get("display_name") or "").strip(),
        filename=file_path.name,
        size_bytes=file_path.stat().st_size,
        channel=str(entry.get("channel") or "").strip(),
        published_at=str(entry.get("published_at") or "").strip(),
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


def list_install_packages(manifest_path: str) -> Dict[str, Any]:
    """Safe package metadata for the admin UI; no filesystem paths or hashes leave the server."""
    try:
        _, manifest = _load_manifest(manifest_path)
    except InstallPackageError as exc:
        return {"configured": False, "error": str(exc), "packages": []}
    packages: List[Dict[str, Any]] = []
    for pid in sorted(manifest):
        raw = manifest.get(pid)
        item: Dict[str, Any] = {"package_id": pid, "ok": False}
        if not isinstance(raw, dict):
            item["error"] = "entry must be an object"
            packages.append(item)
            continue
        try:
            info = resolve_install_package(manifest_path, pid)
        except InstallPackageError as exc:
            item["display_name"] = str(raw.get("display_name") or "").strip()
            item["error"] = str(exc)
            packages.append(item)
            continue
        item.update(
            {
                "ok": True,
                "display_name": info.display_name,
                "version": info.version,
                "kind": info.kind,
                "filename": info.filename,
                "size_bytes": info.size_bytes,
                "channel": info.channel,
                "published_at": info.published_at,
            }
        )
        packages.append(item)
    return {"configured": True, "error": "", "packages": packages}
