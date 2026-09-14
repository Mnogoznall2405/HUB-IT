"""Shared weekly plan and daily reports, locked at object scope."""
from contextlib import contextmanager
from datetime import date, timedelta
import json
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from backend.appdb.db import app_session
from backend.appdb.models import AppConstructionWeekPlan as Week, AppConstructionDayCrew as Day, AppConstructionPlanningAudit as Audit
from backend.appdb.models import AppConstructionWorkItem as Item, AppConstructionWorkEntry as Entry
from backend.models.construction_work import WorkDayBatch
from backend.services.construction_work_service import ConstructionWorkService, WorkConflict, WorkNotFound, _json


def monday(day):
    return day - timedelta(days=day.weekday())


EMPTY = {'targets': [], 'crews': [], 'comment': ''}


class ConstructionPlanningService:
    def __init__(self, database_url=None):
        self.database_url = database_url

    def _work(self, session):
        @contextmanager
        def shared(database_url=None):
            yield session
            session.flush()
        return ConstructionWorkService(self.database_url, session_factory=shared)

    def _audit(self, session, object_id, period, kind, actor_id, actor_name, before, after):
        session.add(Audit(object_id=object_id, period=period, kind=kind, actor_user_id=actor_id,
                          actor_name=actor_name[:255], before_json=_json(before), after_json=_json(after)))

    def read(self, object_id, group_ref, day):
        with app_session(self.database_url) as session:
            work = self._work(session)
            object_id, groups = work._scope(session, object_id, group_ref)
            native = work.read(object_id, group_ref, as_of=day)
            start = monday(day)
            week = session.get(Week, (object_id, start))
            crew_day = session.get(Day, (object_id, day))
            plan = json.loads(week.payload_json) if week else dict(EMPTY)
            # Includes other directions' reservations so a shared crew is never
            # counted as available again in another direction of the same object.
            totals, recorded, month_actual, month_totals = {}, set(), {}, {}
            month_first = day.replace(day=1)
            month_next = (month_first.replace(day=28) + timedelta(days=4)).replace(day=1)
            month_start, month_end = monday(month_first), monday(month_next - timedelta(days=1)) + timedelta(days=6)
            for work_id, recorded_day, quantity in session.execute(select(Entry.work_id, Entry.work_date, Entry.quantity).join(Item, Item.id == Entry.work_id).where(
                Item.object_id == object_id, Item.group_ref.in_(groups), Entry.work_date >= month_start, Entry.work_date <= min(month_end, date.today()))):
                bucket = month_actual.setdefault(monday(recorded_day).isoformat(), {})
                bucket[work_id] = bucket.get(work_id, 0) + float(quantity)
                if month_first <= recorded_day < month_next:
                    month_totals[work_id] = month_totals.get(work_id, 0) + float(quantity)
                if start <= recorded_day <= day:
                    totals[work_id] = totals.get(work_id, 0) + float(quantity)
                if recorded_day == day: recorded.add(work_id)
            month_plans = {}
            for period, payload in session.execute(select(Week.week_start, Week.payload_json).where(Week.object_id == object_id, Week.week_start >= month_start, Week.week_start <= month_end)):
                month_plans[period.isoformat()] = json.loads(payload)['targets']
            return {**native, 'week_start': start.isoformat(), 'week_end': (start + timedelta(days=6)).isoformat(),
                    'week_version': week.version if week else 0, 'plan': plan,
                    'baseline': json.loads(week.baseline_json) if week else None,
                    'crew_version': crew_day.version if crew_day else 0,
                    'crew_day': json.loads(crew_day.payload_json) if crew_day else {},
                    'weekly_actual': totals, 'recorded_ids': sorted(recorded),
                    'month_plans': month_plans, 'month_actual': month_actual, 'month_totals': month_totals}

    def save_week(self, object_id, group_ref, payload, *, actor_id, actor_name):
        try:
            with app_session(self.database_url) as session:
                work = self._work(session)
                object_id, _ = work._scope(session, object_id, group_ref, lock=True)
                _, groups = work._scope(session, object_id)
                items = {row.id: row for row in session.scalars(select(Item).where(Item.object_id == object_id))}
                after = payload.plan.model_dump(mode='json')
                for target in after['targets']:
                    row = items.get(target['work_id'])
                    if row is None or row.group_ref not in groups: raise WorkNotFound('Работа плана не относится к объекту')
                    if json.loads(row.plan_json)['archived']: raise ValueError('Нельзя планировать архивную работу')
                assignments = {a['id']: a for c in after['crews'] for a in c['assignments']}
                for assignment in assignments.values():
                    if assignment['group_ref'] not in groups: raise WorkNotFound('Назначение не относится к объекту')
                    if any(w not in items or items[w].group_ref != assignment['group_ref'] or json.loads(items[w].plan_json)['archived'] for w in assignment['work_ids']):
                        raise ValueError('Работы назначения должны быть действующими работами одного направления')
                week = session.get(Week, (object_id, payload.week_start))
                before = json.loads(week.payload_json) if week else None
                if before == after: return {'version': week.version}
                # Reported assignments retain identity and scope. Transfers use
                # a new week; old attendance cannot disappear after an edit.
                old = {a['id']: (c['id'], a) for c in (before or EMPTY)['crews'] for a in c['assignments']}
                owners = {a['id']: c['id'] for c in after['crews'] for a in c['assignments']}
                for raw in session.scalars(select(Day.payload_json).where(Day.object_id == object_id, Day.work_date >= payload.week_start, Day.work_date <= payload.week_start + timedelta(days=6))):
                    for assignment_id in json.loads(raw):
                        if assignment_id not in assignments or assignment_id not in old or old[assignment_id][0] != owners[assignment_id] or any(old[assignment_id][1][key] != assignments[assignment_id][key] for key in ('group_ref','work_ids')):
                            raise ValueError('У назначения есть дневная сводка; сохраните его состав работ и бригаду')
                if week:
                    claimed = session.execute(update(Week).where(Week.object_id == object_id, Week.week_start == payload.week_start, Week.version == payload.expected_version).values(version=Week.version + 1, payload_json=_json(after)))
                    if claimed.rowcount != 1: raise WorkConflict('Недельный план уже изменили. Обновите данные')
                else:
                    if payload.expected_version != 0: raise WorkConflict('Недельный план не найден')
                    session.add(Week(object_id=object_id, week_start=payload.week_start, version=1, payload_json=_json(after), baseline_json=_json(after)))
                self._audit(session, object_id, payload.week_start, 'week', actor_id, actor_name, before, after)
        except IntegrityError as exc:
            raise WorkConflict('План изменили параллельно. Обновите данные') from exc
        return {'version': payload.expected_version + 1}

    def save_day(self, object_id, group_ref, payload, *, actor_id, actor_name):
        try:
            with app_session(self.database_url) as session:
                work = self._work(session)
                object_id, _ = work._scope(session, object_id, group_ref, lock=True)
                week = session.get(Week, (object_id, monday(payload.work_date)))
                if (week.version if week else 0) != payload.expected_week_version: raise WorkConflict('Недельный план изменён. Обновите сводку')
                plan = json.loads(week.payload_json) if week else EMPTY
                assignments = {a['id']: {**a, 'crew_name': c['name'], 'specialty': c['specialty'], 'crew_id': c['id']} for c in plan['crews'] for a in c['assignments']}
                current = session.get(Day, (object_id, payload.work_date))
                before = json.loads(current.payload_json) if current else {}
                after = dict(before)
                for attendance in payload.crews:
                    assignment = assignments.get(str(attendance.assignment_id))
                    if assignment is None or assignment['group_ref'] != group_ref: raise WorkNotFound('Назначение бригады не найдено в этом направлении')
                    after[str(attendance.assignment_id)] = {**assignment, **attendance.model_dump(mode='json')}
                if before != after:
                    if current:
                        claimed = session.execute(update(Day).where(Day.object_id == object_id, Day.work_date == payload.work_date, Day.version == payload.expected_crew_version).values(version=Day.version + 1, payload_json=_json(after)))
                        if claimed.rowcount != 1: raise WorkConflict('Состав дневной сводки уже изменили')
                    else:
                        if payload.expected_crew_version != 0: raise WorkConflict('Сводка людей не найдена')
                        session.add(Day(object_id=object_id, work_date=payload.work_date, version=1, payload_json=_json(after)))
                    self._audit(session, object_id, payload.work_date, 'crews', actor_id, actor_name, before, after)
                if payload.items:
                    work.save(object_id, group_ref, WorkDayBatch(work_date=payload.work_date, items=payload.items), actor_id=actor_id, actor_name=actor_name, daily=True)
        except IntegrityError as exc:
            raise WorkConflict('Сводку изменили параллельно. Обновите данные') from exc
        return {'saved': len(payload.items), 'crews_saved': len(payload.crews)}

    def history(self, object_id, group_ref, period, before_id=None):
        with app_session(self.database_url) as session:
            object_id, _ = self._work(session)._scope(session, object_id, group_ref)
            query = select(Audit).where(Audit.object_id == object_id, Audit.period == period)
            if before_id: query = query.where(Audit.id < before_id)
            rows = session.scalars(query.order_by(Audit.id.desc()).limit(31)).all()
            return {'items': [{'id': r.id, 'kind': r.kind, 'actor_name': r.actor_name, 'changed_at': r.changed_at.isoformat(), 'before': json.loads(r.before_json), 'after': json.loads(r.after_json)} for r in rows[:30]], 'next_cursor': rows[29].id if len(rows) > 30 else None}
