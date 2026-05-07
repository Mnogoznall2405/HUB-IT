"""
Read-only SQL Server inventory context lookup for endpoint/network enrichment.
"""
import re
from typing import Any, Callable, Dict, List, Optional

from backend.database.connection import get_db as _default_get_db


QUERY_RESOLVE_PC_CONTEXT_BY_MAC = """
    SELECT TOP 1
        i.INV_NO as inv_no,
        i.MAC_ADDRESS as mac_address,
        i.NETBIOS_NAME as network_name,
        i.IP_ADDRESS as ip_address,
        m.MODEL_NAME as model_name,
        i.BRANCH_NO as branch_no,
        i.LOC_NO as loc_no,
        b.BRANCH_NAME as branch_name,
        l.DESCR as location_name,
        i.EMPL_NO as empl_no,
        o.OWNER_DISPLAY_NAME as employee_name
    FROM ITEMS i
    LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
    LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
    LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
    LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
    WHERE i.CI_TYPE = 1
      AND UPPER(REPLACE(REPLACE(COALESCE(i.MAC_ADDRESS, ''), ':', ''), '-', '')) = ?
    ORDER BY i.ID DESC
"""

QUERY_RESOLVE_PC_CONTEXT_BY_HOSTNAME = """
    SELECT TOP 1
        i.INV_NO as inv_no,
        i.MAC_ADDRESS as mac_address,
        i.NETBIOS_NAME as network_name,
        i.IP_ADDRESS as ip_address,
        m.MODEL_NAME as model_name,
        i.BRANCH_NO as branch_no,
        i.LOC_NO as loc_no,
        b.BRANCH_NAME as branch_name,
        l.DESCR as location_name,
        i.EMPL_NO as empl_no,
        o.OWNER_DISPLAY_NAME as employee_name
    FROM ITEMS i
    LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
    LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
    LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
    LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
    WHERE i.CI_TYPE = 1
      AND (
            UPPER(COALESCE(i.NETBIOS_NAME, '')) = UPPER(?)
         OR UPPER(COALESCE(i.DOMAIN_NAME, '')) = UPPER(?)
      )
    ORDER BY i.ID DESC
"""


def _get_db(db_id: Optional[str], get_db_fn: Optional[Callable[[Optional[str]], Any]]) -> Any:
    return (get_db_fn or _default_get_db)(db_id)


def _normalize_mac_for_lookup(value: Optional[str]) -> str:
    return re.sub(r"[^0-9A-Fa-f]", "", str(value or "")).upper()


