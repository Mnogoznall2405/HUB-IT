#!/usr/bin/env python3
"""Frozen entrypoint: ITInventMaxProbe.exe (desktop MAX UIA probe)."""

from __future__ import annotations

import sys
from pathlib import Path


def _bootstrap_paths() -> None:
    if getattr(sys, "frozen", False):
        base = Path(sys.executable).resolve().parent
        for candidate in (str(base), str(base / "lib")):
            if candidate not in sys.path:
                sys.path.insert(0, candidate)
        return
    base = Path(__file__).resolve().parent
    probe_root = base / "telegram_uia_probe"
    for candidate in (str(probe_root), str(base)):
        if candidate not in sys.path:
            sys.path.insert(0, candidate)


def main(argv: list[str] | None = None) -> int:
    _bootstrap_paths()
    from telegram_probe.agent_main import run_probe

    return run_probe(argv, default_profile="max")


if __name__ == "__main__":
    raise SystemExit(main())
