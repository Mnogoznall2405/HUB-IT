"""Read-only construction portfolio derived from 1C MPZ requests.

One bounded query loads request headers for the rolling window. The result is
aggregated by the stable 1C nomenclature-group reference and cached as a small
portfolio snapshot. No request-line or document-chain N+1 reads are performed.
"""
from __future__ import annotations

import base64
import binascii
from datetime import date, datetime, time as datetime_time, timedelta, timezone
import hashlib
import json
import threading
import time
from typing import Any, Callable
import uuid

from backend.services.warehouse_1c_it_requests import (
    REQUEST_DOCUMENT,
    _execute_rows,
    _field,
    _iso_datetime,
    _ref_uuid,
    _text,
)


CONSTRUCTION_WINDOW_DAYS = 365
CONSTRUCTION_SCAN_MAX = 6_000
CONSTRUCTION_SNAPSHOT_TTL_SECONDS = 300
CONSTRUCTION_FORCE_REFRESH_COOLDOWN_SECONDS = 30
GENERAL_GROUP_NAME = "Общехозяйственная деятельность"
UNASSIGNED_OBJECT_REF = "unassigned"
UNASSIGNED_OBJECT_NAME = "Без номенклатурной группы"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _date_from_iso(value: Any) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _request_sort_key(item: dict[str, Any]) -> tuple[str, str]:
    return str(item.get("date") or ""), str(item.get("number") or "")


def _object_kind(group_ref: str, group_name: str) -> str:
    if not group_ref:
        return "unassigned"
    if group_name.strip().casefold() == GENERAL_GROUP_NAME.casefold():
        return "general"
    return "project"


