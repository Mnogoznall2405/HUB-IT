"""Bounded, read-only incident snapshots without credentials or SQL text."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
ROUTES = {
    "backend": "http://127.0.0.1:8001/health/ready",
    "chat-a": "http://127.0.0.1:8002/health/ready",
    "chat-b": "http://127.0.0.1:8004/health/ready",
    "inventory": "http://127.0.0.1:8012/health/ready",
    "scan": "http://127.0.0.1:8011/health",
    "voice": "http://127.0.0.1:8013/health",
}


def fetch(url):
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            data = json.load(response)
            result = {"code": response.status, "status": data.get("status")}
            if url.endswith("/health/pools"):
                for key in ("app_db", "chat_db"):
                    pool = data.get(key) or {}
                    result[key] = {k: pool.get(k) for k in (
                        "available", "pool_size", "max_overflow", "checked_out",
                        "checked_in", "overflow", "timeout",
                    )}
                sender = data.get("realtime_sender") or {}
                result["realtime"] = {k: v for k, v in sender.items() if
                    "event_loop_lag" in k or "queue_depth" in k or k == "local_connection_count"}
            return {**result, "ms": round((time.perf_counter() - started) * 1000, 2)}
    except Exception as error:
        return {"code": getattr(error, "code", None), "error": type(error).__name__,
                "ms": round((time.perf_counter() - started) * 1000, 2)}


def postgres_snapshot():
    from dotenv import dotenv_values
    import psycopg
    from sqlalchemy.engine import make_url

    settings = dotenv_values(ROOT / ".env")
    url = make_url(settings.get("CHAT_DATABASE_URL") or settings["APP_DATABASE_URL"])
    with psycopg.connect(host=url.host, port=url.port or 5432, dbname=url.database,
                        user=url.username, password=url.password, connect_timeout=5,
                        application_name="hubit-incident-readonly", autocommit=True,
                        options="-c default_transaction_read_only=on -c statement_timeout=5000") as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_setting('max_connections')::int, count(*) FROM pg_stat_activity")
            maximum, used = cur.fetchone()
            cur.execute("""SELECT pid, application_name, state, wait_event_type, wait_event,
                backend_start, extract(epoch FROM now()-xact_start), pg_blocking_pids(pid)
                FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
                ORDER BY backend_start LIMIT 350""")
            sessions = cur.fetchall()
            cur.execute("""SELECT a.pid, a.application_name, l.classid::bigint, l.objid::bigint
                FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
                WHERE l.locktype='advisory' AND l.granted LIMIT 50""")
            locks = cur.fetchall()
    return {"max_connections": maximum, "connections": used, "sessions": sessions,
            "advisory_owners": locks}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=1)
    parser.add_argument("--probe-gap-seconds", type=int, default=0)
    args = parser.parse_args()
    result = {"captured_at": datetime.now(timezone.utc).isoformat(), "probe_gap_seconds": args.probe_gap_seconds, "http": {}}
    samples = {name: [] for name in ROUTES}
    with ThreadPoolExecutor(max_workers=6) as executor:
        for _ in range(max(1, min(20, args.samples))):
            jobs = {name: executor.submit(fetch, url) for name, url in ROUTES.items()}
            for name, job in jobs.items():
                samples[name].append(job.result())
            if args.samples > 1:
                time.sleep(.5)
    for name, rows in samples.items():
        good = sorted(row["ms"] for row in rows if row.get("code") == 200 and row.get("status") == "ok")
        result["http"][name] = {"samples": len(rows), "success": len(good),
            **{f"p{int(p*100)}_ms": good[math.ceil(len(good)*p)-1] if good else None
               for p in (.5, .95, .99)}, "failures": [r for r in rows if r.get("code") != 200]}
    result["pools"] = {name: fetch(f"http://127.0.0.1:{port}/health/pools")
                       for name, port in (("chat-a", 8002), ("chat-b", 8004))}
    try:
        result["postgres"] = postgres_snapshot()
    except Exception as error:
        result["postgres"] = {"error": type(error).__name__, "sqlstate": getattr(error, "sqlstate", None)}
    # No process command lines, environment, logs, SQL text or memory dumps.
    command = """
    $first=Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk | Where-Object Name -eq '_Total'
    Start-Sleep -Milliseconds 1000
    $second=Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk | Where-Object Name -eq '_Total'
    function DiskMilliseconds($counter,$base) {
        $count=[double]$second.$base-[double]$first.$base
        if($count -le 0 -or -not $second.Frequency_PerfTime){ return $null }
        return [math]::Round(1000*([double]$second.$counter-[double]$first.$counter)/[double]$second.Frequency_PerfTime/$count,3)
    }
    $os=Get-CimInstance Win32_OperatingSystem
    $processes=@(Get-Process python,node -ErrorAction SilentlyContinue | ForEach-Object {
        $proc=$_; $waiting=@{}
        foreach($thread in $proc.Threads){
            try { if($thread.ThreadState -eq 'Wait'){ $reason=[string]$thread.WaitReason; $waiting[$reason]++ } } catch {}
        }
        [pscustomobject]@{PID=$proc.Id;Name=$proc.ProcessName;CPUSeconds=$proc.CPU;MemoryMB=[math]::Round($proc.WorkingSet64/1MB);ThreadWaitReasons=$waiting}
    })
    [pscustomobject]@{
        DiskReadMs=(DiskMilliseconds 'AvgDisksecPerRead' 'AvgDisksecPerRead_Base')
        DiskWriteMs=(DiskMilliseconds 'AvgDisksecPerWrite' 'AvgDisksecPerWrite_Base')
        DiskQueue=$second.CurrentDiskQueueLength
        FreeMemoryMB=[math]::Round($os.FreePhysicalMemory/1024)
        BootTime=$os.LastBootUpTime.ToUniversalTime().ToString('o')
        Processes=$processes
    } | ConvertTo-Json -Depth 5 -Compress
    """
    try:
        proc = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
                              capture_output=True, text=True, timeout=10)
        result["system"] = json.loads(proc.stdout) if proc.returncode == 0 else {"error": "unavailable"}
    except Exception as error:
        result["system"] = {"error": type(error).__name__}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "http": result["http"], "pools": result["pools"]}))


if __name__ == "__main__":
    main()
