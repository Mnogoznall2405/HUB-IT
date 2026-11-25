# -*- coding: utf-8 -*-
"""A11 §6: offline evaluation of JEV group routing — precision/recall/confusion
matrix with the top-1 rescue feature ON vs OFF (AI_JEV_TOP1_RESCUE).

What is measured and what is not
=================================
JEV group classification is fully LLM-driven: ``_route_tool_groups_jev`` sends
the routing state + typed questions to the remote System One endpoint
(``typesafe/jev-1.14``) and post-processes the returned probabilities. There is
NO local classifier to benchmark — an honest end-to-end accuracy number
requires the real API. This script therefore measures three things offline:

1. REPLAY — real recorded JEV probability vectors harvested from the
   ``real_run_*.json`` benchmark artifacts of cycles A9–A11 (828 raw vectors,
   filtered to corpus-verifiable samples). Each vector is replayed through the
   CURRENT decision layer (threshold + top-1 rescue + mode precedence) with the
   rescue flag ON and OFF, and the routed groups are compared with the corpus
   ground truth. This is a true end-to-end measurement of routing quality —
   the classifier outputs are real model outputs, only the network is cut out.

2. SWEEP — a synthetic decision-layer measurement: every corpus prompt is
   evaluated with the correct group pinned at calibrated probability levels
   (0.05…0.95). This isolates the post-processing logic (rescue band
   [max(0.2, thr/2), thr)) with full group coverage — it says nothing about
   the classifier itself, only about what the decision layer does with its
   outputs.

3. LIVE (not run here) — ``--live`` would call the real System One API for
   every corpus prompt and record fresh vectors. NOT executed in this cycle:
   the task forbids real LLM API calls and both provider accounts are
   documented as out of credit (AI_A11_CYCLE2_PROGRESS.md). ``--dry-run``
   (default) validates the dataset and prints what would be sent.

Corpus truth mapping
====================
Run artifacts record scenario ids, not prompts. The same id means DIFFERENT
prompts in a9_quality_corpus vs bench_intel_corpus, so each artifact is
fingerprinted: ``expected_hit``/``expected_missing`` recorded by the harness
are compared against every corpus; a run is bound to a corpus only when the
evidence is consistent and one-sided. Runs whose corpus_sha256 matches a
corpus file in the tree are bound exactly. Everything else is excluded and
counted.

Usage (offline, safe):
    python documentation/technical/ai-architecture-audit/a9-artifacts/jev_eval.py --dry-run
    python documentation/technical/ai-architecture-audit/a9-artifacts/jev_eval.py   # same, writes report
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from types import SimpleNamespace

ARTIFACTS_DIR = Path(__file__).resolve().parent
ROOT = next(p for p in ARTIFACTS_DIR.parents if (p / "WEB-itinvent").is_dir())
REPORT_PATH = ARTIFACTS_DIR / "jev_eval_report.json"

# --- environment for importing the backend service (mirrors tests/conftest) ---
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET_KEY", "jev-eval-offline-only-not-a-secret-000")
_runtime = ROOT / ".pytest_runtime"
_runtime.mkdir(parents=True, exist_ok=True)
os.environ["APP_DATABASE_URL"] = f"sqlite:///{(_runtime / 'jev_eval_app.sqlite3').as_posix()}"
os.environ["CHAT_DATABASE_URL"] = f"sqlite:///{(_runtime / 'jev_eval_chat.sqlite3').as_posix()}"
os.environ.setdefault("SCAN_DATABASE_URL", "")
# Routing is exercised, never the network: the decide() client is replaced.
os.environ["AI_JEV_ROUTING"] = "1"
os.environ["AI_JEV_ROUTING_MODE"] = "group"

for _p in (str(ROOT), str(ROOT / "WEB-itinvent")):
    if _p not in sys.path:
        sys.path.insert(0, _p)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="offline only; print dataset summary without writing the report")
    parser.add_argument("--live", action="store_true",
                        help="call the real System One API for corpus prompts (NOT used in this cycle)")
    parser.add_argument("--out", default=str(REPORT_PATH))
    parser.add_argument("--threshold", default="0.5")
    return parser.parse_args()


# ---------------------------------------------------------------------------
# corpus loading / group mapping
# ---------------------------------------------------------------------------

CORPUS_FILES = (
    "bench_intel_corpus.json",
    "a9_quality_corpus.json",
    "bench_seeded_corpus.json",
    "a10_round_corpus.json",
)

# tool-id prefix -> JEV group, mirroring get_tool_group() in
# backend/ai_chat/tools/context.py. 'ai.files.*' is the files group;
# 'ai.*' meta tools carry no domain group and are dropped from expectations.
_PREFIX_TO_GROUP = {
    "itinvent": "itinvent",
    "office": "office",
    "mfu": "mfu",
    "network": "network",
    "ad": "ad",
    "kb": "kb",
    "chat": "chat",
    "me": "self",
    "helpdesk": "self",
    "directory": "directory",
    "warehouse": "warehouse",
}


def tool_id_to_group(tool_id: str) -> str | None:
    tid = str(tool_id or "").strip().lower()
    if not tid or tid == "*any-tool*":
        return None
    if tid.startswith("ai.files"):
        return "files"
    prefix = tid.split(".")[0]
    if prefix == "ai":
        return None  # meta tools (request_tool_group etc.) — no domain group
    return _PREFIX_TO_GROUP.get(prefix, "other")


def expected_groups_of(scenario: dict) -> set[str]:
    groups = set()
    for tool_id in scenario.get("expected_tools") or []:
        group = tool_id_to_group(tool_id)
        if group and group != "other":
            groups.add(group)
    return groups


def scenario_prompt(scenario: dict) -> str:
    prompt = str(scenario.get("prompt") or "").strip()
    if prompt:
        return prompt
    turns = scenario.get("turns") or []
    return str(turns[0] if turns else "").strip()


def load_corpora() -> dict[str, dict]:
    corpora = {}
    for name in CORPUS_FILES:
        path = ARTIFACTS_DIR / name
        if not path.exists():
            continue
        raw = json.loads(path.read_text(encoding="utf-8"))
        scenarios = raw["scenarios"] if isinstance(raw, dict) else raw
        corpora[name] = {
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "by_id": {s["id"]: s for s in scenarios},
        }
    return corpora


# ---------------------------------------------------------------------------
# artifact harvesting with corpus fingerprinting
# ---------------------------------------------------------------------------

def _fingerprint_run(scenarios: list[dict], corpora: dict[str, dict]) -> dict[str, int]:
    """Count one-sided evidence pointing at each corpus: for scenario ids whose
    expectations differ between corpora, the harness-recorded hit/miss tool ids
    can only come from one of them."""
    votes: dict[str, int] = Counter()
    for entry in scenarios:
        sid = entry.get("id")
        observed = set(entry.get("expected_hit") or []) | set(entry.get("expected_missing") or [])
        if not observed:
            continue
        per_corpus = {}
        for name, corpus in corpora.items():
            scenario = corpus["by_id"].get(sid)
            if scenario is None:
                continue
            per_corpus[name] = set(scenario.get("expected_tools") or [])
        if len({frozenset(v) for v in per_corpus.values()}) < 2:
            continue  # expectations identical everywhere — not informative
        matching = {name for name, exp in per_corpus.items() if observed & exp}
        if len(matching) == 1:
            votes[next(iter(matching))] += 1
    return dict(votes)


def harvest_vectors(corpora: dict[str, dict]) -> tuple[list[dict], dict]:
    """Harvest (run file, scenario id, recorded JEV vector) samples bound to a
    corpus either by exact sha256 or by one-sided fingerprint evidence."""
    samples: list[dict] = []
    stats = {
        "files_total": 0,
        "files_used": 0,
        "vectors_total": 0,
        "excluded_no_corpus_binding": 0,
        "excluded_unknown_scenario": 0,
        "excluded_empty_vector": 0,
        "per_file": {},
    }
    for path in sorted(glob.glob(str(ARTIFACTS_DIR / "real_run_*.json"))):
        fname = os.path.basename(path)
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except Exception:
            continue
        stats["files_total"] += 1
        scenarios = data.get("scenarios") or []
        env = data.get("env") or {}
        sha = str(env.get("corpus_sha256") or "")
        bound = None
        binding = None
        for name, corpus in corpora.items():
            if sha and corpus["sha256"] == sha:
                bound, binding = name, "sha256"
                break
        if bound is None:
            # unique namespace: if every scenario id of the run exists in
            # exactly one corpus, no disambiguation is needed at all
            # (a10_* lives only in a10_round, sd_* only in bench_seeded).
            id_sets = {
                name: {s.get("id") for s in scenarios if s.get("id") in corpus["by_id"]}
                for name, corpus in corpora.items()
            }
            run_ids = {s.get("id") for s in scenarios if s.get("id")}
            covering = [name for name, ids in id_sets.items() if run_ids and run_ids <= ids]
            absent_elsewhere = []
            for name in covering:
                others_hit = any(
                    sid in corpora[other]["by_id"]
                    for other in corpora if other != name
                    for sid in run_ids
                )
                if not others_hit:
                    absent_elsewhere.append(name)
            if len(absent_elsewhere) == 1:
                bound, binding = absent_elsewhere[0], "unique-namespace"
        if bound is None:
            votes = _fingerprint_run(scenarios, corpora)
            if votes:
                best, best_votes = max(votes.items(), key=lambda kv: kv[1])
                total_votes = sum(votes.values())
                # accept only one-sided evidence (>=80% for a single corpus)
                if best_votes >= 3 and best_votes >= 0.8 * total_votes:
                    bound, binding = best, f"fingerprint:{best_votes}/{total_votes}"
        file_info = {"scenarios": len(scenarios), "binding": binding, "vectors": 0}
        stats["per_file"][fname] = file_info
        if bound is None:
            stats["excluded_no_corpus_binding"] += sum(len(s.get("jev_answers") or []) for s in scenarios)
            continue
        stats["files_used"] += 1
        file_info["corpus"] = bound
        corpus = corpora[bound]
        for entry in scenarios:
            sid = entry.get("id")
            scenario = corpus["by_id"].get(sid)
            vectors = entry.get("jev_answers") or []
            stats["vectors_total"] += len(vectors)
            if scenario is None:
                stats["excluded_unknown_scenario"] += len(vectors)
                continue
            if not vectors:
                continue
            vector = vectors[0]  # first turn / first routing decision
            if not isinstance(vector, dict) or not vector:
                stats["excluded_empty_vector"] += 1
                continue
            has_group_answers = any(key.startswith("g_") for key in vector)
            samples.append({
                "run_file": fname,
                "scenario_id": sid,
                "corpus": bound,
                "category": scenario.get("category") or "",
                "prompt": scenario_prompt(scenario),
                "expected_groups": sorted(expected_groups_of(scenario)),
                "expected_tools": list(scenario.get("expected_tools") or []),
                "vector": vector,
                # older runs produced mode-only vectors for conversational
                # prompts (no group questions in the decide call); they cannot
                # exercise group discrimination and are bucketed separately.
                "vector_shape": "groups" if has_group_answers else "mode_only",
            })
            file_info["vectors"] += 1
    return samples, stats


# ---------------------------------------------------------------------------
# replay through the live decision layer (no network)
# ---------------------------------------------------------------------------

def _jev_decision(vector: dict):
    """Fixture decision accepting both recorded vectors ({key: {probability: p}})
    and plain synthetic ones ({key: p})."""
    def _prob(val) -> float:
        if isinstance(val, dict):
            return float(val.get("probability") or 0.0)
        try:
            return float(val or 0.0)
        except (TypeError, ValueError):
            return 0.0
    return SimpleNamespace(
        model="typesafe/jev-1.14",
        answers={key: SimpleNamespace(probability=_prob(val)) for key, val in vector.items()},
    )


def replay_sample(service, sample: dict, *, rescue: bool) -> dict:
    """Replay one recorded vector through the CURRENT _route_tool_groups_jev.

    available_groups are reconstructed exactly as the vector records them
    (the asked g_* keys) plus 'other' — the permission-filtered set the bench
    contour really offered. decide() is replaced with a fixture returning the
    recorded probabilities; no network is involved.
    """
    vector = sample["vector"]
    asked_groups = sorted(key[2:] for key in vector if key.startswith("g_"))
    available = set(asked_groups) | {"other"}
    result = _replay_vector(
        service, sample["prompt"] or "запрос", vector, available, rescue=rescue)
    routed = set(result or set())
    return {
        "routed": sorted(routed),
        "routed_domain": sorted(routed - {"other"}),
        "intent_mode": getattr(result, "intent_mode", None),
    }


def confusion_and_scores(rows: list[dict]) -> dict:
    """Binary per-group precision/recall (one-vs-rest over domain groups) plus
    a primary-label confusion matrix. 'other' is excluded everywhere — it is a
    safety net, not a classification decision."""
    groups = sorted({g for row in rows for g in row["expected_groups"]} |
                    {g for row in rows for g in row["routed_domain"]})
    per_group = {}
    for group in groups:
        tp = fp = fn = 0
        for row in rows:
            expected = group in row["expected_groups"]
            predicted = group in row["routed_domain"]
            if expected and predicted:
                tp += 1
            elif predicted and not expected:
                fp += 1
            elif expected and not predicted:
                fn += 1
        precision = tp / (tp + fp) if tp + fp else None
        recall = tp / (tp + fn) if tp + fn else None
        per_group[group] = {"tp": tp, "fp": fp, "fn": fn, "precision": precision, "recall": recall}
    tp_all = sum(v["tp"] for v in per_group.values())
    fp_all = sum(v["fp"] for v in per_group.values())
    fn_all = sum(v["fn"] for v in per_group.values())
    micro = {
        "precision": tp_all / (tp_all + fp_all) if tp_all + fp_all else None,
        "recall": tp_all / (tp_all + fn_all) if tp_all + fn_all else None,
    }
    # primary-label confusion: row = first expected group ('∅' for no-tool
    # scenarios), col = routed outcome — single group, 'multi', or 'none'.
    matrix: dict[str, Counter] = defaultdict(Counter)
    exact = 0
    routed_nonempty = 0
    for row in rows:
        expected_label = row["expected_groups"][0] if row["expected_groups"] else "∅"
        routed = sorted(set(row["routed_domain"]))
        if not routed:
            predicted_label = "none"
        elif len(routed) == 1:
            predicted_label = routed[0]
        else:
            predicted_label = "multi:" + "+".join(routed)
        matrix[expected_label][predicted_label] += 1
        if set(row["expected_groups"]) == set(row["routed_domain"]):
            exact += 1
        if routed:
            routed_nonempty += 1
    return {
        "samples": len(rows),
        "per_group": per_group,
        "micro": micro,
        "exact_set_match": exact,
        "exact_set_accuracy": exact / len(rows) if rows else None,
        # for no-tool samples this IS the false-positive rate; for data
        # samples it is the rate of "anything at all was routed".
        "routed_nonempty_rate": routed_nonempty / len(rows) if rows else None,
        "confusion_matrix": {k: dict(v) for k, v in sorted(matrix.items())},
    }


def _group_by(rows: list[dict], key: str) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        grouped[row.get(key) or ""] .append(row)
    return dict(grouped)


def evaluate_replay(service, samples: list[dict]) -> dict:
    """Replay every sample twice (rescue ON/OFF) and diff the outcomes."""
    rows_on, rows_off, transitions = [], [], []
    for sample in samples:
        asked = sorted(key[2:] for key in sample["vector"] if key.startswith("g_"))
        expected = set(sample["expected_groups"])
        # A sample is 'routable' when at least one expected group was actually
        # offered to the classifier; otherwise the correct routing is empty
        # and the sample measures false positives only (permission-negative).
        routable = bool(expected & set(asked)) if expected else False
        out = {}
        for rescue in (True, False):
            rep = replay_sample(service, sample, rescue=rescue)
            out[rescue] = rep
        base = {
            "run_file": sample["run_file"],
            "scenario_id": sample["scenario_id"],
            "corpus": sample["corpus"],
            "category": sample["category"],
            "prompt": sample["prompt"],
            "expected_groups": sorted(expected),
            "asked_groups": asked,
            "routable": routable,
            "vector_shape": sample["vector_shape"],
        }
        row_on = dict(base, **{k: out[True][k] for k in ("routed", "routed_domain", "intent_mode")})
        row_off = dict(base, **{k: out[False][k] for k in ("routed", "routed_domain", "intent_mode")})
        rows_on.append(row_on)
        rows_off.append(row_off)
        if row_on["routed_domain"] != row_off["routed_domain"] or row_on["intent_mode"] != row_off["intent_mode"]:
            rescued_group = sorted(set(row_on["routed_domain"]) - set(row_off["routed_domain"]))
            correct = bool(rescued_group) and all(g in expected for g in rescued_group)
            wrong = bool(rescued_group) and not all(g in expected for g in rescued_group)
            if not wrong:
                wrong_kind = ""
            elif not expected:
                wrong_kind = "notool"  # spurious routing on conversational input
            elif not routable:
                # every offered group is outside expectations by construction —
                # unavoidable wrongness, measures exposure not discrimination
                wrong_kind = "permission_negative"
            else:
                # the correct group WAS offered but a wrong one won the argmax —
                # the true discrimination cost of the rescue
                wrong_kind = "routable"
            transitions.append({
                "scenario_id": sample["scenario_id"],
                "run_file": sample["run_file"],
                "corpus": sample["corpus"],
                "category": sample["category"],
                "prompt": sample["prompt"][:120],
                "expected_groups": sorted(expected),
                "asked_groups": asked,
                "routable": routable,
                "on_routed": row_on["routed_domain"],
                "off_routed": row_off["routed_domain"],
                "on_mode": row_on["intent_mode"],
                "off_mode": row_off["intent_mode"],
                "rescued_groups": rescued_group,
                "rescue_correct": correct,
                "rescue_wrong": wrong,
                "wrong_kind": wrong_kind,
            })

    def _subset(rows, key):
        return [r for r in rows if key(r)]

    def _dedup(rows):
        """One row per (corpus, scenario id) — repeated observations of the
        same prompt across benchmark runs are correlated, so the deduplicated
        view is the conservative robustness check."""
        seen = {}
        for row in rows:
            seen.setdefault((row["corpus"], row["scenario_id"]), row)
        return list(seen.values())

    # DIRECT-category expectations encode fast-path (direct-read shortcut)
    # behavior, not routing truth — e.g. sd_direct_cmp expects [] because the
    # comparison must not take the shortcut, while normal routing absolutely
    # should happen. They are excluded from every routing metric.
    direct_excluded = sum(1 for r in rows_on if r["category"] == "DIRECT")
    rows_on = [r for r in rows_on if r["category"] != "DIRECT"]
    rows_off = [r for r in rows_off if r["category"] != "DIRECT"]
    transitions = [t for t in transitions if t.get("category") != "DIRECT"]

    group_rows_on = _subset(rows_on, lambda r: r["vector_shape"] == "groups")
    group_rows_off = _subset(rows_off, lambda r: r["vector_shape"] == "groups")

    report = {}
    for label, rows in (("on", group_rows_on), ("off", group_rows_off)):
        notool_rows = _subset(rows, lambda r: not r["expected_groups"])
        report[label] = {
            "all_samples": confusion_and_scores(rows),
            "routable_only": confusion_and_scores(_subset(rows, lambda r: r["routable"])),
            "routable_dedup": confusion_and_scores(_dedup(_subset(rows, lambda r: r["routable"]))),
            "notool_samples": confusion_and_scores(notool_rows),
            # SEC-category expectations are execution-level (a refusal must
            # perform no tool); routing a group there is not necessarily a
            # routing error, so the category split keeps CHAT honest.
            "notool_by_category": {
                cat: confusion_and_scores(part)
                for cat, part in sorted(_group_by(notool_rows, "category").items())
            },
            "permission_negative": confusion_and_scores(
                _subset(rows, lambda r: r["expected_groups"] and not r["routable"])),
            "rows": [
                {
                    "scenario_id": r["scenario_id"],
                    "corpus": r["corpus"],
                    "run_file": r["run_file"],
                    "category": r["category"],
                    "expected_groups": r["expected_groups"],
                    "routed_domain": r["routed_domain"],
                    "intent_mode": r["intent_mode"],
                    "routable": r["routable"],
                }
                for r in rows
            ],
        }
    # mode-only vectors: no group questions were asked at record time — the
    # only measurable expectation is "nothing routed, mode decided".
    mode_rows = _subset(rows_on, lambda r: r["vector_shape"] == "mode_only")
    report["direct_category_excluded"] = {
        "samples": direct_excluded,
        "reason": "DIRECT expectations encode direct-read shortcut behavior, not routing truth",
    }
    report["mode_only_vectors"] = {
        "total": len(mode_rows),
        "confident_chat": sum(1 for r in mode_rows if r["intent_mode"] == "chat"),
        "empty_routing": sum(1 for r in mode_rows if not r["routed_domain"]),
        "note": "older runs recorded mode-only vectors for conversational prompts; "
                "they cannot exercise group discrimination",
    }
    report["transitions"] = transitions
    report["transition_summary"] = {
        "total": len(transitions),
        "rescue_correct": sum(1 for t in transitions if t["rescue_correct"]),
        "rescue_wrong": sum(1 for t in transitions if t["rescue_wrong"]),
        "rescue_wrong_routable": sum(1 for t in transitions if t["wrong_kind"] == "routable"),
        "rescue_wrong_permission_negative": sum(1 for t in transitions if t["wrong_kind"] == "permission_negative"),
        "rescue_wrong_notool": sum(1 for t in transitions if t["wrong_kind"] == "notool"),
        "mode_only_changes": sum(1 for t in transitions if not t["rescued_groups"]),
    }
    return report


# ---------------------------------------------------------------------------
# synthetic decision-layer sweep (full group coverage)
# ---------------------------------------------------------------------------

def build_sweep_cases(corpora: dict[str, dict]) -> list[dict]:
    """Every bench_intel corpus prompt with its expected domain groups —
    the broadest prompt coverage available (200 scenarios, v2 corpus)."""
    corpus = corpora.get("bench_intel_corpus.json")
    cases = []
    if corpus is None:
        return cases
    for sid, scenario in sorted(corpus["by_id"].items()):
        prompt = scenario_prompt(scenario)
        if not prompt:
            continue
        cases.append({
            "scenario_id": sid,
            "category": scenario.get("category") or "",
            "prompt": prompt,
            "expected_groups": sorted(expected_groups_of(scenario)),
        })
    return cases


def _replay_vector(service, prompt: str, vector: dict, available: set[str], *, rescue: bool):
    """Synchronous fixture replay of one probability vector. The lambda closes
    over ``vector`` and is used only inside this call — no rebinding hazard."""
    os.environ["AI_JEV_TOP1_RESCUE"] = "1" if rescue else "0"
    service._jev_routing_cache.clear()
    original_decide = service.jev_client.decide
    original_configured = service.jev_client.is_configured
    service.jev_client.decide = lambda **kw: _jev_decision(vector)
    service.jev_client.is_configured = lambda: True
    try:
        result = service._route_tool_groups_jev(trigger_text=prompt, available_groups=available)
    finally:
        service.jev_client.decide = original_decide
        service.jev_client.is_configured = original_configured
        service._jev_routing_cache.clear()
    return result


def sweep_decision_layer(service, cases: list[dict], *, threshold: float) -> dict:
    """Pin group probabilities at calibrated levels and measure what the
    decision layer produces. Two variants:

    * data_band — data scenarios: the correct (first expected) group carries
      probability p, a 0.10 distractor floor sits on two unrelated groups,
      mode probabilities are low (a data request: chat 0.1 / act 0.1).
      Measures recall recovery inside the rescue band [floor, threshold).
    * chat_noise — conversational scenarios: a spurious 'itinvent' signal at
      probability p (worst-case attractor for IT-flavored smalltalk) with an
      UNCERTAIN chat label (0.4, below threshold). Measures the false-positive
      cost of rescue — with a confident chat label rescue never fires.
    """
    levels = [0.10, 0.20, 0.25, 0.30, 0.40, 0.49, 0.50, 0.60, 0.80, 0.95]
    domain_groups = sorted({
        g for case in cases for g in case["expected_groups"]
    } - {"other"})

    def _run_variant(build_vector, eligible):
        grid: dict[str, dict] = {}
        for level in levels:
            per_flag = {}
            for rescue in (True, False):
                rows = []
                for case in cases:
                    if not eligible(case):
                        continue
                    vector = build_vector(case, level)
                    asked = sorted(key[2:] for key in vector if key.startswith("g_"))
                    available = set(asked) | set(case["expected_groups"]) | {"other"}
                    result = _replay_vector(service, case["prompt"], vector, available, rescue=rescue)
                    rows.append({
                        "scenario_id": case["scenario_id"],
                        "expected_groups": case["expected_groups"],
                        "routed_domain": sorted(set(result or set()) - {"other"}),
                        "intent_mode": getattr(result, "intent_mode", None),
                    })
                per_flag["on" if rescue else "off"] = confusion_and_scores(rows)
            grid[f"{level:.2f}"] = per_flag
        return grid

    def _data_vector(case, level):
        primary = case["expected_groups"][0]
        vector = {f"g_{primary}": level, "m_mode_chat": 0.1, "m_mode_act": 0.1}
        distractors = [g for g in domain_groups if g not in case["expected_groups"]][:2]
        for dis in distractors:
            vector[f"g_{dis}"] = 0.10
        return vector

    def _chat_noise_vector(case, level):
        return {"g_itinvent": level, "g_office": 0.08, "m_mode_chat": 0.4, "m_mode_act": 0.05}

    return {
        "levels": levels,
        "cases": len(cases),
        "data_band": _run_variant(_data_vector, lambda c: bool(c["expected_groups"])),
        "chat_noise": _run_variant(_chat_noise_vector, lambda c: not c["expected_groups"]),
    }


# ---------------------------------------------------------------------------
# handcrafted intent-mode matrix from tests (decision-layer regression)
# ---------------------------------------------------------------------------

def harvest_intent_mode_scenarios() -> list[dict]:
    """Parse the _SCENARIOS matrix out of tests/test_ai_jev_intent_modes.py
    without importing the test module (keeps this script pytest-free)."""
    import ast
    path = ROOT / "tests" / "test_ai_jev_intent_modes.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "_SCENARIOS" for t in node.targets):
            return ast.literal_eval(node.value)
    return []


def evaluate_intent_matrix(service) -> dict:
    scenarios = harvest_intent_mode_scenarios()
    import importlib
    tools_context = importlib.import_module("backend.ai_chat.tools.context")
    all_groups = set(tools_context.AI_TOOL_GROUPS_ALL)
    rows = []
    for text, answers, expected_mode, must_contain, must_lack in scenarios:
        outcomes = {}
        for rescue in (True, False):
            result = _replay_vector(service, text, answers, set(all_groups), rescue=rescue)
            outcomes[rescue] = {
                "mode": getattr(result, "intent_mode", None),
                "routed": sorted(set(result or set())),
            }
        def _passes(out):
            return (out["mode"] == expected_mode
                    and all(g in out["routed"] for g in must_contain)
                    and all(g not in out["routed"] for g in must_lack))
        rows.append({
            "text": text,
            "expected_mode": expected_mode,
            "pass_on": _passes(outcomes[True]),
            "pass_off": _passes(outcomes[False]),
            "on": outcomes[True],
            "off": outcomes[False],
            "changed": outcomes[True] != outcomes[False],
        })
    return {
        "total": len(rows),
        "pass_on": sum(1 for r in rows if r["pass_on"]),
        "pass_off": sum(1 for r in rows if r["pass_off"]),
        "changed_outcomes": sum(1 for r in rows if r["changed"]),
        "rows": rows,
    }


# ---------------------------------------------------------------------------
# live mode (implemented for completeness — NOT run in this cycle)
# ---------------------------------------------------------------------------

def run_live(cases: list[dict], out_path: str) -> dict:  # pragma: no cover
    """Call the real System One API per corpus prompt and record raw vectors.

    Implemented so the measurement can be repeated honestly once a provider
    account is funded. NOT executed in cycle A11 §6: real LLM API calls are
    forbidden by the task and both provider accounts are out of credit.
    """
    import importlib
    service = importlib.import_module("backend.ai_chat.service")
    tools_context = importlib.import_module("backend.ai_chat.tools.context")
    all_groups = set(tools_context.AI_TOOL_GROUPS_ALL)
    if not service.jev_client.is_configured():
        return {"error": "JEV client is not configured (no JEV/ROUTERAI/OPENROUTER key)", "recorded": 0}
    records = []
    for case in cases:
        questions = {}
        for group, spec in service._JEV_GROUP_QUESTIONS.items():
            if group in all_groups:
                questions[f"g_{group}"] = service.jev_noul(
                    spec.get("question", ""),
                    true_label=spec.get("true_label", ""),
                    false_label=spec.get("false_label", ""),
                )
        for key, spec in service._JEV_MODE_QUESTIONS.items():
            questions[key] = service.jev_noul(
                spec.get("question", ""),
                true_label=spec.get("true_label", ""),
                false_label=spec.get("false_label", ""),
            )
        decision = service.jev_client.decide(
            state=service._build_jev_state(trigger_text=case["prompt"], available_groups=all_groups),
            questions=questions,
            timeout=5.0,
            max_retries=0,
        )
        records.append({
            "scenario_id": case["scenario_id"],
            "vector": {k: {"probability": getattr(a, "probability", 0.0)} for k, a in decision.answers.items()},
        })
        time.sleep(0.2)
    Path(out_path).write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"recorded": len(records), "out": out_path}


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    args = _parse_args()
    os.environ["AI_JEV_ROUTING_THRESHOLD"] = args.threshold
    import importlib
    service = importlib.import_module("backend.ai_chat.service")

    corpora = load_corpora()
    samples, harvest_stats = harvest_vectors(corpora)
    sweep_cases = build_sweep_cases(corpora)

    print(f"[dataset] corpora: {list(corpora)}")
    print(f"[dataset] replay samples: {len(samples)} from {harvest_stats['files_used']}/{harvest_stats['files_total']} run files")
    print(f"[dataset] excluded (no corpus binding): {harvest_stats['excluded_no_corpus_binding']} vectors")
    print(f"[dataset] sweep cases: {len(sweep_cases)}")

    if args.live:  # pragma: no cover — not run in this cycle
        print("[live] calling the real System One API (explicitly out of scope for A11 §6)")
        result = run_live(sweep_cases, str(ARTIFACTS_DIR / "jev_live_vectors.json"))
        print(f"[live] {result}")
        return

    started = time.perf_counter()
    replay_report = evaluate_replay(service, samples)
    sweep_report = sweep_decision_layer(service, sweep_cases, threshold=float(args.threshold))
    matrix_report = evaluate_intent_matrix(service)
    elapsed = time.perf_counter() - started
    print(f"[eval] replay+sweep+matrix done in {elapsed:.1f}s")

    on = replay_report["on"]["routable_only"]["micro"]
    off = replay_report["off"]["routable_only"]["micro"]
    ts = replay_report["transition_summary"]
    print(f"[replay:routable] micro P/R rescue ON : {on['precision']:.3f}/{on['recall']:.3f}")
    print(f"[replay:routable] micro P/R rescue OFF: {off['precision']:.3f}/{off['recall']:.3f}")
    print(f"[replay] transitions ON-vs-OFF: {ts['total']} (correct {ts['rescue_correct']}, "
          f"wrong routable {ts['rescue_wrong_routable']}, "
          f"wrong permission-negative {ts['rescue_wrong_permission_negative']}, "
          f"wrong notool {ts['rescue_wrong_notool']})")
    print(f"[intent-matrix] pass ON {matrix_report['pass_on']}/{matrix_report['total']} | pass OFF {matrix_report['pass_off']}/{matrix_report['total']} | changed {matrix_report['changed_outcomes']}")

    if args.dry_run:
        print("[dry-run] report NOT written (pass without --dry-run to write jev_eval_report.json)")
        return

    report = {
        "meta": {
            "generated_by": "jev_eval.py (A11 §6)",
            "threshold": float(args.threshold),
            "rescue_floor": max(0.2, float(args.threshold) * 0.5),
            "live_calls": 0,
            # Line refs verified against the working tree at generation time;
            # the file is edited concurrently — anchor by function name.
            "jev_input_audit": {
                "summary": "what exactly the JEV classifier sees at group-routing time",
                "transport": {
                    "fact": "POST {base}/systemone with payload {model, state, questions} — no chat roles, no system prompt, no tool specs in group mode",
                    "ref": "shared/llm/jev_client.py:272 (payload), model typesafe/jev-1.14 (line 32)",
                },
                "state_fields": {
                    "fact": "state = {user_message, recent_messages, sticky_groups, has_attachment, available_groups} — nothing else",
                    "ref": "WEB-itinvent/backend/ai_chat/service.py _build_jev_state (line 1540)",
                },
                "user_trigger_included": {
                    "fact": "YES — user_message is the normalized trigger text, truncated to 1500 chars",
                    "ref": "service.py:1550",
                },
                "recent_messages": {
                    "fact": "up to 4 items x 300 chars. NO structured role field: the light path "
                            "(_fetch_routing_inputs, service.py:8457) passes bare bodies (select ChatMessage.body, "
                            "line 8499); the heavy post-context path passes lines prefixed '<bot title>: ' or "
                            "'Пользователь: ' (service.py:10403, used at line 10502). No user names/ids beyond that.",
                    "ref": "service.py:1551 (truncation), 8499-8513 (light), 10395-10403 + 10502 (heavy)",
                },
                "available_groups": {
                    "fact": "permission-filtered group NAMES only (sorted list); no group descriptions, no tool ids, no tool descriptions in group mode",
                    "ref": "service.py:1554; questions built at 1622-1636",
                },
                "questions": {
                    "fact": "per-group noul questions embed the domain semantics: question text + true/false criteria with Russian examples (_JEV_GROUP_QUESTIONS, service.py:1126-1294); plus two intent-mode questions m_mode_act/m_mode_chat (service.py:1299-1328). Group 'other' is never asked — force-added as safety net. In tool mode each question embeds the tool id + first 200 chars of its description (service.py:1829).",
                    "ref": "service.py:1126, 1299, 1622-1645, 1829",
                },
                "not_seen": [
                    "tool specs/schemas (group mode) — the classifier never sees individual tools",
                    "conversation summary/memory facts/personal memory",
                    "user identity, role or permissions beyond the group filter",
                    "file contents of attachments (only the boolean has_attachment)",
                    "any system-prompt style instructions — only the typed questions",
                ],
            },
            "measurement_kind": {
                "replay": "real recorded JEV vectors replayed through the current decision layer",
                "sweep": "synthetic calibrated probability levels — decision-layer only, not the classifier",
                "intent_matrix": "handcrafted regression scenarios from tests/test_ai_jev_intent_modes.py",
            },
            "limitations": [
                "JEV classification is fully LLM-driven (remote System One); offline end-to-end accuracy without recorded vectors is impossible — the sweep measures only the post-processing layer",
                "replay vectors are point observations from past benchmark runs (older question wording/permissions in some runs); they are not a probability distribution",
                "the bench contour offered only 7 domain groups (chat/directory/files/kb/mfu/office/self): itinvent/warehouse/ad/network recall is not measurable from these artifacts",
                "run-to-corpus binding without sha256 relies on expected_hit/miss fingerprinting or unique id namespaces; unverifiable runs are excluded",
                "'other' is excluded from precision/recall — it is force-added as a safety net, not a classification decision",
                "multi-turn scenario vectors beyond the first turn are not replayed (per-turn ground truth is not recoverable offline)",
                "corpus expected_tools are execution-level truth: for SEC/ACT-clarification scenarios an empty expectation means 'no tool effect', not necessarily 'no routing' — false-positive rates on those categories overstate routing error (DIRECT category excluded entirely)",
                "bench_intel_corpus is nearly absent from the replay (1 sample): the pre-v2 corpus hash of the a11 runs no longer matches the edited file, so those vectors are excluded — group coverage leans on a9_quality + bench_seeded",
                "argmax ties inside the rescue break by set-iteration order, which depends on PYTHONHASHSEED — micro metrics can wobble by ~0.001 across processes; this is a production-code property, not a measurement artifact",
            ],
        },
        "dataset": {
            "harvest": harvest_stats,
            "samples_used": len(samples),
            "samples_per_corpus": dict(Counter(s["corpus"] for s in samples)),
            "sweep_cases": len(sweep_cases),
        },
        "replay": replay_report,
        "sweep": sweep_report,
        "intent_matrix": matrix_report,
    }
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[out] {args.out}")


if __name__ == "__main__":
    main()