def build_construction_snapshot(
    rows: list[dict[str, Any]],
    *,
    as_of: str | None = None,
    window_from: date | None = None,
    scan_limit: int = CONSTRUCTION_SCAN_MAX,
    today: date | None = None,
) -> dict[str, Any]:
    """Aggregate normalized request headers into portfolio cards."""
    current_day = today or datetime.now().date()
    recent_cutoff = current_day - timedelta(days=30)
    groups: dict[str, dict[str, Any]] = {}

    for row in rows:
        group_ref = str(row.get("group_ref") or "").strip().lower()
        group_name = str(row.get("group_name") or "").strip()
        kind = _object_kind(group_ref, group_name)
        object_ref = group_ref or UNASSIGNED_OBJECT_REF
        name = group_name or UNASSIGNED_OBJECT_NAME
        item = groups.setdefault(
            object_ref,
            {
                "object_ref": object_ref,
                "name": name,
                "kind": kind,
                "request_count": 0,
                "requests_last_30_days": 0,
                "posted_count": 0,
                "latest_request_at": None,
                "latest_request_number": "",
                "department_names": set(),
                "responsible_names": set(),
                "warehouse_names": set(),
                "search_values": set(),
                "recent_requests": [],
            },
        )
        item["request_count"] += 1
        request_day = _date_from_iso(row.get("date"))
        if request_day is not None and request_day >= recent_cutoff:
            item["requests_last_30_days"] += 1
        if bool(row.get("posted")):
            item["posted_count"] += 1

        for key, target in (
            ("department_name", "department_names"),
            ("responsible_name", "responsible_names"),
            ("warehouse_name", "warehouse_names"),
        ):
            value = str(row.get(key) or "").strip()
            if value:
                item[target].add(value)

        recent_request = {
            "request_ref": str(row.get("request_ref") or "").strip().lower(),
            "number": str(row.get("request_number") or row.get("system_number") or "").strip(),
            "date": row.get("date"),
            "required_date": row.get("required_date"),
            "department_name": str(row.get("department_name") or "").strip(),
            "responsible_name": str(row.get("responsible_name") or "").strip(),
            "warehouse_name": str(row.get("warehouse_name") or "").strip(),
        }
        item["search_values"].update(
            value
            for value in (
                name,
                recent_request["number"],
                recent_request["department_name"],
                recent_request["responsible_name"],
                recent_request["warehouse_name"],
            )
            if value
        )
        item["recent_requests"].append(recent_request)

    items: list[dict[str, Any]] = []
    for item in groups.values():
        recent_requests = sorted(item["recent_requests"], key=_request_sort_key, reverse=True)[:3]
        latest = recent_requests[0] if recent_requests else {}
        normalized_item = {
            **item,
            "latest_request_at": latest.get("date"),
            "latest_request_number": str(latest.get("number") or ""),
            "department_names": sorted(item["department_names"], key=str.casefold)[:5],
            "responsible_names": sorted(item["responsible_names"], key=str.casefold)[:5],
            "warehouse_names": sorted(item["warehouse_names"], key=str.casefold)[:5],
            "search_text": " ".join(sorted(item["search_values"], key=str.casefold)),
            "recent_requests": recent_requests,
            "managed": False,
            "managed_object_id": None,
            "source_groups": (
                [{"group_ref": item["object_ref"], "group_name": item["name"]}]
                if item["kind"] == "project"
                else []
            ),
            "team": [],
        }
        normalized_item.pop("search_values", None)
        items.append(normalized_item)

    kind_order = {"project": 0, "general": 1, "unassigned": 2}
    items.sort(
        key=lambda item: (
            kind_order.get(str(item.get("kind") or ""), 9),
            str(item.get("latest_request_at") or ""),
            str(item.get("name") or "").casefold(),
        ),
        reverse=False,
    )
    project_items = [item for item in items if item["kind"] == "project"]
    project_items.sort(
        key=lambda item: (
            str(item.get("latest_request_at") or ""),
            str(item.get("name") or "").casefold(),
        ),
        reverse=True,
    )
    items = project_items + [item for item in items if item["kind"] != "project"]

    return {
        "snapshot_id": uuid.uuid4().hex,
        "as_of": as_of or _utc_now_iso(),
        "window_from": (window_from or (current_day - timedelta(days=CONSTRUCTION_WINDOW_DAYS))).isoformat(),
        "scanned_requests": len(rows),
        "scan_truncated": len(rows) >= scan_limit,
        "items": items,
        "summary": {
            "project_count": sum(1 for item in items if item["kind"] == "project"),
            "request_count": len(rows),
            "requests_last_30_days": sum(int(item["requests_last_30_days"]) for item in items),
            "general_request_count": sum(
                int(item["request_count"]) for item in items if item["kind"] == "general"
            ),
            "unassigned_request_count": sum(
                int(item["request_count"]) for item in items if item["kind"] == "unassigned"
            ),
        },
    }


