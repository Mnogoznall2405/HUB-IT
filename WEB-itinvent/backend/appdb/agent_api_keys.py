"""Shared store for per-agent API keys (HIGH-03).

``app.agent_api_keys`` is the authoritative bound-key map for the agent fleet:
scan_server enrolls machines and queues ``rotate_key`` tasks; backend,
inventory_server and scan_server authenticate bound keys by SHA-256 lookup.

Keys are stored encrypted with ``MAIL_CREDENTIALS_KEY`` so a database dump does
not leak usable credentials, plus a plaintext SHA-256 index for O(1) auth
lookups. Positive lookups are cached briefly per process — the store updates
rarely while agent requests hit it constantly.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
import threading
import time
from typing import Any, Dict, Optional

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

logger = logging.getLogger(__name__)

TABLE = "agent_api_keys"
POSITIVE_CACHE_TTL_SEC = 60.0
NEGATIVE_CACHE_TTL_SEC = 15.0

_lookup_cache: Dict[str, tuple[str, float]] = {}
_lookup_lock = threading.Lock()


class AgentKeyLookupUnavailableError(RuntimeError):
    """The key store could not verify credentials; this is not an unknown key."""


def key_sha256(key: str) -> str:
    return hashlib.sha256(str(key or "").encode("utf-8", errors="ignore")).hexdigest()


def _schema_prefix(engine_or_conn) -> str:
    return "app." if engine_or_conn.dialect.name == "postgresql" else ""


def _table(engine_or_conn) -> str:
    return f"{_schema_prefix(engine_or_conn)}{TABLE}"


def _encrypt(value: str) -> str:
    from backend.services.secret_crypto_service import encrypt_secret

    return encrypt_secret(value)


def _decrypt(value: str) -> str:
    from backend.services.secret_crypto_service import decrypt_secret

    return decrypt_secret(value)


def _normalize_name(name: str) -> str:
    return str(name or "").strip()


def _cache_get(sha: str) -> Optional[str]:
    now = time.monotonic()
    with _lookup_lock:
        entry = _lookup_cache.get(sha)
        if not entry:
            return None
        name, expires = entry
        if expires < now:
            _lookup_cache.pop(sha, None)
            return None
        return name


def _cache_put(sha: str, name: str) -> None:
    ttl = POSITIVE_CACHE_TTL_SEC if name else NEGATIVE_CACHE_TTL_SEC
    with _lookup_lock:
        _lookup_cache[sha] = (name, time.monotonic() + ttl)


def clear_lookup_cache() -> None:
    with _lookup_lock:
        _lookup_cache.clear()


def lookup_name_by_key(
    engine: Engine, candidate: str, *, raise_on_error: bool = False
) -> str:
    """The agent a bound key belongs to; ``""`` for ring/invalid/unknown keys.

    Returns the ``agent_id`` from ``app.agent_api_keys`` whose scan or inventory
    key SHA-256 matches ``candidate``. Table-missing / DB errors degrade to ""
    (caller falls back to ring/401) unless ``raise_on_error`` is requested.
    Strict callers can return a retryable error without accepting the key.
    """
    token = str(candidate or "").strip()
    if not token:
        return ""
    sha = key_sha256(token)
    cached = _cache_get(sha)
    if cached is not None:
        return cached
    table = _table(engine)
    try:
        with engine.connect() as conn:
            row = conn.execute(
                sa.text(
                    f"SELECT agent_id FROM {table} "
                    "WHERE scan_key_sha256 = :s OR inv_key_sha256 = :s LIMIT 1"
                ),
                {"s": sha},
            ).first()
    except Exception as exc:
        logger.debug("agent_api_keys lookup unavailable: %s", type(exc).__name__)
        if raise_on_error:
            raise AgentKeyLookupUnavailableError("Agent key store unavailable") from exc
        return ""
    name = str(row[0]) if row else ""
    _cache_put(sha, name)
    return name


def get_keypair(engine: Engine, name: str) -> Optional[Dict[str, str]]:
    """Decrypted ``{scan_api_key, itinv_api_key}`` for a bound agent, or None."""
    normalized = _normalize_name(name)
    if not normalized:
        return None
    table = _table(engine)
    try:
        with engine.connect() as conn:
            row = conn.execute(
                sa.text(
                    f"SELECT scan_key_enc, inv_key_enc FROM {table} WHERE agent_id = :n"
                ),
                {"n": normalized},
            ).first()
    except Exception as exc:
        logger.debug("agent_api_keys get unavailable: %s", type(exc).__name__)
        return None
    if not row:
        return None
    out: Dict[str, str] = {}
    try:
        if row[0]:
            out["scan_api_key"] = _decrypt(row[0])
        if row[1]:
            out["itinv_api_key"] = _decrypt(row[1])
    except Exception:
        logger.warning("agent_api_keys decrypt failed for agent_id=%s", normalized)
        return None
    return out


def is_bound(engine: Engine, name: str) -> bool:
    """True when the agent already has a row in the bound-key store."""
    normalized = _normalize_name(name)
    if not normalized:
        return False
    table = _table(engine)
    try:
        with engine.connect() as conn:
            row = conn.execute(
                sa.text(f"SELECT 1 FROM {table} WHERE agent_id = :n LIMIT 1"),
                {"n": normalized},
            ).first()
    except Exception:
        return False
    return row is not None


def _insert_stmt(table: str, backend: str, values: Dict[str, Any]):
    """INSERT … ON CONFLICT DO NOTHING (postgres) / INSERT OR IGNORE (sqlite)."""
    if backend == "postgresql":
        cols = ", ".join(values)
        params = ", ".join(f":{c}" for c in values)
        stmt = sa.text(
            f"INSERT INTO {table} ({cols}) VALUES ({params}) "
            "ON CONFLICT (agent_id) DO NOTHING RETURNING agent_id"
        )
        return stmt, values, True
    cols = ", ".join(values)
    params = ", ".join(f":{c}" for c in values)
    return sa.text(f"INSERT OR IGNORE INTO {table} ({cols}) VALUES ({params})"), values, False


def upsert_keypair(
    engine: Engine,
    name: str,
    *,
    hostname: str = "",
    scan_key: str = "",
    inv_key: str = "",
    source: str = "auto",
    enroll_ip: str = "",
) -> bool:
    """Insert a bound-key row if ``name`` is absent; existing rows are kept.

    Returns True when a new row was inserted (caller may then queue a
    ``rotate_key`` task with the plaintext it still holds).
    """
    normalized = _normalize_name(name)
    if not normalized:
        return False
    now = int(time.time())
    values: Dict[str, Any] = {
        "agent_id": normalized,
        "hostname": str(hostname or "").strip(),
        "scan_key_sha256": key_sha256(scan_key) if scan_key else None,
        "scan_key_enc": _encrypt(scan_key) if scan_key else None,
        "inv_key_sha256": key_sha256(inv_key) if inv_key else None,
        "inv_key_enc": _encrypt(inv_key) if inv_key else None,
        "source": str(source or "auto").strip() or "auto",
        "created_at": now,
        "updated_at": now,
    }
    if _has_column(engine, "enroll_ip"):
        values["enroll_ip"] = str(enroll_ip or "").strip()
    table = _table(engine)
    try:
        with engine.begin() as conn:
            stmt, params, uses_returning = _insert_stmt(table, engine.dialect.name, values)
            result = conn.execute(stmt, params)
            # psycopg reports rowcount unreliably for ON CONFLICT DO NOTHING —
            # RETURNING is the deterministic inserted-vs-skipped signal.
            inserted = (result.first() is not None) if uses_returning else (result.rowcount or 0) > 0
    except Exception:
        logger.warning("agent_api_keys upsert failed for agent_id=%s", normalized, exc_info=True)
        return False
    if inserted:
        # Fresh key material must not hit a stale negative cache entry.
        for key in (scan_key, inv_key):
            if key:
                _cache_put(key_sha256(key), normalized)
    return inserted


_COLUMN_CACHE: Dict[tuple[int, str], bool] = {}


def _has_column(engine: Engine, column: str) -> bool:
    """True when ``app.agent_api_keys.<column>`` exists; cached per engine."""
    key = (id(engine), column)
    cached = _COLUMN_CACHE.get(key)
    if cached is not None:
        return cached
    table = _table(engine)
    try:
        with engine.connect() as conn:
            conn.execute(sa.text(f"SELECT {column} FROM {table} WHERE 1=0"))
        present = True
    except Exception:
        present = False
    _COLUMN_CACHE[key] = present
    return present


def enroll_guard_supported(engine: Engine) -> bool:
    """True when the enrollment-guard columns (migration 0173) exist.

    Code may run before the migration is applied: callers must fall back to
    the pre-guard behaviour instead of looping on a missing ``enroll_ip``.
    """
    return _has_column(engine, "enroll_ip") and _has_column(engine, "contested_count")


def get_row(engine: Engine, name: str) -> Optional[Dict[str, Any]]:
    """Enrollment state for ``name``: ip pinning and contested counters."""
    normalized = _normalize_name(name)
    if not normalized:
        return None
    table = _table(engine)
    guarded = enroll_guard_supported(engine)
    select_cols = (
        "agent_id, hostname, enroll_ip, contested_count, "
        "(scan_key_enc IS NOT NULL AND scan_key_enc <> '') AS has_scan_key"
        if guarded
        else "agent_id, hostname, '' AS enroll_ip, 0 AS contested_count, "
        "(scan_key_enc IS NOT NULL AND scan_key_enc <> '') AS has_scan_key"
    )
    try:
        with engine.connect() as conn:
            row = conn.execute(
                sa.text(f"SELECT {select_cols} FROM {table} WHERE agent_id = :n"),
                {"n": normalized},
            ).first()
    except Exception:
        return None
    if not row:
        return None
    return {
        "agent_id": str(row[0] or ""),
        "hostname": str(row[1] or ""),
        "enroll_ip": str(row[2] or ""),
        "contested_count": int(row[3] or 0),
        "has_keys": bool(row[4]),
    }


def update_enroll_ip(engine: Engine, name: str, enroll_ip: str) -> None:
    normalized = _normalize_name(name)
    if not normalized:
        return
    table = _table(engine)
    try:
        with engine.begin() as conn:
            conn.execute(
                sa.text(f"UPDATE {table} SET enroll_ip=:ip, updated_at=:ts WHERE agent_id=:n"),
                {"ip": str(enroll_ip or "").strip(), "ts": int(time.time()), "n": normalized},
            )
    except Exception:
        logger.debug("agent_api_keys enroll_ip update failed for agent_id=%s", normalized)


def remint_keypair(
    engine: Engine,
    name: str,
    *,
    hostname: str = "",
) -> Optional[Dict[str, str]]:
    """Replace the bound pair in place; stolen keys die immediately.

    Old key SHAs are invalidated in the auth lookup cache and
    ``contested_count`` is incremented so callers can cap automatic re-mints.
    Returns the new plaintext pair for the rotate payload, or None on failure.
    """
    normalized = _normalize_name(name)
    if not normalized:
        return None
    table = _table(engine)
    now = int(time.time())
    scan_key = generate_key()
    try:
        with engine.begin() as conn:
            guarded = _has_column(engine, "contested_count")
            old = conn.execute(
                sa.text(
                    f"SELECT scan_key_sha256, inv_key_sha256, "
                    f"{'contested_count' if guarded else '0 AS contested_count'}, "
                    f"(inv_key_enc IS NOT NULL AND inv_key_enc <> '') AS had_inv "
                    f"FROM {table} WHERE agent_id=:n"
                ),
                {"n": normalized},
            ).first()
            if not old:
                return None
            # Scan-only machines keep no inventory key; do not grant one on remint.
            inv_key = generate_key() if bool(old[3]) else ""
            counter_clause = "contested_count=COALESCE(contested_count,0)+1, " if guarded else ""
            conn.execute(
                sa.text(
                    # ``enroll_ip`` is deliberately NOT updated here: a contested
                    # re-mint may be triggered by an impersonator's request, and
                    # re-pinning to that IP would deliver fresh keys to them.
                    f"UPDATE {table} SET scan_key_sha256=:ss, scan_key_enc=:se, "
                    f"inv_key_sha256=:is_, inv_key_enc=:ie, "
                    f"{counter_clause}updated_at=:ts "
                    f"WHERE agent_id=:n"
                ),
                {
                    "ss": key_sha256(scan_key),
                    "se": _encrypt(scan_key),
                    "is_": key_sha256(inv_key) if inv_key else None,
                    "ie": _encrypt(inv_key) if inv_key else None,
                    "ts": now,
                    "n": normalized,
                },
            )
    except Exception:
        logger.warning("agent_api_keys remint failed for agent_id=%s", normalized, exc_info=True)
        return None
    for old_sha in (str(old[0] or ""), str(old[1] or "")):
        if old_sha:
            _cache_put(old_sha, "")
    _cache_put(key_sha256(scan_key), normalized)
    if inv_key:
        _cache_put(key_sha256(inv_key), normalized)
    return {"scan_api_key": scan_key, "itinv_api_key": inv_key}


def generate_key() -> str:
    return secrets.token_urlsafe(32)
