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

# Numeric fast-path: INV_NO is numeric in ITINVENT (new numbers come from
# MAX(CAST(INV_NO AS INT)) + 1), so an all-digit term is an inventory number —
# index seek instead of a scan. Non-digit terms can never match INV_NO.
QUERY_SEARCH_BY_INV_NO = QUERY_SEARCH_BY_SERIAL.replace(
    "(i.SERIAL_NO LIKE ?\n       OR i.HW_SERIAL_NO LIKE ?\n       OR i.PART_NO LIKE ?)",
    "i.INV_NO = ?",
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
        t.TYPE_NAME as type_name,
        m.MODEL_NAME as model_name,
        v.VENDOR_NAME as vendor_name,
        s.DESCR as status_name,
        o.OWNER_DISPLAY_NAME as employee_name,
        o.OWNER_DEPT as employee_dept,
        b.BRANCH_NAME as branch_name,
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
       OR CAST(i.INV_NO AS VARCHAR(50)) LIKE ?
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
       OR CAST(i.INV_NO AS VARCHAR(50)) LIKE ?
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

QUERY_SEARCH_UNIVERSAL_BY_INV_NO = QUERY_SEARCH_UNIVERSAL.replace(
    "(i.SERIAL_NO LIKE ?",
    "(i.INV_NO = ?",
).replace(
    "       OR i.HW_SERIAL_NO LIKE ?"
    "\n       OR CAST(i.INV_NO AS VARCHAR(50)) LIKE ?"
    "\n       OR i.PART_NO LIKE ?"
    "\n       OR m.MODEL_NAME LIKE ?"
    "\n       OR v.VENDOR_NAME LIKE ?"
    "\n       OR o.OWNER_DISPLAY_NAME LIKE ?"
    "\n       OR o.OWNER_DEPT LIKE ?"
    "\n       OR b.BRANCH_NAME LIKE ?"
    "\n       OR l.DESCR LIKE ?"
    "\n       OR t.TYPE_NAME LIKE ?"
    "\n       OR s.DESCR LIKE ?"
    "\n       OR i.IP_ADDRESS LIKE ?"
    "\n       OR i.MAC_ADDRESS LIKE ?"
    "\n       OR i.NETBIOS_NAME LIKE ?"
    "\n       OR i.DOMAIN_NAME LIKE ?)",
    ")",
)

QUERY_COUNT_UNIVERSAL_BY_INV_NO = """
    SELECT COUNT(*) as total
    FROM ITEMS i
    WHERE i.CI_TYPE = 1 AND i.INV_NO = ?
"""


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
        return db.execute_query(
            QUERY_SEARCH_BY_INV_NO.format(limit=int(limit)),
            (int(term),),
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
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> dict:
    """
    Universal search across all equipment fields.

    Real pagination: OFFSET/FETCH page, separate COUNT for total/pages.
    All-digit terms take the INV_NO equality fast-path.
    """
    import logging
    logger = logging.getLogger(__name__)

    term = str(search_term or "").strip()
    page = max(1, int(page or 1))
    limit = max(1, int(limit or 50))
    offset = (page - 1) * limit

    if term.isdigit():
        count_query = QUERY_COUNT_UNIVERSAL_BY_INV_NO
        count_params = (int(term),)
        select_query = QUERY_SEARCH_UNIVERSAL_BY_INV_NO
        select_params = (int(term), offset, limit)
    else:
        pattern = f"%{term}%"
        count_query = QUERY_COUNT_UNIVERSAL
        count_params = (pattern,) * 16
        select_query = QUERY_SEARCH_UNIVERSAL
        select_params = (pattern,) * 16 + (offset, limit)

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
        equipment = []
        total = 0

    return {
        "equipment": equipment,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit if total else 0,
    }
