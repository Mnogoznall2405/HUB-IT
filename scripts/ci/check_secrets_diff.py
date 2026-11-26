"""Secret scan on added lines of a diff. Findings are redacted in output.

Usage: python scripts/ci/check_secrets_diff.py <unified-diff-file>
Exit 0 = no findings, 1 = potential secrets found.
"""
from __future__ import annotations

import re
import sys

PATTERNS = [
    ("private key block", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY")),
    ("aws access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("generic api token assignment", re.compile(r"(?i)(api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*['\"]?([^\s'\"]{12,})")),
    ("bearer token literal", re.compile(r"(?i)bearer\s+[a-z0-9_\-.]{20,}")),
    ("jwt literal", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
    ("postgres/mysql dsn with password", re.compile(r"(?i)(postgres(?:ql)?|mysql|mongodb)://[^\s:@/]+:[^\s@/]+@")),
    ("telegram bot token", re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b")),
]

# Placeholders and documented dummy values that must not fire.
ALLOWLIST = re.compile(
    r"(?i)(example|placeholder|dummy|changeme|change-me|xxxxx|yyyyy|<[a-z_]+>|\$\{|\%\(|\.\.\.|test[_-]?only|not-a-real)",
)


def redact(line: str) -> str:
    # Keep the shape of the line but blank out anything after typical secret separators.
    out = re.sub(r"([=:]\s*['\"]?)([^\s'\"]{4})[^\s'\"]*", r"\1\2…<redacted>", line)
    return out[:160]


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: check_secrets_diff.py <diff-file>", file=sys.stderr)
        return 2
    with open(sys.argv[1], encoding="utf-8", errors="replace") as fh:
        lines = fh.read().splitlines()

    findings: list[str] = []
    current_file = ""
    for line in lines:
        if line.startswith("+++ b/"):
            current_file = line[6:]
            continue
        if not line.startswith("+") or line.startswith("+++"):
            continue
        content = line[1:]
        if ALLOWLIST.search(content):
            continue
        for name, pattern in PATTERNS:
            if pattern.search(content):
                findings.append(f"{current_file}: {name}: {redact(content)}")
                break

    if findings:
        print(f"secret scan: {len(findings)} potential finding(s) — verify before merging")
        for item in findings[:30]:
            print("  " + item)
        return 1
    print("secret scan: no findings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
