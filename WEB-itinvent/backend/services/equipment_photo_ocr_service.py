"""Serial numbers read from equipment photos by the vision model ("подтверждено по фото").

Photos live in the legacy SQL Server FILES table; what the model read from each of them is
kept in PostgreSQL ``app.equipment_photo_ocr`` keyed by (db_id, item_id, file_no) with the
FILES.CREATE_DATE fingerprint (FILE_NO is reused after a delete, a result counts only while
the fingerprint still matches). The verdict against the *current* ITEMS.SERIAL_NO is computed
on read, so a corrected serial never keeps a stale verdict.

Cost control: nothing runs unless ``EQUIPMENT_PHOTO_OCR_ENABLED`` is true; batches are bounded
and serialised by one lock; photos of items without a serial are skipped (nothing to compare).
Image bytes, prompts and model answers are never logged. All LLM calls go through ``shared.llm``.

Verdicts of one photo against the item serial
    match            a read serial equals the item serial
    similar          differs by one character / look-alike letters (O-0, I-1, S-5 ...) - check by eye
    mismatch         labels were read but none resembles the item serial
    label_no_serial  a label is in frame but no serial was readable on it
    unreadable       a label is visible but cannot be read
    no_label         general view, no label
An item is "confirmed by photo" when any of its photos matches; "mismatch" is raised only
when no photo of the item matches or resembles the serial.
"""
from __future__ import annotations

import io
import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Optional

from sqlalchemy import delete, func, inspect, select
from sqlalchemy.exc import IntegrityError

from backend.appdb.db import app_session, is_app_database_configured
from backend.appdb.models import AppEquipmentPhotoOcr
from backend.database import equipment_photos
from backend.services import equipment_photo_check_service as checks
from shared.llm import openrouter_client
from shared.llm.env import read_env

logger = logging.getLogger(__name__)

ENABLED_ENV = "EQUIPMENT_PHOTO_OCR_ENABLED"
MODEL_ENV = "EQUIPMENT_PHOTO_OCR_MODEL"
DEFAULT_MODEL = "mistralai/mistral-small-3.2-24b-instruct"

IMAGE_MAX_EDGE_PX = 1600
IMAGE_JPEG_QUALITY = 85
LLM_TIMEOUT_SEC = 90
LLM_MAX_TOKENS = 400
RUN_DEFAULT_LIMIT = 100
RUN_MAX_LIMIT = 1000
RUN_WORKERS = 3
_PAGE_SIZE = 2000
_MAX_ITEM_IDS_PER_QUERY = 1000
_MAX_SERIALS_PER_PHOTO = 8
_MAX_SERIAL_LENGTH = 64

VERDICT_MATCH = "match"
VERDICT_SIMILAR = "similar"
VERDICT_MISMATCH = "mismatch"
# similar/mismatch on a photo a person has already checked ("проверено"): nothing left to look at.
VERDICT_REVIEWED = "reviewed"
VERDICT_LABEL_NO_SERIAL = "label_no_serial"
VERDICT_UNREADABLE = "unreadable"
VERDICT_NO_LABEL = "no_label"
VERDICT_ERROR = "error"
# Best first: an item takes the best verdict of its photos.
_VERDICT_ORDER = (
    VERDICT_MATCH, VERDICT_REVIEWED, VERDICT_SIMILAR, VERDICT_MISMATCH, VERDICT_LABEL_NO_SERIAL,
    VERDICT_UNREADABLE, VERDICT_NO_LABEL, VERDICT_ERROR,
)
PHOTO_TYPES = frozenset({"label", "general", "unreadable"})

_PLACEHOLDER_SERIALS = frozenset({"", "-", "--", "0", "n/a", "none", "б/н", "б.н", "нет", "без номера"})
# Cyrillic letters drawn like Latin ones; a serial typed with them still names the same device.
_CYRILLIC_TO_LATIN = str.maketrans("АВСЕКМНОРТХ", "ABCEKMHOPTX")
_FOLD = str.maketrans("OILZSB", "011258")

