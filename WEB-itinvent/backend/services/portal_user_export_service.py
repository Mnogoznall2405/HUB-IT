"""Export ZUP employees to the Bitrix portal users.csv feed.

Reuses the address-book COM connector and its load pipelines so the portal
import keeps a single source of truth for employee fields.  Output format
matches ``local/php_interface/cron/import_users.php`` expectations:
UTF-8, ``;``-delimited, all fields quoted, CRLF, header row skipped by
``CCSVData('R', true)``.
"""
from __future__ import annotations

import csv
import io
import logging
import os
import subprocess
import tempfile
from datetime import datetime
from typing import Any

from backend.services.address_book_service import (
    address_book_service,
    execute_query,
    normalize_text,
    one_c_text,
)


logger = logging.getLogger(__name__)

PORTAL_CSV_HEADER = [
    "Табельный номер",
    "Фамилия",
    "Имя",
    "Отчество",
    "Дата рождения",
    "Должность",
    "Подразделение",
    "ID Подразделения",
    "Номер кабинета",
    "Город",
    "Рабочий телефон",
    "Корпоративный E-mail",
    "Адрес офиса",
    "Номер рабочего места",
    "ID рабочего места",
]

DEFAULT_REMOTE_PATH = "/var/www/bitrix/data/www/zsgp.corp/upload/import/users.csv"


def employee_names_query() -> str:
    """Раздельное ФИО + дата рождения по коду сотрудника (поля физлица)."""
    return """
ВЫБРАТЬ РАЗЛИЧНЫЕ
    Сотрудники.Код КАК EmployeeCode,
    Сотрудники.ФизическоеЛицо.Фамилия КАК LastName,
    Сотрудники.ФизическоеЛицо.Имя КАК FirstName,
    Сотрудники.ФизическоеЛицо.Отчество КАК MiddleName,
    Сотрудники.ФизическоеЛицо.ДатаРождения КАК BirthDate
ИЗ
    Справочник.Сотрудники КАК Сотрудники
ГДЕ
    НЕ Сотрудники.ВАрхиве
    И НЕ Сотрудники.ПометкаУдаления
"""


def _iso_to_ddmmyyyy(value: Any) -> str:
    text = normalize_text(value)[:10]
    if not text:
        return ""
    try:
        return datetime.strptime(text, "%Y-%m-%d").strftime("%d.%m.%Y")
    except ValueError:
        return ""


def _first_contact_value(items: Any) -> str:
    """First usable contact value from a contact list."""
    if not isinstance(items, list):
        return ""
    for item in items:
        if isinstance(item, dict):
            value = normalize_text(item.get("value") or item.get("normalized"))
            if value:
                return value
    return ""


def _split_full_name(full_name: str) -> tuple[str, str, str]:
    parts = normalize_text(full_name).split()
    last = parts[0] if len(parts) > 0 else ""
    first = parts[1] if len(parts) > 1 else ""
    middle = " ".join(parts[2:]) if len(parts) > 2 else ""
    return last, first, middle


class PortalUserExportService:
    def __init__(self, source_service: Any = None) -> None:
        self._source_service = source_service or address_book_service

    def fetch_rows(self) -> list[list[str]]:
        """Load employees from ZUP and return portal CSV rows (15 columns)."""
        employees, _dismissed, personal_by_code = self._source_service._load_items_from_1c()
        import pythoncom  # type: ignore

        pythoncom.CoInitialize()
        connection = None
        try:
            connection = self._source_service._connect_1c()
            names = self._load_split_names(connection)
        finally:
            connection = None
            pythoncom.CoUninitialize()

        rows: list[list[str]] = []
        seen_codes: set[str] = set()
        for employee in employees:
            code = normalize_text(employee.get("employee_code"))
            if not code or code in seen_codes:
                continue
            seen_codes.add(code)
            name_parts = names.get(code) or _split_full_name(employee.get("full_name", ""))
            personal = personal_by_code.get(code) or {}
            email = (
                _first_contact_value(employee.get("work_emails"))
                or _first_contact_value(employee.get("personal_emails"))
            )
            if not email.lower().endswith("@zsgp.ru"):
                continue
            rows.append(
                [
                    code,
                    name_parts[0],
                    name_parts[1],
                    name_parts[2],
                    _iso_to_ddmmyyyy(personal.get("date_of_birth")),
                    normalize_text(employee.get("position")),
                    normalize_text(employee.get("department")),
                    normalize_text(employee.get("department_code")),
                    normalize_text(employee.get("office_room")),
                    normalize_text(employee.get("department_location")),
                    _first_contact_value(employee.get("work_phones"))
                    or _first_contact_value(employee.get("personal_phones")),
                    email,
                    normalize_text(employee.get("office_address")),
                    normalize_text(employee.get("workplace_number")),
                    normalize_text(employee.get("workplace_id")),
                ]
            )
        rows.sort(key=lambda row: row[0])
        return rows

    def _load_split_names(self, connection: Any) -> dict[str, tuple[str, str, str]]:
        result: dict[str, tuple[str, str, str]] = {}
        try:
            selection = execute_query(connection, employee_names_query())
            while selection.Next():
                code = one_c_text(connection, selection.EmployeeCode)
                if not code:
                    continue
                result[code] = (
                    one_c_text(connection, selection.LastName),
                    one_c_text(connection, selection.FirstName),
                    one_c_text(connection, selection.MiddleName),
                )
        except Exception:
            logger.exception("Portal export: split-name load failed, will split full_name")
        return result

    @staticmethod
    def render_csv(rows: list[list[str]]) -> str:
        buffer = io.StringIO()
        writer = csv.writer(
            buffer,
            delimiter=";",
            quoting=csv.QUOTE_ALL,
            lineterminator="\r\n",
        )
        writer.writerow(PORTAL_CSV_HEADER)
        writer.writerows(rows)
        return buffer.getvalue()

    def export(self, out_path: str | None = None) -> dict[str, Any]:
        """Build users.csv locally; returns summary + output path."""
        rows = self.fetch_rows()
        csv_text = self.render_csv(rows)
        if not out_path:
            out_dir = os.path.join(tempfile.gettempdir(), "portal_export")
            os.makedirs(out_dir, exist_ok=True)
            out_path = os.path.join(out_dir, "users.csv")
        with open(out_path, "w", encoding="utf-8", newline="") as fh:
            fh.write(csv_text)
        return {
            "path": out_path,
            "rows": len(rows),
            "with_email": sum(1 for row in rows if row[11]),
            "exported_at": datetime.now().isoformat(timespec="seconds"),
        }

    @staticmethod
    def deliver(local_path: str) -> dict[str, Any]:
        """Atomic delivery to the portal: scp to a temp name + remote mv."""
        target = normalize_text(os.getenv("PORTAL_EXPORT_SSH_TARGET")) or "root@10.103.0.230"
        remote_path = normalize_text(os.getenv("PORTAL_EXPORT_REMOTE_PATH")) or DEFAULT_REMOTE_PATH
        remote_tmp = remote_path + ".part"
        subprocess.run(
            ["scp", "-q", local_path, f"{target}:{remote_tmp}"],
            check=True,
            timeout=300,
        )
        subprocess.run(
            ["ssh", target, f"mv {remote_tmp} {remote_path} && chown bitrix:bitrix {remote_path}"],
            check=True,
            timeout=60,
        )
        return {"delivered_to": f"{target}:{remote_path}"}


portal_user_export_service = PortalUserExportService()
