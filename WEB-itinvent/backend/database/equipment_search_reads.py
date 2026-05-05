"""
Read-only equipment search queries for SQL Server inventory data.
"""
from typing import Any, Callable, List, Optional

from backend.database.connection import get_db as _default_get_db


QUERY_SEARCH_BY_SERIAL = """
    SELECT
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
       OR CAST(i.INV_NO AS VARCHAR(50)) LIKE ?)
    ORDER BY i.INV_NO
"""

QUERY_SEARCH_UNIVERSAL = """
    SELECT TOP {limit}
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
""".format(limit="{limit}")


def _get_db(db_id: Optional[str], get_db_fn: Optional[Callable[[Optional[str]], Any]]) -> Any:
    return (get_db_fn or _default_get_db)(db_id)


def search_equipment_by_serial(
    search_term: str,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> List[dict]:
    """
    Search equipment by serial number, hardware serial, or inventory number.
    """
    db = _get_db(db_id, get_db_fn)
    pattern = f"%{search_term}%"
    return db.execute_query(QUERY_SEARCH_BY_SERIAL, (pattern, pattern, pattern))


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

    Current compatibility contract ignores page, uses TOP {limit}, and reports
    total as the returned row count.
    """
    import logging
    logger = logging.getLogger(__name__)

    db = _get_db(db_id, get_db_fn)
    pattern = f"%{search_term}%"

    query = QUERY_SEARCH_UNIVERSAL.format(limit=limit)
    logger.info(f"Universal search: term='{search_term}', limit={limit}")
    logger.info(f"Query: {query[:200]}...")

    try:
        equipment = db.execute_query(query, (pattern,) * 15)
        logger.info(f"Found {len(equipment)} results")
        total = len(equipment)
    except Exception as e:
        logger.error(f"Search error: {e}")
        equipment = []
        total = 0

    return {
        "equipment": equipment,
        "total": total,
        "page": 1,
        "pages": 1,
    }
