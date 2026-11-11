#!/usr/bin/env python3
"""Telegram Desktop UI Automation probe (Windows long-run).

Read-only observer: no clicks, no session export.
Optional: decrypt local Telegram media cache for photos/videos in the report.
Run: python main.py
Stop: Ctrl+C  → writes output/report.html
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path


def _configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read-only Telegram Desktop UI Automation probe (long-run)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent / "output",
        help="Directory for state/events/chats/report (default: ./output)",
    )
    parser.add_argument(
        "--poll",
        type=float,
        default=0.5,
        help="Foreground poll interval seconds (default: 0.5)",
    )
    parser.add_argument(
        "--inspect",
        type=float,
        default=1.5,
        help="HistoryInner inspect interval while Telegram is active (default: 1.5)",
    )
    parser.add_argument(
        "--snapshot",
        type=float,
        default=5.0,
        help="Legacy CLI compat (screenshots are event-driven in long-run)",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Debug logging")
    parser.add_argument(
        "--rebuild-report",
        action="store_true",
        help="Only rebuild output/report.html from state/chats/events and exit",
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Archive previous events/state/chats and start a clean long-run",
    )
    parser.add_argument(
        "--last-session-only",
        action="store_true",
        help="Legacy flag (ignored; report is chat-centric)",
    )
    parser.add_argument(
        "--no-media-cache",
        action="store_true",
        help="Do not read/decrypt Telegram Desktop media cache",
    )
    parser.add_argument(
        "--media-passcode",
        default="",
        help="Local Telegram passcode (if set). Or env TELEGRAM_LOCAL_PASSCODE",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    if sys.platform != "win32":
        print("Этот прототип предназначен только для Windows.", file=sys.stderr)
        return 2

    args = parse_args(argv)
    _configure_logging(args.verbose)

    output_dir = args.output.resolve()

    import os

    media_passcode = args.media_passcode or os.environ.get(
        "TELEGRAM_LOCAL_PASSCODE", ""
    )

    if args.rebuild_report:
        from telegram_probe.report import regenerate_from_output

        path = regenerate_from_output(
            output_dir,
            last_session_only=args.last_session_only,
            sanitize=True,
            attach_media=not args.no_media_cache,
            media_passcode=media_passcode,
        )
        print(f"Отчёт обновлён: {path}")
        print("Чужие/статусные сообщения из chats/*.jsonl вычищены (sanitize).")
        if not args.no_media_cache:
            print("Медиа из tdata/cache привязаны к сообщениям (если удалось).")
        print("Если порядок дат всё ещё странный — лучше: python main.py --fresh")
        return 0

    from telegram_probe.watcher import TelegramUiaWatcher

    # Default = long-run (keep state/chats). --fresh archives previous run.
    watcher = TelegramUiaWatcher(
        output_dir=output_dir,
        poll_interval=args.poll,
        inspect_interval=args.inspect,
        snapshot_interval=args.snapshot,
        fresh=args.fresh,
        media_cache=not args.no_media_cache,
        media_passcode=media_passcode,
    )
    try:
        watcher.run()
    except KeyboardInterrupt:
        watcher.request_stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
