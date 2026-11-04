import { getFileTypeKey } from '../components/myFiles/myFilesVisual';

// Filter chips above the list ("Тип", "Изменено"): they narrow what is already loaded, like the name search.
export const TYPE_FILTERS = [
  { value: 'folder', label: 'Папки' },
  { value: 'document', label: 'Документы' },
  { value: 'sheet', label: 'Таблицы' },
  { value: 'slides', label: 'Презентации' },
  { value: 'pdf', label: 'PDF' },
  { value: 'image', label: 'Изображения' },
  { value: 'video', label: 'Видео' },
  { value: 'archive', label: 'Архивы' },
];

export const DATE_FILTERS = [
  { value: 'today', label: 'Сегодня' },
  { value: '7d', label: 'За 7 дней' },
  { value: '30d', label: 'За 30 дней' },
  { value: 'year', label: 'В этом году' },
];

export const typeFilterLabel = (value) => TYPE_FILTERS.find((entry) => entry.value === value)?.label || '';
export const dateFilterLabel = (value) => DATE_FILTERS.find((entry) => entry.value === value)?.label || '';

/** `kind` is "folder" or "file"; an empty filter lets everything through. */
export const matchesTypeFilter = (entry, kind, filter) => {
  if (!filter) return true;
  if (kind === 'folder') return filter === 'folder';
  if (filter === 'folder') return false;
  const key = getFileTypeKey(entry);
  if (filter === 'document') return key === 'document' || key === 'text';
  return key === filter;
};

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const matchesDateFilter = (entry, filter, now = new Date()) => {
  if (!filter) return true;
  const stamp = new Date(entry?.updated_at || entry?.created_at || '');
  if (Number.isNaN(stamp.getTime())) return false;
  const today = startOfDay(now);
  if (filter === 'today') return stamp >= today;
  if (filter === '7d') return stamp >= new Date(today.getTime() - 6 * 86400000);
  if (filter === '30d') return stamp >= new Date(today.getTime() - 29 * 86400000);
  if (filter === 'year') return stamp >= new Date(now.getFullYear(), 0, 1);
  return true;
};
