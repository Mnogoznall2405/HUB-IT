"""Periodic report rebuild + upload of chats/media/events; emit file_left for outgoing files."""

from __future__ import annotations

import json
import logging
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set

import requests

from .profile import TELEGRAM, MessengerProfile
from .report import regenerate_from_output

logger = logging.getLogger("telegram_probe.sync")

FILE_MEDIA_RE = re.compile(
    r"^(Файл|File)\b[,:\s]+(?P<name>.+?)(?:\s*[\(（]\s*(?P<size>[^)）]+)\s*[\)）])?\s*$",
    re.IGNORECASE,
)
OUTGOING_MEDIA_RE = re.compile(
    r"^(Файл|File|Документ|Document|Фотография|Photo|Видео|Video|GIF|Sticker|Стикер|"
    r"\[photo\]|\[video\]|\[audio\]|\[file\]|photo|video|audio|file)\b",
    re.IGNORECASE,
)


def _env_int(name: str, default: int) -> int:
    try:
        return int(str(os.getenv(name, str(default)) or default).strip())
    except Exception:
        return default


def _is_confirmed_media_match(media_match: str) -> bool:
    note = str(media_match or "").strip().lower()
    return (
        note.startswith("ahash:")
        or note.startswith("manual:")
        or note.startswith("screen_crop:")
    )


def extract_outgoing_file_left(
    messages: Iterable[dict],
    *,
    chat_name: str,
    windows_user: str,
    computer_name: str,
    channel: str = "telegram",
) -> List[Dict[str, Any]]:
    """Outgoing messenger files/photos/videos → file_left for DLP Files tab.

    Only messages that UIA itself marks as outgoing media/file.
    Never invent sends from Telegram media_cache heuristics / hash filenames.
    """
    channel_key = str(channel or "telegram").strip().lower() or "telegram"
    events: List[Dict[str, Any]] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        direction = str(msg.get("direction") or msg.get("side") or "").lower()
        outgoing = bool(msg.get("outgoing")) or direction in {"out", "outgoing", "sent"}
        if not outgoing and not msg.get("from_me"):
            continue
        media = str(msg.get("media") or "").strip()
        text = str(msg.get("text") or "").strip()
        blob = media or text
        if not blob:
            continue
        media_l = media.lower()
        # Require explicit UIA media/file marker — ignore bare text and cache-only paths.
        if not (
            media_l in {"photo", "video", "gif", "sticker", "file", "audio", "document"}
            or OUTGOING_MEDIA_RE.match(blob)
            or FILE_MEDIA_RE.match(blob)
        ):
            continue

        file_match = FILE_MEDIA_RE.match(blob)
        if file_match:
            file_name = (file_match.group("name") or "").strip() or blob[:180]
        elif media_l == "photo":
            file_name = "photo.jpg"
        elif media_l in {"video", "audio", "gif", "file", "document"}:
            file_name = media_l
        else:
            file_name = (media or blob)[:180]

        media_match = str(msg.get("media_match") or "")
        media_path = str(msg.get("media_path") or "").replace("\\", "/").strip()
        # Prefer real disk path recovered from process open handles / Recent.
        disk_src = str(msg.get("source_path") or "").strip()
        # Fallback: visually confirmed media cache / screen crop path.
        media_src = media_path if _is_confirmed_media_match(media_match) else ""
        src_path = disk_src or media_src
        size = msg.get("file_size")
        events.append(
            {
                "event_id": uuid.uuid4().hex,
                "ts": int(time.time()),
                "channel": channel_key,
                "file_name": file_name,
                "dest_path": f"{channel_key}:{chat_name}",
                "src_path": src_path,
                "size": size if isinstance(size, int) else None,
                "sha256": "",
                "windows_user": windows_user,
                "computer_name": computer_name,
                "details": {
                    "chat_name": chat_name,
                    "message_key": msg.get("key") or msg.get("message_key") or msg.get("msg_key"),
                    "text": (msg.get("text") or "")[:300],
                    "media": (media or blob)[:300],
                    "media_path": media_src,
                    "source_path": disk_src,
                    "media_kind": msg.get("media_kind") if media_src else None,
                    "media_match": media_match if media_src else "",
                    "source": "disk_open" if disk_src else "uia_outgoing",
                },
            }
        )
    return events


