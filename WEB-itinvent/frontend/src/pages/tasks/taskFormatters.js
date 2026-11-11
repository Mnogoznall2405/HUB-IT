import { priorityOptions } from './taskConstants';

export const statusMeta = (status) => {
  const value = String(status || '').toLowerCase();
  if (value === 'new') return { label: 'Новое', color: '#2563eb', bg: 'rgba(37,99,235,0.14)' };
  if (value === 'in_progress') return { label: 'В работе', color: '#d97706', bg: 'rgba(217,119,6,0.14)' };
  if (value === 'review') return { label: 'На проверке', color: '#7c3aed', bg: 'rgba(124,58,237,0.14)' };
  if (value === 'done') return { label: 'Готово', color: '#059669', bg: 'rgba(5,150,105,0.14)' };
  return { label: value || '-', color: '#64748b', bg: 'rgba(100,116,139,0.12)' };
};

export const priorityMeta = (priority) => {
  const found = priorityOptions.find((item) => item.value === String(priority || '').toLowerCase());
  return found || priorityOptions[1];
};

export const formatDateTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

export const formatShortDate = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
};

export const formatFileSize = (bytes) => {
  const size = Number(bytes || 0);
  if (size <= 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export const getInitials = (name) => {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  return parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : parts[0].slice(0, 2).toUpperCase();
};

export const getTaskCommentPreview = (task) => {
  const preview = String(task?.latest_comment_preview || '').trim();
  if (!preview) return '';
  const author = String(task?.latest_comment_full_name || task?.latest_comment_username || '').trim();
  return author ? `${author}: ${preview}` : preview;
};

export const toDateTimeInput = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
};

export const toDateInput = (value) => {
  if (!value) return '';
  const parsed = new Date(String(value).length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 10);
};

export const hideMobileScrollbarSx = {
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
  '&::-webkit-scrollbar': {
    display: 'none',
  },
};

export const formatPercent = (value) => `${Number(value || 0).toFixed(1)}%`;

export const parseFilename = (contentDisposition) => {
  if (!contentDisposition) return null;
  const matched = /filename="?([^"]+)"?/i.exec(String(contentDisposition));
  return matched?.[1] || null;
};

export const clampPercent = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
};

export const formatMetricCountPercent = (count, percent) => `${Number(count || 0)} / ${formatPercent(percent)}`;
