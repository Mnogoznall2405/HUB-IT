"""
Read-only owner/type/status/model reference queries for SQL Server inventory data.
"""
from typing import Any, Callable, List, Optional

from backend.database.connection import get_db as _default_get_db


QUERY_GET_ALL_EQUIPMENT_TYPES = """
    SELECT CI_TYPE, TYPE_NO, TYPE_NAME
    FROM CI_TYPES
    WHERE CI_TYPE IS NOT NULL AND TYPE_NO IS NOT NULL
    ORDER BY TYPE_NAME
"""

QUERY_GET_ALL_STATUSES = """
    SELECT STATUS_NO, DESCR as STATUS_NAME
    FROM STATUS
    ORDER BY DESCR
"""

QUERY_GET_MODELS_BY_TYPE = """
    SELECT
        m.MODEL_NO as model_no,
        m.MODEL_NAME as model_name,
        m.TYPE_NO as type_no
    FROM CI_MODELS m
    WHERE m.CI_TYPE = 1 AND m.TYPE_NO = ?
    ORDER BY m.MODEL_NAME
"""


def _get_db(db_id: Optional[str], get_db_fn: Optional[Callable[[Optional[str]], Any]]) -> Any:
    return (get_db_fn or _default_get_db)(db_id)


def _row_int(row: dict, *keys: str) -> Optional[int]:
    for key in keys:
        value = row.get(key)
        if value is None:
            continue
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    return None


