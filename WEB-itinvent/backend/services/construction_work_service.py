"""Native production journal. No 1C calls or schema initialization in request paths."""
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
import json

from sqlalchemy import case, func, select, update
from sqlalchemy.exc import IntegrityError

from backend.appdb.db import app_session
from backend.appdb.models import (
    AppConstructionObject, AppConstructionObject1CGroup,
    AppConstructionWorkItem as Item, AppConstructionWorkEntry as Entry,
    AppConstructionWorkAudit as Audit,
    AppGlobalSetting,
)
from backend.services.construction_work_calculation import CalculationProfile, calculate, calculation_key
from backend.models.construction_work import WorkDayValues
from backend.services.construction_management_service import normalize_construction_group_ref


class WorkConflict(ValueError):
    pass


class WorkNotFound(ValueError):
    pass


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _number(value):
    return Decimal(str(value or 0))


def _percent(plan, total):
    quantity = _number(plan["planned_quantity"])
    return float(total / quantity * 100) if quantity > 0 else None


def _summary(items):
    missing = sum(_number(i["plan"].get("weight")) <= 0 or _number(i["plan"]["planned_quantity"]) <= 0 for i in items)
    weight = sum((_number(i["plan"].get("weight")) for i in items), Decimal(0))
    progress = None
    if items and not missing and weight:
        progress = float(sum(
            _number(i["plan"]["weight"]) * min(_number(i["percent"]), Decimal(100))
            for i in items
        ) / weight)
    return {
        "total": len(items), "percent": progress, "missing_weights_or_plan": missing,
        "completed": sum(i["percent"] is not None and i["percent"] >= 100 for i in items),
        "over_plan": sum(i["percent"] is not None and i["percent"] > 100 for i in items),
        "overdue": sum(bool(i["overdue"]) for i in items),
    }


