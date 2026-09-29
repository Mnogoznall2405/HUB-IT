"""
Read-only equipment search queries for SQL Server inventory data.
"""
from typing import Any, Callable, List, Optional

from backend.database.connection import get_db as _default_get_db


QUERY_SEARCH_BY_SERIAL = """
    SELECT TOP {limit}
        i.INV_NO,
        i.SERIAL_NO,
        i.HW_SERIAL_NO,
        i.PART_NO,
        t.TYPE_NO as type_no,
        t.TYPE_NAME as type_name,
        m.MODEL_NO as model_no,
        m.MODEL_NAME as model_name,
        v.VENDOR_NO as vendor_no,
        v.VENDOR_NAME as vendor_name,
        s.STATUS_NO as status_no,
        s.DESCR as status_name,
        o.OWNER_NO as empl_no,
        o.OWNER_DISPLAY_NAME as employee_name,
        o.OWNER_DEPT as employee_dept,
        b.BRANCH_NO as branch_no,
        b.BRANCH_NAME as branch_name,
        l.LOC_NO as loc_no,
        l.DESCR as location_name
    FROM ITEMS i
    LEFT JOIN CI_TYPES t ON i.CI_TYPE = t.CI_TYPE AND i.TYPE_NO = t.TYPE_NO
    LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
    LEFT JOIN VENDORS v ON m.VENDOR_NO = v.VENDOR_NO
    LEFT JOIN STATUS s ON i.STATUS_NO = s.STATUS_NO
    LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
    LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
    LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
    WHERE i.CI_TYPE = 1 AND (i.SERIAL_NO LIKE ?
       OR i.HW_SERIAL_NO LIKE ?
       OR i.PART_NO LIKE ?)
    ORDER BY i.INV_NO
""".format(limit="{limit}")

# Numeric path: INV_NO is numeric in ITINVENT so an all-digit term gets the
# INV_NO index seek — but all-digit serials exist too (e.g. Xerox
# "3718936461"), so serial/hw_serial/part LIKE must also run for digit terms.
QUERY_SEARCH_BY_DIGIT = QUERY_SEARCH_BY_SERIAL.replace(
    "(i.SERIAL_NO LIKE ?\n       OR i.HW_SERIAL_NO LIKE ?\n       OR i.PART_NO LIKE ?)",
    "(i.INV_NO = ?\n       OR CAST(TRY_CAST(i.INV_NO AS BIGINT) AS VARCHAR(50)) LIKE ?"
    "\n       OR i.SERIAL_NO LIKE ?\n       OR i.HW_SERIAL_NO LIKE ?\n       OR i.PART_NO LIKE ?)",
)

QUERY_SEARCH_UNIVERSAL = """
    SELECT
        i.ID as id,
        i.INV_NO as inv_no,
        i.SERIAL_NO as serial_no,
        i.HW_SERIAL_NO as hw_serial_no,
        i.PART_NO as part_no,
        i.IP_ADDRESS as ip_address,
        i.MAC_ADDRESS as mac_address,
        i.NETBIOS_NAME as network_name,
        i.DOMAIN_NAME as domain_name,
        t.TYPE_NO as type_no,
        t.TYPE_NAME as type_name,
        m.MODEL_NO as model_no,
        m.MODEL_NAME as model_name,
        m.VENDOR_NO as vendor_no,
        v.VENDOR_NAME as vendor_name,
        s.STATUS_NO as status_no,
        s.DESCR as status_name,
        o.OWNER_NO as empl_no,
        o.OWNER_DISPLAY_NAME as employee_name,
        o.OWNER_DEPT as employee_dept,
        b.BRANCH_NO as branch_no,
        b.BRANCH_NAME as branch_name,
        l.LOC_NO as loc_no,
        l.DESCR as location_name
    FROM ITEMS i
    LEFT JOIN CI_TYPES t ON i.CI_TYPE = t.CI_TYPE AND i.TYPE_NO = t.TYPE_NO
    LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
    LEFT JOIN VENDORS v ON m.VENDOR_NO = v.VENDOR_NO
    LEFT JOIN STATUS s ON i.STATUS_NO = s.STATUS_NO
    LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
    LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
    LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
    WHERE i.CI_TYPE = 1 AND (i.SERIAL_NO LIKE ?
       OR i.HW_SERIAL_NO LIKE ?
       OR CAST(TRY_CAST(i.INV_NO AS BIGINT) AS VARCHAR(50)) LIKE ?
       OR i.PART_NO LIKE ?
       OR m.MODEL_NAME LIKE ?
       OR v.VENDOR_NAME LIKE ?
       OR o.OWNER_DISPLAY_NAME LIKE ?
       OR o.OWNER_DEPT LIKE ?
       OR b.BRANCH_NAME LIKE ?
       OR l.DESCR LIKE ?
       OR t.TYPE_NAME LIKE ?
       OR s.DESCR LIKE ?
       OR i.IP_ADDRESS LIKE ?
       OR i.MAC_ADDRESS LIKE ?
       OR i.NETBIOS_NAME LIKE ?
       OR i.DOMAIN_NAME LIKE ?)
    ORDER BY i.INV_NO
    OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
"""