PROMPT = (
    "You inspect one photo of IT equipment for an inventory database.\n"
    "1) photo_type: 'label' if a manufacturer label/sticker/plate with printed identifiers is in "
    "frame and legible; 'general' if it is an overall view of the device or place without a legible "
    "label; 'unreadable' if a label is visible but cannot be read.\n"
    "2) serials: every serial-number candidate printed on a label (captions like S/N, SN, Serial, "
    "Service Tag, Серийный номер) with its caption. Copy characters exactly, do not guess. "
    "Model names, MAC addresses and part numbers (P/N) are NOT serials.\n"
    "Answer with JSON only: "
    '{"photo_type":"label|general|unreadable","serials":[{"value":"...","caption":"..."}],"confidence":0.0}'
)


class PhotoOcrUnavailableError(Exception):
    """The OCR store is not configured or its table does not exist yet."""


class PhotoOcrDisabledError(Exception):
    """The feature flag is off or the LLM provider is not configured."""


# ---- settings ---------------------------------------------------------------

def is_enabled() -> bool:
    return str(read_env(ENABLED_ENV, "") or "").strip().lower() in {"1", "true", "yes", "on"}


def configured_model() -> str:
    return str(read_env(MODEL_ENV, "") or "").strip() or DEFAULT_MODEL


def _can_analyze() -> bool:
    try:
        return is_enabled() and bool(openrouter_client.is_configured())
    except Exception:
        return False


# ---- verdict (pure) ---------------------------------------------------------

def normalize(value: Any) -> str:
    text = str(value or "").upper().translate(_CYRILLIC_TO_LATIN)
    return re.sub(r"[^0-9A-Z]", "", text)


def _fold(value: str) -> str:
    return normalize(value).translate(_FOLD)


def _edit1(a: str, b: str) -> bool:
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) <= 1
    short, long_ = (a, b) if len(a) < len(b) else (b, a)
    return any(long_[:i] + long_[i + 1:] == short for i in range(len(long_)))


def is_placeholder_serial(value: Any) -> bool:
    return str(value or "").strip().lower() in _PLACEHOLDER_SERIALS


def compute_verdict(db_serial: Any, photo_type: str, serials: Iterable[str]) -> str:
    """Verdict of ONE photo against the current item serial."""
    if photo_type == "general":
        return VERDICT_NO_LABEL
    if photo_type == "unreadable":
        return VERDICT_UNREADABLE
    if photo_type != "label":
        return VERDICT_ERROR
    expected = normalize(db_serial)
    values = [normalize(value) for value in serials if normalize(value)]
    if not values:
        return VERDICT_LABEL_NO_SERIAL
    if not expected:
        return VERDICT_MISMATCH
    if any(value == expected for value in values):
        return VERDICT_MATCH
    folded = _fold(expected)
    if any(_fold(value) == folded or _edit1(_fold(value), folded) for value in values):
        return VERDICT_SIMILAR
    # The model may glue the serial to a neighbouring code on the label.
    if len(expected) >= 6 and any(
        folded in _fold(value) or (len(value) >= 8 and _fold(value) in folded) for value in values
    ):
        return VERDICT_SIMILAR
    return VERDICT_MISMATCH


def apply_review(verdict: str, verified: bool) -> str:
    """A checked photo is no longer doubtful: similar/mismatch becomes ``reviewed``."""
    if verified and verdict in (VERDICT_SIMILAR, VERDICT_MISMATCH):
        return VERDICT_REVIEWED
    return verdict


def best_verdict(verdicts: Iterable[str]) -> Optional[str]:
    best: Optional[int] = None
    for verdict in verdicts:
        rank = _VERDICT_ORDER.index(verdict) if verdict in _VERDICT_ORDER else len(_VERDICT_ORDER)
        best = rank if best is None else min(best, rank)
    if best is None:
        return None
    return _VERDICT_ORDER[best] if best < len(_VERDICT_ORDER) else VERDICT_ERROR


