# -*- coding: utf-8 -*-
from __future__ import annotations

import asyncio
import logging
import os
import re
import threading
from datetime import datetime, timezone
from typing import Any

from backend.json_db.manager import JSONDataManager


logger = logging.getLogger(__name__)

DEFAULT_1C_SERVER = "tmn-srv-1c-01.zsgp.corp,tmn-srv-1c-02.zsgp.corp"
DEFAULT_1C_REF = "zar31"
DEFAULT_SYNC_INTERVAL_SECONDS = 14_400
CACHE_FILE = "address_book_cache.json"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_search_text(value: Any) -> str:
    return re.sub(r"\s+", " ", normalize_text(value)).casefold()


def normalize_phone(value: str) -> str:
    number = re.sub(r"\D+", "", normalize_text(value))
    if len(number) == 11 and number.startswith("8"):
        return "7" + number[1:]
    if len(number) == 10:
        return "7" + number
    return number


def normalize_email(value: str) -> str:
    return normalize_text(value).lower()


def split_phone_values(phone: str, phone_no_codes: str = "") -> list[str]:
    value = normalize_text(phone) or normalize_text(phone_no_codes)
    if not value:
        return []
    values = [part.strip() for part in re.split(r"[,;\n/]+", value) if part.strip()]
    return values or [value]


def split_email_values(email: str) -> list[str]:
    value = normalize_text(email)
    if not value:
        return []
    values = [part.strip() for part in re.split(r"[,;\n/]+", value) if part.strip()]
    return values or [value]


def classify_phone(contact_kind: str) -> str | None:
    kind = normalize_search_text(contact_kind)
    if "рабоч" in kind or "служеб" in kind:
        return "work"
    if "лич" in kind or "моб" in kind or "дом" in kind:
        return "personal"
    return None


def phone_kind_priority(contact_kind: str, phone_type: str) -> int:
    kind = normalize_search_text(contact_kind)
    if phone_type == "work":
        if "рабоч" in kind:
            return 100
        if "служеб" in kind:
            return 90
        return 80
    if "моб" in kind:
        return 70
    if "лич" in kind:
        return 60
    if "дом" in kind:
        return 50
    return 10


def should_replace_phone(existing: dict[str, Any], candidate: dict[str, Any]) -> bool:
    if existing.get("type") != "work" and candidate.get("type") == "work":
        return True
    if existing.get("type") == candidate.get("type"):
        return int(candidate.get("priority") or 0) > int(existing.get("priority") or 0)
    return False


def classify_email(contact_kind: str) -> str:
    kind = normalize_search_text(contact_kind)
    if "корпоратив" in kind or "рабоч" in kind or "служеб" in kind:
        return "work"
    return "personal"


def email_kind_priority(contact_kind: str, email_type: str) -> int:
    kind = normalize_search_text(contact_kind)
    if email_type == "work":
        if "корпоратив" in kind:
            return 100
        if "рабоч" in kind:
            return 90
        if "служеб" in kind:
            return 80
        return 70
    if "email" in kind:
        return 60
    return 10


def should_replace_email(existing: dict[str, Any], candidate: dict[str, Any]) -> bool:
    if existing.get("type") != "work" and candidate.get("type") == "work":
        return True
    if existing.get("type") == candidate.get("type"):
        return int(candidate.get("priority") or 0) > int(existing.get("priority") or 0)
    return False


def is_valid_email(value: str) -> bool:
    normalized = normalize_email(value)
    if not normalized or "@" not in normalized:
        return False
    local, _, domain = normalized.partition("@")
    return bool(local and domain and "." in domain)


