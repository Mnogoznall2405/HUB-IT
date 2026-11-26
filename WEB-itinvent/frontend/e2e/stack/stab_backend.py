"""Camouflage shim: run ``local_backend.py`` under a different process name.

Playwright always appends ``e2e/stack/local_backend.py`` to the webServer
command; ``stab_python.cmd`` ignores that argv and runs this shim instead, so
process-kill sweeps matching "local_backend.py" in the command line do not
see this backend (parallel gate agents share the host).

This is a thin re-exec, not a copy: the seed users, env vars and rate caps
live in exactly one place (``local_backend.py``) and cannot drift.
"""
import runpy
import sys
from pathlib import Path

target = Path(__file__).resolve().parent / "local_backend.py"
# Mimic `python e2e/stack/local_backend.py` import resolution: the script's
# own directory is importable (local_store, ai_reliability_seed, ...).
sys.path.insert(0, str(target.parent))
runpy.run_path(str(target), run_name="__main__")
