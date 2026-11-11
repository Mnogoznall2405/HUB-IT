# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import csv
import getpass
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import win32com.client


DEFAULT_SERVER = "tmn-srv-1c-01.zsgp.corp,tmn-srv-1c-02.zsgp.corp"
DEFAULT_REF = "zar31"
DEFAULT_USER = "Test01"
DEFAULT_OUTPUT = "exports/1c_zar31_active_employees.csv"


CSV_COLUMNS = [
    "ФИО",
    "Подразделение",
    "МестонахождениеПодразделения",
    "Должность",
    "ДатаПриема",
    "РабочиеТелефоны",
    "ЛичныеТелефоны",
]


def configure_stdout() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Выгрузить действующих сотрудников из базы 1С ЗУП zar31 в CSV."
    )
    parser.add_argument("--server", default=DEFAULT_SERVER, help="Серверы кластера 1С.")
    parser.add_argument("--ref", default=DEFAULT_REF, help="Имя информационной базы 1С.")
    parser.add_argument("--user", default=DEFAULT_USER, help="Пользователь 1С.")
    parser.add_argument(
        "--password",
        default=os.environ.get("1C_PASSWORD"),
        help="Пароль 1С. Лучше передавать через переменную окружения 1C_PASSWORD.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Сколько строк выгрузить. 0 означает полный список.",
    )
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Путь к итоговому CSV.")
    return parser.parse_args()


def quote_1c(value: str) -> str:
    return value.replace('"', '""')


def build_connection_string(server: str, ref: str, user: str, password: str) -> str:
    return (
        f'Srvr="{quote_1c(server)}";'
        f'Ref="{quote_1c(ref)}";'
        f'Usr="{quote_1c(user)}";'
        f'Pwd="{quote_1c(password)}";'
    )


def connect(connection_string: str) -> Any:
    connector = win32com.client.Dispatch("V83.COMConnector")
    return connector.Connect(connection_string)


def one_c_text(connection: Any, value: Any) -> str:
    if value is None:
        return ""
    text = connection.String(value)
    return (text or "").strip()


def format_date(value: str) -> str:
    text = value.strip()
    if " " in text:
        return text.split(" ", 1)[0]
    return text


def phone_value(phone: str, phone_no_codes: str) -> str:
    return phone.strip() or phone_no_codes.strip()


def split_phone_values(phone: str, phone_no_codes: str) -> list[str]:
    value = phone_value(phone, phone_no_codes)
    if not value:
        return []
    values = [part.strip() for part in re.split(r"[,;\n/]+", value) if part.strip()]
    return values or [value]


def normalize_phone(value: str) -> str:
    number = re.sub(r"\D+", "", value)
    if len(number) == 11 and number.startswith("8"):
        return "7" + number[1:]
    if len(number) == 10:
        return "7" + number
    return number


def classify_phone(contact_kind: str) -> str | None:
    kind = contact_kind.casefold()
    if "рабоч" in kind or "служеб" in kind:
        return "work"
    if "лич" in kind or "моб" in kind or "дом" in kind:
        return "personal"
    return None


def phone_kind_priority(contact_kind: str, phone_type: str) -> int:
    kind = contact_kind.casefold()
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


def should_replace_phone(existing: dict[str, str | int], candidate: dict[str, str | int]) -> bool:
    if existing["type"] != "work" and candidate["type"] == "work":
        return True
    if existing["type"] == candidate["type"] and int(candidate["priority"]) > int(existing["priority"]):
        return True
    return False


def execute_query(connection: Any, text: str):
    query = connection.NewObject("Query")
    query.Text = text
    return query.Execute().Select()


