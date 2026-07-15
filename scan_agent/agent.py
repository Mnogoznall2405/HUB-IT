from __future__ import annotations

import argparse
import base64
import codecs
import hashlib
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import random
import re
import socket
import sys
import threading
import time
import uuid
import unicodedata
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import requests
import yaml
from agent_version import AGENT_VERSION, SCAN_ANALYSIS_VERSION, SCAN_OCR_PAGE_LIMIT, SCAN_TEXT_PAGE_LIMIT

try:
    import winreg  # type: ignore
except Exception:  # pragma: no cover - non-Windows test environments
    winreg = None

try:
    import fitz  # type: ignore
except Exception:
    fitz = None

try:
    from watchdog.events import FileSystemEventHandler  # type: ignore
    from watchdog.observers import Observer  # type: ignore
except Exception:
    FileSystemEventHandler = object  # type: ignore
    Observer = None  # type: ignore


DEFAULT_SERVER_BASE = "https://hubit.zsgp.ru/api/v1/scan"
DEFAULT_POLL_INTERVAL = 600
DEFAULT_POLL_JITTER = 120
DEFAULT_HTTP_TIMEOUT = 20
DEFAULT_MAX_FILE_SIZE_MB = 50
DEFAULT_OUTBOX_MAX_ITEMS = 5000
DEFAULT_OUTBOX_MAX_AGE_DAYS = 14
DEFAULT_OUTBOX_MAX_TOTAL_MB = 512
DEFAULT_OUTBOX_DRAIN_BATCH = 10
ANALYSIS_VERSION = SCAN_ANALYSIS_VERSION
PDF_OCR_PAGE_LIMIT = SCAN_OCR_PAGE_LIMIT
PDF_TEXT_PAGE_LIMIT = SCAN_TEXT_PAGE_LIMIT
TEXT_CHUNK_BYTES = 1024 * 1024
TEXT_CHUNK_OVERLAP = 1024
STATE_RETENTION_DAYS = 90
MAX_HASH_ENTRIES = 120_000

USER_SUBDIRS = ("Desktop", "Documents", "Downloads")
IGNORED_USER_DIRS = {
    "all users",
    "default",
    "default user",
    "public",
    "defaultappspool",
}

TEXT_EXTENSIONS = {
    ".txt",
    ".csv",
    ".log",
    ".json",
    ".xml",
    ".ini",
    ".conf",
    ".md",
    ".rtf",
}

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}
OFFICE_EXTENSIONS = {
    ".doc", ".docx", ".odt",
    ".xls", ".xlsx", ".ods",
    ".ppt", ".pptx", ".odp",
}
SUPPORTED_SCAN_EXTENSIONS = frozenset({".pdf", *TEXT_EXTENSIONS, *IMAGE_EXTENSIONS, *OFFICE_EXTENSIONS})

PROGRAM_DATA = Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "IT-Invent" / "ScanAgent"
TEMP_DIR = Path(os.environ.get("TEMP", r"C:\Windows\Temp"))

LOG_FILE = "scan_agent.log"
STATE_FILE = "scan_agent_state.json"
OUTBOX_DIR = "outbox"
OUTBOX_PENDING_DIR = "pending"
OUTBOX_DEAD_DIR = "dead_letter"
STATUS_FILE = "scan_agent_status.json"
STATUS_UPDATE_INTERVAL_SEC = 30
ENV_FILE_NAME = ".env"


def _setup_paths() -> Tuple[Path, Path, Path, Path, Path]:
    root = PROGRAM_DATA
    try:
        root.mkdir(parents=True, exist_ok=True)
    except Exception:
        root = TEMP_DIR
        root.mkdir(parents=True, exist_ok=True)
    outbox_root = root / OUTBOX_DIR
    pending_dir = outbox_root / OUTBOX_PENDING_DIR
    dead_dir = outbox_root / OUTBOX_DEAD_DIR
    pending_dir.mkdir(parents=True, exist_ok=True)
    dead_dir.mkdir(parents=True, exist_ok=True)
    return root / LOG_FILE, root / STATE_FILE, pending_dir, dead_dir, root / STATUS_FILE


LOG_PATH, STATE_PATH, OUTBOX_PENDING_PATH, OUTBOX_DEAD_PATH, STATUS_PATH = _setup_paths()


def _strip_env_value(raw: str) -> str:
    value = str(raw or "").strip()
    if len(value) >= 2 and ((value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'"))):
        return value[1:-1]
    return value


def _read_env_text(path: Path) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            return path.read_text(encoding=enc)
        except Exception:
            continue
    return ""


def bootstrap_env_from_files() -> List[str]:
    loaded: List[str] = []
    seen = set()
    candidates: List[Path] = []
    explicit = str(os.getenv("SCAN_AGENT_ENV_FILE", "")).strip()
    if explicit:
        candidates.append(Path(explicit))
    current = Path(__file__).resolve()
    candidates.append(current.parent / ENV_FILE_NAME)
    for parent in list(current.parents)[:4]:
        candidates.append(parent / ENV_FILE_NAME)
    candidates.append(Path.cwd() / ENV_FILE_NAME)
    candidates.append(PROGRAM_DATA.parent / ENV_FILE_NAME)

    for raw_path in candidates:
        try:
            path = raw_path.expanduser().resolve()
        except Exception:
            path = raw_path
        key = str(path).lower()
        if key in seen:
            continue
        seen.add(key)
        if not path.exists() or not path.is_file():
            continue
        text = _read_env_text(path)
        if not text:
            continue
        count = 0
        for line in text.splitlines():
            row = line.strip()
            if not row or row.startswith("#") or "=" not in row:
                continue
            k, v = row.split("=", 1)
            k = k.strip()
            if not k or k in os.environ:
                continue
            os.environ[k] = _strip_env_value(v)
            count += 1
        if count > 0:
            loaded.append(f"{path} ({count})")
    return loaded


def setup_logging() -> None:
    handlers: List[logging.Handler] = [
        RotatingFileHandler(LOG_PATH, maxBytes=8 * 1024 * 1024, backupCount=3, encoding="utf-8")
    ]
    if hasattr(os.sys.stdout, "isatty") and os.sys.stdout.isatty():
        handlers.append(logging.StreamHandler())
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=handlers,
    )


def _to_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _to_bool(value: Any, default: bool = False) -> bool:
    text = str(value or "").strip().lower()
    if not text:
        return default
    return text in {"1", "true", "yes", "on"}


def _atomic_write_text(path: Path, content: str, encoding: str = "utf-8") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp.{uuid.uuid4().hex}")
    temp_path.write_text(content, encoding=encoding)
    os.replace(str(temp_path), str(path))


def _read_env() -> Dict[str, Any]:
    poll = max(30, _to_int(os.getenv("SCAN_AGENT_POLL_INTERVAL_SEC", str(DEFAULT_POLL_INTERVAL)), DEFAULT_POLL_INTERVAL))
    poll_jitter = max(
        0,
        min(300, _to_int(os.getenv("SCAN_AGENT_POLL_JITTER_SEC", str(DEFAULT_POLL_JITTER)), DEFAULT_POLL_JITTER)),
    )
    max_size_mb = max(1, _to_int(os.getenv("SCAN_AGENT_MAX_FILE_MB", str(DEFAULT_MAX_FILE_SIZE_MB)), DEFAULT_MAX_FILE_SIZE_MB))
    api_key = str(os.getenv("SCAN_AGENT_API_KEY", "")).strip()
    if not api_key:
        logging.error("SCAN_AGENT_API_KEY is empty; scan uploads are disabled until an explicit key is configured")

    return {
        "server_base": str(os.getenv("SCAN_AGENT_SERVER_BASE", DEFAULT_SERVER_BASE)).strip().rstrip("/"),
        "api_key": api_key,
        "poll_interval": poll,
        "poll_jitter_sec": poll_jitter,
        "timeout": max(5, _to_int(os.getenv("SCAN_AGENT_HTTP_TIMEOUT_SEC", str(DEFAULT_HTTP_TIMEOUT)), DEFAULT_HTTP_TIMEOUT)),
        "max_file_bytes": max_size_mb * 1024 * 1024,
        "run_scan_on_start": str(os.getenv("SCAN_AGENT_SCAN_ON_START", "0")).strip() not in {"0", "false", "False"},
        "watchdog_enabled": str(os.getenv("SCAN_AGENT_WATCHDOG_ENABLED", "0")).strip() not in {"0", "false", "False"},
        "watchdog_batch_size": max(10, _to_int(os.getenv("SCAN_AGENT_WATCHDOG_BATCH_SIZE", "200"), 200)),
        "roots_refresh_sec": max(60, _to_int(os.getenv("SCAN_AGENT_ROOTS_REFRESH_SEC", "300"), 300)),
        "branch": str(os.getenv("SCAN_AGENT_BRANCH", "")).strip(),
        "patterns_file": str(os.getenv("SCAN_AGENT_PATTERNS_FILE", "")).strip(),
        "extra_roots": str(os.getenv("SCAN_AGENT_EXTRA_ROOTS", "")).strip(),
        "outbox_max_items": max(100, _to_int(os.getenv("SCAN_AGENT_OUTBOX_MAX_ITEMS", str(DEFAULT_OUTBOX_MAX_ITEMS)), DEFAULT_OUTBOX_MAX_ITEMS)),
        "outbox_max_age_days": max(1, _to_int(os.getenv("SCAN_AGENT_OUTBOX_MAX_AGE_DAYS", str(DEFAULT_OUTBOX_MAX_AGE_DAYS)), DEFAULT_OUTBOX_MAX_AGE_DAYS)),
        "outbox_max_total_mb": max(32, _to_int(os.getenv("SCAN_AGENT_OUTBOX_MAX_TOTAL_MB", str(DEFAULT_OUTBOX_MAX_TOTAL_MB)), DEFAULT_OUTBOX_MAX_TOTAL_MB)),
        "outbox_drain_batch": max(1, min(100, _to_int(os.getenv("SCAN_AGENT_OUTBOX_DRAIN_BATCH", str(DEFAULT_OUTBOX_DRAIN_BATCH)), DEFAULT_OUTBOX_DRAIN_BATCH))),
    }


def _load_state() -> Dict[str, Any]:
    if not STATE_PATH.exists():
        return {"hashes": {}, "files": {}}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        hashes = data.get("hashes") if isinstance(data, dict) else {}
        files = data.get("files") if isinstance(data, dict) else {}
        if not isinstance(hashes, dict):
            hashes = {}
        if not isinstance(files, dict):
            files = {}
        return {"hashes": hashes, "files": files}
    except Exception:
        return {"hashes": {}, "files": {}}


def _save_state(state: Dict[str, Any]) -> None:
    try:
        _atomic_write_text(STATE_PATH, json.dumps(state, ensure_ascii=False), encoding="utf-8")
    except Exception as exc:
        logging.warning("Failed to save state: %s", exc)


def _prune_state(state: Dict[str, Any]) -> None:
    now_ts = int(time.time())
    min_ts = now_ts - STATE_RETENTION_DAYS * 24 * 60 * 60
    hashes = state.get("hashes") if isinstance(state.get("hashes"), dict) else {}
    files = state.get("files") if isinstance(state.get("files"), dict) else {}

    stale_hashes = [key for key, ts in hashes.items() if _to_int(ts, 0) < min_ts]
    for key in stale_hashes:
        hashes.pop(key, None)

    stale_files = [key for key, meta in files.items() if _to_int((meta or {}).get("ts"), 0) < min_ts]
    for key in stale_files:
        files.pop(key, None)

    if len(hashes) > MAX_HASH_ENTRIES:
        ordered = sorted(hashes.items(), key=lambda item: _to_int(item[1], 0), reverse=True)
        keep = dict(ordered[:MAX_HASH_ENTRIES])
        hashes.clear()
        hashes.update(keep)

    state["hashes"] = hashes
    state["files"] = files


def _norm_path(path: Path) -> str:
    return str(path).lower()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            block = f.read(1024 * 1024)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def _snippet(text: str, start: int, end: int, radius: int = 30) -> str:
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    return text[left:right].replace("\n", " ").strip()


_SPACED_DSP_PHRASE_RE = re.compile(
    r"(?i)д\s*л\s*я\s*с\s*л\s*у\s*ж\s*е\s*б\s*н\s*о\s*г\s*о\s*п\s*о\s*л\s*ь\s*з\s*о\s*в\s*а\s*н\s*и\s*я"
)
_SPACED_CYRILLIC_WORD_RE = re.compile(r"(?<!\w)(?:[а-яё][ \t]){3,}[а-яё](?!\w)", re.IGNORECASE)
_DSP_FURNITURE_RE = re.compile(r"(?i)(?:столешниц|мебел|плит|лист|дсп\s*22\s*мм|\b\d+\s*мм\b)")
_OCR_LATIN_TO_CYRILLIC = str.maketrans(
    "AaBCcEeHKMOoPpTXYxyD",
    "АаВСсЕеНКМОоРрТХУхуД",
)


def _normalize_scan_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).replace("ё", "е").replace("Ё", "Е")
    text = text.replace("\u00ad", "").replace("\u200b", "")
    text = re.sub(r"(?<=\w)[\-‐‑–—]\s*(?=\w)", "", text)
    text = _SPACED_DSP_PHRASE_RE.sub("Для служебного пользования", text)
    text = _SPACED_CYRILLIC_WORD_RE.sub(lambda match: re.sub(r"\s+", "", match.group(0)), text)
    return re.sub(r"\s+", " ", text.translate(_OCR_LATIN_TO_CYRILLIC)).strip()


