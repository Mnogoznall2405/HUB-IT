import type {
  HubDashboard,
  HubDashboardAbsence,
  HubDashboardAnnouncement,
  HubDashboardTask,
} from '../api/hubApi';
import type { HubUser } from '../api/types';
import { formatDueLabel } from './dashboardFormat';

export type DashboardCounters = {
  openTasks: number;
  overdueTasks: number;
  reviewRequired: number;
  unreadComments: number;
};

export type AttentionItem = {
  type: 'task' | 'announcement';
  kind: 'overdue' | 'review' | 'comments' | 'ack';
  id: string;
  item: HubDashboardTask | HubDashboardAnnouncement;
};

function count(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

export function mapDashboardCounters(payload: HubDashboard): DashboardCounters {
  const summary = payload.summary || {};
  return {
    openTasks: count(summary.tasks_open_total),
    overdueTasks: count(summary.tasks_overdue),
    reviewRequired: count(summary.tasks_review_required),
    unreadComments: count(summary.tasks_with_unread_comments),
  };
}

export function canReviewTask(task: HubDashboardTask, user: HubUser | null | undefined): boolean {
  return String(user?.role || '').toLowerCase() === 'admin'
    || Number(task?.created_by_user_id) === Number(user?.id)
    || Number(task?.controller_user_id) === Number(user?.id);
}

export function buildAttentionItems(
  tasks: HubDashboardTask[],
  announcements: HubDashboardAnnouncement[],
  user: HubUser | null | undefined,
  limit = 6,
): AttentionItem[] {
  const result: AttentionItem[] = [];
  const seen = new Set<string>();
  const addTask = (task: HubDashboardTask, kind: AttentionItem['kind']) => {
    const id = String(task?.id || '');
    if (!id || seen.has(`task:${id}`)) return;
    seen.add(`task:${id}`);
    result.push({ type: 'task', kind, id, item: task });
  };

  tasks.filter((task) => task?.is_overdue).forEach((task) => addTask(task, 'overdue'));
  tasks
    .filter((task) => String(task?.status || '').toLowerCase() === 'review' && canReviewTask(task, user))
    .forEach((task) => addTask(task, 'review'));
  tasks.filter((task) => task?.has_unread_comments).forEach((task) => addTask(task, 'comments'));
  announcements
    .filter((item) => item?.is_ack_pending)
    .forEach((item) => {
      const id = String(item?.id || '');
      if (!id || seen.has(`announcement:${id}`)) return;
      seen.add(`announcement:${id}`);
      result.push({ type: 'announcement', kind: 'ack', id, item });
    });
  return result.slice(0, limit);
}

export function nearestOpenTasks(tasks: HubDashboardTask[], limit = 5): HubDashboardTask[] {
  return [...tasks]
    .filter((task) => !['done', 'cancelled', 'canceled'].includes(String(task?.status || '').toLowerCase()))
    .sort((left, right) => {
      const leftDue = Date.parse(String(left?.due_at || '')) || Number.MAX_SAFE_INTEGER;
      const rightDue = Date.parse(String(right?.due_at || '')) || Number.MAX_SAFE_INTEGER;
      return leftDue - rightDue;
    })
    .slice(0, limit);
}

export function latestNews(items: HubDashboardAnnouncement[], limit = 3): HubDashboardAnnouncement[] {
  return [...items]
    .sort((left, right) => (
      (Date.parse(String(right?.updated_at || right?.published_at || right?.created_at || '')) || 0)
      - (Date.parse(String(left?.updated_at || left?.published_at || left?.created_at || '')) || 0)
    ))
    .slice(0, limit);
}

export function attentionSecondary(item: AttentionItem): string {
  if (item.type === 'announcement') return 'Нужно прочитать и подтвердить';
  const task = item.item as HubDashboardTask;
  if (item.kind === 'overdue') return formatDueLabel(task?.due_at);
  if (item.kind === 'review') return 'Ожидает вашей проверки';
  return 'Есть новый комментарий';
}

export function listDashboardTasks(payload: HubDashboard): HubDashboardTask[] {
  return Array.isArray(payload?.my_tasks?.items) ? payload.my_tasks.items : [];
}

export function listDashboardAnnouncements(payload: HubDashboard): HubDashboardAnnouncement[] {
  return Array.isArray(payload?.announcements?.items) ? payload.announcements.items : [];
}

export function listDashboardAbsences(payload: HubDashboard): {
  count: number;
  items: HubDashboardAbsence[];
} {
  const absences = payload?.absences_today;
  const items = Array.isArray(absences?.items) ? absences.items : [];
  return {
    count: Number(absences?.count || items.length || 0),
    items,
  };
}