def build_disk_file_left(
    *,
    src_path: str,
    file_name: str = "",
    chat_name: str | None = None,
    windows_user: str = "",
    computer_name: str = "",
    channel: str = "telegram",
    access_source: str = "open_files",
) -> Dict[str, Any] | None:
    """Local disk path opened by messenger → file_left for Hub Files tab."""
    path = str(src_path or "").strip()
    if not path:
        return None
    p = Path(path)
    if not p.is_file():
        return None
    name = str(file_name or "").strip() or p.name
    if not name or "." not in name:
        return None
    channel_key = str(channel or "telegram").strip().lower() or "telegram"
    chat = str(chat_name or "").strip() or "(unknown)"
    size: int | None
    try:
        size = int(p.stat().st_size)
    except OSError:
        size = None
    return {
        "event_id": uuid.uuid4().hex,
        "ts": int(time.time()),
        "channel": channel_key,
        "file_name": name,
        "dest_path": f"{channel_key}:{chat}",
        "src_path": str(p),
        "size": size,
        "sha256": "",
        "windows_user": windows_user,
        "computer_name": computer_name,
        "details": {
            "chat_name": chat,
            "source_path": str(p),
            "access_source": access_source,
            "source": "disk_open",
        },
    }


def drop_file_left_to_inbox(
    event: Dict[str, Any],
    *,
    egress_prefix: str = "tg",
) -> Path | None:
    """Write one file_left JSON into Agent fs_egress inbox for upload to Hub."""
    if not event or not event.get("event_id"):
        return None
    inbox = (
        Path(os.environ.get("ProgramData", r"C:\ProgramData"))
        / "HUB-IT"
        / "Agent"
        / "Spool"
        / "fs_egress"
        / "inbox"
    )
    try:
        inbox.mkdir(parents=True, exist_ok=True)
        path = inbox / f"{egress_prefix}_{event['event_id']}.json"
        path.write_text(json.dumps(event, ensure_ascii=False), encoding="utf-8")
        return path
    except OSError as exc:
        logger.warning("drop file_left failed: %s", exc)
        return None


