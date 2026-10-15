"""
Equipment photo attachments stored in the legacy ITINVENT FILES table.

Photos live as FILES rows with FILE_TYPE = 0 linked to the equipment item by
(CI_TYPE, ITEM_ID) — the same layout the native IT-Инвент desktop client uses,
so uploads from the web UI are visible there and vice versa.
"""
import io
import logging
from typing import Any, Callable, Iterable, List, Optional

from backend.database.connection import get_db as _default_get_db

logger = logging.getLogger(__name__)

GetDbFn = Callable[[Optional[str]], Any]

FILE_TYPE_PHOTO = 0
ALLOWED_PHOTO_MIME_TYPES = frozenset({
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/bmp",
})
# IT-Инвент stores FILE_SIZE in megabytes (float); keep the same unit.
MAX_PHOTO_BYTES = 15 * 1024 * 1024
# Oversized originals are downscaled before FILE_DATA to keep the DB compact.
ORIG_MAX_EDGE_PX = 2560
ORIG_JPEG_QUALITY = 90
# Thumbnail written to FILE_SMALL_IMAGE_DATA (native client preview).
THUMB_MAX_EDGE_PX = 320
THUMB_JPEG_QUALITY = 82
# Same SQL Server parameter bound as equipment_current_act_reads.
_MAX_ITEM_IDS_PER_QUERY = 1800


class EquipmentPhotoError(Exception):
    """Base error for equipment photo operations."""


class EquipmentNotFoundError(EquipmentPhotoError):
    """Raised when the target equipment row does not exist."""


class PhotoValidationError(EquipmentPhotoError):
    """Raised when an uploaded file fails validation."""


def _get_db(db_id: Optional[str], get_db_fn: Optional[GetDbFn]) -> Any:
    return (get_db_fn or _default_get_db)(db_id)


