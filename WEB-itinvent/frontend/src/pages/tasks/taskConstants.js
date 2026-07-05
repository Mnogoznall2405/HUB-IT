export const KANBAN_COLUMNS = [
  { key: 'new', label: 'Новое', color: '#2563eb' },
  { key: 'in_progress', label: 'В работе', color: '#d97706' },
  { key: 'review', label: 'На проверке', color: '#7c3aed' },
  { key: 'done', label: 'Готово', color: '#059669' },
];

export const priorityOptions = [
  { value: 'low', label: 'Низкий', dotColor: '#64748b' },
  { value: 'normal', label: 'Обычный', dotColor: '#2563eb' },
  { value: 'high', label: 'Высокий', dotColor: '#d97706' },
  { value: 'urgent', label: 'Срочный', dotColor: '#dc2626' },
];

export const taskVisibilityOptions = [
  { value: 'private', label: 'Приватная' },
  { value: 'department', label: 'Отдел' },
  { value: 'department_managers', label: 'Начальники отдела' },
];

export const dueStateOptions = [
  { value: '', label: 'Любой срок' },
  { value: 'overdue', label: 'Просрочено' },
  { value: 'today', label: 'На сегодня' },
  { value: 'upcoming', label: 'Предстоящие' },
  { value: 'none', label: 'Без срока' },
];

export const statusOptions = [
  { value: '', label: 'Все статусы' },
  { value: 'new', label: 'Новое' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'review', label: 'На проверке' },
  { value: 'done', label: 'Готово' },
];

export const focusOptions = [
  { value: 'all', label: 'Все' },
  { value: 'review', label: 'К проверке' },
  { value: 'overdue', label: 'Просроченные' },
  { value: 'comments', label: 'С новыми комментариями' },
];

export const mobileStatusOptions = [
  { value: '', label: 'Все' },
  { value: 'new', label: 'Новые' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'review', label: 'На проверке' },
  { value: 'done', label: 'Готово' },
];
