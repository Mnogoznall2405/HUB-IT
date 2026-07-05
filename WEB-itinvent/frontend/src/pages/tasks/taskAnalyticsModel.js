import { toDateInput } from './taskFormatters';

export const analyticsPresetOptions = [
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'quarter', label: 'Квартал' },
  { value: 'year', label: 'Год' },
  { value: 'custom', label: 'Свои даты' },
];

export const analyticsDateBasisOptions = [
  { value: 'protocol_date', label: 'По дате постановки' },
  { value: 'completed_at', label: 'По завершению' },
  { value: 'due_at', label: 'По сроку' },
];

export const EMPTY_ANALYTICS_PAYLOAD = {
  summary: {},
  by_participant: [],
  by_project: [],
  by_object: [],
  status_breakdown: [],
  trend: { granularity: 'day', items: [] },
  truncated: false,
};

export const analyticsStatusColors = {
  new: '#2563eb',
  in_progress: '#d97706',
  review: '#7c3aed',
  done: '#059669',
  overdue: '#dc2626',
  open: '#2563eb',
};

export const buildAnalyticsRangeFromPreset = (preset) => {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  switch (preset) {
    case '7d':
      start.setDate(start.getDate() - 6);
      break;
    case '30d':
      start.setDate(start.getDate() - 29);
      break;
    case 'week': {
      const day = start.getDay() || 7;
      start.setDate(start.getDate() - day + 1);
      break;
    }
    case 'month':
      start.setDate(1);
      break;
    case 'quarter': {
      const quarterMonth = Math.floor(start.getMonth() / 3) * 3;
      start.setMonth(quarterMonth, 1);
      break;
    }
    case 'year':
      start.setMonth(0, 1);
      break;
    default:
      return { start_date: '', end_date: '' };
  }
  return {
    start_date: toDateInput(start.toISOString()),
    end_date: toDateInput(end.toISOString()),
  };
};

export const buildAnalyticsTableColumns = () => ([
  { key: 'total', label: 'Всего' },
  { key: 'open', label: 'Открыто' },
  { key: 'in_progress', label: 'В работе' },
  { key: 'review', label: 'На проверке' },
  { key: 'done', label: 'Выполнено' },
  { key: 'done_on_time', label: 'В срок' },
  { key: 'done_without_due', label: 'Без срока' },
  { key: 'overdue', label: 'Просрочено' },
]);
