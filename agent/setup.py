import os
import sys
import shutil
import tempfile
from pathlib import Path

import certifi
from cx_Freeze import Executable, bdist_msi, setup

sys.setrecursionlimit(10000)

REPO_ROOT = Path(__file__).resolve().parents[1]
AGENT_SRC = REPO_ROOT / "agent" / "src"
AGENT_ENTRY = REPO_ROOT / "agent.py"
SCAN_AGENT_ENTRY = REPO_ROOT / "scan_agent" / "agent.py"
MSI_HELPER_ENTRY = REPO_ROOT / "agent_msi_helper.py"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(AGENT_SRC) not in sys.path:
    sys.path.insert(0, str(AGENT_SRC))

from agent_installer import (
    DEFAULT_REPEAT_MINUTES,
    DEFAULT_TASK_NAME,
    EXECUTABLE_NAME,
    MSI_VALUE_SENTINEL,
    MSI_HELPER_EXECUTABLE_NAME,
    SCAN_AGENT_EXECUTABLE_NAME,
)
from agent_version import AGENT_VERSION

UPGRADE_CODE = "{A285621C-4B2F-4BE6-9AD3-799896D4F901}"
EMBEDDED_MSI_PROPERTY_NAMES = (
    "ITINV_AGENT_API_KEY",
    "SCAN_AGENT_API_KEY",
)
SECURE_MSI_PROPERTIES = "TARGETDIR;REINSTALLMODE;ITINV_AGENT_API_KEY;SCAN_AGENT_API_KEY"


class AgentBdistMsi(bdist_msi):
    def add_config(self) -> None:
        super().add_config()
        view = self.db.OpenView(
            "UPDATE `Property` SET `Value`='"
            + SECURE_MSI_PROPERTIES
            + "' WHERE `Property`='SecureCustomProperties'"
        )
        try:
            view.Execute(None)
        finally:
            view.Close()


def _read_build_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        row = line.strip()
        if not row or row.startswith("#") or "=" not in row:
            continue
        key, value = row.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key] = value
    return values


def _load_embedded_msi_properties() -> list[tuple[str, str]]:
    build_env = _read_build_env(REPO_ROOT / ".env")
    missing = [name for name in EMBEDDED_MSI_PROPERTY_NAMES if not build_env.get(name)]
    if missing:
        raise RuntimeError(
            "Cannot build deployment MSI: missing required values in root .env: "
            + ", ".join(missing)
        )
    return [(name, build_env[name]) for name in EMBEDDED_MSI_PROPERTY_NAMES]

# Use a unique project-local temp path to avoid stale locks from previous cx_Freeze runs.
BUILD_TMP_ROOT = REPO_ROOT / "tmp" / "cxfreeze"
BUILD_TMP_ROOT.mkdir(parents=True, exist_ok=True)
BUILD_TMP = Path(tempfile.mkdtemp(prefix="cxfreeze-", dir=str(BUILD_TMP_ROOT)))
tempfile.tempdir = str(BUILD_TMP)
os.environ["TMPDIR"] = str(BUILD_TMP)
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
        target_name=EXECUTABLE_NAME,
        shortcut_name="IT-Invent Agent",
    ),
    Executable(
        str(SCAN_AGENT_ENTRY),
        base=base,
        target_name=SCAN_AGENT_EXECUTABLE_NAME,
    ),
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
        # Optional integrations pulled in by requests/PyMuPDF are not used by
        # the agent. OCR and image preprocessing run only on scan_server.
        "PIL",
        "fontTools",
        "bcrypt",
        "cryptography",
        "OpenSSL",
        "chardet",
        "lxml",
        "defusedxml",
    ],
    "packages": ["wmi", "psutil", "requests", "scan_agent", "yaml", "itinvent_agent", "watchdog", "certifi"],
    "includes": ["scan_agent.agent", "fitz", "watchdog.events", "watchdog.observers", "agent_installer"],
    "include_files": [
        (str(REPO_ROOT / "patterns_strict.yaml"), "patterns_strict.yaml"),
        (str(Path(certifi.where()).resolve()), "lib/certifi/cacert.pem"),
        (
            str(REPO_ROOT / "agent" / "scripts" / "install_agent_task.ps1"),
            "scripts/install_agent_task.ps1",
        ),
        (
            str(REPO_ROOT / "agent" / "scripts" / "uninstall_agent_task.ps1"),
            "scripts/uninstall_agent_task.ps1",
        ),
    ],
    "include_msvcr": True,
}


def _format_property_arg(flag: str, property_name: str) -> str:
    return f'{flag} "[{property_name}]{MSI_VALUE_SENTINEL}"'


