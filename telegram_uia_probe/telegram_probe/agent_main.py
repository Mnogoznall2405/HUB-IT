"""Shared MSI entry logic for Telegram / MAX desktop UIA probes."""

from __future__ import annotations

import argparse
import logging
import os
import sys
import threading
from pathlib import Path

from .profile import get_profile


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


def _env_truthy(name: str, default: bool = True) -> bool:
    raw = str(os.getenv(name, "1" if default else "0") or "").strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return default


def _enabled_env_name(profile_key: str) -> str:
    if profile_key == "max":
        return "ITINV_MAX_PROBE_ENABLED"
    return "ITINV_TELEGRAM_PROBE_ENABLED"


def _sync_env_name(profile_key: str) -> str:
    if profile_key == "max":
        return "ITINV_MAX_PROBE_SYNC_SEC"
    return "ITINV_TELEGRAM_PROBE_SYNC_SEC"


def _server_url_env_name(profile_key: str) -> str:
    if profile_key == "max":
        return "ITINV_MAX_PROBE_SERVER_URL"
    return "ITINV_TELEGRAM_PROBE_SERVER_URL"


def _default_output(profile) -> Path:
    return Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "HUB-IT" / profile.runtime_dirname


def _configure_logging(verbose: bool, profile) -> None:
    log_dir = _default_output(profile) / "Logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / profile.log_filename
    level = logging.DEBUG if verbose else logging.INFO
    handlers: list[logging.Handler] = [logging.FileHandler(log_path, encoding="utf-8")]
    if not getattr(sys, "frozen", False):
        handlers.append(logging.StreamHandler(sys.stdout))
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        handlers=handlers,
        force=True,
    )


def parse_args(
    argv: list[str] | None = None,
    *,
    default_profile: str = "telegram",
) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="HUB-IT desktop messenger UIA probe (MSI)")
    parser.add_argument(
        "--profile",
        default=os.getenv("ITINV_MESSENGER_PROBE_PROFILE", default_profile) or default_profile,
        help="Messenger profile: telegram | max",
    )
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--poll", type=float, default=None)
    parser.add_argument("--inspect", type=float, default=None)
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--rebuild-report", action="store_true")
    parser.add_argument("--fresh", action="store_true")
    parser.add_argument("--no-media-cache", action="store_true")
    parser.add_argument("--media-passcode", default="")
    parser.add_argument("--sync-now", action="store_true", help="Run one sync upload and exit")
    return parser.parse_args(argv)


def _resolve_server_url(profile_key: str) -> str:
    explicit = str(os.getenv(_server_url_env_name(profile_key), "") or "").strip()
    if explicit:
        return explicit.rstrip("/")
    return str(os.getenv("ITINV_AGENT_SERVER_URL", "") or "").strip().rstrip("/")


def run_probe(
    argv: list[str] | None = None,
    *,
    default_profile: str = "telegram",
) -> int:
    if sys.platform != "win32":
        print("Messenger probe is Windows-only", file=sys.stderr)
        return 2

    env_path = Path(os.environ.get("ProgramData", r"C:\ProgramData")) / "HUB-IT" / "Agent" / ".env"
    _load_env_file(env_path)

    args = parse_args(argv, default_profile=default_profile)
    try:
        profile = get_profile(args.profile)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    _configure_logging(args.verbose, profile)
    logger = logging.getLogger(f"{profile.key}_probe_agent")

    if not _env_truthy(_enabled_env_name(profile.key), True):
        logger.info("%s probe disabled by %s", profile.display_name, _enabled_env_name(profile.key))
        return 0

    poll = args.poll
    if poll is None:
        poll = float(os.getenv("ITINV_TELEGRAM_PROBE_POLL_SEC", "0.5") or 0.5)
    inspect = args.inspect
    if inspect is None:
        inspect = float(os.getenv("ITINV_TELEGRAM_PROBE_INSPECT_SEC", "1.5") or 1.5)

    output_dir = (args.output or _default_output(profile)).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    media_passcode = args.media_passcode or os.environ.get("TELEGRAM_LOCAL_PASSCODE", "")
    sync_sec = int(os.getenv(_sync_env_name(profile.key), "900") or 900)
    server_url = _resolve_server_url(profile.key)
    api_key = str(os.getenv("ITINV_AGENT_API_KEY", "") or os.getenv("SCAN_AGENT_API_KEY", "") or "").strip()

    from .sync import TelegramProbeSync

    syncer = TelegramProbeSync(
        output_dir,
        server_url=server_url,
        api_key=api_key,
        sync_interval_sec=sync_sec,
        media_passcode=media_passcode,
        attach_media=not args.no_media_cache,
        profile=profile,
    )

    if args.rebuild_report or args.sync_now:
        from .report import regenerate_from_output

        regenerate_from_output(
            output_dir,
            sanitize=True,
            attach_media=not args.no_media_cache and profile.media_cache_default,
            media_passcode=media_passcode,
        )
        if args.sync_now:
            syncer.sync_once()
        return 0

    from .watcher import TelegramUiaWatcher

    watcher = TelegramUiaWatcher(
        output_dir=output_dir,
        poll_interval=poll,
        inspect_interval=inspect,
        fresh=args.fresh,
        media_cache=not args.no_media_cache,
        media_passcode=media_passcode,
        profile=profile,
    )

    stop = threading.Event()

    def _sync_loop() -> None:
        while not stop.wait(5.0):
            syncer.maybe_sync(force=False)

    thread = threading.Thread(
        target=_sync_loop,
        name=f"{profile.key}-probe-sync",
        daemon=True,
    )
    thread.start()
    logger.info(
        "%s probe started output=%s sync_sec=%s",
        profile.display_name,
        output_dir,
        sync_sec,
    )
    try:
        watcher.run()
    except KeyboardInterrupt:
        watcher.request_stop()
    finally:
        stop.set()
        try:
            syncer.maybe_sync(force=True)
        except Exception as exc:
            logger.warning("Final sync failed: %s", exc)
    return 0
