"""Persistent chat index + per-chat message store for long-run probe."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable

from .models import utc_now_iso

logger = logging.getLogger(__name__)


def message_key(msg: dict[str, Any] | Any) -> str:
    if hasattr(msg, "to_dict"):
        msg = msg.to_dict()
    direction = str((msg or {}).get("direction") or "").strip().lower()
    time_s = str((msg or {}).get("time") or "").strip().lower()
    sender = str((msg or {}).get("sender") or "").strip().lower()
    text = str((msg or {}).get("text") or "").strip().lower()
    text = re.sub(r"\s+", " ", text)
    return f"{direction}|{time_s}|{sender}|{text}"


def message_content_key(msg: dict[str, Any] | Any) -> str:
    """Sender-agnostic key — useful when MAX chat label is a fingerprint."""
    if hasattr(msg, "to_dict"):
        msg = msg.to_dict()
    direction = str((msg or {}).get("direction") or "").strip().lower()
    time_s = str((msg or {}).get("time") or "").strip().lower()
    text = str((msg or {}).get("text") or "").strip().lower()
    text = re.sub(r"\s+", " ", text)
    return f"{direction}|{time_s}|{text}"


def canonical_chat_name(chat_name: str) -> str:
    """Normalize display name so '(1) Name' and 'Name' map to one chat."""
    from .chat_detector import normalize_chat_display_name

    return normalize_chat_display_name(chat_name or "unknown") or "unknown"


def safe_chat_id(chat_name: str) -> str:
    raw = canonical_chat_name(chat_name)
    slug = re.sub(r"[^\w\u0400-\u04FF\-]+", "_", raw, flags=re.UNICODE)
    slug = slug.strip("_")[:60] or "chat"
    digest = hashlib.sha1(raw.encode("utf-8", errors="replace")).hexdigest()[:8]
    return f"{slug}_{digest}"


@dataclass
class ChatRecord:
    chat_id: str
    chat_name: str
    first_seen: str = ""
    last_seen: str = ""
    message_count: int = 0
    last_message_preview: str = ""
    last_message_time: str = ""
    first_message_time: str = ""
    screenshots: list[str] = field(default_factory=list)
    known_keys: list[str] = field(default_factory=list)
    chat_kind: str = "unknown"  # private | group | channel | unknown

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ChatRecord":
        return cls(
            chat_id=str(data.get("chat_id") or ""),
            chat_name=str(data.get("chat_name") or ""),
            first_seen=str(data.get("first_seen") or ""),
            last_seen=str(data.get("last_seen") or ""),
            message_count=int(data.get("message_count") or 0),
            last_message_preview=str(data.get("last_message_preview") or ""),
            last_message_time=str(data.get("last_message_time") or ""),
            first_message_time=str(data.get("first_message_time") or ""),
            screenshots=list(data.get("screenshots") or []),
            known_keys=list(data.get("known_keys") or []),
            chat_kind=str(data.get("chat_kind") or "unknown"),
        )


class ChatStateStore:
    """Disk-backed chat index (state.json) + chats/<id>.jsonl messages."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.state_path = root / "state.json"
        self.chats_dir = root / "chats"
        self.chats_dir.mkdir(parents=True, exist_ok=True)
        self._chats: dict[str, ChatRecord] = {}
        self._keys: dict[str, set[str]] = {}
        self._dirty = False
        self._writes_since_flush = 0
        self.load()

    def load(self) -> None:
        self._chats.clear()
        self._keys.clear()
        if not self.state_path.exists():
            return
        try:
            raw = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("state.json load failed: %s", exc)
            return
        for item in raw.get("chats") or []:
            if not isinstance(item, dict):
                continue
            rec = ChatRecord.from_dict(item)
            if not rec.chat_id:
                continue
            self._chats[rec.chat_id] = rec
            self._keys[rec.chat_id] = set(rec.known_keys)
            # Rebuild keys from chat file if state keys empty but file exists
            if not self._keys[rec.chat_id]:
                self._keys[rec.chat_id] = {
                    message_key(m) for m in self.load_chat_messages(rec.chat_id)
                }
                rec.known_keys = sorted(self._keys[rec.chat_id])
                rec.message_count = len(rec.known_keys)

    def save(self) -> None:
        for chat_id, rec in self._chats.items():
            rec.known_keys = sorted(self._keys.get(chat_id, set()))
            rec.message_count = len(rec.known_keys)
        payload = {
            "updated_at": utc_now_iso(),
            "chats": [c.to_dict() for c in self.list_chats()],
        }
        self.state_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        self._dirty = False
        self._writes_since_flush = 0

    def maybe_flush(self, every: int = 5) -> None:
        if self._dirty and self._writes_since_flush >= every:
            self.save()

    def flush(self) -> None:
        if self._dirty or self._writes_since_flush:
            self.save()

    def list_chats(self) -> list[ChatRecord]:
        return sorted(
            self._chats.values(),
            key=lambda c: c.last_seen or c.first_seen or c.chat_name,
            reverse=True,
        )

    def has_chat(self, chat_name: str) -> bool:
        return safe_chat_id(chat_name) in self._chats

    def get_chat(self, chat_name: str) -> ChatRecord | None:
        return self._chats.get(safe_chat_id(chat_name))

    def get_or_create_chat(
        self,
        chat_name: str,
        *,
        chat_kind: str | None = None,
    ) -> tuple[ChatRecord, bool]:
        chat_id = safe_chat_id(chat_name)
        now = utc_now_iso()
        existing = self._chats.get(chat_id)
        if existing:
            existing.last_seen = now
            # Keep display name without unread badge once we know the clean form.
            clean_name = canonical_chat_name(chat_name)
            if clean_name and existing.chat_name != clean_name:
                existing.chat_name = clean_name
            if chat_kind and chat_kind != "unknown":
                # Prefer fresh classification (can correct false "group").
                existing.chat_kind = chat_kind
            self._dirty = True
            return existing, False
        rec = ChatRecord(
            chat_id=chat_id,
            chat_name=canonical_chat_name(chat_name),
            first_seen=now,
            last_seen=now,
            chat_kind=chat_kind or "unknown",
        )
        self._chats[chat_id] = rec
        self._keys[chat_id] = set()
        self._dirty = True
        return rec, True

    def chat_file(self, chat_id: str) -> Path:
        return self.chats_dir / f"{chat_id}.jsonl"

    def load_chat_messages(self, chat_id: str) -> list[dict[str, Any]]:
        path = self.chat_file(chat_id)
        if not path.exists():
            return []
        out: list[dict[str, Any]] = []
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return out

    def known_keys_for(self, chat_name: str) -> set[str]:
        return set(self._keys.get(safe_chat_id(chat_name)) or set())

    def find_chat_by_message_overlap(
        self,
        messages: Iterable[dict[str, Any] | Any],
        *,
        min_hits: int = 2,
    ) -> ChatRecord | None:
        """Reuse an existing chat when HistoryInner shares known message keys."""
        probe_keys: set[str] = set()
        for msg in messages:
            data = msg.to_dict() if hasattr(msg, "to_dict") else dict(msg)
            key = message_content_key(data)
            if key and not key.endswith("|"):
                probe_keys.add(key)
        if not probe_keys:
            return None
        best: ChatRecord | None = None
        best_hits = 0
        for chat_id, known in self._keys.items():
            known_content = set()
            for raw_key in known:
                # message_key = direction|time|sender|text → drop sender
                parts = str(raw_key).split("|", 3)
                if len(parts) == 4:
                    known_content.add(f"{parts[0]}|{parts[1]}|{parts[3]}")
                else:
                    known_content.add(str(raw_key))
            hits = len(probe_keys & known_content)
            if hits > best_hits:
                best_hits = hits
                best = self._chats.get(chat_id)
        if best is not None and best_hits >= min_hits:
            return best
        return None

    def diff_messages(
        self,
        chat_name: str,
        messages: Iterable[dict[str, Any] | Any],
        *,
        tail_only: bool = True,
        kind: str | None = None,
    ) -> list[dict[str, Any]]:
        from .message_filter import filter_messages_for_chat, new_messages_from_tail

        chat_id = safe_chat_id(chat_name)
        known = self._keys.get(chat_id) or set()
        rec = self._chats.get(chat_id)
        use_kind = kind or (rec.chat_kind if rec else None)
        normalized: list[dict[str, Any]] = []
        for msg in messages:
            data = msg.to_dict() if hasattr(msg, "to_dict") else dict(msg)
            normalized.append(data)
        filtered = filter_messages_for_chat(chat_name, normalized, kind=use_kind)
        if not known:
            # First capture: take filtered full window (caller decides chat_opened).
            return filtered
        if tail_only:
            return new_messages_from_tail(known, filtered)
        # Legacy: any unknown key
        out: list[dict[str, Any]] = []
        seen_batch: set[str] = set()
        for data in filtered:
            key = message_key(data)
            if not key or key in known or key in seen_batch:
                continue
            seen_batch.add(key)
            out.append(data)
        return out

    def patch_media_fields(
        self,
        chat_name: str,
        updates: Iterable[dict[str, Any]],
    ) -> int:
        """Merge media_path/media_kind/media_match into existing jsonl rows by content key."""
        chat_id = safe_chat_id(chat_name)
        rec = self._chats.get(chat_id)
        if rec is None:
            return 0
        by_content: dict[str, dict[str, Any]] = {}
        for msg in updates:
            data = msg.to_dict() if hasattr(msg, "to_dict") else dict(msg)
            if not data.get("media_path"):
                continue
            key = message_content_key(data)
            if key:
                by_content[key] = data
        if not by_content:
            return 0
        rows = self.load_chat_messages(chat_id)
        patched = 0
        for row in rows:
            key = message_content_key(row)
            src = by_content.get(key)
            if not src:
                continue
            if row.get("media_path"):
                continue
            row["media_path"] = src.get("media_path")
            row["media_kind"] = src.get("media_kind")
            row["media_match"] = src.get("media_match")
            if src.get("media") and not row.get("media"):
                row["media"] = src.get("media")
            if src.get("media_bbox") and not row.get("media_bbox"):
                row["media_bbox"] = src.get("media_bbox")
            patched += 1
        if not patched:
            return 0
        path = self.chat_file(chat_id)
        with path.open("w", encoding="utf-8") as fh:
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        rec.last_seen = utc_now_iso()
        self._dirty = True
        return patched

    def append_messages(
        self,
        chat_name: str,
        messages: Iterable[dict[str, Any] | Any],
        *,
        screenshot_path: str | None = None,
        already_diffed: bool = False,
        kind: str | None = None,
    ) -> list[dict[str, Any]]:
        rec, _created = self.get_or_create_chat(chat_name, chat_kind=kind)
        from .message_filter import filter_messages_for_chat

        use_kind = kind or rec.chat_kind
        known = self._keys.setdefault(rec.chat_id, set())
        if already_diffed:
            new_msgs = []
            seen: set[str] = set()
            for msg in messages:
                data = msg.to_dict() if hasattr(msg, "to_dict") else dict(msg)
                key = message_key(data)
                if not key or key in known or key in seen:
                    continue
                seen.add(key)
                new_msgs.append(data)
            new_msgs = filter_messages_for_chat(chat_name, new_msgs, kind=use_kind)
        else:
            new_msgs = self.diff_messages(
                chat_name, messages, tail_only=True, kind=use_kind
            )
        if not new_msgs and not screenshot_path:
            rec.last_seen = utc_now_iso()
            self._dirty = True
            return []

        path = self.chat_file(rec.chat_id)
        with path.open("a", encoding="utf-8") as fh:
            for data in new_msgs:
                key = message_key(data)
                if key in known:
                    continue
                known.add(key)
                row = dict(data)
                row["recorded_at"] = utc_now_iso()
                row["msg_key"] = key
                if screenshot_path:
                    # Link this batch of messages to the window capture taken with them.
                    row["screenshot_path"] = str(screenshot_path).replace("\\", "/")
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")

        if new_msgs:
            if not rec.first_message_time:
                rec.first_message_time = str(new_msgs[0].get("time") or "")
            last = new_msgs[-1]
            rec.last_message_time = str(last.get("time") or "")
            preview = str(last.get("text") or last.get("media") or "")
            rec.last_message_preview = preview[:160]
            rec.message_count = len(known)
        if screenshot_path and screenshot_path not in rec.screenshots:
            rec.screenshots.append(screenshot_path)
        rec.last_seen = utc_now_iso()
        self._dirty = True
        self._writes_since_flush += 1
        self.maybe_flush()
        return new_msgs

    def merge_duplicate_chats(self) -> int:
        """Merge chats that differ only by unread badge '(N) ' in the title."""
        groups: dict[str, list[ChatRecord]] = {}
        for rec in list(self._chats.values()):
            groups.setdefault(safe_chat_id(rec.chat_name), []).append(rec)

        merged = 0
        for canon_id, recs in groups.items():
            if len(recs) < 2:
                # Still rewrite id/name if badge-only rename is pending.
                rec = recs[0]
                if rec.chat_id != canon_id:
                    old_id = rec.chat_id
                    old_path = self.chat_file(old_id)
                    new_path = self.chat_file(canon_id)
                    msgs = self.load_chat_messages(old_id)
                    if old_path.exists() and old_id != canon_id:
                        with new_path.open("w", encoding="utf-8") as fh:
                            for data in msgs:
                                fh.write(json.dumps(data, ensure_ascii=False) + "\n")
                        old_path.unlink(missing_ok=True)
                    self._chats.pop(old_id, None)
                    self._keys.pop(old_id, None)
                    rec.chat_id = canon_id
                    rec.chat_name = canonical_chat_name(rec.chat_name)
                    self._chats[canon_id] = rec
                    self._keys[canon_id] = {message_key(m) for m in msgs}
                    merged += 1
                continue

            # Pick the record with most messages as primary.
            recs.sort(key=lambda r: (-r.message_count, r.first_seen or ""))
            primary = recs[0]
            all_msgs: list[dict[str, Any]] = []
            seen_keys: set[str] = set()
            screenshots: list[str] = []
            for rec in recs:
                for m in self.load_chat_messages(rec.chat_id):
                    key = message_key(m)
                    if not key or key in seen_keys:
                        continue
                    seen_keys.add(key)
                    all_msgs.append(m)
                for shot in rec.screenshots:
                    if shot not in screenshots:
                        screenshots.append(shot)

            primary.chat_id = canon_id
            primary.chat_name = canonical_chat_name(primary.chat_name)
            primary.screenshots = screenshots
            primary.message_count = len(all_msgs)
            primary.known_keys = sorted(seen_keys)
            if all_msgs:
                primary.first_message_time = str(all_msgs[0].get("time") or "")
                primary.last_message_time = str(all_msgs[-1].get("time") or "")
                primary.last_message_preview = str(
                    all_msgs[-1].get("text") or all_msgs[-1].get("media") or ""
                )[:160]

            # Drop old files / records
            for rec in recs:
                if rec.chat_id != canon_id:
                    self.chat_file(rec.chat_id).unlink(missing_ok=True)
                self._chats.pop(rec.chat_id, None)
                self._keys.pop(rec.chat_id, None)

            path = self.chat_file(canon_id)
            with path.open("w", encoding="utf-8") as fh:
                for data in all_msgs:
                    fh.write(json.dumps(data, ensure_ascii=False) + "\n")
            self._chats[canon_id] = primary
            self._keys[canon_id] = set(seen_keys)
            merged += len(recs) - 1

        if merged:
            self._dirty = True
            self.save()
            logger.info("Merged %d duplicate chat record(s)", merged)
        return merged

    def sanitize_stored_chats(self) -> dict[str, int]:
        """Rewrite chats/*.jsonl dropping foreign/status messages; rebuild keys."""
        from .message_filter import filter_messages_for_chat

        from .chat_kind import resolve_chat_kind

        self.merge_duplicate_chats()
        stats: dict[str, int] = {}
        for rec in list(self._chats.values()):
            raw = self.load_chat_messages(rec.chat_id)
            # Recompute kind with current heuristics before filtering.
            rec.chat_kind = resolve_chat_kind(
                rec.chat_name, raw, stored_kind=rec.chat_kind
            )
            clean = filter_messages_for_chat(
                rec.chat_name, raw, kind=rec.chat_kind or "unknown"
            )
            # Preserve first-seen order of cleaned messages
            path = self.chat_file(rec.chat_id)
            with path.open("w", encoding="utf-8") as fh:
                for data in clean:
                    key = message_key(data)
                    row = dict(data)
                    row["msg_key"] = key
                    if "recorded_at" not in row:
                        row["recorded_at"] = utc_now_iso()
                    fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            self._keys[rec.chat_id] = {message_key(m) for m in clean}
            rec.known_keys = sorted(self._keys[rec.chat_id])
            rec.message_count = len(clean)
            if clean:
                rec.first_message_time = str(clean[0].get("time") or "")
                rec.last_message_time = str(clean[-1].get("time") or "")
                rec.last_message_preview = str(
                    clean[-1].get("text") or clean[-1].get("media") or ""
                )[:160]
            else:
                rec.first_message_time = ""
                rec.last_message_time = ""
                rec.last_message_preview = ""
            stats[rec.chat_name] = len(raw) - len(clean)
        self._dirty = True
        self.save()
        return stats

    def reset(self) -> None:
        self._chats.clear()
        self._keys.clear()
        self._dirty = False
        self._writes_since_flush = 0
        if self.state_path.exists():
            self.state_path.unlink(missing_ok=True)
        if self.chats_dir.exists():
            for path in self.chats_dir.glob("*.jsonl"):
                path.unlink(missing_ok=True)


