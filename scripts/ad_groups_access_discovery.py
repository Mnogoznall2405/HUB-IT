"""Read-only LDAP discovery for AD Groups access matrix."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root / "WEB-itinvent"))

for env_path in (project_root / ".env", project_root / "WEB-itinvent" / "backend" / ".env"):
    if not env_path.exists():
        continue
    for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

from ldap3 import ALL, LEVEL, SUBTREE, Connection, Server

from backend.config import config


def _entry_value(entry, attr: str):
    try:
        attribute = getattr(entry, attr, None)
        if attribute is None:
            return ""
        value = getattr(attribute, "value", None)
        if value is None:
            values = getattr(attribute, "values", None)
            return list(values) if values else ""
        return value
    except Exception:
        return ""


def main() -> int:
    server_host = os.getenv("LDAP_SERVER", config.app.ldap_server)
    base_dn = os.getenv("LDAP_BASE_DN", "")
    if not base_dn:
        domain = os.getenv("LDAP_DOMAIN", config.app.ldap_domain)
        base_dn = ",".join(f"dc={part}" for part in domain.split(".")) if domain else "dc=zsgp,dc=corp"

    sync_user = os.getenv("LDAP_SYNC_USER", "")
    sync_password = os.getenv("LDAP_SYNC_PASSWORD", "")
    server = Server(server_host, get_info=ALL)
    if sync_user and sync_password:
        conn = Connection(server, user=sync_user, password=sync_password, auto_bind=True)
    else:
        conn = Connection(server, auto_bind=True)

    result: dict = {"base_dn": base_dn, "server": server_host}
    conn.search(
        base_dn,
        "(|(ou=Groups)(name=Groups))",
        attributes=["distinguishedName", "name", "ou"],
        search_scope=SUBTREE,
        size_limit=20,
    )
    groups_ous = [
        {"dn": _entry_value(entry, "distinguishedName"), "name": _entry_value(entry, "name") or _entry_value(entry, "ou")}
        for entry in conn.entries
    ]
    result["groups_ous"] = groups_ous

    groups_dn = groups_ous[0]["dn"] if groups_ous else None
    if groups_dn:
        conn.search(
            groups_dn,
            "(objectClass=organizationalUnit)",
            attributes=["distinguishedName", "name", "ou"],
            search_scope=LEVEL,
        )
        result["children"] = [
            {"dn": _entry_value(entry, "distinguishedName"), "name": _entry_value(entry, "name") or _entry_value(entry, "ou")}
            for entry in conn.entries
        ]
        for child in result.get("children", []):
            conn.search(
                child["dn"],
                "(&(objectCategory=group)(objectClass=group))",
                attributes=["cn", "distinguishedName", "groupType", "description"],
                search_scope=SUBTREE,
                size_limit=10,
            )
            sample = []
            for entry in conn.entries[:5]:
                group_type = _entry_value(entry, "groupType")
                try:
                    group_type = int(group_type)
                except (TypeError, ValueError):
                    pass
                sample.append(
                    {
                        "cn": _entry_value(entry, "cn"),
                        "dn": _entry_value(entry, "distinguishedName"),
                        "groupType": group_type,
                        "description": str(_entry_value(entry, "description"))[:80],
                    }
                )
            result[f"groups_sample_{child['name']}"] = {"count_found": len(conn.entries), "sample": sample}

    conn.unbind()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
