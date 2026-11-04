"""Personal, read-only Docflow absences; never written to the shared ZUP cache."""
from __future__ import annotations

import copy
import hashlib
import os
import threading
import time
from collections import OrderedDict
from datetime import date, datetime, timezone
from typing import Any

from backend.services.address_book_service import address_book_service, absence_last_day, map_absence_kind
from backend.services.docflow_service import (
    DocflowCredentialStore,
    DocflowCredentialsRequired,
    DocflowConfigurationError,
    DocflowUnavailable,
)
from backend.services.secret_crypto_service import decrypt_docflow_secret, SecretCryptoError
from backend.services.warehouse_1c_process_bridge import Warehouse1CProcessBridge


def _env_seconds(name: str, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


class _Flight:
    """One in-progress read that identical concurrent requests share instead of queueing again."""

    def __init__(self) -> None:
        self.done = threading.Event()
        self.raw: dict | None = None
        self.as_of = ""
        self.error: Exception | None = None


def _email(value: Any) -> str:
    return str(value or "").strip().casefold()


def _surname(value: Any) -> str:
    parts = str(value or "").split()
    return parts[0].casefold().replace("ё", "е") if len(parts) >= 2 else ""


def _reconcile(raw: dict, cache: dict) -> tuple[list[dict], str]:
    """Prefer unique email; otherwise require a unique surname in both catalogs."""
    email_index: dict[str, dict[str, dict]] = {}
    surname_index: dict[str, dict[str, dict]] = {}
    for person in cache.get("items") or []:
        code = str(person.get("employee_code") or "").strip()
        if not code:
            continue
        surname = _surname(person.get("full_name"))
        if surname:
            surname_index.setdefault(surname, {})[code] = person
        for contact in person.get("work_emails") or []:
            email = _email(contact.get("normalized") or contact.get("value"))
            if email and "@" in email:
                email_index.setdefault(email, {})[code] = person
    grouped: dict[str, dict] = {}
    for row in raw.get("rows") or []:
        ref = str(row.get("ref") or "")
        if not ref or not row.get("employee_ref"):
            raise DocflowUnavailable("1С вернула отсутствие без идентификатора")
        group = grouped.setdefault(ref, {"row": row, "emails": set()})
        email = _email(row.get("email"))
        if email and "@" in email:
            group["emails"].add(email)
    comparison = "unavailable"
    try:
        updated = datetime.fromisoformat(str(cache.get("updated_at") or "").replace("Z", "+00:00"))
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - updated).total_seconds()
        if not cache.get("last_error") and 0 <= age <= 7200:
            comparison = "available"
    except (TypeError, ValueError):
        pass
    items = []
    owners = raw.get("email_owners") or {}
    surname_owners = raw.get("surname_owners") or {}
    for ref, group in grouped.items():
        row = group["row"]
        candidates: dict[str, dict] = {}
        ambiguous = False
        for email in group["emails"]:
            do_owners = set(owners.get(email) or [])
            zup_owners = email_index.get(email, {})
            if do_owners != {row["employee_ref"]} or len(zup_owners) > 1:
                ambiguous = True
                continue
            candidates.update(zup_owners)
        person = next(iter(candidates.values())) if len(candidates) == 1 and not ambiguous else None
        if not candidates and not ambiguous:
            surname = _surname(row.get("display_name"))
            surname_candidates = surname_index.get(surname, {})
            if len(surname_candidates) == 1 and set(surname_owners.get(surname) or []) == {row["employee_ref"]}:
                person = next(iter(surname_candidates.values()))
        starts_on = str(row.get("starts_on") or "")
        ends_on = str(row.get("ends_on") or "")
        try:
            if date.fromisoformat(ends_on) < date.fromisoformat(starts_on):
                raise ValueError
        except ValueError:
            raise DocflowUnavailable("1С вернула некорректный период отсутствия") from None
        differences = []
        zup = person.get("absence") if person else None
        if comparison == "available" and isinstance(zup, dict):
            if zup.get("starts_on") != starts_on:
                differences.append("starts_on")
            zup_end = absence_last_day(zup)
            if zup_end is None or zup_end.isoformat() != ends_on:
                differences.append("ends_on")
            if zup.get("kind") != map_absence_kind(row.get("label")):
                differences.append("kind")
        items.append({
            "id": f"docflow:{ref}",
            "employee_ref": row["employee_ref"],
            "employee_code": person.get("employee_code") if person else None,
            "matching_status": "matched" if person else "unresolved",
            "display_name": str(row.get("display_name") or ""),
            "starts_on": starts_on,
            "ends_on": ends_on,
            "kind": map_absence_kind(row.get("label")) or "other",
            "label": str(row.get("label") or ""),
            "comment": str(row.get("comment") or "")[:2000],
            "will_handle_tasks": bool(row.get("available")),
            "source": "docflow",
            "differences": differences,
        })
    items.sort(key=lambda item: (item["display_name"].casefold(), item["id"]))
    return items, comparison


