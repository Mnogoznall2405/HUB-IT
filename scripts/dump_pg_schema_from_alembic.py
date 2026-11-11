"""List PostgreSQL tables referenced in Alembic migrations (offline)."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSIONS = ROOT / "WEB-itinvent" / "backend" / "alembic" / "versions"

# schema hint from migration context
APP_HINTS = ("schema=app_schema", 'schema="app"', "schema=schema", "schema=_schema()", "schema=APP_SCHEMA")
CHAT_HINTS = ("schema=chat_schema", 'schema="chat"', "schema=CHAT_SCHEMA")
SYSTEM_HINTS = ("schema=system_schema", 'schema="system"', "schema=SYSTEM_SCHEMA")


def _schema_for_block(block: str) -> str:
    if any(h in block for h in CHAT_HINTS):
        return "chat"
    if any(h in block for h in SYSTEM_HINTS):
        return "system"
    return "app"


def main() -> None:
    by_schema: dict[str, set[str]] = {"app": set(), "chat": set(), "system": set()}
    pattern = re.compile(r"op\.create_table\(\s*[\"']([^\"']+)[\"']", re.MULTILINE)

    for path in sorted(VERSIONS.glob("*.py")):
        text = path.read_text(encoding="utf-8")
        for match in pattern.finditer(text):
            name = match.group(1)
            start = max(0, match.start() - 400)
            end = min(len(text), match.end() + 1200)
            block = text[start:end]
            schema = _schema_for_block(block)
            by_schema.setdefault(schema, set()).add(name)

    for schema in ("app", "chat", "system"):
        tables = sorted(by_schema.get(schema, []))
        print(f"\n## {schema} ({len(tables)} tables)")
        for t in tables:
            print(f"- {schema}.{t}")


if __name__ == "__main__":
    main()
