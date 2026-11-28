"""Aggregate pr-gate job results into one stable final verdict.

Reads `NEEDS_JSON` (GitHub Actions `toJSON(needs)`) and the profile outputs
passed as env vars, then distinguishes:
  - expected skip (profile says the job was not needed)
  - cancellation
  - failure
Exit 0 = gate passed, 1 = gate failed. A human-readable summary goes to
stdout (the workflow tees it into GITHUB_STEP_SUMMARY).
"""
from __future__ import annotations

import json
import os
import sys

# job name -> profile output that justifies a skip (None = always required)
CONDITIONAL_JOBS = {
    "frontend": "frontend",
    "backend": "backend",
}
REQUIRED_JOBS = ["prepare", "hygiene", "alembic"]


def main() -> int:
    raw = os.environ.get("NEEDS_JSON", "{}")
    try:
        needs = json.loads(raw)
    except json.JSONDecodeError:
        print(f"GATE FAIL — unable to parse needs json: {raw[:200]}")
        return 1

    lines: list[str] = []
    problems: list[str] = []
    lines.append("| job | result | evaluation |")
    lines.append("|---|---|---|")

    for job in REQUIRED_JOBS + sorted(CONDITIONAL_JOBS):
        info = needs.get(job)
        if info is None:
            problems.append(f"{job}: missing from needs graph")
            lines.append(f"| {job} | — | MISSING |")
            continue
        result = info.get("result", "unknown")
        if job in CONDITIONAL_JOBS:
            wanted = os.environ.get(f"PROFILE_{CONDITIONAL_JOBS[job].upper()}", "false")
            if result == "skipped":
                if wanted == "true":
                    problems.append(f"{job}: unexpectedly skipped although profile requires it")
                    evaluation = "UNEXPECTED SKIP"
                else:
                    evaluation = "expected skip (not in profile)"
            elif result == "success":
                evaluation = "pass"
            elif result == "cancelled":
                problems.append(f"{job}: cancelled")
                evaluation = "CANCELLED"
            else:
                problems.append(f"{job}: {result}")
                evaluation = "FAILURE"
        else:
            if result == "success":
                evaluation = "pass"
            elif result == "cancelled":
                problems.append(f"{job}: cancelled")
                evaluation = "CANCELLED"
            elif result == "skipped":
                problems.append(f"{job}: required job was skipped")
                evaluation = "UNEXPECTED SKIP"
            else:
                problems.append(f"{job}: {result}")
                evaluation = "FAILURE"
        lines.append(f"| {job} | {result} | {evaluation} |")

    for line in lines:
        print(line)
    print()
    if problems:
        print(f"PR Gate: FAIL — {'; '.join(problems)}")
        return 1
    print("PR Gate: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