def merge_managed_construction_objects(
    raw_items: list[dict[str, Any]],
    managed_objects: list[dict[str, Any]] | None,
) -> tuple[list[dict[str, Any]], str]:
    """Merge 1C group cards into HUB-owned objects before search/pagination."""
    definitions = [item for item in (managed_objects or []) if bool(item.get("is_active", True))]
    signature_payload = json.dumps(definitions, ensure_ascii=False, sort_keys=True, default=str)
    signature = hashlib.sha256(signature_payload.encode("utf-8")).hexdigest()[:16]
    group_to_object: dict[str, dict[str, Any]] = {}
    managed_by_id: dict[str, dict[str, Any]] = {}
    for definition in definitions:
        object_id = str(definition.get("id") or "").strip()
        if not object_id:
            continue
        managed_by_id[object_id] = definition
        for group in definition.get("groups") or []:
            group_ref = str(group.get("group_ref") or "").strip().lower()
            if group_ref:
                group_to_object[group_ref] = definition

    merged: dict[str, dict[str, Any]] = {}
    passthrough: list[dict[str, Any]] = []
    for raw in raw_items:
        group_ref = str(raw.get("object_ref") or "").strip().lower()
        definition = group_to_object.get(group_ref) if raw.get("kind") == "project" else None
        if not definition:
            item = dict(raw)
            item.setdefault("managed", False)
            item.setdefault("managed_object_id", None)
            item.setdefault(
                "source_groups",
                [{"group_ref": group_ref, "group_name": str(raw.get("name") or "")}]
                if raw.get("kind") == "project"
                else [],
            )
            item.setdefault("team", [])
            passthrough.append(item)
            continue

        object_id = str(definition["id"])
        target = merged.setdefault(
            object_id,
            {
                "object_ref": f"managed:{object_id}",
                "name": str(definition.get("name") or raw.get("name") or object_id),
                "kind": "project",
                "request_count": 0,
                "requests_last_30_days": 0,
                "posted_count": 0,
                "latest_request_at": None,
                "latest_request_number": "",
                "department_names": set(),
                "responsible_names": set(),
                "warehouse_names": set(),
                "recent_requests": [],
                "search_values": set(),
                "managed": True,
                "managed_object_id": object_id,
                "source_groups": list(definition.get("groups") or []),
                "team": list(definition.get("team") or []),
            },
        )
        for key in ("request_count", "requests_last_30_days", "posted_count"):
            target[key] += int(raw.get(key) or 0)
        for key in ("department_names", "responsible_names", "warehouse_names"):
            target[key].update(raw.get(key) or [])
        target["recent_requests"].extend(raw.get("recent_requests") or [])
        target["search_values"].update(
            value
            for value in (
                raw.get("name"),
                raw.get("search_text"),
                definition.get("name"),
                *(member.get("full_name") for member in (definition.get("team") or [])),
            )
            if value
        )

    for object_id, definition in managed_by_id.items():
        if object_id not in merged:
            merged[object_id] = {
                "object_ref": f"managed:{object_id}",
                "name": str(definition.get("name") or object_id),
                "kind": "project",
                "request_count": 0,
                "requests_last_30_days": 0,
                "posted_count": 0,
                "latest_request_at": None,
                "latest_request_number": "",
                "department_names": set(),
                "responsible_names": set(),
                "warehouse_names": set(),
                "recent_requests": [],
                "search_values": {
                    str(definition.get("name") or ""),
                    *(str(group.get("group_name") or "") for group in (definition.get("groups") or [])),
                    *(str(member.get("full_name") or "") for member in (definition.get("team") or [])),
                },
                "managed": True,
                "managed_object_id": object_id,
                "source_groups": list(definition.get("groups") or []),
                "team": list(definition.get("team") or []),
            }

    normalized_merged: list[dict[str, Any]] = []
    for item in merged.values():
        recent_requests = sorted(item["recent_requests"], key=_request_sort_key, reverse=True)[:3]
        latest = recent_requests[0] if recent_requests else {}
        normalized_merged.append(
            {
                **item,
                "latest_request_at": latest.get("date"),
                "latest_request_number": str(latest.get("number") or ""),
                "department_names": sorted(item["department_names"], key=str.casefold)[:5],
                "responsible_names": sorted(item["responsible_names"], key=str.casefold)[:5],
                "warehouse_names": sorted(item["warehouse_names"], key=str.casefold)[:5],
                "recent_requests": recent_requests,
                "search_text": " ".join(
                    sorted((str(value) for value in item["search_values"] if value), key=str.casefold)
                ),
            }
        )
        normalized_merged[-1].pop("search_values", None)

    projects = normalized_merged + [item for item in passthrough if item.get("kind") == "project"]
    projects.sort(
        key=lambda item: (
            str(item.get("latest_request_at") or ""),
            str(item.get("name") or "").casefold(),
        ),
        reverse=True,
    )
    other = [item for item in passthrough if item.get("kind") != "project"]
    return projects + other, signature


