import type { HubTask, TaskListParams } from '../api/taskApi';

export type NativeTaskPageMode = 'list' | 'board' | 'calendar' | 'gantt';

export const NATIVE_TASK_PAGE_MODES: Array<{
  value: NativeTaskPageMode;
  label: string;
  icon: 'format-list-bulleted' | 'view-column-outline' | 'calendar-month-outline' | 'chart-gantt';
}> = [
  { value: 'list', label: 'Список', icon: 'format-list-bulleted' },
  { value: 'board', label: 'Доска', icon: 'view-column-outline' },
  { value: 'calendar', label: 'Календарь', icon: 'calendar-month-outline' },
  { value: 'gantt', label: 'Гант', icon: 'chart-gantt' },
];

export const NATIVE_TASK_BOARD_COLUMNS = [
  { key: 'new', title: 'Новое', color: '#2563eb' },
  { key: 'in_progress', title: 'В работе', color: '#d97706' },
  { key: 'review', title: 'На проверке', color: '#7c3aed' },
  { key: 'done', title: 'Готово', color: '#059669' },
] as const;

export function normalizeNativeTaskPageMode(value: unknown): NativeTaskPageMode {
  const normalized = String(value || '').trim().toLowerCase();
  return NATIVE_TASK_PAGE_MODES.some((item) => item.value === normalized)
    ? normalized as NativeTaskPageMode
    : 'list';
}

export function buildNativeTaskListParams({
  pageMode,
  viewMode,
  query,
  status,
  focusMode,
  dueState,
  departmentId,
  controllerUserId,
  assigneeUserId,
  hasAttachments,
  unreadCommentsOnly,
  sortByDue,
  limit,
  offset,
}: {
  pageMode: NativeTaskPageMode;
  viewMode: 'assignee' | 'creator' | 'controller' | 'department' | 'all';
  query: string;
  status: string;
  focusMode: string;
  dueState: '' | 'overdue' | 'today' | 'upcoming' | 'none';
  departmentId: string;
  controllerUserId?: number;
  assigneeUserId?: number;
  hasAttachments: boolean;
  unreadCommentsOnly: boolean;
  sortByDue: boolean;
  limit: number;
  offset: number;
}): TaskListParams {
  const deadlineMode = pageMode === 'calendar' || pageMode === 'gantt';
  return {
    q: query.trim(),
    status,
    focus_mode: focusMode === 'all' ? '' : focusMode as TaskListParams['focus_mode'],
    scope: viewMode === 'all' ? 'all' : viewMode === 'department' ? 'department' : 'my',
    role_scope: viewMode === 'all' || viewMode === 'department' ? 'both' : viewMode,
    due_state: dueState,
    department_id: departmentId,
    controller_user_id: controllerUserId,
    assignee_user_id: viewMode === 'all' ? assigneeUserId : undefined,
    has_attachments: hasAttachments,
    unread_comments_only: unreadCommentsOnly,
    sort_by: pageMode === 'board' ? 'status' : deadlineMode || sortByDue ? 'due_at' : 'updated_at',
    sort_dir: pageMode === 'board' || deadlineMode || sortByDue ? 'asc' : 'desc',
    limit,
    offset,
  };
}

export type NativeTaskBoardSection = {
  key: string;
  title: string;
  color: string;
  data: HubTask[];
};

export function buildNativeTaskBoardSections(tasks: HubTask[]): NativeTaskBoardSection[] {
  const grouped = new Map<string, HubTask[]>(NATIVE_TASK_BOARD_COLUMNS.map((column) => [column.key, []]));
  tasks.forEach((task) => {
    const status = String(task.status || '').trim().toLowerCase();
    (grouped.get(status) || grouped.get('new'))?.push(task);
  });
  return NATIVE_TASK_BOARD_COLUMNS.map((column) => ({
    ...column,
    data: grouped.get(column.key) || [],
  }));
}

export type NativeTaskListSections = {
  active: { items: HubTask[] };
  completed: { items: HubTask[] };
};

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function endOfDay(value: Date): Date {
  const result = startOfDay(value);
  result.setHours(23, 59, 59, 999);
  return result;
}

function compareTasksByDueThenUpdated(left: HubTask, right: HubTask): number {
  const leftDue = parseDate(left.due_at)?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightDue = parseDate(right.due_at)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (leftDue !== rightDue) return leftDue - rightDue;
  const leftUpdated = parseDate(left.updated_at || left.created_at)?.getTime() ?? 0;
  const rightUpdated = parseDate(right.updated_at || right.created_at)?.getTime() ?? 0;
  return rightUpdated - leftUpdated;
}

function mobileTaskFeedRank(task: HubTask, now: Date): number {
  if (String(task.status || '').trim().toLowerCase() === 'done') return 6;
  const dueAt = parseDate(task.due_at);
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const status = String(task.status || '').trim().toLowerCase();
  if (task.is_overdue || (dueAt && dueAt < todayStart)) return 0;
  if (dueAt && dueAt <= todayEnd) return 1;
  if (task.has_unread_comments) return 2;
  if (status === 'review') return 3;
  if (status === 'in_progress') return 4;
  return 5;
}