def parse_model_answer(text: str) -> Optional[dict[str, Any]]:
    """Strict-enough parse of the model JSON; None when it is not usable."""
    match = re.search(r"\{.*\}", text or "", re.S)
    if not match:
        return None
    try:
        payload = json.loads(match.group(0))
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    photo_type = str(payload.get("photo_type") or "").strip().lower()
    if photo_type not in PHOTO_TYPES:
        return None
    serials: list[str] = []
    for entry in payload.get("serials") or []:
        raw = entry.get("value") if isinstance(entry, dict) else entry
        value = " ".join(str(raw or "").split())[:_MAX_SERIAL_LENGTH]
        if normalize(value) and value not in serials:
            serials.append(value)
        if len(serials) >= _MAX_SERIALS_PER_PHOTO:
            break
    return {"photo_type": photo_type, "serials": serials}


# ---- store ------------------------------------------------------------------

def _text(value: Any) -> str:
    return str(value or "").strip()


def _db_key(db_id: Any) -> str:
    return _text(db_id) or "default"


def _store_available(database_url: Optional[str]) -> bool:
    return bool(database_url) or is_app_database_configured()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


_table_lock = threading.Lock()
_table_state: dict[str, Any] = {"available": None, "checked_at": 0.0}
_TABLE_RECHECK_SEC = 60.0


def reset_table_probe() -> None:
    with _table_lock:
        _table_state["available"] = None
        _table_state["checked_at"] = 0.0


def table_available(session) -> bool:
    """True once the migration is applied (cached; a negative answer is re-probed)."""
    with _table_lock:
        available = _table_state["available"]
        if available is True:
            return True
        if available is False and time.monotonic() - float(_table_state["checked_at"]) < _TABLE_RECHECK_SEC:
            return False
    result = False
    try:
        table = AppEquipmentPhotoOcr.__table__
        connection = session.connection()
        schema = table.schema if connection.dialect.name == "postgresql" else None
        result = bool(inspect(connection).has_table(table.name, schema=schema))
    except Exception:
        logger.info("Equipment photo OCR table probe failed", exc_info=True)
    with _table_lock:
        _table_state["available"] = result
        _table_state["checked_at"] = time.monotonic()
    return result


def _decode_serials(raw: Any) -> list[str]:
    try:
        data = json.loads(raw or "[]")
    except ValueError:
        return []
    return [str(value) for value in data if str(value or "").strip()] if isinstance(data, list) else []


def _rows_for_items(session, db_id: Any, item_ids: list[int]) -> list[Any]:
    rows: list[Any] = []
    for offset in range(0, len(item_ids), _MAX_ITEM_IDS_PER_QUERY):
        chunk = item_ids[offset : offset + _MAX_ITEM_IDS_PER_QUERY]
        rows.extend(
            session.execute(
                select(
                    AppEquipmentPhotoOcr.item_id,
                    AppEquipmentPhotoOcr.file_no,
                    AppEquipmentPhotoOcr.file_created_at,
                    AppEquipmentPhotoOcr.photo_type,
                    AppEquipmentPhotoOcr.serials_json,
                ).where(
                    AppEquipmentPhotoOcr.db_id == _db_key(db_id),
                    AppEquipmentPhotoOcr.item_id.in_(chunk),
                )
            ).all()
        )
    return rows


def list_item_states(
    *, db_id: Any, item_id: int, database_url: Optional[str] = None
) -> Optional[dict[int, dict[str, Any]]]:
    """``{file_no: {file_created_at, photo_type, serials}}`` of one item; None when unavailable."""
    if not _store_available(database_url):
        return None
    try:
        with app_session(database_url) as session:
            if not table_available(session):
                return None
            rows = _rows_for_items(session, db_id, [int(item_id)])
            return {
                int(row.file_no): {
                    "file_created_at": _text(row.file_created_at),
                    "photo_type": _text(row.photo_type),
                    "serials": _decode_serials(row.serials_json),
                }
                for row in rows
            }
    except Exception:
        logger.info("Equipment photo OCR states unavailable (item_id=%s)", item_id, exc_info=True)
        return None


