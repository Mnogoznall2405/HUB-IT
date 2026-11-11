#!/usr/bin/env python3
"""Run pytest files one by one and print a compact summary."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS = sorted((ROOT / "tests").glob("test_*.py"))
LOG = ROOT / "test-run-sequential.log"


def run_one(path: Path) -> tuple[str, str, str]:
    rel = path.relative_to(ROOT).as_posix()
    cmd = [
        sys.executable,
        "-m",
        "pytest",
        rel,
        "-q",
        "--tb=line",
        "--disable-warnings",
    ]
    proc = subprocess.run(
        cmd,
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    tail = (proc.stdout + proc.stderr).strip().splitlines()
    summary = tail[-1] if tail else f"exit={proc.returncode}"
    if proc.returncode == 0:
        status = "PASS"
    elif "ERROR collecting" in (proc.stdout + proc.stderr) or "Interrupted:" in (proc.stdout + proc.stderr):
        status = "ERROR"
    else:
        status = "FAIL"
    return status, rel, summary


def main() -> int:
    lines: list[str] = []
    counts = {"PASS": 0, "FAIL": 0, "ERROR": 0}
    failed: list[str] = []
    errors: list[str] = []

    print(f"Running {len(TESTS)} python test files sequentially...")
    for idx, path in enumerate(TESTS, start=1):
        status, rel, summary = run_one(path)
        counts[status] += 1
        line = f"[{idx:3}/{len(TESTS)}] {status:5} {rel} :: {summary}"
        print(line, flush=True)
        lines.append(line)
        if status == "FAIL":
            failed.append(rel)
        elif status == "ERROR":
            errors.append(rel)

    print("\n=== Python summary ===")
    print(f"PASS : {counts['PASS']}")
    print(f"FAIL : {counts['FAIL']}")
    print(f"ERROR: {counts['ERROR']}")

    if errors:
        print("\nCollection/import errors:")
        for rel in errors:
            print(f"  - {rel}")

    if failed:
        print("\nFailed suites:")
        for rel in failed:
            print(f"  - {rel}")

    LOG.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\nLog saved to {LOG}")
    return 0 if counts["FAIL"] == 0 and counts["ERROR"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
