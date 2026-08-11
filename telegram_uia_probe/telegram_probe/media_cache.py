"""Telegram Desktop media cache (TDEF) — local decrypt + attach to UIA messages.

Read-only on tdata. Never exports MTP auth keys / sessions.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import struct
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger(__name__)

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    _HAS_CRYPTO = True
except ImportError:  # pragma: no cover
    Cipher = algorithms = modes = None  # type: ignore[misc, assignment]
    _HAS_CRYPTO = False

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None  # type: ignore[misc, assignment]

from .image_match import average_hash_file, best_hash_match

PHOTO_DIM_RE = re.compile(
    r"(?P<label>Фотография|Видео|GIF|Стикер)\b[^,]*,?\s*"
    r"(?P<w>\d+)\s*[×xX]\s*(?P<h>\d+)",
    flags=re.IGNORECASE,
)
PHOTO_LABEL_RE = re.compile(
    r"^(Фотография|Видео|GIF|Стикер|Файл|Голосовое сообщение)\b",
    flags=re.IGNORECASE,
)


def default_tdata_path() -> Path:
    appdata = os.environ.get("APPDATA") or ""
    return Path(appdata) / "Telegram Desktop" / "tdata"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# --- crypto (TDF$ / TDEF) -------------------------------------------------


def _read_tdf(path: Path) -> tuple[int, bytes]:
    content = path.read_bytes()
    if len(content) < 24 or content[:4] != b"TDF$":
        raise ValueError(f"not a TDF$ file: {path}")
    version = struct.unpack("<I", content[4:8])[0]
    encrypted_data = content[8:-16]
    stored_md5 = content[-16:]
    calculated = hashlib.md5(
        encrypted_data
        + len(encrypted_data).to_bytes(4, "little")
        + version.to_bytes(4, "little")
        + b"TDF$"
    ).digest()
    if calculated != stored_md5:
        raise ValueError(f"TDF$ MD5 mismatch: {path}")
    return version, encrypted_data


class _QtDataStreamReader:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.offset = 0

    def read_uint32(self) -> int:
        value = struct.unpack_from(">I", self.data, self.offset)[0]
        self.offset += 4
        return value

    def read_bytearray(self) -> bytes | None:
        length = self.read_uint32()
        if length == 0xFFFFFFFF:
            return None
        if length == 0:
            return b""
        value = self.data[self.offset : self.offset + length]
        self.offset += length
        return value


def _ige256_decrypt(data: bytes, key: bytes, iv: bytes) -> bytes:
    if not _HAS_CRYPTO:
        raise RuntimeError("cryptography package is required for media cache")
    if len(data) % 16:
        raise ValueError("IGE data length must be multiple of 16")
    if len(key) != 32 or len(iv) != 32:
        raise ValueError("IGE key/iv sizes invalid")
    decryptor = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
    iv1 = bytearray(iv[:16])
    iv2 = bytearray(iv[16:])
    out = bytearray()
    for i in range(0, len(data), 16):
        block = data[i : i + 16]
        xored = bytes(a ^ b for a, b in zip(block, iv2))
        plain_aes = decryptor.update(xored)
        plain = bytes(a ^ b for a, b in zip(plain_aes, iv1))
        out.extend(plain)
        iv1[:] = block
        iv2[:] = plain
    decryptor.finalize()
    return bytes(out)


def _prepare_aes_oldmtp(auth_key: bytes, msg_key: bytes) -> tuple[bytes, bytes]:
    msg_key = msg_key[:16]
    x = 8
    sha1_a = hashlib.sha1(msg_key + auth_key[x : x + 32]).digest()
    sha1_b = hashlib.sha1(
        auth_key[x + 32 : x + 48] + msg_key + auth_key[x + 48 : x + 64]
    ).digest()
    sha1_c = hashlib.sha1(auth_key[x + 64 : x + 96] + msg_key).digest()
    sha1_d = hashlib.sha1(msg_key + auth_key[x + 96 : x + 128]).digest()
    aes_key = sha1_a[0:8] + sha1_b[8:20] + sha1_c[4:16]
    aes_iv = sha1_a[8:20] + sha1_b[0:8] + sha1_c[16:20] + sha1_d[0:8]
    return aes_key, aes_iv


def _decrypt_tdf_legacy(encrypted_data: bytes, auth_key: bytes) -> bytes:
    msg_key = encrypted_data[:16]
    payload = encrypted_data[16:]
    aes_key, aes_iv = _prepare_aes_oldmtp(auth_key, msg_key)
    decrypted = _ige256_decrypt(payload, aes_key, aes_iv)
    if hashlib.sha1(decrypted).digest()[:16] != msg_key:
        raise ValueError("IGE checksum mismatch (wrong passcode?)")
    length = int.from_bytes(decrypted[:4], "little")
    if length > len(decrypted) - 4:
        raise ValueError(f"bad decrypted length: {length}")
    return decrypted[4:length]


def _create_local_key(passcode: str, salt: bytes, tdesktop_version: int) -> bytes:
    if tdesktop_version < 2001014:
        if not passcode:
            return hashlib.pbkdf2_hmac("sha1", b"", salt, 4, 136)
        return hashlib.pbkdf2_hmac("sha1", passcode.encode("utf-8"), salt, 4000, 136)
    if not passcode:
        pass_hash = hashlib.sha512(salt + salt).digest()
        return hashlib.pbkdf2_hmac("sha512", pass_hash, salt, 1, 136)
    passcode_bytes = passcode.encode("utf-8")
    pass_hash = hashlib.sha512(salt + passcode_bytes + salt).digest()
    return hashlib.pbkdf2_hmac("sha512", pass_hash, salt, 100000, 136)


def get_local_key(tdata: Path, passcode: str = "") -> bytes:
    version, data = _read_tdf(tdata / "key_datas")
    reader = _QtDataStreamReader(data)
    salt = reader.read_bytearray()
    key_encrypted = reader.read_bytearray()
    _info = reader.read_bytearray()
    if salt is None or key_encrypted is None:
        raise ValueError("invalid key_datas payload")
    pass_key = _create_local_key(passcode, salt, version)
    return _decrypt_tdf_legacy(key_encrypted, pass_key)


def decrypt_tdef(path: Path, local_key: bytes) -> bytes:
    if not _HAS_CRYPTO:
        raise RuntimeError("cryptography package is required for media cache")
    raw = path.read_bytes()
    if raw[:4] != b"TDEF":
        raise ValueError(f"not TDEF: {path}")
    salt = raw[4:68]
    encrypted = raw[68:]
    if len(encrypted) < 48:
        raise ValueError("TDEF too short")
    half = len(local_key) // 2
    real_key = hashlib.sha256(local_key[:half] + salt[:32]).digest()
    iv = hashlib.sha256(local_key[half:] + salt[32:64]).digest()[:16]
    decryptor = Cipher(algorithms.AES(real_key), modes.CTR(iv)).decryptor()
    decrypted_all = decryptor.update(encrypted) + decryptor.finalize()
    header = decrypted_all[:48]
    body = decrypted_all[48:]
    data_part = header[:16]
    stored_checksum = header[16:48]
    expected = hashlib.sha256(local_key + salt + data_part).digest()
    if stored_checksum != expected:
        raise ValueError("TDEF checksum mismatch")
    return body


def reassemble_streaming(data: bytes) -> bytes | None:
    if len(data) < 4:
        return None
    count = int.from_bytes(data[:4], "little")
    if count == 0 or count > 1000:
        return None
    pos = 4
    parts: list[tuple[int, bytes]] = []
    for _ in range(count):
        if pos + 8 > len(data):
            return None
        offset = int.from_bytes(data[pos : pos + 4], "little")
        size = int.from_bytes(data[pos + 4 : pos + 8], "little")
        pos += 8
        if size == 0 or pos + size > len(data):
            return None
        parts.append((offset, data[pos : pos + size]))
        pos += size
    if not parts:
        return None
    end = max(offset + len(chunk) for offset, chunk in parts)
    out = bytearray(end)
    for offset, chunk in parts:
        out[offset : offset + len(chunk)] = chunk
    return bytes(out)


def sniff_kind(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if len(data) > 8 and data[4:8] == b"ftyp":
        return "mp4"
    if data.startswith(b"GIF8"):
        return "gif"
    return None


def extract_media_bytes(plain: bytes) -> tuple[bytes, str] | None:
    assembled = reassemble_streaming(plain)
    candidates = [assembled] if assembled is not None else []
    candidates.append(plain)
    # JPEG/PNG may sit after a small header (e.g. "partial:")
    for blob in list(candidates):
        if blob is None:
            continue
        kind = sniff_kind(blob)
        if kind:
            return blob, kind
        for magic, k in (
            (b"\xff\xd8\xff", "jpeg"),
            (b"\x89PNG\r\n\x1a\n", "png"),
            (b"GIF8", "gif"),
        ):
            idx = blob.find(magic)
            if idx >= 0:
                return blob[idx:], k
        if b"RIFF" in blob[:64]:
            idx = blob.find(b"RIFF")
            if idx >= 0 and blob[idx + 8 : idx + 12] == b"WEBP":
                return blob[idx:], "webp"
    return None


def parse_media_dims(media_or_text: str) -> tuple[str | None, int | None, int | None]:
    """Return (label, width, height) from UIA media/text line."""
    text = (media_or_text or "").strip()
    if not text:
        return None, None, None
    m = PHOTO_DIM_RE.search(text)
    if m:
        return (
            m.group("label").lower(),
            int(m.group("w")),
            int(m.group("h")),
        )
    m2 = PHOTO_LABEL_RE.match(text)
    if m2:
        return m2.group(1).lower(), None, None
    return None, None, None


def message_wants_media(msg: dict[str, Any]) -> bool:
    if msg.get("media_path"):
        return False
    media = str(msg.get("media") or "").strip().lower()
    if media in {
        "photo",
        "video",
        "gif",
        "sticker",
        "file",
        "audio",
        "document",
        "фотография",
        "видео",
        "стикер",
    }:
        return True
    text = str(msg.get("text") or "").strip().lower()
    if text in {"[photo]", "[video]", "[gif]", "[sticker]", "[audio]", "[file]"}:
        return True
    if text.startswith("файл:") or text.startswith("file:"):
        return True
    blob = " ".join(str(msg.get(k) or "") for k in ("media", "text"))
    label, _w, _h = parse_media_dims(blob)
    return label in {"фотография", "видео", "gif", "стикер"}


# --- library / attach -----------------------------------------------------


@dataclass
class MediaItem:
    id: str
    rel_path: str
    source: str
    source_mtime: float
    width: int | None = None
    height: int | None = None
    kind: str = ""
    sha256: str = ""
    ahash: str = ""
    used_by: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MediaItem":
        return cls(
            id=str(data.get("id") or ""),
            rel_path=str(data.get("rel_path") or ""),
            source=str(data.get("source") or ""),
            source_mtime=float(data.get("source_mtime") or 0),
            width=data.get("width"),
            height=data.get("height"),
            kind=str(data.get("kind") or ""),
            sha256=str(data.get("sha256") or ""),
            ahash=str(data.get("ahash") or ""),
            used_by=list(data.get("used_by") or []),
        )


class MediaLibrary:
    """Decrypt new TDEF files into output/media and attach paths to messages."""

    IMAGE_KINDS = frozenset({"jpeg", "png", "webp", "gif"})
    VIDEO_KINDS = frozenset({"mp4"})

    def __init__(
        self,
        output_root: Path,
        *,
        tdata: Path | None = None,
        passcode: str = "",
        enabled: bool = True,
    ) -> None:
        self.root = output_root
        self.media_dir = output_root / "media"
        self.index_path = self.media_dir / "index.json"
        self.tdata = tdata or default_tdata_path()
        self.passcode = passcode
        self.enabled = enabled
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self._items: dict[str, MediaItem] = {}
        self._source_to_id: dict[str, str] = {}
        self._local_key: bytes | None = None
        self._init_error: str | None = None
        self._load_index()
        if self.enabled:
            self._try_init_key()

    @property
    def available(self) -> bool:
        return bool(self.enabled and self._local_key and not self._init_error)

    def _try_init_key(self) -> None:
        if not _HAS_CRYPTO:
            self._init_error = "package 'cryptography' not installed"
            logger.warning("Media cache disabled: %s", self._init_error)
            return
        key_path = self.tdata / "key_datas"
        if not key_path.is_file():
            self._init_error = f"key_datas not found: {self.tdata}"
            logger.info("Media cache unavailable: %s", self._init_error)
            return
        try:
            self._local_key = get_local_key(self.tdata, self.passcode)
            logger.info(
                "Media cache ready (tdata=%s, indexed=%d)",
                self.tdata,
                len(self._items),
            )
        except Exception as exc:  # noqa: BLE001
            self._init_error = str(exc)
            self._local_key = None
            logger.warning("Media cache key failed: %s", exc)

    def _load_index(self) -> None:
        if not self.index_path.exists():
            return
        try:
            raw = json.loads(self.index_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("media index load failed: %s", exc)
            return
        for row in raw.get("items") or []:
            if not isinstance(row, dict):
                continue
            item = MediaItem.from_dict(row)
            if not item.id:
                continue
            self._items[item.id] = item
            if item.source:
                self._source_to_id[item.source] = item.id

    def save_index(self) -> None:
        payload = {
            "updated_at": utc_now_iso(),
            "items": [i.to_dict() for i in sorted(self._items.values(), key=lambda x: x.source_mtime)],
        }
        self.index_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _cache_roots(self) -> list[Path]:
        user_data = self.tdata / "user_data"
        return [
            user_data / "media_cache",
            user_data / "cache",
        ]

    def sync_new_files(self, *, max_files: int = 80) -> int:
        """Decrypt recently changed / unknown TDEF files. Returns new count."""
        if not self.available or self._local_key is None:
            return 0
        candidates: list[Path] = []
        for root in self._cache_roots():
            if not root.is_dir():
                continue
            for path in root.rglob("*"):
                if not path.is_file():
                    continue
                if path.name in {"version", "binlog"}:
                    continue
                src = str(path)
                if src in self._source_to_id:
                    continue
                try:
                    if path.read_bytes()[:4] != b"TDEF":
                        continue
                except OSError:
                    continue
                candidates.append(path)

        candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
        added = 0
        for path in candidates[:max_files]:
            if self._ingest_tdef(path):
                added += 1
        if added:
            self.save_index()
            logger.info("Media cache: ingested %d new file(s)", added)
        return added

    def _ingest_tdef(self, path: Path) -> bool:
        assert self._local_key is not None
        try:
            plain = decrypt_tdef(path, self._local_key)
            extracted = extract_media_bytes(plain)
            if not extracted:
                return False
            data, kind = extracted
            digest = hashlib.sha256(data).hexdigest()
            # Dedup by content
            for existing in self._items.values():
                if existing.sha256 == digest:
                    self._source_to_id[str(path)] = existing.id
                    return False
            item_id = digest[:16]
            rel = f"media/{item_id}.{kind}"
            dest = self.root / rel
            if not dest.exists():
                dest.write_bytes(data)
            width = height = None
            ahash = ""
            if kind in self.IMAGE_KINDS and Image is not None:
                try:
                    with Image.open(dest) as im:
                        width, height = im.size
                except Exception:  # noqa: BLE001
                    pass
                ahash = average_hash_file(dest) or ""
            item = MediaItem(
                id=item_id,
                rel_path=rel.replace("\\", "/"),
                source=str(path),
                source_mtime=path.stat().st_mtime,
                width=width,
                height=height,
                kind=kind,
                sha256=digest,
                ahash=ahash,
            )
            self._items[item_id] = item
            self._source_to_id[str(path)] = item_id
            return True
        except PermissionError:
            return False
        except Exception as exc:  # noqa: BLE001
            logger.debug("skip tdef %s: %s", path, exc)
            return False

    def attach_to_messages(
        self,
        messages: Iterable[dict[str, Any]],
        *,
        sync: bool = True,
        rematch: bool = False,
    ) -> int:
        """Fill media_path on message dicts in-place. Returns attach count.

        Matching rules:
        - photos require exact width×height (no orientation swap, no fallback);
        - within the same size, pair oldest message → oldest free cache file;
        - prefer files from media_cache over thumbnail cache.
        """
        if not self.enabled:
            return 0
        if sync:
            try:
                self.sync_new_files(max_files=500)
            except Exception as exc:  # noqa: BLE001
                logger.warning("media sync failed: %s", exc)
        if not self.available:
            return 0

        self._ensure_ahashes()
        msgs = [m for m in messages if isinstance(m, dict)]
        if rematch:
            for msg in msgs:
                match = str(msg.get("media_match") or "")
                # Keep visually confirmed / manually corrected links.
                if match.startswith("ahash:") or match.startswith("manual:"):
                    continue
                if message_wants_media({**msg, "media_path": ""}) or msg.get("media_path"):
                    msg.pop("media_path", None)
                    msg.pop("media_kind", None)
                    msg.pop("media_match", None)

        # Reserve already-linked items so heuristics cannot steal them.
        for msg in msgs:
            rel = str(msg.get("media_path") or "")
            if not rel:
                continue
            key = str(msg.get("msg_key") or rel)
            for item in self._items.values():
                if item.rel_path == rel and key not in item.used_by:
                    item.used_by.append(key)
                    break

        pending: list[dict[str, Any]] = []
        for msg in msgs:
            if msg.get("media_path"):
                continue
            if not message_wants_media(msg):
                continue
            pending.append(msg)

        if not pending:
            return 0

        attached = 0
        dirty = False

        def _bind(msg: dict[str, Any], item: MediaItem, match_note: str) -> None:
            nonlocal attached, dirty
            msg["media_path"] = item.rel_path
            msg["media_kind"] = item.kind
            msg["media_match"] = match_note
            key = str(msg.get("msg_key") or "") or f"anon:{item.id}:{attached}"
            item.used_by.append(key)
            dirty = True
            attached += 1

        # 1) Exact visual match from on-screen bubble crop (ahash).
        for msg in list(pending):
            probe = str(msg.get("visual_ahash") or "")
            if not probe:
                continue
            blob = " ".join(str(msg.get(k) or "") for k in ("media", "text"))
            _label, width, height = parse_media_dims(blob)
            candidates: list[tuple[MediaItem, str]] = []
            for item in self._items.values():
                if item.used_by or item.kind not in self.IMAGE_KINDS or not item.ahash:
                    continue
                if width and height and item.width and item.height:
                    if item.width != width or item.height != height:
                        continue
                candidates.append((item, item.ahash))
            hit = best_hash_match(probe, candidates, max_distance=30)
            if not hit:
                # Retry without dim filter — crop includes chrome, dims still help but
                # allow near misses when UIA size text differs slightly.
                candidates = [
                    (i, i.ahash)
                    for i in self._items.values()
                    if not i.used_by and i.kind in self.IMAGE_KINDS and i.ahash
                ]
                hit = best_hash_match(probe, candidates, max_distance=24)
            if not hit:
                continue
            item, dist = hit
            _bind(msg, item, f"ahash:{dist}")
            pending.remove(msg)

        # DLP policy: do not guess media from Telegram media_cache by size/mtime.
        # Only ahash / manual binds above count as a real attachment.
        if pending:
            logger.info(
                "media attach: left %s message(s) without confirmed visual match "
                "(size/mtime cache heuristic disabled)",
                len(pending),
            )

        if dirty:
            self.save_index()
        return attached

    def _ensure_ahashes(self) -> None:
        changed = False
        for item in self._items.values():
            if item.ahash or item.kind not in self.IMAGE_KINDS:
                continue
            path = self.root / item.rel_path
            if not path.is_file():
                continue
            ah = average_hash_file(path)
            if ah:
                item.ahash = ah
                changed = True
        if changed:
            self.save_index()


def attach_media_to_chat_files(
    chat_state: Any,
    library: MediaLibrary,
) -> int:
    """Backfill media_path in chats/*.jsonl and rewrite files."""
    if not library.enabled:
        return 0
    library.sync_new_files(max_files=500)
    if not library.available:
        return 0

    # Full rematch: clear reservations and previous links on media messages.
    for item in library._items.values():
        item.used_by.clear()

    total = 0
    # Attach across all chats in one chronological stream so shared sizes
    # (e.g. many 720×1280) do not steal from the wrong dialogue order.
    work: list[tuple[str, int, dict[str, Any]]] = []
    by_chat: dict[str, list[dict[str, Any]]] = {}
    for rec in chat_state.list_chats():
        messages = chat_state.load_chat_messages(rec.chat_id)
        by_chat[rec.chat_id] = messages
        for idx, msg in enumerate(messages):
            work.append((rec.chat_id, idx, msg))

    # Stable: chat last_seen then in-file order is wrong across chats.
    # Rematch per chat separately but with a fresh global free pool that
    # is consumed in dialogue order inside each chat. Process chats by
    # first_seen so older dialogues claim older cache files first.
    chat_order = sorted(
        chat_state.list_chats(),
        key=lambda r: (r.first_seen or "", r.chat_name),
    )
    for rec in chat_order:
        messages = by_chat[rec.chat_id]
        before_paths = [m.get("media_path") for m in messages]
        n = library.attach_to_messages(messages, sync=False, rematch=True)
        after_paths = [m.get("media_path") for m in messages]
        if n or before_paths != after_paths:
            path = chat_state.chat_file(rec.chat_id)
            with path.open("w", encoding="utf-8") as fh:
                for data in messages:
                    fh.write(json.dumps(data, ensure_ascii=False) + "\n")
            total += sum(1 for p in after_paths if p) - sum(1 for p in before_paths if p)
    library.save_index()
    return total