def describe_item_photos(
    *,
    db_id: Any,
    item_id: int,
    photos: list[dict[str, Any]],
    get_db_fn: Optional[Callable] = None,
    database_url: Optional[str] = None,
) -> dict[str, Any]:
    """OCR info for the photos panel: per-photo verdict + whether any photo confirms the serial."""
    states = list_item_states(db_id=db_id, item_id=item_id, database_url=database_url)
    if states is None:
        return {"available": False, "confirmed": False, "photos": {}}
    if not states:
        return {"available": True, "confirmed": False, "photos": {}}
    try:
        serial_no = item_serial(item_id, db_id, get_db_fn)
    except Exception:
        logger.info("Item serial lookup for photo OCR failed (item_id=%s)", item_id, exc_info=True)
        return {"available": False, "confirmed": False, "photos": {}}
    filled = not is_placeholder_serial(serial_no)
    marks = checks.list_states(db_id=db_id, item_id=item_id, database_url=database_url) or {}
    per_photo: dict[int, dict[str, Any]] = {}
    for photo in photos:
        state = states.get(int(photo["file_no"]))
        if not state or state["file_created_at"] != _text(photo.get("created_at")):
            continue
        verdict = ""
        if filled:
            verdict = apply_review(
                compute_verdict(serial_no, state["photo_type"], state["serials"]),
                checks.is_verified(marks.get(int(photo["file_no"])), _text(photo.get("created_at")))
                and not checks.is_rejected(marks.get(int(photo["file_no"])), _text(photo.get("created_at"))),
            )
        per_photo[int(photo["file_no"])] = {"verdict": verdict, "serials": state["serials"]}
    confirmed = any(info["verdict"] == VERDICT_MATCH for info in per_photo.values())
    return {"available": True, "confirmed": confirmed, "photos": per_photo}


def item_verdicts(
    *,
    db_id: Any,
    get_db_fn: Optional[Callable] = None,
    database_url: Optional[str] = None,
) -> Optional[dict[int, dict[str, Any]]]:
    """``{item_id: {verdict, serial_no, photo_serials}}`` over every analysed item.

    Photos that no longer exist (or were replaced: fingerprint differs) are ignored and the
    serial is the current ITEMS.SERIAL_NO. None when the store or FILES/ITEMS is unavailable.
    """
    if not _store_available(database_url):
        return None
    try:
        with app_session(database_url) as session:
            if not table_available(session):
                return None
            rows = session.execute(
                select(
                    AppEquipmentPhotoOcr.item_id,
                    AppEquipmentPhotoOcr.file_no,
                    AppEquipmentPhotoOcr.file_created_at,
                    AppEquipmentPhotoOcr.photo_type,
                    AppEquipmentPhotoOcr.serials_json,
                ).where(AppEquipmentPhotoOcr.db_id == _db_key(db_id))
            ).all()
        if not rows:
            return {}
        item_ids = sorted({int(row.item_id) for row in rows})
        fingerprints = equipment_photos.lookup_photo_fingerprints(item_ids, db_id, get_db_fn=get_db_fn)
        serials = _item_serials(item_ids, db_id, get_db_fn)
        # Unknown marks (None) must not hide a doubtful photo: treat as "nobody checked".
        verified = checks.list_verified_keys(item_ids, db_id, database_url=database_url) or set()
    except Exception:
        logger.info("Equipment photo OCR verdicts unavailable", exc_info=True)
        return None

    grouped: dict[int, list[str]] = {}
    photo_serials: dict[int, list[str]] = {}
    for row in rows:
        item_id = int(row.item_id)
        serial_no = serials.get(item_id)
        if serial_no is None or is_placeholder_serial(serial_no):
            continue
        if fingerprints.get((item_id, int(row.file_no))) != _text(row.file_created_at):
            continue
        values = _decode_serials(row.serials_json)
        verdict = compute_verdict(serial_no, _text(row.photo_type), values)
        is_checked = (item_id, int(row.file_no), _text(row.file_created_at)) in verified
        grouped.setdefault(item_id, []).append(apply_review(verdict, is_checked))
        for value in values:
            if value not in photo_serials.setdefault(item_id, []):
                photo_serials[item_id].append(value)
    return {
        item_id: {
            "verdict": best_verdict(verdicts) or VERDICT_ERROR,
            "serial_no": _text(serials.get(item_id)),
            "photo_serials": photo_serials.get(item_id, []),
        }
        for item_id, verdicts in grouped.items()
    }


