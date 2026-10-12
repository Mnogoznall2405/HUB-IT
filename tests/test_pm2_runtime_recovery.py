"""Operational boundaries: real PowerShell scripts against an isolated PM2 shim.

These failures (saved env drift, inherited stdout, restart storms) cannot be
exercised by browser E2E. No production ports, PM2 daemon or database is used.
"""
from __future__ import annotations

from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading

import pytest

ROOT = Path(__file__).resolve().parents[1]
PS = Path(os.environ.get("WINDIR", "C:/Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe"
pytestmark = pytest.mark.skipif(not PS.exists(), reason="Windows PowerShell operational harness")


def run_ps(path, *args, env=None):
    return subprocess.run([str(PS), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                           "-File", str(path), *map(str, args)], env=env if env is not None else dict(os.environ),
                          capture_output=True, text=True, timeout=30)


@contextmanager
def readiness_server(ready):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200 if ready else 503)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok" if ready else "degraded", "chat": {
                "realtime_transport": "postgres", "realtime_available": ready,
                "realtime_subscriber_ready": ready}}).encode())

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_port
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def isolated_stack(tmp_path, port):
    scripts = tmp_path / "scripts/pm2"
    scripts.mkdir(parents=True)
    for name in ("pm2-boot-resurrect.ps1", "pm2-watchdog.ps1", "chat-runtime-mode.ps1",
                 "runtime-operations.ps1", "runtime-policy.js"):
        shutil.copyfile(ROOT / "scripts/pm2" / name, scripts / name)
    # Only the target address is redirected. Real HTTP and readiness validation run.
    with (scripts / "runtime-operations.ps1").open("a", encoding="utf-8") as file:
        file.write("\nfunction Get-HubitHealthTargets { param([string]$ChatMode) "
                   f"return @([pscustomobject]@{{Name='itinvent-chat-a';Url='http://127.0.0.1:{port}/health/ready'}}) }}\n")
    app = {"name": "itinvent-chat-a", "env": {"APP_DB_POOL_SIZE": "10", "APP_DB_MAX_OVERFLOW": "5"}}
    (scripts / "ecosystem.all.config.js").write_text("module.exports=" + json.dumps({"apps": [app]}), encoding="utf-8")
    npm = tmp_path / "profile/AppData/Roaming/npm"
    cli = npm / "node_modules/pm2/bin/pm2"
    cli.parent.mkdir(parents=True)
    (npm / "pm2.cmd").write_text("@echo off\n", encoding="ascii")
    cli.write_text("""
const fs=require('fs'); const path=require('path');
const dir=process.env.HUBIT_TEST_DIR;
const command=process.argv[2];
fs.appendFileSync(path.join(dir,'events.jsonl'),JSON.stringify({command})+'\\n');
if(command==='jlist') console.log(JSON.stringify([{name:'itinvent-chat-a',pid:999,
 pm2_env:{status:'online',APP_DB_POOL_SIZE:'10',APP_DB_MAX_OVERFLOW:'5',username:'a',USERNAME:'b',TOKEN:'private'}}]));
else console.log('ok');
""", encoding="utf-8")
    env = dict(os.environ, APPDATA=str(npm.parent), USERPROFILE=str(tmp_path / "profile"),
               PM2_HOME=str(tmp_path / ".pm2"), HUBIT_CHAT_MODE="dual", HUBIT_TEST_DIR=str(tmp_path))
    return scripts, env


@pytest.mark.parametrize("ready", [False, True])
def test_boot_never_saves_online_but_unready_stack(tmp_path, ready):
    with readiness_server(ready) as port:
        scripts, env = isolated_stack(tmp_path, port)
        result = run_ps(scripts / "pm2-boot-resurrect.ps1", "-ProjectRoot", tmp_path,
                        "-DelaySeconds", 0, "-SettleSeconds", 0, "-ChatReadyTimeoutSec", 1,
                        "-NoChatStaging", env=env)
    commands = [json.loads(line)["command"] for line in (tmp_path / "events.jsonl").read_text().splitlines()]
    if ready:
        assert result.returncode == 0, result.stdout + result.stderr
        assert commands.count("save") == 1
    else:
        assert result.returncode != 0
        assert "save" not in commands
        assert "Readiness failed" in (scripts / "_boot_resurrect.log").read_text(encoding="utf-8-sig")


