# -*- coding: utf-8 -*-
"""Extract list 2 from transcript and find people who lost corporate email."""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

TRANSCRIPT = Path(
    r"C:\Users\Администратор\.cursor\projects\c-Project-Image-scan"
    r"\agent-transcripts\c5155b3a-bba1-4afa-99d6-9b2230733e2f"
    r"\c5155b3a-bba1-4afa-99d6-9b2230733e2f.jsonl"
)
LIST1 = Path(r"c:\Project\Image_scan\data\employees_list_1.csv")
LIST2 = Path(r"c:\Project\Image_scan\data\employees_list_2.csv")
OUT = Path(r"c:\Project\Image_scan\data\employees_email_lost.csv")

EMAIL_COL = "Корпоративный E-mail"
TAB_COL = "Табельный номер"
FIO_COLS = ("Фамилия", "Имя", "Отчество")


def message_text(obj: dict) -> str:
    msg = obj.get("message")
    if isinstance(msg, dict):
        content = msg.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    parts.append(item.get("text") or "")
                elif isinstance(item, str):
                    parts.append(item)
            return "\n".join(parts)
    content = obj.get("content")
    return content if isinstance(content, str) else ""


def extract_csv_blocks(text: str) -> list[list[str]]:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[list[str]] = []
    i = 0
    while i < len(lines):
        if "Табельный номер" in lines[i] and "Фамилия" in lines[i]:
            block = [lines[i].rstrip()]
            i += 1
            while i < len(lines):
                s = lines[i].strip()
                if (
                    s.startswith("Вот ")
                    or s.startswith("</")
                    or s.startswith("<user")
                    or ("Табельный номер" in lines[i] and "Фамилия" in lines[i])
                ):
                    break
                block.append(lines[i].rstrip())
                i += 1
            while block and not block[-1].strip():
                block.pop()
            if len(block) > 10:
                blocks.append(block)
            continue
        i += 1
    return blocks


def normalize_tab(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").strip())


def has_email(value: str) -> bool:
    v = (value or "").strip()
    return bool(v) and "@" in v


def load_rows(path: Path) -> dict[str, dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh, delimiter=";")
        rows: dict[str, dict[str, str]] = {}
        for row in reader:
            tab = normalize_tab(row.get(TAB_COL, ""))
            if not tab:
                continue
            # keep first occurrence; if duplicates, prefer one with email
            if tab not in rows or (has_email(row.get(EMAIL_COL, "")) and not has_email(rows[tab].get(EMAIL_COL, ""))):
                rows[tab] = row
        return rows


def main() -> None:
    # Prefer newest user message that contains list marker / second dump
    candidates: list[list[str]] = []
    with TRANSCRIPT.open(encoding="utf-8") as fh:
        for line in fh:
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(obj, dict):
                continue
            role = None
            msg = obj.get("message")
            if isinstance(msg, dict):
                role = msg.get("role")
            text = message_text(obj)
            if role and role != "user":
                continue
            if "Табельный номер" not in text:
                continue
            for block in extract_csv_blocks(text):
                candidates.append(block)

    if len(candidates) < 2:
        # fallback: take largest block that is not identical to list1 line count
        raise SystemExit(f"need >=2 CSV blocks in transcript, found {len(candidates)}")

    # list2 = last candidate (latest paste)
    list2_lines = candidates[-1]
    LIST2.parent.mkdir(parents=True, exist_ok=True)
    LIST2.write_text("\n".join(list2_lines) + "\n", encoding="utf-8-sig")
    print(f"wrote {LIST2} lines={len(list2_lines)}")

    rows1 = load_rows(LIST1)
    rows2 = load_rows(LIST2)
    print(f"list1 unique tabs={len(rows1)} list2 unique tabs={len(rows2)}")

    lost: list[dict[str, str]] = []
    for tab, r1 in rows1.items():
        email1 = (r1.get(EMAIL_COL) or "").strip()
        if not has_email(email1):
            continue
        r2 = rows2.get(tab)
        if r2 is None:
            # not in list2 at all — skip for "lost email" unless user wants that
            continue
        email2 = (r2.get(EMAIL_COL) or "").strip()
        if not has_email(email2):
            lost.append(
                {
                    TAB_COL: tab,
                    "Фамилия": r1.get("Фамилия", ""),
                    "Имя": r1.get("Имя", ""),
                    "Отчество": r1.get("Отчество", ""),
                    "Должность": r1.get("Должность", ""),
                    "Подразделение": r1.get("Подразделение", ""),
                    "E-mail было": email1,
                    "E-mail стало": email2,
                    "Город (1)": r1.get("Город", ""),
                    "Город (2)": r2.get("Город", ""),
                }
            )

    lost.sort(key=lambda x: (x["Фамилия"], x["Имя"], x["Отчество"], x[TAB_COL]))

    with OUT.open("w", encoding="utf-8-sig", newline="") as fh:
        fieldnames = [
            TAB_COL,
            "Фамилия",
            "Имя",
            "Отчество",
            "Должность",
            "Подразделение",
            "E-mail было",
            "E-mail стало",
            "Город (1)",
            "Город (2)",
        ]
        writer = csv.DictWriter(fh, fieldnames=fieldnames, delimiter=";")
        writer.writeheader()
        writer.writerows(lost)

    print(f"wrote {OUT} lost_email_count={len(lost)}")
    for row in lost[:30]:
        fio = f'{row["Фамилия"]} {row["Имя"]} {row["Отчество"]}'.strip()
        print(f'- {row[TAB_COL]}; {fio}; было: {row["E-mail было"]}')
    if len(lost) > 30:
        print(f"... and {len(lost) - 30} more")


if __name__ == "__main__":
    main()
