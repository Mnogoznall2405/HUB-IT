export const TICKET_STATUS_OPTIONS = [
  { value: 'new', label: 'Новая' },
  { value: 'data_check', label: 'Проверка данных' },
  { value: 'missing_data', label: 'Не хватает данных' },
  { value: 'ready_to_buy', label: 'Готова к покупке' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'purchased', label: 'Куплен' },
  { value: 'exchange_needed', label: 'Нужен обмен' },
  { value: 'refund', label: 'Возврат' },
  { value: 'cancelled', label: 'Отмена' },
  { value: 'no_show', label: 'Не явился' },
  { value: 'closed', label: 'Закрыта' },
  { value: 'archive', label: 'Архив' },
];

export const STATUS_LABELS = Object.fromEntries(TICKET_STATUS_OPTIONS.map((item) => [item.value, item.label]));

export const STATUS_COLORS = {
  new: 'default',
  data_check: 'info',
  missing_data: 'warning',
  ready_to_buy: 'primary',
  in_progress: 'primary',
  purchased: 'success',
  exchange_needed: 'warning',
  refund: 'secondary',
  cancelled: 'error',
  no_show: 'error',
  closed: 'success',
  archive: 'default',
};

export const ATTACHMENT_TYPES = [
  { value: 'itinerary', label: 'Маршрут' },
  { value: 'pdf_ticket', label: 'Билет' },
  { value: 'receipt', label: 'Чек' },
  { value: 'voucher', label: 'Ваучер' },
  { value: 'other', label: 'Другое' },
];

export const FIN_OP_TYPES = [
  { value: 'loss', label: 'Потеря' },
  { value: 'refund', label: 'Возврат' },
  { value: 'exchange', label: 'Обмен' },
];

export const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('ru-RU');
};

export const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
};

export const formatMoney = (value) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return String(value || '0');
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 2,
  }).format(number);
};

export const downloadBlob = (blob, fileName) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export const getErrorMessage = (error) => {
  const detail = error?.response?.data?.detail;
  if (Array.isArray(detail)) return detail.join(', ');
  if (detail) return String(detail);
  return error?.message || 'Ошибка выполнения операции';
};