class DocflowAbsenceService:
    def __init__(self, *, store=None, source=None, bridge=None):
        self._store = store or DocflowCredentialStore()
        self._source = source or address_book_service
        self._bridge = bridge or Warehouse1CProcessBridge(
            "backend.services.docflow_1c_process_dispatcher:dispatch",
            allowed_operations={"absences"},
            # One read takes tens of seconds and the worker is serial, so a short wait turned every
            # concurrent opening of the address book into an immediate 503.
            queue_limit=_env_seconds("DOCFLOW_ABSENCES_QUEUE_LIMIT", 6, 0),
            queue_wait_seconds=_env_seconds("DOCFLOW_ABSENCES_QUEUE_WAIT_SECONDS", 45, 0),
            maximum_message_bytes=4 * 1024 * 1024,
            process_name="docflow-absences-com-bridge",
        )
        self._lock = threading.Lock()
        self._cache: OrderedDict[tuple, tuple[float, dict, str]] = OrderedDict()
        self._inflight: dict[tuple, _Flight] = {}

    def list_absences(self, *, user_id: int, on: date, employee_code: str = "") -> dict:
        if str(os.getenv("DOCFLOW_ABSENCES_ENABLED", "0")).strip().casefold() not in {"1", "true", "yes", "on"}:
            return {"status": "disabled", "source": "docflow", "items": [], "count": None}
        row = self._store.get(int(user_id))
        if row is None:
            raise DocflowCredentialsRequired("Подключите свою учётную запись 1С в разделе «Документооборот»")
        # The fingerprint changes on replacement of credentials, even in stores
        # which have not yet adopted credential_version. Plaintext is never a key.
        fingerprint = hashlib.sha256(str(row.password_enc).encode()).hexdigest()
        key = (int(user_id), str(row.login), fingerprint, on.isoformat())
        flight: _Flight | None = None
        leader = False
        with self._lock:
            cached = self._cache.get(key)
            if cached is not None and cached[0] > time.monotonic():
                raw, as_of = copy.deepcopy(cached[1]), cached[2]
            else:
                raw = None
                flight = self._inflight.get(key)
                if flight is None:
                    flight = self._inflight[key] = _Flight()
                    leader = True
        if raw is None and not leader:
            # The same account is already being read: share that result (a failure is not retried here).
            if not flight.done.wait(timeout=95):
                raise DocflowUnavailable("Не удалось загрузить отсутствия из Документооборота. Повторите попытку.")
            if flight.error is not None:
                raise flight.error
            raw, as_of = copy.deepcopy(flight.raw), flight.as_of
        elif raw is None:
            try:
                try:
                    password = decrypt_docflow_secret(row.password_enc)
                except SecretCryptoError:
                    raise DocflowConfigurationError("Не удалось расшифровать учётные данные 1С") from None
                try:
                    raw = self._bridge.call(
                        "absences", {"login": str(row.login), "password": password, "on": on.isoformat()}, timeout=90,
                    )
                except Exception:
                    raise DocflowUnavailable(
                        "Не удалось загрузить отсутствия из Документооборота. Повторите попытку."
                    ) from None
                finally:
                    password = ""
                as_of = datetime.now(timezone.utc).isoformat()
                with self._lock:
                    self._cache[key] = (time.monotonic() + 30, copy.deepcopy(raw), as_of)
                    self._cache.move_to_end(key)
                    while len(self._cache) > 128:
                        self._cache.popitem(last=False)
                flight.raw, flight.as_of = copy.deepcopy(raw), as_of
            except Exception as exc:
                flight.error = exc
                raise
            finally:
                with self._lock:
                    self._inflight.pop(key, None)
                flight.done.set()
        try:
            zup_cache = self._source.load_cache()
        except Exception:
            zup_cache = {}
        items, comparison = _reconcile(raw, zup_cache)
        # The ZUP cache describes current HR state, not a historical/planned
        # absence ledger. A different selected date cannot establish equality.
        if on != date.today():
            comparison = "unavailable"
            for item in items:
                item["differences"] = []
        unresolved = sum(item["matching_status"] != "matched" for item in items)
        if employee_code:
            items = [item for item in items if item["employee_code"] == employee_code]
        return {
            "status": "available", "source": "docflow", "on": on.isoformat(),
            "items": items, "count": len(items), "unresolved_count": unresolved,
            "as_of": as_of, "zup_comparison": comparison,
            "zup_as_of": zup_cache.get("updated_at") or None,
        }

    def shutdown(self) -> None:
        self._bridge.shutdown()
        with self._lock:
            self._cache.clear()


docflow_absence_service = DocflowAbsenceService()
