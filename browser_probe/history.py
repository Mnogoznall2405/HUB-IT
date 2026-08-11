"""Chromium History SQLite: discover profiles, copy DB, read visit deltas."""

from __future__ import annotations

import logging
import os
import shutil
import sqlite3
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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


def discover_profiles(local_app_data: Path | None = None) -> list[BrowserProfile]:
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
                    )
                )
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


def read_visits_since(
    profile: BrowserProfile,
    *,
    since_visit_id: int = 0,
    limit: int = 400,
    work_dir: Path | None = None,
) -> list[dict[str, Any]]:
    """Return visits with visit_id > since_visit_id, oldest first."""
    tmp_root = Path(work_dir or tempfile.gettempdir()) / "hub_it_browser_hist"
    tmp_dir = tmp_root / f"{profile.browser}_{profile.profile}"
    copied = _copy_history_db(profile.history_path, tmp_dir)
    if copied is None:
        return []

    rows: list[dict[str, Any]] = []
    max_seen_id = int(since_visit_id or 0)
    try:
        conn = sqlite3.connect(f"file:{copied.as_posix()}?mode=ro", uri=True, timeout=5.0)
        try:
            conn.row_factory = sqlite3.Row
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
                (int(since_visit_id or 0), int(limit)),
            )
            for row in cur.fetchall():
                vid = int(row["visit_id"] or 0)
                if vid > max_seen_id:
                    max_seen_id = vid
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
                        "_cursor_visit_id": max_seen_id,
                    }
                )
        finally:
            conn.close()
    except sqlite3.Error as exc:
        log.warning("history query failed %s: %s", profile.history_path, exc)
        return []
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


def read_recent_title_urls(
    profile: BrowserProfile,
    *,
    limit: int = 300,
    work_dir: Path | None = None,
) -> dict[str, str]:
    """Map lower(title) → url from newest History rows (does not advance cursors)."""
    tmp_root = Path(work_dir or tempfile.gettempdir()) / "hub_it_browser_hist"
    tmp_dir = tmp_root / f"{profile.browser}_{profile.profile}"
    copied = _copy_history_db(profile.history_path, tmp_dir)
    if copied is None:
        return {}
    out: dict[str, str] = {}
    try:
        conn = sqlite3.connect(f"file:{copied.as_posix()}?mode=ro", uri=True, timeout=5.0)
        try:
            conn.row_factory = sqlite3.Row
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
            for row in cur.fetchall():
                title = str(row["title"] or "").strip().lower()
                url = str(row["url"] or "").strip()
                if not title or not url or is_noise_visit(url, title):
                    continue
                # First (newest) wins.
                if title not in out:
                    out[title] = url
        finally:
            conn.close()
    except sqlite3.Error as exc:
        log.debug("recent title urls failed %s: %s", profile.history_path, exc)
    return out


def bootstrap_cursors(profiles: list[BrowserProfile], work_dir: Path | None = None) -> dict[str, int]:
    """Start from current max visit_id so first run does not dump full history."""
    cursors: dict[str, int] = {}
    for profile in profiles:
        key = f"{profile.browser}|{profile.profile}"
        tmp_root = Path(work_dir or tempfile.gettempdir()) / "hub_it_browser_hist"
        tmp_dir = tmp_root / f"{profile.browser}_{profile.profile}"
        copied = _copy_history_db(profile.history_path, tmp_dir)
        if copied is None:
            cursors[key] = 0
            continue
        try:
            conn = sqlite3.connect(f"file:{copied.as_posix()}?mode=ro", uri=True, timeout=5.0)
            try:
                row = conn.execute("SELECT COALESCE(MAX(id), 0) FROM visits").fetchone()
                cursors[key] = int(row[0] or 0) if row else 0
            finally:
                conn.close()
        except sqlite3.Error:
            cursors[key] = 0
    return cursors
