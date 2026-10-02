#!/usr/bin/env python3
"""Preload default Telegram sticker packs into the Chat sticker cache.

Idempotent: packs whose files and preview cache are already in place are
skipped via the service's cached-pack path, so repeated runs only download
missing packs. Run on the release contour with TELEGRAM_BOT_TOKEN configured:

    python -m backend.scripts.seed_chat_sticker_packs --user-id 1
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = Path(__file__).resolve().parents[3]
for import_root in (WEB_ROOT, REPO_ROOT):
    if str(import_root) not in sys.path:
        sys.path.insert(0, str(import_root))

from backend.chat.telegram_sticker_service import (  # noqa: E402
    TelegramStickerConfigurationError,
    TelegramStickerImportError,
    default_sticker_pack_short_names,
    telegram_sticker_service,
)


async def _seed(*, user_id: int, short_names: list[str]) -> int:
    failures: list[str] = []
    for short_name in short_names:
        try:
            payload = await telegram_sticker_service.import_pack(
                current_user_id=user_id,
                source=short_name,
            )
            pack = next(
                (
                    item
                    for item in payload.get("items", [])
                    if str(item.get("short_name", "")).lower() == short_name.lower()
                ),
                None,
            )
            title = pack.get("title") if pack else short_name
            stickers = len(pack.get("stickers", [])) if pack else 0
            print(f"[ok] {short_name}: «{title}», {stickers} стикеров")
        except (TelegramStickerConfigurationError, TelegramStickerImportError) as exc:
            failures.append(short_name)
            print(f"[fail] {short_name}: {exc}", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001 — seed must not stop on one pack
            failures.append(short_name)
            print(f"[fail] {short_name}: {type(exc).__name__}: {exc}", file=sys.stderr)
    if failures:
        print(f"Не загружено наборов: {len(failures)} ({', '.join(failures)})", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--user-id",
        type=int,
        default=int(os.getenv("CHAT_SEED_USER_ID", "0") or 1),
        help="ID пользователя HUB-IT, от имени которого выполняется импорт (по умолчанию 1).",
    )
    parser.add_argument(
        "--pack",
        dest="packs",
        action="append",
        help="short_name набора; повторять для нескольких. Без флага — список по умолчанию.",
    )
    args = parser.parse_args()
    short_names = args.packs or list(default_sticker_pack_short_names())
    return asyncio.run(_seed(user_id=args.user_id, short_names=short_names))


if __name__ == "__main__":
    raise SystemExit(main())
