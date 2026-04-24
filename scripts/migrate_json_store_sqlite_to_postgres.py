from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


JSON_FILES = [
    "unfound_equipment.json",
    "equipment_transfers.json",
    "cartridge_replacements.json",
    "battery_replacements.json",
    "component_replacements.json",
    "pc_cleanings.json",
    "cartridge_database.json",
    "kb_articles.json",
    "kb_cards.json",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate JSONDataManager datasets from SQLite into app-db.")
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
    from backend.appdb.json_store import AppJsonDataStore
    from local_store import SQLiteLocalStore

    database_url = ensure_app_database_configured()
    source = SQLiteLocalStore(db_path=source_db_path)
    target = AppJsonDataStore(database_url=database_url)

    counts: dict[str, int] = {}
    for file_name in JSON_FILES:
        payload = source.load_json(file_name, default_content={} if file_name.endswith("database.json") else [])
        target.save_json(file_name, payload)
        if isinstance(payload, list):
            counts[file_name] = len(payload)
        elif isinstance(payload, dict):
            counts[file_name] = len(payload)
        else:
            counts[file_name] = 0

    print("JSON store migration completed:")
    for file_name in JSON_FILES:
        print(f"  {file_name}={counts.get(file_name, 0)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
