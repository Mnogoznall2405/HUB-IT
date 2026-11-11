"""Inventory network-scope rules: map a host IP (CIDR) to a database/branch.

Shared by the Computers page (inventory.py) and DLP host grouping so both
resolve «no ITINVENT binding» the same way. Rules come from
ITINV_INVENTORY_NETWORK_SCOPE_MAP: ``cidr=DB_ID|branch name;...``.
"""
import ipaddress
import os
from typing import Any, Dict, Iterable, List, Optional, Tuple

DEFAULT_INVENTORY_NETWORK_SCOPE_MAP = "10.105.6.0/24=ITINVENT|г.Тюмень, Велижанский тракт 6"


def parse_network_scope_map(raw: Any) -> List[Tuple[Any, str, str]]:
    rules: List[Tuple[Any, str, str]] = []
    for item in str(raw or "").split(";"):
        cidr, separator, target = item.strip().partition("=")
        if not separator:
            continue
        database_id, _, branch_name = target.partition("|")
        try:
            network = ipaddress.ip_network(cidr.strip(), strict=False)
        except ValueError:
            continue
        normalized_database_id = database_id.strip()
        if normalized_database_id:
            rules.append((network, normalized_database_id, branch_name.strip()))
    return rules


INVENTORY_NETWORK_SCOPE_RULES = parse_network_scope_map(
    os.getenv("ITINV_INVENTORY_NETWORK_SCOPE_MAP", DEFAULT_INVENTORY_NETWORK_SCOPE_MAP)
)


def resolve_network_scope(ips: Iterable[Any]) -> Optional[Dict[str, Any]]:
    seen = set()
    for raw_ip in ips:
        ip_text = str(raw_ip or "").strip()
        if not ip_text or ip_text in seen:
            continue
        seen.add(ip_text)
        try:
            ip_value = ipaddress.ip_address(ip_text)
        except ValueError:
            continue
        for network, database_id, branch_name in INVENTORY_NETWORK_SCOPE_RULES:
            if ip_value in network:
                return {
                    "database_id": database_id,
                    "branch_name": branch_name,
                    "ip_address": ip_text,
                }
    return None
