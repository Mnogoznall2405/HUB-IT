#!/usr/bin/env python3
"""
Перебор кандидатов PASSWORD_VAULT_KEY для старых записей vault.

ВАЖНО:
- Текущий ключ в .env — канонический Fernet (44 символа, 32 байта).
  Полный перебор 64^44 вариантов физически невозможен.
- Имеет смысл:
  1) --mode passphrase  — короткие фразы/пароли (derive SHA-256, как в backend)
  2) --mode fernet-random — случайные Fernet-ключи (демонстрация скорости/тщетности)
  3) --mode wordlist — файл с кандидатами

Примеры:
  python scripts/password_vault_bruteforce.py --mode passphrase --min-len 6 --max-len 10
  python scripts/password_vault_bruteforce.py --mode wordlist --wordlist candidates.txt
  python scripts/password_vault_bruteforce.py --mode fernet-random --workers 4 --max-attempts 5000000
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import itertools
import math
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAX_ATTEMPTS = 5_000_000
FERNET_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
DEFAULT_PASSPHRASE_CHARSET = (
    "abcdefghijklmnopqrstuvwxyz"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "0123456789"
    "_-!@#$%"
)


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
    if not value:
        return None
    try:
        decoded = base64.urlsafe_b64decode(value.encode("utf-8"))
        if len(decoded) == 32:
            return Fernet(value.encode("utf-8"))
    except Exception:
        pass
    digest = hashlib.sha256(value.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _key_matches_samples(raw: str, samples: tuple[str, ...]) -> bool:
    fernet = _build_fernet(raw)
    if fernet is None:
        return False
    for token in samples:
        try:
            fernet.decrypt(token.encode("utf-8"))
        except Exception:
            return False
    return True


def _load_fail_samples(database_url: str, *, sample_count: int) -> tuple[str, ...]:
    engine = create_engine(database_url)
    query = text(
        """
        SELECT password_enc
        FROM app.password_vault_entries
        WHERE is_archived = false
          AND password_enc IS NOT NULL
          AND password_enc != ''
        ORDER BY updated_at ASC
        LIMIT :limit
        """
    )
    with engine.connect() as conn:
        rows = conn.execute(query, {"limit": max(1, sample_count)}).fetchall()
    samples = tuple(str(row.password_enc or "").strip() for row in rows if str(row.password_enc or "").strip())
    if not samples:
        raise RuntimeError("No password_enc samples found in vault")
    return samples


def _describe_current_key() -> None:
    raw = os.getenv("PASSWORD_VAULT_KEY", "").strip()
    print("Current PASSWORD_VAULT_KEY format:")
    print(f"  length: {len(raw)}")
    if len(raw) == 44:
        print("  type: canonical Fernet key (urlsafe base64, 32 bytes)")
        print(f"  full random keyspace: 64^44 ~= 10^{44 * math.log10(64):.0f} combinations")
    else:
        print("  type: passphrase (SHA-256 derived Fernet key)")


def _estimate_passphrase_space(charset: str, min_len: int, max_len: int) -> int:
    total = 0
    n = len(charset)
    for length in range(min_len, max_len + 1):
        total += n**length
    return total


def _format_eta(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.1f}s"
    if seconds < 3600:
        return f"{seconds / 60:.1f}m"
    if seconds < 86400:
        return f"{seconds / 3600:.1f}h"
    if seconds < 86400 * 365:
        return f"{seconds / 86400:.1f}d"
    return f"{seconds / (86400 * 365):.1f}y"


def _try_wordlist(path: Path, samples: tuple[str, ...], *, progress_every: int) -> str | None:
    attempts = 0
    started = time.perf_counter()
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        candidate = line.strip()
        if not candidate or candidate.startswith("#"):
            continue
        attempts += 1
        if _key_matches_samples(candidate, samples):
            elapsed = time.perf_counter() - started
            print(f"\nFOUND after {attempts} attempts ({elapsed:.1f}s)")
            return candidate
        if attempts % progress_every == 0:
            rate = attempts / max(time.perf_counter() - started, 0.001)
            print(f"wordlist: {attempts} candidates, {rate:,.0f}/s")
    print(f"\nNot found in wordlist ({attempts} candidates)")
    return None


def _try_passphrase(
    samples: tuple[str, ...],
    *,
    charset: str,
    min_len: int,
    max_len: int,
    max_attempts: int,
    progress_every: int,
) -> str | None:
    total_space = _estimate_passphrase_space(charset, min_len, max_len)
    print(f"Passphrase space up to len {max_len}: {total_space:,} combinations")
    attempts = 0
    started = time.perf_counter()
    for length in range(min_len, max_len + 1):
        print(f"Trying length {length}...")
        for combo in itertools.product(charset, repeat=length):
            candidate = "".join(combo)
            attempts += 1
            if _key_matches_samples(candidate, samples):
                elapsed = time.perf_counter() - started
                print(f"\nFOUND: {candidate!r} after {attempts} attempts ({elapsed:.1f}s)")
                return candidate
            if attempts >= max_attempts:
                elapsed = time.perf_counter() - started
                rate = attempts / max(elapsed, 0.001)
                print(f"\nStopped at max-attempts={max_attempts:,} ({rate:,.0f}/s, elapsed {elapsed:.1f}s)")
                return None
            if attempts % progress_every == 0:
                elapsed = time.perf_counter() - started
                rate = attempts / max(elapsed, 0.001)
                remaining = max(total_space - attempts, 0)
                eta = remaining / max(rate, 1)
                print(
                    f"  {attempts:,} tried, {rate:,.0f}/s, "
                    f"ETA full space ~ {_format_eta(eta)}"
                )
    print(f"\nNot found ({attempts:,} passphrase candidates)")
    return None


def _random_fernet_key() -> str:
    import secrets

    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("utf-8")


def _fernet_random_batch(samples: tuple[str, ...], batch_size: int) -> tuple[int, str | None]:
    for _ in range(batch_size):
        raw = _random_fernet_key()
        if _key_matches_samples(raw, samples):
            return batch_size, raw
    return batch_size, None


def _try_fernet_random(
    samples: tuple[str, ...],
    *,
    workers: int,
    max_attempts: int,
    batch_size: int,
    progress_every: int,
    run_for_seconds: int = 0,
) -> str | None:
    print("Fernet-random mode: generating canonical 44-char keys")
    print("Full keyspace ~ 10^77 — даже при 1M keys/s это ~ 10^64 years")
    if run_for_seconds > 0:
        print(f"Time limit: {run_for_seconds}s ({run_for_seconds / 3600:.2f}h)")
    attempts = 0
    started = time.perf_counter()
    deadline = started + run_for_seconds if run_for_seconds > 0 else None
    attempt_limit = max_attempts if max_attempts > 0 else None
    last_progress = 0
    with ProcessPoolExecutor(max_workers=max(1, workers)) as pool:
        while True:
            if deadline is not None and time.perf_counter() >= deadline:
                break
            if attempt_limit is not None and attempts >= attempt_limit:
                break
            jobs = []
            for _ in range(workers):
                if deadline is not None and time.perf_counter() >= deadline:
                    break
                if attempt_limit is not None and attempts >= attempt_limit:
                    break
                if attempt_limit is not None:
                    current_batch = min(batch_size, attempt_limit - attempts)
                else:
                    current_batch = batch_size
                if current_batch <= 0:
                    break
                attempts += current_batch
                jobs.append(pool.submit(_fernet_random_batch, samples, current_batch))
            if not jobs:
                break
            for future in jobs:
                _, found = future.result()
                if found:
                    elapsed = time.perf_counter() - started
                    print(f"\nFOUND (incredible luck): {found}")
                    print(f"After ~{attempts:,} random attempts in {elapsed:.1f}s")
                    pool.shutdown(cancel_futures=True)
                    return found
            if attempts - last_progress >= progress_every:
                last_progress = attempts
                elapsed = time.perf_counter() - started
                rate = attempts / max(elapsed, 0.001)
                remaining = ""
                if deadline is not None:
                    left = max(deadline - time.perf_counter(), 0.0)
                    remaining = f", left {_format_eta(left)}"
                print(f"random: {attempts:,} keys, {rate:,.0f}/s{remaining}")
    elapsed = time.perf_counter() - started
    rate = attempts / max(elapsed, 0.001)
    print(f"\nNot found after {attempts:,} random Fernet keys ({rate:,.0f}/s, {elapsed:.1f}s)")
    return None


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Brute-force candidate PASSWORD_VAULT_KEY values")
    parser.add_argument(
        "--mode",
        choices=("passphrase", "fernet-random", "wordlist"),
        default="passphrase",
        help="Стратегия перебора",
    )
    parser.add_argument("--wordlist", default="", help="Файл кандидатов для mode=wordlist")
    parser.add_argument("--min-len", type=int, default=6, help="Мин. длина passphrase")
    parser.add_argument("--max-len", type=int, default=8, help="Макс. длина passphrase")
    parser.add_argument("--charset", default=DEFAULT_PASSPHRASE_CHARSET, help="Алфавит passphrase")
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    parser.add_argument("--batch-size", type=int, default=5000)
    parser.add_argument("--sample-entries", type=int, default=3, help="Сколько ciphertext проверять")
    parser.add_argument("--max-attempts", type=int, default=DEFAULT_MAX_ATTEMPTS, help="0 = без лимита (с --run-for)")
    parser.add_argument("--run-for", type=int, default=0, help="Секунд работы, напр. 3600 = 1 час")
    parser.add_argument("--progress-every", type=int, default=50_000)
    parser.add_argument("--output", default="", help="Сохранить найденный ключ в файл")
    return parser


def main(argv: list[str] | None = None) -> int:
    _configure_stdout()
    args = _build_parser().parse_args(argv)
    load_dotenv(ROOT / ".env")

    database_url = os.getenv("APP_DATABASE_URL", "").strip()
    if not database_url:
        print("APP_DATABASE_URL is not configured")
        return 1

    _describe_current_key()
    print()

    samples = _load_fail_samples(database_url, sample_count=args.sample_entries)
    print(f"Validation samples: {len(samples)} encrypted entries (oldest in vault)")
    print(f"Mode: {args.mode}")
    print()

    found: str | None = None
    if args.mode == "wordlist":
        path = Path(args.wordlist)
        if not path.is_file():
            print(f"Wordlist not found: {path}")
            return 1
        found = _try_wordlist(path, samples, progress_every=args.progress_every)
    elif args.mode == "passphrase":
        found = _try_passphrase(
            samples,
            charset=args.charset,
            min_len=args.min_len,
            max_len=args.max_len,
            max_attempts=args.max_attempts,
            progress_every=args.progress_every,
        )
    else:
        max_attempts = args.max_attempts
        if args.run_for > 0 and max_attempts == DEFAULT_MAX_ATTEMPTS:
            max_attempts = 0
        found = _try_fernet_random(
            samples,
            workers=args.workers,
            max_attempts=max_attempts,
            batch_size=args.batch_size,
            progress_every=args.progress_every,
            run_for_seconds=args.run_for,
        )

    if not found:
        print("\nКлюч не найден.")
        return 1

    if args.output:
        out = Path(args.output)
        out.write_text(found + "\n", encoding="utf-8")
        print(f"Saved to {out}")
    print("\nДальше добавьте в .env:")
    print("PASSWORD_VAULT_KEY_LEGACY=<найденный_ключ>")
    print("И проверьте: python scripts/password_vault_decrypt_audit.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
