import { describe, expect, it } from 'vitest';
import {
  buildSchedulePresets,
  formatScheduledTime,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
  validateScheduleDate,
} from './chatScheduledTime';

describe('chatScheduledTime', () => {
  it('converts between Date and datetime-local values (local time)', () => {
    const date = new Date(2026, 9, 5, 9, 7);
    expect(toDateTimeLocalValue(date)).toBe('2026-10-05T09:07');
    const back = fromDateTimeLocalValue('2026-10-05T09:07');
    expect(back.getTime()).toBe(date.getTime());
    expect(fromDateTimeLocalValue('')).toBeNull();
    expect(fromDateTimeLocalValue('2026-10-05')).toBeNull();
    expect(toDateTimeLocalValue('not a date')).toBe('');
  });

  it('offers an hour from now, tomorrow 9:00 and next Monday 9:00', () => {
    const wednesday = new Date(2026, 9, 7, 14, 30, 45); // 7 Oct 2026 is a Wednesday
    const [hour, tomorrow, monday] = buildSchedulePresets(wednesday);
    expect(toDateTimeLocalValue(hour.date)).toBe('2026-10-07T15:30');
    expect(toDateTimeLocalValue(tomorrow.date)).toBe('2026-10-08T09:00');
    expect(toDateTimeLocalValue(monday.date)).toBe('2026-10-12T09:00');
    // on a Monday "next Monday" is a week ahead, never today
    const [, , nextMonday] = buildSchedulePresets(new Date(2026, 9, 12, 8, 0));
    expect(toDateTimeLocalValue(nextMonday.date)).toBe('2026-10-19T09:00');
  });

  it('formats today, tomorrow and later dates', () => {
    const now = new Date(2026, 9, 7, 12, 0);
    expect(formatScheduledTime(new Date(2026, 9, 7, 18, 5), now)).toBe('сегодня в 18:05');
    expect(formatScheduledTime(new Date(2026, 9, 8, 9, 0), now)).toBe('завтра в 09:00');
    expect(formatScheduledTime(new Date(2026, 9, 20, 9, 0), now)).toMatch(/^20 окт\.? в 09:00$/);
    expect(formatScheduledTime(new Date(2027, 0, 3, 9, 0), now)).toMatch(/2027 в 09:00$/);
    expect(formatScheduledTime('garbage', now)).toBe('');
  });

  it('validates the lead time like the server (at least a minute, at most a year)', () => {
    const now = new Date(2026, 9, 7, 12, 0);
    expect(validateScheduleDate(null, now)).toMatch(/Укажите/);
    expect(validateScheduleDate(new Date(2026, 9, 7, 12, 0, 30), now)).toMatch(/в будущем/);
    expect(validateScheduleDate(new Date(2026, 9, 7, 12, 5), now)).toBe('');
    expect(validateScheduleDate(new Date(2028, 9, 7, 12, 5), now)).toMatch(/год/);
  });
});