def deduplicate_email_records(records: list[dict[str, str]]) -> dict[str, dict[str, list[dict[str, str]]]]:
    emails_by_employee: dict[str, dict[str, dict[str, Any]]] = {}
    for record in records:
        employee_code = normalize_text(record.get("employee_code"))
        contact_kind = normalize_text(record.get("contact_kind"))
        email_type = classify_email(contact_kind)
        if not employee_code:
            continue
        emails_by_employee.setdefault(employee_code, {})
        for value in split_email_values(record.get("email", "")):
            if not is_valid_email(value):
                continue
            normalized = normalize_email(value)
            candidate = {
                "type": email_type,
                "priority": email_kind_priority(contact_kind, email_type),
                "kind": contact_kind,
                "value": value,
                "normalized": normalized,
            }
            existing = emails_by_employee[employee_code].get(normalized)
            if existing is None or should_replace_email(existing, candidate):
                emails_by_employee[employee_code][normalized] = candidate

    result: dict[str, dict[str, list[dict[str, str]]]] = {}
    for employee_code, employee_emails in emails_by_employee.items():
        result[employee_code] = {"work": [], "personal": []}
        for normalized in sorted(employee_emails):
            email = employee_emails[normalized]
            email_type = str(email["type"])
            result[employee_code][email_type].append(
                {
                    "kind": normalize_text(email.get("kind")),
                    "value": normalize_text(email.get("value")),
                    "normalized": normalize_text(email.get("normalized")),
                }
            )
    return result


def deduplicate_phone_records(records: list[dict[str, str]]) -> dict[str, dict[str, list[dict[str, str]]]]:
    phones_by_employee: dict[str, dict[str, dict[str, Any]]] = {}
    for record in records:
        employee_code = normalize_text(record.get("employee_code"))
        contact_kind = normalize_text(record.get("contact_kind"))
        phone_type = classify_phone(contact_kind)
        if not employee_code or not phone_type:
            continue
        phones_by_employee.setdefault(employee_code, {})
        for value in split_phone_values(record.get("phone", ""), record.get("phone_no_codes", "")):
            normalized = normalize_phone(value)
            if not normalized:
                continue
            candidate = {
                "type": phone_type,
                "priority": phone_kind_priority(contact_kind, phone_type),
                "kind": contact_kind,
                "value": value,
                "normalized": normalized,
            }
            existing = phones_by_employee[employee_code].get(normalized)
            if existing is None or should_replace_phone(existing, candidate):
                phones_by_employee[employee_code][normalized] = candidate

    result: dict[str, dict[str, list[dict[str, str]]]] = {}
    for employee_code, employee_phones in phones_by_employee.items():
        result[employee_code] = {"work": [], "personal": []}
        for normalized in sorted(employee_phones):
            phone = employee_phones[normalized]
            phone_type = str(phone["type"])
            result[employee_code][phone_type].append(
                {
                    "kind": normalize_text(phone.get("kind")),
                    "value": normalize_text(phone.get("value")),
                    "normalized": normalize_text(phone.get("normalized")),
                }
            )
    return result


def quote_1c(value: str) -> str:
    return value.replace('"', '""')


def build_connection_string(server: str, ref: str, user: str, password: str) -> str:
    return (
        f'Srvr="{quote_1c(server)}";'
        f'Ref="{quote_1c(ref)}";'
        f'Usr="{quote_1c(user)}";'
        f'Pwd="{quote_1c(password)}";'
    )


def one_c_text(connection: Any, value: Any) -> str:
    if value is None:
        return ""
    text = connection.String(value)
    return normalize_text(text)


def execute_query(connection: Any, text: str):
    query = connection.NewObject("Query")
    query.Text = text
    return query.Execute().Select()