def _build_install_custom_action_target() -> str:
    parts = [
        "--msi-install",
        '--install-dir "[TARGETDIR]."',
        '--env-file-path "[CommonAppDataFolder]IT-Invent\\Agent\\.env"',
        f'--task-name "{DEFAULT_TASK_NAME}"',
        f"--repeat-minutes {DEFAULT_REPEAT_MINUTES}",
        _format_property_arg("--itinv-agent-server-url", "ITINV_AGENT_SERVER_URL"),
        _format_property_arg("--itinv-agent-api-key", "ITINV_AGENT_API_KEY"),
        _format_property_arg("--itinv-agent-interval-sec", "ITINV_AGENT_INTERVAL_SEC"),
        _format_property_arg("--itinv-agent-heartbeat-sec", "ITINV_AGENT_HEARTBEAT_SEC"),
        _format_property_arg("--itinv-agent-heartbeat-jitter-sec", "ITINV_AGENT_HEARTBEAT_JITTER_SEC"),
        _format_property_arg("--itinv-scan-enabled", "ITINV_SCAN_ENABLED"),
        _format_property_arg("--scan-agent-server-base", "SCAN_AGENT_SERVER_BASE"),
        _format_property_arg("--scan-agent-api-key", "SCAN_AGENT_API_KEY"),
        _format_property_arg("--scan-agent-poll-interval-sec", "SCAN_AGENT_POLL_INTERVAL_SEC"),
        _format_property_arg("--itinv-outlook-search-roots", "ITINV_OUTLOOK_SEARCH_ROOTS"),
    ]
    return " ".join(parts)


def _build_uninstall_custom_action_target() -> str:
    return " ".join(
        [
            "--msi-uninstall-cleanup",
            '--install-dir "[TARGETDIR]."',
            '--env-file-path "[CommonAppDataFolder]IT-Invent\\Agent\\.env"',
            f'--task-name "{DEFAULT_TASK_NAME}"',
        ]
    )


def _build_upgrade_backup_custom_action_target() -> str:
    script = (
        "$ErrorActionPreference='Stop';"
        "$root='[CommonAppDataFolder]IT-Invent';"
        "$backup=Join-Path $root 'AgentUpgrade';"
        "Start-Process -FilePath 'schtasks.exe' "
        "-ArgumentList @('/End','/TN','IT-Invent Agent') "
        "-WindowStyle Hidden -Wait -ErrorAction SilentlyContinue|Out-Null;"
        "foreach($processName in @('ITInventAgent','ITInventScanAgent','ITInventOutlookProbe')){"
        "Get-Process -Name $processName -ErrorAction SilentlyContinue|"
        "Stop-Process -Force -ErrorAction SilentlyContinue};"
        "New-Item -ItemType Directory -Force -Path $backup|Out-Null;"
        "foreach($name in @('Agent','ScanAgent')){"
        "$source=Join-Path $root $name;$destination=Join-Path $backup $name;"
        "if(Test-Path -LiteralPath $source){"
        "if(Test-Path -LiteralPath $destination){Remove-Item -LiteralPath $destination -Recurse -Force};"
        "Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force}}"
    )
    return (
        '"[SystemFolder]WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive '
        f'-ExecutionPolicy Bypass -WindowStyle Hidden -Command "{script}"'
    )


msi_data = {
    "CustomAction": [
        ("A_SET_TARGETDIR_FROM_INSTALLDIR", 256 + 51, "TARGETDIR", "[INSTALLDIR]"),
        ("A_BACKUP_AGENT_RUNTIME_FOR_UPGRADE", 34, "TARGETDIR", _build_upgrade_backup_custom_action_target()),
        (
            "A_RUN_AGENT_MSI_INSTALL",
            18 + 3072 + 8192,
            MSI_HELPER_EXECUTABLE_NAME,
            _build_install_custom_action_target(),
        ),
        ("A_RUN_AGENT_MSI_UNINSTALL", 18 + 3072, MSI_HELPER_EXECUTABLE_NAME, _build_uninstall_custom_action_target()),
    ],
    "InstallExecuteSequence": [
        ("A_SET_TARGETDIR_FROM_INSTALLDIR", 'NOT INSTALLDIR=""', 403),
        ("A_BACKUP_AGENT_RUNTIME_FOR_UPGRADE", "REMOVEOLDVERSION", 1401),
        ("A_RUN_AGENT_MSI_UNINSTALL", 'REMOVE="ALL"', 3499),
        ("A_RUN_AGENT_MSI_INSTALL", 'NOT REMOVE="ALL"', 6501),
    ],
    "InstallUISequence": [
        ("A_SET_TARGETDIR_FROM_INSTALLDIR", 'NOT INSTALLDIR=""', 403),
    ],
}

if any(arg.lower() == "bdist_msi" for arg in sys.argv[1:]):
    msi_data["Property"] = [
        *_load_embedded_msi_properties(),
        ("MsiHiddenProperties", "ITINV_AGENT_API_KEY;SCAN_AGENT_API_KEY;A_RUN_AGENT_MSI_INSTALL"),
    ]

bdist_msi_options = {
    "add_to_path": False,
    "initial_target_dir": r"[ProgramFiles64Folder]\\IT-Invent\\Agent",
    "all_users": True,
    "upgrade_code": UPGRADE_CODE,
    "data": msi_data,
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
    cmdclass={"bdist_msi": AgentBdistMsi},
    executables=executables,
)