def load_construction_snapshot(
    connection: Any,
    *,
    now: datetime | None = None,
    scan_limit: int = CONSTRUCTION_SCAN_MAX,
) -> dict[str, Any]:
    current = now or datetime.now()
    window_from = current.date() - timedelta(days=CONSTRUCTION_WINDOW_DAYS)
    selection = _execute_rows(
        connection,
        f"""
ВЫБРАТЬ ПЕРВЫЕ {scan_limit}
    Заявка.Ссылка КАК СсылкаЗаявки,
    Заявка.Номер КАК НомерСистемный,
    Заявка.Дата КАК ДатаЗаявки,
    Заявка.Проведен КАК Проведена,
    Заявка.ВходящийНомер КАК ВходящийНомер,
    Заявка.ДатаВыполнения КАК ДатаВыполнения,
    Заявка.НоменклатурнаяГруппа КАК НоменклатурнаяГруппа,
    Заявка.Подразделение КАК Подразделение,
    Заявка.Ответственный КАК Ответственный,
    Заявка.Склад КАК Склад
ИЗ Документ.{REQUEST_DOCUMENT} КАК Заявка
ГДЕ НЕ Заявка.ПометкаУдаления
    И Заявка.Дата >= &ДатаНачала
УПОРЯДОЧИТЬ ПО Заявка.Дата УБЫВ, Заявка.Номер УБЫВ
""",
        {"ДатаНачала": datetime.combine(window_from, datetime_time.min)},
    )
    rows: list[dict[str, Any]] = []
    while selection.Next():
        request_reference = _field(selection, "СсылкаЗаявки")
        request_ref = _ref_uuid(connection, request_reference)
        if not request_ref:
            continue
        group = _field(selection, "НоменклатурнаяГруппа")
        rows.append(
            {
                "request_ref": request_ref,
                "request_number": _text(connection, _field(selection, "ВходящийНомер"))
                or _text(connection, _field(selection, "НомерСистемный")),
                "system_number": _text(connection, _field(selection, "НомерСистемный")),
                "date": _iso_datetime(_field(selection, "ДатаЗаявки")),
                "required_date": _iso_datetime(_field(selection, "ДатаВыполнения")),
                "posted": bool(_field(selection, "Проведена", False)),
                "group_ref": _ref_uuid(connection, group),
                "group_name": _text(connection, group),
                "department_name": _text(connection, _field(selection, "Подразделение")),
                "responsible_name": _text(connection, _field(selection, "Ответственный")),
                "warehouse_name": _text(connection, _field(selection, "Склад")),
            }
        )
    return build_construction_snapshot(
        rows,
        as_of=_utc_now_iso(),
        window_from=window_from,
        scan_limit=scan_limit,
        today=current.date(),
    )


class ConstructionSnapshotStore:
    def __init__(
        self,
        *,
        ttl_seconds: int = CONSTRUCTION_SNAPSHOT_TTL_SECONDS,
        force_refresh_cooldown_seconds: int = CONSTRUCTION_FORCE_REFRESH_COOLDOWN_SECONDS,
        clock: Callable[[], float] = time.monotonic,
        loader: Callable[..., dict[str, Any]] = load_construction_snapshot,
    ) -> None:
        self._ttl_seconds = max(1, int(ttl_seconds))
        self._force_refresh_cooldown_seconds = max(0, int(force_refresh_cooldown_seconds))
        self._clock = clock
        self._loader = loader
        self._condition = threading.Condition()
        self._snapshot: dict[str, Any] | None = None
        self._loaded_at = 0.0
        self._last_forced_at = float("-inf")
        self._loading = False

    def get(self, connection: Any, *, force_refresh: bool = False) -> tuple[dict[str, Any], dict[str, Any]]:
        now = self._clock()
        with self._condition:
            age = max(0.0, now - self._loaded_at) if self._snapshot is not None else 0.0
            refresh_suppressed = bool(
                force_refresh
                and self._snapshot is not None
                and now - self._last_forced_at < self._force_refresh_cooldown_seconds
            )
            if self._snapshot is not None and (
                (not force_refresh and age < self._ttl_seconds) or refresh_suppressed
            ):
                return self._snapshot, {
                    "state": "cached",
                    "age_seconds": int(age),
                    "last_error": "",
                    "coalesced": False,
                    "refresh_suppressed": refresh_suppressed,
                }
            if self._loading:
                while self._loading:
                    self._condition.wait()
                if self._snapshot is not None:
                    age = max(0.0, self._clock() - self._loaded_at)
                    return self._snapshot, {
                        "state": "cached",
                        "age_seconds": int(age),
                        "last_error": "",
                        "coalesced": True,
                        "refresh_suppressed": False,
                    }
            self._loading = True
            if force_refresh:
                self._last_forced_at = now

        try:
            snapshot = self._loader(connection)
        except Exception as exc:
            with self._condition:
                stale = self._snapshot
                age = max(0.0, self._clock() - self._loaded_at) if stale is not None else 0.0
                self._loading = False
                self._condition.notify_all()
            if stale is None:
                raise
            return stale, {
                "state": "stale",
                "age_seconds": int(age),
                "last_error": str(exc),
                "coalesced": False,
                "refresh_suppressed": False,
            }

        with self._condition:
            self._snapshot = snapshot
            self._loaded_at = self._clock()
            self._loading = False
            self._condition.notify_all()
        return snapshot, {
            "state": "fresh",
            "age_seconds": 0,
            "last_error": "",
            "coalesced": False,
            "refresh_suppressed": False,
        }


