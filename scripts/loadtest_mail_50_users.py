from __future__ import annotations

import argparse
import json
import ssl
import statistics
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from http.cookiejar import CookieJar
from pathlib import Path
from typing import Any


DEFAULT_API_BASE = "http://127.0.0.1:8001/api/v1"


@dataclass
class Credential:
    username: str
    password: str


@dataclass
class RunStats:
    lock: threading.Lock = field(default_factory=threading.Lock)
    started_at: float = field(default_factory=time.monotonic)
    finished_at: float = 0.0
    scenario_loops: int = 0
    request_count: int = 0
    error_count: int = 0
    rss_samples_mb: list[float] = field(default_factory=list)
    timings_ms: dict[str, list[float]] = field(
        default_factory=lambda: {
            "login": [],
            "bootstrap_cold": [],
            "bootstrap_warm": [],
            "list_cold": [],
            "list_warm": [],
            "detail": [],
            "mark_read": [],
        }
    )
    error_samples: list[str] = field(default_factory=list)

    def record_timing(self, name: str, elapsed_ms: float) -> None:
        with self.lock:
            self.request_count += 1
            self.timings_ms.setdefault(name, []).append(float(elapsed_ms))

    def record_error(self, stage: str, message: str) -> None:
        payload = f"{stage}: {message}"
        with self.lock:
            self.request_count += 1
            self.error_count += 1
            if len(self.error_samples) < 20:
                self.error_samples.append(payload)

    def record_loop(self) -> None:
        with self.lock:
            self.scenario_loops += 1

    def record_rss(self, rss_mb: float) -> None:
        with self.lock:
            self.rss_samples_mb.append(float(rss_mb))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mail load test for ~50 concurrent online users without Redis.")
    parser.add_argument("--api-base", default=DEFAULT_API_BASE, help="API base URL, e.g. http://127.0.0.1:8001/api/v1")
    parser.add_argument("--users-file", help="JSON file with a list of {username,password} objects")
    parser.add_argument("--username", help="Single username to reuse when users-file is not provided")
    parser.add_argument("--password", help="Single password to reuse when users-file is not provided")
    parser.add_argument("--virtual-users", type=int, default=50, help="Number of virtual users to run")
    parser.add_argument("--duration-sec", type=int, default=15 * 60, help="Test duration in seconds")
    parser.add_argument("--think-time-sec", type=float, default=2.0, help="Pause between scenario loops")
    parser.add_argument("--stagger-ms", type=int, default=150, help="Delay between virtual-user starts")
    parser.add_argument("--request-timeout-sec", type=float, default=20.0, help="Per-request timeout")
    parser.add_argument("--mailbox-id", default="", help="Optional mailbox_id to pin the scenario to one mailbox")
    parser.add_argument("--report-json", default="", help="Optional path to save JSON report")
    parser.add_argument("--progress-sec", type=int, default=30, help="Progress print interval")
    parser.add_argument("--rss-pid", type=int, default=0, help="Optional backend PID for RSS sampling")
    parser.add_argument("--rss-sample-sec", type=float, default=5.0, help="RSS sample interval when rss-pid is set")
    parser.add_argument("--insecure", action="store_true", help="Disable TLS verification for self-signed staging certs")
    return parser.parse_args()


