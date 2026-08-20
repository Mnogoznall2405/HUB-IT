import { describe, expect, it } from 'vitest';

import {
  buildTaskHistoryItems,
  buildTaskWorkspacePrimaryActions,
  formatHubPersonDisplay,
  formatRelativeUpdatedAt,
} from './taskWorkspaceActions';

const task = {
  status: 'in_progress',
  created_by_user_id: 1,
  created_by_full_name: 'Иван Автор',
  assignee_user_id: 2,
  controller_user_id: 3,
  capabilities: { can_submit: false, can_start: false, can_review: false, can_close: true },
};

describe('taskWorkspaceActions', () => {
  it('maps system account names to a human label', () => {
    expect(formatHubPersonDisplay('Announcement Admin', 'feed_admin')).toEqual({
      label: 'Системный контролёр',
      tooltip: 'Announcement Admin',
      isSystem: true,
    });
    expect(formatHubPersonDisplay('Анна Контролёр')).toEqual({
      label: 'Анна Контролёр',
      tooltip: '',
      isSystem: false,
    });
  });

  it('shows a disabled submit action with a creator-specific reason', () => {
    const actions = buildTaskWorkspacePrimaryActions(task, { id: 1 });
    expect(actions).toEqual([
      expect.objectContaining({
        key: 'submit',
        label: 'Отправить на проверку',
        enabled: false,
        reason: 'Недоступно: вы являетесь постановщиком, а не исполнителем',
      }),
      expect.objectContaining({
        key: 'close',
        label: 'Закрыть',
        enabled: true,
      }),
    ]);
  });

  it('shows accept and return actions for a controller on review', () => {
    const actions = buildTaskWorkspacePrimaryActions({
      ...task,
      status: 'review',
      capabilities: { can_review: true, can_close: false },
    }, { id: 3 });
    expect(actions.map((item) => item.label)).toEqual(['Принять', 'Вернуть на доработку', 'Закрыть']);
    expect(actions.filter((item) => item.key !== 'close').every((item) => item.enabled)).toBe(true);
    expect(actions.find((item) => item.key === 'close')).toEqual(expect.objectContaining({
      enabled: false,
      reason: 'Недоступно: закрыть может постановщик, руководитель отдела или администратор',
    }));
  });

  it('lets the creator close a task that is still in progress', () => {
    const actions = buildTaskWorkspacePrimaryActions(task, { id: 1 });
    expect(actions.find((item) => item.key === 'close')).toEqual(expect.objectContaining({
      label: 'Закрыть',
      enabled: true,
    }));
  });

  it('builds a compact history from task timestamps', () => {
    const items = buildTaskHistoryItems({
      created_at: '2026-08-20T10:00:00Z',
      created_by_full_name: 'Announcement Admin',
      submitted_at: '2026-08-20T12:00:00Z',
      completed_at: '2026-08-20T13:00:00Z',
    });
    expect(items.map((item) => item.text)).toEqual([
      'Задача создана · Системный контролёр',
      'Отправлена на проверку',
      'Задача завершена',
    ]);
  });

  it('formats a just-updated timestamp', () => {
    expect(formatRelativeUpdatedAt(new Date().toISOString())).toBe('Обновлено только что');
  });
});
