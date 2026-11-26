"""Static Alembic revision-graph validation without any database connection.

Checks per graph directory:
  - duplicate revision ids
  - down_revision references that resolve nowhere
  - revision cycles
  - number of heads (must be exactly 1; historical branches that converge
    into a single head are fine)

Graphs validated in this repo:
  app/chat  — WEB-itinvent/backend/alembic/versions
  scan      — scan_server/alembic/versions
  voice     — voice_server/alembic/versions

`--self-test` builds synthetic valid/invalid graphs in a temp dir and asserts
detection, so CI proves the checker itself works (including negative cases).

Exit 0 = all graphs valid (and self-test passed when requested), 1 = problems.
"""
from __future__ import annotations

import re
import shutil
import sys
import tempfile
from pathlib import Path

REVISION_RE = re.compile(r"^revision(?::\s*str)?\s*=\s*['\"]([^'\"]+)['\"]", re.M)
DOWN_REVISION_RE = re.compile(r"^down_revision(?::\s*[^=]+)?\s*=\s*(.+)$", re.M)

GRAPHS = {
    "app/chat": "WEB-itinvent/backend/alembic/versions",
    "scan": "scan_server/alembic/versions",
    "voice": "voice_server/alembic/versions",
}


def parse_migrations(directory: Path) -> dict[str, tuple[str, ...]]:
    """Return {revision: (down_revisions...)} parsed statically from .py files."""
    graph: dict[str, tuple[str, ...]] = {}
    duplicates: list[str] = []
    for file in sorted(directory.glob("*.py")):
        if file.name.startswith("__"):
            continue
        text = file.read_text(encoding="utf-8", errors="replace")
        rev_match = REVISION_RE.search(text)
        if not rev_match:
            continue
        revision = rev_match.group(1)
        down: tuple[str, ...] = ()
        down_match = DOWN_REVISION_RE.search(text)
        if down_match:
            raw = down_match.group(1).strip().rstrip(",")
            if raw.startswith("(") or raw.startswith("["):
                down = tuple(re.findall(r"['\"]([^'\"]+)['\"]", raw))
            elif raw in ("None", "none"):
                down = ()
            else:
                single = re.search(r"['\"]([^'\"]+)['\"]", raw)
                down = (single.group(1),) if single else ()
        if revision in graph:
            duplicates.append(revision)
        graph[revision] = down
    if duplicates:
        # encode duplicates as impossible sentinel parents so validation reports them
        for dup in duplicates:
            graph[f"__duplicate__{dup}"] = (dup,)
    return graph


def validate_graph(graph: dict[str, tuple[str, ...]]) -> list[str]:
    problems: list[str] = []

    duplicates = sorted({key[len("__duplicate__"):] for key in graph if key.startswith("__duplicate__")})
    for dup in duplicates:
        problems.append(f"duplicate revision id: {dup}")

    real = {rev: downs for rev, downs in graph.items() if not rev.startswith("__duplicate__")}
    for rev, downs in real.items():
        for down in downs:
            if down not in real:
                problems.append(f"unresolved down_revision: {rev} -> {down}")

    # Cycle detection via iterative DFS coloring.
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {rev: WHITE for rev in real}
    for start in real:
        if color[start] != WHITE:
            continue
        stack = [(start, iter(real[start]))]
        color[start] = GRAY
        while stack:
            node, it = stack[-1]
            advanced = False
            for nxt in it:
                if nxt not in real:
                    continue
                if color[nxt] == GRAY:
                    problems.append(f"revision cycle involving: {nxt}")
                elif color[nxt] == WHITE:
                    color[nxt] = GRAY
                    stack.append((nxt, iter(real[nxt])))
                    advanced = True
                    break
            if not advanced:
                color[node] = BLACK
                stack.pop()

    referenced = {down for downs in real.values() for down in downs if down in real}
    heads = sorted(rev for rev in real if rev not in referenced)
    if len(heads) == 0 and real:
        problems.append("no head found (graph fully cyclic or empty)")
    elif len(heads) > 1:
        problems.append(f"multiple heads ({len(heads)}): {', '.join(heads[:5])}")
    return problems


def check_repo_graphs(root: Path) -> int:
    failures = 0
    for name, rel in GRAPHS.items():
        directory = root / rel
        if not directory.is_dir():
            print(f"[{name}] SKIP — {rel} not found")
            continue
        graph = parse_migrations(directory)
        problems = validate_graph(graph)
        if problems:
            failures += 1
            print(f"[{name}] FAIL — {len(problems)} problem(s) in {len(graph)} revisions:")
            for problem in problems:
                print(f"  - {problem}")
        else:
            heads = sum(1 for rev in graph if all(rev not in downs for downs in graph.values()))
            print(f"[{name}] OK — {len(graph)} revisions, single head, graph valid")
    return 1 if failures else 0


def _write_migration(directory: Path, filename: str, revision: str, down: str | None) -> None:
    down_repr = f"'{down}'" if down else "None"
    directory.joinpath(filename).write_text(
        f"revision = '{revision}'\ndown_revision = {down_repr}\n",
        encoding="utf-8",
    )


def self_test() -> int:
    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)

        def case(name: str, spec: list[tuple[str, str | None]]) -> Path:
            directory = base / name
            directory.mkdir()
            for index, (rev, down) in enumerate(spec):
                _write_migration(directory, f"{index:03d}_{rev}.py", rev, down)
            return directory

        valid = case("valid", [("a", None), ("b", "a"), ("c", "b"), ("d", "c"), ("e", "d"), ("f", "e")])
        # branching history that converges: a<-b, a<-c, then merge m(b,c) — single head.
        valid_branch = case("valid_branch", [("a", None), ("b", "a"), ("c", "a")])
        merge_file = valid_branch / "003_m.py"
        merge_file.write_text("revision = 'm'\ndown_revision = ('b', 'c')\n", encoding="utf-8")

        dup = case("dup", [("a", None), ("b", "a")])
        _write_migration(dup, "002_dup_of_b.py", "b", "a")

        missing = case("missing", [("a", None), ("b", "zzz_missing")])

        cyc = case("cycle", [("a", "c"), ("b", "a"), ("c", "b")])

        multi = case("multi", [("a", None), ("b", None)])

        expectations = [
            ("valid linear", valid, False),
            ("valid converged branch", valid_branch, False),
            ("duplicate revision", dup, True),
            ("unresolved reference", missing, True),
            ("cycle", cyc, True),
            ("multiple heads", multi, True),
        ]
        for label, directory, expect_problems in expectations:
            problems = validate_graph(parse_migrations(directory))
            detected = bool(problems)
            ok = detected == expect_problems
            status = "ok" if ok else "SELF-TEST FAILURE"
            print(f"  self-test [{label}]: detected={detected} expected={expect_problems} — {status} ({'; '.join(problems) or 'clean'})")
            if not ok:
                failures += 1
    if failures:
        print(f"alembic self-test: {failures} FAILURE(S)")
        return 1
    print("alembic self-test: all cases detected as expected")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if "--self-test" in args:
        return self_test()
    root = Path(args[0]) if args else Path.cwd()
    return check_repo_graphs(root)


if __name__ == "__main__":
    sys.exit(main())
