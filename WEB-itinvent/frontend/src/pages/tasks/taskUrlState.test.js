import { describe, expect, it, beforeEach } from 'vitest';

import {
  hasTaskModeQueryParam,
  readTaskFilters,
  resolveInitialViewMode,
  safeReadStoredPersonalRole,
  safeWriteStoredPersonalRole,
  TASK_PERSONAL_ROLE_STORAGE_KEY,
} from './taskUrlState';

describe('taskUrlState', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reads task filters from query string', () => {
    const filters = readTaskFilters('?task_mode=calendar&task_view=assignee&task_q=printer&task_status=new&task_due=today&task_focus=overdue&task_files=1&task_unread_comments=1');
    expect(filters.taskMode).toBe('calendar');
    expect(filters.viewMode).toBe('assignee');
    expect(filters.q).toBe('printer');
    expect(filters.status).toBe('new');
    expect(filters.dueState).toBe('today');
    expect(filters.focusMode).toBe('overdue');
    expect(filters.hasAttachments).toBe(true);
    expect(filters.unreadCommentsOnly).toBe(true);
  });

  it('resolves initial view mode from url, role, or manage-all', () => {
    expect(resolveInitialViewMode('?task_view=creator', false)).toBe('creator');
    expect(resolveInitialViewMode('', true)).toBe('all');
    safeWriteStoredPersonalRole('creator');
    expect(resolveInitialViewMode('', false)).toBe('creator');
  });

  it('persists personal role in localStorage', () => {
    safeWriteStoredPersonalRole('assignee');
    expect(window.localStorage.getItem(TASK_PERSONAL_ROLE_STORAGE_KEY)).toBe('assignee');
    expect(safeReadStoredPersonalRole()).toBe('assignee');
  });

  it('detects task_mode query param', () => {
    expect(hasTaskModeQueryParam('?task_mode=list')).toBe(true);
    expect(hasTaskModeQueryParam('?task_view=assignee')).toBe(false);
  });
});