class ConstructionWorkService:
    def __init__(self, database_url=None, *, session_factory=None):
        self.database_url = database_url
        self.session_factory = session_factory

    def _session(self):
        return (self.session_factory or app_session)(self.database_url)

    def _scope(self, session, object_id, group_ref=None, *, lock=False):
        object_id = str(object_id).removeprefix("managed:")
        if lock:
            # Object first, then direction: matches management save/unlink order.
            parent = session.scalar(select(AppConstructionObject).where(
                AppConstructionObject.id == object_id, AppConstructionObject.is_active.is_(True),
            ).with_for_update())
            if parent is None:
                raise WorkNotFound("Направление управляемого объекта не найдено")
        query = select(AppConstructionObject1CGroup).join(
            AppConstructionObject, AppConstructionObject.id == AppConstructionObject1CGroup.object_id,
        ).where(AppConstructionObject.id == object_id, AppConstructionObject.is_active.is_(True))
        if group_ref is not None:
            group_ref = normalize_construction_group_ref(group_ref)
            query = query.where(AppConstructionObject1CGroup.group_ref == group_ref)
        if lock:
            query = query.with_for_update()
        groups = session.scalars(query).all()
        if not groups:
            raise WorkNotFound("Направление управляемого объекта не найдено")
        return object_id, {g.group_ref: g.group_name for g in groups}

    def read(self, object_id, group_ref=None, *, as_of=None, include_archived=False):
        as_of = as_of or date.today()
        start = as_of - timedelta(days=89)
        trend_days = [start + timedelta(days=offset) for offset in [*range(0, 89, 7), 89]]
        with self._session() as session:
            object_id, groups = self._scope(session, object_id, group_ref)
            profile_json = session.scalar(select(AppGlobalSetting.value_json).where(AppGlobalSetting.key == calculation_key(object_id)))
            profile = CalculationProfile.model_validate_json(profile_json) if profile_json else None
            if profile and profile.group_ref not in groups:
                profile = None
            # One statement snapshot covers the plan, selected day, total and trend.
            # A later concurrent journal edit cannot produce a negative past total.
            totals = select(Entry.work_id, func.sum(Entry.quantity).label("quantity"), *[
                func.sum(case((Entry.work_date <= day, Entry.quantity), else_=0)).label(f"trend_{index}")
                for index, day in enumerate(trend_days)
            ]).join(Item, Item.id == Entry.work_id).where(
                Item.object_id == object_id, Item.group_ref.in_(groups), Entry.work_date <= as_of,
            ).group_by(Entry.work_id).subquery()
            selected = select(Entry).where(Entry.work_date == as_of).subquery()
            rows = session.execute(select(Item, totals.c.quantity, selected.c.details_json, *[
                totals.c[f"trend_{index}"] for index in range(len(trend_days))
            ]).outerjoin(
                totals, totals.c.work_id == Item.id,
            ).outerjoin(selected, selected.c.work_id == Item.id).where(
                Item.object_id == object_id, Item.group_ref.in_(groups),
            ).order_by(Item.id)).all()
            items = []
            historical_totals = {}
            for row, total, day_json, *past_totals in rows:
                plan = json.loads(row.plan_json)
                if plan["archived"] and not include_archived:
                    continue
                historical_totals[row.id] = past_totals
                initial = _number(plan["initial_quantity"]) if plan["initial_date"] and plan["initial_date"] <= as_of.isoformat() else Decimal(0)
                total = _number(total) + initial
                percent = _percent(plan, total)
                end = plan["revised_end"] or plan["planned_end"]
                items.append({
                    "id": row.id, "group_ref": row.group_ref, "version": row.version, "plan": plan,
                    "total_quantity": float(total), "remaining_quantity": float(_number(plan["planned_quantity"]) - total),
                    "percent": percent,
                    "overdue": bool(end and end < as_of.isoformat() and (percent is None or percent < 100)),
                    "day": json.loads(day_json) if day_json else WorkDayValues(quantity=0).model_dump(mode="json"),
                })
            items.sort(key=lambda i: (i["plan"]["section"], i["plan"]["sort_order"], i["plan"]["name"], i["id"]))
            active_items = [item for item in items if not item["plan"]["archived"]]
            sections = defaultdict(list)
            directions = defaultdict(list)
            for item in active_items:
                sections[(item["group_ref"], item["plan"]["section"])].append(item)
                directions[item["group_ref"]].append(item)
            summary = _summary(active_items)
            if group_ref is None and any(not directions[key] for key in groups):
                summary["percent"] = None
            calculation_sections = []
            if profile:
                result = calculate(profile, active_items, as_of)
                summary.update({key: result[key] for key in ("percent", "calculation")})
                calculation_sections = result["calculation_sections"]
            trend = []
            if summary["percent"] is not None:
                for index, day in enumerate(trend_days):
                    if profile and day < profile.baseline_date:
                        continue  # A cumulative source snapshot is not a daily history.
                    historical = []
                    for item in active_items:
                        plan = item["plan"]
                        total = _number(historical_totals[item["id"]][index])
                        if plan["initial_date"] and plan["initial_date"] <= day.isoformat():
                            total += _number(plan["initial_quantity"])
                        historical.append({**item, "percent": _percent(plan, total), "total_quantity": total})
                    trend.append({"date": day.isoformat(), "percent": calculate(profile, historical, day)["percent"] if profile else _summary(historical)["percent"]})
            direction_summaries = [{"group_ref": key, "name": groups[key], **_summary(directions[key])} for key in groups]
            if profile:
                for direction in direction_summaries:
                    if direction["group_ref"] == profile.group_ref:
                        result = calculate(profile, directions[profile.group_ref], as_of)
                        direction.update({key: result[key] for key in ("percent", "calculation")})
            return {
                "as_of": as_of.isoformat(), "items": items, "summary": summary,
                "sections": [{"group_ref": key[0], "name": key[1], **_summary(values)} for key, values in sections.items()],
                "directions": direction_summaries,
                "calculation_sections": calculation_sections,
                "trend": trend,
            }

    def _audit(self, session, row, actor_id, actor_name, action, before, after):
        session.add(Audit(work_id=row.id, actor_user_id=actor_id, actor_name=actor_name[:255],
                          action=action, before_json=_json(before), after_json=_json(after)))

    def _claim(self, session, row, expected_version):
        changed = session.execute(update(Item).where(Item.id == row.id, Item.version == expected_version).values(
            version=Item.version + 1,
        ).execution_options(synchronize_session=False)).rowcount
        if changed != 1:
            raise WorkConflict("Работу уже изменил другой сотрудник. Обновите таблицу и повторите правку.")

    def save(self, object_id, group_ref, payload, *, actor_id, actor_name, daily=False):
        ids = [str(i.id) for i in payload.items]
        if len(ids) != len(set(ids)):
            raise ValueError("Одна работа не может повторяться в пакете")
        try:
            with self._session() as session:
                object_id, groups = self._scope(session, object_id, group_ref, lock=True)
                group_ref = next(iter(groups))
                for change in sorted(payload.items, key=lambda i: str(i.id)):
                    row = session.get(Item, str(change.id))
                    if row and (row.object_id != object_id or row.group_ref != group_ref):
                        raise WorkNotFound("Работа направления не найдена")
                    if daily:
                        if not row:
                            raise WorkNotFound("Работа направления не найдена")
                        plan = json.loads(row.plan_json)
                        if plan["archived"]:
                            raise ValueError("Нельзя менять факт архивной работы")
                        if plan["initial_date"] and payload.work_date.isoformat() <= plan["initial_date"]:
                            raise ValueError("Дата записи должна быть позже даты начального объёма")
                        if payload.work_date > date.today():
                            raise ValueError("Нельзя вносить выполненные работы за будущую дату")
                        entry = session.scalar(select(Entry).where(Entry.work_id == row.id, Entry.work_date == payload.work_date))
                        before = json.loads(entry.details_json) if entry else None
                        after = WorkDayValues.model_validate(change.model_dump(exclude={"id", "expected_version"})).model_dump(mode="json")
                        if before == after:
                            continue
                        self._claim(session, row, change.expected_version)
                        if entry is None:
                            entry = Entry(work_id=row.id, work_date=payload.work_date)
                            session.add(entry)
                        entry.quantity, entry.details_json = change.quantity, _json(after)
                        self._audit(session, row, actor_id, actor_name, "day", {"date": str(payload.work_date), "values": before}, {"date": str(payload.work_date), "values": after})
                    else:
                        after = change.plan.model_dump(mode="json")
                        before = json.loads(row.plan_json) if row else None
                        if before == after:
                            continue
                        if row is None:
                            if change.expected_version != 0:
                                raise WorkConflict("Работа не найдена. Обновите таблицу.")
                            count = session.scalar(select(func.count()).select_from(Item).where(Item.object_id == object_id))
                            if count >= 5000:
                                raise ValueError("Достигнут лимит 5000 работ объекта")
                            row = Item(id=str(change.id), object_id=object_id, group_ref=group_ref, plan_json=_json(after), version=1)
                            session.add(row)
                            session.flush()
                        else:
                            self._claim(session, row, change.expected_version)
                            if before["unit"] != after["unit"]:
                                has_daily_fact = session.scalar(select(Entry.id).where(
                                    Entry.work_id == row.id, Entry.quantity > 0,
                                ).limit(1)) is not None
                                if _number(before["initial_quantity"]) > 0 or has_daily_fact:
                                    raise ValueError("Нельзя менять единицу измерения после внесения выполненного объёма. Создайте отдельную работу с нужной единицей.")
                            if change.plan.initial_date:
                                first_day = session.scalar(select(func.min(Entry.work_date)).where(Entry.work_id == row.id))
                                if first_day and first_day <= change.plan.initial_date:
                                    raise ValueError("Начальный объём пересекается с уже внесёнными ежедневными записями")
                            row.plan_json = _json(after)
                        self._audit(session, row, actor_id, actor_name, "plan", before, after)
        except IntegrityError as exc:
            raise WorkConflict("Работу уже изменили. Обновите таблицу перед сохранением.") from exc
        return {"saved": len(ids)}

    def history(self, object_id, group_ref, work_id, *, before_id=None, limit=50):
        with self._session() as session:
            object_id, groups = self._scope(session, object_id, group_ref)
            row = session.get(Item, str(work_id))
            if row is None or row.object_id != object_id or row.group_ref not in groups:
                raise WorkNotFound("Работа направления не найдена")
            query = select(Audit).where(Audit.work_id == row.id)
            if before_id:
                query = query.where(Audit.id < before_id)
            rows = session.scalars(query.order_by(Audit.id.desc()).limit(limit + 1)).all()
            return {"items": [{"id": a.id, "actor_name": a.actor_name, "actor_user_id": a.actor_user_id,
                               "changed_at": a.changed_at.isoformat(), "action": a.action,
                               "before": json.loads(a.before_json), "after": json.loads(a.after_json)} for a in rows[:limit]],
                    "next_cursor": rows[limit - 1].id if len(rows) > limit else None}
