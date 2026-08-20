import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useMailListQuickFilters, {
  getMailLast7DaysFromIsoDate,
  getMailQuickFilterIsoDate,
  toggleMailLast7DaysFilter,
  toggleMailTodayFilter,
} from './useMailListQuickFilters';

const NOW = new Date('2026-08-20T12:00:00.000Z');

describe('mail list quick filters', () => {
  it('toggles today and last 7 days with the existing UTC date rules', () => {
    const today = getMailQuickFilterIsoDate(NOW);
    const from = getMailLast7DaysFromIsoDate(NOW);

    expect(today).toBe('2026-08-20');
    expect(from).toBe('2026-08-13');
    expect(toggleMailTodayFilter('', '', NOW)).toEqual({
      filterDateFrom: '2026-08-20',
      filterDateTo: '2026-08-20',
    });
    expect(toggleMailTodayFilter('2026-08-20', '2026-08-20', NOW)).toEqual({
      filterDateFrom: '',
      filterDateTo: '',
    });
    expect(toggleMailLast7DaysFilter('', '', NOW)).toEqual({
      filterDateFrom: '2026-08-13',
      filterDateTo: '',
    });
    expect(toggleMailLast7DaysFilter('2026-08-13', '', NOW)).toEqual({
      filterDateFrom: '',
      filterDateTo: '',
    });
    expect(toggleMailLast7DaysFilter('2026-08-20', '2026-08-20', NOW)).toEqual({
      filterDateFrom: '2026-08-13',
      filterDateTo: '',
    });
  });

  it('wires unread, attachments and date toggles and closes mobile navigation', () => {
    const setUnreadOnly = vi.fn();
    const setHasAttachmentsOnly = vi.fn();
    const setFilterDateFrom = vi.fn();
    const setFilterDateTo = vi.fn();
    const onAfterChange = vi.fn();
    const { result } = renderHook(() => useMailListQuickFilters({
      setUnreadOnly,
      setHasAttachmentsOnly,
      filterDateFrom: '',
      filterDateTo: '',
      setFilterDateFrom,
      setFilterDateTo,
      onAfterChange,
      now: () => NOW,
    }));

    act(() => {
      result.current.handleUnreadToggle('yes');
      result.current.handleToggleHasAttachmentsOnly();
      result.current.handleToggleTodayFilter();
    });

    expect(setUnreadOnly).toHaveBeenCalledWith(true);
    expect(setHasAttachmentsOnly).toHaveBeenCalledTimes(1);
    const updater = setHasAttachmentsOnly.mock.calls[0][0];
    expect(updater(false)).toBe(true);
    expect(updater(true)).toBe(false);
    expect(setFilterDateFrom).toHaveBeenCalledWith('2026-08-20');
    expect(setFilterDateTo).toHaveBeenCalledWith('2026-08-20');
    expect(onAfterChange).toHaveBeenCalledTimes(3);
  });

  it('turns last 7 days off when the same from-date is already active', () => {
    const setFilterDateFrom = vi.fn();
    const setFilterDateTo = vi.fn();
    const onAfterChange = vi.fn();
    const { result } = renderHook(() => useMailListQuickFilters({
      setUnreadOnly: vi.fn(),
      setHasAttachmentsOnly: vi.fn(),
      filterDateFrom: '2026-08-13',
      filterDateTo: '',
      setFilterDateFrom,
      setFilterDateTo,
      onAfterChange,
      now: () => NOW,
    }));

    act(() => {
      result.current.handleToggleLast7DaysFilter();
    });

    expect(setFilterDateFrom).toHaveBeenCalledWith('');
    expect(setFilterDateTo).toHaveBeenCalledWith('');
    expect(onAfterChange).toHaveBeenCalledTimes(1);
  });
});
