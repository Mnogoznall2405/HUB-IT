const MAIL_TIME_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});
const MAIL_DAY_MONTH_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
});
const MAIL_DAY_MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const MAIL_MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  month: 'long',
  year: 'numeric',
});

const parseMailDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const capitalizeFirst = (value) => {
  const text = String(value || '').trim().replace(/\s*г\.$/iu, '');
  return text ? `${text.charAt(0).toLocaleUpperCase('ru-RU')}${text.slice(1)}` : '';
};

export const getMailListItemDate = (item, viewMode = 'messages') => (
  viewMode === 'conversations' ? item?.last_received_at : item?.received_at
);

export const formatMailListDateLabel = (value, now = new Date()) => {
  const date = parseMailDate(value);
  const current = parseMailDate(now);
  if (!date || !current) return '';
  if (date.toDateString() === current.toDateString()) {
    return MAIL_TIME_FORMATTER.format(date);
  }
  if (date.getFullYear() !== current.getFullYear()) {
    return MAIL_DAY_MONTH_YEAR_FORMATTER.format(date);
  }
  return MAIL_DAY_MONTH_FORMATTER.format(date);
};

export const buildMailMonthGroups = (items = [], viewMode = 'messages') => {
  let previousMonthKey = '';
  return (Array.isArray(items) ? items : []).map((item) => {
    const date = parseMailDate(getMailListItemDate(item, viewMode));
    if (!date) {
      return { item, monthKey: '', monthLabel: '' };
    }
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const startsMonth = monthKey !== previousMonthKey;
    previousMonthKey = monthKey;
    return {
      item,
      monthKey,
      monthLabel: startsMonth ? capitalizeFirst(MAIL_MONTH_YEAR_FORMATTER.format(date)) : '',
    };
  });
};
