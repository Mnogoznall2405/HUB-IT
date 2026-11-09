"""Chromium History SQLite: discover profiles, copy DB, read visit deltas."""

from __future__ import annotations

import logging
import os
import shutil
import sqlite3
import tempfile
from contextlib import closing, contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .classify import classify_visit, is_noise_visit

log = logging.getLogger("browser_probe.history")

# Chromium stores microseconds since 1601-01-01 UTC
_CHROMIUM_EPOCH = datetime(1601, 1, 1, tzinfo=timezone.utc)

BROWSER_SPECS = (
    {
        "browser": "chrome",
        "rel": Path("Google") / "Chrome" / "User Data",
    },
    {
        "browser": "edge",
        "rel": Path("Microsoft") / "Edge" / "User Data",
    },
    {
        "browser": "yandex",
        "rel": Path("Yandex") / "YandexBrowser" / "User Data",
    },
)


@dataclass(frozen=True)
class BrowserProfile:
    browser: str
    profile: str
    history_path: Path
    windows_user: str = ""


def profile_cursor_key(profile: BrowserProfile) -> str:
    user = str(profile.windows_user or "").strip()
    base = f"{profile.browser}|{profile.profile}"
    return f"{user}|{base}" if user else base


def discover_profiles(local_app_data: Path | None = None, *, windows_user: str = "") -> list[BrowserProfile]:
    root = Path(local_app_data or os.environ.get("LOCALAPPDATA", "") or "")
    if not root.is_dir():
        return []
    found: list[BrowserProfile] = []
    for spec in BROWSER_SPECS:
        base = root / spec["rel"]
        if not base.is_dir():
            continue
        for child in sorted(base.iterdir()):
            if not child.is_dir():
                continue
            name = child.name
            if name != "Default" and not name.startswith("Profile"):
                continue
            hist = child / "History"
            if hist.is_file():
                found.append(
                    BrowserProfile(
                        browser=str(spec["browser"]),
                        profile=name,
                        history_path=hist,
                        windows_user=str(windows_user or ""),
                    )
                )
    return found


def discover_all_user_profiles(users_root: Path | None = None) -> list[BrowserProfile]:
    root = Path(users_root) if users_root else Path(os.environ.get("SystemDrive", "C:") + os.sep) / "Users"
    if not root.is_dir():
        return []
    skip = {"all users", "default", "default user", "public", "defaultapppool"}
    found: list[BrowserProfile] = []
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        name = child.name.strip()
        if not name or name.lower() in skip or name.startswith("."):
            continue
        local_app_data = child / "AppData" / "Local"
        if not local_app_data.is_dir():
            continue
        found.extend(discover_profiles(local_app_data, windows_user=name))
    return found


def chromium_time_to_iso(value: int | None) -> str | None:
    try:
        us = int(value or 0)
    except (TypeError, ValueError):
        return None
    if us <= 0:
        return None
    dt = _CHROMIUM_EPOCH.timestamp() + (us / 1_000_000.0)
    return datetime.fromtimestamp(dt, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _copy_history_db(src: Path, dest_dir: Path) -> Path | None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / "History"
    try:
        shutil.copy2(src, dest)
    except OSError as exc:
        log.debug("history copy failed %s: %s", src, exc)
        return None
    for suffix in ("-wal", "-shm"):
        side = Path(str(src) + suffix)
        if side.is_file():
            try:
                shutil.copy2(side, dest_dir / side.name)
            except OSError:
                pass
    return dest


@contextmanager
def _history_snapshot(
    profile: BrowserProfile,
    work_dir: Path | None,
) -> Iterator[sqlite3.Connection | None]:
    root = Path(work_dir or tempfile.gettempdir()) / "hub_it_browser_hist"
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=root) as directory:
        copied = _copy_history_db(profile.history_path, Path(directory))
        if copied is None:
            yield None
            return
        with closing(sqlite3.connect(f"{copied.resolve().as_uri()}?mode=ro", uri=True, timeout=5.0)) as conn:
            conn.row_factory = sqlite3.Row
            yield conn


