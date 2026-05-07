"""
Equipment database functions using correct schema with dynamic database switching.
"""
from typing import List, Dict, Any, Optional
import logging
import os
import time
from threading import RLock

from backend.database.connection import get_db

logger = logging.getLogger(__name__)

# SQL Queries (moved from queries_new.py)
QUERY_GET_ALL_EQUIPMENT = """
    SELECT
        i.ID,
        i.INV_NO,
        i.SERIAL_NO,
        i.HW_SERIAL_NO,
        i.PART_NO,
        i.DESCR as description,
        i.IP_ADDRESS,
        t.TYPE_NAME as type_name,
        m.MODEL_NAME as model_name,
        v.VENDOR_NAME as vendor_name,
        s.DESCR as status,
        o.OWNER_NO as empl_no,
        o.OWNER_DISPLAY_NAME as employee_name,
        o.OWNER_DEPT as employee_dept,
        b.BRANCH_NO as branch_no,
        b.BRANCH_NAME as branch_name,
        l.LOC_NO as loc_no,
        l.DESCR as location
    FROM ITEMS i
    LEFT JOIN CI_TYPES t ON i.CI_TYPE = t.CI_TYPE AND i.TYPE_NO = t.TYPE_NO
    LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
    LEFT JOIN VENDORS v ON m.VENDOR_NO = v.VENDOR_NO
    LEFT JOIN STATUS s ON i.STATUS_NO = s.STATUS_NO
    LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
    LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
    LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
    WHERE i.CI_TYPE = 1
    ORDER BY b.BRANCH_NAME, l.DESCR, i.INV_NO
    OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
"""

QUERY_COUNT_ALL_EQUIPMENT = """
    SELECT COUNT(*) as total
    FROM ITEMS i
    WHERE i.CI_TYPE = 1
"""

QUERY_COUNT_ALL_CONSUMABLES = """
    SELECT COUNT(*) as total
    FROM ITEMS i
    WHERE i.CI_TYPE = 4
"""

QUERY_GET_ALL_BRANCHES = """
    SELECT DISTINCT
        b.BRANCH_NO,
        b.BRANCH_NAME
    FROM BRANCHES b
    WHERE b.BRANCH_NAME IS NOT NULL
    ORDER BY b.BRANCH_NAME
"""

QUERY_GET_ALL_LOCATIONS = """
    SELECT
        l.LOC_NO as LOC_NO,
        l.DESCR as LOC_NAME
    FROM LOCATIONS l
    WHERE l.LOC_NO IS NOT NULL
    ORDER BY l.DESCR, l.LOC_NO
"""

QUERY_GET_EQUIPMENT_GROUPED = """
    SELECT
        i.ID,
        i.TYPE_NO as type_no,
        i.MODEL_NO as model_no,
        i.STATUS_NO as status_no,
        i.EMPL_NO as empl_no,
        i.BRANCH_NO as branch_no,
        i.LOC_NO as loc_no,
        b.BRANCH_NAME as branch_name,
        l.DESCR as location,
        i.INV_NO,
        i.SERIAL_NO,
        i.HW_SERIAL_NO,
        i.PART_NO as part_no,
        i.QTY as qty,
        i.IP_ADDRESS as ip_address,
        i.MAC_ADDRESS as mac_address,
        i.NETBIOS_NAME as network_name,
        i.DOMAIN_NAME as domain_name,
        i.DESCR as DESCRIPTION,
        t.TYPE_NAME as type_name,
        m.MODEL_NAME as model_name,
        v.VENDOR_NAME as manufacturer,
        o.OWNER_DISPLAY_NAME as employee_name,
        o.OWNER_DEPT as employee_dept,
        s.DESCR as status
    FROM ITEMS i
    LEFT JOIN CI_TYPES t ON i.CI_TYPE = t.CI_TYPE AND i.TYPE_NO = t.TYPE_NO
    LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
    LEFT JOIN VENDORS v ON m.VENDOR_NO = v.VENDOR_NO
    LEFT JOIN STATUS s ON i.STATUS_NO = s.STATUS_NO
    LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
    LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
    LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
    WHERE i.CI_TYPE = 1
    ORDER BY b.BRANCH_NAME, l.DESCR, i.INV_NO
    OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
"""

