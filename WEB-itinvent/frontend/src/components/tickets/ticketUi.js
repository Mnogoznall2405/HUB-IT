export const TICKET_STATUS_OPTIONS = [
  { value: 'not_started', label: 'Не запущен' },
  { value: 'at_cashier', label: 'В кассах' },
  { value: 'purchased', label: 'Куплен' },
  { value: 'exchange_needed', label: 'Нужна замена' },
  { value: 'cancel_purchase', label: 'Отмена покупки' },
  { value: 'refund_needed', label: 'Нужен возврат' },
];

export const STATUS_LABELS = Object.fromEntries(TICKET_STATUS_OPTIONS.map((item) => [item.value, item.label]));

export const STATUS_COLORS = {
  not_started: 'default',
  at_cashier: 'warning',
  purchased: 'success',
  exchange_needed: 'info',
  cancel_purchase: 'error',
  refund_needed: 'default',
};

export const STATUS_ROW_COLORS = {
  not_started: 'transparent',
  at_cashier: '#FFF9C4',
  purchased: '#C8E6C9',
  exchange_needed: '#BBDEFB',
  cancel_purchase: '#FFCDD2',
  refund_needed: '#E0E0E0',
};

export const STATUS_CHANGE_HINTS = {
  at_cashier: 'Обычно меняют логисты',
  purchased: 'Обычно меняют подбор / ОК на объекте',
  exchange_needed: 'Обычно меняют подбор / ОК на объекте',
  cancel_purchase: 'Обычно меняют подбор / ОК на объекте',
  refund_needed: 'Обычно меняют подбор / ОК на объекте',
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

export const MASKED_PERSONAL_VALUE = '** **** ******';

export const isMaskedPersonalValue = (value) => {
  if (!value) return false;
  return String(value).trim() === MASKED_PERSONAL_VALUE;
};

export const toDateInputValue = (value) => {
  if (!value || isMaskedPersonalValue(value)) return '';
  const str = String(value);
  return str.length >= 10 ? str.slice(0, 10) : str;
};

export const splitPassportSeriesNumber = (value) => {
  const parts = String(value || '').trim().split(/\s+/);
  if (parts.length >= 2) {
    return { series: parts[0], number: parts.slice(1).join(' ') };
  }
  if (parts.length === 1 && parts[0]) {
    return { series: parts[0], number: '' };
  }
  return { series: '', number: '' };
};

export const formatArrivalRoute = (arrivalDate, route) => {
  const arrival = arrivalDate ? formatDate(arrivalDate) : '';
  const city = route ? String(route).trim() : '';
  if (arrival && city) return `${arrival} / ${city}`;
  return arrival || city || '-';
};
