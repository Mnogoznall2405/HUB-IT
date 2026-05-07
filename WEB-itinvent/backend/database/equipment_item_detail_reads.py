"""
Read-only equipment item detail and batch lookup queries for SQL Server inventory data.
"""
import re
from typing import Any, Callable, List, Optional

from backend.database.connection import get_db as _default_get_db


QUERY_GET_EQUIPMENT_BY_INV = """
    SELECT
        i.ID as id,
        i.INV_NO as inv_no,
        i.SERIAL_NO as serial_no,
        i.HW_SERIAL_NO as hw_serial_no,
        i.PART_NO as part_no,
        i.CI_TYPE as ci_type,
        i.TYPE_NO as type_no,
        i.MODEL_NO as model_no,
        i.STATUS_NO as status_no,
        i.EMPL_NO as empl_no,
        i.BRANCH_NO as branch_no,
        i.LOC_NO as loc_no,
        t.TYPE_NAME as type_name,
        m.MODEL_NAME as model_name,
        v.VENDOR_NAME as vendor_name,
        s.DESCR as status,
        o.OWNER_DISPLAY_NAME as employee_name,
        o.OWNER_DEPT as employee_dept,
        o.OWNER_EMAIL as employee_email,
        b.BRANCH_NAME as branch_name,
        l.DESCR as location,
        i.DESCR as DESCRIPTION,
        i.IP_ADDRESS as ip_address,
        NULL as mac_address,
        NULL as network_name,
        NULL as domain_name
    FROM ITEMS i
    LEFT JOIN CI_TYPES t ON i.CI_TYPE = t.CI_TYPE AND i.TYPE_NO = t.TYPE_NO
    LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
    LEFT JOIN VENDORS v ON m.VENDOR_NO = v.VENDOR_NO
    LEFT JOIN STATUS s ON i.STATUS_NO = s.STATUS_NO
    LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
    LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
    LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
    WHERE i.CI_TYPE = 1 AND i.INV_NO = ?
"""


TableColumnsLookup = Callable[[str, Optional[str]], List[dict]]


def _get_db(db_id: Optional[str], get_db_fn: Optional[Callable[[Optional[str]], Any]]) -> Any:
    return (get_db_fn or _default_get_db)(db_id)


def _get_table_columns(
    table_name: str,
    db_id: Optional[str],
    table_columns_fn: Optional[TableColumnsLookup],
) -> List[dict]:
    if table_columns_fn is not None:
        return table_columns_fn(table_name, db_id)

    from backend.database.queries import _get_table_columns as _default_get_table_columns

    return _default_get_table_columns(table_name, db_id)