QUERY_GET_EQUIPMENT_GROUPED_ALL = """
    SELECT
        i.ID,
        i.TYPE_NO as type_no,
        i.MODEL_NO as model_no,
        i.STATUS_NO as status_no,
        i.EMPL_NO as empl_no,
        i.BRANCH_NO as branch_no,
        i.LOC_NO as loc_no,
        b.BRANCH_NAME as branch_name,
        l.DESCR as location,
        i.INV_NO,
        i.SERIAL_NO,
        i.HW_SERIAL_NO,
        i.PART_NO as part_no,
        i.QTY as qty,
        i.IP_ADDRESS as ip_address,
        i.MAC_ADDRESS as mac_address,
        i.NETBIOS_NAME as network_name,
        i.DOMAIN_NAME as domain_name,
        i.DESCR as DESCRIPTION,
        t.TYPE_NAME as type_name,
        m.MODEL_NAME as model_name,
        v.VENDOR_NAME as manufacturer,
        o.OWNER_DISPLAY_NAME as employee_name,
        o.OWNER_DEPT as employee_dept,
        s.DESCR as status
    FROM ITEMS i
    LEFT JOIN CI_TYPES t ON i.CI_TYPE = t.CI_TYPE AND i.TYPE_NO = t.TYPE_NO
    LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
    LEFT JOIN VENDORS v ON m.VENDOR_NO = v.VENDOR_NO
    LEFT JOIN STATUS s ON i.STATUS_NO = s.STATUS_NO
    LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
    LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
    LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
    WHERE i.CI_TYPE = 1
    ORDER BY b.BRANCH_NAME, l.DESCR, i.INV_NO
"""

QUERY_GET_CONSUMABLES_GROUPED = """
    SELECT
        i.ID,
        i.TYPE_NO as type_no,
        i.MODEL_NO as model_no,
        i.STATUS_NO as status_no,
        i.EMPL_NO as empl_no,
        i.BRANCH_NO as branch_no,
        i.LOC_NO as loc_no,
        b.BRANCH_NAME as branch_name,
        l.DESCR as location,
        i.INV_NO,
        i.SERIAL_NO,
        i.HW_SERIAL_NO,
        i.PART_NO as part_no,
        i.QTY as qty,
        i.IP_ADDRESS as ip_address,
        i.MAC_ADDRESS as mac_address,
        i.NETBIOS_NAME as network_name,
        i.DOMAIN_NAME as domain_name,
        i.DESCR as DESCRIPTION,
        t.TYPE_NAME as type_name,
        m.MODEL_NAME as model_name,
        v.VENDOR_NAME as manufacturer,
        o.OWNER_DISPLAY_NAME as employee_name,
        o.OWNER_DEPT as employee_dept,
        s.DESCR as status
    FROM ITEMS i
    LEFT JOIN CI_TYPES t ON i.CI_TYPE = t.CI_TYPE AND i.TYPE_NO = t.TYPE_NO
    LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
    LEFT JOIN VENDORS v ON m.VENDOR_NO = v.VENDOR_NO
    LEFT JOIN STATUS s ON i.STATUS_NO = s.STATUS_NO
    LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
    LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
    LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
    WHERE i.CI_TYPE = 4
    ORDER BY b.BRANCH_NAME, l.DESCR, i.INV_NO
    OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
"""

QUERY_GET_EQUIPMENT_BY_BRANCH = """
    SELECT
        i.ID,
        i.INV_NO,
        i.SERIAL_NO,
        i.HW_SERIAL_NO,
        i.PART_NO,
        i.DESCR as description,
        i.IP_ADDRESS,
        t.TYPE_NAME as type_name,
        m.MODEL_NAME as model_name,
        v.VENDOR_NAME as vendor_name,
        s.DESCR as status,
        o.OWNER_NO as empl_no,
        o.OWNER_DISPLAY_NAME as employee_name,
        o.OWNER_DEPT as employee_dept,
        b.BRANCH_NO as branch_no,
        b.BRANCH_NAME as branch_name,
        l.LOC_NO as loc_no,
        l.DESCR as location
    FROM ITEMS i
    LEFT JOIN CI_TYPES t ON i.CI_TYPE = t.CI_TYPE AND i.TYPE_NO = t.TYPE_NO
    LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
    LEFT JOIN VENDORS v ON m.VENDOR_NO = v.VENDOR_NO
    LEFT JOIN STATUS s ON i.STATUS_NO = s.STATUS_NO
    LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
    LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
    LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
    WHERE i.CI_TYPE = 1 AND b.BRANCH_NAME = ?
    ORDER BY l.DESCR, i.INV_NO
    OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
"""

