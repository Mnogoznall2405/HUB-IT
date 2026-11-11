"""Привязка inventory-хостов (ПК агента) к карточкам ITINVENT.

Связь «ПК (MAC) = карточка (db_id, inv_no)» хранится в inventory_host_sql_contexts.
Новый ПК привязывается один раз: по MAC основного адаптера, затем по MAC прочих
физических адаптеров из отчёта, затем по имени хоста (только при единственной свободной
карточке и только если все БД доступны). Поля карточки (филиал, помещение, сотрудник,
модель, IP) обновляются пакетно: одна выгрузка карточек на БД за цикл и сопоставление в
памяти. Списки инвентаризации читают только сохранённое и в ITINVENT не ходят.

Фоновый воркер (внутри backend, без отдельного PM2-процесса):
- быстрый тик (INVENTORY_BINDING_FAST_TICK_SEC, по умолчанию 120 с) привязывает только хосты,
  которые воркер ещё не проверял;
- полный цикл (INVENTORY_BINDING_INTERVAL_SEC, по умолчанию 900 с) дополнительно обновляет поля
  и, только при INVENTORY_BINDING_UNBIND_ENABLED=1, снимает привязки исчезнувших карточек.
Параллельные запуски в нескольких процессах исключаются advisory-lock PostgreSQL.
"""

from __future__ import annotations

import hashlib
import logging
import os
import random
import re
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

from backend.utils.inv_no import normalize_inv_no_token

logger = logging.getLogger(__name__)

UNASSIGNED_BRANCH_LABEL = "Без привязки"
EMPTY_BRANCH_LABEL = "Без филиала"

_INVALID_MACS = frozenset({"000000000000", "FFFFFFFFFFFF"})
_MAC_CANDIDATE_RE = re.compile(
    r"(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}"
    r"|[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}"
    r"|(?<![0-9A-Fa-f])[0-9A-Fa-f]{12}(?![0-9A-Fa-f])"
)
_HOST_MAC_RE = re.compile(r"[0-9A-F]{12}")
_LOCK_SEED = b"hub-inventory-binding"
_LOCAL_LOCK = threading.Lock()

# Имя поля в обновлении -> значение используется стором (см. _CONTEXT_BATCH_FIELDS в inventory_store).
_CONTEXT_FIELDS = ("branch_no", "branch_name", "location_name", "employee_name", "model_name", "ip_address")


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return max(minimum, value)


def binding_background_enabled() -> bool:
    """INVENTORY_BINDING_BACKGROUND_ENABLED (по умолчанию 1)."""
    return _env_flag("INVENTORY_BINDING_BACKGROUND_ENABLED", True)


def binding_unbind_enabled() -> bool:
    """INVENTORY_BINDING_UNBIND_ENABLED (по умолчанию 0): без него исчезнувшие карточки только считаются."""
    return _env_flag("INVENTORY_BINDING_UNBIND_ENABLED", False)


def binding_interval_sec() -> int:
    """INVENTORY_BINDING_INTERVAL_SEC (по умолчанию 900, минимум 60)."""
    return _env_int("INVENTORY_BINDING_INTERVAL_SEC", 900, 60)


def binding_fast_tick_sec() -> int:
    """INVENTORY_BINDING_FAST_TICK_SEC (по умолчанию 120, минимум 30)."""
    return _env_int("INVENTORY_BINDING_FAST_TICK_SEC", 120, 30)


def binding_batch_size() -> int:
    """INVENTORY_BINDING_BATCH_SIZE (по умолчанию 200): строк в одной транзакции записи."""
    return _env_int("INVENTORY_BINDING_BATCH_SIZE", 200, 10)


def binding_max_binds_per_cycle() -> int:
    """INVENTORY_BINDING_MAX_BINDS_PER_CYCLE (по умолчанию 500): ограничение первого прогона."""
    return _env_int("INVENTORY_BINDING_MAX_BINDS_PER_CYCLE", 500, 1)


# --- Чистая логика: нормализация и сопоставление -------------------------------------------


def _text(value: Any) -> str:
    return str(value or "").replace("\x00", "").strip()


def normalize_mac(value: Any) -> str:
    """12 hex-знаков в верхнем регистре или пустая строка.

    Восьмибайтные адреса туннелей (16 знаков) и нулевой/широковещательный MAC отбрасываются.
    """
    digits = re.sub(r"[^0-9A-Fa-f]", "", _text(value)).upper()
    if len(digits) != 12 or digits in _INVALID_MACS:
        return ""
    return digits


