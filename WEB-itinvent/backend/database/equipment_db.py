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
_equipment_payload_cache: Dict[str, Dict[str, Any]] = {}
_equipment_payload_cache_lock = RLock()
_EQUIPMENT_PAYLOAD_CACHE_TTL_SEC = max(10, int(os.getenv("EQUIPMENT_PAYLOAD_CACHE_TTL_SEC", "30")))
_EQUIPMENT_DICT_CACHE_TTL_SEC = max(60, int(os.getenv("EQUIPMENT_DICT_CACHE_TTL_SEC", "300")))


def _build_equipment_cache_key(kind: str, db_id: Optional[str], *parts: Any) -> str:
    normalized_parts = [kind, str(db_id or "").strip()]
    normalized_parts.extend(str(part) for part in parts)
    return "|".join(normalized_parts)


def _get_cached_equipment_payload(cache_key: str, ttl_sec: Optional[float] = None) -> Optional[Any]:
    ttl = _EQUIPMENT_PAYLOAD_CACHE_TTL_SEC if ttl_sec is None else ttl_sec
    with _equipment_payload_cache_lock:
        cached = _equipment_payload_cache.get(cache_key)
        if not cached:
            return None
        if (time.monotonic() - float(cached.get("ts") or 0)) >= ttl:
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
    needle = f"|{str(db_id or '').strip()}"
    with _equipment_payload_cache_lock:
        if db_id is None:
            _equipment_payload_cache.clear()
            return
        for cache_key in list(_equipment_payload_cache.keys()):
            if f"{needle}|" in cache_key or cache_key.endswith(needle):
                _equipment_payload_cache.pop(cache_key, None)


def _get_cached_equipment_total(
    kind: str,
    db_id: Optional[str],
    query: str,
    params: tuple = (),
) -> int:
    cache_key = _build_equipment_cache_key(f"{kind}_total", db_id, "count", *params)
    cached_total = _get_cached_equipment_payload(cache_key)
    if cached_total is not None:
        return int(cached_total)
    rows = get_db(db_id).execute_query(query, params)
    total = int(rows[0].get("total") or 0) if rows else 0
    _set_cached_equipment_payload(cache_key, total)
    return total


def _cached_dict_query(kind: str, db_id: Optional[str], fetcher: Any, *parts: Any) -> Any:
    """Cache directory/reference payloads with a longer TTL — they change rarely."""
    cache_key = _build_equipment_cache_key(f"dict_{kind}", db_id, *parts)
    cached = _get_cached_equipment_payload(cache_key, ttl_sec=_EQUIPMENT_DICT_CACHE_TTL_SEC)
    if cached is not None:
        return cached
    return _set_cached_equipment_payload(cache_key, fetcher())


def get_all_branches_cached(db_id: Optional[str] = None) -> List[Dict[str, Any]]:
    from backend.database import queries
    return _cached_dict_query("branches", db_id, lambda: queries.get_all_branches(db_id))


def get_all_statuses_cached(db_id: Optional[str] = None) -> List[Dict[str, Any]]:
    from backend.database import queries
    return _cached_dict_query("statuses", db_id, lambda: queries.get_all_statuses(db_id))


def get_all_locations_cached(db_id: Optional[str] = None, branch_no: Any = None) -> List[Dict[str, Any]]:
    from backend.database import queries
    return _cached_dict_query("locations", db_id, lambda: queries.get_all_locations(db_id, branch_no=branch_no), branch_no)


def get_models_by_type_cached(type_no: int, db_id: Optional[str] = None, ci_type: int = 1) -> List[Dict[str, Any]]:
    from backend.database import queries
    return _cached_dict_query(
        "models_by_type", db_id, lambda: queries.get_models_by_type(type_no, db_id, ci_type=ci_type), type_no, ci_type
    )


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

    from backend.database.queries_new import QUERY_COUNT_ALL_EQUIPMENT

    total = _get_cached_equipment_total("equipment_all", db_id, QUERY_COUNT_ALL_EQUIPMENT)

    from backend.database.queries_new import QUERY_GET_ALL_EQUIPMENT
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

        from backend.database.queries_new import QUERY_COUNT_BY_BRANCH, QUERY_GET_EQUIPMENT_BY_BRANCH

        total = _get_cached_equipment_total("equipment_by_branch", db_id, QUERY_COUNT_BY_BRANCH, (branch_name,))

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
    cache_key = _build_equipment_cache_key("dict_branches_list", db_id)
    cached = _get_cached_equipment_payload(cache_key, ttl_sec=_EQUIPMENT_DICT_CACHE_TTL_SEC)
    if cached is not None:
        return cached
    db = get_db(db_id)
    from backend.database.queries_new import QUERY_GET_ALL_BRANCHES
    return _set_cached_equipment_payload(cache_key, db.execute_query(QUERY_GET_ALL_BRANCHES, ()))


def get_locations_by_branch(branch_no: int, db_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Legacy compatibility wrapper that preserves global LOCATIONS with branch priority."""
    from backend.database import queries
    return queries.get_all_locations(db_id=db_id, branch_no=branch_no)


def get_all_equipment_types(db_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get all equipment types."""
    cache_key = _build_equipment_cache_key("dict_equipment_types", db_id)
    cached = _get_cached_equipment_payload(cache_key, ttl_sec=_EQUIPMENT_DICT_CACHE_TTL_SEC)
    if cached is not None:
        return cached
    db = get_db(db_id)
    from backend.database.queries_new import QUERY_GET_ALL_EQUIPMENT_TYPES
    return _set_cached_equipment_payload(cache_key, db.execute_query(QUERY_GET_ALL_EQUIPMENT_TYPES, ()))


def get_equipment_grouped(page: int = 1, limit: int = 100, db_id: Optional[str] = None) -> Dict[str, Any]:
    """Get equipment grouped by branch and location (simplified fields)."""
    cache_key = _build_equipment_cache_key("equipment_grouped", db_id, page, limit)
    cached_payload = _get_cached_equipment_payload(cache_key)
    if cached_payload is not None:
        return cached_payload

    db = get_db(db_id)
    offset = (page - 1) * limit

    from backend.database.queries_new import QUERY_GET_EQUIPMENT_GROUPED, QUERY_COUNT_ALL_EQUIPMENT

    total = _get_cached_equipment_total("equipment", db_id, QUERY_COUNT_ALL_EQUIPMENT)

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
    from backend.database.queries_new import QUERY_GET_EQUIPMENT_GROUPED_ALL
    rows = db.execute_query(QUERY_GET_EQUIPMENT_GROUPED_ALL.format(limit=int(limit)), ())
    return _set_cached_equipment_payload(cache_key, rows or [])


def get_consumables_grouped(page: int = 1, limit: int = 100, db_id: Optional[str] = None) -> Dict[str, Any]:
    """Get consumables (CI_TYPE=4) grouped by branch and location."""
    cache_key = _build_equipment_cache_key("consumables_grouped", db_id, page, limit)
    cached_payload = _get_cached_equipment_payload(cache_key)
    if cached_payload is not None:
        return cached_payload

    db = get_db(db_id)
    offset = (page - 1) * limit

    from backend.database.queries_new import QUERY_GET_CONSUMABLES_GROUPED, QUERY_COUNT_ALL_CONSUMABLES

    total = _get_cached_equipment_total("consumables", db_id, QUERY_COUNT_ALL_CONSUMABLES)

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
