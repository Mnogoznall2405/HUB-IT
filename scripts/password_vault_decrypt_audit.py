#!/usr/bin/env python3
"""
Подробный аудит расшифровки Password Vault.

Пробует все известные ключи (текущий .env, LEGACY, бэкапы, файлы из --env-file / --key)
и показывает, какие записи читаются и каким ключом.

Примеры:
  python scripts/password_vault_decrypt_audit.py
  python scripts/password_vault_decrypt_audit.py --verbose
  python scripts/password_vault_decrypt_audit.py --key "old-server:YOUR_OLD_KEY_HERE"
  python scripts/password_vault_decrypt_audit.py --env-file D:\\backup\\.env --verbose --only-fail
  python scripts/password_vault_decrypt_audit.py --export-csv vault_decrypted.csv --confirm-export
  python scripts/password_vault_decrypt_audit.py --reencrypt --apply
"""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import os
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BACKUP_ENV_DIR = Path(r"C:\Backups\hub-it\env")
ENV_KEY_NAMES = (
    "PASSWORD_VAULT_KEY",
    "PASSWORD_VAULT_KEY_LEGACY",
    "MAIL_CREDENTIALS_KEY",
)


@dataclass(frozen=True)
class VaultKey:
    label: str
    fingerprint: str
    fernet: Any


@dataclass
class VaultEntry:
    id: str
    login: str
    group: str
    description: str
    is_archived: bool
    created_at: str
    updated_at: str
    password_enc: str


@dataclass
class DecryptOutcome:
    entry: VaultEntry
    ok: bool
    key_label: str | None = None
    password: str | None = None
    error: str | None = None


