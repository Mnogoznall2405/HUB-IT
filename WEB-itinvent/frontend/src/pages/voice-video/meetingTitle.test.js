import { describe, expect, it } from 'vitest';
import { formatMeetingDate, parseMeetingTitle, stripJobPrefix } from './meetingTitle';

describe('meetingTitle', () => {
  it('extracts ISO and dotted dates and cleans the title', () => {
    expect(parseMeetingTitle('2026-09-25_Планерка_Магадан')).toEqual({
      title: 'Планерка Магадан', date: '2026-09-25', dateLabel: '25 сентября 2026',
    });
    expect(parseMeetingTitle('j0123456789ab_ВКС_НЗ_25.09.2026')).toMatchObject({
      title: 'ВКС НЗ', date: '2026-09-25',
    });
    expect(parseMeetingTitle('Совещание 03-10-2026 итоги').date).toBe('2026-10-03');
  });

  it('keeps names without a valid date', () => {
    expect(parseMeetingTitle('Совет_директоров')).toEqual({ title: 'Совет директоров', date: null, dateLabel: '' });
    expect(parseMeetingTitle('2026-13-40_Неверная').date).toBeNull();
    expect(parseMeetingTitle('2026-09-25').title).toBe('Встреча');
    expect(parseMeetingTitle('')).toEqual({ title: '', date: null, dateLabel: '' });
  });

  it('formats dates with an optional weekday', () => {
    expect(formatMeetingDate('2026-09-25', { weekday: true })).toBe('пт, 25 сентября 2026');
    expect(formatMeetingDate('bad')).toBe('');
    expect(stripJobPrefix('j0123456789ab_x')).toBe('x');
  });
});
