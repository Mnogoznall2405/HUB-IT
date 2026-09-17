from __future__ import annotations

import re
import runpy
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
START_SERVER = ROOT / "WEB-itinvent" / "start_server.py"
RESTART_SCRIPT = ROOT / "scripts" / "pm2" / "restart-backend.ps1"
PM2_README = ROOT / "scripts" / "pm2" / "README.md"


def test_start_server_does_not_kill_or_inspect_other_processes(monkeypatch):
    source = START_SERVER.read_text(encoding="utf-8")
    for forbidden in (
        "taskkill",
        "wmic",
        "netstat",
        "_kill_start_server_processes",
        "_free_stale_port_on_windows",
        "subprocess.run",
    ):
        assert forbidden not in source

    import uvicorn

    calls = []
    monkeypatch.setattr(uvicorn, "run", lambda *args, **kwargs: calls.append((args, kwargs)))
    monkeypatch.setenv("BACKEND_HOST", "127.0.0.1")
    monkeypatch.setenv("BACKEND_PORT", "18001")

    runpy.run_path(str(START_SERVER), run_name="__main__")

    assert len(calls) == 1
    args, kwargs = calls[0]
    assert args == ("backend.main:app",)
    assert kwargs == {
        "host": "127.0.0.1",
        "port": 18001,
        "workers": 1,
        "ws_per_message_deflate": False,
        "loop": "backend.uvicorn_loops:windows_selector_loop_factory",
        "reload": False,
    }


def test_restart_backend_owns_cleanup_and_requires_stable_matching_pid():
    source = RESTART_SCRIPT.read_text(encoding="utf-8")

    for required in (
        "Refusing to kill non-backend listener",
        "Get-ProcessCommandLine",
        "Test-IsBackendCommandLine",
        "Get-Pm2ProcessState",
        ".Status -eq 'online'",
        "$lastListeners -contains $state.PID",
        "Test-BackendReady",
        "StabilitySeconds",
        "SkipScanRestart",
        "Stop-OrphanBackendProcesses",
        "Wait-BackendReady",
        "pid $ProcessName",
        "start_server\\.py",
    ):
        assert required in source

    assert "jlist" not in source
    assert "ConvertFrom-Json" not in source

    assert "logs $ProcessName --lines 30 --nostream" in source
    assert re.search(r"throw\b.*not become ready", source)
    assert "Start-Sleep -Seconds 12" not in source
    assert "$LASTEXITCODE -ne 0" in source

    stop_idx = source.index("stop $ProcessName")
    orphan_idx = source.index("Stop-OrphanBackendProcesses -ListenPort $Port")
    delete_idx = source.index("delete $ProcessName")
    start_idx = source.index("start $ecosystemBackend --only $ProcessName --update-env")
    ready_idx = source.index("Wait-BackendReady", start_idx)
    assert stop_idx < orphan_idx < delete_idx < start_idx < ready_idx

    guard_idx = source.index("-not $SkipScanRestart")
    scan_idx = source.index("restart-scan.ps1")
    assert guard_idx < scan_idx

    readme = PM2_README.read_text(encoding="utf-8")
    assert "powershell -File scripts\\pm2\\restart-backend.ps1" in readme
    assert "pm2 restart itinvent-backend" not in readme
