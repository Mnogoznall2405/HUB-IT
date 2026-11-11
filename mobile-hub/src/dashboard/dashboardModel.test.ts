import type { HubDashboardTask } from '../api/hubApi';
import { formatDueLabel, getFirstName, getGreeting } from './dashboardFormat';
import { buildAttentionItems, nearestOpenTasks } from './dashboardModel';

describe('dashboard format', () => {
  it('resolves greeting and first name', () => {
    expect(getGreeting(new Date('2026-08-24T08:00:00'))).toBe('Доброе утро');
    expect(getFirstName({
      id: 1,
      username: 'ivanov',
      full_name: 'Иванов Иван Петрович',
      role: 'user',
      permissions: [],
    })).toBe('Иван');
  });

  it('formats due labels', () => {
    const now = new Date('2026-08-24T12:00:00');
    expect(formatDueLabel(undefined, now)).toBe('Без срока');
    expect(formatDueLabel('2026-08-24T15:30:00', now)).toBe('Сегодня · 15:30');
    expect(formatDueLabel('2026-08-25T09:00:00', now)).toBe('Завтра · 09:00');
    expect(formatDueLabel('2026-08-20T09:00:00', now)).toMatch(/^Просрочено/);
  });
});

describe('dashboard model', () => {
  const overdue: HubDashboardTask = {
    id: '1',
    title: 'Просрочена',
    status: 'open',
    is_overdue: true,
    due_at: '2026-08-01T10:00:00',
  };
  const review: HubDashboardTask = {
    id: '2',
    title: 'На проверке',
    status: 'review',
    created_by_user_id: 7,
  };
  const comments: HubDashboardTask = {
    id: '3',
    title: 'Комментарий',
    status: 'open',
    has_unread_comments: true,
  };

  it('builds attention items in overdue-review-comments-ack order', () => {
    const items = buildAttentionItems(
      [comments, review, overdue],
      [{ id: 'a1', title: 'Объявление', is_ack_pending: true }],
      { id: 7, username: 'user', role: 'user', permissions: [] },
    );
    expect(items.map((item) => item.kind)).toEqual(['overdue', 'review', 'comments', 'ack']);
  });

  it('returns the five nearest open tasks', () => {
    const nearest = nearestOpenTasks([
      { id: 'done', status: 'done', due_at: '2026-08-01' },
      { id: 'late', status: 'open', due_at: '2026-09-01' },
      { id: 'soon', status: 'open', due_at: '2026-08-25' },
    ]);
    expect(nearest.map((item) => item.id)).toEqual(['soon', 'late']);
  });
});
