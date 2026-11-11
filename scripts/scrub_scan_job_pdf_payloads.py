from __future__ import annotations

import argparse
from pathlib import Path

from scan_server.maintenance import scrub_scan_job_pdf_payloads


def main() -> int:
    parser = argparse.ArgumentParser(description="Remove legacy pdf_slice_b64 fields from scan_jobs.payload_json")
    parser.add_argument(
        "--db-path",
        default=str(Path("data") / "scan_server" / "scan_server.db"),
        help="Path to scan_server SQLite database",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=200,
        help="Rows to rewrite per batch",
    )
    parser.add_argument(
        "--vacuum",
        action="store_true",
        help="Run VACUUM after cleanup",
    )
    args = parser.parse_args()

    result = scrub_scan_job_pdf_payloads(
        db_path=Path(args.db_path),
        batch_size=max(1, int(args.batch_size)),
        vacuum=bool(args.vacuum),
    )
    print(
        "updated_rows={updated_rows} scanned_rows={scanned_rows} vacuum_ran={vacuum_ran}".format(
            **result,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
