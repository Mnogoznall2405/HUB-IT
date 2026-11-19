"""Seed ``app.agent_api_keys`` from the env bound-key maps (one-off migration).

``SCAN_AGENT_API_KEYS`` and ``INVENTORY_AGENT_API_KEYS`` entries are inserted
with ``ON CONFLICT DO NOTHING`` — auto-enrolled rows already in the table are
kept authoritative. Keys are never printed.

Usage: python scripts/scan/seed_agent_keys_db.py [--dry-run]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "WEB-itinvent"))


def _read_env(name: str) -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8", errors="ignore").splitlines():
        m = re.match(rf"^{name}=(.*)$", line.strip())
        if m:
            return m.group(1).strip().strip("'\"")
    return ""


def _parse_map(raw: str) -> dict:
    out = {}
    for pair in (raw or "").split(","):
        pair = pair.strip()
        if "=" in pair:
            n, _, k = pair.partition("=")
            if n.strip() and k.strip():
                out[n.strip()] = k.strip()
    return out


def main() -> int:
    dry = "--dry-run" in sys.argv
    import sqlalchemy as sa
    from backend.appdb import agent_api_keys
    from scan_server.db import get_scan_engine

    engine = get_scan_engine(_read_env("SCAN_DATABASE_URL"))
    table = agent_api_keys._table(engine)
    scan_map = _parse_map(_read_env("SCAN_AGENT_API_KEYS"))
    inv_map = _parse_map(_read_env("INVENTORY_AGENT_API_KEYS"))
    inv_by_lower = {n.lower(): (n, k) for n, k in inv_map.items()}

    names = sorted(scan_map | inv_map, key=str.lower)
    inserted = skipped = 0
    for name in names:
        scan_key = scan_map.get(name, "")
        inv_entry = inv_map.get(name) or inv_by_lower.get(name.lower())
        hostname, inv_key = (inv_entry if inv_entry else (name, ""))
        if dry:
            print(f"{name}: would seed (scan={'yes' if scan_key else 'no'} inv={'yes' if inv_key else 'no'})")
            inserted += 1
            continue
        with engine.connect() as conn:
            exists = conn.execute(
                sa.text(f"SELECT 1 FROM {table} WHERE agent_id=:n"), {"n": name}
            ).first()
        if exists:
            skipped += 1
            continue
        if agent_api_keys.upsert_keypair(
            engine, name, hostname=hostname, scan_key=scan_key, inv_key=inv_key, source="env"
        ):
            inserted += 1
        else:
            skipped += 1
    print(f"seeded={inserted} already_present={skipped} total_map_names={len(names)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