def employee_query() -> str:
    return """
ВЫБРАТЬ РАЗЛИЧНЫЕ
    Текущие.Сотрудник КАК FullName,
    Текущие.Сотрудник.Код КАК EmployeeCode,
    ЕСТЬNULL(
        История.Подразделение,
        ЕСТЬNULL(
            Прием.Подразделение,
            ЕСТЬNULL(ПриемСписком.Подразделение, Текущие.ТекущееПодразделение)
        )
    ) КАК Department,
    ПодразделенияДополнительныеРеквизиты.Значение КАК DepartmentLocation,
    ЕСТЬNULL(
        История.Должность,
        ЕСТЬNULL(
            Прием.Должность,
            ЕСТЬNULL(ПриемСписком.Должность, Текущие.ТекущаяДолжность)
        )
    ) КАК Position
ИЗ
    РегистрСведений.ТекущиеКадровыеДанныеСотрудников КАК Текущие

        ЛЕВОЕ СОЕДИНЕНИЕ РегистрСведений.КадроваяИсторияСотрудников.СрезПоследних КАК История
        ПО История.Сотрудник = Текущие.Сотрудник

        ЛЕВОЕ СОЕДИНЕНИЕ (
            ВЫБРАТЬ
                ПриемПоследние.Сотрудник КАК Сотрудник,
                МАКСИМУМ(ПриемПоследние.Дата) КАК Дата
            ИЗ
                Документ.ПриемНаРаботу КАК ПриемПоследние
            ГДЕ
                НЕ ПриемПоследние.ПометкаУдаления
            СГРУППИРОВАТЬ ПО
                ПриемПоследние.Сотрудник
        ) КАК ПоследнийПрием
        ПО ПоследнийПрием.Сотрудник = Текущие.Сотрудник

        ЛЕВОЕ СОЕДИНЕНИЕ Документ.ПриемНаРаботу КАК Прием
        ПО Прием.Сотрудник = ПоследнийПрием.Сотрудник
            И Прием.Дата = ПоследнийПрием.Дата
            И НЕ Прием.ПометкаУдаления

        ЛЕВОЕ СОЕДИНЕНИЕ (
            ВЫБРАТЬ
                ПриемСпискомПоследние.Сотрудник КАК Сотрудник,
                МАКСИМУМ(ПриемСпискомПоследние.Ссылка.Дата) КАК Дата
            ИЗ
                Документ.ПриемНаРаботуСписком.Сотрудники КАК ПриемСпискомПоследние
            ГДЕ
                НЕ ПриемСпискомПоследние.Ссылка.ПометкаУдаления
            СГРУППИРОВАТЬ ПО
                ПриемСпискомПоследние.Сотрудник
        ) КАК ПоследнийПриемСписком
        ПО ПоследнийПриемСписком.Сотрудник = Текущие.Сотрудник

        ЛЕВОЕ СОЕДИНЕНИЕ Документ.ПриемНаРаботуСписком.Сотрудники КАК ПриемСписком
        ПО ПриемСписком.Сотрудник = ПоследнийПриемСписком.Сотрудник
            И ПриемСписком.Ссылка.Дата = ПоследнийПриемСписком.Дата
            И НЕ ПриемСписком.Ссылка.ПометкаУдаления

        ЛЕВОЕ СОЕДИНЕНИЕ Справочник.ПодразделенияОрганизаций.ДополнительныеРеквизиты КАК ПодразделенияДополнительныеРеквизиты
        ПО ПодразделенияДополнительныеРеквизиты.Ссылка = ЕСТЬNULL(
                История.Подразделение,
                ЕСТЬNULL(
                    Прием.Подразделение,
                    ЕСТЬNULL(ПриемСписком.Подразделение, Текущие.ТекущееПодразделение)
                )
            )
            И ПодразделенияДополнительныеРеквизиты.Свойство.Наименование = "Местонахождение (Подразделения)"
ГДЕ
    Текущие.ДатаУвольнения = ДАТАВРЕМЯ(1, 1, 1)
    И Текущие.ДатаПриема <> ДАТАВРЕМЯ(1, 1, 1)
    И Текущие.Сотрудник <> ЗНАЧЕНИЕ(Справочник.Сотрудники.ПустаяСсылка)
УПОРЯДОЧИТЬ ПО
    FullName
"""


def phones_query() -> str:
    return """
ВЫБРАТЬ РАЗЛИЧНЫЕ
    Текущие.Сотрудник.Код КАК EmployeeCode,
    Контакты.Вид КАК ContactKind,
    Контакты.Представление КАК Phone,
    Контакты.НомерТелефонаБезКодов КАК PhoneNoCodes
ИЗ
    РегистрСведений.ТекущиеКадровыеДанныеСотрудников КАК Текущие

        ВНУТРЕННЕЕ СОЕДИНЕНИЕ Справочник.ФизическиеЛица.КонтактнаяИнформация КАК Контакты
        ПО Контакты.Ссылка = Текущие.ФизическоеЛицо
ГДЕ
    Текущие.ДатаУвольнения = ДАТАВРЕМЯ(1, 1, 1)
    И Текущие.ДатаПриема <> ДАТАВРЕМЯ(1, 1, 1)
    И Текущие.Сотрудник <> ЗНАЧЕНИЕ(Справочник.Сотрудники.ПустаяСсылка)
    И (
        Контакты.Вид.Наименование ПОДОБНО "%телефон%"
        ИЛИ Контакты.Вид.Наименование ПОДОБНО "%Телефон%"
    )
"""