def _item_serials(item_ids: list[int], db_id: Any, get_db_fn: Optional[Callable]) -> dict[int, str]:
    from backend.database import queries

    db = (get_db_fn or queries.get_db)(db_id)
    result: dict[int, str] = {}
    for offset in range(0, len(item_ids), _MAX_ITEM_IDS_PER_QUERY):
        chunk = item_ids[offset : offset + _MAX_ITEM_IDS_PER_QUERY]
        placeholders = ", ".join("?" for _ in chunk)
        rows = db.execute_query(
            f"SELECT ID AS item_id, SERIAL_NO AS serial_no FROM ITEMS WHERE CI_TYPE = 1 AND ID IN ({placeholders})",
            tuple(chunk),
        )
        for row in rows or []:
            result[int(row.get("item_id"))] = _text(row.get("serial_no"))
    return result


def item_serial(item_id: int, db_id: Any, get_db_fn: Optional[Callable] = None) -> str:
    return _item_serials([int(item_id)], db_id, get_db_fn).get(int(item_id), "")


def delete_photo_ocr(
    *, db_id: Any, item_id: int, file_no: int, database_url: Optional[str] = None
) -> None:
    """Drop the result of a deleted photo. Best effort."""
    if not _store_available(database_url):
        return
    try:
        with app_session(database_url) as session:
            if not table_available(session):
                return
            session.execute(
                delete(AppEquipmentPhotoOcr).where(
                    AppEquipmentPhotoOcr.db_id == _db_key(db_id),
                    AppEquipmentPhotoOcr.item_id == int(item_id),
                    AppEquipmentPhotoOcr.file_no == int(file_no),
                )
            )
    except Exception:
        logger.info("Failed to drop equipment photo OCR row", exc_info=True)


# ---- analysis ---------------------------------------------------------------

def _prepare_image(blob: bytes) -> Optional[bytes]:
    try:
        from PIL import Image, ImageOps

        with Image.open(io.BytesIO(blob)) as img:
            img = ImageOps.exif_transpose(img).convert("RGB")
            img.thumbnail((IMAGE_MAX_EDGE_PX, IMAGE_MAX_EDGE_PX))
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=IMAGE_JPEG_QUALITY)
            return out.getvalue()
    except Exception:
        return None


def _fetch_blob(db, item_id: int, file_no: int) -> Optional[bytes]:
    rows = db.execute_query(
        "SELECT TOP 1 FILE_DATA AS blob_data FROM FILES WHERE ITEM_ID = ? AND FILE_NO = ? AND FILE_TYPE = 0",
        (int(item_id), int(file_no)),
    )
    blob = rows[0].get("blob_data") if rows else None
    return bytes(blob) if blob is not None else None