def detect_message_edits(
    known_messages: list[dict[str, Any]],
    visible_messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Find visible bubbles whose (direction, time) match a stored message but text
    changed. Return new rows that keep previous_text; original rows stay in jsonl.
    """
    by_slot: dict[str, list[dict[str, Any]]] = {}
    for row in known_messages:
        slot = _edit_slot_key(row)
        if not slot:
            continue
        by_slot.setdefault(slot, []).append(row)

    edits: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for msg in visible_messages:
        slot = _edit_slot_key(msg)
        if not slot:
            continue
        candidates = by_slot.get(slot) or []
        if not candidates:
            continue
        new_text = _norm_text(msg.get("text"))
        if not new_text:
            continue
        prev = candidates[-1]
        old_text = _norm_text(prev.get("text"))
        if not old_text or old_text == new_text:
            continue
        if any(_norm_text(row.get("text")) == new_text for row in candidates):
            continue
        data = dict(msg)
        data["edited"] = True
        data["previous_text"] = prev.get("text") or ""
        data["edit_of"] = prev.get("msg_key") or message_key(prev)
        key = message_key(data)
        if not key or key in seen_keys:
            continue
        seen_keys.add(key)
        edits.append(data)
    return edits


def _edit_slot_key(msg: dict[str, Any] | Any) -> str:
    if hasattr(msg, "to_dict"):
        msg = msg.to_dict()
    direction = str((msg or {}).get("direction") or "").strip().lower()
    time_s = str((msg or {}).get("time") or "").strip().lower()
    if not direction or not time_s:
        return ""
    return f"{direction}|{time_s}"


def _norm_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())
