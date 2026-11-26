"""Diff hygiene checks: conflict markers and whitespace errors on the diff only.

Usage: python scripts/ci/check_diff_hygiene.py <unified-diff-file>
Exit 0 = clean, 1 = violations found.
"""
from __future__ import annotations

import re
import sys

CONFLICT_MARKER = re.compile(r"^(<{7}|={7}|>{7})(?:\s|$)")
WHITESPACE_TAIL = re.compile(r"[ \t]+$")


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: check_diff_hygiene.py <diff-file>", file=sys.stderr)
        return 2
    with open(sys.argv[1], encoding="utf-8", errors="replace") as fh:
        lines = fh.read().splitlines()

    problems: list[str] = []
    current_file = ""
    added_lineno = 0
    for line in lines:
        if line.startswith("+++ b/"):
            current_file = line[6:]
            continue
        if line.startswith("@@"):
            match = re.search(r"\+(\d+)", line)
            added_lineno = int(match.group(1)) - 1 if match else 0
            continue
        if line.startswith("+") and not line.startswith("+++"):
            added_lineno += 1
            content = line[1:]
            if CONFLICT_MARKER.match(content):
                problems.append(f"{current_file}:{added_lineno}: conflict marker")
            if WHITESPACE_TAIL.search(content):
                problems.append(f"{current_file}:{added_lineno}: trailing whitespace")
            if "\t" in content and WHITESPACE_TAIL.search(content.rstrip("\t") + "\t"):
                pass  # covered by trailing whitespace rule above
        elif not line.startswith("-"):
            # context line advances the new-file line counter as well
            if line.startswith(" "):
                added_lineno += 1

    if problems:
        print(f"diff hygiene: {len(problems)} violation(s)")
        for item in problems[:50]:
            print("  " + item)
        if len(problems) > 50:
            print(f"  … and {len(problems) - 50} more")
        return 1
    print("diff hygiene: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