def mac_candidates(value: Any) -> List[str]:
    """Все MAC из строки поля (например, список через разделитель)."""
    out: List[str] = []
    for raw in _MAC_CANDIDATE_RE.findall(_text(value)):
        normalized = normalize_mac(raw)
        if normalized and normalized not in out:
            out.append(normalized)
    return out


def normalize_inv(value: Any) -> str:
    return normalize_inv_no_token(value) or ""


def hostname_keys(hostname: Any) -> List[str]:
    name = _text(hostname).upper()
    if not name:
        return []
    keys = [name]
    short = name.split(".")[0].strip()
    if short and short != name:
        keys.append(short)
    return keys


@dataclass
class CardIndex:
    """Карточки одной БД (ITEMS CI_TYPE=1) с индексами для сопоставления в памяти."""

    db_id: str
    card_count: int = 0
    by_inv: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    by_mac: Dict[str, str] = field(default_factory=dict)
    by_hostname: Dict[str, List[str]] = field(default_factory=dict)


def build_card_index(db_id: str, rows: Iterable[Dict[str, Any]]) -> CardIndex:
    """rows приходят отсортированными по ID DESC: при совпадении ключа побеждает свежая карточка."""
    index = CardIndex(db_id=db_id)
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        inv = normalize_inv(row.get("inv_no"))
        if not inv:
            continue
        index.card_count += 1
        index.by_inv.setdefault(inv, row)
        for mac in mac_candidates(row.get("mac_address")):
            index.by_mac.setdefault(mac, inv)
        for name in (row.get("network_name"), row.get("domain_name")):
            key = _text(name).upper()
            if not key:
                continue
            bucket = index.by_hostname.setdefault(key, [])
            if inv not in bucket:
                bucket.append(inv)
    return index


def card_context(row: Dict[str, Any]) -> Dict[str, str]:
    return {
        "branch_no": _text(row.get("branch_no")),
        "branch_name": _text(row.get("branch_name")),
        "location_name": _text(row.get("location_name")),
        "employee_name": _text(row.get("employee_name")),
        "inv_no": normalize_inv(row.get("inv_no")),
        "model_name": _text(row.get("model_name")),
        "ip_address": _text(row.get("ip_address")),
    }


@dataclass
class HostMatch:
    db_id: str
    inv_no: str
    source: str  # mac | adapter_mac | hostname


def match_host(
    indexes: Sequence[CardIndex],
    *,
    mac: str,
    adapter_macs: Sequence[str],
    hostname: str,
    taken: set,
    allow_hostname: bool = True,
) -> Tuple[Optional[HostMatch], bool]:
    """Возвращает (совпадение, неоднозначно_по_имени).

    MAC-совпадение не зависит от уже занятых карточек (дубли считаются отдельно).
    По имени хоста берём только единственную свободную карточку во всех БД; при недоступной
    БД (allow_hostname=False) по имени не связываем: нужная карточка могла оказаться там.
    """
    for source, macs in (("mac", [mac] if mac else []), ("adapter_mac", list(adapter_macs))):
        for candidate in macs:
            for index in indexes:
                inv = index.by_mac.get(candidate)
                if inv:
                    return HostMatch(index.db_id, inv, source), False

    if not allow_hostname:
        return None, False

    candidates: List[Tuple[str, str]] = []
    keys = hostname_keys(hostname)
    for index in indexes:
        for key in keys:
            for inv in index.by_hostname.get(key, []):
                pair = (index.db_id, inv)
                if pair not in taken and pair not in candidates:
                    candidates.append(pair)
    if len(candidates) == 1:
        return HostMatch(candidates[0][0], candidates[0][1], "hostname"), False
    return None, len(candidates) > 1


def changed_card_fields(row: Dict[str, Any], context: Dict[str, str]) -> Dict[str, str]:
    """Только изменившиеся поля: запись в БД делается лишь при реальной разнице."""
    current = {
        "branch_no": _text(row.get("branch_no")),
        "branch_name": _text(row.get("branch_name")),
        "location_name": _text(row.get("location_name")),
        "employee_name": _text(row.get("employee_name")),
        "model_name": _text(row.get("model_name")),
        "ip_address": _text(row.get("ip_address")),
    }
    return {key: context[key] for key in _CONTEXT_FIELDS if context.get(key, "") != current.get(key, "")}


# --- Блокировка одного запуска ---------------------------------------------------------------