QUERY_COUNT_BY_BRANCH = """
    SELECT COUNT(*) as total
    FROM ITEMS i
    LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
    WHERE i.CI_TYPE = 1 AND b.BRANCH_NAME = ?
"""

QUERY_GET_ALL_EQUIPMENT_TYPES = """
    SELECT
        t.CI_TYPE,
        t.TYPE_NO,
        t.TYPE_NAME
    FROM CI_TYPES t
    WHERE t.CI_TYPE IS NOT NULL AND t.TYPE_NO IS NOT NULL
    ORDER BY t.TYPE_NAME
"""
_equipment_payload_cache: Dict[str, Dict[str, Any]] = {}
_equipment_payload_cache_lock = RLock()
_EQUIPMENT_PAYLOAD_CACHE_TTL_SEC = max(10, int(os.getenv("EQUIPMENT_PAYLOAD_CACHE_TTL_SEC", "30")))


def _build_equipment_cache_key(kind: str, db_id: Optional[str], *parts: Any) -> str:
    normalized_parts = [kind, str(db_id or "").strip()]
    normalized_parts.extend(str(part) for part in parts)
    return "|".join(normalized_parts)


def _get_cached_equipment_payload(cache_key: str) -> Optional[Any]:
    with _equipment_payload_cache_lock:
        cached = _equipment_payload_cache.get(cache_key)
        if not cached:
            return None
        if (time.monotonic() - float(cached.get("ts") or 0)) >= _EQUIPMENT_PAYLOAD_CACHE_TTL_SEC:
            _equipment_payload_cache.pop(cache_key, None)
            return None
        return cached.get("data")


def _set_cached_equipment_payload(cache_key: str, payload: Any) -> Any:
    with _equipment_payload_cache_lock:
        _equipment_payload_cache[cache_key] = {
            "ts": time.monotonic(),
            "data": payload,
        }
    return payload


def invalidate_equipment_cache(db_id: Optional[str] = None) -> None:
    prefix = f"|{str(db_id or '').strip()}|"
    with _equipment_payload_cache_lock:
        if db_id is None:
            _equipment_payload_cache.clear()
            return
        for cache_key in list(_equipment_payload_cache.keys()):
            if prefix in cache_key:
                _equipment_payload_cache.pop(cache_key, None)