def test_watchdog_detects_hung_online_node_without_mutating_runtime(tmp_path):
    with readiness_server(False) as port:
        scripts, env = isolated_stack(tmp_path, port)
        result = run_ps(scripts / "pm2-watchdog.ps1", "-ProjectRoot", tmp_path, "-CheckOnly", env=env)
    assert result.returncode != 0
    assert json.loads(result.stdout)["Readiness"] == ["itinvent-chat-a"]
    events = [json.loads(line)["command"] for line in (tmp_path / "events.jsonl").read_text().splitlines()]
    assert events == ["jlist"]
    assert not (scripts / "_watchdog_state.json").exists()


def test_saved_env_drift_and_case_duplicates_do_not_hide_small_auth_pool(tmp_path):
    script = tmp_path / "policy.ps1"
    script.write_text(f"""
$ErrorActionPreference='Stop'
$ErrorActionPreference='Stop'
. '{ROOT / 'scripts/pm2/runtime-operations.ps1'}'
$raw='[{{"name":"itinvent-chat-a","pid":1,"pm2_env":{{"status":"online","username":"a","USERNAME":"b","APP_DB_POOL_SIZE":"2","APP_DB_MAX_OVERFLOW":"0","TOKEN":"private"}}}}]'
$snapshot=Convert-HubitPm2Snapshot -Json $raw
$expected=ConvertFrom-Json '[{{"Name":"itinvent-chat-a","Environment":{{"APP_DB_POOL_SIZE":"10","APP_DB_MAX_OVERFLOW":"5"}}}}]'
[pscustomobject]@{{Drift=(Get-HubitConfigDrift -Expected $expected -Snapshot $snapshot);Snapshot=$snapshot}}|ConvertTo-Json -Depth 6
""", encoding="utf-8-sig")
    result = run_ps(script)
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["Drift"][0]["Name"] == "itinvent-chat-a"
    assert set(payload["Drift"][0]["Keys"]) == {"APP_DB_POOL_SIZE", "APP_DB_MAX_OVERFLOW"}
    assert "TOKEN" not in result.stdout and "private" not in result.stdout


def test_recovery_requires_repeated_failure_and_enforces_cooldown_and_hourly_limit(tmp_path):
    script = tmp_path / "breaker.ps1"
    script.write_text(f"""
. '{ROOT / 'scripts/pm2/runtime-operations.ps1'}'
$now=[datetime]'2026-10-07T11:00:00Z'
$old=$now.AddHours(-2)
@(
 Get-HubitRecoveryDecision -Failures 2 -Now $now -LastAttempt $old -Attempts @()
 Get-HubitRecoveryDecision -Failures 3 -Now $now -LastAttempt $old -Attempts @()
 Get-HubitRecoveryDecision -Failures 3 -Now $now -LastAttempt ($now.AddMinutes(-1)) -Attempts @()
 Get-HubitRecoveryDecision -Failures 9 -Now $now -LastAttempt ($now.AddMinutes(-20)) -Attempts @($now.AddMinutes(-20),$now.AddMinutes(-40))
)|ConvertTo-Json
""", encoding="utf-8-sig")
    result = run_ps(script)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == ["wait", "recover", "cooldown", "circuit_open"]


def test_recovery_cooldown_uses_utc_when_saved_dates_parse_as_local_time(tmp_path):
    script = tmp_path / "utc.ps1"
    script.write_text(f"""
. '{ROOT / 'scripts/pm2/runtime-operations.ps1'}'
$now=[datetime]::SpecifyKind([datetime]'2026-10-07T11:00:00',[DateTimeKind]::Utc)
$saved=[datetime]'2026-10-07T10:45:00Z'
Get-HubitRecoveryDecision -Failures 3 -Now $now -LastAttempt $saved -Attempts @($saved)
""", encoding="utf-8-sig")
    result = run_ps(script)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "recover"


def test_healthy_watchdog_records_a_heartbeat_without_restarting_apps(tmp_path):
    with readiness_server(True) as port:
        scripts, env = isolated_stack(tmp_path, port)
        result = run_ps(scripts / "pm2-watchdog.ps1", "-ProjectRoot", tmp_path, "-BootGraceMinutes", 0, env=env)
    assert result.returncode == 0, result.stdout + result.stderr
    state = json.loads((scripts / "_watchdog_state.json").read_text(encoding="utf-8-sig"))
    assert state["itinvent-chat-a"]["Failures"] == 0
    assert state["_last_probe_utc"]
    events = [json.loads(line)["command"] for line in (tmp_path / "events.jsonl").read_text().splitlines()]
    assert events == ["jlist"]


