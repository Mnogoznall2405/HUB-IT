import os
import sys
import shutil
import tempfile
from pathlib import Path
from cx_Freeze import setup, Executable

sys.setrecursionlimit(10000)

REPO_ROOT = Path(__file__).resolve().parents[1]
AGENT_SRC = REPO_ROOT / "agent" / "src"
AGENT_ENTRY = REPO_ROOT / "agent.py"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(AGENT_SRC) not in sys.path:
    sys.path.insert(0, str(AGENT_SRC))

from agent_version import AGENT_VERSION

# Use a unique project-local temp path to avoid stale locks from previous cx_Freeze runs.
BUILD_TMP_ROOT = REPO_ROOT / "tmp" / "cxfreeze"
BUILD_TMP_ROOT.mkdir(parents=True, exist_ok=True)
BUILD_TMP = Path(tempfile.mkdtemp(prefix="cxfreeze-", dir=str(BUILD_TMP_ROOT)))
os.environ["TMP"] = str(BUILD_TMP)
os.environ["TEMP"] = str(BUILD_TMP)

# Some environments lock dist-info folders during cx_Freeze temporary cleanup.
# Do not fail build on temp cleanup errors.
_original_rmtree = shutil.rmtree

def _safe_rmtree(path, *args, **kwargs):
    kwargs["ignore_errors"] = True
    try:
        return _original_rmtree(path, *args, **kwargs)
    except Exception:
        return None

shutil.rmtree = _safe_rmtree

base = "Win32GUI" if sys.platform == "win32" else None

executables = [
    Executable(
        str(AGENT_ENTRY),
        base=base,
        target_name="ITInventAgent.exe",
        shortcut_name="IT-Invent Agent",
    )
]

build_exe_options = {
    "excludes": [
        "tkinter",
        "unittest",
    ],
    "packages": ["wmi", "psutil", "requests", "scan_agent", "yaml", "itinvent_agent", "watchdog"],
    "includes": ["scan_agent.agent", "fitz", "watchdog.events", "watchdog.observers"],
    "include_files": [(str(REPO_ROOT / "patterns_strict.yaml"), "patterns_strict.yaml")],
    "include_msvcr": True,
}

bdist_msi_options = {
    "add_to_path": False,
    "initial_target_dir": r"[ProgramFiles64Folder]\\IT-Invent\\Agent",
    "all_users": True,
}

setup(
    name="IT-Invent Agent",
    version=AGENT_VERSION,
    author="IT-Invent",
    description="IT-Invent Unified Agent (Inventory + Scan)",
    options={
        "build_exe": build_exe_options,
        "bdist_msi": bdist_msi_options,
    },
    executables=executables,
)