def resolve_pc_context_by_mac_or_hostname(
    mac_address: Optional[str],
    hostname: Optional[str],
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Optional[dict]:
    """
    Resolve branch and owner context for a PC from SQL inventory.
    """
    db = _get_db(db_id, get_db_fn)
    normalized_mac = _normalize_mac_for_lookup(mac_address)
    normalized_hostname = str(hostname or "").strip()

    if normalized_mac:
        try:
            rows = db.execute_query(QUERY_RESOLVE_PC_CONTEXT_BY_MAC, (normalized_mac,))
            if rows:
                return rows[0]
        except Exception:
            pass

    if normalized_hostname:
        candidates = [normalized_hostname]
        short_name = normalized_hostname.split(".")[0].strip()
        if short_name and short_name.upper() != normalized_hostname.upper():
            candidates.append(short_name)

        for candidate in candidates:
            try:
                rows = db.execute_query(QUERY_RESOLVE_PC_CONTEXT_BY_HOSTNAME, (candidate, candidate))
                if rows:
                    return rows[0]
            except Exception:
                continue

    return None


QUERY_RESOLVE_PC_CONTEXT_BATCH_BY_MAC = """
    SELECT
        i.INV_NO as inv_no,
        i.MAC_ADDRESS as mac_address,
        i.NETBIOS_NAME as network_name,
        i.IP_ADDRESS as ip_address,
        m.MODEL_NAME as model_name,
        i.BRANCH_NO as branch_no,
        i.LOC_NO as loc_no,
        b.BRANCH_NAME as branch_name,
        l.DESCR as location_name,
        i.EMPL_NO as empl_no,
        o.OWNER_DISPLAY_NAME as employee_name
    FROM ITEMS i
    LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
    LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
    LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
    LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
    WHERE i.CI_TYPE = 1
      AND UPPER(REPLACE(REPLACE(COALESCE(i.MAC_ADDRESS, ''), ':', ''), '-', '')) IN ({placeholders})
"""

QUERY_RESOLVE_PC_CONTEXT_BATCH_BY_HOSTNAME = """
    SELECT
        i.INV_NO as inv_no,
        i.MAC_ADDRESS as mac_address,
        i.NETBIOS_NAME as network_name,
        i.IP_ADDRESS as ip_address,
        m.MODEL_NAME as model_name,
        i.BRANCH_NO as branch_no,
        i.LOC_NO as loc_no,
        b.BRANCH_NAME as branch_name,
        l.DESCR as location_name,
        i.EMPL_NO as empl_no,
        o.OWNER_DISPLAY_NAME as employee_name
    FROM ITEMS i
    LEFT JOIN CI_MODELS m ON i.MODEL_NO = m.MODEL_NO AND i.CI_TYPE = m.CI_TYPE
    LEFT JOIN OWNERS o ON i.EMPL_NO = o.OWNER_NO
    LEFT JOIN BRANCHES b ON i.BRANCH_NO = b.BRANCH_NO
    LEFT JOIN LOCATIONS l ON i.LOC_NO = l.LOC_NO
    WHERE i.CI_TYPE = 1
      AND (
            UPPER(COALESCE(i.NETBIOS_NAME, '')) IN ({placeholders})
         OR UPPER(COALESCE(i.DOMAIN_NAME, '')) IN ({placeholders})
      )
"""


def resolve_pc_context_batch(
    mac_addresses: List[str],
    hostnames: List[str],
    db_id: Optional[str] = None,
    *,
    get_db_fn: Optional[Callable[[Optional[str]], Any]] = None,
) -> Dict[str, dict]:
    """Batch-resolve PC contexts to avoid N+1 queries."""
    db = _get_db(db_id, get_db_fn)
    results: Dict[str, dict] = {}

    # Batch by MAC
    if mac_addresses:
        normalized_macs = list(dict.fromkeys(_normalize_mac_for_lookup(m) for m in mac_addresses if m))
        if normalized_macs:
            placeholders = ",".join("?" * len(normalized_macs))
            query = QUERY_RESOLVE_PC_CONTEXT_BATCH_BY_MAC.format(placeholders=placeholders)
            try:
                rows = db.execute_query(query, tuple(normalized_macs))
                for row in rows:
                    mac = _normalize_mac_for_lookup(row.get("mac_address"))
                    if mac:
                        results[mac] = dict(row)
            except Exception:
                pass

    # Batch by hostname for remaining
    remaining_hosts = [h for h in hostnames if h and _normalize_mac_for_lookup(h) not in results]
    if remaining_hosts:
        candidates: List[str] = []
        for hostname in remaining_hosts:
            normalized = str(hostname).strip()
            if normalized:
                candidates.append(normalized.upper())
                short = normalized.split(".")[0].strip()
                if short and short.upper() != normalized.upper():
                    candidates.append(short.upper())
        candidates = list(dict.fromkeys(candidates))
        if candidates:
            placeholders = ",".join("?" * len(candidates))
            query = QUERY_RESOLVE_PC_CONTEXT_BATCH_BY_HOSTNAME.format(placeholders=placeholders)
            try:
                rows = db.execute_query(query, tuple(candidates) * 2)
                for row in rows:
                    mac = _normalize_mac_for_lookup(row.get("mac_address"))
                    if mac and mac not in results:
                        results[mac] = dict(row)
            except Exception:
                pass

    return results