def _store_result(
    *, db_id: Any, item_id: int, file_no: int, fingerprint: str, parsed: dict[str, Any],
    model: str, tokens_in: int, tokens_out: int, database_url: Optional[str],
) -> None:
    for attempt in range(2):
        try:
            with app_session(database_url) as session:
                if not table_available(session):
                    raise PhotoOcrUnavailableError("photo OCR table is not migrated yet")
                row = session.scalar(
                    select(AppEquipmentPhotoOcr).where(
                        AppEquipmentPhotoOcr.db_id == _db_key(db_id),
                        AppEquipmentPhotoOcr.item_id == int(item_id),
                        AppEquipmentPhotoOcr.file_no == int(file_no),
                    )
                )
                if row is None:
                    row = AppEquipmentPhotoOcr(
                        db_id=_db_key(db_id), item_id=int(item_id), file_no=int(file_no)
                    )
                    session.add(row)
                row.file_created_at = fingerprint[:64]
                row.photo_type = parsed["photo_type"]
                row.serials_json = json.dumps(parsed["serials"], ensure_ascii=False)
                row.model = model[:128]
                row.tokens_in = int(tokens_in)
                row.tokens_out = int(tokens_out)
                row.analyzed_at = _utc_now()
            return
        except IntegrityError:
            if attempt == 1:
                raise PhotoOcrUnavailableError("photo OCR store unavailable")
    raise PhotoOcrUnavailableError("photo OCR store unavailable")


def analyze_photo(
    *,
    db_id: Any,
    item_id: int,
    file_no: int,
    get_db_fn: Optional[Callable] = None,
    database_url: Optional[str] = None,
) -> dict[str, Any]:
    """Read the serial candidates of one photo and store them.

    Returns ``{"status": "analyzed" | "no_serial" | "not_found" | "unreadable_image" | "unparsed", ...}``;
    raises ``PhotoOcrDisabledError`` / ``PhotoOcrUnavailableError`` / the provider error.
    The database is not held while the model is called.
    """
    if not _can_analyze():
        raise PhotoOcrDisabledError("photo OCR is disabled")
    if not _store_available(database_url):
        raise PhotoOcrUnavailableError("photo OCR store is not configured")
    from backend.database import queries

    meta = equipment_photos.get_equipment_photo_meta(item_id, file_no, db_id, get_db_fn=get_db_fn)
    if meta is None:
        return {"status": "not_found"}
    db = (get_db_fn or queries.get_db)(db_id)
    # Nothing to compare with: do not pay for a photo of an item without a serial.
    if is_placeholder_serial(item_serial(item_id, db_id, get_db_fn)):
        return {"status": "no_serial"}
    blob = _fetch_blob(db, item_id, file_no)
    image = _prepare_image(blob) if blob else None
    if not image:
        return {"status": "unreadable_image"}

    model = configured_model()
    text, usage = openrouter_client.complete_vision(
        image_bytes=image, mime_type="image/jpeg", prompt=PROMPT, system_prompt="",
        model=model, purpose="ocr", temperature=0.0, max_tokens=LLM_MAX_TOKENS,
        timeout=LLM_TIMEOUT_SEC,
    )
    tokens_in = int((usage or {}).get("prompt_tokens") or 0)
    tokens_out = int((usage or {}).get("completion_tokens") or 0)
    parsed = parse_model_answer(text)
    if parsed is None:
        # Stored as "error" so a photo the model cannot answer is not paid for again every run.
        parsed = {"photo_type": VERDICT_ERROR, "serials": []}
    _store_result(
        db_id=db_id, item_id=item_id, file_no=file_no, fingerprint=_text(meta["created_at"]),
        parsed=parsed, model=model, tokens_in=tokens_in, tokens_out=tokens_out,
        database_url=database_url,
    )
    return {
        "status": "analyzed" if parsed["photo_type"] != VERDICT_ERROR else "unparsed",
        "photo_type": parsed["photo_type"],
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }


def analyze_photo_safe(**kwargs: Any) -> None:
    """Fire-and-forget after an upload: never raises, never blocks the upload response."""
    try:
        if _can_analyze():
            analyze_photo(**kwargs)
    except Exception:
        logger.warning("Equipment photo OCR failed (item_id=%s)", kwargs.get("item_id"), exc_info=True)


# ---- batch ------------------------------------------------------------------

_run_lock = threading.Lock()
_run_state: dict[str, Any] = {
    "running": False, "started_at": None, "finished_at": None,
    "planned": 0, "done": 0, "errors": 0, "tokens_in": 0, "tokens_out": 0,
}


