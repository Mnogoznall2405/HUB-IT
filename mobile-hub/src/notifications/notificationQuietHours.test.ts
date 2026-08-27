import {
  DEFAULT_QUIET_HOURS,
  normalizeQuietHours,
  validateQuietHours,
} from './notificationQuietHours';

it('normalizes an existing quiet-hours preference', () => {
  expect(normalizeQuietHours({
    enabled: true,
    start: '21:30',
    end: '06:45',
    timezone: 'Europe/Moscow',
  })).toEqual({
    enabled: true,
    start: '21:30',
    end: '06:45',
    timezone: 'Europe/Moscow',
  });
});

it('falls back from malformed clock values', () => {
  expect(normalizeQuietHours({ start: '25:99', end: 'x', timezone: '' })).toMatchObject({
    start: DEFAULT_QUIET_HOURS.start,
    end: DEFAULT_QUIET_HOURS.end,
  });
});

it('rejects equal enabled boundaries and accepts an overnight window', () => {
  expect(validateQuietHours({
    enabled: true,
    start: '09:00',
    end: '09:00',
    timezone: 'Asia/Yekaterinburg',
  })).toContain('должны отличаться');
  expect(validateQuietHours({
    enabled: true,
    start: '22:00',
    end: '07:00',
    timezone: 'Asia/Yekaterinburg',
  })).toBe('');
});
