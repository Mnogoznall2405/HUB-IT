#!/usr/bin/env python3
"""Frozen entrypoint: ITInventBrowserProbe.exe (user-session Chromium History probe)."""

from __future__ import annotations

import argparse
import logging
import os
import sys
import threading
from logging.handlers import RotatingFileHandler
from pathlib import Path


BROWSER_LOG_MAX_BYTES = 8 * 1024 * 1024
BROWSER_LOG_BACKUP_COUNT = 2


def _bootstrap_paths() -> Path:
    if getattr(sys, "frozen", False):
        base = Path(sys.executable).resolve().parent
        for candidate in (str(base), str(base / "lib")):
            if candidate not in sys.path:
                sys.path.insert(0, candidate)
        return base
    base = Path(__file__).resolve().parent
    for candidate in (str(base),):
        if candidate not in sys.path:
            sys.path.insert(0, candidate)
    return base


def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    try:
        text = path.read_text(encoding="utf-8-sig")
    except Exception:
        return
    for line in text.splitlines():
        row = line.strip()
        if not row or row.startswith("#") or "=" not in row:
            continue
        key, value = row.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        os.environ[key] = value.strip()


def _default_output() -> Path:
    return Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "HUB-IT" / "BrowserProbe"


def _fallback_output() -> Path | None:
    local = str(os.environ.get("LOCALAPPDATA", "") or "").strip()
    if not local:
        return None
    return Path(local) / "HUB-IT" / "BrowserProbe"


def _dir_writable(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / f".wtest_{os.getpid()}"
        with probe.open("wb"):
            pass
        probe.unlink(missing_ok=True)
        return True
    except OSError:
        return False


def _resolve_output_dir(arg_output: Path | None) -> Path:
    """ProgramData is ACL-hardened for the install-time user (audit H-7); any
    other interactive user falls back to a per-user dir under %LOCALAPPDATA%."""
    if arg_output:
        return arg_output.resolve()
    primary = _default_output()
    if _dir_writable(primary):
        return primary
    fallback = _fallback_output()
    if fallback is not None and _dir_writable(fallback):
        return fallback
    return primary


def _configure_logging(verbose: bool, output_dir: Path) -> None:
    log_dir = output_dir / "Logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "browser_probe.log"
    level = logging.DEBUG if verbose else logging.INFO
    handlers: list[logging.Handler] = [
        RotatingFileHandler(
            log_path, maxBytes=BROWSER_LOG_MAX_BYTES, backupCount=BROWSER_LOG_BACKUP_COUNT, encoding="utf-8",
        )
    ]
    if not getattr(sys, "frozen", False):
        handlers.append(logging.StreamHandler(sys.stdout))
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        handlers=handlers,
        force=True,
    )


def _env_truthy(name: str, default: bool = True) -> bool:
    raw = str(os.getenv(name, "1" if default else "0") or "").strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return default


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="HUB-IT Browser activity probe (MSI)")
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--sync-now", action="store_true", help="Flush pending upload and exit")
    return parser.parse_args(argv)


def _resolve_server_url() -> str:
    explicit = str(os.getenv("ITINV_BROWSER_PROBE_SERVER_URL", "") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    return str(os.getenv("ITINV_AGENT_SERVER_URL", "") or "").strip().rstrip("/")


def main(argv: list[str] | None = None) -> int:
    _bootstrap_paths()
    if sys.platform != "win32":
        print("Browser probe is Windows-only", file=sys.stderr)
        return 2

    env_path = Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "HUB-IT" / "Agent" / ".env"
    _load_env_file(env_path)

    args = parse_args(argv)
    logger = logging.getLogger("browser_probe_agent")

    output_dir = _resolve_output_dir(args.output)
    # The scheduled task and --sync-now can be started independently.
    import msvcrt

    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        lock_handle = (output_dir / "probe.lock").open("a+b")
    except OSError as exc:
        print(f"Browser probe cannot use output dir {output_dir}: {exc}", file=sys.stderr)
        return 1
    with lock_handle as lock:
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            print("Browser probe cannot lock the queue. Check for another instance using this folder.", file=sys.stderr)
            return 1
        try:
            _configure_logging(args.verbose, output_dir)
        except OSError as exc:
            print(f"Browser probe cannot set up logging in {output_dir}: {exc}", file=sys.stderr)
            return 1
        if not _env_truthy("ITINV_BROWSER_PROBE_ENABLED", True):
            logger.info("Browser probe disabled by ITINV_BROWSER_PROBE_ENABLED")
            return 0
        return _run_probe(args, output_dir, logger)


def _run_probe(args: argparse.Namespace, output_dir: Path, logger: logging.Logger) -> int:
    sync_sec = int(os.getenv("ITINV_BROWSER_PROBE_SYNC_SEC", "120") or 120)
    server_url = _resolve_server_url()
    api_key = str(os.getenv("ITINV_AGENT_API_KEY", "") or os.getenv("SCAN_AGENT_API_KEY", "") or "").strip()

    from browser_probe.sync import BrowserProbeSync
    from browser_probe.watcher import BrowserProbeWatcher

    syncer = BrowserProbeSync(
        output_dir,
        server_url=server_url,
        api_key=api_key,
        sync_interval_sec=sync_sec,
    )

    if args.sync_now:
        try:
            syncer.sync_once()
        except Exception as exc:
            logger.error("Browser probe sync failed: %s", exc)
            return 1
        return 0

    watcher = BrowserProbeWatcher(output_dir=output_dir, syncer=syncer)
    stop = threading.Event()

    def _sync_loop() -> None:
        while not stop.is_set():
            syncer.maybe_sync(force=False)
            stop.wait(5.0)

    thread = threading.Thread(target=_sync_loop, name="browser-probe-sync", daemon=True)
    thread.start()
    logger.info("Browser probe started output=%s sync_sec=%s", output_dir, sync_sec)
    try:
        watcher.run()
    except KeyboardInterrupt:
        watcher.request_stop()
    finally:
        stop.set()
        thread.join()
        try:
            syncer.maybe_sync(force=True)
        except Exception as exc:
            logger.warning("Final sync failed: %s", exc)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
