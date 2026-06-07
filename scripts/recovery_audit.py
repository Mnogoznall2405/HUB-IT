#!/usr/bin/env python3
"""Compare working tree vs git HEAD and optional restored snapshot."""
from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESTORED = ROOT / "_restored_from_git_ec63_b"


def git_tracked_files() -> list[str]:
    out = subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True, encoding="utf-8", errors="replace")
    return [line.strip() for line in out.splitlines() if line.strip()]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    tracked = git_tracked_files()
    missing_on_disk: list[str] = []
    differs_from_head: list[str] = []
    differs_from_restored: list[str] = []
    restored_only: list[str] = []

    for rel in tracked:
        path = ROOT / rel
        if not path.is_file():
            missing_on_disk.append(rel)
            continue

        try:
            head_blob = subprocess.check_output(["git", "show", f"HEAD:{rel}"], cwd=ROOT)
        except subprocess.CalledProcessError:
            continue
        if sha256(path) != hashlib.sha256(head_blob).hexdigest():
            differs_from_head.append(rel)

        restored_path = RESTORED / rel
        if restored_path.is_file():
            if sha256(path) != sha256(restored_path):
                differs_from_restored.append(rel)
        elif RESTORED.is_dir():
            restored_only.append(rel)

    print("=== Recovery audit ===")
    print(f"Tracked files: {len(tracked)}")
    print(f"Missing on disk: {len(missing_on_disk)}")
    print(f"Different from HEAD: {len(differs_from_head)}")
    print(f"Different from _restored_from_git_ec63_b: {len(differs_from_restored)}")
    print(f"Missing in restored snapshot: {len(restored_only)}")

    if missing_on_disk:
        print("\n--- Missing tracked files on disk ---")
        for rel in missing_on_disk[:100]:
            print(rel)
        if len(missing_on_disk) > 100:
            print(f"... and {len(missing_on_disk) - 100} more")

    if differs_from_head:
        print("\n--- Modified vs git HEAD (first 80) ---")
        for rel in differs_from_head[:80]:
            print(rel)
        if len(differs_from_head) > 80:
            print(f"... and {len(differs_from_head) - 80} more")

    if differs_from_restored:
        print("\n--- Different from restored snapshot (first 80) ---")
        for rel in differs_from_restored[:80]:
            print(rel)
        if len(differs_from_restored) > 80:
            print(f"... and {len(differs_from_restored) - 80} more")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