def _read_text_with_fallback(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            return path.read_text(encoding=encoding)
        except Exception:
            continue
    return ""


def _agent_base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def _resolve_patterns_file(raw: str) -> Path:
    text = str(raw or "").strip()
    if text:
        explicit = Path(text)
        if explicit.is_absolute():
            return explicit
        return (Path.cwd() / explicit).resolve()
    return (_agent_base_dir() / "patterns_strict.yaml").resolve()


def _re_flags(flags: Any) -> int:
    out = 0
    if not isinstance(flags, list):
        return out
    for item in flags:
        token = str(item or "").strip().lower()
        if token in {"ignorecase", "i"}:
            out |= re.IGNORECASE
        elif token in {"dotall", "s"}:
            out |= re.DOTALL
        elif token in {"multiline", "m"}:
            out |= re.MULTILINE
    return out


def _load_pattern_defs(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        logging.error("Strict patterns file not found: %s", path)
        return []
    text = _read_text_with_fallback(path)
    if not text.strip():
        logging.error("Strict patterns file is empty: %s", path)
        return []
    try:
        payload = yaml.safe_load(text) or {}
    except Exception as exc:
        logging.error("Strict patterns parse failed: %s", exc)
        return []

    rows = payload.get("patterns") if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        rows = []

    defs: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("type") or "regex").strip().lower() != "regex":
            continue
        pattern_id = str(row.get("id") or "").strip()
        pattern_raw = str(row.get("pattern") or "")
        if not pattern_id or not pattern_raw:
            continue
        name = str(row.get("name") or pattern_id)
        weight = float(row.get("weight") or 1.0)
        try:
            regex = re.compile(pattern_raw, _re_flags(row.get("flags")))
        except Exception as exc:
            logging.warning("Pattern compile failed id=%s: %s", pattern_id, exc)
            continue
        defs.append(
            {
                "id": pattern_id,
                "name": name,
                "weight": weight,
                "regex": regex,
            }
        )
    if not defs:
        logging.error("No strict regex patterns loaded from %s", path)
        return []
    logging.info("Loaded strict patterns for agent: file=%s count=%s", path, len(defs))
    return defs


def scan_text(text: str, pattern_defs: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    source = str(text or "")
    if not source.strip() or not pattern_defs:
        return []
    normalized_source = _normalize_scan_text(source)
    sources = [source]
    if normalized_source and normalized_source != source:
        sources.append(normalized_source)
    out: List[Dict[str, str]] = []
    seen: Set[Tuple[str, str, str]] = set()
    for item in pattern_defs:
        pattern = str(item.get("id") or "")
        name = str(item.get("name") or pattern)
        weight = float(item.get("weight") or 1.0)
        regex = item.get("regex")
        if not pattern or regex is None:
            continue
        for candidate in sources:
            for match in regex.finditer(candidate):
                context = candidate[max(0, match.start() - 80):min(len(candidate), match.end() + 80)]
                if pattern == "dsp_with_exclusion" and _DSP_FURNITURE_RE.search(context):
                    continue
                key = (pattern, _normalize_scan_text(match.group(0)).casefold(), _snippet(candidate, match.start(), match.end()))
                if key in seen:
                    continue
                seen.add(key)
                out.append(
                    {
                        "pattern": pattern,
                        "pattern_name": name,
                        "weight": str(weight),
                        "value": match.group(0),
                        "snippet": _snippet(candidate, match.start(), match.end()),
                    }
                )
                if len(out) >= 100:
                    return out
    matched_ids = {str(item.get("pattern") or "") for item in out}
    if "dsp_official_use" in matched_ids:
        out = [
            item for item in out
            if item.get("pattern") not in {"dsp_ocr_variant", "dsp_ocr_context"}
        ]
    elif "dsp_ocr_variant" in matched_ids:
        out = [item for item in out if item.get("pattern") != "dsp_ocr_context"]
    return out


def _normalize_pattern_ids(value: Any) -> Optional[List[str]]:
    if not isinstance(value, (list, tuple, set)):
        return None
    normalized = {
        str(item or "").strip()
        for item in value
        if str(item or "").strip()
    }
    return sorted(normalized)


def _normalize_scan_extensions(value: Any) -> Optional[List[str]]:
    if not isinstance(value, (list, tuple, set)):
        return None
    normalized: Set[str] = set()
    for item in value:
        extension = str(item or "").strip().lower()
        if not extension:
            continue
        if not extension.startswith("."):
            extension = f".{extension}"
        if extension in SUPPORTED_SCAN_EXTENSIONS:
            normalized.add(extension)
    return sorted(normalized)


def _analysis_scope(pattern_ids: Any, scan_extensions: Any = None) -> str:
    normalized_patterns = _normalize_pattern_ids(pattern_ids)
    normalized_extensions = _normalize_scan_extensions(scan_extensions)
    if normalized_patterns is None and normalized_extensions is None:
        return "all"
    scope_payload = json.dumps(
        {
            "patterns": normalized_patterns,
            "extensions": normalized_extensions,
        },
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(scope_payload.encode("utf-8", errors="ignore")).hexdigest()[:16]
    return f"selection:{digest}"


def _looks_gibberish(text: str) -> bool:
    content = str(text or "")
    if len(content.strip()) < 120:
        return True
    printable = sum(1 for ch in content if ch.isprintable())
    letters = sum(1 for ch in content if ch.isalpha())
    if printable == 0:
        return True
    letter_ratio = letters / max(1, printable)
    return letter_ratio < 0.35


def _extract_pdf_text(path: Path, max_pages: int = PDF_TEXT_PAGE_LIMIT) -> str:
    if fitz is None:
        return ""
    text_parts: List[str] = []
    try:
        with fitz.open(path) as doc:
            total = min(max_pages, len(doc))
            for idx in range(total):
                text_parts.append(doc.load_page(idx).get_text("text") or "")
    except Exception as exc:
        logging.debug("PDF text extraction failed for %s: %s", path, exc)
    return "\n".join(text_parts).strip()


def _first_pdf_pages_b64(path: Path, pages: int = PDF_OCR_PAGE_LIMIT) -> str:
    if fitz is None:
        return ""
    try:
        with fitz.open(path) as src:
            out = fitz.open()
            total = min(pages, len(src))
            for idx in range(total):
                out.insert_pdf(src, from_page=idx, to_page=idx)
            data = out.tobytes()
        return base64.b64encode(data).decode("ascii")
    except Exception as exc:
        logging.warning("Failed to build PDF slice for %s: %s", path, exc)
        return ""


def _pdf_pages_in_slice(path: Path, pages: int = PDF_OCR_PAGE_LIMIT) -> int:
    if fitz is None:
        return 0
    try:
        with fitz.open(path) as doc:
            return min(max(0, int(pages)), len(doc))
    except Exception:
        return 0


def _text_file_encoding(path: Path) -> str:
    try:
        with path.open("rb") as stream:
            sample = stream.read(4096)
    except Exception:
        return "utf-8"
    if sample.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return "utf-16"
    if sample.startswith(codecs.BOM_UTF8):
        return "utf-8-sig"
    try:
        sample.decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        return "cp1251"


def _iter_text_chunks(path: Path, chunk_bytes: int = TEXT_CHUNK_BYTES) -> Iterable[str]:
    encoding = _text_file_encoding(path)
    decoder = codecs.getincrementaldecoder(encoding)(errors="replace")
    with path.open("rb") as stream:
        while True:
            raw = stream.read(max(4096, int(chunk_bytes)))
            if not raw:
                tail = decoder.decode(b"", final=True)
                if tail:
                    yield tail
                break
            text = decoder.decode(raw, final=False)
            if text:
                yield text


def _read_text_file(path: Path, max_bytes: Optional[int] = None) -> str:
    try:
        if max_bytes is None:
            return "".join(_iter_text_chunks(path))
        with path.open("rb") as stream:
            raw = stream.read(max(0, int(max_bytes)))
        return raw.decode(_text_file_encoding(path), errors="replace")
    except Exception:
        return ""


def _iter_target_roots(extra_roots: str = "") -> Iterable[Path]:
    users_root = Path(r"C:\Users")
    roots: List[Path] = []
    if winreg is not None:
        try:
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
            ) as key:
                for value_name in ("Desktop", "Personal", "{374DE290-123F-4565-9164-39C4925E467B}"):
                    try:
                        raw_value, _ = winreg.QueryValueEx(key, value_name)
                    except OSError:
                        continue
                    expanded = os.path.expandvars(str(raw_value or "").strip())
                    if expanded:
                        roots.append(Path(expanded))
        except OSError:
            pass
    user_dirs = list(users_root.iterdir()) if users_root.exists() else []
    for user_dir in user_dirs:
        if not user_dir.is_dir():
            continue
        name = user_dir.name.strip().lower()
        if name in IGNORED_USER_DIRS:
            continue
        for sub in USER_SUBDIRS:
            target = user_dir / sub
            if target.exists() and target.is_dir():
                roots.append(target)
        try:
            roots.extend(
                target for target in user_dir.glob("OneDrive*")
                if target.exists() and target.is_dir()
            )
        except Exception:
            pass
    for env_name in ("OneDrive", "OneDriveConsumer", "OneDriveCommercial"):
        raw = str(os.getenv(env_name, "")).strip()
        if raw:
            roots.append(Path(raw))
    for raw in str(extra_roots or "").split(";"):
        value = raw.strip()
        if value:
            roots.append(Path(value))
    unique: List[Path] = []
    seen: Set[str] = set()
    for root in roots:
        key = _norm_path(root)
        if key in seen or not root.exists() or not root.is_dir():
            continue
        seen.add(key)
        unique.append(root)
    return unique


def _iter_files(roots: Iterable[Path], max_file_bytes: int) -> Iterable[Path]:
    for root in roots:
        for dirpath, _, filenames in os.walk(root):
            for file_name in filenames:
                # Keep every directory entry visible to _scan_path. That layer
                # records stat/size/access failures in the run summary instead
                # of silently dropping them during traversal.
                yield Path(dirpath) / file_name


def _extract_user_from_path(path: Path) -> str:
    parts = [part for part in path.parts if part]
    for idx, part in enumerate(parts):
        if part.lower() == "users" and idx + 1 < len(parts):
            return parts[idx + 1]
    return ""


def _mac_address() -> str:
    mac = uuid.getnode()
    raw = f"{mac:012X}"
    return ":".join(raw[i:i + 2] for i in range(0, 12, 2))


def _hostname() -> str:
    return str(socket.gethostname() or "unknown-host")


def _primary_ip() -> str:
    try:
        return socket.gethostbyname(_hostname())
    except Exception:
        return ""


class _PathEventHandler(FileSystemEventHandler):
    def __init__(self, agent: "ScanAgent") -> None:
        super().__init__()
        self.agent = agent

    def on_created(self, event: Any) -> None:
        if not getattr(event, "is_directory", False):
            self.agent.enqueue_path(Path(str(getattr(event, "src_path", ""))))

    def on_modified(self, event: Any) -> None:
        if not getattr(event, "is_directory", False):
            self.agent.enqueue_path(Path(str(getattr(event, "src_path", ""))))

    def on_moved(self, event: Any) -> None:
        if not getattr(event, "is_directory", False):
            self.agent.enqueue_path(Path(str(getattr(event, "dest_path", ""))))


class ScanAgent:
    def __init__(self, config: Dict[str, Any]) -> None:
        self.config = config
        self.patterns_path = _resolve_patterns_file(self.config.get("patterns_file", ""))
        self.pattern_defs = _load_pattern_defs(self.patterns_path)
        self.state = _load_state()
        self.session = requests.Session()
        self.session.headers.update({"X-API-Key": self.config["api_key"]})
        self.agent_id = _hostname().lower()

        self._lock = threading.RLock()
        self._pending_paths: Set[str] = set()
        self._roots: List[Path] = list(_iter_target_roots(self.config.get("extra_roots", "")))
        self._observer: Optional[Any] = None
        self._state_dirty = False
        self._last_ingest_ok_at: Optional[int] = None
        self._last_error: str = ""
        self._last_status_write_at: int = 0

    def _url(self, suffix: str) -> str:
        return f"{self.config['server_base']}/{suffix.lstrip('/')}"

    def _send(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        kwargs.setdefault("timeout", self.config["timeout"])
        return self.session.request(method=method, url=url, **kwargs)

    def _write_status(self, force: bool = False) -> None:
        now_ts = int(time.time())
        if not force and (now_ts - self._last_status_write_at) < STATUS_UPDATE_INTERVAL_SEC:
            return
        payload = {
            "last_ingest_ok_at": self._last_ingest_ok_at,
            "outbox_depth": self._outbox_depth(),
            "dead_letter_depth": self._dead_letter_depth(),
            "pending_paths": len(self._pending_paths),
            "last_error": self._last_error,
            "agent_id": self.agent_id,
            "updated_at": now_ts,
        }
        try:
            _atomic_write_text(STATUS_PATH, json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            self._last_status_write_at = now_ts
        except Exception as exc:
            logging.debug("Scan status write failed: %s", exc)

    def _outbox_paths(self) -> List[Path]:
        if not OUTBOX_PENDING_PATH.exists():
            return []
        return sorted([row for row in OUTBOX_PENDING_PATH.glob("*.json") if row.is_file()], key=lambda row: row.name)

    def _outbox_depth(self) -> int:
        return len(self._outbox_paths())

    def _outbox_paths_for_task(self, task_id: str, *, exclude: Optional[Path] = None) -> List[Path]:
        normalized_task_id = str(task_id or "").strip()
        if not normalized_task_id:
            return []
        matches: List[Path] = []
        for path in self._outbox_paths():
            if exclude is not None and path == exclude:
                continue
            item = self._outbox_read(path)
            payload = item.get("payload") if isinstance(item, dict) else None
            if isinstance(payload, dict) and str(payload.get("scan_task_id") or "").strip() == normalized_task_id:
                matches.append(path)
        return matches

    def _attach_task_result_to_outbox(self, task_id: str, result: Dict[str, Any]) -> int:
        attached = 0
        for path in self._outbox_paths_for_task(task_id):
            item = self._outbox_read(path)
            if not item:
                continue
            item["task_result"] = dict(result)
            try:
                self._outbox_write(path, item)
                attached += 1
            except Exception as exc:
                logging.warning("Outbox task-result update failed (%s): %s", path, exc)
        return attached

    def _dead_letter_depth(self) -> int:
        if not OUTBOX_DEAD_PATH.exists():
            return 0
        return sum(1 for row in OUTBOX_DEAD_PATH.glob("*.json") if row.is_file())

    def _outbox_read(self, path: Path) -> Optional[Dict[str, Any]]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            logging.warning("Outbox read failed (%s): %s", path, exc)
            return None
        if not isinstance(data, dict):
            return None
        payload = data.get("payload")
        if not isinstance(payload, dict):
            return None
        data["id"] = str(data.get("id") or path.stem)
        data["created_at"] = _to_int(data.get("created_at"), int(time.time()))
        data["attempts"] = max(0, _to_int(data.get("attempts"), 0))
        data["next_attempt_at"] = _to_int(data.get("next_attempt_at"), 0)
        data["event_id"] = str(data.get("event_id") or payload.get("event_id") or "")
        data["last_error"] = str(data.get("last_error") or "")
        return data

    def _outbox_write(self, path: Path, item: Dict[str, Any]) -> None:
        _atomic_write_text(path, json.dumps(item, ensure_ascii=False), encoding="utf-8")

    def _outbox_move_to_dead(self, path: Path, item: Optional[Dict[str, Any]], reason: str) -> None:
        payload = item or {}
        payload["dropped_reason"] = str(reason or "unknown")
        payload["dropped_at"] = int(time.time())
        dead_path = OUTBOX_DEAD_PATH / path.name
        try:
            self._outbox_write(dead_path, payload)
        except Exception as exc:
            logging.warning("Outbox dead-letter write failed (%s): %s", dead_path, exc)
        try:
            path.unlink(missing_ok=True)
        except Exception as exc:
            logging.warning("Outbox delete failed (%s): %s", path, exc)

    def _outbox_has_event(self, event_id: str) -> bool:
        check_id = str(event_id or "").strip()
        if not check_id:
            return False
        for path in self._outbox_paths():
            item = self._outbox_read(path)
            if not item:
                continue
            if str(item.get("event_id") or "") == check_id:
                return True
        return False

    def _outbox_enqueue(self, payload: Dict[str, Any], *, retry_after_sec: int = 0) -> Optional[Path]:
        event_id = str(payload.get("event_id") or "").strip()
        if not event_id:
            return None
        if self._outbox_has_event(event_id):
            return None
        now_ts = int(time.time())
        item_id = uuid.uuid4().hex
        path = OUTBOX_PENDING_PATH / f"{now_ts:010d}_{item_id}.json"
        item = {
            "id": item_id,
            "event_id": event_id,
            "created_at": now_ts,
            "payload": payload,
            "attempts": 0,
            "next_attempt_at": now_ts + max(0, int(retry_after_sec or 0)),
            "last_error": "",
        }
        try:
            self._outbox_write(path, item)
            return path
        except Exception as exc:
            logging.warning("Outbox enqueue failed: %s", exc)
            return None

    def _outbox_backoff_seconds(self, attempts: int) -> int:
        attempts_count = max(1, attempts)
        base = min(3600, 5 * (2 ** min(attempts_count - 1, 10)))
        jitter = random.uniform(0.85, 1.25)
        return max(5, int(base * jitter))

    def _retry_after_seconds(self, response: Any) -> int:
        try:
            raw_value = response.headers.get("Retry-After")
        except Exception:
            raw_value = ""
        retry_after = _to_int(raw_value, 0)
        if retry_after <= 0:
            return 0
        return max(1, min(3600, retry_after))

    def _outbox_prune_limits(self) -> None:
        now_ts = int(time.time())
        max_age_seconds = int(self.config["outbox_max_age_days"]) * 24 * 60 * 60
        max_total_size = int(self.config["outbox_max_total_mb"]) * 1024 * 1024
        entries: List[Tuple[Path, Dict[str, Any], int]] = []
        for path in self._outbox_paths():
            try:
                size_bytes = int(path.stat().st_size)
            except Exception:
                size_bytes = 0
            item = self._outbox_read(path)
            if not item:
                self._outbox_move_to_dead(path, None, "OUTBOX_CORRUPT")
                continue
            if max_age_seconds > 0 and (now_ts - _to_int(item.get("created_at"), now_ts)) > max_age_seconds:
                self._outbox_move_to_dead(path, item, "OUTBOX_MAX_AGE")
                continue
            entries.append((path, item, size_bytes))

        while len(entries) > int(self.config["outbox_max_items"]):
            path, item, _ = entries.pop(0)
            logging.warning("Outbox full by count, moving oldest to dead-letter: %s", path.name)
            self._outbox_move_to_dead(path, item, "OUTBOX_FULL_COUNT")

        total_size = sum(max(0, size_bytes) for _, _, size_bytes in entries)
        while entries and total_size > max_total_size:
            path, item, size_bytes = entries.pop(0)
            logging.warning("Outbox full by size, moving oldest to dead-letter: %s", path.name)
            self._outbox_move_to_dead(path, item, "OUTBOX_FULL_SIZE")
            total_size -= max(0, size_bytes)

    def _register_scanned(
        self,
        path: Path,
        file_hash: str,
        stat_result: os.stat_result,
        *,
        event_id: str = "",
        source_kind: str = "",
        analysis_scope: str = "all",
    ) -> None:
        now_ts = int(time.time())
        files = self.state.setdefault("files", {})
        hashes = self.state.setdefault("hashes", {})
        record = {
            "hash": file_hash,
            "mtime": int(stat_result.st_mtime),
            "size": int(stat_result.st_size),
            "ts": now_ts,
            "analysis_version": ANALYSIS_VERSION,
            "analysis_scope": str(analysis_scope or "all").strip() or "all",
        }
        if event_id:
            record["event_id"] = str(event_id).strip()
        if source_kind:
            record["source_kind"] = str(source_kind).strip()
        files[_norm_path(path)] = record
        hashes[file_hash] = now_ts
        self._state_dirty = True

    def _register_scanned_from_payload(self, payload: Dict[str, Any]) -> None:
        file_path = str(payload.get("file_path") or "").strip()
        file_hash = str(payload.get("file_hash") or "").strip()
        if not file_path or not file_hash:
            return
        metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        mtime = _to_int(metadata.get("mtime"), int(time.time()))
        size_value = _to_int(payload.get("file_size"), 0)
        now_ts = int(time.time())
        files = self.state.setdefault("files", {})
        hashes = self.state.setdefault("hashes", {})
        event_id = str(payload.get("event_id") or "").strip()
        source_kind = str(payload.get("source_kind") or "").strip()
        record = {
            "hash": file_hash,
            "mtime": mtime,
            "size": size_value,
            "ts": now_ts,
            "analysis_version": str(metadata.get("analysis_version") or ANALYSIS_VERSION),
            "analysis_scope": str(metadata.get("analysis_scope") or "all").strip() or "all",
        }
        if event_id:
            record["event_id"] = event_id
        if source_kind:
            record["source_kind"] = source_kind
        files[_norm_path(Path(file_path))] = record
        hashes[file_hash] = now_ts
        self._state_dirty = True

    def _already_scanned(self, path: Path, stat_result: os.stat_result, *, analysis_scope: str = "all") -> bool:
        record = (self.state.get("files") or {}).get(_norm_path(path))
        if not isinstance(record, dict):
            return False
        same_mtime = _to_int(record.get("mtime"), -1) == int(stat_result.st_mtime)
        same_size = _to_int(record.get("size"), -1) == int(stat_result.st_size)
        if not (same_mtime and same_size):
            return False
        old_hash = str(record.get("hash") or "")
        if not old_hash:
            return False
        if str(record.get("analysis_version") or "") != ANALYSIS_VERSION:
            return False
        if str(record.get("analysis_scope") or "all") != (str(analysis_scope or "all").strip() or "all"):
            return False
        return old_hash in (self.state.get("hashes") or {})

    def _is_supported_scan_path(self, path: Path) -> bool:
        return path.suffix.lower() in SUPPORTED_SCAN_EXTENSIONS

    def _build_event_id(
        self,
        path: Path,
        file_hash: str,
        stat_result: os.stat_result,
        *,
        scan_task_id: str = "",
        pattern_ids: Any = None,
    ) -> str:
        source = "|".join(
            [
                self.agent_id,
                _norm_path(path),
                str(file_hash or "").strip().lower(),
                str(int(stat_result.st_mtime)),
                str(int(stat_result.st_size)),
                ANALYSIS_VERSION,
            ]
        )
        scope = _analysis_scope(pattern_ids)
        if scope != "all":
            source = f"{source}|{scope}"
        return hashlib.sha256(source.encode("utf-8", errors="ignore")).hexdigest()

    def _analyze_file(
        self,
        path: Path,
        file_hash: str,
        stat_result: os.stat_result,
        *,
        pattern_ids: Any = None,
    ) -> Optional[Dict[str, Any]]:
        ext = path.suffix.lower()
        normalized_pattern_ids = _normalize_pattern_ids(pattern_ids)
        if normalized_pattern_ids is None:
            active_pattern_defs = self.pattern_defs
        else:
            allowed_pattern_ids = set(normalized_pattern_ids)
            active_pattern_defs = [
                item for item in self.pattern_defs
                if str(item.get("id") or "").strip() in allowed_pattern_ids
            ]
        matches: List[Dict[str, str]] = []
        text_excerpt = ""
        pdf_slice_b64 = ""
        document_b64 = ""
        source_kind = "metadata"
        extraction_outcomes: List[Dict[str, Any]] = []
        pages_in_slice = 0
        analysis_incomplete_reason = ""

        if ext in TEXT_EXTENSIONS and not active_pattern_defs:
            source_kind = "analysis_incomplete"
            analysis_incomplete_reason = "patterns_unavailable"
            extraction_outcomes.append({"method": "agent_patterns", "outcome": "unavailable"})
        elif ext == ".pdf":
            source_kind = "pdf_slice"
            text = _extract_pdf_text(path, max_pages=PDF_TEXT_PAGE_LIMIT)
            if text:
                matches = scan_text(text, active_pattern_defs)
                text_excerpt = text[:4000]
                extraction_outcomes.append({
                    "method": "text_layer",
                    "outcome": "text_extracted_low_quality" if _looks_gibberish(text) else "text_extracted",
                })
            else:
                extraction_outcomes.append({"method": "text_layer", "outcome": "no_usable_text"})
            pages_in_slice = _pdf_pages_in_slice(path, pages=PDF_OCR_PAGE_LIMIT)
            pdf_slice_b64 = _first_pdf_pages_b64(path, pages=PDF_OCR_PAGE_LIMIT)
            if not pdf_slice_b64 or pages_in_slice <= 0:
                source_kind = "analysis_incomplete"
                analysis_incomplete_reason = "pdf_slice_creation_failed"
                extraction_outcomes.append({"method": "pdf_slice", "outcome": "failed"})
            else:
                extraction_outcomes.append({"method": "pdf_slice", "outcome": "created", "pages": pages_in_slice})
        elif ext in TEXT_EXTENSIONS:
            source_kind = "text"
            overlap = ""
            try:
                for chunk in _iter_text_chunks(path):
                    candidate = overlap + chunk
                    if not text_excerpt:
                        text_excerpt = candidate[:4000]
                    matches.extend(scan_text(candidate, active_pattern_defs))
                    if len(matches) >= 100:
                        matches = matches[:100]
                        break
                    overlap = candidate[-TEXT_CHUNK_OVERLAP:]
                extraction_outcomes.append({"method": "stream_text", "outcome": "complete"})
            except Exception as exc:
                source_kind = "analysis_incomplete"
                analysis_incomplete_reason = f"text_read_error:{type(exc).__name__}"
                extraction_outcomes.append({"method": "stream_text", "outcome": "failed"})
        elif ext in IMAGE_EXTENSIONS or ext in OFFICE_EXTENSIONS:
            source_kind = "image" if ext in IMAGE_EXTENSIONS else "office"
            try:
                document_b64 = base64.b64encode(path.read_bytes()).decode("ascii")
                extraction_outcomes.append({"method": "document_upload", "outcome": "prepared"})
            except Exception as exc:
                source_kind = "analysis_incomplete"
                analysis_incomplete_reason = f"document_read_error:{type(exc).__name__}"
                extraction_outcomes.append({"method": "document_upload", "outcome": "failed"})

        if not matches and not pdf_slice_b64 and not document_b64 and not analysis_incomplete_reason:
            return None

        return {
            "agent_id": self.agent_id,
            "hostname": _hostname(),
            "branch": self.config["branch"],
            "user_login": _extract_user_from_path(path),
            "user_full_name": "",
            "file_path": str(path),
            "file_name": path.name,
            "file_hash": file_hash,
            "file_size": int(stat_result.st_size),
            "source_kind": source_kind,
            "text_excerpt": text_excerpt,
            "pdf_slice_b64": pdf_slice_b64,
            "document_b64": document_b64,
            "local_pattern_hits": matches,
            "metadata": {
                "mtime": int(stat_result.st_mtime),
                "ext": ext,
                "analysis_version": ANALYSIS_VERSION,
                "analysis_scope": _analysis_scope(normalized_pattern_ids),
                "agent_pattern_ids": normalized_pattern_ids,
                "ocr_page_limit": PDF_OCR_PAGE_LIMIT,
                "text_page_limit": PDF_TEXT_PAGE_LIMIT,
                "pages_in_slice": pages_in_slice,
                "extraction_outcomes": extraction_outcomes,
                "analysis_incomplete_reason": analysis_incomplete_reason,
            },
        }

    def _send_document_ingest(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        raw_b64 = str(payload.get("document_b64") or "").strip()
        if not raw_b64:
            return {"success": False, "deduped": False, "fallback": True}
        try:
            document_bytes = base64.b64decode(raw_b64, validate=False)
        except Exception as exc:
            logging.warning("Document payload decode failed: %s", exc)
            self._last_error = "INGEST_DOCUMENT_DECODE"
            return {"success": False, "deduped": False, "fallback": False}
        if not document_bytes:
            self._last_error = "INGEST_DOCUMENT_EMPTY"
            return {"success": False, "deduped": False, "fallback": False}
        metadata = dict(payload or {})
        metadata.pop("document_b64", None)
        file_name = str(payload.get("file_name") or "document.bin")
        try:
            response = self._send(
                "POST",
                self._url("ingest/document"),
                data={"metadata_json": json.dumps(metadata, ensure_ascii=False)},
                files={"document": (file_name, document_bytes, "application/octet-stream")},
            )
            if response.status_code in {404, 405, 501}:
                self._last_error = f"INGEST_DOCUMENT_UNAVAILABLE_{response.status_code}"
                return {"success": False, "deduped": False, "fallback": False}
            if response.status_code == 429:
                retry_after = self._retry_after_seconds(response)
                result = {"success": False, "deduped": False, "fallback": False}
                if retry_after:
                    result["retry_after"] = retry_after
                return result
            if response.status_code >= 300:
                self._last_error = f"INGEST_HTTP_{response.status_code}"
                return {"success": False, "deduped": False, "fallback": False}
            self._last_ingest_ok_at = int(time.time())
            self._last_error = ""
            data = response.json() if response.content else {}
            return {"success": True, "deduped": bool((data or {}).get("deduped")), "fallback": False}
        except Exception as exc:
            logging.warning("Document ingest request error: %s", exc)
            self._last_error = f"INGEST_ERR:{type(exc).__name__}"
            return {"success": False, "deduped": False, "fallback": False}

    def _send_pdf_slice_ingest(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        raw_b64 = str(payload.get("pdf_slice_b64") or "").strip()
        if not raw_b64:
            return {"success": False, "deduped": False, "fallback": True}
        try:
            pdf_bytes = base64.b64decode(raw_b64, validate=False)
        except Exception as exc:
            logging.warning("PDF slice payload decode failed: %s", exc)
            self._last_error = "INGEST_PDF_SLICE_DECODE"
            return {"success": False, "deduped": False, "fallback": False}
        if not pdf_bytes:
            self._last_error = "INGEST_PDF_SLICE_EMPTY"
            return {"success": False, "deduped": False, "fallback": False}

        metadata = dict(payload or {})
        metadata.pop("pdf_slice_b64", None)
        try:
            response = self._send(
                "POST",
                self._url("ingest/pdf-slice"),
                data={"metadata_json": json.dumps(metadata, ensure_ascii=False)},
                files={"pdf_slice": ("slice.pdf", pdf_bytes, "application/pdf")},
            )
            if response.status_code in {404, 405, 501}:
                self._last_error = f"INGEST_PDF_SLICE_UNAVAILABLE_{response.status_code}"
                return {"success": False, "deduped": False, "fallback": True}
            if response.status_code == 429:
                retry_after = self._retry_after_seconds(response)
                logging.warning("PDF slice ingest backpressure status=429 retry_after=%s", retry_after)
                self._last_error = f"INGEST_HTTP_429_RETRY_AFTER_{retry_after}"
                result = {"success": False, "deduped": False, "fallback": False}
                if retry_after > 0:
                    result["retry_after"] = retry_after
                return result
            if response.status_code >= 300:
                logging.warning("PDF slice ingest failed status=%s body=%s", response.status_code, response.text[:300])
                self._last_error = f"INGEST_HTTP_{response.status_code}"
                return {"success": False, "deduped": False, "fallback": False}
            self._last_ingest_ok_at = int(time.time())
            self._last_error = ""
            data = response.json() if response.content else {}
            if not isinstance(data, dict):
                data = {}
            return {"success": True, "deduped": bool(data.get("deduped")), "fallback": False}
        except Exception as exc:
            logging.warning("PDF slice ingest request error: %s", exc)
            self._last_error = f"INGEST_ERR:{type(exc).__name__}"
            return {"success": False, "deduped": False, "fallback": True}

    def _send_ingest(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if str(payload.get("document_b64") or "").strip():
            return self._send_document_ingest(payload)
        if (
            str(payload.get("source_kind") or "").strip().lower() == "pdf_slice"
            and str(payload.get("pdf_slice_b64") or "").strip()
        ):
            pdf_result = self._send_pdf_slice_ingest(payload)
            if pdf_result.get("success") or not bool(pdf_result.get("fallback")):
                return pdf_result

        try:
            response = self._send("POST", self._url("ingest"), json=payload)
            if response.status_code == 429:
                retry_after = self._retry_after_seconds(response)
                logging.warning("Ingest backpressure status=429 retry_after=%s", retry_after)
                self._last_error = f"INGEST_HTTP_429_RETRY_AFTER_{retry_after}"
                result = {"success": False, "deduped": False}
                if retry_after > 0:
                    result["retry_after"] = retry_after
                return result
            if response.status_code >= 300:
                logging.warning("Ingest failed status=%s body=%s", response.status_code, response.text[:300])
                self._last_error = f"INGEST_HTTP_{response.status_code}"
                return {"success": False, "deduped": False}
            self._last_ingest_ok_at = int(time.time())
            self._last_error = ""
            data = response.json() if response.content else {}
            if not isinstance(data, dict):
                data = {}
            return {"success": True, "deduped": bool(data.get("deduped"))}
        except Exception as exc:
            logging.warning("Ingest request error: %s", exc)
            self._last_error = f"INGEST_ERR:{type(exc).__name__}"
            return {"success": False, "deduped": False}

    def _normalize_ingest_result(self, result: Any) -> Dict[str, Any]:
        if isinstance(result, dict):
            return {
                "success": bool(result.get("success")),
                "deduped": bool(result.get("deduped")),
                "retry_after": max(0, _to_int(result.get("retry_after"), 0)),
            }
        return {"success": bool(result), "deduped": False, "retry_after": 0}

    def _drain_outbox(self, max_items: int = DEFAULT_OUTBOX_DRAIN_BATCH) -> int:
        now_ts = int(time.time())
        sent_count = 0
        for path in self._outbox_paths()[: max(1, max_items)]:
            item = self._outbox_read(path)
            if not item:
                self._outbox_move_to_dead(path, None, "OUTBOX_CORRUPT")
                continue
            if _to_int(item.get("next_attempt_at"), 0) > now_ts:
                continue
            payload = item.get("payload")
            if not isinstance(payload, dict):
                self._outbox_move_to_dead(path, item, "OUTBOX_INVALID_PAYLOAD")
                continue
            ingest_result = self._normalize_ingest_result(self._send_ingest(payload))
            if ingest_result["success"]:
                task_id = str(payload.get("scan_task_id") or "").strip()
                task_result = item.get("task_result")
                if (
                    task_id
                    and isinstance(task_result, dict)
                    and not self._outbox_paths_for_task(task_id, exclude=path)
                ):
                    final_result = dict(task_result)
                    final_result["phase"] = "server_processing"
                    final_result["ingest_complete"] = True
                    final_result["outbox_pending"] = 0
                    if not self._task_result(task_id, "acknowledged", result=final_result):
                        attempts = _to_int(item.get("attempts"), 0) + 1
                        item["attempts"] = attempts
                        item["next_attempt_at"] = now_ts + self._outbox_backoff_seconds(attempts)
                        item["last_error"] = self._last_error or "INGEST_COMPLETE_FAILED"
                        try:
                            self._outbox_write(path, item)
                        except Exception as exc:
                            logging.warning("Outbox finalize retry write failed (%s): %s", path, exc)
                        continue
                self._register_scanned_from_payload(payload)
                try:
                    path.unlink(missing_ok=True)
                except Exception as exc:
                    logging.warning("Outbox delete after ACK failed (%s): %s", path, exc)
                sent_count += 1
                continue
            attempts = _to_int(item.get("attempts"), 0) + 1
            item["attempts"] = attempts
            retry_after = max(0, _to_int(ingest_result.get("retry_after"), 0))
            item["next_attempt_at"] = now_ts + (retry_after or self._outbox_backoff_seconds(attempts))
            item["last_error"] = self._last_error or "INGEST_FAILED"
            try:
                self._outbox_write(path, item)
            except Exception as exc:
                logging.warning("Outbox rewrite failed (%s): %s", path, exc)
        return sent_count

    def _is_under_roots(self, path: Path) -> bool:
        test_path = _norm_path(path)
        for root in self._roots:
            if test_path.startswith(_norm_path(root) + os.sep) or test_path == _norm_path(root):
                return True
        return False

    def enqueue_path(self, path: Path) -> None:
        if not path:
            return
        normalized = _norm_path(path)
        with self._lock:
            if not self._is_under_roots(path):
                return
            self._pending_paths.add(normalized)

    def _scan_path(
        self,
        path: Path,
        scan_task_id: Optional[str] = None,
        *,
        force_rescan: bool = False,
        include_reasons: bool = False,
        pattern_ids: Any = None,
        scan_extensions: Any = None,
    ) -> Dict[str, Any]:
        normalized_pattern_ids = _normalize_pattern_ids(pattern_ids)
        normalized_scan_extensions = _normalize_scan_extensions(scan_extensions)
        analysis_scope = _analysis_scope(normalized_pattern_ids, normalized_scan_extensions)
        result = {"scanned": 0, "queued": 0, "skipped": 0, "deferred": 0, "deduped": 0}
        if include_reasons:
            result["files_seen"] = 1
            result["skipped_reasons"] = {}

        def skip(reason: str) -> Dict[str, Any]:
            result["skipped"] += 1
            if include_reasons:
                reasons = result.setdefault("skipped_reasons", {})
                if isinstance(reasons, dict):
                    reasons[reason] = int(reasons.get(reason) or 0) + 1
            return result

        def defer(payload: Dict[str, Any], retry_after: int) -> None:
            outbox_path = self._outbox_enqueue(payload, retry_after_sec=retry_after)
            if outbox_path is not None:
                result["deferred"] += 1
                return
            result["persistence_failed"] = int(result.get("persistence_failed") or 0) + 1
            if include_reasons:
                reasons = result.setdefault("skipped_reasons", {})
                if isinstance(reasons, dict):
                    reasons["outbox_persistence_failed"] = int(reasons.get("outbox_persistence_failed") or 0) + 1

        previous_record = (self.state.get("files") or {}).get(_norm_path(path))
        if not isinstance(previous_record, dict):
            previous_record = {}

        try:
            stat_result = path.stat()
        except Exception:
            return skip("stat_error")
        if not path.is_file():
            return skip("not_file")
        if stat_result.st_size <= 0:
            return skip("size_limit")
        if not self._is_supported_scan_path(path):
            return skip("unsupported_extension")
        if normalized_scan_extensions is not None and path.suffix.lower() not in set(normalized_scan_extensions):
            return skip("excluded_extension")
        # Большой PDF не передаётся целиком: локально читаются только первые страницы
        # текстового слоя и формируется ограниченный OCR-срез. Поэтому общий лимит
        # upload payload не должен запрещать его анализ.
        if stat_result.st_size > self.config["max_file_bytes"] and path.suffix.lower() != ".pdf":
            pseudo_hash = hashlib.sha256(
                f"{_norm_path(path)}|{int(stat_result.st_mtime)}|{int(stat_result.st_size)}".encode(
                    "utf-8", errors="ignore"
                )
            ).hexdigest()
            payload = {
                "agent_id": self.agent_id,
                "hostname": _hostname(),
                "branch": self.config["branch"],
                "user_login": _extract_user_from_path(path),
                "user_full_name": "",
                "file_path": str(path),
                "file_name": path.name,
                "file_hash": pseudo_hash,
                "file_size": int(stat_result.st_size),
                "source_kind": "analysis_incomplete",
                "text_excerpt": "",
                "pdf_slice_b64": "",
                "document_b64": "",
                "local_pattern_hits": [],
                "metadata": {
                    "mtime": int(stat_result.st_mtime),
                    "ext": path.suffix.lower(),
                    "analysis_version": ANALYSIS_VERSION,
                    "analysis_scope": analysis_scope,
                    "agent_pattern_ids": normalized_pattern_ids,
                    "ocr_page_limit": PDF_OCR_PAGE_LIMIT,
                    "text_page_limit": PDF_TEXT_PAGE_LIMIT,
                    "analysis_incomplete_reason": "file_too_large",
                    "extraction_outcomes": [{"method": "agent", "outcome": "file_too_large"}],
                },
            }
            normalized_task_id = str(scan_task_id or "").strip()
            if normalized_task_id:
                payload["scan_task_id"] = normalized_task_id
            payload["event_id"] = self._build_event_id(
                path,
                pseudo_hash,
                stat_result,
                scan_task_id=normalized_task_id,
                pattern_ids=normalized_pattern_ids,
            )
            result["skipped"] += 1
            if include_reasons:
                result["skipped_reasons"] = {"size_limit": 1}
            ingest_result = self._normalize_ingest_result(self._send_ingest(payload))
            if ingest_result["success"]:
                self._register_scanned(
                    path,
                    pseudo_hash,
                    stat_result,
                    event_id=str(payload.get("event_id") or ""),
                    source_kind="analysis_incomplete",
                    analysis_scope=analysis_scope,
                )
                result["queued"] += 0 if ingest_result["deduped"] else 1
                result["deduped"] += 1 if ingest_result["deduped"] else 0
            else:
                defer(payload, _to_int(ingest_result.get("retry_after"), 0))
            return result

        if not force_rescan and self._already_scanned(path, stat_result, analysis_scope=analysis_scope):
            return skip("already_scanned")

        try:
            file_hash = _sha256_file(path)
        except Exception:
            return skip("hash_error")

        result["scanned"] += 1
        payload = self._analyze_file(path, file_hash, stat_result, pattern_ids=normalized_pattern_ids)
        if not payload:
            previous_event_id = str(previous_record.get("event_id") or "").strip()
            previous_hash = str(previous_record.get("hash") or "").strip()
            if force_rescan and previous_event_id:
                result["cleaned_events"] = [
                    {
                        "file_path": str(path),
                        "file_hash": previous_hash or file_hash,
                        "current_file_hash": file_hash,
                        "event_id": previous_event_id,
                        "source_kind": str(previous_record.get("source_kind") or "").strip(),
                    }
                ]
            return skip("no_match")

        if include_reasons:
            result["analysis_incomplete"] = int(
                str(payload.get("source_kind") or "").strip().lower() == "analysis_incomplete"
            )
            result["incident_candidates"] = int(bool(payload.get("local_pattern_hits")))

        normalized_task_id = str(scan_task_id or "").strip()
        if normalized_task_id:
            payload["scan_task_id"] = normalized_task_id
        payload["event_id"] = self._build_event_id(
            path,
            file_hash,
            stat_result,
            scan_task_id=normalized_task_id,
            pattern_ids=normalized_pattern_ids,
        )
        ingest_result = self._normalize_ingest_result(self._send_ingest(payload))
        if ingest_result["success"]:
            self._register_scanned(
                path,
                file_hash,
                stat_result,
                event_id=str(payload.get("event_id") or "").strip(),
                source_kind=str(payload.get("source_kind") or "").strip(),
                analysis_scope=analysis_scope,
            )
            if ingest_result["deduped"]:
                result["deduped"] += 1
            else:
                result["queued"] += 1
            return result

        defer(payload, _to_int(ingest_result.get("retry_after"), 0))
        return result

    def _prune_deleted_state_files(self) -> List[Dict[str, Any]]:
        files = self.state.setdefault("files", {})
        hashes = self.state.setdefault("hashes", {})
        if not isinstance(files, dict) or not isinstance(hashes, dict):
            self.state["files"] = {}
            self.state["hashes"] = {}
            self._state_dirty = True
            return []

        removed_events: List[Dict[str, Any]] = []
        removed_count = 0
        for raw_path in list(files.keys()):
            try:
                exists = Path(str(raw_path)).exists()
            except Exception:
                exists = True
            if exists:
                continue
            meta = files.get(raw_path)
            if isinstance(meta, dict):
                removed_events.append(
                    {
                        "file_path": str(raw_path),
                        "file_hash": str(meta.get("hash") or "").strip(),
                        "event_id": str(meta.get("event_id") or "").strip(),
                        "source_kind": str(meta.get("source_kind") or "").strip(),
                    }
                )
            files.pop(raw_path, None)
            removed_count += 1

        if removed_count:
            live_hashes = {
                str(meta.get("hash") or "").strip()
                for meta in files.values()
                if isinstance(meta, dict) and str(meta.get("hash") or "").strip()
            }
            for file_hash in list(hashes.keys()):
                if str(file_hash or "").strip() not in live_hashes:
                    hashes.pop(file_hash, None)
            self._state_dirty = True
        return removed_events

    def run_scan_once(
        self,
        scan_task_id: Optional[str] = None,
        *,
        force_rescan: bool = False,
        pattern_ids: Any = None,
        scan_extensions: Any = None,
    ) -> Dict[str, Any]:
        self.refresh_roots(force=True)
        normalized_pattern_ids = _normalize_pattern_ids(pattern_ids)
        normalized_scan_extensions = _normalize_scan_extensions(scan_extensions)
        deleted_file_events = self._prune_deleted_state_files() if force_rescan else []
        summary = {
            "scanned": 0,
            "queued": 0,
            "skipped": 0,
            "deferred": 0,
            "deduped": 0,
            "persistence_failed": 0,
            "deleted_from_state": len(deleted_file_events),
            "force_rescan": bool(force_rescan),
            "agent_pattern_ids": normalized_pattern_ids,
            "scan_extensions": normalized_scan_extensions,
            "files_seen": 0,
            "skipped_reasons": {},
            "deleted_file_events": deleted_file_events,
            "cleaned_file_events": [],
            "seen": 0,
            "analyzed": 0,
            "clean": 0,
            "incidents": 0,
            "incomplete": 0,
            "unsupported": 0,
            "extension_counts": {},
            "excluded_by_reason": {},
            "excluded_by_extension": {},
        }
        for path in _iter_files(self._roots, self.config["max_file_bytes"]):
            stats = self._scan_path(
                path,
                scan_task_id=scan_task_id,
                force_rescan=force_rescan,
                include_reasons=True,
                pattern_ids=normalized_pattern_ids,
                scan_extensions=normalized_scan_extensions,
            )
            summary["scanned"] += stats["scanned"]
            summary["queued"] += stats["queued"]
            summary["skipped"] += stats["skipped"]
            summary["deferred"] += stats["deferred"]
            summary["deduped"] += stats["deduped"]
            summary["persistence_failed"] += int(stats.get("persistence_failed") or 0)
            summary["files_seen"] += int(stats.get("files_seen") or 0)
            summary["seen"] += 1
            extension = path.suffix.lower() or "<none>"
            summary["extension_counts"][extension] = int(summary["extension_counts"].get(extension) or 0) + 1
            cleaned_events = stats.get("cleaned_events")
            if isinstance(cleaned_events, list):
                summary["cleaned_file_events"].extend(
                    item for item in cleaned_events if isinstance(item, dict)
                )
            reasons = stats.get("skipped_reasons")
            if isinstance(reasons, dict):
                excluded_for_path = 0
                for reason, count in reasons.items():
                    summary["skipped_reasons"][str(reason)] = int(summary["skipped_reasons"].get(str(reason)) or 0) + int(count or 0)
                    summary["excluded_by_reason"][str(reason)] = int(summary["excluded_by_reason"].get(str(reason)) or 0) + int(count or 0)
                    if reason == "no_match":
                        summary["clean"] += int(count or 0)
                    elif reason == "unsupported_extension":
                        summary["unsupported"] += int(count or 0)
                    elif reason == "excluded_extension":
                        pass
                    elif reason not in {"already_scanned", "not_file"}:
                        summary["incomplete"] += int(count or 0)
                    if reason not in {"no_match", "already_scanned", "not_file", "excluded_extension"}:
                        excluded_for_path += int(count or 0)
                if excluded_for_path > 0:
                    summary["excluded_by_extension"][extension] = int(
                        summary["excluded_by_extension"].get(extension) or 0
                    ) + excluded_for_path
            summary["analyzed"] += int(stats.get("scanned") or 0)
            summary["incomplete"] += int(stats.get("analysis_incomplete") or 0)
            summary["incidents"] += int(stats.get("incident_candidates") or 0)
        self._outbox_prune_limits()
        drained = self._drain_outbox(max_items=int(self.config.get("outbox_drain_batch", DEFAULT_OUTBOX_DRAIN_BATCH)))
        if drained:
            logging.info("Outbox drained after scan_once: sent=%s", drained)
        remaining_outbox = (
            len(self._outbox_paths_for_task(scan_task_id))
            if scan_task_id
            else self._outbox_depth()
        )
        if summary["persistence_failed"] > 0:
            phase = "failed"
            jobs_pending = 0
        elif remaining_outbox > 0 or (not scan_task_id and summary["deferred"] > 0):
            phase = "agent_outbox"
            jobs_pending = summary["queued"] + remaining_outbox
        elif summary["queued"] > 0:
            phase = "server_processing"
            jobs_pending = summary["queued"]
        else:
            phase = "completed"
            jobs_pending = 0
        summary.update(
            {
                "local_clean": int(summary["clean"]),
                "local_incomplete": int(summary["incomplete"]),
                "phase": phase,
                "ingest_complete": phase in {"server_processing", "completed"},
                "jobs_total": summary["queued"] + summary["deferred"],
                "jobs_pending": jobs_pending,
                "jobs_done_clean": 0,
                "jobs_done_with_incident": 0,
                "jobs_failed": int(summary["persistence_failed"]),
                "outbox_pending": remaining_outbox,
                "dead_letter": self._dead_letter_depth(),
            }
        )
        if scan_task_id and phase == "agent_outbox":
            attached = self._attach_task_result_to_outbox(scan_task_id, summary)
            if attached < remaining_outbox:
                summary["ingest_complete"] = False
                logging.warning(
                    "Task result attached to only %s/%s outbox item(s), task_id=%s",
                    attached,
                    remaining_outbox,
                    scan_task_id,
                )
        self._persist_state()
        self._write_status(force=True)
        logging.info(
            "Scan completed: scanned=%s queued=%s skipped=%s deferred=%s deduped=%s force_rescan=%s phase=%s",
            summary["scanned"],
            summary["queued"],
            summary["skipped"],
            summary["deferred"],
            summary["deduped"],
            summary["force_rescan"],
            summary["phase"],
        )
        return summary

    def process_watchdog_queue(self, max_items: int) -> Dict[str, int]:
        batch: List[str] = []
        with self._lock:
            while self._pending_paths and len(batch) < max_items:
                batch.append(self._pending_paths.pop())

        summary = {"scanned": 0, "queued": 0, "skipped": 0, "deferred": 0, "deduped": 0}
        for raw in batch:
            stats = self._scan_path(Path(raw))
            summary["scanned"] += stats["scanned"]
            summary["queued"] += stats["queued"]
            summary["skipped"] += stats["skipped"]
            summary["deferred"] += stats["deferred"]
            summary["deduped"] += stats["deduped"]

        if batch:
            self._persist_state()
        return summary

    def _persist_state(self) -> None:
        _prune_state(self.state)
        if self._state_dirty:
            _save_state(self.state)
            self._state_dirty = False
        self._write_status(force=False)

    def heartbeat(self) -> None:
        payload = {
            "agent_id": self.agent_id,
            "hostname": _hostname(),
            "branch": self.config["branch"],
            "ip_address": _primary_ip(),
            "version": AGENT_VERSION,
            "status": "online",
            "queue_pending": len(self._pending_paths) + self._outbox_depth(),
            "last_seen_at": int(time.time()),
            "metadata": {
                "mac_address": _mac_address(),
                "watchdog_enabled": bool(self._observer is not None),
                "analysis_version": ANALYSIS_VERSION,
                "ocr_page_limit": PDF_OCR_PAGE_LIMIT,
                "text_page_limit": PDF_TEXT_PAGE_LIMIT,
                "supported_formats": sorted(SUPPORTED_SCAN_EXTENSIONS),
                "outbox_depth": self._outbox_depth(),
                "dead_letter_depth": self._dead_letter_depth(),
            },
        }
        try:
            response = self._send("POST", self._url("heartbeat"), json=payload)
            if response.status_code >= 300:
                logging.warning("Heartbeat failed status=%s", response.status_code)
        except Exception as exc:
            logging.warning("Heartbeat error: %s", exc)

    def _task_result(self, task_id: str, status_value: str, result: Optional[Dict[str, Any]] = None, error_text: str = "") -> bool:
        payload = {
            "agent_id": self.agent_id,
            "status": status_value,
            "result": result or {},
            "error_text": error_text,
        }
        try:
            response = self._send("POST", self._url(f"tasks/{task_id}/result"), json=payload)
            if response.status_code >= 300:
                logging.warning("Task result failed task_id=%s status=%s", task_id, response.status_code)
                return False
            return True
        except Exception as exc:
            logging.warning("Task result send error: %s", exc)
            return False

    def poll_tasks(self) -> None:
        try:
            response = self._send("GET", self._url("tasks/poll"), params={"agent_id": self.agent_id, "limit": 10})
            if response.status_code >= 300:
                logging.warning("Task poll failed status=%s", response.status_code)
                return
            data = response.json() if response.content else {}
        except Exception as exc:
            logging.warning("Task poll error: %s", exc)
            return

        tasks = data.get("tasks") if isinstance(data, dict) else []
        if not isinstance(tasks, list):
            return

        for task in tasks:
            task_id = str(task.get("task_id") or "").strip()
            command = str(task.get("command") or "").strip().lower()
            payload = task.get("payload") if isinstance(task.get("payload"), dict) else {}
            force_rescan = _to_bool(payload.get("force_rescan"), default=False)
            pattern_ids = _normalize_pattern_ids(payload.get("agent_pattern_ids"))
            scan_extensions = _normalize_scan_extensions(payload.get("scan_extensions"))
            if not task_id:
                continue
            self._task_result(
                task_id,
                "acknowledged",
                result={
                    "phase": "local_scan",
                    "ingest_complete": False,
                    "scanned": 0,
                    "queued": 0,
                    "skipped": 0,
                    "deferred": 0,
                    "deduped": 0,
                    "deleted_from_state": 0,
                    "force_rescan": force_rescan,
                    "agent_pattern_ids": pattern_ids,
                    "scan_extensions": scan_extensions,
                    "jobs_total": 0,
                    "jobs_pending": 0,
                    "jobs_done_clean": 0,
                    "jobs_done_with_incident": 0,
                    "jobs_failed": 0,
                },
            )
            try:
                if command == "ping":
                    self._task_result(task_id, "completed", result={"pong": int(time.time())})
                elif command == "scan_now":
                    scan_kwargs: Dict[str, Any] = {"force_rescan": force_rescan}
                    if pattern_ids is not None:
                        scan_kwargs["pattern_ids"] = pattern_ids
                    if scan_extensions is not None:
                        scan_kwargs["scan_extensions"] = scan_extensions
                    stats = self.run_scan_once(scan_task_id=task_id, **scan_kwargs)
                    phase = str(stats.get("phase") or "").strip().lower()
                    if phase == "completed":
                        self._task_result(task_id, "completed", result=stats)
                    elif phase == "failed":
                        self._task_result(task_id, "failed", result=stats, error_text="OUTBOX_PERSISTENCE_FAILED")
                    else:
                        self._task_result(task_id, "acknowledged", result=stats)
                else:
                    self._task_result(task_id, "failed", error_text=f"Unsupported command: {command}")
            except Exception as exc:
                self._task_result(task_id, "failed", error_text=str(exc))

    def refresh_roots(self, force: bool = False) -> None:
        new_roots = list(_iter_target_roots(self.config.get("extra_roots", "")))
        if force or {_norm_path(path) for path in new_roots} != {_norm_path(path) for path in self._roots}:
            self._roots = new_roots
            if self._observer is not None:
                self._restart_watchdog()

    def _stop_watchdog(self) -> None:
        if self._observer is None:
            return
        try:
            self._observer.stop()
            self._observer.join(timeout=5)
        except Exception as exc:
            logging.warning("Watchdog stop failed: %s", exc)
        self._observer = None

    def _restart_watchdog(self) -> None:
        self._stop_watchdog()
        self._start_watchdog()

    def _start_watchdog(self) -> None:
        if not self.config.get("watchdog_enabled", True):
            return
        if Observer is None:
            logging.warning("watchdog is not installed; real-time mode disabled")
            return
        if not self._roots:
            return

        observer = Observer()
        handler = _PathEventHandler(self)
        watched = 0
        for root in self._roots:
            try:
                observer.schedule(handler, str(root), recursive=True)
                watched += 1
            except Exception as exc:
                logging.warning("Watchdog schedule failed for %s: %s", root, exc)
        if watched == 0:
            return
        observer.start()
        self._observer = observer
        logging.info("Watchdog started for %s roots", watched)

    def run_forever(self) -> None:
        self.refresh_roots(force=True)
        if self.config["run_scan_on_start"]:
            self.run_scan_once()
        self._start_watchdog()

        next_poll_ts = 0.0
        next_roots_refresh_ts = 0.0

        try:
            while True:
                now = time.time()

                if now >= next_poll_ts:
                    self.heartbeat()
                    self.poll_tasks()
                    self._outbox_prune_limits()
                    drained = self._drain_outbox(max_items=int(self.config.get("outbox_drain_batch", DEFAULT_OUTBOX_DRAIN_BATCH)))
                    if drained:
                        logging.info("Outbox drained on heartbeat cycle: sent=%s", drained)
                    poll_jitter = random.randint(0, int(self.config.get("poll_jitter_sec", 0) or 0))
                    next_poll_ts = now + self.config["poll_interval"] + poll_jitter

                if now >= next_roots_refresh_ts:
                    self.refresh_roots(force=False)
                    next_roots_refresh_ts = now + self.config["roots_refresh_sec"]

                summary = self.process_watchdog_queue(max_items=self.config["watchdog_batch_size"])
                if summary["scanned"] or summary["queued"] or summary["deferred"]:
                    logging.info(
                        "Watchdog batch: scanned=%s queued=%s skipped=%s deferred=%s",
                        summary["scanned"],
                        summary["queued"],
                        summary["skipped"],
                        summary["deferred"],
                    )
                    self._outbox_prune_limits()
                    drained = self._drain_outbox(max_items=int(self.config.get("outbox_drain_batch", DEFAULT_OUTBOX_DRAIN_BATCH)))
                    if drained:
                        logging.info("Outbox drained after watchdog batch: sent=%s", drained)

                if self._state_dirty and int(now) % 15 == 0:
                    self._persist_state()
                else:
                    self._write_status(force=False)

                time.sleep(1)
        finally:
            self._persist_state()
            self._write_status(force=True)
            self._stop_watchdog()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="IT-Invent Scan Agent")
    parser.add_argument("--once", action="store_true", help="Run one scan and exit")
    parser.add_argument("--heartbeat", action="store_true", help="Send heartbeat and exit")
    parser.add_argument("--no-watchdog", action="store_true", help="Disable watchdog for current run")
    return parser.parse_args()


def main() -> int:
    loaded_env_sources = bootstrap_env_from_files()
    setup_logging()
    args = parse_args()
    config = _read_env()
    if args.no_watchdog:
        config["watchdog_enabled"] = False
    logging.info(
        "Scan agent started, server=%s outbox_max_items=%s outbox_max_age_days=%s outbox_max_total_mb=%s",
        config["server_base"],
        config["outbox_max_items"],
        config["outbox_max_age_days"],
        config["outbox_max_total_mb"],
    )
    if loaded_env_sources:
        logging.info("Loaded .env sources for scan agent: %s", "; ".join(loaded_env_sources))

    if not str(config.get("api_key") or "").strip():
        logging.error("Scan agent API key is not configured. Set SCAN_AGENT_API_KEY explicitly.")
        return 1

    agent = ScanAgent(config)
    if not agent.pattern_defs:
        logging.warning("No strict patterns loaded; text/pdf-text files will be skipped until patterns file is fixed")
    if args.heartbeat:
        agent.heartbeat()
        return 0
    if args.once:
        stats = agent.run_scan_once()
        logging.info("One-shot scan done: %s", stats)
        return 0

    agent.run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