def run_state() -> dict[str, Any]:
    return dict(_run_state)


def ensure_ready(database_url: Optional[str] = None) -> None:
    """Raise unless a batch can run now: flag on, provider configured, table migrated."""
    if not _can_analyze():
        raise PhotoOcrDisabledError("photo OCR is disabled")
    if not _store_available(database_url):
        raise PhotoOcrUnavailableError("photo OCR store is not configured")
    try:
        with app_session(database_url) as session:
            ready = table_available(session)
    except Exception as exc:
        raise PhotoOcrUnavailableError("photo OCR store unavailable") from exc
    if not ready:
        raise PhotoOcrUnavailableError("photo OCR table is not migrated yet")


def _serial_filled_sql() -> str:
    from backend.services import equipment_quality_service as quality

    return quality.serial_filled_sql("i")


def _analysed_keys(db_id: Any, database_url: Optional[str]) -> set[tuple[int, int, str]]:
    with app_session(database_url) as session:
        if not table_available(session):
            raise PhotoOcrUnavailableError("photo OCR table is not migrated yet")
        rows = session.execute(
            select(
                AppEquipmentPhotoOcr.item_id,
                AppEquipmentPhotoOcr.file_no,
                AppEquipmentPhotoOcr.file_created_at,
            ).where(AppEquipmentPhotoOcr.db_id == _db_key(db_id))
        ).all()
    return {(int(r.item_id), int(r.file_no), _text(r.file_created_at)) for r in rows}


def pending_photos(
    *, db_id: Any, limit: int, get_db_fn: Optional[Callable] = None, database_url: Optional[str] = None
) -> list[tuple[int, int]]:
    """Newest photos of items with a serial that have no current OCR result yet."""
    from backend.database import queries

    done = _analysed_keys(db_id, database_url)
    db = (get_db_fn or queries.get_db)(db_id)
    found: list[tuple[int, int]] = []
    offset = 0
    while len(found) < limit:
        rows = db.execute_query(
            f"""
            SELECT f.ITEM_ID AS item_id, f.FILE_NO AS file_no, f.CREATE_DATE AS created_at
            FROM FILES f
            INNER JOIN ITEMS i ON i.ID = f.ITEM_ID AND i.CI_TYPE = f.CI_TYPE
            WHERE f.FILE_TYPE = 0 AND i.CI_TYPE = 1 AND {_serial_filled_sql()}
            ORDER BY f.CREATE_DATE DESC, f.FILE_NO DESC
            OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
            """,
            (offset, _PAGE_SIZE),
        ) or []
        for row in rows:
            key = (int(row.get("item_id")), int(row.get("file_no")), _text(row.get("created_at")))
            if key not in done:
                found.append((key[0], key[1]))
                if len(found) >= limit:
                    break
        if len(rows) < _PAGE_SIZE:
            break
        offset += _PAGE_SIZE
    return found


