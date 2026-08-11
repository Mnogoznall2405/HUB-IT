"""Track user-document paths opened by messenger processes (disk → send).

UIA only sees the chat bubble (often just the file name). This module polls
process open handles + Windows Recent shortcuts to recover the real path
(e.g. C:\\Users\\...\\Desktop\\report.xlsx).
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import psutil

from .profile import TELEGRAM, MessengerProfile

logger = logging.getLogger(__name__)

_INTERESTING_FRAGMENTS = (
    "\\desktop\\",
    "\\documents\\",
    "\\downloads\\",
    "\\pictures\\",
    "\\videos\\",
    "\\music\\",
    "\\onedrive",
    "\\яндекс диск\\",
    "\\yandex.disk\\",
    "\\google drive\\",
    "\\dropbox\\",
)

_IGNORE_FRAGMENTS = (
    "\\tdata\\",
    "\\appdata\\roaming\\telegram desktop\\",
    "\\appdata\\local\\temp\\",
    "\\appdata\\local\\microsoft\\windows\\inetcache\\",
    "\\appdata\\local\\max\\",
    "\\appdata\\local\\oneme\\",  # MAX runtime/history/logs — not user egress
    "\\appdata\\roaming\\max\\",
    "\\appdata\\",  # messenger internals under AppData are never user file sends
    "\\.crash_dumps\\",
    "\\program files\\",
    "\\program files (x86)\\",
    "\\windows\\",
    "\\$recycle.bin\\",
    "\\node_modules\\",
    "\\.git\\",
)


@dataclass(frozen=True)
class DiskAccess:
    path: str
    file_name: str
    pid: int
    process_name: str
    source: str  # open_files | recent_lnk
    seen_at: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "file_name": self.file_name,
            "pid": self.pid,
            "process_name": self.process_name,
            "source": self.source,
            "seen_at": self.seen_at,
        }


class DiskAccessTracker:
    """Best-effort disk path tracker for messenger upload/send flows."""

    def __init__(
        self,
        profile: MessengerProfile | None = None,
        *,
        ttl_sec: float = 900.0,
        recent_scan_sec: float = 2.0,
    ) -> None:
        self.profile = profile or TELEGRAM
        self.ttl_sec = max(60.0, float(ttl_sec))
        self.recent_scan_sec = max(0.5, float(recent_scan_sec))
        self._known: dict[str, float] = {}
        self._recent: list[DiskAccess] = []
        self._last_recent_scan = 0.0

    def poll(self, preferred_pid: int | None = None) -> list[DiskAccess]:
        """Return newly observed interesting file paths."""
        now = time.monotonic()
        self._expire(now)
        found: list[DiskAccess] = []
        for pid, name in self._target_pids(preferred_pid):
            for path in self._open_files(pid):
                acc = self._maybe_record(
                    path,
                    pid=pid,
                    process_name=name,
                    source="open_files",
                    now=now,
                )
                if acc is not None:
                    found.append(acc)
        # Common Open/Save dialog while attaching a file (Telegram closes handles fast).
        for path in _read_file_dialog_paths(preferred_pid):
            acc = self._maybe_record(
                path,
                pid=int(preferred_pid or 0),
                process_name="file_dialog",
                source="file_dialog",
                now=now,
            )
            if acc is not None:
                found.append(acc)
        if (now - self._last_recent_scan) >= self.recent_scan_sec:
            self._last_recent_scan = now
            for path in self._recent_shortcut_targets(max_age_sec=300):
                acc = self._maybe_record(
                    path,
                    pid=int(preferred_pid or 0),
                    process_name="recent",
                    source="recent_lnk",
                    now=now,
                )
                if acc is not None:
                    found.append(acc)
        return found

    def match_filename(self, file_name: str, *, within_sec: float = 300.0) -> str | None:
        """Best recent disk path whose basename matches file_name."""
        want = _norm_name(file_name)
        if not want:
            return None
        now = time.monotonic()
        best: DiskAccess | None = None
        for acc in reversed(self._recent):
            if (now - acc.seen_at) > within_sec:
                continue
            if _norm_name(acc.file_name) != want:
                continue
            if best is None or acc.seen_at >= best.seen_at:
                best = acc
        if best is not None:
            return best.path
        # Fallback: unique match under Desktop/Documents/Downloads/…
        return resolve_in_user_folders(want)

    def recent(self, *, within_sec: float = 300.0) -> list[DiskAccess]:
        now = time.monotonic()
        return [a for a in self._recent if (now - a.seen_at) <= within_sec]

    def _maybe_record(
        self,
        path: str,
        *,
        pid: int,
        process_name: str,
        source: str,
        now: float,
    ) -> DiskAccess | None:
        clean = _normalize_path(path)
        if not clean or not _is_interesting(clean):
            return None
        prev = self._known.get(clean)
        # Re-emit only after TTL so the same Desktop file re-sent later is logged.
        if prev is not None and (now - prev) < self.ttl_sec:
            self._known[clean] = now
            return None
        self._known[clean] = now
        acc = DiskAccess(
            path=clean,
            file_name=Path(clean).name,
            pid=pid,
            process_name=process_name,
            source=source,
            seen_at=now,
        )
        self._recent.append(acc)
        if len(self._recent) > 400:
            self._recent = self._recent[-300:]
        return acc

    def _expire(self, now: float) -> None:
        cutoff = now - self.ttl_sec
        self._known = {p: ts for p, ts in self._known.items() if ts >= cutoff}
        self._recent = [a for a in self._recent if a.seen_at >= cutoff]

    def _target_pids(self, preferred_pid: int | None) -> list[tuple[int, str]]:
        out: list[tuple[int, str]] = []
        seen: set[int] = set()
        if preferred_pid:
            try:
                proc = psutil.Process(int(preferred_pid))
                name = (proc.name() or "").lower()
                if name in self.profile.process_names:
                    out.append((int(preferred_pid), name))
                    seen.add(int(preferred_pid))
            except (psutil.Error, ValueError, TypeError):
                pass
        for proc in psutil.process_iter(["pid", "name"]):
            try:
                name = str(proc.info.get("name") or "").lower()
                pid = int(proc.info.get("pid") or 0)
            except (psutil.Error, TypeError, ValueError):
                continue
            if not pid or pid in seen:
                continue
            if name not in self.profile.process_names:
                continue
            out.append((pid, name))
            seen.add(pid)
        return out

    @staticmethod
    def _open_files(pid: int) -> list[str]:
        try:
            proc = psutil.Process(int(pid))
            files = proc.open_files()
        except (psutil.Error, ValueError, TypeError) as exc:
            logger.debug("open_files pid=%s failed: %s", pid, exc)
            return []
        paths: list[str] = []
        for item in files or []:
            path = str(getattr(item, "path", "") or "").strip()
            if path:
                paths.append(path)
        return paths

    @staticmethod
    def _recent_shortcut_targets(*, max_age_sec: float) -> list[str]:
        appdata = os.environ.get("APPDATA") or ""
        if not appdata:
            return []
        recent_dir = Path(appdata) / "Microsoft" / "Windows" / "Recent"
        if not recent_dir.is_dir():
            return []
        now = time.time()
        out: list[str] = []
        try:
            entries = sorted(
                recent_dir.glob("*.lnk"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
        except OSError:
            return []
        for link in entries[:40]:
            try:
                mtime = link.stat().st_mtime
            except OSError:
                continue
            if (now - mtime) > max_age_sec:
                break
            target = _resolve_lnk(link)
            if target:
                out.append(target)
        return out


def resolve_in_user_folders(file_name: str) -> str | None:
    """Find a unique file by basename under common user document roots."""
    want = _norm_name(file_name)
    if not want or "." not in want:
        return None
    hits: list[str] = []
    for root in _user_document_roots():
        try:
            for path in _iter_shallow_files(root, max_depth=2):
                if path.name.lower() != want:
                    continue
                if not _is_interesting(str(path)):
                    continue
                hits.append(str(path))
                if len(hits) > 3:
                    return None
        except OSError:
            continue
    if len(hits) == 1:
        return hits[0]
    return None


def _iter_shallow_files(root: Path, *, max_depth: int = 2) -> Iterable[Path]:
    stack: list[tuple[Path, int]] = [(root, 0)]
    while stack:
        cur, depth = stack.pop()
        try:
            entries = list(cur.iterdir())
        except OSError:
            continue
        for entry in entries:
            try:
                if entry.is_file():
                    yield entry
                elif entry.is_dir() and depth < max_depth:
                    name = entry.name.lower()
                    if name.startswith(".") or name in {"node_modules", ".git"}:
                        continue
                    stack.append((entry, depth + 1))
            except OSError:
                continue


def _user_document_roots() -> list[Path]:
    roots: list[Path] = []
    home = Path(os.environ.get("USERPROFILE") or "")
    if home.is_dir():
        for name in ("Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music"):
            candidate = home / name
            if candidate.is_dir():
                roots.append(candidate)
        try:
            for child in home.iterdir():
                if child.is_dir() and child.name.lower().startswith("onedrive"):
                    roots.append(child)
        except OSError:
            pass
    # Also scan other local profiles (agent may run elevated / different user).
    users = Path(os.environ.get("SystemDrive", "C:") + "\\Users")
    if users.is_dir():
        skip = {"public", "default", "default user", "all users", "defaultapppool"}
        try:
            profiles = list(users.iterdir())
        except OSError:
            profiles = []
        for profile in profiles:
            if not profile.is_dir() or profile.name.lower() in skip:
                continue
            if home and profile.resolve() == home.resolve():
                continue
            for name in ("Desktop", "Documents", "Downloads"):
                candidate = profile / name
                if candidate.is_dir():
                    roots.append(candidate)
    # Dedup
    seen: set[str] = set()
    out: list[Path] = []
    for root in roots:
        key = str(root).lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(root)
    return out


def _read_file_dialog_paths(preferred_pid: int | None) -> list[str]:
    """Best-effort: path from Windows Open/Save file dialog owned by messenger."""
    try:
        import win32gui
        import win32process
    except ImportError:
        return []

    targets: list[str] = []

    def enum_handler(hwnd: int, _lparam: object) -> bool:
        try:
            if not win32gui.IsWindowVisible(hwnd):
                return True
            title = (win32gui.GetWindowText(hwnd) or "").strip().lower()
            if not title:
                return True
            if not any(
                x in title
                for x in (
                    "open",
                    "открой",
                    "открыть",
                    "save",
                    "сохранить",
                    "browse",
                    "обзор",
                )
            ):
                return True
            _tid, pid = win32process.GetWindowThreadProcessId(hwnd)
            pid = int(pid)
            if preferred_pid and pid != int(preferred_pid):
                # Dialog can be hosted by explorer/comdlg — still accept if Edit has a path.
                pass
            path = _dialog_filename_value(hwnd)
            if path:
                targets.append(path)
        except Exception:
            pass
        return True

    try:
        win32gui.EnumWindows(enum_handler, None)
    except Exception:
        return []
    return targets


def _dialog_filename_value(hwnd: int) -> str:
    try:
        import uiautomation as auto
    except ImportError:
        return ""
    try:
        root = auto.ControlFromHandle(int(hwnd))
    except Exception:
        return ""
    best = ""
    stack = [(root, 0)]
    seen: set[int] = set()
    while stack:
        el, depth = stack.pop()
        if depth > 12:
            continue
        key = id(el)
        if key in seen:
            continue
        seen.add(key)
        try:
            ct = str(el.ControlTypeName or "")
            name = str(el.Name or "").lower()
        except Exception:
            ct, name = "", ""
        if "Edit" in ct or "edit" in name or "имя файла" in name or "file name" in name:
            text = ""
            try:
                pat = el.GetValuePattern()
                if pat and pat.Value:
                    text = str(pat.Value)
            except Exception:
                pass
            if not text:
                try:
                    text = str(el.Name or "")
                except Exception:
                    text = ""
            text = text.strip().strip('"')
            if text and (":\\" in text or text.startswith("\\\\")) and len(text) > len(best):
                best = text
        try:
            for ch in el.GetChildren():
                stack.append((ch, depth + 1))
        except Exception:
            pass
    if best and Path(best).exists():
        return best
    # Dialog sometimes returns only the file name — resolve under user folders.
    if best and "\\" not in best and "/" not in best:
        resolved = resolve_in_user_folders(best)
        if resolved:
            return resolved
    return best if best and (":\\" in best or best.startswith("\\\\")) else ""


def extract_file_basename(blob: str) -> str:
    """Pull a likely file name from UIA media/text like 'Файл, dogovor.docx (12 КБ)'."""
    import re

    text = str(blob or "").strip()
    if not text:
        return ""
    m = re.match(
        r"^(?:Файл|File|Документ|Document)\b[,:\s]+(.+?)(?:\s*[\(（][^)）]+[\)）])?\s*$",
        text,
        re.IGNORECASE,
    )
    candidate = (m.group(1) if m else text).strip().strip("\"'")
    # Prefer token that looks like a filename with extension.
    for part in reversed(re.split(r"[\\/]", candidate)):
        part = part.strip()
        if "." in part and 1 < len(part) <= 240:
            return part
    return candidate[:240]


def _normalize_path(path: str) -> str:
    raw = str(path or "").strip().strip('"')
    if not raw:
        return ""
    try:
        return str(Path(raw))
    except Exception:
        return raw


def _norm_name(name: str) -> str:
    return Path(str(name or "").strip()).name.lower()


def _is_interesting(path: str) -> bool:
    low = path.replace("/", "\\").lower()
    if not low or low.endswith("\\"):
        return False
    try:
        if Path(path).is_dir():
            return False
    except OSError:
        pass
    # Require a file-looking name (dirs like ...\Downloads must not pass).
    name = Path(low).name
    if not name or "." not in name:
        return False
    for frag in _IGNORE_FRAGMENTS:
        if frag in low:
            return False
    # Always keep explicit user-profile document areas.
    if any(frag in low for frag in _INTERESTING_FRAGMENTS):
        return True
    # Also allow other paths under C:\Users\<name>\... except ignored.
    if "\\users\\" in low:
        return True
    return False


def _resolve_lnk(link: Path) -> str:
    try:
        import win32com.client  # type: ignore

        shell = win32com.client.Dispatch("WScript.Shell")
        shortcut = shell.CreateShortCut(str(link))
        target = str(getattr(shortcut, "Targetpath", "") or "").strip()
        if target and Path(target).exists():
            return target
    except Exception:
        pass
    # Fallback: many .lnk names are "file.docx.lnk" — not a full path.
    return ""


def enrich_messages_with_source_paths(
    messages: Iterable[dict[str, Any]],
    tracker: DiskAccessTracker,
    *,
    within_sec: float = 300.0,
) -> int:
    """Set source_path on outgoing file-like messages when basename matches."""
    n = 0
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        if msg.get("source_path"):
            continue
        direction = str(msg.get("direction") or "").lower()
        outgoing = direction in {"out", "outgoing", "sent"} or bool(msg.get("outgoing"))
        if not outgoing:
            continue
        blob = str(msg.get("media") or msg.get("text") or "")
        media_l = str(msg.get("media") or "").lower()
        if media_l not in {"file", "document", "audio", "video", "photo"} and not any(
            x in blob.lower() for x in ("файл", "file", "документ", "document")
        ):
            # Still try basename if text looks like name.ext
            base = extract_file_basename(blob)
            if not base or "." not in base:
                continue
        else:
            base = extract_file_basename(blob) or Path(blob).name
        path = tracker.match_filename(base, within_sec=within_sec)
        if not path:
            continue
        msg["source_path"] = path
        n += 1
    return n
