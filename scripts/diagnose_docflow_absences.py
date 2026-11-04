"""Read-only absence smoke: personal COM worker + reconciliation; totals only."""
from __future__ import annotations

import argparse
from datetime import date
import json
import logging
import os
from pathlib import Path
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "WEB-itinvent"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", type=int, required=True)
    parser.add_argument("--on", type=date.fromisoformat, default=date.today())
    args = parser.parse_args()
    # This flag applies only to this explicitly invoked read-only process.
    # Neither .env nor the running backend is changed.
    os.environ["DOCFLOW_ABSENCES_ENABLED"] = "1"
    logging.disable(logging.CRITICAL)
    from sqlalchemy import text
    from backend.appdb.db import get_app_engine
    from backend.services.docflow_absence_service import DocflowAbsenceService

    def read_one(statement, parameters):
        with get_app_engine().connect() as connection:
            if connection.dialect.name != "postgresql":
                raise RuntimeError("Smoke requires an explicit PostgreSQL application database")
            connection.execute(text("SET TRANSACTION READ ONLY"))
            connection.execute(text("SET LOCAL statement_timeout = 10000"))
            return connection.execute(text(statement), parameters).mappings().one_or_none()

    def profile(uid):
        row = read_one(
            "SELECT login,password_enc FROM app.docflow_credentials WHERE user_id=:uid", {"uid": uid},
        )
        return SimpleNamespace(**row) if row else None

    def cache():
        row = read_one(
            "SELECT payload_json FROM app.json_documents WHERE file_name=:name", {"name": "address_book_cache.json"},
        )
        return json.loads(row["payload_json"]) if row else {}

    service = DocflowAbsenceService(store=SimpleNamespace(get=profile), source=SimpleNamespace(load_cache=cache))
    try:
        result = service.list_absences(user_id=args.user_id, on=args.on)
        print(json.dumps({
            "status": result["status"], "on": result["on"], "count": result["count"],
            "matched_count": sum(item["matching_status"] == "matched" for item in result["items"]),
            "unresolved_count": result["unresolved_count"], "zup_comparison": result["zup_comparison"],
            "with_differences": sum(bool(item["differences"]) for item in result["items"]),
            "with_comment": sum(bool(item["comment"]) for item in result["items"]),
        }, ensure_ascii=True))
        return 0
    except Exception as exc:
        print(json.dumps({"status": "error", "error_type": type(exc).__name__}))
        return 1
    finally:
        service.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
