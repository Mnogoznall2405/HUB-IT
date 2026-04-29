import os
import shutil
import sys
import tempfile
from pathlib import Path

from cx_Freeze import Executable, setup

sys.setrecursionlimit(10000)

REPO_ROOT = Path(__file__).resolve().parents[1]
MSI_HELPER_ENTRY = REPO_ROOT / "agent_msi_helper.py"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from agent_installer import (  # noqa: E402
    DEFAULT_INSTALL_DIR,
    DEFAULT_TASK_NAME,
    FULL_UNINSTALL_SCRIPT_NAME,
    MSI_HELPER_EXECUTABLE_NAME,
)

CLEANUP_VERSION = "1.0.0"
CLEANUP_UPGRADE_CODE = "{9B2E7F7D-641F-4577-BA8E-5B2C3E7796F5}"

# Keep cleanup builds isolated from the main agent MSI build temp directory.
BUILD_TMP_ROOT = REPO_ROOT / "tmp" / "cxfreeze-cleanup"
BUILD_TMP_ROOT.mkdir(parents=True, exist_ok=True)
BUILD_TMP = Path(tempfile.mkdtemp(prefix="cxfreeze-cleanup-", dir=str(BUILD_TMP_ROOT)))
tempfile.tempdir = str(BUILD_TMP)
os.environ["TMPDIR"] = str(BUILD_TMP)
os.environ["TMP"] = str(BUILD_TMP)
os.environ["TEMP"] = str(BUILD_TMP)

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
        str(MSI_HELPER_ENTRY),
        base=base,
        target_name=MSI_HELPER_EXECUTABLE_NAME,
    ),
]

build_exe_options = {
    "excludes": [
        "tkinter",
        "unittest",
        "pytest",
        "pluggy",
        "pygments",
        "pytz",
        "pandas",
        "numpy",
    ],
    "packages": ["psutil"],
    "includes": ["agent_installer"],
    "include_files": [
        (
            str(REPO_ROOT / "agent" / "scripts" / FULL_UNINSTALL_SCRIPT_NAME),
            f"scripts/{FULL_UNINSTALL_SCRIPT_NAME}",
        ),
    ],
    "include_msvcr": True,
}


def _build_full_cleanup_custom_action_target() -> str:
    return " ".join(
        [
            "--msi-full-uninstall-cleanup",
            f'--install-dir "{DEFAULT_INSTALL_DIR}"',
            f'--task-name "{DEFAULT_TASK_NAME}"',
            '--log-path "[TempFolder]itinvent_agent_full_uninstall.log"',
            '--self-uninstall-product-code "[ProductCode]"',
        ]
    )


msi_data = {
    "CustomAction": [
        ("A_RUN_AGENT_FULL_UNINSTALL_CLEANUP", 18 + 3072, MSI_HELPER_EXECUTABLE_NAME, _build_full_cleanup_custom_action_target()),
    ],
    "InstallExecuteSequence": [
        ("A_RUN_AGENT_FULL_UNINSTALL_CLEANUP", 'NOT REMOVE="ALL"', 6501),
    ],
    "Property": [
        ("ARPSYSTEMCOMPONENT", "1"),
    ],
}

bdist_msi_options = {
    "add_to_path": False,
    "initial_target_dir": r"[ProgramFiles64Folder]\\IT-Invent\\AgentCleanup",
    "all_users": True,
    "upgrade_code": CLEANUP_UPGRADE_CODE,
    "data": msi_data,
}

setup(
    name="IT-Invent Agent Cleanup",
    version=CLEANUP_VERSION,
    author="IT-Invent",
    description="IT-Invent Agent cleanup package",
    options={
        "build_exe": build_exe_options,
        "bdist_msi": bdist_msi_options,
    },
    executables=executables,
)
