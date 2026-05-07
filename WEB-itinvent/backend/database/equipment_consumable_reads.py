"""
Read-only consumable lookup query for SQL Server inventory data.
"""
from typing import Any, Callable, Dict, List, Optional

from backend.database.connection import get_db as _default_get_db


def _get_db(db_id: Optional[str], get_db_fn: Optional[Callable[[Optional[str]], Any]]) -> Any:
    return (get_db_fn or _default_get_db)(db_id)


def get_consumables_lookup(
    db_id: Optional[str] = None,
    *,
    type_no: Optional[int] = None,
    model_name: Optional[str] = None,
    branch_no: Optional[Any] = None,
    loc_no: Optional[Any] = None,
    only_positive_qty: bool = True,
    limit: int = 300,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> List[Dict[str, Any]]:
    """Lookup consumables (CI_TYPE=4) with branch/location for work operations."""
    db = _get_db(db_id, get_db_fn)
    safe_limit = max(1, min(int(limit or 300), 1000))

    conditions = ["i.CI_TYPE = 4"]
    params: List[Any] = []

    if only_positive_qty:
        conditions.append("ISNULL(i.QTY, 0) > 0")
    if type_no is not None:
        conditions.append("i.TYPE_NO = ?")
        params.append(int(type_no))
    if model_name:
        conditions.append("LOWER(CAST(m.MODEL_NAME AS NVARCHAR(255))) LIKE ?")
        params.append(f"%{str(model_name).strip().lower()}%")
    if branch_no not in (None, ""):
        conditions.append("i.BRANCH_NO = ?")
        params.append(branch_no)
    if loc_no not in (None, ""):
        conditions.append("i.LOC_NO = ?")
        params.append(loc_no)

    query = f"""
        SELECT TOP {safe_limit}
            i.ID as id,
            i.INV_NO as inv_no,
            i.TYPE_NO as type_no,
            i.MODEL_NO as model_no,
            ISNULL(i.QTY, 0) as qty,
            i.PART_NO as part_no,
            i.DESCR as description,
            t.TYPE_NAME as type_name,
            m.MODEL_NAME as model_name,
            b.BRANCH_NO as branch_no,
            b.BRANCH_NAME as branch_name,
            l.LOC_NO as loc_no,
            l.DESCR as location_name
        FROM ITEMS i
        LEFT JOIN CI_TYPES t ON i.CI_TYPE = t.CI_TYPE AND i.TYPE_NO = t.TYPE_NO
        LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
        LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
        LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
        WHERE {" AND ".join(conditions)}
        ORDER BY m.MODEL_NAME, b.BRANCH_NAME, l.DESCR, i.ID
    """
    return db.execute_query(query, tuple(params))