class TelegramProbeSync:
    def __init__(
        self,
        output_dir: Path,
        *,
        server_url: str = "",
        api_key: str = "",
        sync_interval_sec: int = 900,
        max_media_mb: int = 15,
        spool_cap_mb: int = 200,
        media_passcode: str = "",
        attach_media: bool = True,
        profile: MessengerProfile | None = None,
    ) -> None:
        self.profile = profile or TELEGRAM
        self.output_dir = Path(output_dir)
        self.server_url = str(server_url or "").rstrip("/")
        self.api_key = str(api_key or "").strip()
        self.sync_interval_sec = max(60, int(sync_interval_sec))
        self.max_media_bytes = max_media_mb * 1024 * 1024
        self.spool_cap_bytes = spool_cap_mb * 1024 * 1024
        self.media_passcode = media_passcode
        self.attach_media = attach_media and self.profile.media_cache_default
        self._last_sync = 0.0
        self._uploaded_media: Set[str] = set()
        self._cursor_path = self.output_dir / "sync_cursor.json"
        self._egress_inbox = (
            Path(os.environ.get("ProgramData", r"C:\ProgramData"))
            / "HUB-IT"
            / "Agent"
            / "Spool"
            / "fs_egress"
            / "inbox"
        )
        self._session = requests.Session()
        self._load_cursor()

    def _load_cursor(self) -> None:
        if not self._cursor_path.exists():
            self._cursor = {"chat_offsets": {}, "uploaded_media": []}
            return
        try:
            data = json.loads(self._cursor_path.read_text(encoding="utf-8"))
            self._cursor = data if isinstance(data, dict) else {"chat_offsets": {}, "uploaded_media": []}
            self._uploaded_media = set(self._cursor.get("uploaded_media") or [])
        except Exception:
            self._cursor = {"chat_offsets": {}, "uploaded_media": []}

    def _save_cursor(self) -> None:
        self._cursor["uploaded_media"] = sorted(self._uploaded_media)[-5000:]
        self._cursor_path.write_text(
            json.dumps(self._cursor, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def maybe_sync(self, *, force: bool = False) -> None:
        now = time.monotonic()
        if not force and (now - self._last_sync) < self.sync_interval_sec:
            return
        try:
            self.sync_once()
        except Exception as exc:
            logger.warning("%s probe sync failed: %s", self.profile.key, exc)
        self._last_sync = time.monotonic()

    def sync_once(self) -> Dict[str, Any]:
        stats = {"report": False, "chats": 0, "media": 0, "egress": 0}
        report_path = regenerate_from_output(
            self.output_dir,
            sanitize=True,
            attach_media=self.attach_media,
            media_passcode=self.media_passcode,
        )
        stats["report"] = bool(report_path and Path(report_path).exists())

        chat_payloads, egress_events = self._collect_chat_deltas()
        chat_payloads = self._merge_screenshot_payloads(chat_payloads)
        stats["egress"] = self._drop_egress(egress_events)
        stats["chats"] = len(chat_payloads)
        stats["media"] = self._upload_bundle(chat_payloads, report_path=Path(report_path) if report_path else None)
        self._save_cursor()
        logger.info(
            "%s sync report=%s chats=%s media=%s egress=%s",
            self.profile.key,
            stats["report"],
            stats["chats"],
            stats["media"],
            stats["egress"],
        )
        return stats

    def _collect_chat_deltas(self) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        chats_dir = self.output_dir / "chats"
        state_path = self.output_dir / "state.json"
        windows_user = ""
        computer_name = ""
        names_by_id: Dict[str, str] = {}
        shots_by_id: Dict[str, List[str]] = {}
        if state_path.exists():
            try:
                state = json.loads(state_path.read_text(encoding="utf-8"))
                if isinstance(state, dict):
                    windows_user = str(state.get("windows_user") or "")
                    computer_name = str(state.get("computer_name") or "")
                    for row in state.get("chats") or []:
                        if isinstance(row, dict) and row.get("chat_id"):
                            cid = str(row["chat_id"])
                            names_by_id[cid] = str(row.get("chat_name") or cid)
                            shots_by_id[cid] = [
                                str(x).replace("\\", "/").strip()
                                for x in (row.get("screenshots") or [])
                                if str(x).strip()
                            ]
            except Exception:
                names_by_id = {}
                shots_by_id = {}
        if not windows_user:
            windows_user = os.environ.get("USERNAME", "")
        if not computer_name:
            computer_name = os.environ.get("COMPUTERNAME", "")

        offsets: Dict[str, int] = dict(self._cursor.get("chat_offsets") or {})
        payloads: List[Dict[str, Any]] = []
        egress: List[Dict[str, Any]] = []
        self._shots_by_id = shots_by_id
        self._names_by_id = names_by_id
        self._identity = (windows_user, computer_name)
        if not chats_dir.is_dir():
            return payloads, egress
        for chat_file in sorted(chats_dir.glob("*.jsonl")):
            chat_id = chat_file.stem
            offset = int(offsets.get(chat_id, 0) or 0)
            lines = chat_file.read_text(encoding="utf-8", errors="replace").splitlines()
            new_lines = lines[offset:]
            if not new_lines:
                continue
            messages: List[dict] = []
            for line in new_lines:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                if isinstance(obj, dict):
                    messages.append(obj)
            if not messages:
                offsets[chat_id] = len(lines)
                continue
            chat_name = str(
                names_by_id.get(chat_id)
                or messages[0].get("chat_name")
                or chat_id
            )
            egress.extend(
                extract_outgoing_file_left(
                    messages,
                    chat_name=chat_name,
                    windows_user=windows_user,
                    computer_name=computer_name,
                    channel=self.profile.channel,
                )
            )
            payloads.append(
                {
                    "chat_id": chat_id,
                    "chat_name": chat_name,
                    "messages": messages,
                    "screenshots": list(shots_by_id.get(chat_id) or []),
                    "windows_user": windows_user,
                    "computer_name": computer_name,
                }
            )
            offsets[chat_id] = len(lines)
        self._cursor["chat_offsets"] = offsets
        return payloads, egress

    def _merge_screenshot_payloads(
        self, payloads: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Ensure chats with screenshots are uploaded even without new messages."""
        shots_by_id = getattr(self, "_shots_by_id", {}) or {}
        names_by_id = getattr(self, "_names_by_id", {}) or {}
        windows_user, computer_name = getattr(self, "_identity", ("", ""))
        if not windows_user:
            windows_user = os.environ.get("USERNAME", "")
        if not computer_name:
            computer_name = os.environ.get("COMPUTERNAME", "")
        by_id = {str(p.get("chat_id")): p for p in payloads if p.get("chat_id")}
        uploaded = set(self._cursor.get("uploaded_screenshot_sets") or [])
        for chat_id, shots in shots_by_id.items():
            if not shots:
                continue
            sig = f"{chat_id}|{'|'.join(shots)}"
            current = by_id.get(chat_id)
            if current is not None:
                current["screenshots"] = shots
                uploaded.add(sig)
                continue
            if sig in uploaded:
                continue
            by_id[chat_id] = {
                "chat_id": chat_id,
                "chat_name": names_by_id.get(chat_id) or chat_id,
                "messages": [],
                "screenshots": shots,
                "windows_user": windows_user,
                "computer_name": computer_name,
            }
            uploaded.add(sig)
        self._cursor["uploaded_screenshot_sets"] = sorted(uploaded)[-2000:]
        return list(by_id.values())

    def _drop_egress(self, events: List[Dict[str, Any]]) -> int:
        if not events:
            return 0
        self._egress_inbox.mkdir(parents=True, exist_ok=True)
        prefix = self.profile.egress_prefix
        for event in events:
            path = self._egress_inbox / f"{prefix}_{event['event_id']}.json"
            path.write_text(json.dumps(event, ensure_ascii=False), encoding="utf-8")
        return len(events)

    def _upload_url(self) -> str:
        base = self.server_url
        if not base:
            return ""
        probe = self.profile.probe_path
        if base.endswith("/inventory"):
            return f"{base}/{probe}"
        if base.endswith(f"/{probe}"):
            return base
        # Allow explicit full URL override that already points at the other probe.
        if base.endswith("/telegram-probe") or base.endswith("/max-probe"):
            return base
        return f"{base.rstrip('/')}/{probe}"

    def _upload_bundle(
        self,
        chat_payloads: List[Dict[str, Any]],
        *,
        report_path: Optional[Path],
    ) -> int:
        import base64

        url = self._upload_url()
        if not url or not self.api_key:
            return 0
        batch_media: List[Path] = []
        total = 0
        for folder_name in ("media", "screenshots"):
            media_dir = self.output_dir / folder_name
            if not media_dir.is_dir():
                continue
            for path in sorted(media_dir.iterdir()):
                if not path.is_file() or path.name == "index.json":
                    continue
                if path.name in self._uploaded_media:
                    continue
                try:
                    size = path.stat().st_size
                except OSError:
                    continue
                # Skip tiny/corrupt captures and huge blobs.
                if size < 1024:
                    self._uploaded_media.add(path.name)
                    continue
                if size > self.max_media_bytes:
                    self._uploaded_media.add(path.name)
                    continue
                if total + size > self.spool_cap_bytes:
                    break
                batch_media.append(path)
                total += size

        def _content_type(path: Path) -> str:
            suffix = path.suffix.lower()
            return {
                ".png": "image/png",
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".webp": "image/webp",
                ".gif": "image/gif",
                ".mp4": "video/mp4",
            }.get(suffix, "application/octet-stream")

        media_payload = []
        for path in batch_media:
            try:
                media_payload.append(
                    {
                        "name": path.name,
                        "content_base64": base64.b64encode(path.read_bytes()).decode("ascii"),
                        "content_type": _content_type(path),
                    }
                )
            except OSError:
                continue

        body: Dict[str, Any] = {
            "computer_name": os.environ.get("COMPUTERNAME", ""),
            "windows_user": os.environ.get("USERNAME", ""),
            "chats": [
                {
                    "chat_id": c["chat_id"],
                    "chat_name": c["chat_name"],
                    "messages": c.get("messages") or [],
                    "screenshots": c.get("screenshots") or [],
                }
                for c in chat_payloads
            ],
            "media": media_payload,
        }
        if report_path and report_path.exists():
            try:
                body["report_html"] = report_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                pass
        try:
            response = self._session.post(
                url,
                json=body,
                headers={"X-API-Key": self.api_key},
                timeout=120,
            )
            if response.status_code >= 400:
                logger.warning(
                    "%s upload %s → %s",
                    self.profile.probe_path,
                    response.status_code,
                    response.text[:200],
                )
                return 0
            for path in batch_media:
                self._uploaded_media.add(path.name)
            return len(batch_media)
        except Exception as exc:
            logger.warning("%s upload failed: %s", self.profile.probe_path, exc)
            return 0
