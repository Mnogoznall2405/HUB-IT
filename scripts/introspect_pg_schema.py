"""CLI: refresh PostgreSQL schema documentation from live DB."""
from __future__ import annotations

from pg_schema_docs import refresh_pg_schema_documentation


def main() -> None:
    refresh_pg_schema_documentation(quiet=False)


if __name__ == "__main__":
    main()
