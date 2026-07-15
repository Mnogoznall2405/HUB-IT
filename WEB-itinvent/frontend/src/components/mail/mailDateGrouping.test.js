import { describe, expect, it } from 'vitest';

import {
  buildMailMonthGroups,
  formatMailListDateLabel,
} from './mailDateGrouping';


describe('mailDateGrouping', () => {
  it('adds month and year boundaries across appended mail pages', () => {
    const items = [
      { id: 'may-new', received_at: '2026-05-12T10:00:00Z' },
      { id: 'may-old', received_at: '2026-05-01T10:00:00Z' },
      { id: 'apr', received_at: '2026-04-30T10:00:00Z' },
      { id: 'previous-year', received_at: '2025-12-31T10:00:00Z' },
    ];

    expect(buildMailMonthGroups(items, 'messages').map((entry) => ({
      id: entry.item.id,
      heading: entry.monthLabel,
    }))).toEqual([
      { id: 'may-new', heading: 'Май 2026' },
      { id: 'may-old', heading: '' },
      { id: 'apr', heading: 'Апрель 2026' },
      { id: 'previous-year', heading: 'Декабрь 2025' },
    ]);
  });

  it('keeps the year visible for a message outside the current year', () => {
    expect(formatMailListDateLabel(
      '2025-05-12T10:00:00Z',
      new Date('2026-07-14T12:00:00Z'),
    )).toMatch(/2025/);
  });
});
