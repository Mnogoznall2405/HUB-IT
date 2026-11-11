export type NativeTasksDestination =
  | {
      pathname: '/(shell)/tasks';
      params?: {
        q?: string;
        status?: string;
        focusMode?: string;
        taskMode?: string;
        taskView?: string;
        taskDue?: string;
        taskFiles?: string;
        taskUnread?: string;
        taskAssignee?: string;
        taskController?: string;
        taskDepartment?: string;
        taskSort?: string;
      };
    }
  | { pathname: '/(shell)/tasks/create' }
  | { pathname: '/(shell)/tasks/analytics' }
  | {
      pathname: '/(shell)/tasks/[taskId]';
      params: { taskId: string };
    };

const SUPPORTED_LIST_PARAMS = new Set([
  'q',
  'status',
  'focus_mode',
  'task_q',
  'task_status',
  'task_focus',
  'task_mode',
  'task_view',
  'task_due',
  'task_files',
  'task_unread_comments',
  'task_assignee',
  'task_controller',
  'task_department',
  'task_date_sort',
]);

const NATIVE_TASK_DATA_MODES = new Set(['list']);

export function parseNativeTasksEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function resolveNativeTasksEnabled(value: string | undefined): boolean {
  return value === undefined ? true : parseNativeTasksEnabled(value);
}

export const NATIVE_TASKS_ENABLED = resolveNativeTasksEnabled(
  process.env.EXPO_PUBLIC_NATIVE_TASKS_ENABLED,
);

export function nativeTasksDestinationFromPortalPath(path: string): NativeTasksDestination | null {
  const raw = String(path || '').trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw, 'https://hubit.invalid');
  } catch {
    return null;
  }
  if (parsed.origin !== 'https://hubit.invalid' || parsed.pathname !== '/tasks' || parsed.hash) {
    return null;
  }

  const keys = Array.from(parsed.searchParams.keys());
  const taskId = String(
    parsed.searchParams.get('task') || parsed.searchParams.get('task_id') || '',
  ).trim();
  if (taskId) {
    if (keys.some((key) => !['task', 'task_id'].includes(key))) return null;
    return {
      pathname: '/(shell)/tasks/[taskId]',
      params: { taskId },
    };
  }

  const create = String(parsed.searchParams.get('create') || '').trim();
  if (create) {
    if (create !== '1' || keys.some((key) => key !== 'create')) return null;
    return { pathname: '/(shell)/tasks/create' };
  }

  const legacyView = String(parsed.searchParams.get('view') || '').trim();
  if (legacyView) {
    if (legacyView !== 'analytics' || keys.length !== 1 || keys[0] !== 'view') return null;
    return { pathname: '/(shell)/tasks/analytics' };
  }

  const taskMode = String(parsed.searchParams.get('task_mode') || '').trim().toLowerCase();
  if (taskMode === 'analytics') {
    if (keys.length !== 1 || keys[0] !== 'task_mode') return null;
    return { pathname: '/(shell)/tasks/analytics' };
  }
  if (taskMode && !NATIVE_TASK_DATA_MODES.has(taskMode)) return null;

  if (keys.some((key) => !SUPPORTED_LIST_PARAMS.has(key))) return null;
  const params: NonNullable<Extract<NativeTasksDestination, { pathname: '/(shell)/tasks' }>['params']> = {};
  const assign = (key: keyof typeof params, value: string) => {
    if (value) params[key] = value;
  };
  assign('q', String(parsed.searchParams.get('task_q') || parsed.searchParams.get('q') || '').trim());
  assign('status', String(parsed.searchParams.get('task_status') || parsed.searchParams.get('status') || '').trim());
  assign('focusMode', String(parsed.searchParams.get('task_focus') || parsed.searchParams.get('focus_mode') || '').trim());
  assign('taskMode', taskMode);
  assign('taskView', String(parsed.searchParams.get('task_view') || '').trim());
  assign('taskDue', String(parsed.searchParams.get('task_due') || '').trim());
  if (parsed.searchParams.get('task_files') === '1') params.taskFiles = '1';
  if (parsed.searchParams.get('task_unread_comments') === '1') params.taskUnread = '1';
  assign('taskAssignee', String(parsed.searchParams.get('task_assignee') || '').trim());
  assign('taskController', String(parsed.searchParams.get('task_controller') || '').trim());
  assign('taskDepartment', String(parsed.searchParams.get('task_department') || '').trim());
  if (parsed.searchParams.get('task_date_sort') === 'asc') params.taskSort = 'asc';
  return Object.values(params).some(Boolean)
    ? { pathname: '/(shell)/tasks', params }
    : { pathname: '/(shell)/tasks' };
}
