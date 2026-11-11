"""History-only collector for the SYSTEM inventory agent.

Collects Chromium-family browsing history across all local user profiles and
uploads it via BrowserProbeSync. Runs inside ITInventAgent (session 0): no UIA,
foreground tracking or screenshots — those stay in the interactive probe.
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .history import (
    bootstrap_cursors,
    discover_all_user_profiles,
    profile_cursor_key,
    read_visits_since,
)
from .sync import BrowserProbeSync

log = logging.getLogger("browser_probe.history_agent")


def _env_bool(name: str, default: bool) -> bool:
    raw = str(os.getenv(name, "1" if default else "0") or "").strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(str(os.getenv(name, str(default)) or default).strip())
    except Exception:
        return default


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def default_output_dir() -> Path:
    return Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "HUB-IT" / "Agent" / "BrowserHistory"


class BrowserHistoryCollector:
    def __init__(
        self,
        output_dir: Path,
        *,
        syncer: Optional[BrowserProbeSync] = None,
        history_interval_sec: float | None = None,
        users_root: Path | None = None,
    ) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.syncer = syncer
        self.users_root = Path(users_root) if users_root else None
        self.history_interval_sec = max(
            30.0,
            float(
                history_interval_sec
                if history_interval_sec is not None
                else _env_float("ITINV_BROWSER_HISTORY_SEC", 180)
            ),
        )
        self.state_path = self.output_dir / "state.json"
        self._cursors: Dict[str, int] = {}
        self._stop = False
        self._load_state()

    def request_stop(self) -> None:
        self._stop = True

    def _load_state(self) -> None:
        if not self.state_path.exists():
            return
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            cursors = data.get("visit_cursors") if isinstance(data, dict) else None
            if isinstance(cursors, dict):
                self._cursors = {str(k): int(v or 0) for k, v in cursors.items()}
        except Exception:
            self._cursors = {}

    def _save_state(self) -> None:
        payload = {
            "computer_name": str(os.environ.get("COMPUTERNAME", "") or ""),
            "visit_cursors": self._cursors,
            "updated_at": _utcnow_iso(),
        }
        self.state_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def collect_once(self) -> int:
        profiles = discover_all_user_profiles(self.users_root)
        if not profiles:
            return 0
        missing = [p for p in profiles if profile_cursor_key(p) not in self._cursors]
        if missing:
            self._cursors.update(
                bootstrap_cursors(missing, work_dir=self.output_dir / "hist_tmp")
            )
        visits_by_user: Dict[str, List[Dict[str, Any]]] = {}
        for profile in profiles:
            key = profile_cursor_key(profile)
            since = int(self._cursors.get(key, 0) or 0)
            rows = read_visits_since(
                profile,
                since_visit_id=since,
                limit=400,
                work_dir=self.output_dir / "hist_tmp",
            )
            if not rows:
                continue
            max_id = since
            user = str(profile.windows_user or "").strip()
            for row in rows:
                cursor_id = int(row.get("_cursor_visit_id") or row.get("visit_id") or 0)
                if cursor_id > max_id:
                    max_id = cursor_id
                if row.get("_noise_cursor_only"):
                    continue
                row.pop("_cursor_visit_id", None)
                row["windows_user"] = user
                # Server dedupe key lacks windows_user — namespace profile per user.
                if user:
                    row["profile"] = f"{user}@{row.get('profile') or 'Default'}"
                visits_by_user.setdefault(user or "unknown", []).append(row)
            if max_id > since:
                self._cursors[key] = max_id
        self._save_state()
        total = sum(len(rows) for rows in visits_by_user.values())
        if self.syncer and visits_by_user:
            computer = str(os.environ.get("COMPUTERNAME", "") or "")
            for user, rows in visits_by_user.items():
                self.syncer.enqueue(
                    {
                        "computer_name": computer,
                        "windows_user": user,
                        "visits": rows,
                        "focus_events": [],
                        "screenshots": [],
                    }
                )
            self.syncer.maybe_sync(force=False)
        return total

    def run_forever(self) -> None:
        log.info(
            "browser history collector start interval=%ss output=%s",
            self.history_interval_sec,
            self.output_dir,
        )
        while not self._stop:
            try:
                collected = self.collect_once()
                if collected:
                    log.info("browser history collected %s visits", collected)
            except Exception as exc:
                log.exception("browser history cycle failed: %s", exc)
            if self.syncer:
                try:
                    self.syncer.maybe_sync(force=False)
                except Exception as exc:
                    log.warning("browser history sync tick failed: %s", exc)
            time.sleep(self.history_interval_sec)


def _resolve_server_url() -> str:
    explicit = str(os.getenv("ITINV_BROWSER_PROBE_SERVER_URL", "") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    return str(os.getenv("ITINV_AGENT_SERVER_URL", "") or "").strip().rstrip("/")


def run_browser_history_forever() -> None:
    if not _env_bool("ITINV_BROWSER_HISTORY_ENABLED", False):
        log.info("browser history collector disabled by ITINV_BROWSER_HISTORY_ENABLED")
        return
    output_dir = Path(
        os.getenv("ITINV_BROWSER_HISTORY_OUTPUT", "") or str(default_output_dir())
    )
    api_key = str(
        os.getenv("ITINV_AGENT_API_KEY", "") or os.getenv("SCAN_AGENT_API_KEY", "") or ""
    ).strip()
    syncer = BrowserProbeSync(
        output_dir,
        server_url=_resolve_server_url(),
        api_key=api_key,
        sync_interval_sec=_env_float("ITINV_BROWSER_PROBE_SYNC_SEC", 120),
    )
    collector = BrowserHistoryCollector(output_dir, syncer=syncer)
    collector.run_forever()
