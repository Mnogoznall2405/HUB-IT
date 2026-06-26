import { describe, expect, it } from 'vitest';

import {
  filterTaskUserOptions,
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
    expect(getTaskUserLabel({})).toBe('Пользователь');
  });

  it('filters users by query', () => {
    const filtered = filterTaskUserOptions(users, { inputValue: 'сидор' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(2);
  });

  it('maps known backend errors to russian messages', () => {
    const error = { response: { data: { detail: 'Task cannot be assigned in the selected department' } } };
    expect(formatHubTaskError(error)).toContain('Нельзя назначить задачу');
    expect(formatHubTaskError({ message: 'plain error' })).toBe('plain error');
    expect(formatHubTaskError({})).toBe('Ошибка создания задачи');
  });
});