QUERY_COUNT_UNIVERSAL = """
    SELECT COUNT(*) as total
    FROM ITEMS i
    LEFT JOIN CI_TYPES t ON i.CI_TYPE = t.CI_TYPE AND i.TYPE_NO = t.TYPE_NO
    LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
    LEFT JOIN VENDORS v ON m.VENDOR_NO = v.VENDOR_NO
    LEFT JOIN STATUS s ON i.STATUS_NO = s.STATUS_NO
    LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
    LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
    LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
    WHERE i.CI_TYPE = 1 AND (i.SERIAL_NO LIKE ?
       OR i.HW_SERIAL_NO LIKE ?
       OR CAST(TRY_CAST(i.INV_NO AS BIGINT) AS VARCHAR(50)) LIKE ?
       OR i.PART_NO LIKE ?
       OR m.MODEL_NAME LIKE ?
       OR v.VENDOR_NAME LIKE ?
       OR o.OWNER_DISPLAY_NAME LIKE ?
       OR o.OWNER_DEPT LIKE ?
       OR b.BRANCH_NAME LIKE ?
       OR l.DESCR LIKE ?
       OR t.TYPE_NAME LIKE ?
       OR s.DESCR LIKE ?
       OR i.IP_ADDRESS LIKE ?
       OR i.MAC_ADDRESS LIKE ?
       OR i.NETBIOS_NAME LIKE ?
       OR i.DOMAIN_NAME LIKE ?)
"""

# Digit terms: INV_NO exact match (index seek) + partial inv/serial matching —
# digit serials and partial inventory numbers must not be swallowed by a pure
# INV_NO = ? fast-path.
_UNIVERSAL_LIKE_BLOCK = """(i.SERIAL_NO LIKE ?
       OR i.HW_SERIAL_NO LIKE ?
       OR CAST(TRY_CAST(i.INV_NO AS BIGINT) AS VARCHAR(50)) LIKE ?
       OR i.PART_NO LIKE ?
       OR m.MODEL_NAME LIKE ?
       OR v.VENDOR_NAME LIKE ?
       OR o.OWNER_DISPLAY_NAME LIKE ?
       OR o.OWNER_DEPT LIKE ?
       OR b.BRANCH_NAME LIKE ?
       OR l.DESCR LIKE ?
       OR t.TYPE_NAME LIKE ?
       OR s.DESCR LIKE ?
       OR i.IP_ADDRESS LIKE ?
       OR i.MAC_ADDRESS LIKE ?
       OR i.NETBIOS_NAME LIKE ?
       OR i.DOMAIN_NAME LIKE ?)"""

# Digit terms still get the INV_NO equality seek first, but then run the FULL
# universal LIKE set — model names like "OptiPlex 3070" or "DL380" contain
# digits, so an all-digit term must keep hitting every text column.
_UNIVERSAL_DIGIT_BLOCK = "(i.INV_NO = ?\n       OR " + _UNIVERSAL_LIKE_BLOCK[1:]

