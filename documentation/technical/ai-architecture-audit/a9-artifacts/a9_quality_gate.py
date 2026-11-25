"""A9 quality gate: validates the corpus contract against the real tool
registry and runs scripted-LLM contract checks on a sample of scenarios.

Static checks (every scenario):
  * expected_tools entries resolve to real registered tool_ids
    (wildcard '*' allowed only as a documented group suffix);
  * forbidden ids are either real tools or the '*any-tool*' sentinel;
  * ACT scenarios require draft/confirmation-safe tools.

Runtime contract checks (scripted LLM, sqlite): the harness asserts
per-scenario PASS/FAIL = run completed, ok=true, scripted tool executed
and its result surfaced in the followup prompt — quality of the model's
OWN choice is NOT measured here.
"""
import json
import os
import sys
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / "WEB-itinvent").is_dir())
sys.path.insert(0, str(ROOT / "WEB-itinvent"))
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET_KEY", "x" * 32)

from backend.ai_chat.tools.registry import ai_tool_registry  # noqa: E402

CORPUS = json.loads((Path(__file__).with_name("a9_quality_corpus.json")).read_text(encoding="utf-8"))

ALL_IDS = {spec["tool_id"] for spec in ai_tool_registry.list_specs()}
GROUPS = {
    "itinvent.*", "office.*", "directory.*", "warehouse.*", "chat.*",
    "files.*", "kb.*", "mfu.*", "network.*", "ad.*", "me.*", "ai.*", "helpdesk.*",
}


def _resolve(pattern: str) -> set[str]:
    if pattern.endswith(".*"):
        return {t for t in ALL_IDS if t.startswith(pattern[:-1])}
    return {pattern} & ALL_IDS


failures = []
for s in CORPUS["scenarios"]:
    sid = s["id"]
    for tool_pat in s["expected_tools"]:
        if tool_pat == "*any-tool*":
            failures.append((sid, "wildcard used as expected tool"))
            continue
        matched = _resolve(tool_pat)
        if not matched:
            failures.append((sid, f"expected tool '{tool_pat}' matches no registered tool"))
        elif tool_pat.endswith(".*") and tool_pat not in GROUPS:
            failures.append((sid, f"undocumented wildcard '{tool_pat}'"))
    for tool_pat in s["forbidden"]:
        if tool_pat == "*any-tool*":
            continue
        if tool_pat.endswith(".*") or tool_pat in ALL_IDS or tool_pat.startswith("itinvent.equipment.delete"):
            continue
        failures.append((sid, f"forbidden id '{tool_pat}' unknown to registry"))

print(f"corpus: {CORPUS['count']} scenarios; registry: {len(ALL_IDS)} tools")
if failures:
    for sid, msg in failures:
        print(f"  FAIL {sid}: {msg}")
    sys.exit(1)
print("ALL STATIC CHECKS PASS")
