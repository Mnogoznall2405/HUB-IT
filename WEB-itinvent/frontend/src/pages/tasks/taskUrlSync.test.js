import { describe, expect, it } from 'vitest';

import {
  applyTaskListFiltersToSearchParams,
  buildAnalyticsRequestParams,
  resolveTaskViewModeFromUrl,
} from './taskUrlSync';
import { TASK_PERSONAL_ROLE_STORAGE_KEY, safeWriteStoredPersonalRole } from './taskUrlState';

describe('taskUrlSync', () => {
  it('resolves view mode with role and permission guards', () => {
    expect(resolveTaskViewModeFromUrl({ viewMode: 'creator', canManageAllTasks: false })).toBe('creator');
    expect(resolveTaskViewModeFromUrl({ viewMode: 'all', canManageAllTasks: false, canUseControllerTab: true })).toBe('assignee');
    safeWriteStoredPersonalRole('creator');
    expect(resolveTaskViewModeFromUrl({ viewMode: '', canManageAllTasks: false })).toBe('creator');
    window.localStorage.removeItem(TASK_PERSONAL_ROLE_STORAGE_KEY);
  });

  it('writes list filters into search params', () => {
    const params = applyTaskListFiltersToSearchParams(new URLSearchParams(), {
      pageMode: 'board',
      viewMode: 'assignee',
      q: 'printer',
      statusFilter: 'new',
      dueState: 'today',
      focusMode: 'overdue',
      hasAttachments: true,
      unreadCommentsOnly: true,
    }, { canManageAllTasks: false });

    expect(params.get('task_mode')).toBe('board');
    expect(params.get('task_q')).toBe('printer');
    expect(params.get('task_files')).toBe('1');
    expect(params.get('task_unread_comments')).toBe('1');
    expect(params.get('task_focus')).toBe('overdue');
  });

  it('omits task_q when debounced search is empty', () => {
    const params = applyTaskListFiltersToSearchParams(new URLSearchParams('task_q=stale'), {
      pageMode: 'list',
      viewMode: 'assignee',
      q: '',
      statusFilter: '',
      dueState: '',
      focusMode: 'all',
    }, { canManageAllTasks: false });

    expect(params.get('task_q')).toBeNull();
  });

  it('builds analytics request params', () => {
    expect(buildAnalyticsRequestParams({
      start_date: '2026-06-01',
      end_date: '2026-06-30',
      project_ids: ['1'],
      participant_user_id: '5',
    })).toEqual({
      start_date: '2026-06-01',
      end_date: '2026-06-30',
      date_basis: 'protocol_date',
      project_id: ['1'],
      participant_user_id: 5,
    });
  });
});
