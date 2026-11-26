"""Classify a PR diff into check profiles for the pr-gate workflow.

Reads the list of changed files (one per line, argv file or stdin) and prints
GitHub Actions outputs as `key=value` lines on stdout. Unknown paths never
silently skip checks: they escalate to the full profile.

Usage: python scripts/ci/pr_gate_profile.py <changed-files-list>
"""
from __future__ import annotations

import sys

DOC_SUFFIXES = (".md", ".rst", ".txt", ".adoc")
DOC_PREFIXES = ("documentation/", "docs/", ".project/", ".github/")
DOC_EXACT = {"AGENTS.md", "CONTEXT.md", "README.md", "LICENSE", "CLAUDE.md"}

FRONTEND_PREFIX = "WEB-itinvent/frontend/"
BACKEND_HINTS = ("WEB-itinvent/backend/", "WEB-itinvent/shared/", "tests/")
SCAN_PREFIX = "scan_server/"
VOICE_PREFIX = "voice_server/"
MOBILE_PREFIX = "mobile-hub/"
DESKTOP_PREFIX = "desktop/"
ALEMBIC_HINT = "alembic/versions/"

# Repo-level python glue that affects the backend runtime/tests.
ROOT_PY_HINTS = ("start_server.py", "start_chat_server.py", "requirements.txt", "pytest.ini")


def classify(paths: list[str]) -> dict[str, str]:
    docs_only = bool(paths)
    frontend = backend = scan = voice = migrations = mobile = desktop = False
    unknown = False
    for raw in paths:
        p = raw.strip().strip('"')
        if not p:
            continue
        is_doc = (
            p in DOC_EXACT
            or any(p.startswith(prefix) for prefix in DOC_PREFIXES)
            or (p.endswith(DOC_SUFFIXES) and "/" not in p)
        )
        # A docs file inside a product tree is still product-adjacent documentation;
        # it does not force runtime checks, but it is not "docs-only" for the whole PR
        # unless every other file is docs too.
        if p.endswith(DOC_SUFFIXES) and not is_doc:
            is_doc = True
        if not is_doc:
            docs_only = False
        if p.startswith(FRONTEND_PREFIX):
            frontend = True
        if p.startswith(BACKEND_HINTS) or p in ROOT_PY_HINTS:
            backend = True
        if p.startswith(SCAN_PREFIX):
            scan = True
        if p.startswith(VOICE_PREFIX):
            voice = True
        if p.startswith(MOBILE_PREFIX):
            mobile = True
        if p.startswith(DESKTOP_PREFIX):
            desktop = True
        if ALEMBIC_HINT in p:
            migrations = True
        known = (
            is_doc
            or p.startswith(FRONTEND_PREFIX)
            or p.startswith(BACKEND_HINTS)
            or p.startswith(SCAN_PREFIX)
            or p.startswith(VOICE_PREFIX)
            or p.startswith(MOBILE_PREFIX)
            or p.startswith(DESKTOP_PREFIX)
            or p in ROOT_PY_HINTS
            or p.startswith((".github/", "scripts/", "agent/", "inventory_server/", "shared/", "bot"))
            or "/" not in p  # repo-root loose files are treated as known-low-risk, still not docs
        )
        if not known:
            unknown = True

    runtime_affected = frontend or backend or scan or voice or mobile or desktop or unknown
    if docs_only:
        runtime_affected = False

    # Fail-safe: unknown paths escalate to the full web profile so nothing
    # silently bypasses checks.
    if unknown and not docs_only:
        frontend = True
        backend = True

    # Alembic graph validation is cheap and always runs in the workflow; the
    # output only records whether migration files were part of this diff.
    return {
        "docs_only": str(docs_only).lower(),
        "frontend": str(frontend and not docs_only).lower(),
        "backend": str(backend and not docs_only).lower(),
        "scan": str(scan and not docs_only).lower(),
        "voice": str(voice and not docs_only).lower(),
        "mobile": str(mobile and not docs_only).lower(),
        "desktop": str(desktop and not docs_only).lower(),
        "migrations": str(migrations).lower(),
        "unknown": str(unknown and not docs_only).lower(),
        "runtime_affected": str(runtime_affected).lower(),
    }


def main() -> int:
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as fh:
            paths = fh.read().splitlines()
    else:
        paths = sys.stdin.read().splitlines()
    result = classify(paths)
    for key, value in result.items():
        print(f"{key}={value}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
