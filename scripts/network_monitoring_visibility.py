"""Transactional release helper for monitoring-only network registry cards.

The caller supplies the reviewed {registry ID: management IP} set and owns the
transaction. No equipment or monitoring history is deleted by this operation.
"""
import json
from datetime import datetime, timezone

from sqlalchemy import bindparam, text


def set_visibility(connection, selected, *, hidden):
    """Verify identities/dependencies, then change visibility and audit each card."""
    prefix = "app." if connection.dialect.name == "postgresql" else ""
    statement = text(f"SELECT * FROM {prefix}network_devices WHERE id IN :ids ORDER BY id" +
                     (" FOR UPDATE" if connection.dialect.name == "postgresql" else ""))
    rows = connection.execute(statement.bindparams(bindparam("ids", expanding=True)), {"ids": list(selected)}).mappings().all()
    if len(rows) != len(selected) or not rows:
        raise ValueError("Enrollment cards missing")
    if any(row["mgmt_ip"] != selected[row["id"]] or str(row["vendor"]).lower() != "mikrotik" for row in rows):
        raise ValueError("Enrollment identity changed")
    for table in ("network_ports", "network_sockets", "network_map_points"):
        dependencies = text(f"SELECT count(*) FROM {prefix}{table} WHERE device_id IN :ids").bindparams(bindparam("ids", expanding=True))
        if connection.execute(dependencies, {"ids": list(selected)}).scalar_one():
            raise ValueError("Wire-map dependencies require review")
    before = [dict(row) for row in rows]
    changed = []
    for row in rows:
        if row["monitoring_only"] == int(hidden):
            continue
        connection.execute(text(f"UPDATE {prefix}network_devices SET monitoring_only=:hidden WHERE id=:id"), {"hidden": int(hidden), "id": row["id"]})
        connection.execute(text(f"INSERT INTO {prefix}network_audit_log(branch_id,entity_type,entity_id,action,diff_json,actor_role,created_at) VALUES(:branch,'device',:id,:action,:diff,'system',:now)"),
                           {"branch": row["branch_id"], "id": str(row["id"]),
                            "action": "hide_from_networks" if hidden else "restore_to_networks",
                            "diff": json.dumps({"before": {"monitoring_only": row["monitoring_only"]}, "after": {"monitoring_only": int(hidden)}}),
                            "now": datetime.now(timezone.utc).isoformat()})
        changed.append(row["id"])
    return {"before": before, "changed_ids": changed, "hidden": hidden}
