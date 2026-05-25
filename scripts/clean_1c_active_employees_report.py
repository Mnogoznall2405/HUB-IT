# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import csv
from pathlib import Path


DEFAULT_INPUT = "exports/1c_zar31_active_employees_detailed.csv"
DEFAULT_OUTPUT = "exports/1c_zar31_active_employees_clean.csv"


CLEAN_COLUMNS = [
    "ФИО",
    "КодСотрудника",
    "КодФизЛица",
    "Организация",
    "Подразделение",
    "МестонахождениеПодразделения",
    "Должность",
    "ДатаПриема",
    "РабочиеТелефоны",
    "ЛичныеТелефоны",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Привести подробную выгрузку действующих сотрудников 1С к чистому CSV."
    )
    parser.add_argument("--input", default=DEFAULT_INPUT)
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    return parser.parse_args()


def trim(value: str | None) -> str:
    return (value or "").strip()


def format_date(value: str | None) -> str:
    text = trim(value)
    if " " in text:
        return text.split(" ", 1)[0]
    return text


def first_value(row: dict[str, str], *names: str) -> str:
    for name in names:
        value = trim(row.get(name))
        if value:
            return value
    return ""


def clean_row(row: dict[str, str]) -> dict[str, str]:
    return {
        "ФИО": first_value(row, "ФИО", "Сотрудник"),
        "КодСотрудника": first_value(row, "КодСотрудника", "СотрудникКод"),
        "КодФизЛица": first_value(row, "КодФизЛица", "ФизическоеЛицоКод"),
        "Организация": first_value(row, "Организация", "ТекущаяОрганизация", "ГоловнаяОрганизация"),
        "Подразделение": first_value(row, "Подразделение", "ТекущееПодразделение"),
        "МестонахождениеПодразделения": first_value(row, "МестонахождениеПодразделения"),
        "Должность": first_value(row, "Должность", "ТекущаяДолжность"),
        "ДатаПриема": format_date(first_value(row, "ДатаПриема")),
        "РабочиеТелефоны": first_value(row, "РабочиеТелефоны"),
        "ЛичныеТелефоны": first_value(row, "ЛичныеТелефоны"),
    }


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with input_path.open("r", encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source, delimiter=";"))

    clean_rows = [clean_row(row) for row in rows]
    clean_rows.sort(key=lambda row: (row["ФИО"].casefold(), row["Организация"].casefold()))

    with output_path.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=CLEAN_COLUMNS, delimiter=";")
        writer.writeheader()
        writer.writerows(clean_rows)

    print(f"Прочитано строк: {len(rows)}")
    print(f"Записано строк: {len(clean_rows)}")
    print(f"CSV записан: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
