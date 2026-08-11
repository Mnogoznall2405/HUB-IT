"""Employee absences registry for Hub dashboard (manual MVP; ZUP later)."""
from __future__ import annotations

from datetime import date, datetime, timezone
from threading import Lock
from time import monotonic
from typing import Any

from sqlalchemy import select

from backend.appdb.db import app_session, ensure_app_schema_initialized
from backend.appdb.models import AppEmployeeAbsence

ABSENCE_KINDS = frozenset({"vacation", "sick", "trip", "other"})
ABSENCE_KIND_LABELS = {
    "vacation": "Отпуск",
    "sick": "Больничный",
    "trip": "Командировка",
    "other": "Другое",
}
_DASHBOARD_EMBED_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_DASHBOARD_EMBED_CACHE_LOCK = Lock()
_DASHBOARD_EMBED_CACHE_TTL_SEC = 30.0


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_text(value: Any, *, maximum: int = 255) -> str:
    return str(value or "").strip()[:maximum]


def _parse_date(value: Any, *, field: str) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field} обязателен")
    try:
        return date.fromisoformat(text[:10])
    except ValueError as exc:
        raise ValueError(f"{field} должен быть датой YYYY-MM-DD") from exc


def _serialize(row: AppEmployeeAbsence) -> dict[str, Any]:
    kind = str(row.kind or "other")
    return {
        "id": int(row.id),
        "user_id": int(row.user_id) if row.user_id is not None else None,
        "display_name": row.display_name,
        "department": row.department,
        "kind": kind,
        "kind_label": ABSENCE_KIND_LABELS.get(kind, ABSENCE_KIND_LABELS["other"]),
        "starts_on": row.starts_on.isoformat(),
        "ends_on": row.ends_on.isoformat(),
        "comment": row.comment,
        "source": row.source,
        "created_by": int(row.created_by) if row.created_by is not None else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


class EmployeeAbsenceService:
    def __init__(self, *, database_url: str | None = None) -> None:
        self._database_url = str(database_url or "").strip() or None

    def _ready(self) -> None:
        ensure_app_schema_initialized(self._database_url)

    def list_on_date(self, *, on: date | None = None, limit: int = 100) -> dict[str, Any]:
        self._ready()
        day = on or date.today()
        safe_limit = max(1, min(500, int(limit or 100)))
        with app_session(self._database_url) as session:
            rows = session.scalars(
                select(AppEmployeeAbsence)
                .where(
                    AppEmployeeAbsence.starts_on <= day,
                    AppEmployeeAbsence.ends_on >= day,
                )
                .order_by(AppEmployeeAbsence.display_name.asc(), AppEmployeeAbsence.id.asc())
                .limit(safe_limit)
            ).all()
            items = [_serialize(row) for row in rows]
        return {
            "on": day.isoformat(),
            "count": len(items),
            "items": items,
        }

    def list_range(
        self,
        *,
        starts_on: date | None = None,
        ends_on: date | None = None,
        limit: int = 200,
    ) -> dict[str, Any]:
        self._ready()
        start = starts_on or date.today()
        end = ends_on or start
        if end < start:
            start, end = end, start
        safe_limit = max(1, min(500, int(limit or 200)))
        with app_session(self._database_url) as session:
            rows = session.scalars(
                select(AppEmployeeAbsence)
                .where(
                    AppEmployeeAbsence.starts_on <= end,
                    AppEmployeeAbsence.ends_on >= start,
                )
                .order_by(AppEmployeeAbsence.starts_on.asc(), AppEmployeeAbsence.display_name.asc())
                .limit(safe_limit)
            ).all()
            items = [_serialize(row) for row in rows]
        return {
            "starts_on": start.isoformat(),
            "ends_on": end.isoformat(),
            "count": len(items),
            "items": items,
        }

    def dashboard_embed(self, *, on: date | None = None, limit: int = 8) -> dict[str, Any]:
        preview_limit = max(1, min(50, int(limit or 8)))
        day = on or date.today()
        cache_key = f"{day.isoformat()}:{preview_limit}"
        now_mono = monotonic()
        with _DASHBOARD_EMBED_CACHE_LOCK:
            cached = _DASHBOARD_EMBED_CACHE.get(cache_key)
            if cached is not None and (now_mono - cached[0]) < _DASHBOARD_EMBED_CACHE_TTL_SEC:
                return dict(cached[1])

        # Fetch a wider page so count reflects the day, then trim items for the widget.
        payload = self.list_on_date(on=day, limit=500)
        zup_items: list[dict[str, Any]] = []
        zup_as_of = None
        try:
            from backend.services.address_book_service import address_book_service

            zup = address_book_service.list_absences(on=day, limit=500)
            zup_items = list(zup.get("items") or [])
            zup_as_of = zup.get("as_of")
        except Exception:  # noqa: BLE001 — dashboard must stay available if ZUP cache is down
            zup_items = []
        manual_items = list(payload.get("items") or [])
        # ZUP first; skip manual rows that duplicate the same ФИО.
        seen_names = {
            str(item.get("display_name") or "").strip().casefold()
            for item in zup_items
            if str(item.get("display_name") or "").strip()
        }
        merged = list(zup_items)
        for item in manual_items:
            name = str(item.get("display_name") or "").strip().casefold()
            if name and name in seen_names:
                continue
            merged.append(item)
        result = {
            "on": payload["on"],
            "count": len(merged),
            "items": merged[:preview_limit],
            "zup_as_of": zup_as_of,
        }
        with _DASHBOARD_EMBED_CACHE_LOCK:
            _DASHBOARD_EMBED_CACHE[cache_key] = (monotonic(), dict(result))
        return result

    def create(self, payload: dict[str, Any], *, created_by: int | None) -> dict[str, Any]:
        self._ready()
        display_name = _normalize_text(payload.get("display_name"))
        if not display_name:
            raise ValueError("display_name обязателен")
        kind = _normalize_text(payload.get("kind"), maximum=32).lower() or "other"
        if kind not in ABSENCE_KINDS:
            raise ValueError("kind должен быть vacation|sick|trip|other")
        starts_on = _parse_date(payload.get("starts_on"), field="starts_on")
        ends_on = _parse_date(payload.get("ends_on"), field="ends_on")
        if ends_on < starts_on:
            raise ValueError("ends_on не может быть раньше starts_on")
        user_id_raw = payload.get("user_id")
        user_id = int(user_id_raw) if user_id_raw not in (None, "") else None
        comment = _normalize_text(payload.get("comment"), maximum=500) or None
        department = _normalize_text(payload.get("department")) or None
        now = _utcnow()
        with app_session(self._database_url) as session:
            row = AppEmployeeAbsence(
                user_id=user_id,
                display_name=display_name,
                department=department,
                kind=kind,
                starts_on=starts_on,
                ends_on=ends_on,
                comment=comment,
                source="manual",
                created_by=int(created_by) if created_by is not None else None,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.commit()
            session.refresh(row)
            return _serialize(row)

    def update(self, absence_id: int, payload: dict[str, Any]) -> dict[str, Any]:
        self._ready()
        with app_session(self._database_url) as session:
            row = session.get(AppEmployeeAbsence, int(absence_id))
            if row is None:
                raise LookupError("absence_not_found")
            if "display_name" in payload:
                display_name = _normalize_text(payload.get("display_name"))
                if not display_name:
                    raise ValueError("display_name обязателен")
                row.display_name = display_name
            if "department" in payload:
                row.department = _normalize_text(payload.get("department")) or None
            if "kind" in payload:
                kind = _normalize_text(payload.get("kind"), maximum=32).lower() or "other"
                if kind not in ABSENCE_KINDS:
                    raise ValueError("kind должен быть vacation|sick|trip|other")
                row.kind = kind
            if "starts_on" in payload:
                row.starts_on = _parse_date(payload.get("starts_on"), field="starts_on")
            if "ends_on" in payload:
                row.ends_on = _parse_date(payload.get("ends_on"), field="ends_on")
            if row.ends_on < row.starts_on:
                raise ValueError("ends_on не может быть раньше starts_on")
            if "comment" in payload:
                row.comment = _normalize_text(payload.get("comment"), maximum=500) or None
            if "user_id" in payload:
                user_id_raw = payload.get("user_id")
                row.user_id = int(user_id_raw) if user_id_raw not in (None, "") else None
            row.updated_at = _utcnow()
            session.commit()
            session.refresh(row)
            return _serialize(row)

    def delete(self, absence_id: int) -> None:
        self._ready()
        with app_session(self._database_url) as session:
            row = session.get(AppEmployeeAbsence, int(absence_id))
            if row is None:
                raise LookupError("absence_not_found")
            session.delete(row)
            session.commit()


employee_absence_service = EmployeeAbsenceService()