def run_batch(
    *,
    db_id: Any,
    limit: int = RUN_DEFAULT_LIMIT,
    get_db_fn: Optional[Callable] = None,
    database_url: Optional[str] = None,
) -> dict[str, Any]:
    """Analyse up to ``limit`` pending photos. One run at a time per process; safe to re-run."""
    if not _can_analyze():
        raise PhotoOcrDisabledError("photo OCR is disabled")
    if not _store_available(database_url):
        raise PhotoOcrUnavailableError("photo OCR store is not configured")
    safe_limit = max(1, min(int(limit or RUN_DEFAULT_LIMIT), RUN_MAX_LIMIT))
    if not _run_lock.acquire(blocking=False):
        return {"started": False, "reason": "already_running", **run_state()}
    try:
        _run_state.update(
            running=True, started_at=_utc_now().isoformat(timespec="seconds"), finished_at=None,
            planned=0, done=0, errors=0, tokens_in=0, tokens_out=0,
        )
        todo = pending_photos(db_id=db_id, limit=safe_limit, get_db_fn=get_db_fn, database_url=database_url)
        _run_state["planned"] = len(todo)

        counters = threading.Lock()

        def bump(**delta: int) -> None:
            with counters:
                for name, value in delta.items():
                    _run_state[name] += value

        def work(key: tuple[int, int]) -> None:
            try:
                result = analyze_photo(
                    db_id=db_id, item_id=key[0], file_no=key[1],
                    get_db_fn=get_db_fn, database_url=database_url,
                )
                bump(
                    tokens_in=int(result.get("tokens_in") or 0),
                    tokens_out=int(result.get("tokens_out") or 0),
                    errors=0 if result.get("status") in ("analyzed", "not_found", "no_serial") else 1,
                )
            except Exception:
                bump(errors=1)
                logger.warning("Equipment photo OCR batch item failed", exc_info=True)
            finally:
                bump(done=1)

        with ThreadPoolExecutor(max_workers=RUN_WORKERS) as pool:
            list(pool.map(work, todo))
        return {"started": True, "reason": "", **run_state(), "running": False}
    finally:
        _run_state.update(running=False, finished_at=_utc_now().isoformat(timespec="seconds"))
        _run_lock.release()


def run_batch_safe(**kwargs: Any) -> None:
    """Background entry point: a failed run is logged, never raised into the worker."""
    try:
        result = run_batch(**kwargs)
        logger.info(
            "Equipment photo OCR batch finished: started=%s planned=%s done=%s errors=%s tokens=%s/%s",
            result.get("started"), result.get("planned"), result.get("done"), result.get("errors"),
            result.get("tokens_in"), result.get("tokens_out"),
        )
    except Exception:
        logger.warning("Equipment photo OCR batch failed", exc_info=True)


def summary(
    *, db_id: Any, get_db_fn: Optional[Callable] = None, database_url: Optional[str] = None
) -> dict[str, Any]:
    """Coverage and item verdict counters for the quality panel."""
    from backend.database import queries

    payload: dict[str, Any] = {
        "enabled": is_enabled(),
        "configured": _can_analyze(),
        "store_available": False,
        "model": configured_model(),
        "photos_total": None,
        "analyzed": 0,
        "pending": None,
        "items_confirmed": 0,
        "items_similar": 0,
        "items_mismatch": 0,
        "run": run_state(),
    }
    if not _store_available(database_url):
        return payload
    try:
        with app_session(database_url) as session:
            if not table_available(session):
                return payload
            payload["store_available"] = True
            payload["analyzed"] = int(
                session.scalar(
                    select(func.count()).select_from(AppEquipmentPhotoOcr).where(
                        AppEquipmentPhotoOcr.db_id == _db_key(db_id)
                    )
                )
                or 0
            )
    except Exception:
        logger.info("Equipment photo OCR summary unavailable", exc_info=True)
        return payload
    try:
        db = (get_db_fn or queries.get_db)(db_id)
        rows = db.execute_query(
            f"""
            SELECT COUNT(1) AS c FROM FILES f
            INNER JOIN ITEMS i ON i.ID = f.ITEM_ID AND i.CI_TYPE = f.CI_TYPE
            WHERE f.FILE_TYPE = 0 AND i.CI_TYPE = 1 AND {_serial_filled_sql()}
            """,
            (),
        )
        total = int((rows[0].get("c") if rows else 0) or 0)
        payload["photos_total"] = total
        payload["pending"] = max(total - payload["analyzed"], 0)
    except Exception:
        logger.info("Equipment photo OCR totals unavailable", exc_info=True)
    verdicts = item_verdicts(db_id=db_id, get_db_fn=get_db_fn, database_url=database_url)
    for info in (verdicts or {}).values():
        if info["verdict"] == VERDICT_MATCH:
            payload["items_confirmed"] += 1
        elif info["verdict"] == VERDICT_SIMILAR:
            payload["items_similar"] += 1
        elif info["verdict"] == VERDICT_MISMATCH:
            payload["items_mismatch"] += 1
    return payload
