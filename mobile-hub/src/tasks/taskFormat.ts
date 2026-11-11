import type { HubTask, TaskAttachment } from '../api/taskApi';

export const TASK_STATUS_OPTIONS = [
  { value: '', label: 'Все' },
  { value: 'new', label: 'Новые' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'review', label: 'На проверке' },
  { value: 'done', label: 'Готово' },
] as const;

export const TASK_FOCUS_OPTIONS = [
  { value: '', label: 'Все задачи' },
  { value: 'review', label: 'К проверке' },
  { value: 'overdue', label: 'Просроченные' },
  { value: 'comments', label: 'Новые комментарии' },
] as const;

export const TASK_PRIORITY_OPTIONS = [
  { value: 'low', label: 'Низкий' },
  { value: 'normal', label: 'Обычный' },
  { value: 'high', label: 'Высокий' },
  { value: 'urgent', label: 'Срочный' },
] as const;

export const TASK_PRIORITY_LABELS: Record<string, string> = Object.fromEntries(
  TASK_PRIORITY_OPTIONS.map((item) => [item.value, item.label]),
);

export function formatTaskDate(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) return 'Без срока';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: parsed.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: text.includes('T') ? '2-digit' : undefined,
    minute: text.includes('T') ? '2-digit' : undefined,
  }).format(parsed);
}

export function taskPerson(task: HubTask, role: 'assignee' | 'controller' | 'created_by'): string {
  if (role === 'assignee') {
    const assignees = Array.isArray(task.assignees) ? task.assignees : [];
    const labels = assignees
      .map((item) => String(item?.full_name || item?.username || item?.user_id || '').trim())
      .filter(Boolean);
    if (labels.length) return labels.join(', ');
  }
  const fullName = String(task[`${role}_full_name`] || '').trim();
  const username = String(task[`${role}_username`] || '').trim();
  return fullName || username || 'Не указан';
}

export function taskPriorityLabel(value: unknown): string {
  const key = String(value || '').trim().toLowerCase();
  return TASK_PRIORITY_LABELS[key] || key || 'Обычный';
}

export function todayProtocolDate(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function normalizeDueDate(value: string): string | null {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error('Укажите срок в формате ГГГГ-ММ-ДД.');
  }
  const [year, month, day] = text.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    throw new Error('Укажите существующую дату срока.');
  }
  return `${text}T18:00:00`;
}

export function taskDiscussionConversationId(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const payload = value as {
    conversation_id?: unknown;
    id?: unknown;
    conversation?: { id?: unknown } | null;
  };
  return String(payload.conversation_id || payload.conversation?.id || payload.id || '').trim();
}

export function taskSubtaskProgress(task: Pick<HubTask, 'subtasks_total' | 'subtasks_done'>): { total: number; done: number; open: number } {
  const total = Math.max(0, Number(task.subtasks_total) || 0);
  const done = Math.min(Math.max(0, Number(task.subtasks_done) || 0), total);
  return { total, done, open: total - done };
}

/**
 * Можно ли показать «Удалить» у файла задачи: свои загрузки автора файла и постановщика, администратору — любые.
 * Отчётные и сгенерированные файлы, а также файлы закрытой задачи не удаляются. Окончательно решает сервер.
 */
export function canDeleteTaskAttachment(
  task: Pick<HubTask, 'status' | 'created_by_user_id'>,
  attachment: Pick<TaskAttachment, 'scope' | 'uploaded_by_user_id'>,
  user: { id?: number | string | null; role?: string | null } | null | undefined,
): boolean {
  const userId = Number(user?.id || 0);
  if (!userId || attachment.scope !== 'task' || task.status === 'done') return false;
  const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';
  return isAdmin
    || Number(attachment.uploaded_by_user_id || 0) === userId
    || Number(task.created_by_user_id || 0) === userId;
}
