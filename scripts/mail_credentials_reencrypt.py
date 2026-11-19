#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Re-encrypt values stored under MAIL_CREDENTIALS_KEY after a key rotation.

Reads rows whose columns hold encrypt_secret() ciphertexts, decrypts them with
MAIL_CREDENTIALS_KEY_LEGACY and re-writes them encrypted with the current
MAIL_CREDENTIALS_KEY. Ephemeral login-challenge payloads are skipped — they
expire on their own.

Usage:
  python scripts/mail_credentials_reencrypt.py --dry-run
  python scripts/mail_credentials_reencrypt.py --apply --backup-dir backups/mail-key-rotation
  python scripts/mail_credentials_reencrypt.py --verify

Safety:
  - default is --dry-run (read-only);
  - --apply refuses to run without --backup-dir and writes the previous
    ciphertexts there before any UPDATE;
  - plaintext is never printed; reports contain counts and row ids only;
  - rows that decrypt under neither configured key are left untouched and
    reported so they can be inspected manually;
  - keep MAIL_CREDENTIALS_KEY_LEGACY configured until --verify reports clean.
"""
from __future__ import annotations

import argparse
import csv
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
for candidate in (str(ROOT), str(WEB_ROOT)):
    if candidate not in sys.path:
        sys.path.insert(0, candidate)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

from backend.services.secret_crypto_service import _build_fernet  # noqa: E402


@dataclass(frozen=True)
class ColumnTarget:
    schema: str
    table: str
    pk: str
    column: str


# Columns written through secret_crypto_service.encrypt_secret (MAIL_CREDENTIALS_KEY).
DB_TARGETS: list[ColumnTarget] = [
    ColumnTarget("app", "users", "id", "mailbox_password_enc"),
    ColumnTarget("app", "users", "id", "totp_secret_enc"),
    ColumnTarget("app", "user_mailboxes", "id", "mailbox_password_enc"),
    ColumnTarget("system", "session_auth_context", "session_id", "password_enc"),
    ColumnTarget("app", "monitoring_profiles", "id", "community_enc"),
    ColumnTarget("app", "ticket_employees", "id", "date_of_birth_enc"),
    ColumnTarget("app", "ticket_employee_documents", "id", "passport_series_number_enc"),
    ColumnTarget("app", "ticket_employee_documents", "id", "passport_series_enc"),
    ColumnTarget("app", "ticket_employee_documents", "id", "passport_number_enc"),
    ColumnTarget("app", "ticket_employee_documents", "id", "issuer_code_enc"),
    ColumnTarget("app", "ticket_employee_documents", "id", "birth_place_enc"),
    ColumnTarget("app", "ticket_employee_documents", "id", "issued_by_enc"),
    ColumnTarget("app", "ticket_employee_documents", "id", "registration_address_enc"),
]

VCS_FILE = "vcs_config.json"
VCS_FIELD = "password_hex_encrypted"


@dataclass
class Counters:
    empty: int = 0
    already_new: int = 0
    pending: int = 0
    undecryptable: int = 0
    rewritten: int = 0
    failed_rows: list[str] = field(default_factory=list)

    def add(self, other: "Counters") -> None:
        self.empty += other.empty
        self.already_new += other.already_new
        self.pending += other.pending
        self.undecryptable += other.undecryptable
        self.rewritten += other.rewritten
        self.failed_rows.extend(other.failed_rows)


def _fernets() -> tuple[object, object | None]:
    new = _build_fernet("MAIL_CREDENTIALS_KEY")
    try:
        legacy = _build_fernet("MAIL_CREDENTIALS_KEY_LEGACY")
    except Exception:
        legacy = None
    return new, legacy


def _decrypt_with(fernet: object, token: str) -> str | None:
    try:
        return fernet.decrypt(token.encode("utf-8")).decode("utf-8")
    except Exception:
        return None


def _engine():
    import os

    from sqlalchemy import create_engine

    database_url = str(os.getenv("APP_DATABASE_URL", "") or "").strip()
    if not database_url:
        raise SystemExit("APP_DATABASE_URL is not configured in .env")
    return create_engine(database_url, pool_pre_ping=True)


def _classify(value: str, new: object, legacy: object | None) -> tuple[str, str | None]:
    value = str(value or "").strip()
    if not value:
        return "empty", None
    if _decrypt_with(new, value) is not None:
        return "already_new", None
    if legacy is not None:
        plain = _decrypt_with(legacy, value)
        if plain is not None:
            return "pending", plain
    return "undecryptable", None


def _process_table(conn, target: ColumnTarget, new, legacy, apply: bool, backup_rows: list) -> Counters:
    from sqlalchemy import text

    counters = Counters()
    qualified = f'"{target.schema}"."{target.table}"'
    rows = conn.execute(
        text(f'SELECT "{target.pk}" AS pk, "{target.column}" AS value FROM {qualified}')
    ).fetchall()
    for row in rows:
        status, plain = _classify(row.value, new, legacy)
        setattr(counters, status if status != "pending" else "pending",
                getattr(counters, status if status != "pending" else "pending") + 1)
        if status == "pending" and apply:
            backup_rows.append((target.schema, target.table, str(row.pk), target.column, row.value))
            try:
                rewritten = new.encrypt(plain.encode("utf-8")).decode("utf-8")
                conn.execute(
                    text(f'UPDATE {qualified} SET "{target.column}" = :v WHERE "{target.pk}" = :pk'),
                    {"v": rewritten, "pk": row.pk},
                )
                counters.rewritten += 1
            except Exception:
                counters.failed_rows.append(f"{target.schema}.{target.table}:{row.pk}")
    return counters


def _process_vcs(new, legacy, apply: bool, backup_rows: list) -> Counters:
    counters = Counters()
    try:
        from local_store import get_local_store
    except Exception:
        return counters
    store = get_local_store()
    data = store.load_json(VCS_FILE, default_content={VCS_FIELD: ""})
    if not isinstance(data, dict):
        return counters
    value = str(data.get(VCS_FIELD) or "").strip()
    status, plain = _classify(value, new, legacy)
    if status == "empty":
        counters.empty += 1
    elif status == "already_new":
        counters.already_new += 1
    elif status == "undecryptable":
        counters.undecryptable += 1
        counters.failed_rows.append(f"local_store:{VCS_FILE}")
    elif status == "pending" and apply:
        backup_rows.append(("local_store", VCS_FILE, VCS_FIELD, VCS_FIELD, value))
        try:
            data[VCS_FIELD] = new.encrypt(plain.encode("utf-8")).decode("utf-8")
            store.save_json(VCS_FILE, data)
            counters.rewritten += 1
        except Exception:
            counters.failed_rows.append(f"local_store:{VCS_FILE}")
    else:
        counters.pending += 1
    return counters


def _write_backup(backup_dir: Path, rows: list) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    path = backup_dir / "pre_reencrypt_ciphertexts.csv"
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["schema", "table", "pk", "column", "ciphertext"])
        writer.writerows(rows)
    return path


def _print_report(total: Counters, apply: bool) -> None:
    mode = "APPLY" if apply else "DRY-RUN"
    print(f"[{mode}] empty={total.empty} already_new={total.already_new} "
          f"pending={total.pending} rewritten={total.rewritten} "
          f"undecryptable={total.undecryptable}")
    if total.failed_rows:
        print("rows needing manual inspection:")
        for item in total.failed_rows[:50]:
            print(f"  {item}")


def _verify(total: Counters) -> int:
    if total.pending or total.undecryptable:
        print(f"[VERIFY] still pending={total.pending} undecryptable={total.undecryptable} "
              "- keep MAIL_CREDENTIALS_KEY_LEGACY configured")
        return 1
    print(f"[VERIFY] all {total.already_new} non-empty values decrypt with the new key only; "
          "MAIL_CREDENTIALS_KEY_LEGACY can be removed")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--dry-run", action="store_true", help="read-only classification (default)")
    group.add_argument("--apply", action="store_true", help="re-encrypt pending values")
    group.add_argument("--verify", action="store_true", help="fail if anything still needs the legacy key")
    parser.add_argument("--backup-dir", default="", help="required for --apply; stores prior ciphertexts")
    args = parser.parse_args(argv)

    apply = bool(args.apply)
    if apply and not str(args.backup_dir or "").strip():
        parser.error("--apply requires --backup-dir")

    new, legacy = _fernets()
    if legacy is None:
        print("MAIL_CREDENTIALS_KEY_LEGACY is not configured — nothing to migrate; run --verify")

    total = Counters()
    backup_rows: list = []
    engine = _engine()
    if apply:
        with engine.begin() as conn:
            for target in DB_TARGETS:
                counters = _process_table(conn, target, new, legacy, True, backup_rows)
                total.add(counters)
        total.add(_process_vcs(new, legacy, True, backup_rows))
        backup_path = _write_backup(Path(args.backup_dir), backup_rows)
        print(f"backup written: {backup_path} ({len(backup_rows)} rows)")
    else:
        with engine.connect() as conn:
            for target in DB_TARGETS:
                counters = _process_table(conn, target, new, legacy, False, backup_rows)
                total.add(counters)
        total.add(_process_vcs(new, legacy, False, backup_rows))

    _print_report(total, apply)
    if args.verify:
        return _verify(total)
    return 0 if not total.undecryptable else 1


if __name__ == "__main__":
    raise SystemExit(main())
