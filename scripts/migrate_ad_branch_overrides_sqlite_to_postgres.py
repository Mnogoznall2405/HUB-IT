from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate AD branch override mappings from local-store SQLite into PostgreSQL app schema.")
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

    from backend.appdb.db import app_session, ensure_app_database_configured, initialize_app_schema
    from backend.appdb.models import AppAdUserBranchOverride
    from local_store import SQLiteLocalStore

    database_url = ensure_app_database_configured()
    initialize_app_schema(database_url)

    store = SQLiteLocalStore(db_path=source_db_path)
    overrides = store.load_json("ad_user_branches.json", default_content={})
    if not isinstance(overrides, dict):
        overrides = {}

    count = 0
    with app_session(database_url) as session:
        session.query(AppAdUserBranchOverride).delete()
        for login, branch_no in overrides.items():
            normalized_login = str(login or "").strip().lower()
            if not normalized_login:
                continue
            try:
                normalized_branch = int(branch_no)
            except (TypeError, ValueError):
                continue
            session.add(AppAdUserBranchOverride(login=normalized_login, branch_no=normalized_branch))
            count += 1

    print("AD branch override migration completed:")
    print(f"  ad_user_branch_overrides={count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