def get_equipment_by_inv(
    inv_no: str,
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
    table_columns_fn: Optional[TableColumnsLookup] = None,
) -> Optional[dict]:
    """
    Get equipment by inventory number.
    """
    db = _get_db(db_id, get_db_fn)
    try:
        inv_no_float = float(inv_no) if inv_no else None
    except (ValueError, TypeError):
        inv_no_float = None

    optional_ip_select = "i.IP_ADDRESS as ip_address"
    optional_mac_select = "i.MAC_ADDRESS as mac_address"
    optional_network_select = "i.NETBIOS_NAME as network_name"
    optional_domain_select = "i.DOMAIN_NAME as domain_name"

    try:
        item_columns = _get_table_columns("ITEMS", db_id, table_columns_fn)
        available_columns = {
            str(row.get("column_name") or row.get("COLUMN_NAME") or "").upper()
            for row in (item_columns or [])
        }

        def _pick_first(candidates: List[str]) -> Optional[str]:
            for column in candidates:
                if column in available_columns:
                    return column
            return None

        ip_col = _pick_first(["IP_ADDRESS"])
        mac_col = _pick_first(["MAC_ADDRESS", "MAC_ADDR", "MAC"])
        network_col = _pick_first(
            [
                "NETBIOS_NAME",
                "HOST_NAME",
                "HOSTNAME",
                "DNS_NAME",
                "NETWORK_NAME",
                "NET_NAME",
                "PC_NAME",
                "COMPUTER_NAME",
            ]
        )
        domain_col = _pick_first(["DOMAIN_NAME", "NET_DOMAIN", "DOMAIN"])

        if ip_col:
            optional_ip_select = f"i.{ip_col} as ip_address"
        if mac_col:
            optional_mac_select = f"i.{mac_col} as mac_address"
        if network_col:
            optional_network_select = f"i.{network_col} as network_name"
        if domain_col:
            optional_domain_select = f"i.{domain_col} as domain_name"
    except Exception:
        pass

    query = f"""
        SELECT
            i.ID as id,
            i.INV_NO as inv_no,
            i.SERIAL_NO as serial_no,
            i.HW_SERIAL_NO as hw_serial_no,
            i.PART_NO as part_no,
            i.CI_TYPE as ci_type,
            i.TYPE_NO as type_no,
            i.MODEL_NO as model_no,
            i.STATUS_NO as status_no,
            i.EMPL_NO as empl_no,
            i.BRANCH_NO as branch_no,
            i.LOC_NO as loc_no,
            t.TYPE_NAME as type_name,
            m.MODEL_NAME as model_name,
            v.VENDOR_NAME as vendor_name,
            s.DESCR as status,
            o.OWNER_DISPLAY_NAME as employee_name,
            o.OWNER_DEPT as employee_dept,
            o.OWNER_EMAIL as employee_email,
            b.BRANCH_NAME as branch_name,
            l.DESCR as location,
            i.DESCR as DESCRIPTION,
            {optional_ip_select},
            {optional_mac_select},
            {optional_network_select},
            {optional_domain_select}
        FROM ITEMS i
        LEFT JOIN CI_TYPES t ON i.CI_TYPE = t.CI_TYPE AND i.TYPE_NO = t.TYPE_NO
        LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
        LEFT JOIN VENDORS v ON m.VENDOR_NO = v.VENDOR_NO
        LEFT JOIN STATUS s ON i.STATUS_NO = s.STATUS_NO
        LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
        LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
        LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
        WHERE i.CI_TYPE = 1 AND i.INV_NO = ?
    """

    try:
        result = db.execute_query(query, (inv_no_float,))
    except Exception:
        result = db.execute_query(QUERY_GET_EQUIPMENT_BY_INV, (inv_no_float,))
    return result[0] if result else None