def emails_query() -> str:
    return """
ВЫБРАТЬ РАЗЛИЧНЫЕ
    Текущие.Сотрудник.Код КАК EmployeeCode,
    Контакты.Вид КАК ContactKind,
    Контакты.Представление КАК Email
ИЗ
    РегистрСведений.ТекущиеКадровыеДанныеСотрудников КАК Текущие

        ВНУТРЕННЕЕ СОЕДИНЕНИЕ Справочник.ФизическиеЛица.КонтактнаяИнформация КАК Контакты
        ПО Контакты.Ссылка = Текущие.ФизическоеЛицо
ГДЕ
    Текущие.ДатаУвольнения = ДАТАВРЕМЯ(1, 1, 1)
    И Текущие.ДатаПриема <> ДАТАВРЕМЯ(1, 1, 1)
    И Текущие.Сотрудник <> ЗНАЧЕНИЕ(Справочник.Сотрудники.ПустаяСсылка)
    И (
        Контакты.Вид.Наименование = "Email"
        ИЛИ Контакты.Вид.Наименование = "Корпоративный E-mail"
    )
"""


def empty_cache() -> dict[str, Any]:
    return {
        "items": [],
        "updated_at": "",
        "last_attempt_at": "",
        "last_error": "",
    }


def env_positive_int(name: str, default: int, minimum: int) -> int:
    try:
        return max(int(os.getenv(name, str(default)) or default), minimum)
    except Exception:
        return max(int(default), minimum)


