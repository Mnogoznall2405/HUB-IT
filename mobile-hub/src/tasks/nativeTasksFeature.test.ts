import {
  nativeTasksDestinationFromPortalPath,
  parseNativeTasksEnabled,
  resolveNativeTasksEnabled,
} from './nativeTasksFeature';

describe('nativeTasksFeature', () => {
  it('enables the source candidate by default and accepts explicit boolean values', () => {
    expect(resolveNativeTasksEnabled(undefined)).toBe(true);
    expect(parseNativeTasksEnabled('true')).toBe(true);
    expect(parseNativeTasksEnabled('0')).toBe(false);
  });

  it('maps supported task list, filter, create and detail paths', () => {
    expect(nativeTasksDestinationFromPortalPath('/tasks')).toEqual({ pathname: '/(shell)/tasks' });
    expect(nativeTasksDestinationFromPortalPath('/tasks?q=server&status=review&focus_mode=comments')).toEqual({
      pathname: '/(shell)/tasks',
      params: { q: 'server', status: 'review', focusMode: 'comments' },
    });
    expect(nativeTasksDestinationFromPortalPath('/tasks?task_q=server&task_status=review&task_focus=comments&task_view=department&task_due=today&task_files=1&task_unread_comments=1&task_controller=8&task_department=dep-1&task_date_sort=asc')).toEqual({
      pathname: '/(shell)/tasks',
      params: {
        q: 'server',
        status: 'review',
        focusMode: 'comments',
        taskView: 'department',
        taskDue: 'today',
        taskFiles: '1',
        taskUnread: '1',
        taskController: '8',
        taskDepartment: 'dep-1',
        taskSort: 'asc',
      },
    });
    expect(nativeTasksDestinationFromPortalPath('/tasks?create=1')).toEqual({ pathname: '/(shell)/tasks/create' });
    expect(nativeTasksDestinationFromPortalPath('/tasks?view=analytics')).toEqual({ pathname: '/(shell)/tasks/analytics' });
    expect(nativeTasksDestinationFromPortalPath('/tasks?task_mode=analytics')).toEqual({ pathname: '/(shell)/tasks/analytics' });
    expect(nativeTasksDestinationFromPortalPath('/tasks?task=task%2F7')).toEqual({
      pathname: '/(shell)/tasks/[taskId]',
      params: { taskId: 'task/7' },
    });
  });

  it('rejects unsupported and unsafe task routes before native navigation', () => {
    expect(nativeTasksDestinationFromPortalPath('/tasks?view=board')).toBeNull();
    expect(nativeTasksDestinationFromPortalPath('/tasks?view=analytics&q=x')).toBeNull();
    expect(nativeTasksDestinationFromPortalPath('/tasks?task_mode=board')).toBeNull();
    expect(nativeTasksDestinationFromPortalPath('/tasks?create=android-share')).toBeNull();
    expect(nativeTasksDestinationFromPortalPath('//evil.example/tasks')).toBeNull();
    expect(nativeTasksDestinationFromPortalPath('/tasks#section')).toBeNull();
  });
});