def load_credentials(args: argparse.Namespace) -> list[Credential]:
    entries: list[Credential] = []
    if args.users_file:
        payload = json.loads(Path(args.users_file).read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise SystemExit("users-file must contain a JSON list")
        for item in payload:
            username = str((item or {}).get("username") or "").strip()
            password = str((item or {}).get("password") or "")
            if not username or not password:
                raise SystemExit("Each users-file entry must include non-empty username and password")
            entries.append(Credential(username=username, password=password))
    else:
        username = str(args.username or "").strip()
        password = str(args.password or "")
        if not username or not password:
            raise SystemExit("Provide either --users-file or both --username and --password")
        entries = [Credential(username=username, password=password)]

    if not entries:
        raise SystemExit("No credentials provided for load test")
    return entries


def build_ssl_context(insecure: bool) -> ssl.SSLContext | None:
    if not insecure:
        return None
    return ssl._create_unverified_context()


def percentile_ms(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(float(value) for value in values)
    if len(ordered) == 1:
        return ordered[0]
    rank = max(0.0, min(1.0, float(percentile) / 100.0)) * (len(ordered) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    if lower == upper:
        return ordered[lower]
    weight = rank - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * weight


def mean_ms(values: list[float]) -> float | None:
    if not values:
        return None
    return statistics.fmean(values)


def human_ms(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value:.1f} ms"


def build_url(api_base: str, path: str, params: dict[str, Any] | None = None) -> str:
    base = str(api_base or DEFAULT_API_BASE).rstrip("/")
    url = f"{base}{path}"
    if params:
        filtered = {
            key: value
            for key, value in params.items()
            if value is not None and str(value) != ""
        }
        if filtered:
            url = f"{url}?{urllib.parse.urlencode(filtered)}"
    return url


def request_json(
    opener: urllib.request.OpenerDirector,
    *,
    method: str,
    url: str,
    timeout_sec: float,
    payload: dict[str, Any] | None = None,
) -> tuple[Any, float]:
    body = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url=url, data=body, headers=headers, method=method.upper())
    started = time.perf_counter()
    with opener.open(request, timeout=timeout_sec) as response:
        raw = response.read()
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    if not raw:
        return None, elapsed_ms
    return json.loads(raw.decode("utf-8")), elapsed_ms


def build_opener(ssl_context: ssl.SSLContext | None = None) -> urllib.request.OpenerDirector:
    cookie_jar = CookieJar()
    handlers: list[Any] = [urllib.request.HTTPCookieProcessor(cookie_jar)]
    if ssl_context is not None:
        handlers.append(urllib.request.HTTPSHandler(context=ssl_context))
    return urllib.request.build_opener(*handlers)


def maybe_message_id(bootstrap_payload: dict[str, Any] | None, list_payload: dict[str, Any] | None) -> str:
    for payload in (bootstrap_payload, list_payload):
        items = (((payload or {}).get("messages") or {}).get("items")) if payload is bootstrap_payload else ((payload or {}).get("items"))
        if not isinstance(items, list):
            continue
        for item in items:
            message_id = str((item or {}).get("id") or "").strip()
            if message_id:
                return message_id
    return ""


def user_worker(
    worker_id: int,
    credential: Credential,
    args: argparse.Namespace,
    stats: RunStats,
    stop_at: float,
    ssl_context: ssl.SSLContext | None,
) -> None:
    opener = build_opener(ssl_context=ssl_context)
    mailbox_id = str(args.mailbox_id or "").strip()
    first_bootstrap = True
    first_list = True

    try:
        login_payload, login_ms = request_json(
            opener,
            method="POST",
            url=build_url(args.api_base, "/auth/login"),
            timeout_sec=args.request_timeout_sec,
            payload={
                "username": credential.username,
                "password": credential.password,
            },
        )
        stats.record_timing("login", login_ms)
        if str((login_payload or {}).get("status") or "authenticated") != "authenticated":
            stats.record_error(
                "login",
                f"user={credential.username} status={str((login_payload or {}).get('status') or '')}",
            )
            return
    except Exception as exc:
        stats.record_error("login", f"user={credential.username} error={exc}")
        return

    while time.monotonic() < stop_at:
        bootstrap_payload = None
        list_payload = None
        try:
            bootstrap_payload, bootstrap_ms = request_json(
                opener,
                method="GET",
                url=build_url(
                    args.api_base,
                    "/mail/bootstrap",
                    {
                        "limit": 20,
                        "mailbox_id": mailbox_id or None,
                    },
                ),
                timeout_sec=args.request_timeout_sec,
            )
            stats.record_timing("bootstrap_cold" if first_bootstrap else "bootstrap_warm", bootstrap_ms)
            first_bootstrap = False

            list_payload, list_ms = request_json(
                opener,
                method="GET",
                url=build_url(
                    args.api_base,
                    "/mail/messages",
                    {
                        "folder": "inbox",
                        "folder_scope": "current",
                        "limit": 50,
                        "offset": 0,
                        "mailbox_id": mailbox_id or None,
                    },
                ),
                timeout_sec=args.request_timeout_sec,
            )
            stats.record_timing("list_cold" if first_list else "list_warm", list_ms)
            first_list = False

            message_id = maybe_message_id(bootstrap_payload, list_payload)
            if message_id:
                _detail_payload, detail_ms = request_json(
                    opener,
                    method="GET",
                    url=build_url(
                        args.api_base,
                        f"/mail/messages/{urllib.parse.quote(message_id, safe='')}",
                        {
                            "mailbox_id": mailbox_id or None,
                        },
                    ),
                    timeout_sec=args.request_timeout_sec,
                )
                stats.record_timing("detail", detail_ms)

                _mark_read_payload, mark_read_ms = request_json(
                    opener,
                    method="POST",
                    url=build_url(
                        args.api_base,
                        f"/mail/messages/{urllib.parse.quote(message_id, safe='')}/read",
                        {
                            "mailbox_id": mailbox_id or None,
                        },
                    ),
                    timeout_sec=args.request_timeout_sec,
                )
                stats.record_timing("mark_read", mark_read_ms)

            stats.record_loop()
        except urllib.error.HTTPError as exc:
            message = exc.read().decode("utf-8", errors="ignore")
            stats.record_error("http", f"user={credential.username} status={exc.code} body={message[:240]}")
            time.sleep(min(args.think_time_sec, 1.0))
        except Exception as exc:
            stats.record_error("request", f"user={credential.username} error={exc}")
            time.sleep(min(args.think_time_sec, 1.0))

        if args.think_time_sec > 0:
            time.sleep(float(args.think_time_sec))


def rss_sampler(
    *,
    pid: int,
    stats: RunStats,
    stop_event: threading.Event,
    sample_sec: float,
) -> None:
    if pid <= 0:
        return
    try:
        import psutil  # type: ignore
    except Exception:
        return

    try:
        process = psutil.Process(pid)
    except Exception:
        return

    while not stop_event.wait(max(0.5, float(sample_sec or 5.0))):
        try:
            rss_bytes = float(process.memory_info().rss)
        except Exception:
            break
        stats.record_rss(rss_bytes / (1024.0 * 1024.0))


def build_report(stats: RunStats, args: argparse.Namespace) -> dict[str, Any]:
    finished_at = stats.finished_at or time.monotonic()
    elapsed_sec = max(0.0, finished_at - stats.started_at)
    request_count = int(stats.request_count)
    error_count = int(stats.error_count)
    error_rate = (float(error_count) / float(request_count)) if request_count else 0.0

    timing_summary = {}
    for name, values in stats.timings_ms.items():
        timing_summary[name] = {
            "count": len(values),
            "mean_ms": mean_ms(values),
            "p95_ms": percentile_ms(values, 95),
            "max_ms": max(values) if values else None,
        }

    rss_summary = {
        "samples": len(stats.rss_samples_mb),
        "min_mb": min(stats.rss_samples_mb) if stats.rss_samples_mb else None,
        "max_mb": max(stats.rss_samples_mb) if stats.rss_samples_mb else None,
        "growth_mb": (
            (stats.rss_samples_mb[-1] - stats.rss_samples_mb[0])
            if len(stats.rss_samples_mb) >= 2
            else None
        ),
    }

    slos = {
        "error_rate_lt_1pct": error_rate < 0.01,
        "bootstrap_p95_cold_le_4000ms": (timing_summary["bootstrap_cold"]["p95_ms"] or 10**9) <= 4000.0,
        "bootstrap_p95_warm_le_1500ms": (timing_summary["bootstrap_warm"]["p95_ms"] or 10**9) <= 1500.0,
        "list_p95_cold_le_2500ms": (timing_summary["list_cold"]["p95_ms"] or 10**9) <= 2500.0,
        "list_p95_warm_le_800ms": (timing_summary["list_warm"]["p95_ms"] or 10**9) <= 800.0,
        "rss_not_growing_continuously": (
            rss_summary["growth_mb"] is None or float(rss_summary["growth_mb"]) <= 128.0
        ),
    }

    return {
        "api_base": args.api_base,
        "virtual_users": int(args.virtual_users),
        "duration_sec": int(args.duration_sec),
        "think_time_sec": float(args.think_time_sec),
        "mailbox_id": str(args.mailbox_id or ""),
        "scenario_loops": int(stats.scenario_loops),
        "request_count": request_count,
        "error_count": error_count,
        "error_rate": error_rate,
        "timings": timing_summary,
        "rss": rss_summary,
        "slos": slos,
        "error_samples": list(stats.error_samples),
        "elapsed_sec": elapsed_sec,
    }


def print_report(report: dict[str, Any]) -> None:
    timings = report["timings"]
    print("")
    print("Mail load test summary")
    print(f"  api_base={report['api_base']}")
    print(f"  virtual_users={report['virtual_users']}")
    print(f"  duration_sec={report['duration_sec']}")
    print(f"  scenario_loops={report['scenario_loops']}")
    print(f"  request_count={report['request_count']}")
    print(f"  error_count={report['error_count']}")
    print(f"  error_rate={report['error_rate'] * 100.0:.2f}%")
    print("")
    print("Latency")
    for name in ("login", "bootstrap_cold", "bootstrap_warm", "list_cold", "list_warm", "detail", "mark_read"):
        entry = timings.get(name) or {}
        print(
            f"  {name}: count={entry.get('count', 0)}"
            f" mean={human_ms(entry.get('mean_ms'))}"
            f" p95={human_ms(entry.get('p95_ms'))}"
            f" max={human_ms(entry.get('max_ms'))}"
        )
    print("")
    rss = report["rss"]
    if int(rss.get("samples") or 0) > 0:
        print(
            "RSS"
            f" min={rss.get('min_mb', 0):.1f} MB"
            f" max={rss.get('max_mb', 0):.1f} MB"
            f" growth={rss.get('growth_mb', 0):.1f} MB"
        )
    else:
        print("RSS  not collected")
    print("")
    print("SLO")
    for key, value in report["slos"].items():
        print(f"  {key}={'PASS' if value else 'FAIL'}")
    if report["error_samples"]:
        print("")
        print("Error samples")
        for item in report["error_samples"]:
            print(f"  {item}")


def save_report(report: dict[str, Any], path: str) -> None:
    if not str(path or "").strip():
        return
    target = Path(path).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nSaved report to {target}")


def main() -> int:
    args = parse_args()
    credentials = load_credentials(args)
    ssl_context = build_ssl_context(bool(args.insecure))
    stats = RunStats()
    stop_event = threading.Event()
    stop_at = time.monotonic() + max(1, int(args.duration_sec))

    rss_thread = None
    if int(args.rss_pid or 0) > 0:
        rss_thread = threading.Thread(
            target=rss_sampler,
            kwargs={
                "pid": int(args.rss_pid),
                "stats": stats,
                "stop_event": stop_event,
                "sample_sec": float(args.rss_sample_sec),
            },
            daemon=True,
        )
        rss_thread.start()

    workers: list[threading.Thread] = []
    for index in range(int(args.virtual_users)):
        credential = credentials[index % len(credentials)]
        worker = threading.Thread(
            target=user_worker,
            kwargs={
                "worker_id": index,
                "credential": credential,
                "args": args,
                "stats": stats,
                "stop_at": stop_at,
                "ssl_context": ssl_context,
            },
            daemon=True,
        )
        workers.append(worker)
        worker.start()
        if args.stagger_ms > 0:
            time.sleep(float(args.stagger_ms) / 1000.0)

    progress_interval = max(5, int(args.progress_sec or 30))
    while any(worker.is_alive() for worker in workers):
        remaining = stop_at - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(progress_interval, max(1.0, remaining)))
        with stats.lock:
            print(
                f"progress elapsed={time.monotonic() - stats.started_at:.0f}s"
                f" loops={stats.scenario_loops}"
                f" requests={stats.request_count}"
                f" errors={stats.error_count}"
            )

    for worker in workers:
        worker.join(timeout=max(1.0, float(args.request_timeout_sec)))

    stop_event.set()
    if rss_thread is not None:
        rss_thread.join(timeout=2.0)

    stats.finished_at = time.monotonic()
    report = build_report(stats, args)
    print_report(report)
    save_report(report, args.report_json)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