def _normalize_int(value: Any, name: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        raise PhotoValidationError(f"invalid {name}")


def resolve_equipment_ci_type(
    item_id: Any,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[GetDbFn] = None,
) -> Optional[int]:
    """Return ITEMS.CI_TYPE for the equipment row or None when missing."""
    normalized_id = _normalize_int(item_id, "item_id")
    db = _get_db(db_id, get_db_fn)
    rows = db.execute_query(
        "SELECT TOP 1 CI_TYPE FROM ITEMS WHERE ID = ?",
        (normalized_id,),
    )
    if not rows:
        return None
    try:
        return int(rows[0].get("CI_TYPE"))
    except (TypeError, ValueError):
        return None


def list_equipment_photos(
    item_id: Any,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[GetDbFn] = None,
) -> List[dict]:
    """List photo metadata for an equipment card (no BLOB columns)."""
    normalized_id = _normalize_int(item_id, "item_id")
    ci_type = resolve_equipment_ci_type(normalized_id, db_id, get_db_fn=get_db_fn)
    if ci_type is None:
        raise EquipmentNotFoundError("equipment not found")
    db = _get_db(db_id, get_db_fn)
    rows = db.execute_query(
        """
        SELECT FILE_NO, FILE_NAME, FILE_DESCR, FILE_SIZE, CREATE_DATE, CREATE_USER,
               CASE WHEN FILE_SMALL_IMAGE_DATA IS NULL THEN 0 ELSE 1 END AS has_thumb
        FROM FILES
        WHERE FILE_TYPE = 0 AND CI_TYPE = ? AND ITEM_ID = ?
        ORDER BY CREATE_DATE DESC, FILE_NO DESC
        """,
        (ci_type, normalized_id),
    )
    items: List[dict] = []
    for row in rows or []:
        items.append({
            "file_no": int(row.get("FILE_NO") or 0),
            "file_name": str(row.get("FILE_NAME") or ""),
            "description": str(row.get("FILE_DESCR") or ""),
            "size_mb": float(row.get("FILE_SIZE") or 0.0),
            "has_thumb": bool(row.get("has_thumb")),
            "created_at": str(row.get("CREATE_DATE") or ""),
            "created_by": str(row.get("CREATE_USER") or ""),
        })
    return items


def lookup_equipment_photo_counts(
    item_ids: Iterable[Any],
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[GetDbFn] = None,
) -> Optional[dict[int, int]]:
    """Return ``{item_id: photo_count}`` for items that have at least one photo.

    Set-based and BLOB-free, chunked per SQL Server parameter limit. Items
    without photos are simply absent. Returns ``None`` on lookup failure so
    callers can report "unknown" instead of a confirmed "no photo".

    FILES also holds act scans (FILE_TYPE = 1, ITEM_ID = DOC_NO), so rows are
    restricted to FILE_TYPE = 0 and joined to ITEMS on the same CI_TYPE.
    """
    normalized_ids: list[int] = []
    seen_ids: set[int] = set()
    for raw in item_ids or []:
        try:
            item_id = int(raw)
        except (TypeError, ValueError):
            continue
        if item_id not in seen_ids:
            seen_ids.add(item_id)
            normalized_ids.append(item_id)
    if not normalized_ids:
        return {}

    counts: dict[int, int] = {}
    try:
        db = _get_db(db_id, get_db_fn)
        for offset in range(0, len(normalized_ids), _MAX_ITEM_IDS_PER_QUERY):
            chunk = normalized_ids[offset : offset + _MAX_ITEM_IDS_PER_QUERY]
            placeholders = ", ".join("?" for _ in chunk)
            rows = db.execute_query(
                f"""
                SELECT f.ITEM_ID AS item_id, COUNT(*) AS photo_count
                FROM FILES f
                INNER JOIN ITEMS i
                    ON i.ID = f.ITEM_ID
                   AND i.CI_TYPE = f.CI_TYPE
                WHERE f.FILE_TYPE = {FILE_TYPE_PHOTO}
                  AND f.ITEM_ID IN ({placeholders})
                GROUP BY f.ITEM_ID
                """,
                tuple(chunk),
            )
            for row in rows or []:
                try:
                    counts[int(row.get("item_id"))] = int(row.get("photo_count") or 0)
                except (TypeError, ValueError):
                    continue
    except Exception:
        logger.warning(
            "Equipment photo count lookup failed for db_id=%s item_count=%s",
            db_id,
            len(normalized_ids),
            exc_info=True,
        )
        return None
    return counts


def get_equipment_photo(
    file_no: Any,
    db_id: Optional[str] = None,
    *,
    item_id: Any = None,
    thumb: bool = False,
    get_db_fn: Optional[GetDbFn] = None,
) -> Optional[dict]:
    """Return photo bytes for a FILES row; thumb=True prefers the small image."""
    normalized_file_no = _normalize_int(file_no, "file_no")
    db = _get_db(db_id, get_db_fn)
    params: list = [normalized_file_no]
    scope = ""
    if item_id is not None:
        scope = " AND ITEM_ID = ?"
        params.append(_normalize_int(item_id, "item_id"))
    data_col = "FILE_SMALL_IMAGE_DATA" if thumb else "FILE_DATA"
    rows = db.execute_query(
        f"""
        SELECT TOP 1 FILE_NAME, FILE_DESCR, {data_col} AS blob_data
        FROM FILES
        WHERE FILE_NO = ? AND FILE_TYPE = 0{scope}
        """,
        tuple(params),
    )
    if not rows:
        return None
    row = rows[0]
    blob = row.get("blob_data")
    # Fall back to the full image when no thumbnail was generated.
    if thumb and blob is None:
        rows = db.execute_query(
            "SELECT TOP 1 FILE_DATA AS blob_data FROM FILES WHERE FILE_NO = ? AND FILE_TYPE = 0" + scope,
            tuple(params),
        )
        blob = rows[0].get("blob_data") if rows else None
    return {
        "file_name": str(row.get("FILE_NAME") or f"photo_{normalized_file_no}.jpg"),
        "description": str(row.get("FILE_DESCR") or ""),
        "data": bytes(blob) if blob is not None else None,
    }


def _sniff_image_mime(data: bytes) -> Optional[str]:
    head = data[:16]
    if head.startswith(b"\xFF\xD8\xFF"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if head.startswith(b"BM"):
        return "image/bmp"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def _downscale_full_image(file_bytes: bytes) -> Optional[bytes]:
    """Re-encode oversized originals as JPEG <= ORIG_MAX_EDGE_PX; None if kept as-is."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return None
    try:
        with Image.open(io.BytesIO(file_bytes)) as img:
            if max(img.size) <= ORIG_MAX_EDGE_PX:
                return None
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGB")
            img.thumbnail((ORIG_MAX_EDGE_PX, ORIG_MAX_EDGE_PX))
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=ORIG_JPEG_QUALITY)
            shrunk = out.getvalue()
            return shrunk if len(shrunk) < len(file_bytes) else None
    except Exception:
        logger.warning("Photo downscale failed; storing original bytes", exc_info=True)
        return None


def _build_thumbnail(file_bytes: bytes) -> Optional[bytes]:
    """JPEG thumbnail for FILES.FILE_SMALL_IMAGE_DATA; None when Pillow fails."""
    try:
        from PIL import Image
    except ImportError:
        logger.warning("Pillow unavailable; photo thumbnail not generated")
        return None
    try:
        with Image.open(io.BytesIO(file_bytes)) as img:
            img = img.convert("RGB")
            img.thumbnail((THUMB_MAX_EDGE_PX, THUMB_MAX_EDGE_PX))
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=THUMB_JPEG_QUALITY)
            return out.getvalue()
    except Exception:
        logger.warning("Photo thumbnail generation failed", exc_info=True)
        return None


def get_equipment_photo_meta(
    item_id: Any,
    file_no: Any,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[GetDbFn] = None,
) -> Optional[dict]:
    """Return FILES metadata (no BLOBs) of one photo of the item, or None."""
    normalized_id = _normalize_int(item_id, "item_id")
    normalized_file_no = _normalize_int(file_no, "file_no")
    db = _get_db(db_id, get_db_fn)
    rows = db.execute_query(
        """
        SELECT FILE_NO, CREATE_DATE, CREATE_USER
        FROM FILES
        WHERE FILE_TYPE = 0 AND ITEM_ID = ? AND FILE_NO = ?
        """,
        (normalized_id, normalized_file_no),
    )
    if not rows:
        return None
    row = rows[0]
    return {
        "file_no": int(row.get("FILE_NO") or 0),
        "created_at": str(row.get("CREATE_DATE") or ""),
        "created_by": str(row.get("CREATE_USER") or ""),
    }


def lookup_photo_fingerprints(
    item_ids: Iterable[Any],
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[GetDbFn] = None,
) -> dict[tuple[int, int], str]:
    """Return ``{(item_id, file_no): str(CREATE_DATE)}`` for photo rows of the items.

    Raises on lookup failure; callers treat that as "unknown".
    """
    ids = sorted({int(value) for value in item_ids or []})
    result: dict[tuple[int, int], str] = {}
    if not ids:
        return result
    db = _get_db(db_id, get_db_fn)
    for offset in range(0, len(ids), _MAX_ITEM_IDS_PER_QUERY):
        chunk = ids[offset : offset + _MAX_ITEM_IDS_PER_QUERY]
        placeholders = ", ".join("?" for _ in chunk)
        rows = db.execute_query(
            f"""
            SELECT ITEM_ID, FILE_NO, CREATE_DATE
            FROM FILES
            WHERE FILE_TYPE = {FILE_TYPE_PHOTO} AND ITEM_ID IN ({placeholders})
            """,
            tuple(chunk),
        )
        for row in rows or []:
            result[(int(row.get("ITEM_ID")), int(row.get("FILE_NO")))] = str(row.get("CREATE_DATE") or "")
    return result


def insert_equipment_photo(
    *,
    item_id: Any,
    file_name: str,
    file_bytes: bytes,
    created_by: str,
    description: str = "",
    mime_type: Optional[str] = None,
    db_id: Optional[str] = None,
    get_db_fn: Optional[GetDbFn] = None,
) -> dict:
    """Insert a photo row into FILES and return its identifiers."""
    normalized_id = _normalize_int(item_id, "item_id")
    ci_type = resolve_equipment_ci_type(normalized_id, db_id, get_db_fn=get_db_fn)
    if ci_type is None:
        raise EquipmentNotFoundError("equipment not found")

    data = bytes(file_bytes or b"")
    if not data:
        raise PhotoValidationError("file is empty")
    if len(data) > MAX_PHOTO_BYTES:
        raise PhotoValidationError("file exceeds the size limit")

    sniffed = _sniff_image_mime(data)
    declared = str(mime_type or "").strip().lower()
    effective_mime = sniffed or (declared if declared in ALLOWED_PHOTO_MIME_TYPES else None)
    if effective_mime is None:
        raise PhotoValidationError("unsupported image type")

    safe_name = str(file_name or "").strip() or f"photo_{normalized_id}.jpg"
    if len(safe_name) > 255:
        safe_name = safe_name[:255]
    safe_descr = str(description or "").strip()[:255]
    downscaled = _downscale_full_image(data)
    if downscaled is not None:
        data = downscaled
        stem = safe_name.rsplit(".", 1)[0]
        safe_name = f"{stem}.jpg"[:255]
    thumb = _build_thumbnail(data)
    size_mb = round(len(data) / (1024.0 * 1024.0), 2)

    db = _get_db(db_id, get_db_fn)
    with db.get_connection() as conn:
        cursor = conn.cursor()
        # Locked MAX+1 — same counter convention as the act file inserts.
        cursor.execute(
            "SELECT ISNULL(MAX(FILE_NO), 0) + 1 FROM FILES WITH (TABLOCKX, HOLDLOCK)"
        )
        file_no = int(cursor.fetchone()[0])
        cursor.execute(
            """
            INSERT INTO FILES (
                FILE_NO, CI_TYPE, ITEM_ID, FILE_TYPE, FILE_NAME, FILE_SIZE,
                FILE_DESCR, FILE_DATA, FILE_SMALL_IMAGE_DATA, CREATE_DATE, CREATE_USER
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), ?)
            """,
            (
                file_no,
                ci_type,
                normalized_id,
                FILE_TYPE_PHOTO,
                safe_name,
                size_mb,
                safe_descr,
                data,
                thumb,
                str(created_by or "")[:64],
            ),
        )
    return {"file_no": file_no, "ci_type": ci_type, "item_id": normalized_id}


ROTATE_DEGREES = frozenset({90, 180, 270})


def _rotate_image_bytes(data: bytes, file_name: str, degrees: int) -> tuple[bytes, str]:
    """Rotate clockwise by ``degrees``; returns (bytes, file name with a matching extension)."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        raise PhotoValidationError("image processing is unavailable")
    try:
        with Image.open(io.BytesIO(data)) as img:
            if getattr(img, "n_frames", 1) > 1:
                raise PhotoValidationError("animated images cannot be rotated")
            keep_png = img.format == "PNG"
            img = ImageOps.exif_transpose(img)
            # PIL rotates counter-clockwise.
            img = img.rotate(-degrees, expand=True)
            out = io.BytesIO()
            if keep_png:
                img.save(out, format="PNG", optimize=True)
                extension = ".png"
            else:
                img.convert("RGB").save(out, format="JPEG", quality=ORIG_JPEG_QUALITY)
                extension = ".jpg"
    except PhotoValidationError:
        raise
    except Exception as exc:
        logger.warning("Photo rotation failed", exc_info=True)
        raise PhotoValidationError("image cannot be rotated") from exc
    stem, dot, current = str(file_name or "").rpartition(".")
    if not dot:
        stem, current = str(file_name or ""), ""
    keeps_name = current.lower() in (("png",) if extension == ".png" else ("jpg", "jpeg"))
    new_name = file_name if keeps_name and file_name else f"{stem or 'photo'}{extension}"
    return out.getvalue(), new_name[:255]


def rotate_equipment_photo(
    *,
    item_id: Any,
    file_no: Any,
    degrees: Any,
    db_id: Optional[str] = None,
    get_db_fn: Optional[GetDbFn] = None,
) -> Optional[dict]:
    """Rotate a stored photo (and its thumbnail) in place; None when the photo is missing.

    CREATE_DATE / CREATE_USER are left untouched so verification marks stay valid.
    The row is read under UPDLOCK, so two concurrent rotations apply one after another.
    """
    normalized_id = _normalize_int(item_id, "item_id")
    normalized_file_no = _normalize_int(file_no, "file_no")
    angle = _normalize_int(degrees, "degrees") % 360
    if angle not in ROTATE_DEGREES:
        raise PhotoValidationError("degrees must be 90, 180 or 270")
    db = _get_db(db_id, get_db_fn)
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT FILE_DATA, FILE_NAME
            FROM FILES WITH (UPDLOCK, ROWLOCK)
            WHERE FILE_NO = ? AND FILE_TYPE = 0 AND ITEM_ID = ?
            """,
            (normalized_file_no, normalized_id),
        )
        row = cursor.fetchone()
        if row is None or row[0] is None:
            return None
        rotated, new_name = _rotate_image_bytes(bytes(row[0]), str(row[1] or ""), angle)
        thumb = _build_thumbnail(rotated)
        size_mb = round(len(rotated) / (1024.0 * 1024.0), 2)
        cursor.execute(
            """
            UPDATE FILES
            SET FILE_DATA = ?, FILE_SMALL_IMAGE_DATA = ?, FILE_SIZE = ?, FILE_NAME = ?
            WHERE FILE_NO = ? AND FILE_TYPE = 0 AND ITEM_ID = ?
            """,
            (rotated, thumb, size_mb, new_name, normalized_file_no, normalized_id),
        )
    return {
        "file_no": normalized_file_no,
        "file_name": new_name,
        "size_mb": size_mb,
        "has_thumb": thumb is not None,
    }


def delete_equipment_photo(
    *,
    item_id: Any,
    file_no: Any,
    db_id: Optional[str] = None,
    get_db_fn: Optional[GetDbFn] = None,
) -> bool:
    """Delete a photo row; returns True when a row was removed."""
    normalized_id = _normalize_int(item_id, "item_id")
    normalized_file_no = _normalize_int(file_no, "file_no")
    db = _get_db(db_id, get_db_fn)
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            DELETE FROM FILES
            WHERE FILE_NO = ? AND FILE_TYPE = 0 AND ITEM_ID = ?
            """,
            (normalized_file_no, normalized_id),
        )
        return cursor.rowcount > 0
