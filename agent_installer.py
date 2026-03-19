from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import Dict, List, Mapping, Optional, Sequence

import psutil


DEFAULT_TASK_NAME = "IT-Invent Agent"
DEFAULT_REPEAT_MINUTES = 60
DEFAULT_INSTALL_DIR = Path(r"C:\Program Files\IT-Invent\Agent")
DEFAULT_PROGRAM_DATA_ROOT = Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "IT-Invent"
DEFAULT_RUNTIME_ROOT = DEFAULT_PROGRAM_DATA_ROOT / "Agent"
EXECUTABLE_NAME = "ITInventAgent.exe"
MSI_HELPER_EXECUTABLE_NAME = "ITInventAgentMsiHelper.exe"
ENV_FILE_NAME = ".env"
INSTALL_SCRIPT_NAME = "install_agent_task.ps1"
UNINSTALL_SCRIPT_NAME = "uninstall_agent_task.ps1"
SCRIPTS_DIR_NAME = "scripts"
INSTALLER_MACHINE_ENV_KEYS = (
    "SCAN_AGENT_SCAN_ON_START",
    "SCAN_AGENT_WATCHDOG_ENABLED",
)
FORCED_SCAN_ENV_VALUES = {
    "SCAN_AGENT_SCAN_ON_START": "0",
    "SCAN_AGENT_WATCHDOG_ENABLED": "0",
}
MSI_DEFAULT_ENV_VALUES = {
    "ITINV_AGENT_INTERVAL_SEC": "3600",
    "ITINV_AGENT_HEARTBEAT_SEC": "300",
    "ITINV_AGENT_HEARTBEAT_JITTER_SEC": "60",
    "ITINV_SCAN_ENABLED": "1",
    "SCAN_AGENT_POLL_INTERVAL_SEC": "60",
    "ITINV_OUTLOOK_SEARCH_ROOTS": "D:\\",
}
MSI_REQUIRED_SILENT_KEYS = (
    "ITINV_AGENT_SERVER_URL",
    "ITINV_AGENT_API_KEY",
    "SCAN_AGENT_SERVER_BASE",
    "SCAN_AGENT_API_KEY",
)
MSI_ARG_TO_ENV_KEY = {
    "msi_itinv_agent_server_url": "ITINV_AGENT_SERVER_URL",
    "msi_itinv_agent_api_key": "ITINV_AGENT_API_KEY",
    "msi_itinv_agent_interval_sec": "ITINV_AGENT_INTERVAL_SEC",
    "msi_itinv_agent_heartbeat_sec": "ITINV_AGENT_HEARTBEAT_SEC",
    "msi_itinv_agent_heartbeat_jitter_sec": "ITINV_AGENT_HEARTBEAT_JITTER_SEC",
    "msi_itinv_scan_enabled": "ITINV_SCAN_ENABLED",
    "msi_scan_agent_server_base": "SCAN_AGENT_SERVER_BASE",
    "msi_scan_agent_api_key": "SCAN_AGENT_API_KEY",
    "msi_scan_agent_poll_interval_sec": "SCAN_AGENT_POLL_INTERVAL_SEC",
    "msi_itinv_outlook_search_roots": "ITINV_OUTLOOK_SEARCH_ROOTS",
}
POWERSHELL_CANDIDATES = (
    Path(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"),
    Path("powershell.exe"),
)
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def add_msi_args(parser) -> None:
    parser.add_argument("--msi-install", action="store_true", help="Internal MSI post-install entrypoint")
    parser.add_argument(
        "--msi-uninstall-cleanup",
        action="store_true",
        help="Internal MSI uninstall cleanup entrypoint",
    )
    parser.add_argument("--install-dir", default="", help="Agent install directory for MSI helper modes")
    parser.add_argument("--env-file-path", default="", help="Explicit .env path for MSI helper modes")
    parser.add_argument("--task-name", default=DEFAULT_TASK_NAME, help="Scheduled Task name for MSI helper modes")
    parser.add_argument(
        "--repeat-minutes",
        type=int,
        default=DEFAULT_REPEAT_MINUTES,
        help="Scheduled Task repetition interval for MSI helper modes",
    )
    parser.add_argument("--itinv-agent-server-url", default="", help="MSI runtime config: ITINV_AGENT_SERVER_URL")
    parser.add_argument("--itinv-agent-api-key", default="", help="MSI runtime config: ITINV_AGENT_API_KEY")
    parser.add_argument("--itinv-agent-interval-sec", default="", help="MSI runtime config: ITINV_AGENT_INTERVAL_SEC")
    parser.add_argument(
        "--itinv-agent-heartbeat-sec",
        default="",
        help="MSI runtime config: ITINV_AGENT_HEARTBEAT_SEC",
    )
    parser.add_argument(
        "--itinv-agent-heartbeat-jitter-sec",
        default="",
        help="MSI runtime config: ITINV_AGENT_HEARTBEAT_JITTER_SEC",
    )
    parser.add_argument("--itinv-scan-enabled", default="", help="MSI runtime config: ITINV_SCAN_ENABLED")
    parser.add_argument(
        "--scan-agent-server-base",
        default="",
        help="MSI runtime config: SCAN_AGENT_SERVER_BASE",
    )
    parser.add_argument("--scan-agent-api-key", default="", help="MSI runtime config: SCAN_AGENT_API_KEY")
    parser.add_argument(
        "--scan-agent-poll-interval-sec",
        default="",
        help="MSI runtime config: SCAN_AGENT_POLL_INTERVAL_SEC",
    )
    parser.add_argument(
        "--itinv-outlook-search-roots",
        default="",
        help="MSI runtime config: ITINV_OUTLOOK_SEARCH_ROOTS",
    )


def is_msi_mode(namespace) -> bool:
    return bool(getattr(namespace, "msi_install", False) or getattr(namespace, "msi_uninstall_cleanup", False))


def resolve_install_dir(raw_value: str = "") -> Path:
    candidate = str(raw_value or "").strip()
    if candidate:
        return Path(candidate)
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return DEFAULT_INSTALL_DIR


def resolve_env_file_path(install_dir: Path, raw_value: str = "") -> Path:
    candidate = str(raw_value or "").strip()
    if candidate:
        return Path(candidate)
    return DEFAULT_RUNTIME_ROOT / ENV_FILE_NAME


def resolve_executable_path(install_dir: Path) -> Path:
    installed_executable = install_dir / EXECUTABLE_NAME
    if installed_executable.exists():
        return installed_executable
    if getattr(sys, "frozen", False):
        current_executable = Path(sys.executable).resolve()
        if current_executable.name.lower() == EXECUTABLE_NAME.lower():
            return current_executable
    return installed_executable


def resolve_runtime_root(raw_env_path: str = "") -> Path:
    candidate = str(raw_env_path or "").strip()
    if candidate:
        return Path(candidate).parent
    return DEFAULT_RUNTIME_ROOT


def _read_text_with_fallback(path: Path) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            return path.read_text(encoding=enc)
        except Exception:
            continue
    return ""


def read_env_map(path: Path) -> Dict[str, str]:
    if not path.exists() or not path.is_file():
        return {}
    text = _read_text_with_fallback(path)
    if not text:
        return {}
    result: Dict[str, str] = {}
    for line in text.splitlines():
        row = line.strip()
        if not row or row.startswith("#") or "=" not in row:
            continue
        key, value = row.split("=", 1)
        key = key.strip()
        if not key:
            continue
        result[key] = value.strip()
    return result


def _legacy_env_paths(install_dir: Path, env_file_path: Path) -> List[Path]:
    candidates = [
        install_dir / ENV_FILE_NAME,
        DEFAULT_PROGRAM_DATA_ROOT / ENV_FILE_NAME,
    ]
    normalized_current = str(env_file_path.resolve() if env_file_path.exists() else env_file_path).lower()
    legacy_paths: List[Path] = []
    seen = set()
    for candidate in candidates:
        normalized = str(candidate).lower()
        if normalized == normalized_current or normalized in seen:
            continue
        seen.add(normalized)
        legacy_paths.append(candidate)
    return legacy_paths


def read_runtime_env_map(env_file_path: Path, install_dir: Path) -> Dict[str, str]:
    merged = read_env_map(env_file_path)
    for legacy_path in _legacy_env_paths(install_dir, env_file_path):
        for key, value in read_env_map(legacy_path).items():
            merged.setdefault(key, value)
    return merged


def cleanup_legacy_env_files(install_dir: Path, env_file_path: Path, logger) -> None:
    for legacy_path in _legacy_env_paths(install_dir, env_file_path):
        if not legacy_path.exists():
            continue
        try:
            legacy_path.unlink()
            logger.info("Removed legacy runtime env file: %s", legacy_path)
        except Exception as exc:
            logger.warning("Failed to remove legacy runtime env file %s: %s", legacy_path, exc)


def build_runtime_env_values(existing: Mapping[str, str], overrides: Mapping[str, str]) -> Dict[str, str]:
    merged: Dict[str, str] = {}
    ordered_keys: List[str] = []
    for key in (
        *MSI_ARG_TO_ENV_KEY.values(),
        *MSI_DEFAULT_ENV_VALUES.keys(),
        *FORCED_SCAN_ENV_VALUES.keys(),
        *existing.keys(),
    ):
        if key not in ordered_keys:
            ordered_keys.append(key)
    for key in ordered_keys:
        raw_override = str(overrides.get(key, "") or "").strip()
        if raw_override:
            merged[key] = raw_override
            continue
        if key in existing and str(existing.get(key, "") or "").strip():
            merged[key] = str(existing.get(key, "")).strip()
            continue
        default_value = str(MSI_DEFAULT_ENV_VALUES.get(key, "") or "").strip()
        if default_value:
            merged[key] = default_value
    merged.update(FORCED_SCAN_ENV_VALUES)
    return merged


def upsert_env_file(path: Path, values: Mapping[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    existing_text = _read_text_with_fallback(path) if path.exists() else ""
    lines = existing_text.splitlines()
    rendered: List[str] = []
    pending = {key: str(value) for key, value in values.items()}

    for line in lines:
        row = line.strip()
        if not row or row.startswith("#") or "=" not in row:
            rendered.append(line)
            continue
        key, _ = row.split("=", 1)
        key = key.strip()
        if key in pending:
            rendered.append(f"{key}={pending.pop(key)}")
        else:
            rendered.append(line)

    for key, value in pending.items():
        rendered.append(f"{key}={value}")

    content = "\n".join(rendered).rstrip() + "\n"
    path.write_text(content, encoding="utf-8", newline="\n")


def missing_required_keys(values: Mapping[str, str]) -> List[str]:
    missing: List[str] = []
    for key in MSI_REQUIRED_SILENT_KEYS:
        if not str(values.get(key, "") or "").strip():
            missing.append(key)
    return missing


def namespace_to_env_overrides(namespace) -> Dict[str, str]:
    overrides: Dict[str, str] = {}
    for attr_name, env_key in MSI_ARG_TO_ENV_KEY.items():
        raw_value = getattr(namespace, attr_name, "")
        if raw_value is None:
            continue
        overrides[env_key] = str(raw_value).strip()
    return overrides


def _resolve_powershell() -> str:
    for candidate in POWERSHELL_CANDIDATES:
        if candidate.name.lower() == "powershell.exe":
            return str(candidate)
        if candidate.exists():
            return str(candidate)
    return "powershell.exe"


def resolve_script_path(script_name: str) -> Path:
    candidates: List[Path] = []
    current_file = Path(__file__).resolve()
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).resolve().parent
        candidates.extend(
            [
                exe_dir / SCRIPTS_DIR_NAME / script_name,
                exe_dir / script_name,
            ]
        )
    candidates.extend(
        [
            current_file.parent / "agent" / SCRIPTS_DIR_NAME / script_name,
            current_file.parent / SCRIPTS_DIR_NAME / script_name,
            Path.cwd() / "agent" / SCRIPTS_DIR_NAME / script_name,
            Path.cwd() / SCRIPTS_DIR_NAME / script_name,
        ]
    )

    seen = set()
    for candidate in candidates:
        key = str(candidate).lower()
        if key in seen:
            continue
        seen.add(key)
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"Installer helper script not found: {script_name}")


def _run_command(args: Sequence[str], timeout_sec: int = 180) -> subprocess.CompletedProcess:
    return subprocess.run(
        list(args),
        capture_output=True,
        text=True,
        timeout=timeout_sec,
        creationflags=CREATE_NO_WINDOW,
        check=False,
    )


def _run_powershell_script(script_path: Path, script_args: Sequence[str]) -> None:
    command = [
        _resolve_powershell(),
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script_path),
        *script_args,
    ]
    result = _run_command(command)
    if result.returncode != 0:
        stdout = (result.stdout or "").strip()
        stderr = (result.stderr or "").strip()
        detail = "\n".join(part for part in (stdout, stderr) if part).strip()
        raise RuntimeError(f"PowerShell script failed ({script_path.name}, code={result.returncode})\n{detail}".strip())


