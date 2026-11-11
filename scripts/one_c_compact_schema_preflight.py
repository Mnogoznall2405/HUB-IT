#!/usr/bin/env python3
"""Read-only preflight for 1C compact schema adoption (0080/0081/0082).

Never applies DDL. Prints MATCH / MISSING / EXTRA_SAFE / INCOMPATIBLE /
NOT_PROVEN classifications vs the target shape.

Usage (test DB only recommended):
  python scripts/one_c_compact_schema_preflight.py --database-url <dsn>

Hard-rejects hubit_chat / postgres / template* unless --allow-prod-ro is set
(still read-only; never mutates).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
HARD_REJECT = frozenset({"hubit_chat", "postgres", "template0", "template1"})
ALLOWED_RE = re.compile(
    r"^(hubit_chat_retention_test_.+|hubit_chat_1c_search_test_.+)$",
    re.IGNORECASE,
)

REQUIRED_DOC = {
    "id", "source_base", "generation", "catalog_type", "index_version",
    "entry_ref", "code_normalized", "name_normalized", "search_text",
    "search_tsv", "created_at", "updated_at",
}
REQUIRED_STATS = {
    "id", "source_base", "generation", "catalog_type", "index_version",
    "token", "frequency", "updated_at",
}
REQUIRED_STATE = {
    "source_base", "catalog_type", "generation", "status", "expected_count",
    "indexed_count", "build_version", "checksum", "last_error", "started_at",
    "finished_at", "updated_at", "checkpoint_ref", "checkpoint_offset",
    "active_index_version", "building_index_version", "previous_index_version",
    "source_fingerprint", "previous_cleanup_after",
}
EXPECTED_INDEXES = {
    "ix_app_one_c_catalog_search_documents_code",
    "ix_app_one_c_catalog_search_documents_tsv",
    "ix_app_one_c_catalog_search_documents_trgm",
    "ix_app_one_c_catalog_search_documents_name_prefix",
    "ix_app_one_c_catalog_search_token_stats_prefix",
    "ix_app_one_c_catalog_search_token_stats_trgm",
}
HEAVY_INDEXES = {
    "ix_app_one_c_catalog_search_documents_tsv",
    "ix_app_one_c_catalog_search_documents_trgm",
    "ix_app_one_c_catalog_search_token_stats_trgm",
}


def _normalize_url(raw: str) -> str:
    text = (raw or "").strip()
    for prefix in ("postgresql+psycopg://", "postgresql+psycopg2://"):
        if text.startswith(prefix):
            return "postgresql://" + text[len(prefix) :]
    return text


def _db_name(url: str) -> str:
    return unquote(urlparse(_normalize_url(url)).path or "").lstrip("/").split("/")[0]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default="")
    parser.add_argument(
        "--allow-prod-ro",
        action="store_true",
        help="Allow read-only inspect of non-test DBs (still no DDL/DML)",
    )
    parser.add_argument("--json-out", default="")
    args = parser.parse_args()

    dsn = _normalize_url(
        args.database_url
        or os.getenv("ONE_C_SEARCH_TEST_DATABASE_URL")
        or os.getenv("TEST_DATABASE_URL")
        or ""
    )
    if not dsn:
        print("ERROR: no database URL", file=sys.stderr)
        return 2

    import psycopg

    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            current = str(cur.fetchone()[0])
            # Always refuse cluster templates. Prod hubit_chat allowed only with
            # --allow-prod-ro (still zero DDL/DML in this script).
            if current.casefold() in {"postgres", "template0", "template1"}:
                print(f"REFUSED current_database()={current!r}", file=sys.stderr)
                return 3
            if not ALLOWED_RE.match(current) and not args.allow_prod_ro:
                print(f"REFUSED current_database()={current!r}", file=sys.stderr)
                return 3
            if args.allow_prod_ro and not ALLOWED_RE.match(current):
                # Explicit RO path — still refuse writes by never issuing DDL/DML.
                print(f"RO_AUDIT current_database()={current} (allow-prod-ro)")

            report: dict = {
                "database": current,
                "tables": {},
                "alembic": {},
                "adoption_mode": "NOT_PROVEN",
                "heavy_indexes_deferred": sorted(HEAVY_INDEXES),
                "verdict_axes": {},
            }

            for table, required in (
                ("one_c_catalog_search_documents", REQUIRED_DOC),
                ("one_c_catalog_search_token_stats", REQUIRED_STATS),
                ("one_c_catalog_search_index_state", REQUIRED_STATE),
            ):
                cur.execute(
                    """
                    SELECT EXISTS (
                      SELECT 1 FROM information_schema.tables
                      WHERE table_schema='app' AND table_name=%s
                    )
                    """,
                    (table,),
                )
                exists = bool(cur.fetchone()[0])
                entry: dict = {"exists": exists, "columns": {}, "count": 0, "size_bytes": 0}
                if exists:
                    cur.execute(
                        """
                        SELECT column_name, data_type, udt_name
                        FROM information_schema.columns
                        WHERE table_schema='app' AND table_name=%s
                        """,
                        (table,),
                    )
                    cols = {r[0]: {"data_type": r[1], "udt": r[2]} for r in cur.fetchall()}
                    present = set(cols)
                    missing = sorted(required - present)
                    extra = sorted(present - required)
                    status = "MATCH"
                    if missing:
                        status = "MISSING"
                    if extra:
                        status = "EXTRA_SAFE" if status == "MATCH" else status
                    entry["columns"] = {
                        "status": status,
                        "missing": missing,
                        "extra": extra,
                        "types": cols,
                    }
                    cur.execute(f'SELECT COUNT(*) FROM app."{table}"')
                    entry["count"] = int(cur.fetchone()[0])
                    cur.execute(
                        """
                        SELECT pg_total_relation_size(c.oid)
                        FROM pg_class c
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname='app' AND c.relname=%s
                        """,
                        (table,),
                    )
                    row = cur.fetchone()
                    entry["size_bytes"] = int(row[0]) if row else 0
                else:
                    entry["columns"] = {
                        "status": "MISSING",
                        "missing": sorted(required),
                        "extra": [],
                    }
                report["tables"][table] = entry

            # Indexes
            cur.execute(
                """
                SELECT c.relname, i.indisvalid, i.indisready, pg_get_indexdef(c.oid)
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                JOIN pg_index i ON i.indexrelid = c.oid
                WHERE n.nspname = 'app'
                  AND c.relname LIKE 'ix_app_one_c_catalog_search%%'
                """
            )
            idx = {}
            for name, valid, ready, indexdef in cur.fetchall():
                idx[str(name)] = {
                    "indisvalid": bool(valid),
                    "indisready": bool(ready),
                    "indexdef": str(indexdef or "")[:500],
                }
            missing_idx = sorted(EXPECTED_INDEXES - set(idx))
            report["indexes"] = {
                "present": idx,
                "missing_expected": missing_idx,
                "status": "MATCH" if not missing_idx else "MISSING",
            }

            # Alembic versions (app + public common locations)
            alembic_hits = []
            for schema, table in (
                ("public", "alembic_version"),
                ("app", "alembic_version"),
                ("system", "alembic_version"),
            ):
                cur.execute(
                    """
                    SELECT EXISTS (
                      SELECT 1 FROM information_schema.tables
                      WHERE table_schema=%s AND table_name=%s
                    )
                    """,
                    (schema, table),
                )
                if not cur.fetchone()[0]:
                    continue
                try:
                    cur.execute(f'SELECT version_num FROM "{schema}"."{table}"')
                    versions = [str(r[0]) for r in cur.fetchall()]
                    alembic_hits.append({"schema": schema, "versions": versions})
                except Exception as exc:
                    alembic_hits.append(
                        {"schema": schema, "error": type(exc).__name__}
                    )
            report["alembic"] = {"tables": alembic_hits}
            flat_versions = {
                v
                for hit in alembic_hits
                for v in (hit.get("versions") or [])
            }
            for rev in ("20260804_0080", "20260805_0081", "20260805_0082"):
                report["alembic"][rev] = (
                    "PRESENT" if rev in flat_versions else "MISSING"
                )

            docs_e = report["tables"]["one_c_catalog_search_documents"]["exists"]
            stats_e = report["tables"]["one_c_catalog_search_token_stats"]["exists"]
            state_e = report["tables"]["one_c_catalog_search_index_state"]["exists"]
            if not docs_e and not stats_e and not state_e:
                report["adoption_mode"] = "A_fresh_create"
            elif docs_e and stats_e and state_e:
                any_missing = any(
                    report["tables"][t]["columns"]["status"] == "MISSING"
                    for t in report["tables"]
                )
                counts = sum(report["tables"][t]["count"] for t in report["tables"])
                if any_missing and counts == 0:
                    report["adoption_mode"] = "B_empty_compatible_add_missing"
                elif any_missing and counts > 0:
                    report["adoption_mode"] = "C_incompatible_or_manual"
                else:
                    report["adoption_mode"] = "B_aligned_or_noop"
            else:
                report["adoption_mode"] = "B_partial_create_missing"

            # Origin heuristic
            stamped_0080 = report["alembic"].get("20260804_0080") == "PRESENT"
            if docs_e and not stamped_0080:
                report["table_origin"] = "NOT_PROVEN_create_all_or_manual"
            elif docs_e and stamped_0080:
                report["table_origin"] = "ALEMBIC_0080_PLUS"
            else:
                report["table_origin"] = "ABSENT"

            print(json.dumps(report, ensure_ascii=False, indent=2))
            if args.json_out:
                Path(args.json_out).write_text(
                    json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
