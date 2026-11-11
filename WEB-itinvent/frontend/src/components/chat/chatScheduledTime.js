// Time helpers for "Send later" (local time of the user, ISO strings go to the server).

const pad = (value) => String(value).padStart(2, '0');

// <input type="datetime-local"> value (local time, no zone) for a Date.
export function toDateTimeLocalValue(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

// datetime-local value -> Date (local time) or null.
export function fromDateTimeLocalValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Quick choices of the "Send later" dialog, relative to `now`.
export function buildSchedulePresets(now = new Date()) {
  const base = now instanceof Date ? now : new Date(now);
  const inOneHour = new Date(base.getTime() + 60 * 60 * 1000);
  inOneHour.setSeconds(0, 0);
  const tomorrowMorning = new Date(base);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(9, 0, 0, 0);
  const nextMonday = new Date(base);
  const daysToMonday = ((8 - nextMonday.getDay()) % 7) || 7;
  nextMonday.setDate(nextMonday.getDate() + daysToMonday);
  nextMonday.setHours(9, 0, 0, 0);
  return [
    { key: 'hour', label: 'Через час', date: inOneHour },
    { key: 'tomorrow', label: 'Завтра в 9:00', date: tomorrowMorning },
    { key: 'monday', label: 'В понедельник в 9:00', date: nextMonday },
  ];
}

const sameDay = (left, right) => (
  left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate()
);

// "сегодня в 18:30", "завтра в 09:00", "5 окт. в 09:00".
export function formatScheduledTime(value, now = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const today = now instanceof Date ? now : new Date(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(date, today)) return `сегодня в ${time}`;
  if (sameDay(date, tomorrow)) return `завтра в ${time}`;
  const day = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const year = date.getFullYear() === today.getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${day}${year} в ${time}`;
}

// The server refuses anything closer than 30 s; the dialog asks for a minute to be safe.
export const MIN_SCHEDULE_LEAD_MS = 60 * 1000;

export function validateScheduleDate(date, now = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'Укажите дату и время';
  if (date.getTime() < now.getTime() + MIN_SCHEDULE_LEAD_MS) return 'Время должно быть в будущем';
  if (date.getTime() > now.getTime() + 365 * 24 * 60 * 60 * 1000) return 'Не дальше, чем на год';
  return '';
}
