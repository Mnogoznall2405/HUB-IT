import { priorityMeta, statusMeta } from './taskFormatters';

// The accent colours are tuned for the dark theme; on a light chip tint they fall below 3:1 (amber 2.7:1).
// Darken the text only: the chip tint stays the same.
export const darkenHex = (value, factor = 0.62) => {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || ''));
  if (!match) return value;
  const channels = [0, 2, 4].map((offset) => Math.round(parseInt(match[1].slice(offset, offset + 2), 16) * factor));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
};

export const buildTaskTagChips = (task, { ui, taskDiscussionChatEnabled, alpha }) => {
  const chips = buildRawTaskTagChips(task, { ui, taskDiscussionChatEnabled, alpha });
  if (ui?.isDark !== false) return chips;
  return chips.map((chip) => ({ ...chip, color: darkenHex(chip.color) }));
};

const buildRawTaskTagChips = (task, { ui, taskDiscussionChatEnabled, alpha }) => {
  const status = statusMeta(task?.status);
  const priority = priorityMeta(task?.priority);
  const attachCount = Number(task?.attachments_count || 0);
  const commentCount = Number(task?.comments_count || 0);
  const checklistTotal = Number(task?.checklist_total ?? (Array.isArray(task?.checklist_items) ? task.checklist_items.length : 0));
  const checklistDone = Number(task?.checklist_done ?? (Array.isArray(task?.checklist_items) ? task.checklist_items.filter((item) => item?.done).length : 0));

  const subtasksTotal = Math.max(0, Number(task?.subtasks_total) || 0);
  const subtasksDone = Math.min(Math.max(0, Number(task?.subtasks_done) || 0), subtasksTotal);

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
    task?.parent_task_id ? { key: 'subtask', label: 'Подзадача', color: '#4f46e5', bg: 'rgba(79,70,229,0.12)' } : null,
    subtasksTotal > 0 ? { key: 'subtasks', label: `Подзадачи ${subtasksDone}/${subtasksTotal}`, color: '#4f46e5', bg: 'rgba(79,70,229,0.12)' } : null,
  ].filter(Boolean);
};