def get_equipment_items_by_ids(
    item_ids: List[int],
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> List[dict]:
    """
    Resolve equipment records by ITEMS.ID.
    """
    normalized_ids: List[int] = []
    for raw in item_ids or []:
        try:
            value = int(raw)
        except (TypeError, ValueError):
            continue
        if value > 0 and value not in normalized_ids:
            normalized_ids.append(value)

    if not normalized_ids:
        return []

    placeholders = ", ".join(["?"] * len(normalized_ids))
    query = f"""
        SELECT
            i.ID AS item_id,
            CAST(i.INV_NO AS VARCHAR(64)) AS inv_no,
            i.SERIAL_NO AS serial_no,
            m.MODEL_NAME AS model_name,
            o.OWNER_DISPLAY_NAME AS employee_name,
            b.BRANCH_NAME AS branch_name,
            l.DESCR AS location_name
        FROM ITEMS i
        LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
        LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
        LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
        LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
        WHERE i.CI_TYPE = 1
          AND i.ID IN ({placeholders})
        ORDER BY i.ID
    """
    db = _get_db(db_id, get_db_fn)
    return db.execute_query(query, tuple(normalized_ids))


def _normalize_inv_no_token(raw: Any) -> Optional[str]:
    """Normalize inventory number token for resilient matching."""
    text = str(raw or "").strip()
    if not text:
        return None

    text = re.sub(r"\s+", "", text)
    text = text.replace("№", "")
    text = text.strip(".,;:|")
    if not text:
        return None

    if re.fullmatch(r"\d+[.,]0+", text):
        text = re.split(r"[.,]", text, maxsplit=1)[0]
    if re.fullmatch(r"\d+", text):
        text = str(int(text))

    return text


def get_equipment_items_by_inv_nos(
    inv_nos: List[str],
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> List[dict]:
    """
    Resolve equipment records by ITEMS.INV_NO.
    """
    normalized_tokens: List[str] = []
    for raw in inv_nos or []:
        token = _normalize_inv_no_token(raw)
        if token and token not in normalized_tokens:
            normalized_tokens.append(token)

    if not normalized_tokens:
        return []

    text_tokens = list(normalized_tokens)
    numeric_tokens: List[int] = []
    for token in normalized_tokens:
        if re.fullmatch(r"\d+", token):
            numeric = int(token)
            if numeric not in numeric_tokens:
                numeric_tokens.append(numeric)

    where_parts: List[str] = []
    params: List[Any] = []

    if text_tokens:
        placeholders = ", ".join(["?"] * len(text_tokens))
        where_parts.append(f"UPPER(CAST(i.INV_NO AS VARCHAR(64))) IN ({placeholders})")
        params.extend([token.upper() for token in text_tokens])

    if numeric_tokens:
        placeholders = ", ".join(["?"] * len(numeric_tokens))
        where_parts.append(f"TRY_CONVERT(BIGINT, i.INV_NO) IN ({placeholders})")
        params.extend(numeric_tokens)

    if not where_parts:
        return []

    query = f"""
        SELECT
            i.ID AS item_id,
            CAST(i.INV_NO AS VARCHAR(64)) AS inv_no,
            i.SERIAL_NO AS serial_no,
            m.MODEL_NAME AS model_name,
            o.OWNER_DISPLAY_NAME AS employee_name,
            b.BRANCH_NAME AS branch_name,
            l.DESCR AS location_name
        FROM ITEMS i
        LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
        LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
        LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
        LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
        WHERE i.CI_TYPE = 1
          AND ({' OR '.join(where_parts)})
        ORDER BY TRY_CONVERT(BIGINT, i.INV_NO), i.ID
    """
    db = _get_db(db_id, get_db_fn)
    return db.execute_query(query, tuple(params))


def get_transfer_act_items_by_inv_nos(
    inv_nos: List[str],
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> List[dict]:
    """
    Resolve equipment records for transfer-act generation in one query.
    """
    normalized_tokens: List[str] = []
    for raw in inv_nos or []:
        token = _normalize_inv_no_token(raw)
        if token and token not in normalized_tokens:
            normalized_tokens.append(token)

    if not normalized_tokens:
        return []

    numeric_tokens: List[int] = []
    for token in normalized_tokens:
        if re.fullmatch(r"\d+", token):
            numeric = int(token)
            if numeric not in numeric_tokens:
                numeric_tokens.append(numeric)

    where_parts: List[str] = []
    params: List[Any] = []

    placeholders = ", ".join(["?"] * len(normalized_tokens))
    where_parts.append(f"UPPER(CAST(i.INV_NO AS VARCHAR(64))) IN ({placeholders})")
    params.extend([token.upper() for token in normalized_tokens])

    if numeric_tokens:
        placeholders = ", ".join(["?"] * len(numeric_tokens))
        where_parts.append(f"TRY_CONVERT(BIGINT, i.INV_NO) IN ({placeholders})")
        params.extend(numeric_tokens)

    query = f"""
        SELECT
            i.ID AS id,
            CAST(i.INV_NO AS VARCHAR(64)) AS inv_no,
            i.SERIAL_NO AS serial_no,
            i.HW_SERIAL_NO AS hw_serial_no,
            i.PART_NO AS part_no,
            i.CI_TYPE AS ci_type,
            i.TYPE_NO AS type_no,
            i.MODEL_NO AS model_no,
            i.STATUS_NO AS status_no,
            i.EMPL_NO AS empl_no,
            i.BRANCH_NO AS branch_no,
            i.LOC_NO AS loc_no,
            t.TYPE_NAME AS type_name,
            m.MODEL_NAME AS model_name,
            v.VENDOR_NAME AS vendor_name,
            s.DESCR AS status,
            o.OWNER_DISPLAY_NAME AS employee_name,
            o.OWNER_DEPT AS employee_dept,
            o.OWNER_EMAIL AS employee_email,
            b.BRANCH_NAME AS branch_name,
            l.DESCR AS location,
            i.DESCR AS DESCRIPTION
        FROM ITEMS i
        LEFT JOIN CI_TYPES t ON i.CI_TYPE = t.CI_TYPE AND i.TYPE_NO = t.TYPE_NO
        LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
        LEFT JOIN VENDORS v ON m.VENDOR_NO = v.VENDOR_NO
        LEFT JOIN STATUS s ON i.STATUS_NO = s.STATUS_NO
        LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
        LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
        LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
        WHERE i.CI_TYPE = 1
          AND ({' OR '.join(where_parts)})
        ORDER BY TRY_CONVERT(BIGINT, i.INV_NO), i.ID
    """
    db = _get_db(db_id, get_db_fn)
    return db.execute_query(query, tuple(params))
