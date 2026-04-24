from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate VCS local-store data into PostgreSQL app schema.")
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
    from backend.appdb.models import AppGlobalSetting, AppVcsComputer
    from local_store import SQLiteLocalStore

    def _parse_dt(value):
        text = str(value or "").strip()
        if not text:
            return datetime.now(timezone.utc)
        return datetime.fromisoformat(text.replace("Z", "+00:00"))

    database_url = ensure_app_database_configured()
    initialize_app_schema(database_url)

    store = SQLiteLocalStore(db_path=source_db_path)
    computers = store.load_json("vcs_computers.json", default_content=[])
    config_payload = store.load_json("vcs_config.json", default_content={"password_hex_encrypted": ""})
    info_payload = store.load_json("vcs_info.json", default_content={"content": ""})

    if not isinstance(computers, list):
        computers = []
    if not isinstance(config_payload, dict):
        config_payload = {"password_hex_encrypted": ""}
    if not isinstance(info_payload, dict):
        info_payload = {"content": ""}

    with app_session(database_url) as session:
        session.query(AppVcsComputer).delete()
        for item in computers:
            payload = item if isinstance(item, dict) else {}
            normalized_id = str(payload.get("id") or "").strip()
            if not normalized_id:
                continue
            session.add(
                AppVcsComputer(
                    id=normalized_id,
                    name=str(payload.get("name") or "").strip(),
                    ip_address=str(payload.get("ip_address") or "").strip(),
                    location=str(payload.get("location") or "").strip() or None,
                    created_at=_parse_dt(payload.get("created_at")),
                    updated_at=_parse_dt(payload.get("updated_at")),
                )
            )
        for key, payload in (("vcs_config", config_payload), ("vcs_info", info_payload)):
            row = session.get(AppGlobalSetting, key)
            if row is None:
                row = AppGlobalSetting(key=key)
                session.add(row)
            row.value_json = json.dumps(payload, ensure_ascii=False)

    print("VCS migration completed:")
    print(f"  vcs_computers={len(computers)}")
    print(f"  vcs_config={1 if config_payload else 0}")
    print(f"  vcs_info={1 if info_payload else 0}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
