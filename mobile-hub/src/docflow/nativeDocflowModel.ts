import type {
  DocflowAvailableAction,
  DocflowCommand,
  DocflowTaskDetail,
  DocflowTaskSummary,
} from '../api/docflowApi';

export const DOCFLOW_SCOPE_OPTIONS = [
  { value: 'inbox', label: 'Входящие' },
  { value: 'completed', label: 'Выполненные' },
  { value: 'all', label: 'Все' },
] as const;

export function formatDocflowDate(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() <= 1901) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: parsed.getHours() || parsed.getMinutes() ? '2-digit' : undefined,
    minute: parsed.getHours() || parsed.getMinutes() ? '2-digit' : undefined,
  }).format(parsed);
}

export function formatDocflowFileSize(value: unknown): string {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return 'Размер не указан';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let current = size;
  let unit = 0;
  while (current >= 1_024 && unit < units.length - 1) {
    current /= 1_024;
    unit += 1;
  }
  return `${current >= 10 || unit === 0 ? current.toFixed(0) : current.toFixed(1)} ${units[unit]}`;
}

export function docflowTaskStatus(task: DocflowTaskSummary): string {
  if (task.completed) return 'Завершено';
  if (task.accepted) return 'Принято в работу';
  return 'Новое';
}

export function isDocflowTaskOverdue(task: DocflowTaskSummary, now = Date.now()): boolean {
  if (task.completed || !task.due_at) return false;
  const due = new Date(task.due_at).getTime();
  return Number.isFinite(due) && due < now;
}

export function splitDocflowDescription(value: unknown): string[] {
  const raw = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return [];
  const paragraphs = raw.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;
  const lines = raw.split('\n').map((part) => part.trim()).filter(Boolean);
  return lines.length > 1 ? lines : [raw];
}

export function docflowActionRequiresComment(action: DocflowAvailableAction): boolean {
  return action.comment_mode === 'required';
}

export function docflowCommandIsWaiting(command: DocflowCommand | null): boolean {
  return command?.status === 'pending' || command?.status === 'state_unknown';
}

export function mergeAppliedDocflowTask(
  current: DocflowTaskDetail,
  command: DocflowCommand,
): DocflowTaskDetail {
  if (command.task) return command.task;
  if (!['applied', 'already_applied'].includes(command.status)) return current;
  return {
    ...current,
    completed: true,
    completed_at: current.completed_at || new Date().toISOString(),
    available_actions: [],
    state_token: null,
  };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

export function defaultDocflowAssignmentDueFields(now = new Date()): { date: string; time: string } {
  const due = new Date(now.getTime());
  due.setDate(due.getDate() + 1);
  due.setHours(12, 0, 0, 0);
  return {
    date: `${due.getFullYear()}-${twoDigits(due.getMonth() + 1)}-${twoDigits(due.getDate())}`,
    time: `${twoDigits(due.getHours())}:${twoDigits(due.getMinutes())}`,
  };
}

export function buildDocflowAssignmentDueAt(dateValue: string, timeValue: string): string | null {
  const date = String(dateValue || '').trim();
  const time = String(timeValue || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return null;
  const check = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    check.getFullYear() !== year
    || check.getMonth() !== month - 1
    || check.getDate() !== day
    || check.getHours() !== hour
    || check.getMinutes() !== minute
  ) return null;
  return `${date}T${time}:00`;
}
