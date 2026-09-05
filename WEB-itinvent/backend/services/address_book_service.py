# -*- coding: utf-8 -*-
from __future__ import annotations

import asyncio
import logging
import os
import re
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

from backend.json_db.manager import JSONDataManager


logger = logging.getLogger(__name__)

DEFAULT_1C_SERVER = "tmn-srv-1c-01.zsgp.corp,tmn-srv-1c-02.zsgp.corp"
DEFAULT_1C_REF = "zar31"
DEFAULT_SYNC_INTERVAL_SECONDS = 14_400
CACHE_FILE = "address_book_cache.json"
# Open-ended ZUP states without ReturnsOn older than this are treated as stale noise.
OPEN_ABSENCE_MAX_AGE_DAYS = 180
ABSENCE_KIND_LABELS = {
    "vacation": "Отпуск",
    "sick": "Больничный",
    "trip": "Командировка",
    "other": "Другое",
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_search_text(value: Any) -> str:
    return re.sub(r"\s+", " ", normalize_text(value)).casefold()


OFFICE_LOCATION_MARKERS = (
    "москва",
    "moscow",
    "санктпетербург",
    "петербург",
    "спб",
    "питер",
    "saintpetersburg",
    "stpetersburg",
    "тюмень",
    "tyumen",
)


def classify_department_location(location: Any) -> str:
    """Classify a ZUP площадка for manual office/object card binding."""
    compact = re.sub(r"[^0-9a-zа-яё]+", "", normalize_search_text(location))
    if any(marker in compact for marker in OFFICE_LOCATION_MARKERS):
        return "office"
    return "object"


def format_department_label(department: Any, department_location: Any = "") -> str:
    """Combine ZUP department + площадка into one label as users see it.

    Cache stores them separately (department=«Отдел логистики»,
    location=«Владивосток»), while UI/1C cards often show
    «Отдел логистики г. Владивосток».
    """
    dept = normalize_text(department)
    loc = normalize_text(department_location)
    if not dept:
        return loc
    if not loc:
        return dept
    loc_fold = loc.casefold()
    dept_fold = dept.casefold()
    if loc_fold in dept_fold:
        return dept
    if loc_fold.startswith("г.") or loc_fold.startswith("г "):
        return f"{dept} {loc}"
    return f"{dept} г. {loc}"


# Only these (department, location) pairs become a separate selectable subdivision.
# Everyone else stays under the bare ZUP department name (cities ignored for binding).
_DEPARTMENT_CITY_SPLIT_RULES: tuple[tuple[str, str], ...] = (
    ("отдел логистики", "владивосток"),  # Махов и площадка Владивосток
)


def _is_special_city_split(department: str, location: str) -> bool:
    dept_key = normalize_search_text(department)
    loc_key = normalize_search_text(location)
    if not dept_key or not loc_key:
        return False
    for dept_rule, loc_rule in _DEPARTMENT_CITY_SPLIT_RULES:
        if dept_key == dept_rule and loc_rule in loc_key:
            return True
    return False


def build_department_label_resolver(items: Iterable[dict[str, Any]] | None = None):
    """Resolve binding label for an address-book person.

    Default: bare department (city ignored) so «Отдел наземной и авиа логистики»
    stays one subdivision for all cities. Exception: special rules (Махов /
    «Отдел логистики г. Владивосток»).
    """
    del items  # resolver is rule-based; signature kept for call-site compatibility

    def resolve(item: dict[str, Any]) -> str:
        base = normalize_text(item.get("department"))
        if not base:
            return ""
        loc = normalize_text(item.get("department_location"))
        if _is_special_city_split(base, loc):
            return format_department_label(base, loc)
        return base

    return resolve


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


def execute_query(connection: Any, text: str, *, parameters: dict[str, Any] | None = None):
    query = connection.NewObject("Query")
    query.Text = text
    if parameters:
        for key, value in parameters.items():
            query.SetParameter(str(key), value)
    return query.Execute().Select()


def map_absence_kind(state_label: str) -> str:
    """Map ZUP Состояние presentation to Hub absence kind."""
    text = normalize_search_text(state_label)
    if not text or text == "работа":
        return ""
    if text.startswith("работа "):
        # e.g. «Работа в отпуске по уходу за ребенком» — special on-duty status
        return "other"
    if "командир" in text:
        return "trip"
    if "болезн" in text or "больнич" in text:
        return "sick"
    if "отпуск" in text:
        return "vacation"
    return "other"


def build_absence_payload(*, state_label: str, starts_on: str, returns_on: str = "") -> dict[str, Any] | None:
    kind = map_absence_kind(state_label)
    label = normalize_text(state_label)
    if not kind or not label:
        return None
    payload = {
        "kind": kind,
        "label": label,
        "starts_on": normalize_text(starts_on)[:10] or None,
        "returns_on": normalize_text(returns_on)[:10] or None,
        "source": "zup",
    }
    return payload


def parse_absence_date(value: Any) -> date | None:
    text = normalize_text(value)[:10]
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def absence_last_day(absence: dict[str, Any] | None) -> date | None:
    """Last calendar day away: day before returns_on (first day back at work)."""
    if not isinstance(absence, dict):
        return None
    returns_on = parse_absence_date(absence.get("returns_on"))
    if returns_on is None:
        return None
    return returns_on - timedelta(days=1)


def absence_overlaps_range(
    absence: dict[str, Any] | None,
    *,
    range_start: date,
    range_end: date,
    today: date | None = None,
    open_max_age_days: int = OPEN_ABSENCE_MAX_AGE_DAYS,
) -> bool:
    if not isinstance(absence, dict):
        return False
    starts_on = parse_absence_date(absence.get("starts_on"))
    if starts_on is None:
        return False
    if range_end < range_start:
        range_start, range_end = range_end, range_start
    if starts_on > range_end:
        return False
    ends_on = absence_last_day(absence)
    if ends_on is not None and ends_on < range_start:
        return False
    if ends_on is None:
        ref = today or date.today()
        if (ref - starts_on).days > int(open_max_age_days):
            return False
    return True


def serialize_cache_absence_item(person: dict[str, Any], absence: dict[str, Any]) -> dict[str, Any]:
    kind = normalize_text(absence.get("kind")).lower() or "other"
    code = normalize_text(person.get("employee_code"))
    starts_on = parse_absence_date(absence.get("starts_on"))
    ends_on = absence_last_day(absence)
    returns_on = parse_absence_date(absence.get("returns_on"))
    zup_label = normalize_text(absence.get("label"))
    return {
        "id": f"zup:{code}" if code else f"zup:{normalize_search_text(person.get('full_name'))}",
        "employee_code": code or None,
        "user_id": None,
        "display_name": normalize_text(person.get("full_name")) or code or "Без имени",
        "department": normalize_text(person.get("department")) or None,
        "position": normalize_text(person.get("position")) or None,
        "kind": kind if kind in ABSENCE_KIND_LABELS else "other",
        "kind_label": zup_label or ABSENCE_KIND_LABELS.get(kind, ABSENCE_KIND_LABELS["other"]),
        "label": zup_label or None,
        "starts_on": starts_on.isoformat() if starts_on else None,
        "ends_on": ends_on.isoformat() if ends_on else None,
        "returns_on": returns_on.isoformat() if returns_on else None,
        "comment": None,
        "source": "zup",
    }


def employee_states_query() -> str:
    """Latest HR state per employee with the next state date as return-to-work."""
    return """
ВЫБРАТЬ
    Текущее.Сотрудник.Код КАК EmployeeCode,
    Текущее.Период КАК StartsOn,
    ПРЕДСТАВЛЕНИЕ(Текущее.Состояние) КАК StateLabel,
    МИНИМУМ(Следующее.Период) КАК ReturnsOn
ИЗ
    (
        ВЫБРАТЬ
            Состояния.Сотрудник КАК Сотрудник,
            МАКСИМУМ(Состояния.Период) КАК Период
        ИЗ
            РегистрСведений.СостоянияСотрудников КАК Состояния
                ВНУТРЕННЕЕ СОЕДИНЕНИЕ РегистрСведений.ТекущиеКадровыеДанныеСотрудников КАК Кадры
                ПО Состояния.Сотрудник = Кадры.Сотрудник
        ГДЕ
            Состояния.Период <= &НаДату
            И Кадры.ДатаУвольнения = ДАТАВРЕМЯ(1, 1, 1)
            И Кадры.ДатаПриема <> ДАТАВРЕМЯ(1, 1, 1)
            И Кадры.Сотрудник <> ЗНАЧЕНИЕ(Справочник.Сотрудники.ПустаяСсылка)
        СГРУППИРОВАТЬ ПО
            Состояния.Сотрудник
    ) КАК Последние
        ВНУТРЕННЕЕ СОЕДИНЕНИЕ РегистрСведений.СостоянияСотрудников КАК Текущее
        ПО Текущее.Сотрудник = Последние.Сотрудник
            И Текущее.Период = Последние.Период
        ЛЕВОЕ СОЕДИНЕНИЕ РегистрСведений.СостоянияСотрудников КАК Следующее
        ПО Следующее.Сотрудник = Текущее.Сотрудник
            И Следующее.Период > Текущее.Период
СГРУППИРОВАТЬ ПО
    Текущее.Сотрудник.Код,
    Текущее.Период,
    ПРЕДСТАВЛЕНИЕ(Текущее.Состояние)
"""


def employee_query() -> str:
    return """
ВЫБРАТЬ РАЗЛИЧНЫЕ
    Текущие.Сотрудник КАК FullName,
    Текущие.Сотрудник.Код КАК EmployeeCode,
    Текущие.ДатаПриема КАК HireDate,
    ЕСТЬNULL(
        История.Подразделение,
        ЕСТЬNULL(
            Прием.Подразделение,
            ЕСТЬNULL(ПриемСписком.Подразделение, Текущие.ТекущееПодразделение)
        )
    ) КАК Department,
    ЕСТЬNULL(
        История.Подразделение.Код,
        ЕСТЬNULL(
            Прием.Подразделение.Код,
            ЕСТЬNULL(ПриемСписком.Подразделение.Код, Текущие.ТекущееПодразделение.Код)
        )
    ) КАК DepartmentCode,
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
        ИЛИ Контакты.Вид.Наименование = "Email Корпоративный"
        ИЛИ Контакты.Вид.Наименование = "Корпоративный E-mail"
    )
"""


def personal_profile_query() -> str:
    """Birth data + registration address from ФизическиеЛица."""
    return """
ВЫБРАТЬ РАЗЛИЧНЫЕ
    Текущие.Сотрудник.Код КАК EmployeeCode,
    Текущие.ФизическоеЛицо.ДатаРождения КАК DateOfBirth,
    Текущие.ФизическоеЛицо.МестоРождения КАК BirthPlace,
    Адреса.Вид КАК AddressKind,
    Адреса.Представление КАК RegistrationAddress
ИЗ
    РегистрСведений.ТекущиеКадровыеДанныеСотрудников КАК Текущие

        ЛЕВОЕ СОЕДИНЕНИЕ Справочник.ФизическиеЛица.КонтактнаяИнформация КАК Адреса
        ПО Адреса.Ссылка = Текущие.ФизическоеЛицо
            И (
                Адреса.Вид.Наименование ПОДОБНО "%прописк%"
                ИЛИ Адреса.Вид.Наименование ПОДОБНО "%регистрац%"
                ИЛИ Адреса.Вид.Наименование = "Адрес по прописке"
            )
ГДЕ
    Текущие.ДатаУвольнения = ДАТАВРЕМЯ(1, 1, 1)
    И Текущие.ДатаПриема <> ДАТАВРЕМЯ(1, 1, 1)
    И Текущие.Сотрудник <> ЗНАЧЕНИЕ(Справочник.Сотрудники.ПустаяСсылка)
"""


def personal_documents_query() -> str:
    """Identity documents (passport) from ДокументыФизическихЛиц."""
    return """
ВЫБРАТЬ РАЗЛИЧНЫЕ
    Текущие.Сотрудник.Код КАК EmployeeCode,
    Документы.ВидДокумента КАК DocumentKind,
    Документы.Серия КАК PassportSeries,
    Документы.Номер КАК PassportNumber,
    Документы.КемВыдан КАК IssuedBy,
    Документы.КодПодразделения КАК IssuerCode,
    Документы.ДатаВыдачи КАК IssueDate
ИЗ
    РегистрСведений.ТекущиеКадровыеДанныеСотрудников КАК Текущие

        ВНУТРЕННЕЕ СОЕДИНЕНИЕ РегистрСведений.ДокументыФизическихЛиц.СрезПоследних(
            ,
            ЯвляетсяДокументомУдостоверяющимЛичность = ИСТИНА
        ) КАК Документы
        ПО Документы.Физлицо = Текущие.ФизическоеЛицо
ГДЕ
    Текущие.ДатаУвольнения = ДАТАВРЕМЯ(1, 1, 1)
    И Текущие.ДатаПриема <> ДАТАВРЕМЯ(1, 1, 1)
    И Текущие.Сотрудник <> ЗНАЧЕНИЕ(Справочник.Сотрудники.ПустаяСсылка)
"""


PERSONAL_CACHE_KEYS = (
    "date_of_birth",
    "birth_place",
    "passport_series",
    "passport_number",
    "issued_by",
    "issuer_code",
    "issue_date",
    "registration_address",
)


def empty_cache() -> dict[str, Any]:
    return {
        "items": [],
        "personal_by_code": {},
        "updated_at": "",
        "last_attempt_at": "",
        "last_error": "",
    }


def one_c_date_iso(connection: Any, value: Any) -> str:
    """Convert 1C date/datetime to YYYY-MM-DD; empty for null/zero dates."""
    if value is None:
        return ""
    if hasattr(value, "year") and hasattr(value, "month") and hasattr(value, "day"):
        try:
            year = int(value.year)
            if year <= 1:
                return ""
            return f"{year:04d}-{int(value.month):02d}-{int(value.day):02d}"
        except Exception:
            pass
    text = one_c_text(connection, value)
    if not text:
        return ""
    digits = re.sub(r"\D+", "", text)
    if len(digits) >= 8:
        year = int(digits[:4])
        if year <= 1:
            return ""
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    if "T" in text:
        return text.split("T", 1)[0]
    return text[:10] if len(text) >= 10 else ""


def calculate_age(date_of_birth: Any, *, today: date | None = None) -> int | None:
    """Calculate a public age value without exposing the underlying birth date."""
    text = normalize_text(date_of_birth)[:10]
    if not text:
        return None
    try:
        born_on = date.fromisoformat(text)
    except ValueError:
        return None

    current = today or date.today()
    age = current.year - born_on.year - (
        (current.month, current.day) < (born_on.month, born_on.day)
    )
    return age if 0 <= age <= 120 else None


def is_passport_document_kind(kind: Any) -> bool:
    text = normalize_search_text(kind)
    return "паспорт" in text


def clean_zup_birth_place(value: Any) -> str:
    """Normalize ZUP birth place like ``0,г. Тюмень,,,`` → ``г. Тюмень``."""
    text = normalize_text(value)
    if not text:
        return ""
    parts = [part.strip() for part in text.split(",") if part.strip() and part.strip() != "0"]
    return ", ".join(parts) if parts else text


def merge_personal_profile_records(records: list[dict[str, str]]) -> dict[str, dict[str, str]]:
    """Collapse profile rows (birth/address) keyed by employee_code."""
    result: dict[str, dict[str, str]] = {}
    for record in records:
        code = normalize_text(record.get("employee_code"))
        if not code:
            continue
        current = result.setdefault(
            code,
            {
                "date_of_birth": "",
                "birth_place": "",
                "registration_address": "",
            },
        )
        if not current["date_of_birth"] and record.get("date_of_birth"):
            current["date_of_birth"] = normalize_text(record.get("date_of_birth"))
        if not current["birth_place"] and record.get("birth_place"):
            current["birth_place"] = normalize_text(record.get("birth_place"))
        address = normalize_text(record.get("registration_address"))
        if address and (
            not current["registration_address"]
            or "прописк" in normalize_search_text(record.get("address_kind"))
        ):
            current["registration_address"] = address
    return result


def merge_personal_document_records(records: list[dict[str, str]]) -> dict[str, dict[str, str]]:
    """Pick best identity document per employee (prefer RF passport)."""
    result: dict[str, dict[str, str]] = {}
    for record in records:
        code = normalize_text(record.get("employee_code"))
        if not code:
            continue
        candidate = {
            "passport_series": normalize_text(record.get("passport_series")),
            "passport_number": normalize_text(record.get("passport_number")),
            "issued_by": normalize_text(record.get("issued_by")),
            "issuer_code": normalize_text(record.get("issuer_code")),
            "issue_date": normalize_text(record.get("issue_date")),
            "document_kind": normalize_text(record.get("document_kind")),
        }
        if not any(
            candidate[key]
            for key in ("passport_series", "passport_number", "issued_by", "issuer_code", "issue_date")
        ):
            continue
        existing = result.get(code)
        if existing is None:
            result[code] = candidate
            continue
        if is_passport_document_kind(candidate["document_kind"]) and not is_passport_document_kind(
            existing.get("document_kind")
        ):
            result[code] = candidate
    for item in result.values():
        item.pop("document_kind", None)
    return result


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
        personal = result.get("personal_by_code")
        if not isinstance(personal, dict):
            result["personal_by_code"] = {}
        return result

    def get_person_by_code(self, employee_code: str) -> dict[str, Any] | None:
        code = normalize_text(employee_code)
        if not code:
            return None
        for item in self.load_cache().get("items") or []:
            if not isinstance(item, dict):
                continue
            if normalize_text(item.get("employee_code")) == code:
                return item
        return None

    def get_personal_by_codes(self, codes: Iterable[str] | None = None) -> dict[str, dict[str, str]]:
        """Return personal ZUP fields keyed by employee_code (not exposed via search API)."""
        cache = self.load_cache()
        personal = cache.get("personal_by_code") or {}
        if not isinstance(personal, dict):
            return {}
        if codes is None:
            selected_codes = list(personal.keys())
        else:
            selected_codes = [normalize_text(code) for code in codes if normalize_text(code)]
        result: dict[str, dict[str, str]] = {}
        for code in selected_codes:
            raw = personal.get(code)
            if not isinstance(raw, dict):
                continue
            cleaned = {
                key: normalize_text(raw.get(key))
                for key in PERSONAL_CACHE_KEYS
                if normalize_text(raw.get(key))
            }
            if cleaned.get("birth_place"):
                cleaned["birth_place"] = clean_zup_birth_place(cleaned["birth_place"])
            if cleaned:
                result[code] = cleaned
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

    def list_absences(
        self,
        *,
        on: date | None = None,
        starts_on: date | None = None,
        ends_on: date | None = None,
        limit: int = 200,
    ) -> dict[str, Any]:
        """Absences from address-book cache (ZUP СостоянияСотрудников), filtered by date range."""
        today = date.today()
        if on is not None:
            range_start = range_end = on
        else:
            range_start = starts_on or today
            range_end = ends_on or range_start
        if range_end < range_start:
            range_start, range_end = range_end, range_start
        safe_limit = max(1, min(500, int(limit or 200)))
        cache = self.load_cache()
        items: list[dict[str, Any]] = []
        for person in cache.get("items") or []:
            if not isinstance(person, dict):
                continue
            absence = person.get("absence")
            if not isinstance(absence, dict):
                continue
            if not absence_overlaps_range(
                absence,
                range_start=range_start,
                range_end=range_end,
                today=today,
            ):
                continue
            items.append(serialize_cache_absence_item(person, absence))
        items.sort(
            key=lambda item: (
                normalize_text(item.get("starts_on")) or "9999-99-99",
                normalize_search_text(item.get("display_name")),
            )
        )
        return {
            "starts_on": range_start.isoformat(),
            "ends_on": range_end.isoformat(),
            "on": on.isoformat() if on is not None else None,
            "count": len(items),
            "items": items[:safe_limit],
            "as_of": normalize_text(cache.get("updated_at")) or None,
            "source": "zup",
        }

    def search(
        self,
        query: str = "",
        limit: int = 50,
        *,
        offset: int = 0,
        include_age: bool = True,
        include_hire_date: bool = False,
        include_personal_emails: bool = True,
        include_personal_phones: bool = True,
    ) -> dict[str, Any]:
        cache = self.load_cache()
        items = [item for item in cache.get("items") or [] if isinstance(item, dict)]
        personal_by_code = cache.get("personal_by_code")
        if not isinstance(personal_by_code, dict):
            personal_by_code = {}
        tokens = normalize_search_text(query).split()
        limited = max(1, min(int(limit or 50), 200))
        safe_offset = max(0, int(offset or 0))

        if tokens:
            items = [
                item
                for item in items
                if self._matches_query(
                    item,
                    tokens,
                    include_personal_emails=include_personal_emails,
                    include_personal_phones=include_personal_phones,
                )
            ]
            items.sort(
                key=lambda item: (
                    -self._query_score(
                        item,
                        tokens,
                        include_personal_emails=include_personal_emails,
                        include_personal_phones=include_personal_phones,
                    ),
                    normalize_search_text(item.get("full_name")),
                    normalize_search_text(item.get("employee_code")),
                )
            )
        else:
            items.sort(
                key=lambda item: (
                    normalize_search_text(item.get("full_name")),
                    normalize_search_text(item.get("employee_code")),
                )
            )

        return {
            "items": [
                self._serialize_public_search_item(
                    item,
                    personal_by_code,
                    include_age=include_age,
                    include_hire_date=include_hire_date,
                    include_personal_emails=include_personal_emails,
                    include_personal_phones=include_personal_phones,
                )
                for item in items[safe_offset : safe_offset + limited]
            ],
            "total": len(items),
            "limit": limited,
            "offset": safe_offset,
            "has_more": safe_offset + limited < len(items),
            "updated_at": normalize_text(cache.get("updated_at")),
            "last_error": normalize_text(cache.get("last_error")),
        }

    def snapshot(
        self,
        *,
        include_age: bool = True,
        include_hire_date: bool = False,
        include_personal_emails: bool = True,
        include_personal_phones: bool = True,
    ) -> dict[str, Any]:
        """Return one permission-filtered, internally consistent directory revision."""
        cache = self.load_cache()
        items = [item for item in cache.get("items") or [] if isinstance(item, dict)]
        items.sort(
            key=lambda item: (
                normalize_search_text(item.get("full_name")),
                normalize_search_text(item.get("employee_code")),
            )
        )
        personal_by_code = cache.get("personal_by_code")
        if not isinstance(personal_by_code, dict):
            personal_by_code = {}
        public_items = [
            self._serialize_public_search_item(
                item,
                personal_by_code,
                include_age=include_age,
                include_hire_date=include_hire_date,
                include_personal_emails=include_personal_emails,
                include_personal_phones=include_personal_phones,
            )
            for item in items
        ]
        return {
            "items": public_items,
            "total": len(public_items),
            "limit": len(public_items),
            "offset": 0,
            "has_more": False,
            "updated_at": normalize_text(cache.get("updated_at")),
            "last_error": normalize_text(cache.get("last_error")),
        }

    @staticmethod
    def _serialize_public_search_item(
        item: dict[str, Any],
        personal_by_code: dict[str, Any],
        *,
        include_age: bool = True,
        include_hire_date: bool = False,
        include_personal_emails: bool = True,
        include_personal_phones: bool = True,
    ) -> dict[str, Any]:
        public_item = dict(item)
        for key in PERSONAL_CACHE_KEYS:
            public_item.pop(key, None)
        public_item.pop("age", None)
        public_item.pop("hire_date", None)
        if not include_personal_emails:
            public_item["personal_emails"] = []
        if not include_personal_phones:
            public_item["personal_phones"] = []

        employee_code = normalize_text(item.get("employee_code"))
        personal = personal_by_code.get(employee_code)
        if include_age and isinstance(personal, dict):
            age = calculate_age(personal.get("date_of_birth"))
            if age is not None:
                public_item["age"] = age
        if include_hire_date:
            hire_date = normalize_text(item.get("hire_date"))[:10]
            if hire_date:
                public_item["hire_date"] = hire_date
        return public_item

    def _matches_query(
        self,
        item: dict[str, Any],
        tokens: list[str],
        *,
        include_personal_emails: bool = True,
        include_personal_phones: bool = True,
    ) -> bool:
        phones = list(item.get("work_phones") or [])
        emails = list(item.get("work_emails") or [])
        if include_personal_phones:
            phones.extend(item.get("personal_phones") or [])
        if include_personal_emails:
            emails.extend(item.get("personal_emails") or [])
        text = normalize_search_text(
            " ".join(
                [
                    normalize_text(item.get("full_name")),
                    normalize_text(item.get("department")),
                    normalize_text(item.get("department_code")),
                    normalize_text(item.get("department_location")),
                    normalize_text(item.get("position")),
                    normalize_text(item.get("employee_code")),
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

    def _query_score(
        self,
        item: dict[str, Any],
        tokens: list[str],
        *,
        include_personal_emails: bool = True,
        include_personal_phones: bool = True,
    ) -> int:
        phones = list(item.get("work_phones") or [])
        emails = list(item.get("work_emails") or [])
        if include_personal_phones:
            phones.extend(item.get("personal_phones") or [])
        if include_personal_emails:
            emails.extend(item.get("personal_emails") or [])
        return (
            self._field_match_score(item.get("full_name"), tokens, contains_score=120, prefix_score=160)
            + self._field_match_score(item.get("position"), tokens, contains_score=45)
            + self._field_match_score(item.get("department"), tokens, contains_score=35)
            + self._field_match_score(item.get("department_code"), tokens, contains_score=50, prefix_score=70)
            + self._field_match_score(item.get("employee_code"), tokens, contains_score=40, prefix_score=60)
            + self._field_match_score(item.get("department_location"), tokens, contains_score=30)
            + self._phone_match_score(phones, tokens)
            + self._email_match_score(emails, tokens)
        )

    def list_people_by_department_codes(
        self,
        department_codes: Iterable[str],
        *,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        codes = {
            normalize_text(code)
            for code in (department_codes or [])
            if normalize_text(code)
        }
        if not codes:
            return []
        cache = self.load_cache()
        items = [item for item in cache.get("items") or [] if isinstance(item, dict)]
        matched = [
            item
            for item in items
            if normalize_text(item.get("department_code")) in codes
        ]
        matched.sort(key=lambda item: normalize_search_text(item.get("full_name")))
        limited = max(1, min(int(limit or 500), 2000))
        return matched[:limited]

    def list_people_by_department_names(
        self,
        department_names: Iterable[str],
        *,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        names = {
            normalize_search_text(name)
            for name in (department_names or [])
            if normalize_text(name)
        }
        if not names:
            return []
        cache = self.load_cache()
        items = [item for item in cache.get("items") or [] if isinstance(item, dict)]
        resolve_label = build_department_label_resolver(items)
        matched: list[dict[str, Any]] = []
        for item in items:
            label = normalize_search_text(resolve_label(item))
            if label and label in names:
                matched.append(item)
        matched.sort(key=lambda item: normalize_search_text(item.get("full_name")))
        limited = max(1, min(int(limit or 500), 2000))
        return matched[:limited]

    def list_department_names(self, query: str = "", limit: int = 50) -> dict[str, Any]:
        cache = self.load_cache()
        items = [item for item in cache.get("items") or [] if isinstance(item, dict)]
        groups_by_code: dict[str, set[str]] = {}
        for item in items:
            code = normalize_text(item.get("department_code"))
            if code:
                groups_by_code.setdefault(code, set()).add(
                    classify_department_location(item.get("department_location"))
                )

        by_name: dict[str, dict[str, Any]] = {}
        for item in items:
            base = normalize_text(item.get("department"))
            if not base:
                continue
            location = normalize_text(item.get("department_location"))
            code = normalize_text(item.get("department_code"))
            code_groups = groups_by_code.get(code, set())
            binding_group = (
                "mixed"
                if len(code_groups) > 1
                else next(iter(code_groups), classify_department_location(location))
            )
            if binding_group == "office":
                label = base
            elif binding_group == "object":
                label = f"{base} объект"
            else:
                label = f"{base} — смешанные площадки"
            key = normalize_search_text(label)
            current = by_name.get(key)
            if current is None:
                by_name[key] = {
                    "department": label,
                    "department_base": base,
                    "department_location": "",
                    "department_locations": {location},
                    "people_count": 1,
                    "department_codes": [code] if code else [],
                    "binding_group": binding_group,
                }
            else:
                current["people_count"] = int(current.get("people_count") or 0) + 1
                current["department_locations"].add(location)
                if code and code not in current["department_codes"]:
                    current["department_codes"].append(code)

        rows = list(by_name.values())
        for row in rows:
            locations = sorted(
                row.get("department_locations") or {""},
                key=lambda value: (not bool(value), normalize_search_text(value)),
            )
            row["department_locations"] = locations
            row["department_location"] = ", ".join(
                location or "Без площадки" for location in locations
            )
        tokens = normalize_search_text(query).split()
        if tokens:
            rows = [
                row
                for row in rows
                if all(
                    token in normalize_search_text(
                        f"{row.get('department')} {row.get('department_location')}"
                    )
                    for token in tokens
                )
            ]
        rows.sort(
            key=lambda row: (
                normalize_search_text(row.get("department_base")),
                {"office": 0, "object": 1, "mixed": 2}.get(row.get("binding_group"), 3),
            )
        )
        # The org-structure importer may need the complete ZUP department catalog.
        # Public API endpoints still enforce their own smaller query limit.
        limited = max(1, min(int(limit or 50), 2000))
        return {
            "items": rows[:limited],
            "total": len(rows),
            "limit": limited,
            "updated_at": normalize_text(cache.get("updated_at")),
        }

    def list_department_codes(self, query: str = "", limit: int = 50) -> dict[str, Any]:
        cache = self.load_cache()
        items = [item for item in cache.get("items") or [] if isinstance(item, dict)]
        by_code: dict[str, dict[str, Any]] = {}
        for item in items:
            code = normalize_text(item.get("department_code"))
            if not code:
                continue
            current = by_code.get(code)
            if current is None:
                by_code[code] = {
                    "department_code": code,
                    "department": normalize_text(item.get("department")),
                    "people_count": 1,
                    "department_locations": {normalize_text(item.get("department_location"))},
                    "binding_groups": {classify_department_location(item.get("department_location"))},
                }
            else:
                current["people_count"] = int(current.get("people_count") or 0) + 1
                if not current.get("department"):
                    current["department"] = normalize_text(item.get("department"))
                current["department_locations"].add(normalize_text(item.get("department_location")))
                current["binding_groups"].add(classify_department_location(item.get("department_location")))

        rows: list[dict[str, Any]] = []
        for current in by_code.values():
            groups = current.pop("binding_groups")
            locations = current.pop("department_locations")
            current["department_locations"] = sorted(
                locations,
                key=lambda value: (not bool(value), normalize_search_text(value)),
            )
            current["binding_group"] = next(iter(groups)) if len(groups) == 1 else "mixed"
            rows.append(current)
        tokens = normalize_search_text(query).split()
        if tokens:
            filtered = []
            for row in rows:
                locations = " ".join(
                    location or "без площадки"
                    for location in row.get("department_locations") or []
                )
                group_label = {
                    "office": "офис",
                    "object": "объект",
                    "mixed": "смешанный",
                }.get(row.get("binding_group"), "")
                hay = normalize_search_text(
                    f"{row.get('department_code')} {row.get('department')} {locations} {group_label}"
                )
                if all(token in hay for token in tokens):
                    filtered.append(row)
            rows = filtered

        rows.sort(
            key=lambda row: (
                -int(row.get("people_count") or 0),
                normalize_search_text(row.get("department")),
                normalize_search_text(row.get("department_code")),
            )
        )
        limited = max(1, min(int(limit or 50), 200))
        return {
            "items": rows[:limited],
            "total": len(rows),
            "limit": limited,
            "updated_at": normalize_text(cache.get("updated_at")),
        }

    def sync_from_1c(self) -> dict[str, Any]:
        if not self._sync_lock.acquire(blocking=False):
            status = self.get_status()
            status["sync_in_progress"] = True
            return status

        cache = self.load_cache()
        cache["last_attempt_at"] = utc_now_iso()
        try:
            items, personal_by_code = self._load_items_from_1c()
            next_cache = {
                "items": items,
                "personal_by_code": personal_by_code,
                "updated_at": utc_now_iso(),
                "last_attempt_at": cache["last_attempt_at"],
                "last_error": "",
            }
            self.save_cache(next_cache)
            return {
                "count": len(items),
                "personal_count": len(personal_by_code),
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

    def _load_items_from_1c(self) -> tuple[list[dict[str, Any]], dict[str, dict[str, str]]]:
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
            personal_by_code = self._load_personal_data(connection)
            absences_by_code = self._load_employee_absences(connection)
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
                absence = absences_by_code.get(employee_code)
                if absence:
                    employee["absence"] = absence
            employees.sort(key=lambda item: normalize_search_text(item.get("full_name")))
            return employees, personal_by_code
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
                    "hire_date": one_c_date_iso(connection, selection.HireDate),
                    "department": one_c_text(connection, selection.Department),
                    "department_code": one_c_text(connection, selection.DepartmentCode),
                    "department_location": one_c_text(connection, selection.DepartmentLocation),
                    "position": one_c_text(connection, selection.Position),
                }
            )
        return rows

    def _load_employee_absences(self, connection: Any) -> dict[str, dict[str, Any]]:
        """Current ZUP HR states (vacation/sick/trip/…) with return date; fail-soft."""
        result: dict[str, dict[str, Any]] = {}
        try:
            today = datetime.now().date()
            selection = execute_query(
                connection,
                employee_states_query(),
                parameters={"НаДату": datetime(today.year, today.month, today.day)},
            )
            latest_by_code: dict[str, dict[str, str]] = {}
            while selection.Next():
                employee_code = one_c_text(connection, selection.EmployeeCode)
                state_label = one_c_text(connection, selection.StateLabel)
                if not employee_code:
                    continue
                candidate = {
                    "state_label": state_label,
                    "starts_on": one_c_date_iso(connection, selection.StartsOn),
                    "returns_on": one_c_date_iso(connection, selection.ReturnsOn),
                }
                existing = latest_by_code.get(employee_code)
                if existing is None or candidate["starts_on"] >= existing["starts_on"]:
                    latest_by_code[employee_code] = candidate

            for employee_code, current_state in latest_by_code.items():
                payload = build_absence_payload(**current_state)
                if payload is None:
                    continue
                returns_on = parse_absence_date(payload.get("returns_on"))
                if returns_on is not None and returns_on <= today:
                    continue
                result[employee_code] = payload
        except Exception:
            logger.exception("Address book ZUP employee states load failed")
        return result

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

    def _load_personal_data(self, connection: Any) -> dict[str, dict[str, str]]:
        """Load passport/birth/registration from ZUP; failures must not break directory sync."""
        personal: dict[str, dict[str, str]] = {}
        try:
            profile_records: list[dict[str, str]] = []
            selection = execute_query(connection, personal_profile_query())
            while selection.Next():
                profile_records.append(
                    {
                        "employee_code": one_c_text(connection, selection.EmployeeCode),
                        "date_of_birth": one_c_date_iso(connection, selection.DateOfBirth),
                        "birth_place": one_c_text(connection, selection.BirthPlace),
                        "address_kind": one_c_text(connection, selection.AddressKind),
                        "registration_address": one_c_text(connection, selection.RegistrationAddress),
                    }
                )
            personal = {
                code: dict(values)
                for code, values in merge_personal_profile_records(profile_records).items()
            }
        except Exception:
            logger.exception("Address book personal profile sync failed")

        try:
            document_records: list[dict[str, str]] = []
            selection = execute_query(connection, personal_documents_query())
            while selection.Next():
                document_records.append(
                    {
                        "employee_code": one_c_text(connection, selection.EmployeeCode),
                        "document_kind": one_c_text(connection, selection.DocumentKind),
                        "passport_series": one_c_text(connection, selection.PassportSeries),
                        "passport_number": one_c_text(connection, selection.PassportNumber),
                        "issued_by": one_c_text(connection, selection.IssuedBy),
                        "issuer_code": one_c_text(connection, selection.IssuerCode),
                        "issue_date": one_c_date_iso(connection, selection.IssueDate),
                    }
                )
            for code, document in merge_personal_document_records(document_records).items():
                personal.setdefault(code, {}).update(document)
        except Exception:
            logger.exception("Address book personal documents sync failed")

        cleaned: dict[str, dict[str, str]] = {}
        for code, values in personal.items():
            item = {
                key: normalize_text(values.get(key))
                for key in PERSONAL_CACHE_KEYS
                if normalize_text(values.get(key))
            }
            if item:
                cleaned[code] = item
        return cleaned


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
