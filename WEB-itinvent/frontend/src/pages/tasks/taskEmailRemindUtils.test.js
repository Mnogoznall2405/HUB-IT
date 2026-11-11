import { describe, expect, it } from 'vitest';

import {
  applyDueAtChange,
  formatEmailRemindSummary,
  fromApiEmailDeadlineRemindHours,
  toApiEmailDeadlineRemindHours,
} from './taskEmailRemindUtils';

describe('taskEmailRemindUtils', () => {
  it('maps api reminder values to ui mode', () => {
    expect(fromApiEmailDeadlineRemindHours(null)).toEqual({ mode: 'default', hours: 24 });
    expect(fromApiEmailDeadlineRemindHours(0)).toEqual({ mode: 'off', hours: 24 });
    expect(fromApiEmailDeadlineRemindHours(12)).toEqual({ mode: 'custom', hours: 12 });
  });

  it('maps ui mode back to api values', () => {
    expect(toApiEmailDeadlineRemindHours('off', 24)).toBe(0);
    expect(toApiEmailDeadlineRemindHours('custom', 6)).toBe(6);
    expect(toApiEmailDeadlineRemindHours('default', 24)).toBeNull();
  });

  it('formats reminder summary and clears email on due removal', () => {
    expect(formatEmailRemindSummary('off', 24)).toBe('Email: не отправлять');
    expect(formatEmailRemindSummary('custom', 6)).toBe('Email: за 6 ч до срока');
    expect(formatEmailRemindSummary('default', 24, 24)).toBe('Email: за 24 ч');

    const next = applyDueAtChange({
      due_at: '2026-06-13T12:00:00',
      email_deadline_remind_mode: 'custom',
      email_deadline_remind_hours: 6,
    }, '');
    expect(next.due_at).toBe('');
    expect(next.email_deadline_remind_mode).toBe('default');
    expect(next.email_deadline_remind_hours).toBe(24);
  });
});
