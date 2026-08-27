import type { QuietHoursPreferences } from '../api/notificationApi';

export const DEFAULT_QUIET_HOURS: QuietHoursPreferences = Object.freeze({
  enabled: false,
  start: '22:00',
  end: '07:00',
  timezone: 'Asia/Yekaterinburg',
});

const CLOCK_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const TIMEZONE_PATTERN = /^[A-Za-z0-9_+\-/]{1,80}$/;

export function detectDeviceTimezone(): string {
  try {
    const timezone = String(Intl.DateTimeFormat().resolvedOptions().timeZone || '').trim();
    return TIMEZONE_PATTERN.test(timezone) ? timezone : DEFAULT_QUIET_HOURS.timezone;
  } catch {
    return DEFAULT_QUIET_HOURS.timezone;
  }
}

export function normalizeQuietHours(value: Partial<QuietHoursPreferences> | null | undefined): QuietHoursPreferences {
  const timezone = String(value?.timezone || '').trim();
  return {
    enabled: Boolean(value?.enabled),
    start: CLOCK_PATTERN.test(String(value?.start || '')) ? String(value?.start) : DEFAULT_QUIET_HOURS.start,
    end: CLOCK_PATTERN.test(String(value?.end || '')) ? String(value?.end) : DEFAULT_QUIET_HOURS.end,
    timezone: TIMEZONE_PATTERN.test(timezone) ? timezone : detectDeviceTimezone(),
  };
}

export function validateQuietHours(value: QuietHoursPreferences): string {
  if (!CLOCK_PATTERN.test(value.start) || !CLOCK_PATTERN.test(value.end)) {
    return 'Укажите время в формате ЧЧ:ММ.';
  }
  if (value.enabled && value.start === value.end) {
    return 'Начало и окончание тихих часов должны отличаться.';
  }
  if (!TIMEZONE_PATTERN.test(String(value.timezone || '').trim())) {
    return 'Не удалось определить часовой пояс устройства.';
  }
  return '';
}
