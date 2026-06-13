import { describe, expect, it } from 'vitest';

import {
  buildCalendarDays,
  buildDeadlineBuckets,
  buildGanttRows,
  buildMobileTaskActionState,
  buildMobileTaskFeed,
  normalizeTaskMode,
  toLocalDateKey,
} from './tasksViewModel';

const now = new Date(2026, 5, 13, 10, 0, 0);

const makeTask = (patch) => ({
  id: patch.id,
  title: patch.title || patch.id,
  status: patch.status || 'new',
  priority: patch.priority || 'normal',
  due_at: patch.due_at || null,
  protocol_date: patch.protocol_date || null,
  created_at: patch.created_at || '2026-06-01T09:00:00',
  updated_at: patch.updated_at || '2026-06-01T09:00:00',
  ...patch,
});

describe('tasks view model', () => {
  it('normalizes supported task modes and falls back to list', () => {
    expect(normalizeTaskMode('calendar')).toBe('calendar');
    expect(normalizeTaskMode('plan')).toBe('list');
    expect(normalizeTaskMode('bad-mode')).toBe('list');
  });

  it('builds deadline buckets from due date and status', () => {
    const buckets = buildDeadlineBuckets([
      makeTask({ id: 'overdue', due_at: new Date(2026, 5, 12, 12).toISOString() }),
      makeTask({ id: 'today', due_at: new Date(2026, 5, 13, 16).toISOString() }),
      makeTask({ id: 'this-week', due_at: new Date(2026, 5, 14, 18).toISOString() }),
      makeTask({ id: 'next-week', due_at: new Date(2026, 5, 18, 18).toISOString() }),
      makeTask({ id: 'no-due' }),
      makeTask({ id: 'later', due_at: new Date(2026, 5, 29, 18).toISOString() }),
      makeTask({ id: 'done', status: 'done', due_at: new Date(2026, 5, 10, 18).toISOString() }),
    ], now);

    const idsByBucket = Object.fromEntries(buckets.map((bucket) => [
      bucket.key,
      bucket.items.map((task) => task.id),
    ]));

    expect(idsByBucket.overdue).toEqual(['overdue']);
    expect(idsByBucket.today).toEqual(['today']);
    expect(idsByBucket.this_week).toEqual(['this-week']);
    expect(idsByBucket.next_week).toEqual(['next-week']);
    expect(idsByBucket.no_due).toEqual(['no-due']);
    expect(idsByBucket.later).toEqual(['later']);
    expect(idsByBucket.done).toEqual(['done']);
  });

  it('builds the mobile feed by urgency and keeps undated tasks', () => {
    const feed = buildMobileTaskFeed([
      makeTask({ id: 'normal-no-due', status: 'new' }),
      makeTask({ id: 'done-task', status: 'done', due_at: new Date(2026, 5, 10, 18).toISOString() }),
      makeTask({ id: 'in-progress', status: 'in_progress', due_at: new Date(2026, 5, 30, 18).toISOString() }),
      makeTask({ id: 'unread', status: 'new', has_unread_comments: true, due_at: new Date(2026, 5, 29, 18).toISOString() }),
      makeTask({ id: 'today', status: 'new', due_at: new Date(2026, 5, 13, 16).toISOString() }),
      makeTask({ id: 'overdue', status: 'new', due_at: new Date(2026, 5, 12, 12).toISOString() }),
      makeTask({ id: 'review', status: 'review', due_at: new Date(2026, 5, 30, 18).toISOString() }),
    ], now);

    expect(feed.map((task) => task.id)).toEqual([
      'overdue',
      'today',
      'unread',
      'review',
      'in-progress',
      'normal-no-due',
      'done-task',
    ]);
  });

  it('builds mobile action state from status and available actions', () => {
    expect(buildMobileTaskActionState(makeTask({ id: 'new', status: 'new' }), {
      canStart: true,
      canSubmit: true,
    })).toEqual(expect.objectContaining({
      key: 'start',
      stepLabel: 'Взять в работу',
      actionLabel: 'Начать',
    }));

    expect(buildMobileTaskActionState(makeTask({ id: 'work', status: 'in_progress' }), {
      canSubmit: true,
    })).toEqual(expect.objectContaining({
      key: 'submit',
      stepLabel: 'Сдать результат',
      actionLabel: 'Сдать',
    }));

    expect(buildMobileTaskActionState(makeTask({ id: 'review', status: 'review' }), {
      canReview: true,
    })).toEqual(expect.objectContaining({
      key: 'review',
      stepLabel: 'Проверить результат',
      actionLabel: 'Проверить',
    }));

    expect(buildMobileTaskActionState(makeTask({ id: 'act', status: 'in_progress' }), {
      canOpenTransferActUpload: true,
    })).toEqual(expect.objectContaining({
      key: 'upload_act',
      stepLabel: 'Загрузить акт',
      actionLabel: 'Загрузить акт',
    }));

    expect(buildMobileTaskActionState(makeTask({ id: 'done', status: 'done' }))).toEqual(expect.objectContaining({
      key: 'done',
      stepLabel: 'Завершено',
      actionLabel: '',
    }));
  });

  it('places due tasks into the calendar grid and counts open tasks without due date', () => {
    const result = buildCalendarDays([
      makeTask({ id: 'calendar-task', due_at: new Date(2026, 5, 13, 16).toISOString() }),
      makeTask({ id: 'no-due-open' }),
      makeTask({ id: 'no-due-done', status: 'done' }),
    ], new Date(2026, 5, 1));

    const targetDay = result.days.find((day) => day.dateKey === '2026-06-13');
    expect(result.days).toHaveLength(42);
    expect(toLocalDateKey(result.monthStart)).toBe('2026-06-01');
    expect(targetDay.items.map((task) => task.id)).toEqual(['calendar-task']);
    expect(result.noDueCount).toBe(1);
  });

  it('builds gantt rows from protocol date to due date and separates tasks without due date', () => {
    const result = buildGanttRows([
      makeTask({
        id: 'timeline-task',
        protocol_date: '2026-06-10',
        due_at: new Date(2026, 5, 20, 18).toISOString(),
      }),
      makeTask({ id: 'no-due-open' }),
    ], {
      start: new Date(2026, 5, 8),
      end: new Date(2026, 5, 22),
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].task.id).toBe('timeline-task');
    expect(result.rows[0].startKey).toBe('2026-06-10');
    expect(result.rows[0].endKey).toBe('2026-06-20');
    expect(result.rows[0].leftPercent).toBeGreaterThan(0);
    expect(result.rows[0].widthPercent).toBeGreaterThan(0);
    expect(result.noDueItems.map((task) => task.id)).toEqual(['no-due-open']);
  });
});