def employee_query(limit: int) -> str:
    first_clause = f"ПЕРВЫЕ {limit}" if limit > 0 else ""
    return f"""
ВЫБРАТЬ РАЗЛИЧНЫЕ
    {first_clause}
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
    ) КАК Position,
    Текущие.ДатаПриема КАК HireDate
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


def load_phones(connection: Any) -> dict[str, dict[str, list[str]]]:
    phones_by_employee: dict[str, dict[str, dict[str, str | int]]] = defaultdict(dict)
    selection = execute_query(connection, phones_query())

    while selection.Next():
        employee_code = one_c_text(connection, selection.EmployeeCode)
        contact_kind = one_c_text(connection, selection.ContactKind)
        phone_type = classify_phone(contact_kind)
        if not employee_code or not phone_type:
            continue

        phone_values = split_phone_values(
            one_c_text(connection, selection.Phone),
            one_c_text(connection, selection.PhoneNoCodes),
        )
        for phone in phone_values:
            normalized_phone = normalize_phone(phone)
            if not normalized_phone:
                continue

            candidate = {
                "type": phone_type,
                "priority": phone_kind_priority(contact_kind, phone_type),
                "value": f"{contact_kind}: {phone}",
            }
            existing = phones_by_employee[employee_code].get(normalized_phone)
            if existing is None or should_replace_phone(existing, candidate):
                phones_by_employee[employee_code][normalized_phone] = candidate

    phones: dict[str, dict[str, list[str]]] = {}
    for employee_code, employee_phones in phones_by_employee.items():
        phones[employee_code] = {"work": [], "personal": []}
        for normalized_phone in sorted(employee_phones):
            phone = employee_phones[normalized_phone]
            phones[employee_code][str(phone["type"])].append(str(phone["value"]))

    return phones


def load_employees(connection: Any, limit: int) -> list[dict[str, str]]:
    selection = execute_query(connection, employee_query(limit))
    rows: list[dict[str, str]] = []

    while selection.Next():
        rows.append(
            {
                "ФИО": one_c_text(connection, selection.FullName),
                "_КодСотрудника": one_c_text(connection, selection.EmployeeCode),
                "Подразделение": one_c_text(connection, selection.Department),
                "МестонахождениеПодразделения": one_c_text(
                    connection, selection.DepartmentLocation
                ),
                "Должность": one_c_text(connection, selection.Position),
                "ДатаПриема": format_date(one_c_text(connection, selection.HireDate)),
                "РабочиеТелефоны": "",
                "ЛичныеТелефоны": "",
            }
        )

    rows.sort(key=lambda row: row["ФИО"].casefold())
    return rows


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=CSV_COLUMNS, delimiter=";")
        writer.writeheader()
        writer.writerows(rows)


def export_report(args: argparse.Namespace, password: str) -> Path:
    connection_string = build_connection_string(args.server, args.ref, args.user, password)

    print(f"Подключение к 1С: server={args.server}; ref={args.ref}; user={args.user}")
    connection = connect(connection_string)
    print("CONNECT OK")

    rows = load_employees(connection, args.limit)
    phones = load_phones(connection)
    for row in rows:
        employee_phones = phones.get(row.pop("_КодСотрудника"), {})
        row["РабочиеТелефоны"] = "; ".join(employee_phones.get("work", []))
        row["ЛичныеТелефоны"] = "; ".join(employee_phones.get("personal", []))

    output_path = Path(args.output)
    write_csv(output_path, rows)

    missing_required = sum(
        1 for row in rows if not row["ФИО"] or not row["ДатаПриема"]
    )
    missing_department_or_position = sum(
        1 for row in rows if not row["Подразделение"] or not row["Должность"]
    )
    rows_with_phones = sum(1 for row in rows if row["РабочиеТелефоны"] or row["ЛичныеТелефоны"])

    print(f"Строк выгружено: {len(rows)}")
    print(f"Строк без ФИО/даты приема: {missing_required}")
    print(f"Строк без подразделения или должности: {missing_department_or_position}")
    print(f"Строк с телефонами: {rows_with_phones}")
    print(f"CSV записан: {output_path}")
    return output_path


def main() -> int:
    configure_stdout()
    args = parse_args()

    password = args.password
    if not password:
        password = getpass.getpass("Пароль 1С: ")

    export_report(args, password)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
