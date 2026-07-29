# -*- coding: utf-8 -*-
"""Find people who have corporate email in list 2 but not in list 1."""
from __future__ import annotations

import csv
import re
from pathlib import Path

LIST1 = Path(r"c:\Project\Image_scan\data\employees_list_1.csv")
LIST2 = Path(r"c:\Project\Image_scan\data\employees_list_2.csv")
OUT = Path(r"c:\Project\Image_scan\data\employees_email_appeared.csv")
TXT = Path(r"c:\Project\Image_scan\data\employees_email_appeared.txt")

EMAIL_COL = "Корпоративный E-mail"
TAB_COL = "Табельный номер"


def normalize_tab(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").strip())


def has_email(value: str) -> bool:
    v = (value or "").strip()
    return bool(v) and "@" in v


def load_rows(path: Path) -> dict[str, dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        rows: dict[str, dict[str, str]] = {}
        for row in csv.DictReader(fh, delimiter=";"):
            tab = normalize_tab(row.get(TAB_COL, ""))
            if not tab:
                continue
            if tab not in rows or (
                has_email(row.get(EMAIL_COL, ""))
                and not has_email(rows[tab].get(EMAIL_COL, ""))
            ):
                rows[tab] = row
        return rows


def main() -> None:
    rows1 = load_rows(LIST1)
    rows2 = load_rows(LIST2)

    appeared: list[dict[str, str]] = []
    for tab, r2 in rows2.items():
        email2 = (r2.get(EMAIL_COL) or "").strip()
        if not has_email(email2):
            continue
        r1 = rows1.get(tab)
        if r1 is None:
            continue
        email1 = (r1.get(EMAIL_COL) or "").strip()
        if has_email(email1):
            continue
        appeared.append(
            {
                TAB_COL: tab,
                "Фамилия": r2.get("Фамилия", ""),
                "Имя": r2.get("Имя", ""),
                "Отчество": r2.get("Отчество", ""),
                "Должность": r2.get("Должность", ""),
                "Подразделение": r2.get("Подразделение", ""),
                "E-mail было (1)": email1,
                "E-mail стало (2)": email2,
                "Город (1)": r1.get("Город", ""),
                "Город (2)": r2.get("Город", ""),
            }
        )

    appeared.sort(key=lambda x: (x["Фамилия"], x["Имя"], x["Отчество"], x[TAB_COL]))

    fields = [
        TAB_COL,
        "Фамилия",
        "Имя",
        "Отчество",
        "Должность",
        "Подразделение",
        "E-mail было (1)",
        "E-mail стало (2)",
        "Город (1)",
        "Город (2)",
    ]
    with OUT.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, delimiter=";")
        writer.writeheader()
        writer.writerows(appeared)

    lines = [f"Всего: {len(appeared)}", ""]
    for row in appeared:
        fio = f'{row["Фамилия"]} {row["Имя"]} {row["Отчество"]}'.strip()
        lines.append(
            f'{row[TAB_COL]}; {fio}; стало: {row["E-mail стало (2)"]}; '
            f'должность: {row["Должность"]}'
        )
    TXT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"appeared={len(appeared)}")
    print(OUT)
    print(TXT)


if __name__ == "__main__":
    main()
