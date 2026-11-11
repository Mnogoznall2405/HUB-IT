from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate inventory cache/change-history from SQLite into app-db.")
    parser.add_argument("--source-db-path", required=True, help="Path to the source internal SQLite database.")
    parser.add_argument("--target-database-url", help="Target APP_DATABASE_URL. Defaults to current env.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    project_root = Path(__file__).resolve().parents[1]
    web_root = project_root / "WEB-itinvent"
    source_db_path = Path(args.source_db_path).expanduser().resolve()

    if not source_db_path.exists():
        raise SystemExit(f"Source SQLite database does not exist: {source_db_path}")

    if args.target_database_url:
        os.environ["APP_DATABASE_URL"] = str(args.target_database_url).strip()

    if str(web_root) not in sys.path:
        sys.path.insert(0, str(web_root))
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    from backend.config import reload_runtime_config

    reload_runtime_config()

    from backend.appdb.db import ensure_app_database_configured
    from backend.appdb.inventory_store import AppInventoryStore
    from local_store import SQLiteLocalStore

    database_url = ensure_app_database_configured()
    store = SQLiteLocalStore(db_path=source_db_path)
    snapshot = store.load_json("agent_inventory_cache.json", default_content={})
    changes = store.load_json("agent_inventory_changes.json", default_content=[])

    if not isinstance(snapshot, dict):
        snapshot = {}
    if not isinstance(changes, list):
        changes = []

    target = AppInventoryStore(database_url=database_url)
    target.replace_from_legacy(snapshot, [item for item in changes if isinstance(item, dict)])

    print("Inventory migration completed:")
    print(f"  inventory_hosts={len(snapshot)}")
    print(f"  inventory_change_events={len(changes)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