def _query_visits(
    conn: sqlite3.Connection, profile: BrowserProfile, since_visit_id: int, limit: int,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    max_seen_id = int(since_visit_id or 0)
    cur = conn.execute(
        """
        SELECT
          v.id AS visit_id,
          v.visit_time AS visit_time,
          u.url AS url,
          u.title AS title,
          u.visit_count AS visit_count
        FROM visits v
        JOIN urls u ON u.id = v.url
        WHERE v.id > ?
        ORDER BY v.id ASC
        LIMIT ?
        """,
        (max_seen_id, int(limit)),
    )
    for row in cur:
        vid = int(row["visit_id"] or 0)
        max_seen_id = max(vid, max_seen_id)
        url = str(row["url"] or "")
        title = str(row["title"] or "")[:500]
        if is_noise_visit(url, title):
            continue
        domain, category = classify_visit(url, title)
        rows.append(
            {
                "visit_id": vid,
                "browser": profile.browser,
                "profile": profile.profile,
                "url": url,
                "title": title,
                "domain": domain,
                "category": category,
                "visit_count": int(row["visit_count"] or 0),
                "visited_at": chromium_time_to_iso(row["visit_time"]),
            }
        )
    # Even if all rows were noise, advance cursor via sentinel so watcher does not stall.
    if max_seen_id > int(since_visit_id or 0) and not rows:
        rows.append(
            {
                "visit_id": max_seen_id,
                "browser": profile.browser,
                "profile": profile.profile,
                "_noise_cursor_only": True,
            }
        )
    elif rows:
        for row in rows:
            row["_cursor_visit_id"] = max_seen_id
    return rows


def _query_recent_title_urls(conn: sqlite3.Connection, limit: int) -> dict[str, str]:
    out: dict[str, str] = {}
    cur = conn.execute(
        """
        SELECT u.url AS url, u.title AS title
        FROM visits v
        JOIN urls u ON u.id = v.url
        ORDER BY v.id DESC
        LIMIT ?
        """,
        (int(limit),),
    )
    for row in cur:
        title = str(row["title"] or "").strip().lower()
        url = str(row["url"] or "").strip()
        if title and url and not is_noise_visit(url, title):
            out.setdefault(title, url)
    return out


def read_visits_since(
    profile: BrowserProfile,
    *,
    since_visit_id: int = 0,
    limit: int = 400,
    work_dir: Path | None = None,
) -> list[dict[str, Any]]:
    """Return visits with visit_id > since_visit_id, oldest first."""
    try:
        with _history_snapshot(profile, work_dir) as conn:
            return _query_visits(conn, profile, since_visit_id, limit) if conn else []
    except sqlite3.Error as exc:
        log.warning("history query failed %s: %s", profile.history_path, exc)
        return []


def read_recent_title_urls(
    profile: BrowserProfile,
    *,
    limit: int = 300,
    work_dir: Path | None = None,
) -> dict[str, str]:
    """Map lower(title) → url from newest History rows (does not advance cursors)."""
    try:
        with _history_snapshot(profile, work_dir) as conn:
            return _query_recent_title_urls(conn, limit) if conn else {}
    except sqlite3.Error as exc:
        log.debug("recent title urls failed %s: %s", profile.history_path, exc)
        return {}


def _latest_visit_id(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT COALESCE(MAX(id), 0) FROM visits").fetchone()
    return int(row[0] or 0) if row else 0


def read_history_cycle(
    profile: BrowserProfile, *, since_visit_id: int | None, work_dir: Path,
) -> tuple[list[dict[str, Any]], dict[str, str], int]:
    """Read title hints and visits from one snapshot. None initializes the cursor."""
    since = int(since_visit_id or 0)
    hints: dict[str, str] = {}
    try:
        with _history_snapshot(profile, work_dir) as conn:
            if conn is not None:
                try:
                    hints = _query_recent_title_urls(conn, 300)
                except sqlite3.Error as exc:
                    log.debug("recent title urls failed %s: %s", profile.history_path, exc)
                if since_visit_id is None:
                    return [], hints, _latest_visit_id(conn)
                rows = _query_visits(conn, profile, since, 400)
                cursor = int(rows[-1].get("_cursor_visit_id") or rows[-1]["visit_id"]) if rows else since
                return rows, hints, cursor
    except sqlite3.Error as exc:
        log.warning("history query failed %s: %s", profile.history_path, exc)
    return [], hints, since


def bootstrap_cursors(profiles: list[BrowserProfile], work_dir: Path | None = None) -> dict[str, int]:
    """Start from current max visit_id so first run does not dump full history."""
    cursors: dict[str, int] = {}
    for profile in profiles:
        key = profile_cursor_key(profile)
        try:
            with _history_snapshot(profile, work_dir) as conn:
                cursors[key] = _latest_visit_id(conn) if conn else 0
        except sqlite3.Error:
            cursors[key] = 0
    return cursors
