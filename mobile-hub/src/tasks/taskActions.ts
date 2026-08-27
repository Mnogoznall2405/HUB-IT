import type { TaskCapabilities } from '../api/taskApi';

export type TaskActionKey = 'start' | 'submit' | 'approve' | 'reject' | 'complete' | 'reopen';

export type TaskAction = {
  key: TaskActionKey;
  label: string;
  tone?: 'primary' | 'success' | 'danger';
  commentRequired?: boolean;
};

export function getTaskActions(capabilities: TaskCapabilities | null | undefined): TaskAction[] {
  if (!capabilities) return [];
  const actions: TaskAction[] = [];
  if (capabilities.can_start) actions.push({ key: 'start', label: 'Начать работу', tone: 'primary' });
  if (capabilities.can_submit) actions.push({ key: 'submit', label: 'Отправить на проверку', tone: 'primary' });
  if (capabilities.can_review) {
    actions.push({ key: 'approve', label: 'Принять', tone: 'success' });
    actions.push({ key: 'reject', label: 'Вернуть на доработку', tone: 'danger', commentRequired: true });
  }
  if (capabilities.can_close) actions.push({ key: 'complete', label: 'Завершить', tone: 'success' });
  if (capabilities.can_reopen) actions.push({ key: 'reopen', label: 'Переоткрыть', tone: 'primary' });
  return actions;
}

export const TASK_STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  review: 'На проверке',
  done: 'Завершена',
};

export function taskStatusLabel(status: string | null | undefined): string {
  const normalized = String(status || '').trim();
  return TASK_STATUS_LABELS[normalized] || normalized || 'Без статуса';
}
