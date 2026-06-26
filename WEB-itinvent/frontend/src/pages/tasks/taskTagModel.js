import { priorityMeta, statusMeta } from './taskFormatters';

export const buildTaskTagChips = (task, { ui, taskDiscussionChatEnabled, alpha }) => {
  const status = statusMeta(task?.status);
  const priority = priorityMeta(task?.priority);
  const attachCount = Number(task?.attachments_count || 0);
  const commentCount = Number(task?.comments_count || 0);
  const checklistTotal = Number(task?.checklist_total ?? (Array.isArray(task?.checklist_items) ? task.checklist_items.length : 0));
  const checklistDone = Number(task?.checklist_done ?? (Array.isArray(task?.checklist_items) ? task.checklist_items.filter((item) => item?.done).length : 0));

  return [
    { key: 'status', label: status.label, color: status.color, bg: status.bg },
    priority.value !== 'normal' ? { key: 'priority', label: priority.label, color: priority.dotColor, bg: alpha(priority.dotColor, 0.12) } : null,
    task?.is_overdue ? { key: 'overdue', label: 'Просрочено', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' } : null,
    attachCount > 0 ? { key: 'files', label: `Файлы ${attachCount}`, color: ui.mutedText, bg: ui.actionBg } : null,
    commentCount > 0 ? {
      key: 'comments',
      label: taskDiscussionChatEnabled ? `Архив ${commentCount}` : `Комментарии ${commentCount}`,
      color: task?.has_unread_comments ? '#2563eb' : ui.mutedText,
      bg: task?.has_unread_comments ? 'rgba(37,99,235,0.12)' : ui.actionBg,
    } : null,
    checklistTotal > 0 ? { key: 'checklist', label: `Чек-лист ${checklistDone}/${checklistTotal}`, color: '#0f766e', bg: 'rgba(15,118,110,0.12)' } : null,
  ].filter(Boolean);
};
