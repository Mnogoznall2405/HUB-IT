import { describe, expect, it } from 'vitest';

import {
  filterTaskUserOptions,
  formatTaskAssigneesSummary,
  formatHubTaskError,
  getTaskUserLabel,
} from './taskUserUtils';

describe('taskUserUtils', () => {
  const users = [
    { id: 1, full_name: 'Иван Петров', username: 'ivan' },
    { id: 2, full_name: 'Мария Сидорова', username: 'maria' },
  ];

  it('prefers full name for label', () => {
    expect(getTaskUserLabel(users[0])).toBe('Иван Петров');
    expect(getTaskUserLabel({ username: 'guest' })).toBe('guest');
    expect(getTaskUserLabel({ full_name: 'Announcement Admin', username: 'feed_admin' })).toBe('Системный контролёр');
    expect(getTaskUserLabel({})).toBe('Пользователь');
  });

  it('filters users by query', () => {
    const filtered = filterTaskUserOptions(users, { inputValue: 'сидор' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(2);
  });

  it('formats all assignees and provides a compact card label', () => {
    const task = {
      assignee_user_ids: [1, 2, 3],
      assignees: [
        { user_id: 1, full_name: 'Иван Петров' },
        { user_id: 2, full_name: 'Мария Сидорова' },
        { user_id: 3, username: 'guest' },
      ],
    };
    expect(formatTaskAssigneesSummary(task)).toBe('Иван Петров, Мария Сидорова, guest');
    expect(formatTaskAssigneesSummary(task, { compact: true })).toBe('Иван Петров, Мария Сидорова +1');
  });

  it('maps known backend errors to russian messages', () => {
    const error = { response: { data: { detail: 'Task cannot be assigned in the selected department' } } };
    expect(formatHubTaskError(error)).toContain('Нельзя назначить задачу');
    expect(formatHubTaskError({ message: 'plain error' })).toBe('plain error');
    expect(formatHubTaskError({})).toBe('Ошибка создания задачи');
  });
});