def stop_agent_processes(process_name: str = "ITInventAgent", skip_pid: Optional[int] = None) -> List[int]:
    stopped: List[int] = []
    base_names = {process_name.lower(), "itinventoutlookprobe"}
    names = set(base_names)
    names.update(f"{name}.exe" for name in base_names)
    for proc in psutil.process_iter(["pid", "name"]):
        try:
            pid = int(proc.info.get("pid") or 0)
            name = str(proc.info.get("name") or "").strip().lower()
            if not name or name not in names:
                continue
            if skip_pid is not None and pid == skip_pid:
                continue
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()
            stopped.append(pid)
        except Exception:
            continue
    return stopped


def get_msi_helper_log_path() -> Path:
    return Path(tempfile.gettempdir()) / "itinvent_agent_msi_helper.log"


def run_msi_install(namespace, logger) -> int:
    install_dir = resolve_install_dir(getattr(namespace, "install_dir", ""))
    env_file_path = resolve_env_file_path(install_dir, getattr(namespace, "env_file_path", ""))
    executable_path = resolve_executable_path(install_dir)
    overrides = namespace_to_env_overrides(namespace)
    existing = read_runtime_env_map(env_file_path, install_dir)
    merged = build_runtime_env_values(existing, overrides)
    upsert_env_file(env_file_path, merged)
    cleanup_legacy_env_files(install_dir, env_file_path, logger)

    missing = missing_required_keys(merged)
    if missing:
        logger.warning(
            "MSI install helper wrote .env but some recommended silent-install keys are empty: %s",
            ", ".join(missing),
        )

    script_path = resolve_script_path(INSTALL_SCRIPT_NAME)
    _run_powershell_script(
        script_path,
        [
            "-TaskName",
            str(getattr(namespace, "task_name", DEFAULT_TASK_NAME) or DEFAULT_TASK_NAME),
            "-ExecutablePath",
            str(executable_path),
            "-RepeatMinutes",
            str(max(1, int(getattr(namespace, "repeat_minutes", DEFAULT_REPEAT_MINUTES) or DEFAULT_REPEAT_MINUTES))),
            "-EnvFilePath",
            str(env_file_path),
            "-StartAfterRegister",
        ],
    )
    logger.info("MSI install helper completed successfully. Runtime env written to %s", env_file_path)
    return 0


def run_msi_uninstall_cleanup(namespace, logger) -> int:
    install_dir = resolve_install_dir(getattr(namespace, "install_dir", ""))
    env_file_path = resolve_env_file_path(install_dir, getattr(namespace, "env_file_path", ""))
    runtime_root = resolve_runtime_root(str(env_file_path))
    stop_agent_processes()

    script_path = resolve_script_path(UNINSTALL_SCRIPT_NAME)
    _run_powershell_script(
        script_path,
        [
            "-TaskName",
            str(getattr(namespace, "task_name", DEFAULT_TASK_NAME) or DEFAULT_TASK_NAME),
            "-InstallPath",
            str(install_dir),
            "-RuntimeRoot",
            str(runtime_root),
            "-LegacyProgramDataRoot",
            str(DEFAULT_PROGRAM_DATA_ROOT),
            "-SkipInstallPathRemoval",
            "-ClearInstallerEnv",
        ],
    )
    logger.info("MSI uninstall cleanup helper completed successfully for %s", install_dir)
    return 0