def _group_rows_by_branch_location(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """Group flat rows by branch and location."""
    grouped: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
    for item in rows or []:
        branch = item.get('branch_name') or 'Не указан'
        location = item.get('location') or 'Не указано'

        if branch not in grouped:
            grouped[branch] = {}
        if location not in grouped[branch]:
            grouped[branch][location] = []

        grouped[branch][location].append(item)

    return grouped


def get_all_equipment(page: int = 1, limit: int = 50, db_id: Optional[str] = None) -> Dict[str, Any]:
    """Get all equipment with pagination."""
    db = get_db(db_id)
    offset = (page - 1) * limit

    count_result = db.execute_query(QUERY_COUNT_ALL_EQUIPMENT, ())
    total = count_result[0]['total'] if count_result else 0

    equipment = db.execute_query(
        QUERY_GET_ALL_EQUIPMENT,
        (offset, limit)
    )

    return {
        'equipment': equipment,
        'total': total,
        'page': page,
        'limit': limit,
        'pages': (total + limit - 1) // limit
    }


def get_equipment_by_branch(branch_name: str, page: int = 1, limit: int = 10000, db_id: Optional[str] = None) -> Dict[str, Any]:
    """Get equipment filtered by branch."""
    logger.info(f"Getting equipment for branch: {branch_name}, db_id: {db_id}")
    try:
        db = get_db(db_id)
        logger.info(f"Database connection established: {db.get_current_database()}")
        offset = (page - 1) * limit

        count_result = db.execute_query(QUERY_COUNT_BY_BRANCH, (branch_name,))
        total = count_result[0]['total'] if count_result else 0

        equipment = db.execute_query(
            QUERY_GET_EQUIPMENT_BY_BRANCH,
            (branch_name, offset, limit)
        )

        logger.info(f"Found {total} equipment items for branch {branch_name}")

        return {
            'equipment': equipment,
            'total': total,
            'page': page,
            'limit': limit,
            'pages': (total + limit - 1) // limit,
            'branch': branch_name
        }
    except Exception as e:
        logger.error(f"Error getting equipment by branch: {e}", exc_info=True)
        raise


def get_all_branches(db_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get all branches."""
    db = get_db(db_id)
    return db.execute_query(QUERY_GET_ALL_BRANCHES, ())


def get_locations_by_branch(branch_no: int, db_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Legacy compatibility wrapper that preserves global LOCATIONS with branch priority."""
    from backend.database import queries
    return queries.get_all_locations(db_id=db_id, branch_no=branch_no)


def get_all_equipment_types(db_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get all equipment types."""
    db = get_db(db_id)
    return db.execute_query(QUERY_GET_ALL_EQUIPMENT_TYPES, ())


def get_equipment_grouped(page: int = 1, limit: int = 100, db_id: Optional[str] = None) -> Dict[str, Any]:
    """Get equipment grouped by branch and location (simplified fields)."""
    cache_key = _build_equipment_cache_key("equipment_grouped", db_id, page, limit)
    cached_payload = _get_cached_equipment_payload(cache_key)
    if cached_payload is not None:
        return cached_payload

    db = get_db(db_id)
    offset = (page - 1) * limit

    count_result = db.execute_query(QUERY_COUNT_ALL_EQUIPMENT, ())
    total = count_result[0]['total'] if count_result else 0

    equipment = db.execute_query(
        QUERY_GET_EQUIPMENT_GROUPED,
        (offset, limit)
    )

    grouped = _group_rows_by_branch_location(equipment)

    return _set_cached_equipment_payload(cache_key, {
        'grouped': grouped,
        'total': total,
        'page': page,
        'limit': limit,
        'pages': (total + limit - 1) // limit
    })


def get_all_equipment_flat(db_id: Optional[str] = None, limit: int = 10000) -> List[Dict[str, Any]]:
    """Fetch all CI_TYPE=1 equipment in a single query without pagination.

    Returns flat list of rows (not grouped). Use this instead of paginated
    get_equipment_grouped when you need the full dataset in one round-trip.
    """
    cache_key = _build_equipment_cache_key("equipment_flat", db_id, limit)
    cached_payload = _get_cached_equipment_payload(cache_key)
    if cached_payload is not None:
        return cached_payload

    db = get_db(db_id)
    rows = db.execute_query(QUERY_GET_EQUIPMENT_GROUPED_ALL, ())
    return _set_cached_equipment_payload(cache_key, (rows or [])[:limit])


def get_consumables_grouped(page: int = 1, limit: int = 100, db_id: Optional[str] = None) -> Dict[str, Any]:
    """Get consumables (CI_TYPE=4) grouped by branch and location."""
    cache_key = _build_equipment_cache_key("consumables_grouped", db_id, page, limit)
    cached_payload = _get_cached_equipment_payload(cache_key)
    if cached_payload is not None:
        return cached_payload

    db = get_db(db_id)
    offset = (page - 1) * limit

    count_result = db.execute_query(QUERY_COUNT_ALL_CONSUMABLES, ())
    total = count_result[0]['total'] if count_result else 0

    consumables = db.execute_query(
        QUERY_GET_CONSUMABLES_GROUPED,
        (offset, limit)
    )

    grouped = _group_rows_by_branch_location(consumables)

    return _set_cached_equipment_payload(cache_key, {
        'grouped': grouped,
        'total': total,
        'page': page,
        'limit': limit,
        'pages': (total + limit - 1) // limit
    })
