import { describe, expect, it } from 'vitest';

import { classifyRealtimeTaskChange } from './taskRealtimeMembership';

const row = { id: 'A', status: 'new', assignee_user_ids: [2], created_by_user_id: 1, controller_user_id: 3 };

describe('classifyRealtimeTaskChange', () => {
  it('drops a row whose status no longer matches the status filter', () => {
    expect(classifyRealtimeTaskChange({
      task: { ...row, status: 'in_progress' }, existingItem: row, filters: { statusFilter: 'new' },
    })).toBe('remove');
  });

  it('reloads when a task outside the page now matches the filter', () => {
    expect(classifyRealtimeTaskChange({
      task: { ...row, status: 'new' }, existingItem: null, filters: { statusFilter: 'new' },
    })).toBe('reload');
  });

  it('does not refetch the page for an unseen task when the list is unfiltered', () => {
    expect(classifyRealtimeTaskChange({
      task: row, existingItem: null, filters: { viewMode: 'all' },
    })).toBe('ignore');
  });

  it('ignores a non-matching task that is not on screen and patches a matching visible one', () => {
    expect(classifyRealtimeTaskChange({
      task: { ...row, status: 'done' }, existingItem: null, filters: { statusFilter: 'new' },
    })).toBe('ignore');
    expect(classifyRealtimeTaskChange({
      task: { ...row, title: 'renamed' }, existingItem: row, filters: { statusFilter: 'new' },
    })).toBe('patch');
  });

  it('reloads on any change while a server-only filter (due, unread, focus, search) is active', () => {
    expect(classifyRealtimeTaskChange({
      task: row, existingItem: row, filters: { serverOnlyFilterActive: true },
    })).toBe('reload');
  });

  it('reloads when reassignment changes membership of a "my tasks" scope', () => {
    expect(classifyRealtimeTaskChange({
      task: { ...row, assignee_user_ids: [9] }, existingItem: row, filters: { viewMode: 'assignee' },
    })).toBe('reload');
    expect(classifyRealtimeTaskChange({
      task: { ...row, assignee_user_ids: [9] }, existingItem: row, filters: { viewMode: 'all' },
    })).toBe('patch');
  });

  it('applies department and server-side assignee filters', () => {
    expect(classifyRealtimeTaskChange({
      task: { ...row, department_id: 'd2' }, existingItem: { ...row, department_id: 'd1' },
      filters: { departmentFilter: 'd1' },
    })).toBe('remove');
    expect(classifyRealtimeTaskChange({
      task: { ...row, assignee_user_ids: [5] }, existingItem: row,
      filters: { assigneeFilter: '2', assigneeFilteredOnServer: true },
    })).toBe('remove');
  });
});