QUERY_SEARCH_UNIVERSAL_BY_DIGIT = QUERY_SEARCH_UNIVERSAL.replace(
    _UNIVERSAL_LIKE_BLOCK,
    _UNIVERSAL_DIGIT_BLOCK,
)
assert _UNIVERSAL_LIKE_BLOCK in QUERY_SEARCH_UNIVERSAL, "universal LIKE block not found"
assert "OFFSET ? ROWS FETCH NEXT ? ROWS ONLY" in QUERY_SEARCH_UNIVERSAL_BY_DIGIT

QUERY_COUNT_UNIVERSAL_BY_DIGIT = QUERY_COUNT_UNIVERSAL.replace(
    _UNIVERSAL_LIKE_BLOCK,
    _UNIVERSAL_DIGIT_BLOCK,
)
assert _UNIVERSAL_LIKE_BLOCK in QUERY_COUNT_UNIVERSAL, "count LIKE block not found"

# Type-only listing: a selected type with an empty term returns all equipment
# of that type (paged), so the picker doubles as a full type filter.
QUERY_SEARCH_UNIVERSAL_BY_TYPE = QUERY_SEARCH_UNIVERSAL.replace(
    _UNIVERSAL_LIKE_BLOCK,
    "i.TYPE_NO = ?",
)
QUERY_COUNT_UNIVERSAL_BY_TYPE = QUERY_COUNT_UNIVERSAL.replace(
    _UNIVERSAL_LIKE_BLOCK,
    "i.TYPE_NO = ?",
)

# Optional type filter applied to term searches: injects "i.TYPE_NO = ?" ahead
# of the term predicate — the type param is prepended to the params tuple.
def _apply_type_filter(query: str) -> str:
    return query.replace(
        "WHERE i.CI_TYPE = 1 AND ",
        "WHERE i.CI_TYPE = 1 AND i.TYPE_NO = ? AND ",
        1,
    )

# Single-field search scope for the universal bar ("искать только по …").
# Values are full WHERE fragments with ? placeholders — an allowlist, never
# raw column interpolation from the client.
_SEARCH_FIELD_SQL = {
    "serial": "(i.SERIAL_NO LIKE ? OR i.HW_SERIAL_NO LIKE ?)",
    "model": "m.MODEL_NAME LIKE ?",
    "inv_no": "CAST(TRY_CAST(i.INV_NO AS BIGINT) AS VARCHAR(50)) LIKE ?",
    "part_no": "i.PART_NO LIKE ?",
    "employee": "(o.OWNER_DISPLAY_NAME LIKE ? OR o.OWNER_DEPT LIKE ?)",
    "branch": "b.BRANCH_NAME LIKE ?",
    "location": "l.DESCR LIKE ?",
    "status": "s.DESCR LIKE ?",
    "vendor": "v.VENDOR_NAME LIKE ?",
    "type": "t.TYPE_NAME LIKE ?",
    "ip": "i.IP_ADDRESS LIKE ?",
    "mac": "i.MAC_ADDRESS LIKE ?",
    "netbios": "(i.NETBIOS_NAME LIKE ? OR i.DOMAIN_NAME LIKE ?)",
}
# INV_NO gets the numeric index seek on top of partial text matching.
_SEARCH_FIELD_SQL_DIGIT_INV = "(i.INV_NO = ? OR CAST(TRY_CAST(i.INV_NO AS BIGINT) AS VARCHAR(50)) LIKE ?)"


def _get_db(db_id: Optional[str], get_db_fn: Optional[Callable[[Optional[str]], Any]]) -> Any:
    return (get_db_fn or _default_get_db)(db_id)