export function buildNativeTaskListSections(
  tasks: HubTask[],
  now = new Date(),
): NativeTaskListSections {
  const sortFeed = (source: HubTask[]) => [...source].sort((left, right) => {
    const rankDifference = mobileTaskFeedRank(left, now) - mobileTaskFeedRank(right, now);
    return rankDifference || compareTasksByDueThenUpdated(left, right);
  });
  const source = Array.isArray(tasks) ? tasks : [];
  return {
    active: { items: sortFeed(source.filter((task) => String(task.status || '').trim().toLowerCase() !== 'done')) },
    completed: { items: sortFeed(source.filter((task) => String(task.status || '').trim().toLowerCase() === 'done')) },
  };
}

function addDays(value: Date, days: number): Date {
  const result = startOfDay(value);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfWeek(value: Date): Date {
  const result = startOfDay(value);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

function endOfWeek(value: Date): Date {
  return endOfDay(addDays(startOfWeek(value), 6));
}

export function nativeTaskDateKey(value: unknown): string {
  const date = parseDate(value);
  if (!date) return '';
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function sortTasksByDue(items: HubTask[]): HubTask[] {
  return [...items].sort(compareTasksByDueThenUpdated);
}

export type NativeTaskCalendarDay = {
  date: Date;
  dateKey: string;
  inMonth: boolean;
  isToday: boolean;
  items: HubTask[];
};

export type NativeTaskCalendarPayload = {
  days: NativeTaskCalendarDay[];
  monthStart: Date;
  monthEnd: Date;
  noDueItems: HubTask[];
};

export function buildNativeTaskCalendar(
  tasks: HubTask[],
  month: Date,
  now = new Date(),
): NativeTaskCalendarPayload {
  const sourceMonth = parseDate(month) || now;
  const monthStart = new Date(sourceMonth.getFullYear(), sourceMonth.getMonth(), 1);
  const monthEnd = endOfDay(new Date(sourceMonth.getFullYear(), sourceMonth.getMonth() + 1, 0));
  const gridStart = startOfWeek(monthStart);
  const byDate = new Map<string, NativeTaskCalendarDay>();
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index);
    const dateKey = nativeTaskDateKey(date);
    const day: NativeTaskCalendarDay = {
      date,
      dateKey,
      inMonth: date.getMonth() === monthStart.getMonth(),
      isToday: dateKey === nativeTaskDateKey(now),
      items: [],
    };
    byDate.set(dateKey, day);
    return day;
  });
  const noDueItems: HubTask[] = [];
  tasks.forEach((task) => {
    const dueAt = parseDate(task.due_at);
    if (!dueAt) {
      if (String(task.status || '').toLowerCase() !== 'done') noDueItems.push(task);
      return;
    }
    byDate.get(nativeTaskDateKey(dueAt))?.items.push(task);
  });
  days.forEach((day) => { day.items = sortTasksByDue(day.items); });
  return { days, monthStart, monthEnd, noDueItems: sortTasksByDue(noDueItems) };
}

export type NativeTaskGanttRow = {
  task: HubTask;
  start: Date;
  end: Date;
  startKey: string;
  endKey: string;
  leftPercent: number;
  widthPercent: number;
};

export type NativeTaskGanttPayload = {
  rows: NativeTaskGanttRow[];
  rangeStart: Date;
  rangeEnd: Date;
  noDueItems: HubTask[];
};

export function buildNativeTaskGantt(tasks: HubTask[], now = new Date()): NativeTaskGanttPayload {
  const noDueItems: HubTask[] = [];
  const sourceRows: Array<{ task: HubTask; start: Date; end: Date }> = [];
  tasks.forEach((task) => {
    const dueAt = parseDate(task.due_at);
    if (!dueAt) {
      if (String(task.status || '').toLowerCase() !== 'done') noDueItems.push(task);
      return;
    }
    const proposedStart = parseDate(task.protocol_date) || parseDate(task.created_at) || dueAt;
    sourceRows.push({ task, start: proposedStart > dueAt ? dueAt : proposedStart, end: dueAt });
  });
  const rangeStart = sourceRows.length
    ? startOfWeek(new Date(Math.min(...sourceRows.map((row) => row.start.getTime()))))
    : startOfWeek(now);
  const latestEnd = sourceRows.length
    ? new Date(Math.max(...sourceRows.map((row) => row.end.getTime())))
    : addDays(rangeStart, 35);
  const rangeEnd = endOfDay(addDays(endOfWeek(latestEnd), 7));
  const totalMs = Math.max(1, rangeEnd.getTime() - rangeStart.getTime());
  const rows = sourceRows
    .sort((left, right) => left.end.getTime() - right.end.getTime())
    .map((row) => {
      const clampedStart = Math.max(row.start.getTime(), rangeStart.getTime());
      const clampedEnd = Math.min(row.end.getTime(), rangeEnd.getTime());
      const leftPercent = Math.max(0, Math.min(100, ((clampedStart - rangeStart.getTime()) / totalMs) * 100));
      const rawWidth = ((clampedEnd - clampedStart) / totalMs) * 100;
      return {
        ...row,
        startKey: nativeTaskDateKey(row.start),
        endKey: nativeTaskDateKey(row.end),
        leftPercent,
        widthPercent: Math.max(3, Math.min(100 - leftPercent, rawWidth || 3)),
      };
    });
  return { rows, rangeStart, rangeEnd, noDueItems: sortTasksByDue(noDueItems) };
}