def test_hung_command_client_is_bounded_without_waiting_for_its_stdout(tmp_path):
    slow = tmp_path / "slow.js"
    slow.write_text("setTimeout(()=>process.exit(0),5000)", encoding="utf-8")
    script = tmp_path / "bounded.ps1"
    script.write_text(f"""
. '{ROOT / 'scripts/pm2/runtime-operations.ps1'}'
$clock=[Diagnostics.Stopwatch]::StartNew()
$result=Invoke-HubitCommand -Executable (Get-Command node).Source -Arguments @('{slow}') -TimeoutSeconds 1
[pscustomobject]@{{Exit=$result.ExitCode;TimedOut=$result.TimedOut;Elapsed=$clock.Elapsed.TotalSeconds}}|ConvertTo-Json
""", encoding="utf-8-sig")
    result = run_ps(script)
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["Exit"] == 124 and payload["TimedOut"] is True, result.stdout + result.stderr
    assert payload["Elapsed"] < 4


@pytest.mark.parametrize("ready", [False, True])
def test_rolling_restart_keeps_unready_node_out_of_arr_and_does_not_save(tmp_path, ready):
    with readiness_server(ready) as port:
        scripts, env = isolated_stack(tmp_path, port)
        (tmp_path / ".env").write_text("CHAT_REALTIME_TRANSPORT=postgres\nCHAT_REALTIME_REQUIRED=1\n", encoding="ascii")
        (tmp_path / "scripts/check_postgres_connection_budget.py").write_text("print('isolated budget gate')", encoding="ascii")
        source = (ROOT / "scripts/pm2/restart-chat-scale.ps1").read_text(encoding="utf-8-sig")
        # Real entrypoint, fake IIS and listeners; every external action stays in this fixture.
        overrides = """
function Get-ChatFarmServerAddress { param([int]$Port) return 'fixture-node' }
function Set-ChatFarmServerEnabled {
    param([string]$Address,[bool]$Enabled)
    Add-Content -LiteralPath (Join-Path $projectRoot 'farm-events.txt') -Value ([string]$Enabled)
}
function Get-PortListenerPids { param([int]$ListenPort) return @() }
"""
        source = source.replace("if (-not (Test-Path -LiteralPath $envPath)) {", overrides + "\nif (-not (Test-Path -LiteralPath $envPath)) {")
        source = source.replace("http://127.0.0.1:8002/health/ready", f"http://127.0.0.1:{port}/health/ready")
        script = scripts / "restart-chat-scale.ps1"
        script.write_text(source, encoding="utf-8-sig")
        result = run_ps(script, "-ProjectRoot", tmp_path, "-NodeName", "itinvent-chat-a",
                        "-SkipSharedWorkers", "-ReadyTimeoutSec", 1, "-DrainWaitSec", 0, env=env)
    farm = (tmp_path / "farm-events.txt").read_text(encoding="utf-8-sig").splitlines()
    commands = [json.loads(line)["command"] for line in (tmp_path / "events.jsonl").read_text().splitlines()]
    if ready:
        assert result.returncode == 0, result.stdout + result.stderr
        assert farm == ["False", "True"]
        assert commands.count("save") == 1
    else:
        assert result.returncode != 0
        assert farm == ["False"]
        assert "save" not in commands


def test_orphans_are_unmanaged_leftovers_of_expected_apps_only(tmp_path):
    """A dead PM2 daemon leaves workers that hold singleton locks; only those may be reported.

    Browser E2E cannot create this state, and a false positive here means killing a healthy worker:
    managed pids, live parents, reused parent pids and unrelated processes must all stay out.
    """
    script = tmp_path / "orphans.ps1"
    script.write_text(f"""
. '{ROOT / 'scripts/pm2/runtime-operations.ps1'}'
$py='C:\Py\python.exe'
$expected=@(
 [pscustomobject]@{{Name='itinvent-mail';Executable=$py;Arguments='start_mail.py'}}
 [pscustomobject]@{{Name='itinvent-scan';Executable=$py;Arguments='-m scan_server'}}
 [pscustomobject]@{{Name='itinvent-scan-worker';Executable=$py;Arguments='-m scan_server.worker_main'}}
)
$snapshot=@([pscustomobject]@{{Name='itinvent-scan';PID=500}})
function P($id,$parent,$created,$cmd) {{ [pscustomobject]@{{ProcessId=$id;ParentProcessId=$parent;CreationDate=[datetime]$created;CommandLine=$cmd}} }}
$processes=@(
 (P 100 1 '2026-10-07T10:36:00Z' '"C:\Py\python.exe" start_mail.py')
 (P 500 1 '2026-10-07T10:36:00Z' 'C:\Py\python.exe -m scan_server')
 (P 150 4 '2026-10-07T10:00:00Z' 'C:\Windows\parent.exe')
 (P 200 150 '2026-10-07T10:36:00Z' 'C:\Py\python.exe start_mail.py')
 (P 301 4 '2026-10-12T00:50:00Z' 'C:\Windows\reused.exe')
 (P 300 301 '2026-10-07T10:36:00Z' 'C:\Py\python.exe start_mail.py')
 (P 400 1 '2026-10-07T10:36:00Z' 'C:\Py\python.exe -m scan_server.worker_main')
 (P 600 1 '2026-10-07T10:36:00Z' 'C:\Windows\notepad.exe')
)
$found=@(Get-HubitOrphanProcesses -Expected $expected -Snapshot $snapshot -Processes $processes)
[pscustomobject]@{{Pids=@($found | ForEach-Object {{ $_.ProcessId }});
 WorkerApps=@(($found | Where-Object {{ $_.ProcessId -eq 400 }}).Apps)}} | ConvertTo-Json
""", encoding="utf-8-sig")
    result = run_ps(script)
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert sorted(payload["Pids"]) == [100, 300, 400]
    assert payload["WorkerApps"] == ["itinvent-scan-worker"]