construction_snapshot_store = ConstructionSnapshotStore()


def encode_construction_cursor(snapshot_id: str, offset: int) -> str:
    payload = json.dumps(
        {"snapshot": str(snapshot_id or ""), "offset": max(0, int(offset))},
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_construction_cursor(cursor: str | None) -> tuple[str, int]:
    text = str(cursor or "").strip()
    if not text:
        return "", 0
    try:
        padding = "=" * (-len(text) % 4)
        payload = json.loads(base64.urlsafe_b64decode(text + padding).decode("utf-8"))
        snapshot_id = str(payload.get("snapshot") or "").strip()
        offset = int(payload.get("offset") or 0)
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, binascii.Error) as exc:
        raise ValueError("Некорректный курсор портфеля объектов") from exc
    if offset < 0:
        raise ValueError("Некорректный курсор портфеля объектов")
    return snapshot_id, offset


def query_construction_objects(
    connection: Any,
    *,
    search: str = "",
    kind: str = "all",
    limit: int = 24,
    cursor: str | None = None,
    refresh: bool = False,
    managed_objects: list[dict[str, Any]] | None = None,
    snapshot_store: ConstructionSnapshotStore | None = None,
) -> dict[str, Any]:
    store = snapshot_store or construction_snapshot_store
    snapshot, cache = store.get(connection, force_refresh=refresh)
    view_items, management_signature = merge_managed_construction_objects(
        list(snapshot.get("items", [])),
        managed_objects,
    )
    cursor_snapshot_id, offset = decode_construction_cursor(cursor)
    snapshot_id = f"{str(snapshot.get('snapshot_id') or '')}:{management_signature}"
    snapshot_changed = bool(cursor_snapshot_id and cursor_snapshot_id != snapshot_id)
    if snapshot_changed:
        offset = 0

    tokens = str(search or "").strip().casefold().split()
    filtered: list[dict[str, Any]] = []
    for item in view_items:
        if kind != "all" and item.get("kind") != kind:
            continue
        haystack = " ".join(
            [
                str(item.get("name") or ""),
                str(item.get("search_text") or ""),
            ]
        ).casefold()
        if tokens and not all(token in haystack for token in tokens):
            continue
        filtered.append(item)

    page = filtered[offset : offset + limit]
    next_offset = offset + len(page)
    has_more = next_offset < len(filtered)
    summary = dict(snapshot["summary"])
    summary["project_count"] = sum(1 for item in view_items if item.get("kind") == "project")
    return {
        "items": page,
        "next_cursor": encode_construction_cursor(snapshot_id, next_offset) if has_more else None,
        "has_more": has_more,
        "snapshot_changed": snapshot_changed,
        "as_of": snapshot["as_of"],
        "window_from": snapshot["window_from"],
        "scanned_requests": snapshot["scanned_requests"],
        "scan_truncated": bool(snapshot.get("scan_truncated")),
        "summary": summary,
        "cache": cache,
    }