@contextmanager
def _binding_lease(database_url: Optional[str]):
    """Session advisory lock (PostgreSQL) или локальный lock для sqlite; yield True если захвачен."""
    from backend.appdb.db import get_app_engine

    engine = get_app_engine(database_url)
    if engine.dialect.name != "postgresql":
        acquired = _LOCAL_LOCK.acquire(blocking=False)
        try:
            yield acquired
        finally:
            if acquired:
                _LOCAL_LOCK.release()
        return

    from sqlalchemy import text

    key = int.from_bytes(hashlib.sha256(_LOCK_SEED).digest()[:8], "big") & ((1 << 63) - 1)
    connection = engine.connect().execution_options(isolation_level="AUTOCOMMIT")
    acquired = False
    try:
        acquired = bool(connection.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": key}).scalar())
        yield acquired
    finally:
        try:
            if acquired and not connection.invalidated:
                connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": key})
        finally:
            connection.close()


# --- Выгрузка карточек и цикл ----------------------------------------------------------------


def pull_card_snapshot(db_id: str) -> List[Dict[str, Any]]:
    """Один запрос на БД: все карточки ПК. Вынесено в функцию, чтобы тесты подменяли её."""
    from backend.database import queries

    return queries.list_pc_cards_for_binding(db_id)


def _adapter_macs(store: Any, host_key: str, primary: str) -> List[str]:
    payload = store.get_host(host_key) or {}
    network = payload.get("network") if isinstance(payload.get("network"), dict) else {}
    devices = network.get("devices") if isinstance(network.get("devices"), list) else []
    out: List[str] = []
    for device in devices:
        if not isinstance(device, dict) or device.get("virtual") is True:
            continue
        for mac in mac_candidates(device.get("mac_address")):
            if mac != primary and mac not in out:
                out.append(mac)
    return out


def _is_host_mac(key: str) -> bool:
    return bool(_HOST_MAC_RE.fullmatch(key or ""))


def _is_bound(identity: Dict[str, str], bound_rows: List[Dict[str, Any]]) -> bool:
    key = identity["mac_address"]
    if _is_host_mac(key):
        return any(row["mac_address"] == key for row in bound_rows)
    hostname = _text(identity.get("hostname")).lower()
    return any(not row["mac_address"] and row["hostname"].lower() == hostname for row in bound_rows)


def run_binding_cycle(
    store: Any,
    *,
    db_ids: Sequence[str],
    mode: str = "full",
    host_keys: Optional[Iterable[str]] = None,
    pull: Optional[Callable[[str], List[Dict[str, Any]]]] = None,
    batch_size: Optional[int] = None,
) -> Dict[str, Any]:
    """Один цикл привязки.

    mode='full' — привязка новых хостов и обновление полей/снятие привязок;
    mode='host' — только привязка перечисленных host_keys; без привязанных выгрузки не делается.
    """
    started = time.monotonic()
    pull_fn = pull or pull_card_snapshot
    size = batch_size or binding_batch_size()
    stats: Dict[str, Any] = {
        "mode": mode,
        "status": "ok",
        "hosts": 0,
        "dbs_ok": 0,
        "dbs_failed": 0,
        "refreshed": 0,
        "unbound": 0,
        "would_unbind": 0,
        "bound_mac": 0,
        "bound_adapter_mac": 0,
        "bound_hostname": 0,
        "hostname_ambiguous": 0,
        "unassigned": 0,
        "capped": 0,
        "write_errors": 0,
        "bind_errors": 0,
        "processed_keys": [],
    }
    try:
        with _binding_lease(store.database_url) as acquired:
            if not acquired:
                stats["status"] = "skipped_lock_busy"
            else:
                _run_locked(store, db_ids, mode, set(host_keys or []), pull_fn, size, stats)
    except Exception as exc:
        logger.warning("inventory_binding cycle failed error=%s", type(exc).__name__)
        stats["status"] = "error"
        stats["error"] = type(exc).__name__
    stats["duration_ms"] = int((time.monotonic() - started) * 1000)
    processed = stats.pop("processed_keys")
    logger.info("inventory_binding %s", " ".join(f"{key}={value}" for key, value in stats.items()))
    stats["processed_keys"] = processed
    return stats


def _run_locked(store, db_ids, mode, wanted_keys, pull_fn, size, stats) -> None:
    identities = store.list_host_identity_rows()
    bound_rows = store.list_bound_context_rows()
    stats["hosts"] = len(identities)
    if mode == "host":
        wanted_items = [item for item in identities if item["mac_address"] in wanted_keys]
        already_bound = [item for item in wanted_items if _is_bound(item, bound_rows)]
        stats["processed_keys"].extend(item["mac_address"] for item in already_bound)
        targets = [item for item in wanted_items if item not in already_bound]
        if not targets:
            # Все перечисленные хосты уже привязаны: выгрузку карточек ITINVENT не делаем.
            return
        refresh = False
    else:
        targets = list(identities)
        refresh = True

    indexes: Dict[str, CardIndex] = {}
    for db_id in db_ids:
        try:
            indexes[db_id] = build_card_index(db_id, pull_fn(db_id))
            stats["dbs_ok"] += 1
        except Exception as exc:
            stats["dbs_failed"] += 1
            stats["status"] = "partial"
            logger.warning("inventory_binding db_pull_failed db=%s error=%s", db_id, type(exc).__name__)
    ordered_indexes = [indexes[db_id] for db_id in db_ids if db_id in indexes]

    host_by_key = {item["mac_address"]: item for item in identities}
    if refresh:
        bound_rows = _refresh_bound_rows(store, bound_rows, indexes, host_by_key, size, stats)

    taken = {(row["db_id"], normalize_inv(row["inv_no"])) for row in bound_rows}
    bound_macs = {row["mac_address"] for row in bound_rows if row["mac_address"]}
    bound_nomac_hosts = {row["hostname"].lower() for row in bound_rows if not row["mac_address"]}
    max_binds = binding_max_binds_per_cycle()
    binds_done = 0

    for item in targets:
        key = item["mac_address"]
        hostname = _text(item.get("hostname"))
        mac = key if _is_host_mac(key) else ""
        if mac and mac in bound_macs:
            stats["processed_keys"].append(key)
            continue
        if not mac and hostname.lower() in bound_nomac_hosts:
            stats["processed_keys"].append(key)
            continue
        if binds_done >= max_binds:
            # Остаток уйдёт в следующий тик: ключ не помечается обработанным.
            stats["capped"] += 1
            continue
        stats["processed_keys"].append(key)
        if not ordered_indexes:
            stats["unassigned"] += 1
            continue
        try:
            adapter = _adapter_macs(store, key, mac) if mac else []
        except Exception as exc:
            stats["bind_errors"] += 1
            logger.warning("inventory_binding host_payload_failed error=%s", type(exc).__name__)
            adapter = []
        match, ambiguous = match_host(
            ordered_indexes,
            mac=mac,
            adapter_macs=adapter,
            hostname=hostname,
            taken=taken,
            allow_hostname=stats["dbs_failed"] == 0,
        )
        if ambiguous:
            stats["hostname_ambiguous"] += 1
        if match is None:
            stats["unassigned"] += 1
            continue
        card = indexes[match.db_id].by_inv[match.inv_no]
        try:
            store.bind_sql_context_row(
                mac_address=mac,
                hostname=hostname,
                db_id=match.db_id,
                context=card_context(card),
            )
        except Exception as exc:
            stats["bind_errors"] += 1
            logger.warning("inventory_binding bind_failed db=%s error=%s", match.db_id, type(exc).__name__)
            continue
        binds_done += 1
        taken.add((match.db_id, match.inv_no))
        if mac:
            bound_macs.add(mac)
        else:
            bound_nomac_hosts.add(hostname.lower())
        stats[f"bound_{match.source}"] += 1

    owners: Dict[Tuple[str, str], set] = {}
    for row in store.list_bound_context_rows():
        owners.setdefault((row["db_id"], normalize_inv(row["inv_no"])), set()).add(row["mac_address"])
    stats["duplicate_card_bindings"] = sum(1 for value in owners.values() if len(value) > 1)
    stats["bound_total"] = len(owners)


def _refresh_bound_rows(store, bound_rows, indexes, host_by_key, size, stats):
    updates: List[Dict[str, Any]] = []
    unbind_ids: List[int] = []
    kept: List[Dict[str, Any]] = []
    unbind_enabled = binding_unbind_enabled()
    rows_per_host_db: Dict[Tuple[str, str], int] = {}
    for row in bound_rows:
        pair = (row["mac_address"], row["db_id"])
        rows_per_host_db[pair] = rows_per_host_db.get(pair, 0) + 1

    for row in bound_rows:
        index = indexes.get(row["db_id"])
        if index is None:
            # БД не загрузилась: состояние привязки не трогаем.
            kept.append(row)
            continue
        card = index.by_inv.get(normalize_inv(row["inv_no"]))
        if card is None:
            if index.card_count == 0:
                # Пустая выгрузка не снимает привязки: вероятен сбой, а не удаление карточек.
                kept.append(row)
                continue
            if not unbind_enabled:
                stats["would_unbind"] += 1
                kept.append(row)
                continue
            unbind_ids.append(row["id"])
            stats["unbound"] += 1
            continue
        values: Dict[str, str] = changed_card_fields(row, card_context(card))
        identity = host_by_key.get(row["mac_address"])
        new_hostname = _text(identity.get("hostname")).lower() if identity else ""
        # Переименование пишем только если у пары MAC+БД одна строка: иначе возможен конфликт уникальности.
        if (
            new_hostname
            and new_hostname != row["hostname"].lower()
            and rows_per_host_db.get((row["mac_address"], row["db_id"]), 0) == 1
        ):
            values["hostname"] = new_hostname
        if values:
            updates.append({"id": row["id"], **values})
            stats["refreshed"] += 1
        kept.append(row)

    try:
        store.apply_sql_context_updates(updates, batch_size=size)
    except Exception as exc:
        stats["write_errors"] += 1
        logger.warning("inventory_binding update_failed error=%s", type(exc).__name__)
    if unbind_ids:
        try:
            store.clear_sql_context_bindings(unbind_ids, batch_size=size)
        except Exception as exc:
            stats["write_errors"] += 1
            logger.warning("inventory_binding unbind_failed error=%s", type(exc).__name__)
            return kept
    unbound = set(unbind_ids)
    return [row for row in kept if row["id"] not in unbound]


# --- Фоновый воркер -------------------------------------------------------------------------


class _BindingWorker:
    def __init__(self) -> None:
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._attempted: set = set()
        self._store_factory: Optional[Callable[[], Any]] = None
        self._db_ids_provider: Optional[Callable[[], List[str]]] = None

    def configure(self, store_factory, db_ids_provider) -> None:
        self._store_factory = store_factory
        self._db_ids_provider = db_ids_provider

    def start(self) -> bool:
        if self._thread is not None and self._thread.is_alive():
            return True
        if self._store_factory is None or self._db_ids_provider is None:
            return False
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="inventory-binding", daemon=True)
        self._thread.start()
        return True

    def stop(self) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=5)
        self._thread = None

    def _db_ids(self) -> List[str]:
        try:
            return [str(item) for item in (self._db_ids_provider() or []) if str(item or "").strip()]
        except Exception:
            return []

    def _mark_attempted(self, stats: Dict[str, Any]) -> None:
        # Ключи помечаются проверенными при ok и partial: иначе недоступная БД даёт выгрузку каждые тики.
        # При lock_busy/error не помечаем — проверим в следующем тике.
        if stats.get("status") in {"ok", "partial"}:
            self._attempted.update(stats.get("processed_keys") or [])

    def _run(self) -> None:
        if self._stop.wait(random.uniform(30, 90)):
            return
        next_full = 0.0
        fast_tick = binding_fast_tick_sec()
        while not self._stop.is_set():
            try:
                store = self._store_factory() if self._store_factory else None
                if store is not None:
                    if time.monotonic() >= next_full:
                        stats = run_binding_cycle(store, db_ids=self._db_ids(), mode="full")
                        next_full = time.monotonic() + binding_interval_sec()
                        self._mark_attempted(stats)
                    else:
                        pending = [
                            item["mac_address"]
                            for item in store.list_host_identity_rows()
                            if item["mac_address"] not in self._attempted
                        ]
                        if pending:
                            stats = run_binding_cycle(store, db_ids=self._db_ids(), mode="host", host_keys=pending)
                            self._mark_attempted(stats)
            except Exception as exc:
                logger.warning("inventory_binding worker tick failed error=%s", type(exc).__name__)
            self._stop.wait(fast_tick)


_worker = _BindingWorker()


def configure(*, store_factory: Callable[[], Any], db_ids_provider: Callable[[], List[str]]) -> None:
    _worker.configure(store_factory, db_ids_provider)


def start_background_worker() -> bool:
    if not binding_background_enabled():
        return False
    return _worker.start()


def stop_background_worker() -> None:
    _worker.stop()


__all__ = [
    "EMPTY_BRANCH_LABEL",
    "UNASSIGNED_BRANCH_LABEL",
    "binding_unbind_enabled",
    "build_card_index",
    "card_context",
    "changed_card_fields",
    "configure",
    "mac_candidates",
    "match_host",
    "normalize_inv",
    "normalize_mac",
    "run_binding_cycle",
    "start_background_worker",
    "stop_background_worker",
]
