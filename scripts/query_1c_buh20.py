# -*- coding: utf-8 -*-
"""Generic runner for ad-hoc 1C query language reports against the
Бухгалтерия 2.0 (buh20) infobase, via V83.COMConnector (Windows only).

Query texts are kept as plain .txt files under scripts/1c_queries/ so they
can be reviewed/edited without touching this script. Add a new query by
dropping a .txt file there and passing its name (without extension) via
--query.

Usage:
    python scripts/query_1c_buh20.py --query buh20_ostatki --limit 5
    python scripts/query_1c_buh20.py --query buh20_vedomost_s_dengami --limit 5 --output out.csv

Credentials are read from BUH20_1C_SERVER / BUH20_1C_REF / BUH20_1C_USER /
BUH20_1C_PASSWORD environment variables (see .env), or can be overridden via
CLI flags.
"""
from __future__ import annotations

import argparse
import csv
import getpass
import os
import re
import sys
from pathlib import Path
from typing import Any

import win32com.client


DEFAULT_SERVER = "tmn-srv-1c-01.zsgp.corp,tmn-srv-1c-02.zsgp.corp"
DEFAULT_REF = "buh20"
QUERIES_DIR = Path(__file__).parent / "1c_queries"

# Matches the leading "ВЫБРАТЬ [РАЗЛИЧНЫЕ|РАЗРЕШЕННЫЕ ...]" clause of the
# outermost SELECT so we can inject a "ПЕРВЫЕ N" row cap for safe testing.
_SELECT_HEAD_RE = re.compile(
    r"(ВЫБРАТЬ\s*(?:РАЗРЕШЕННЫЕ\s+)?(?:РАЗЛИЧНЫЕ\s+)?)",
    re.IGNORECASE,
)


def configure_stdout() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a saved 1C query (scripts/1c_queries/*.txt) against buh20."
    )
    parser.add_argument(
        "--query",
        required=True,
        help="Query file name without extension, e.g. buh20_ostatki (looked up in scripts/1c_queries/).",
    )
    parser.add_argument("--server", default=os.environ.get("BUH20_1C_SERVER", DEFAULT_SERVER))
    parser.add_argument("--ref", default=os.environ.get("BUH20_1C_REF", DEFAULT_REF))
    parser.add_argument("--user", default=os.environ.get("BUH20_1C_USER"))
    parser.add_argument("--password", default=os.environ.get("BUH20_1C_PASSWORD"))
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="Row cap injected as 'ПЕРВЫЕ N' after the outer ВЫБРАТЬ. 0 = no cap (careful, tables can be huge).",
    )
    parser.add_argument("--output", help="Optional CSV path to write the full result set.")
    parser.add_argument(
        "--preview-rows",
        type=int,
        default=20,
        help="How many rows to print to the console (independent from --limit/--output).",
    )
    return parser.parse_args()


def quote_1c(value: str) -> str:
    return value.replace('"', '""')


def build_connection_string(server: str, ref: str, user: str, password: str) -> str:
    return (
        f'Srvr="{quote_1c(server)}";'
        f'Ref="{quote_1c(ref)}";'
        f'Usr="{quote_1c(user)}";'
        f'Pwd="{quote_1c(password)}";'
    )


def connect(connection_string: str) -> Any:
    connector = win32com.client.Dispatch("V83.COMConnector")
    return connector.Connect(connection_string)


def load_query_text(name: str) -> str:
    path = QUERIES_DIR / f"{name}.txt"
    if not path.exists():
        raise FileNotFoundError(f"Query file not found: {path}")
    text = path.read_text(encoding="utf-8")
    # Saved files start with a human title line (e.g. "Остатки") followed by
    # a blank line before the real "ВЫБРАТЬ ..." query text.
    if "\n\n" in text:
        _, _, remainder = text.partition("\n\n")
        if _SELECT_HEAD_RE.search(remainder):
            return remainder
    return text


def apply_row_limit(query_text: str, limit: int) -> str:
    if limit <= 0:
        return query_text
    return _SELECT_HEAD_RE.sub(rf"\1ПЕРВЫЕ {limit} ", query_text, count=1)


def one_c_text(connection: Any, value: Any) -> str:
    if value is None:
        return ""
    try:
        return connection.String(value)
    except Exception:
        return str(value)


def run_query(connection: Any, query_text: str) -> tuple[list[str], list[list[str]]]:
    query = connection.NewObject("Query")
    query.Text = query_text
    result = query.Execute()

    columns = result.Columns
    column_names = [columns.Get(i).Name for i in range(columns.Count())]

    rows: list[list[str]] = []
    selection = result.Select()
    while selection.Next():
        rows.append([one_c_text(connection, selection.Get(i)) for i in range(len(column_names))])

    return column_names, rows


def print_preview(column_names: list[str], rows: list[list[str]], preview_rows: int) -> None:
    print(f"\nColumns ({len(column_names)}): {', '.join(column_names)}")
    print(f"Rows returned: {len(rows)}")
    for row in rows[:preview_rows]:
        print(" | ".join(row))


def write_csv(path: Path, column_names: list[str], rows: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.writer(output, delimiter=";")
        writer.writerow(column_names)
        writer.writerows(rows)


def main() -> int:
    configure_stdout()
    args = parse_args()

    if not args.user:
        args.user = input(f"1C user ({args.ref}): ").strip()
    password = args.password
    if not password:
        password = getpass.getpass("1C password: ")

    query_text = load_query_text(args.query)
    query_text = apply_row_limit(query_text, args.limit)

    connection_string = build_connection_string(args.server, args.ref, args.user, password)
    print(f"Connecting to 1C: server={args.server}; ref={args.ref}; user={args.user}")
    connection = connect(connection_string)
    print("CONNECT OK")

    try:
        column_names, rows = run_query(connection, query_text)
    except Exception as exc:
        print(f"QUERY FAILED: {exc}")
        return 1

    print_preview(column_names, rows, args.preview_rows)

    if args.output:
        output_path = Path(args.output)
        write_csv(output_path, column_names, rows)
        print(f"\nWrote CSV: {output_path} ({len(rows)} rows)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
