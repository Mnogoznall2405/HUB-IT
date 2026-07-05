import { describe, expect, it } from 'vitest';

import {
  analyticsStatusColors,
  buildAnalyticsRangeFromPreset,
  buildAnalyticsTableColumns,
  EMPTY_ANALYTICS_PAYLOAD,
} from './taskAnalyticsModel';

describe('taskAnalyticsModel', () => {
  it('exposes empty analytics payload shape', () => {
    expect(EMPTY_ANALYTICS_PAYLOAD.summary).toEqual({});
    expect(EMPTY_ANALYTICS_PAYLOAD.trend).toEqual({ granularity: 'day', items: [] });
  });

  it('builds preset date ranges', () => {
    const range = buildAnalyticsRangeFromPreset('7d');
    expect(range.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(buildAnalyticsRangeFromPreset('custom')).toEqual({ start_date: '', end_date: '' });
  });

  it('defines analytics table columns and status colors', () => {
    const columns = buildAnalyticsTableColumns();
    expect(columns.map((item) => item.key)).toContain('overdue');
    expect(analyticsStatusColors.done).toBe('#059669');
  });
});