def search_equipment_by_serial(
    search_term: str,
    db_id: Optional[str] = None,
    *,
    limit: int = 200,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> List[dict]:
    """
    Search equipment by serial number, hardware serial, or inventory number.
    """
    db = _get_db(db_id, get_db_fn)
    term = str(search_term or "").strip()
    if term.isdigit():
        pattern = f"%{term}%"
        return db.execute_query(
            QUERY_SEARCH_BY_DIGIT.format(limit=int(limit)),
            (int(term), pattern, pattern, pattern, pattern),
        )
    pattern = f"%{term}%"
    return db.execute_query(
        QUERY_SEARCH_BY_SERIAL.format(limit=int(limit)),
        (pattern, pattern, pattern),
    )


def search_equipment_universal(
    search_term: str,
    page: int = 1,
    limit: int = 50,
    db_id: Optional[str] = None,
    *,
    type_no: Optional[int] = None,
    field: Optional[str] = None,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> dict:
    """
    Universal search across all equipment fields.

    Real pagination: OFFSET/FETCH page, separate COUNT for total/pages.
    All-digit terms take the INV_NO equality fast-path.
    type_no scopes results to a CI_TYPES entry; with an empty term it lists
    the whole type (paged). field scopes the term to a single column.
    """
    import logging
    logger = logging.getLogger(__name__)

    term = str(search_term or "").strip()
    page = max(1, int(page or 1))
    limit = max(1, int(limit or 50))
    offset = (page - 1) * limit

    type_no_int = None
    if type_no is not None and str(type_no).strip() != "":
        type_no_int = int(type_no)

    field_key = str(field or "").strip().lower()
    field_sql = _SEARCH_FIELD_SQL.get(field_key) or None

    if type_no_int is not None and not term:
        count_query = QUERY_COUNT_UNIVERSAL_BY_TYPE
        count_params = (type_no_int,)
        select_query = QUERY_SEARCH_UNIVERSAL_BY_TYPE
        select_params = (type_no_int, offset, limit)
    elif field_sql and term:
        pattern = f"%{term}%"
        if field_key == "inv_no" and term.isdigit():
            field_pred = _SEARCH_FIELD_SQL_DIGIT_INV
            field_params = (int(term), pattern)
        else:
            field_pred = field_sql
            field_params = (pattern,) * field_pred.count("?")
        count_query = QUERY_COUNT_UNIVERSAL.replace(_UNIVERSAL_LIKE_BLOCK, field_pred)
        count_params = field_params
        select_query = QUERY_SEARCH_UNIVERSAL.replace(_UNIVERSAL_LIKE_BLOCK, field_pred)
        select_params = field_params + (offset, limit)
    elif term.isdigit():
        pattern = f"%{term}%"
        count_query = QUERY_COUNT_UNIVERSAL_BY_DIGIT
        count_params = (int(term),) + (pattern,) * 16
        select_query = QUERY_SEARCH_UNIVERSAL_BY_DIGIT
        select_params = (int(term),) + (pattern,) * 16 + (offset, limit)
    else:
        pattern = f"%{term}%"
        count_query = QUERY_COUNT_UNIVERSAL
        count_params = (pattern,) * 16
        select_query = QUERY_SEARCH_UNIVERSAL
        select_params = (pattern,) * 16 + (offset, limit)

    if type_no_int is not None and term:
        count_query = _apply_type_filter(count_query)
        count_params = (type_no_int,) + count_params
        select_query = _apply_type_filter(select_query)
        select_params = (type_no_int,) + select_params

    # Errors must propagate: a swallowed failure returned HTTP 200 with an
    # empty list, which the UI rendered as "nothing found" instead of the
    # degraded CloudOff signal. The frontend falls back on a real error.
    try:
        # A non-default get_db_fn is a test seam — skip the shared cache there.
        if get_db_fn is None or get_db_fn is _default_get_db:
            from backend.database import equipment_db as _equipment_db
            total = _equipment_db._get_cached_equipment_total(
                "universal_search", db_id, count_query, count_params,
            )
        else:
            count_rows = _get_db(db_id, get_db_fn).execute_query(count_query, count_params)
            total = int(count_rows[0].get("total") or 0) if count_rows else 0

        equipment = (
            _get_db(db_id, get_db_fn).execute_query(select_query, select_params)
            if total else []
        )
    except Exception as e:
        logger.error(f"Search error: {e}")
        raise

    return {
        "equipment": equipment,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit if total else 0,
    }