def _configure_stdout() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def _build_fernet(raw: str):
    from cryptography.fernet import Fernet

    value = str(raw or "").strip()
    if not value or value == "change_me_to_secure_random_value":
        return None
    try:
        decoded = base64.urlsafe_b64decode(value.encode("utf-8"))
        if len(decoded) == 32:
            return Fernet(value.encode("utf-8"))
    except Exception:
        pass
    digest = hashlib.sha256(value.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _fingerprint(raw: str) -> str:
    return hashlib.sha256(str(raw or "").strip().encode("utf-8")).hexdigest()[:16]


def _parse_env_file(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    if not path.is_file():
        return result
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        if name:
            result[name] = value
    return result


def _add_key(
    keys: dict[str, VaultKey],
    *,
    label: str,
    raw: str,
) -> None:
    fernet = _build_fernet(raw)
    if fernet is None:
        return
    fp = _fingerprint(raw)
    if fp in keys:
        return
    keys[fp] = VaultKey(label=label, fingerprint=fp, fernet=fernet)


def _load_keys_from_env_file(path: Path, *, prefix: str, include_mail: bool) -> list[tuple[str, str]]:
    parsed = _parse_env_file(path)
    found: list[tuple[str, str]] = []
    names = list(ENV_KEY_NAMES) if include_mail else [name for name in ENV_KEY_NAMES if name != "MAIL_CREDENTIALS_KEY"]
    for name in names:
        value = parsed.get(name, "")
        if value:
            found.append((f"{prefix}:{name}", value))
    return found


def _collect_keys(args: argparse.Namespace) -> list[VaultKey]:
    keys: dict[str, VaultKey] = {}

    for env_name in ENV_KEY_NAMES:
        if env_name == "MAIL_CREDENTIALS_KEY" and not args.include_mail_key:
            continue
        _add_key(keys, label=f"env:{env_name}", raw=os.getenv(env_name, ""))

    for env_path in args.env_file:
        path = Path(env_path)
        for label, raw in _load_keys_from_env_file(path, prefix=path.name, include_mail=args.include_mail_key):
            _add_key(keys, label=label, raw=raw)

    scan_dirs = list(args.scan_dir or [])
    if args.scan_default_backups and DEFAULT_BACKUP_ENV_DIR.is_dir():
        scan_dirs.append(DEFAULT_BACKUP_ENV_DIR)
    for scan_dir in scan_dirs:
        directory = Path(scan_dir)
        if not directory.is_dir():
            continue
        for path in sorted(directory.rglob("*")):
            if not path.is_file():
                continue
            if path.suffix.lower() not in {".env", ".bak", ""} and "env" not in path.name.lower():
                continue
            for label, raw in _load_keys_from_env_file(path, prefix=str(path), include_mail=args.include_mail_key):
                _add_key(keys, label=label, raw=raw)

    for idx, raw in enumerate(args.key or [], start=1):
        label = f"cli:key#{idx}"
        if ":" in raw:
            maybe_label, _, maybe_value = raw.partition(":")
            if maybe_value.strip():
                label = maybe_label.strip() or label
                raw = maybe_value.strip()
        _add_key(keys, label=label, raw=raw)

    for key_file in args.key_file or []:
        path = Path(key_file)
        if not path.is_file():
            continue
        for line_no, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
            value = line.strip()
            if not value or value.startswith("#"):
                continue
            _add_key(keys, label=f"{path.name}:{line_no}", raw=value)

    return list(keys.values())


def _fetch_entries(database_url: str, *, include_archived: bool) -> list[VaultEntry]:
    archived_clause = "" if include_archived else "AND is_archived = false"
    query = text(
        f"""
        SELECT id, login, group_name, description, is_archived,
               created_at, updated_at, password_enc
        FROM app.password_vault_entries
        WHERE password_enc IS NOT NULL
          AND password_enc != ''
          {archived_clause}
        ORDER BY group_name ASC, login ASC, updated_at DESC
        """
    )
    engine = create_engine(database_url)
    with engine.connect() as conn:
        rows = conn.execute(query).fetchall()
    return [
        VaultEntry(
            id=str(row.id or ""),
            login=str(row.login or ""),
            group=str(row.group_name or ""),
            description=str(row.description or ""),
            is_archived=bool(row.is_archived),
            created_at=str(row.created_at or ""),
            updated_at=str(row.updated_at or ""),
            password_enc=str(row.password_enc or "").strip(),
        )
        for row in rows
    ]


def _try_decrypt(password_enc: str, keys: list[VaultKey]) -> tuple[str | None, str | None, str | None]:
    last_error = None
    for key in keys:
        try:
            plain = key.fernet.decrypt(password_enc.encode("utf-8")).decode("utf-8")
            return key.label, plain, None
        except Exception as exc:
            last_error = str(exc)
            continue
    return None, None, last_error or "no matching key"


def _audit_entries(entries: list[VaultEntry], keys: list[VaultKey]) -> list[DecryptOutcome]:
    outcomes: list[DecryptOutcome] = []
    for entry in entries:
        key_label, password, error = _try_decrypt(entry.password_enc, keys)
        outcomes.append(
            DecryptOutcome(
                entry=entry,
                ok=password is not None,
                key_label=key_label,
                password=password,
                error=error,
            )
        )
    return outcomes


def _print_summary(outcomes: list[DecryptOutcome], keys: list[VaultKey]) -> None:
    ok = [item for item in outcomes if item.ok]
    fail = [item for item in outcomes if not item.ok]

    print("=== Password Vault decrypt audit ===")
    print(f"Entries checked: {len(outcomes)}")
    print(f"Decrypt OK:      {len(ok)}")
    print(f"Decrypt FAIL:    {len(fail)}")
    print()
    print("Keys loaded:")
    for key in keys:
        print(f"  - {key.label} (fp={key.fingerprint})")
    print()

    if ok:
        by_key = Counter(item.key_label for item in ok)
        print("OK by key:")
        for label, count in by_key.most_common():
            print(f"  {label}: {count}")
        print()

        by_group = Counter(item.entry.group for item in ok)
        print("OK by group:")
        for group, count in by_group.most_common():
            print(f"  {group}: {count}")
        print()

    if fail:
        by_group = Counter(item.entry.group for item in fail)
        print("FAIL by group:")
        for group, count in by_group.most_common():
            print(f"  {group}: {count}")
        print()


def _print_details(outcomes: list[DecryptOutcome], *, only_fail: bool, only_ok: bool, group_filter: str) -> None:
    group_filter = group_filter.strip().lower()
    for item in outcomes:
        if only_fail and item.ok:
            continue
        if only_ok and not item.ok:
            continue
        if group_filter and item.entry.group.lower() != group_filter:
            continue
        status = "OK" if item.ok else "FAIL"
        archived = " [archived]" if item.entry.is_archived else ""
        line = f"{status}  {item.entry.group}/{item.entry.login}{archived}"
        if item.ok:
            line += f"  key={item.key_label}  updated={item.entry.updated_at}"
        else:
            line += f"  updated={item.entry.updated_at}  error={item.error}"
        print(line)


def _export_csv(path: Path, outcomes: list[DecryptOutcome]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "status",
                "id",
                "group",
                "login",
                "description",
                "is_archived",
                "created_at",
                "updated_at",
                "key_label",
                "password",
                "error",
            ]
        )
        for item in outcomes:
            writer.writerow(
                [
                    "ok" if item.ok else "fail",
                    item.entry.id,
                    item.entry.group,
                    item.entry.login,
                    item.entry.description,
                    int(item.entry.is_archived),
                    item.entry.created_at,
                    item.entry.updated_at,
                    item.key_label or "",
                    item.password or "",
                    item.error or "",
                ]
            )


def _export_json(path: Path, outcomes: list[DecryptOutcome], keys: list[VaultKey]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "summary": {
            "total": len(outcomes),
            "ok": sum(1 for item in outcomes if item.ok),
            "fail": sum(1 for item in outcomes if not item.ok),
        },
        "keys": [{"label": key.label, "fingerprint": key.fingerprint} for key in keys],
        "items": [
            {
                "status": "ok" if item.ok else "fail",
                "id": item.entry.id,
                "group": item.entry.group,
                "login": item.entry.login,
                "description": item.entry.description,
                "is_archived": item.entry.is_archived,
                "created_at": item.entry.created_at,
                "updated_at": item.entry.updated_at,
                "key_label": item.key_label,
                "password": item.password,
                "error": item.error,
            }
            for item in outcomes
        ],
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _reencrypt_entries(
    database_url: str,
    outcomes: list[DecryptOutcome],
    *,
    apply: bool,
) -> int:
    sys.path.insert(0, str(ROOT / "WEB-itinvent"))
    from backend.services.secret_crypto_service import encrypt_password_vault_secret

    candidates = [
        item
        for item in outcomes
        if item.ok and item.password is not None and item.key_label != "env:PASSWORD_VAULT_KEY"
    ]
    if not candidates:
        print("Reencrypt: nothing to migrate (all OK entries already use current PASSWORD_VAULT_KEY).")
        return 0

    print(f"Reencrypt candidates: {len(candidates)}")
    if not apply:
        print("Dry-run only. Pass --apply to write new ciphertext with current PASSWORD_VAULT_KEY.")
        for item in candidates[:20]:
            print(f"  would reencrypt {item.entry.group}/{item.entry.login} ({item.key_label})")
        if len(candidates) > 20:
            print(f"  ... and {len(candidates) - 20} more")
        return 0

    engine = create_engine(database_url)
    updated = 0
    with engine.begin() as conn:
        for item in candidates:
            new_enc = encrypt_password_vault_secret(item.password)
            conn.execute(
                text(
                    """
                    UPDATE app.password_vault_entries
                    SET password_enc = :password_enc,
                        updated_at = NOW()
                    WHERE id = :entry_id
                    """
                ),
                {"password_enc": new_enc, "entry_id": item.entry.id},
            )
            updated += 1
    print(f"Reencrypted entries: {updated}")
    return updated


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Подробный аудит расшифровки Password Vault")
    parser.add_argument("--env-file", action="append", default=[], help="Доп. .env/.bak с ключами")
    parser.add_argument("--key", action="append", default=[], help='Ключ: "label:VALUE" или просто VALUE')
    parser.add_argument("--key-file", action="append", default=[], help="Файл со списком ключей-кандидатов")
    parser.add_argument("--scan-dir", action="append", default=[], help="Каталог для поиска .env/.bak")
    parser.add_argument(
        "--no-scan-default-backups",
        action="store_true",
        help="Не сканировать C:\\Backups\\hub-it\\env",
    )
    parser.add_argument(
        "--include-mail-key",
        action="store_true",
        help="Также пробовать MAIL_CREDENTIALS_KEY",
    )
    parser.add_argument("--include-archived", action="store_true", help="Включить архивные записи")
    parser.add_argument("-v", "--verbose", action="store_true", help="Подробный построчный отчёт")
    parser.add_argument("--only-fail", action="store_true", help="В verbose показывать только FAIL")
    parser.add_argument("--only-ok", action="store_true", help="В verbose показывать только OK")
    parser.add_argument("--group", default="", help="Фильтр по group_name")
    parser.add_argument("--export-csv", default="", help="Экспорт результата в CSV")
    parser.add_argument("--export-json", default="", help="Экспорт результата в JSON")
    parser.add_argument(
        "--confirm-export",
        action="store_true",
        help="Разрешить экспорт plaintext-паролей в файл",
    )
    parser.add_argument(
        "--reencrypt",
        action="store_true",
        help="Перешифровать legacy-записи текущим PASSWORD_VAULT_KEY",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Применить --reencrypt (без этого только dry-run)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    _configure_stdout()
    parser = _build_parser()
    args = parser.parse_args(argv)
    args.scan_default_backups = not args.no_scan_default_backups

    load_dotenv(ROOT / ".env")

    database_url = os.getenv("APP_DATABASE_URL", "").strip()
    if not database_url:
        print("APP_DATABASE_URL is not configured in .env")
        return 1

    keys = _collect_keys(args)
    if not keys:
        print("No encryption keys found. Use .env, --key, --env-file or --key-file.")
        return 1

    entries = _fetch_entries(database_url, include_archived=args.include_archived)
    outcomes = _audit_entries(entries, keys)

    _print_summary(outcomes, keys)
    if args.verbose:
        print("--- Details ---")
        _print_details(
            outcomes,
            only_fail=args.only_fail,
            only_ok=args.only_ok,
            group_filter=args.group,
        )

    if args.export_csv or args.export_json:
        if not args.confirm_export:
            print("Export skipped: pass --confirm-export to write plaintext passwords to disk.")
        else:
            if args.export_csv:
                csv_path = Path(args.export_csv)
                _export_csv(csv_path, outcomes)
                print(f"CSV written: {csv_path}")
            if args.export_json:
                json_path = Path(args.export_json)
                _export_json(json_path, outcomes, keys)
                print(f"JSON written: {json_path}")

    if args.reencrypt:
        _reencrypt_entries(database_url, outcomes, apply=args.apply)

    failed = sum(1 for item in outcomes if not item.ok)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
