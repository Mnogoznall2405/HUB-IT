import type { HubTask } from '../api/taskApi';
import {
  buildNativeTaskDeadlines,
  buildNativeTaskGantt,
  buildNativeTaskListParams,
  buildNativeTaskListSections,
  nativeTaskDateKey,
} from './nativeTaskViews';

function task(id: string, status: string, dueAt: string, updatedAt: string): HubTask {
  return { id, title: id, status, due_at: dueAt, updated_at: updatedAt };
}

describe('native task list sections', () => {
  it('keeps completed tasks separate and orders active tasks like the web mobile feed', () => {
    const sections = buildNativeTaskListSections([
      task('new-later', 'new', '2026-09-10T12:00:00Z', '2026-08-27T08:00:00Z'),
      task('in-progress-sooner', 'in_progress', '2026-08-29T12:00:00Z', '2026-08-27T09:00:00Z'),
      task('done', 'done', '2026-08-20T12:00:00Z', '2026-08-27T10:00:00Z'),
    ], new Date('2026-08-27T12:00:00Z'));

    expect(sections.active.items.map((item) => item.id)).toEqual([
      'in-progress-sooner',
      'new-later',
    ]);
    expect(sections.completed.items.map((item) => item.id)).toEqual(['done']);
  });
});

describe('native task deadline buckets', () => {
  // Wednesday 2026-08-26: this week is Aug 24–30, next week Aug 31 – Sep 6.
  const now = new Date(2026, 7, 26, 12);

  it('assigns every task to exactly one web-parity bucket and sorts by due then updated', () => {
    const buckets = buildNativeTaskDeadlines([
      task('done-task', 'done', '', '2026-08-25T10:00:00'),
      task('no-due-task', 'in_progress', '', '2026-08-25T10:00:00'),
      task('overdue-early', 'new', '2026-08-20T10:00:00', '2026-08-25T09:00:00'),
      task('overdue-tie-old', 'new', '2026-08-24T10:00:00', '2026-08-25T07:00:00'),
      task('overdue-tie-new', 'new', '2026-08-24T10:00:00', '2026-08-25T08:00:00'),
      task('today-boundary', 'new', '2026-08-26T23:59:59', '2026-08-25T10:00:00'),
      task('week-boundary', 'new', '2026-08-30T23:59:59', '2026-08-25T10:00:00'),
      task('next-week-boundary', 'new', '2026-09-06T20:00:00', '2026-08-25T10:00:00'),
      task('later-task', 'new', '2026-09-07T00:00:00', '2026-08-25T10:00:00'),
    ], now);

    expect(buckets.map((bucket) => bucket.key)).toEqual([
      'overdue', 'today', 'this_week', 'next_week', 'no_due', 'later', 'done',
    ]);
    const ids = (key: string) => buckets.find((bucket) => bucket.key === key)?.items.map((item) => item.id);
    expect(ids('overdue')).toEqual(['overdue-early', 'overdue-tie-new', 'overdue-tie-old']);
    expect(ids('today')).toEqual(['today-boundary']);
    expect(ids('this_week')).toEqual(['week-boundary']);
    expect(ids('next_week')).toEqual(['next-week-boundary']);
    expect(ids('no_due')).toEqual(['no-due-task']);
    expect(ids('later')).toEqual(['later-task']);
    expect(ids('done')).toEqual(['done-task']);
  });

  it('mirrors the web bucket labels, colors and create-due presets', () => {
    const buckets = buildNativeTaskDeadlines([], now);
    const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
    expect(byKey.get('overdue')).toMatchObject({ label: 'Просрочены', color: '#ef4444', createDueAt: null });
    expect(byKey.get('done')).toMatchObject({ label: 'Завершены', color: '#64748b', createDueAt: null });
    expect(byKey.get('no_due')?.createDueAt).toBe('');
    const todayDue = byKey.get('today')?.createDueAt;
    expect(todayDue).toBeInstanceOf(Date);
    expect((todayDue as Date).getHours()).toBe(18);
    expect(nativeTaskDateKey(todayDue)).toBe('2026-08-26');
    expect(nativeTaskDateKey(byKey.get('this_week')?.createDueAt)).toBe('2026-08-30');
    expect(nativeTaskDateKey(byKey.get('next_week')?.createDueAt)).toBe('2026-09-06');
    expect(nativeTaskDateKey(byKey.get('later')?.createDueAt)).toBe('2026-09-07');
  });
});

describe('native task gantt rows', () => {
  it('positions bars inside the week-aligned range and keeps no-due tasks out of rows', () => {
    const payload = buildNativeTaskGantt([
      { ...task('g-spot', 'new', '2026-08-27T18:00:00', ''), created_at: null, protocol_date: null },
      { ...task('g-span', 'in_progress', '2026-09-02T18:00:00', ''), created_at: '2026-08-24T00:00:00', protocol_date: null },
      task('g-nodue', 'new', '', ''),
      task('g-done-nodue', 'done', '', ''),
    ], new Date(2026, 7, 26, 12));

    expect(payload.noDueItems.map((item) => item.id)).toEqual(['g-nodue']);
    expect(payload.rows.map((row) => row.task.id)).toEqual(['g-spot', 'g-span']);
    expect(nativeTaskDateKey(payload.rangeStart)).toBe('2026-08-24');
    expect(nativeTaskDateKey(payload.rangeEnd)).toBe('2026-09-13');

    const spot = payload.rows[0];
    const span = payload.rows[1];
    // Zero-length bars still render with the minimum 3% width.
    expect(spot.widthPercent).toBe(3);
    // The earliest task start aligns to the range start.
    expect(span.leftPercent).toBe(0);
    payload.rows.forEach((row) => {
      expect(row.leftPercent).toBeGreaterThanOrEqual(0);
      expect(row.leftPercent).toBeLessThanOrEqual(100);
      expect(row.widthPercent).toBeGreaterThanOrEqual(3);
      expect(row.leftPercent + row.widthPercent).toBeLessThanOrEqual(100.0001);
    });
  });
});

describe('native task list params', () => {
  const base = {
    viewMode: 'assignee' as const,
    query: '',
    status: '',
    focusMode: '',
    dueState: '' as const,
    departmentId: '',
    hasAttachments: false,
    unreadCommentsOnly: false,
    sortByDue: false,
    limit: 40,
    offset: 0,
  };

  it('sorts deadline-driven modes by due date ascending', () => {
    (['calendar', 'gantt', 'deadlines'] as const).forEach((pageMode) => {
      expect(buildNativeTaskListParams({ ...base, pageMode })).toMatchObject({
        sort_by: 'due_at',
        sort_dir: 'asc',
      });
    });
    expect(buildNativeTaskListParams({ ...base, pageMode: 'list' })).toMatchObject({
      sort_by: 'updated_at',
      sort_dir: 'desc',
    });
    expect(buildNativeTaskListParams({ ...base, pageMode: 'board' })).toMatchObject({
      sort_by: 'status',
      sort_dir: 'asc',
    });
  });
});