def get_all_equipment_types(
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> List[dict]:
    """Get all equipment types."""
    db = _get_db(db_id, get_db_fn)
    return db.execute_query(QUERY_GET_ALL_EQUIPMENT_TYPES)


def get_all_statuses(
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> List[dict]:
    """Get all equipment statuses."""
    db = _get_db(db_id, get_db_fn)
    rows = db.execute_query(QUERY_GET_ALL_STATUSES)
    return [
        {
            "status_no": row.get("status_no", row.get("STATUS_NO")),
            "status_name": row.get("status_name", row.get("STATUS_NAME")),
        }
        for row in rows
    ]


def get_owner_by_no(
    owner_no: int,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[dict]:
    """Get owner by OWNER_NO."""
    db = _get_db(db_id, get_db_fn)
    query = """
        SELECT
            o.OWNER_NO,
            o.OWNER_DISPLAY_NAME,
            o.OWNER_DEPT
        FROM OWNERS o
        WHERE o.OWNER_NO = ?
    """
    rows = db.execute_query(query, (owner_no,))
    return rows[0] if rows else None


def get_status_by_no(
    status_no: int,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[dict]:
    """Get status by STATUS_NO."""
    db = _get_db(db_id, get_db_fn)
    query = """
        SELECT
            s.STATUS_NO,
            s.DESCR as STATUS_NAME
        FROM STATUS s
        WHERE s.STATUS_NO = ?
    """
    rows = db.execute_query(query, (status_no,))
    return rows[0] if rows else None


def get_default_status_no(
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[int]:
    """Resolve default STATUS_NO for create forms."""
    db = _get_db(db_id, get_db_fn)
    preferred_query = """
        SELECT TOP 1 s.STATUS_NO
        FROM STATUS s
        WHERE LOWER(CAST(s.DESCR AS NVARCHAR(255))) LIKE N'%эксплуата%'
        ORDER BY s.STATUS_NO
    """
    rows = db.execute_query(preferred_query, ())
    if rows:
        return _row_int(rows[0], "STATUS_NO", "status_no")

    fallback_query = """
        SELECT TOP 1 s.STATUS_NO
        FROM STATUS s
        ORDER BY s.STATUS_NO
    """
    rows = db.execute_query(fallback_query, ())
    return _row_int(rows[0], "STATUS_NO", "status_no") if rows else None


def get_type_by_no(
    type_no: int,
    db_id: Optional[str] = None,
    ci_type: int = 1,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[dict]:
    """Get equipment type by TYPE_NO for selected CI_TYPE."""
    db = _get_db(db_id, get_db_fn)
    query = """
        SELECT
            t.CI_TYPE,
            t.TYPE_NO,
            t.TYPE_NAME
        FROM CI_TYPES t
        WHERE t.CI_TYPE = ? AND t.TYPE_NO = ?
    """
    rows = db.execute_query(query, (ci_type, type_no))
    return rows[0] if rows else None


def get_models_by_type(
    type_no: int,
    db_id: Optional[str] = None,
    ci_type: int = 1,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> List[dict]:
    """Get model list by TYPE_NO for selected CI_TYPE."""
    db = _get_db(db_id, get_db_fn)
    query = """
        SELECT
            m.MODEL_NO as model_no,
            m.MODEL_NAME as model_name,
            m.TYPE_NO as type_no,
            m.CI_TYPE as ci_type
        FROM CI_MODELS m
        WHERE m.CI_TYPE = ? AND m.TYPE_NO = ?
        ORDER BY m.MODEL_NAME
    """
    return db.execute_query(query, (ci_type, type_no))


def get_model_no_by_name(
    model_name: str,
    ci_type: int = 1,
    strict: bool = True,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[int]:
    """Get MODEL_NO by model name."""
    if not model_name:
        return None
    db = _get_db(db_id, get_db_fn)
    where_clause = "m.MODEL_NAME = ?" if strict else "m.MODEL_NAME LIKE ?"
    param = model_name if strict else f"%{model_name}%"
    query = f"""
        SELECT TOP 1 m.MODEL_NO
        FROM CI_MODELS m
        WHERE m.CI_TYPE = ? AND {where_clause}
        ORDER BY m.MODEL_NO
    """
    rows = db.execute_query(query, (ci_type, param))
    return _row_int(rows[0], "MODEL_NO", "model_no") if rows else None


def get_model_by_no(
    model_no: int,
    db_id: Optional[str] = None,
    ci_type: int = 1,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[dict]:
    """Get model by MODEL_NO for selected CI_TYPE."""
    db = _get_db(db_id, get_db_fn)
    query = """
        SELECT
            m.CI_TYPE,
            m.TYPE_NO,
            m.MODEL_NO,
            m.MODEL_NAME
        FROM CI_MODELS m
        WHERE m.CI_TYPE = ? AND m.MODEL_NO = ?
    """
    rows = db.execute_query(query, (ci_type, model_no))
    return rows[0] if rows else None


def get_owner_no_by_name(
    employee_name: str,
    strict: bool = True,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[int]:
    """Get OWNER_NO by employee full name."""
    if not employee_name:
        return None
    db = _get_db(db_id, get_db_fn)
    where_clause = "o.OWNER_DISPLAY_NAME = ?" if strict else "o.OWNER_DISPLAY_NAME LIKE ?"
    param = employee_name if strict else f"%{employee_name}%"
    query = f"""
        SELECT TOP 1 o.OWNER_NO
        FROM OWNERS o
        WHERE {where_clause}
        ORDER BY o.OWNER_NO
    """
    rows = db.execute_query(query, (param,))
    return _row_int(rows[0], "OWNER_NO", "owner_no") if rows else None


def get_owner_email_by_no(
    owner_no: int,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[str]:
    """Get owner email by OWNER_NO."""
    db = _get_db(db_id, get_db_fn)
    query = """
        SELECT TOP 1 NULLIF(LTRIM(RTRIM(o.OWNER_EMAIL)), '') AS OWNER_EMAIL
        FROM OWNERS o
        WHERE o.OWNER_NO = ?
    """
    rows = db.execute_query(query, (owner_no,))
    if not rows:
        return None
    value = rows[0].get("OWNER_EMAIL") or rows[0].get("owner_email")
    if value is None:
        return None
    email = str(value).strip()
    return email or None