def test_orphan_stop_is_aged_covered_by_pm2_and_one_per_run(tmp_path):
    script = tmp_path / "stop_policy.ps1"
    script.write_text(f"""
. '{ROOT / 'scripts/pm2/runtime-operations.ps1'}'
$now=[datetime]::SpecifyKind([datetime]'2026-10-12T02:00:00',[DateTimeKind]::Utc)
$orphans=@(
 [pscustomobject]@{{ProcessId=100;Apps=@('itinvent-mail')}}
 [pscustomobject]@{{ProcessId=400;Apps=@('itinvent-scan-worker')}}
 [pscustomobject]@{{ProcessId=700;Apps=@('not-in-pm2')}}
 [pscustomobject]@{{ProcessId=800;Apps=@('itinvent-mail')}}
)
$seen=@{{100=$now.AddMinutes(-10);400=$now.AddMinutes(-1);700=$now.AddMinutes(-30);800=$now.AddMinutes(-20)}}
$known=@('itinvent-mail','itinvent-scan-worker')
$first=@(Select-HubitOrphansToStop -Orphans $orphans -FirstSeen $seen -Now $now -KnownAppNames $known -OnlineCount 5)
$none=@(Select-HubitOrphansToStop -Orphans $orphans -FirstSeen $seen -Now $now -KnownAppNames $known -OnlineCount 0)
$wide=@(Select-HubitOrphansToStop -Orphans $orphans -FirstSeen $seen -Now $now -KnownAppNames $known -OnlineCount 5 -MaxPerRun 5)
[pscustomobject]@{{First=@($first | ForEach-Object {{ $_.ProcessId }});None=@($none | ForEach-Object {{ $_.ProcessId }});
 Wide=@($wide | ForEach-Object {{ $_.ProcessId }})}} | ConvertTo-Json
""", encoding="utf-8-sig")
    result = run_ps(script)
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["First"] == [100]          # one per run; 400 too young, 700 has no PM2 entry
    assert payload["None"] == []              # PM2 runs nothing: the watchdog's resurrect path owns that case
    assert payload["Wide"] == [100, 800]      # 400 still too young, 700 unknown


def test_failed_replacement_after_stop_starts_the_service_again(tmp_path):
    # A recovery that stops a service and then fails must not leave it down until the next cooldown.
    scripts, env = isolated_stack(tmp_path, 1)
    npm = tmp_path / "profile/AppData/Roaming/npm"
    (npm / "node_modules/pm2/bin/pm2").write_text("""
const fs=require('fs'); const path=require('path');
const command=process.argv[2];
fs.appendFileSync(path.join(process.env.HUBIT_TEST_DIR,'events.jsonl'),JSON.stringify({command})+'\\n');
if(command==='delete') process.exit(1);
console.log('ok');
""", encoding="utf-8")
    script = tmp_path / "restart.ps1"
    script.write_text(f"""
$ErrorActionPreference='Stop'
. '{scripts / 'runtime-operations.ps1'}'
function Get-NetTCPConnection {{ @() }}
try {{ Restart-HubitSimpleService -Name 'itinvent-inventory' -Pm2Command '{npm / 'pm2.cmd'}' -ProjectRoot '{tmp_path}' }}
catch {{ Write-Output ('failed: ' + $_.Exception.Message) }}
""", encoding="utf-8-sig")
    result = run_ps(script, env=env)
    assert "failed: Cannot replace the selected PM2 registration." in result.stdout, result.stdout + result.stderr
    commands = [json.loads(line)["command"] for line in (tmp_path / "events.jsonl").read_text().splitlines()]
    assert commands == ["stop", "delete", "start"]
