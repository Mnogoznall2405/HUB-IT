#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ежедневная выгрузка сотрудников из 1С ЗУП в CSV для портала zsgp.corp.

Читает действующих сотрудников через тот же COM-коннектор, что и адресная
книга (ADDRESS_BOOK_1C_*), формирует users.csv в формате
local/php_interface/cron/import_users.php и доставляет его на портал по scp
(атомарно: .part + mv). На портале cron запускает import_users.php — если
файла нет, импорт просто пропускается.

Использование:
    python scripts/export_portal_users.py              # выгрузить и отправить
    python scripts/export_portal_users.py --no-upload  # только сформировать файл
    python -m scripts.export_portal_users

Переменные окружения:
    PORTAL_EXPORT_SSH_TARGET   — ssh-команда доставки (default root@10.103.0.230)
    PORTAL_EXPORT_REMOTE_PATH  — путь users.csv на портале
"""

import argparse
import logging
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "WEB-itinvent"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(PROJECT_ROOT / ".env")

from backend.services.portal_user_export_service import portal_user_export_service  # noqa: E402


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("export_portal_users")


def main() -> int:
    parser = argparse.ArgumentParser(description="Export ZUP employees to portal users.csv")
    parser.add_argument("--no-upload", action="store_true", help="только сформировать CSV, не отправлять")
    parser.add_argument("--out", default="", help="путь локального файла (по умолчанию во временной папке)")
    args = parser.parse_args()

    summary = portal_user_export_service.export(out_path=args.out or None)
    logger.info(
        "Сформирован users.csv: %s строк, с email: %s → %s",
        summary["rows"], summary["with_email"], summary["path"],
    )

    if args.no_upload:
        return 0

    delivery = portal_user_export_service.deliver(summary["path"])
    logger.info("Доставлено: %s", delivery["delivered_to"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
