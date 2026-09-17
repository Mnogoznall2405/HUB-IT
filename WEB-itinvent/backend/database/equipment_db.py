"""
Equipment database functions using correct schema with dynamic database switching.
"""
from typing import List, Dict, Any, Optional
import json
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
        else:
            for cache_key in list(_equipment_payload_cache.keys()):
                if f"{needle}|" in cache_key or cache_key.endswith(needle):
                    _equipment_payload_cache.pop(cache_key, None)
    bump_equipment_data_version(db_id)


# --- data_version: shared counter so other sessions/workers can detect mutations ---
_DATA_VERSION_FILE = "equipment_data_version.json"
_DATA_VERSION_KEY_PREFIX = "equipment_data_version:"
_DATA_VERSION_CACHE_TTL_SEC = 5.0
_data_version_cache: Dict[str, Any] = {}
_data_version_local_store: Any = None


def _data_version_key(db_id: Optional[str]) -> str:
    return f"{_DATA_VERSION_KEY_PREFIX}{str(db_id or '').strip() or 'default'}"


def _data_version_store() -> Any:
    global _data_version_local_store
    if _data_version_local_store is None:
        from local_store import get_local_store
        _data_version_local_store = get_local_store()
    return _data_version_local_store


def _parse_version_value(raw: Any) -> int:
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
        return max(0, int(value or 0))
    except (TypeError, ValueError, json.JSONDecodeError):
        return 0


def _read_data_version(db_id: Optional[str]) -> int:
    from backend.appdb.db import app_session, is_app_database_configured
    key = _data_version_key(db_id)
    if is_app_database_configured():
        from backend.appdb.models import AppGlobalSetting
        with app_session() as session:
            row = session.get(AppGlobalSetting, key)
            return _parse_version_value(row.value_json) if row else 0
    data = _data_version_store().load_json(_DATA_VERSION_FILE, default_content={})
    return _parse_version_value((data or {}).get(key))


def get_equipment_data_version(db_id: Optional[str] = None) -> int:
    """Current mutation counter for the DB; short memo bounds KV reads per request burst."""
    key = _data_version_key(db_id)
    now = time.monotonic()
    entry = _data_version_cache.get(key)
    if entry and entry[0] > now:
        return int(entry[1])
    value = _read_data_version(db_id)
    _data_version_cache[key] = (now + _DATA_VERSION_CACHE_TTL_SEC, value)
    return value


def bump_equipment_data_version(db_id: Optional[str] = None) -> int:
    """Increment the mutation counter for db_id (or all known keys when db_id is None)."""
    from backend.appdb.db import app_session, is_app_database_configured
    from sqlalchemy import select

    if is_app_database_configured():
        from backend.appdb.models import AppGlobalSetting
        with app_session() as session:
            if db_id is None:
                rows = session.scalars(
                    select(AppGlobalSetting).where(AppGlobalSetting.key.like(f"{_DATA_VERSION_KEY_PREFIX}%"))
                ).all()
                next_value = 0
                for row in rows:
                    next_value = _parse_version_value(row.value_json) + 1
                    row.value_json = json.dumps(next_value)
                for row in rows:
                    _data_version_cache.pop(row.key, None)
                return next_value
            key = _data_version_key(db_id)
            row = session.execute(
                select(AppGlobalSetting).where(AppGlobalSetting.key == key).with_for_update()
            ).scalar_one_or_none()
            next_value = _parse_version_value(row.value_json) + 1 if row else 1
            if row is not None:
                row.value_json = json.dumps(next_value)
            else:
                session.add(AppGlobalSetting(key=key, value_json=json.dumps(next_value)))
            _data_version_cache.pop(key, None)
            return next_value

    store = _data_version_store()
    data = store.load_json(_DATA_VERSION_FILE, default_content={})
    if not isinstance(data, dict):
        data = {}
    next_value = 0
    if db_id is None:
        for key in list(data.keys()):
            if str(key).startswith(_DATA_VERSION_KEY_PREFIX):
                next_value = _parse_version_value(data[key]) + 1
                data[key] = next_value
                _data_version_cache.pop(key, None)
    else:
        key = _data_version_key(db_id)
        next_value = _parse_version_value(data.get(key)) + 1
        data[key] = next_value
        _data_version_cache.pop(key, None)
    store.save_json(_DATA_VERSION_FILE, data)
    return next_value


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
            'branch': branch_name,
            'data_version': get_equipment_data_version(db_id),
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
        cached_payload['data_version'] = get_equipment_data_version(db_id)
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
        'pages': (total + limit - 1) // limit,
        'data_version': get_equipment_data_version(db_id),
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
        cached_payload['data_version'] = get_equipment_data_version(db_id)
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
        'pages': (total + limit - 1) // limit,
        'data_version': get_equipment_data_version(db_id),
    })