class AddressBookService:
    def __init__(self, data_manager: JSONDataManager | None = None) -> None:
        self.data_manager = data_manager or JSONDataManager()
        self._sync_lock = threading.Lock()

    def load_cache(self) -> dict[str, Any]:
        payload = self.data_manager.load_json(CACHE_FILE, default_content=empty_cache())
        if not isinstance(payload, dict):
            return empty_cache()
        result = empty_cache()
        result.update(payload)
        if not isinstance(result.get("items"), list):
            result["items"] = []
        return result

    def save_cache(self, payload: dict[str, Any]) -> None:
        self.data_manager.save_json(CACHE_FILE, payload)

    def get_status(self) -> dict[str, Any]:
        cache = self.load_cache()
        return {
            "count": len(cache.get("items") or []),
            "updated_at": normalize_text(cache.get("updated_at")),
            "last_attempt_at": normalize_text(cache.get("last_attempt_at")),
            "last_error": normalize_text(cache.get("last_error")),
            "sync_in_progress": self._sync_lock.locked(),
        }

    def search(self, query: str = "", limit: int = 50) -> dict[str, Any]:
        cache = self.load_cache()
        items = [item for item in cache.get("items") or [] if isinstance(item, dict)]
        tokens = normalize_search_text(query).split()
        limited = max(1, min(int(limit or 50), 200))

        if tokens:
            items = [item for item in items if self._matches_query(item, tokens)]
            items.sort(key=lambda item: (-self._query_score(item, tokens), normalize_search_text(item.get("full_name"))))
        else:
            items.sort(key=lambda item: normalize_search_text(item.get("full_name")))

        return {
            "items": items[:limited],
            "total": len(items),
            "limit": limited,
            "updated_at": normalize_text(cache.get("updated_at")),
            "last_error": normalize_text(cache.get("last_error")),
        }

    def _matches_query(self, item: dict[str, Any], tokens: list[str]) -> bool:
        phones = list(item.get("work_phones") or []) + list(item.get("personal_phones") or [])
        emails = list(item.get("work_emails") or []) + list(item.get("personal_emails") or [])
        text = normalize_search_text(
            " ".join(
                [
                    normalize_text(item.get("full_name")),
                    normalize_text(item.get("department")),
                    normalize_text(item.get("department_location")),
                    normalize_text(item.get("position")),
                    " ".join(normalize_text(phone.get("value")) for phone in phones if isinstance(phone, dict)),
                    " ".join(normalize_text(phone.get("kind")) for phone in phones if isinstance(phone, dict)),
                    " ".join(normalize_text(email.get("value")) for email in emails if isinstance(email, dict)),
                    " ".join(normalize_text(email.get("kind")) for email in emails if isinstance(email, dict)),
                ]
            )
        )
        phone_digits = " ".join(
            normalize_phone(phone.get("value", ""))
            for phone in phones
            if isinstance(phone, dict)
        )
        email_addresses = " ".join(
            normalize_email(email.get("value", ""))
            for email in emails
            if isinstance(email, dict)
        )
        for token in tokens:
            token_phone = normalize_phone(token)
            token_email = normalize_email(token)
            if token in text:
                continue
            if token_phone and token_phone in phone_digits:
                continue
            if token_email and token_email in email_addresses:
                continue
            return False
        return True

    def _field_match_score(self, value: Any, tokens: list[str], contains_score: int, prefix_score: int | None = None) -> int:
        text = normalize_search_text(value)
        if not text:
            return 0
        score = 0
        for token in tokens:
            if token not in text:
                continue
            if prefix_score is not None and text.startswith(token):
                score += prefix_score
            else:
                score += contains_score
        return score

    def _phone_match_score(self, phones: list[dict[str, Any]], tokens: list[str]) -> int:
        score = 0
        phone_digits = " ".join(
            normalize_phone(phone.get("value", ""))
            for phone in phones
            if isinstance(phone, dict)
        )
        phone_text = normalize_search_text(
            " ".join(
                [
                    normalize_text(phone.get("value"))
                    for phone in phones
                    if isinstance(phone, dict)
                ]
            )
        )
        for token in tokens:
            token_phone = normalize_phone(token)
            if token_phone and token_phone in phone_digits:
                score += 35
                continue
            if token in phone_text:
                score += 20
        return score

    def _email_match_score(self, emails: list[dict[str, Any]], tokens: list[str]) -> int:
        score = 0
        email_addresses = " ".join(
            normalize_email(email.get("value", ""))
            for email in emails
            if isinstance(email, dict)
        )
        email_text = normalize_search_text(
            " ".join(
                [
                    normalize_text(email.get("value"))
                    for email in emails
                    if isinstance(email, dict)
                ]
            )
        )
        for token in tokens:
            token_email = normalize_email(token)
            if token_email and token_email in email_addresses:
                score += 40
                continue
            if token in email_text:
                score += 25
        return score

    def _query_score(self, item: dict[str, Any], tokens: list[str]) -> int:
        phones = list(item.get("work_phones") or []) + list(item.get("personal_phones") or [])
        emails = list(item.get("work_emails") or []) + list(item.get("personal_emails") or [])
        return (
            self._field_match_score(item.get("full_name"), tokens, contains_score=120, prefix_score=160)
            + self._field_match_score(item.get("position"), tokens, contains_score=45)
            + self._field_match_score(item.get("department"), tokens, contains_score=35)
            + self._field_match_score(item.get("department_location"), tokens, contains_score=30)
            + self._phone_match_score(phones, tokens)
            + self._email_match_score(emails, tokens)
        )

    def sync_from_1c(self) -> dict[str, Any]:
        if not self._sync_lock.acquire(blocking=False):
            status = self.get_status()
            status["sync_in_progress"] = True
            return status

        cache = self.load_cache()
        cache["last_attempt_at"] = utc_now_iso()
        try:
            items = self._load_items_from_1c()
            next_cache = {
                "items": items,
                "updated_at": utc_now_iso(),
                "last_attempt_at": cache["last_attempt_at"],
                "last_error": "",
            }
            self.save_cache(next_cache)
            return {
                "count": len(items),
                "updated_at": next_cache["updated_at"],
                "last_attempt_at": next_cache["last_attempt_at"],
                "last_error": "",
                "sync_in_progress": False,
            }
        except Exception as exc:
            logger.exception("Address book sync failed")
            cache["last_error"] = str(exc)
            self.save_cache(cache)
            raise
        finally:
            self._sync_lock.release()

    def _load_items_from_1c(self) -> list[dict[str, Any]]:
        pythoncom = None
        connection = None
        com_initialized = False
        try:
            import pythoncom as pythoncom_module  # type: ignore

            pythoncom = pythoncom_module
            pythoncom.CoInitialize()
            com_initialized = True

            connection = self._connect_1c()
            employees = self._load_employees(connection)
            phones = self._load_phones(connection)
            emails = self._load_emails(connection)
            for employee in employees:
                employee_code = employee.pop("_employee_code", "")
                # Keep the stable ZUP key in the cache.  It is deliberately
                # not exposed as a replacement for the display name, but it
                # lets HUB persist verified employee/owner mappings instead
                # of reconstructing identity from FIO every time.
                employee["employee_code"] = employee_code
                employee_phones = phones.get(employee_code, {"work": [], "personal": []})
                employee_emails = emails.get(employee_code, {"work": [], "personal": []})
                employee["work_phones"] = employee_phones.get("work", [])
                employee["personal_phones"] = employee_phones.get("personal", [])
                employee["work_emails"] = employee_emails.get("work", [])
                employee["personal_emails"] = employee_emails.get("personal", [])
            employees.sort(key=lambda item: normalize_search_text(item.get("full_name")))
            return employees
        finally:
            connection = None
            if com_initialized and pythoncom is not None:
                pythoncom.CoUninitialize()

    def _connect_1c(self) -> Any:
        import win32com.client  # type: ignore

        server = normalize_text(os.getenv("ADDRESS_BOOK_1C_SERVER")) or DEFAULT_1C_SERVER
        ref = normalize_text(os.getenv("ADDRESS_BOOK_1C_REF")) or DEFAULT_1C_REF
        user = normalize_text(os.getenv("ADDRESS_BOOK_1C_USER"))
        password = normalize_text(os.getenv("ADDRESS_BOOK_1C_PASSWORD"))
        if not user or not password:
            raise RuntimeError("ADDRESS_BOOK_1C_USER and ADDRESS_BOOK_1C_PASSWORD must be set")

        connector = win32com.client.Dispatch("V83.COMConnector")
        return connector.Connect(build_connection_string(server, ref, user, password))

    def _load_employees(self, connection: Any) -> list[dict[str, Any]]:
        selection = execute_query(connection, employee_query())
        rows: list[dict[str, Any]] = []
        while selection.Next():
            rows.append(
                {
                    "full_name": one_c_text(connection, selection.FullName),
                    "_employee_code": one_c_text(connection, selection.EmployeeCode),
                    "department": one_c_text(connection, selection.Department),
                    "department_location": one_c_text(connection, selection.DepartmentLocation),
                    "position": one_c_text(connection, selection.Position),
                }
            )
        return rows

    def _load_phones(self, connection: Any) -> dict[str, dict[str, list[dict[str, str]]]]:
        records: list[dict[str, str]] = []
        selection = execute_query(connection, phones_query())
        while selection.Next():
            records.append(
                {
                    "employee_code": one_c_text(connection, selection.EmployeeCode),
                    "contact_kind": one_c_text(connection, selection.ContactKind),
                    "phone": one_c_text(connection, selection.Phone),
                    "phone_no_codes": one_c_text(connection, selection.PhoneNoCodes),
                }
            )
        return deduplicate_phone_records(records)

    def _load_emails(self, connection: Any) -> dict[str, dict[str, list[dict[str, str]]]]:
        records: list[dict[str, str]] = []
        selection = execute_query(connection, emails_query())
        while selection.Next():
            records.append(
                {
                    "employee_code": one_c_text(connection, selection.EmployeeCode),
                    "contact_kind": one_c_text(connection, selection.ContactKind),
                    "email": one_c_text(connection, selection.Email),
                }
            )
        return deduplicate_email_records(records)


address_book_service = AddressBookService()


async def background_address_book_sync_loop() -> None:
    interval = env_positive_int(
        "ADDRESS_BOOK_SYNC_INTERVAL_SECONDS",
        DEFAULT_SYNC_INTERVAL_SECONDS,
        300,
    )
    await asyncio.sleep(30)
    while True:
        try:
            logger.info("Starting scheduled address book sync")
            await asyncio.to_thread(address_book_service.sync_from_1c)
            logger.info("Scheduled address book sync finished")
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            logger.info("Address book sync loop cancelled")
            break
        except Exception as exc:
            logger.error("Address book sync loop failed: %s", exc)
            await asyncio.sleep(300)
