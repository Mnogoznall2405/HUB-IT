# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import contextlib
import getpass
import os
import sys
from pathlib import Path
from typing import Iterable

import win32com.client


DEFAULT_SERVER = "tmn-srv-1c-01.zsgp.corp,tmn-srv-1c-02.zsgp.corp"
DEFAULT_REF = "buh20"


METADATA_COLLECTIONS = [
    ("Справочники", "Catalogs"),
    ("Документы", "Documents"),
    ("РегистрыСведений", "Information registers"),
    ("РегистрыНакопления", "Accumulation registers"),
    ("ПланыСчетов", "Charts of accounts"),
]


# Типовые объекты конфигурации "Бухгалтерия предприятия" ред. 2.0.
# Реальная база может быть доработана — недоступные объекты просто
# помечаются как "unavailable" и не прерывают проверку.
COUNT_QUERIES = [
    ("Организации", "Справочник.Организации"),
    ("Контрагенты", "Справочник.Контрагенты"),
    ("Номенклатура", "Справочник.Номенклатура"),
    ("Склады", "Справочник.Склады"),
    ("Физические лица", "Справочник.ФизическиеЛица"),
    ("Сотрудники", "Справочник.Сотрудники"),
    ("Банковские счета", "Справочник.БанковскиеСчета"),
    ("Поступления товаров и услуг", "Документ.ПоступлениеТоваровУслуг"),
    ("Реализации товаров и услуг", "Документ.РеализацияТоваровУслуг"),
    ("Приходные кассовые ордера", "Документ.ПриходныйКассовыйОрдер"),
    ("Расходные кассовые ордера", "Документ.РасходныйКассовыйОрдер"),
    ("Авансовые отчеты", "Документ.АвансовыйОтчет"),
]


def configure_stdout() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inspect the 1C Бухгалтерия 2.0 (buh20) infobase through V83.COMConnector."
    )
    parser.add_argument("--server", default=DEFAULT_SERVER)
    parser.add_argument("--ref", default=DEFAULT_REF)
    parser.add_argument("--user", default=os.environ.get("BUH20_1C_USER"), required=False)
    parser.add_argument("--password", default=os.environ.get("BUH20_1C_PASSWORD"))
    parser.add_argument("--metadata-limit", type=int, default=8)
    parser.add_argument(
        "--output",
        help="Write the inspection report to this UTF-8 text file.",
    )
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


def connect(connection_string: str):
    connector = win32com.client.Dispatch("V83.COMConnector")
    return connector.Connect(connection_string)


def iter_metadata_items(collection, limit: int) -> Iterable[tuple[str, str]]:
    count = collection.Count()
    for index in range(min(limit, count)):
        item = collection.Get(index)
        yield item.Name, item.Synonym


def print_metadata_summary(connection, limit: int) -> None:
    metadata = connection.Metadata
    print("\n== Metadata ==")
    for ru_name, label in METADATA_COLLECTIONS:
        try:
            collection = getattr(metadata, ru_name)
            count = collection.Count()
            print(f"{label}: {count}")
            for name, synonym in iter_metadata_items(collection, limit):
                print(f"  - {name}: {synonym}")
        except Exception as exc:
            print(f"{label}: ERROR: {exc}")


def execute_scalar_count(connection, table_name: str) -> int:
    query = connection.NewObject("Query")
    query.Text = f"""
ВЫБРАТЬ
    КОЛИЧЕСТВО(*) КАК CountValue
ИЗ
    {table_name}
"""
    selection = query.Execute().Select()
    if not selection.Next():
        return 0
    return int(selection.CountValue)


def print_counts(connection) -> None:
    print("\n== Object counts ==")
    for label, table_name in COUNT_QUERIES:
        try:
            count = execute_scalar_count(connection, table_name)
            print(f"{label}: {count}")
        except Exception as exc:
            print(f"{label}: unavailable ({exc})")


def write_report(args: argparse.Namespace, password: str) -> None:
    connection_string = build_connection_string(
        server=args.server,
        ref=args.ref,
        user=args.user,
        password=password,
    )

    print(f"Connecting to 1C: server={args.server}; ref={args.ref}; user={args.user}")
    connection = connect(connection_string)
    print("CONNECT OK")

    print_metadata_summary(connection, args.metadata_limit)
    print_counts(connection)


def main() -> int:
    configure_stdout()
    args = parse_args()

    if not args.user:
        args.user = input("1C user (buh20): ").strip()

    password = args.password
    if not password:
        password = getpass.getpass("1C password: ")

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", encoding="utf-8-sig", newline="\n") as output:
            with contextlib.redirect_stdout(output):
                write_report(args, password)
        print(f"Wrote report: {output_path}")
    else:
        write_report(args, password)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
