import { useCallback } from 'react';

export const getMailQuickFilterIsoDate = (value = new Date()) => (
  new Date(value).toISOString().slice(0, 10)
);

export const getMailLast7DaysFromIsoDate = (value = new Date()) => {
  const date = new Date(value);
  date.setDate(date.getDate() - 7);
  return getMailQuickFilterIsoDate(date);
};

export const toggleMailTodayFilter = (filterDateFrom, filterDateTo, now = new Date()) => {
  const today = getMailQuickFilterIsoDate(now);
  const active = filterDateFrom === today && filterDateTo === today;
  return {
    filterDateFrom: active ? '' : today,
    filterDateTo: active ? '' : today,
  };
};

export const toggleMailLast7DaysFilter = (filterDateFrom, filterDateTo, now = new Date()) => {
  const from = getMailLast7DaysFromIsoDate(now);
  const active = filterDateFrom === from && !filterDateTo;
  return {
    filterDateFrom: active ? '' : from,
    filterDateTo: '',
  };
};

export default function useMailListQuickFilters({
  setUnreadOnly,
  setHasAttachmentsOnly,
  filterDateFrom = '',
  filterDateTo = '',
  setFilterDateFrom,
  setFilterDateTo,
  onAfterChange,
  now,
} = {}) {
  const handleUnreadToggle = useCallback((value) => {
    setUnreadOnly(Boolean(value));
    onAfterChange?.();
  }, [onAfterChange, setUnreadOnly]);

  const handleToggleHasAttachmentsOnly = useCallback(() => {
    setHasAttachmentsOnly((prev) => !prev);
    onAfterChange?.();
  }, [onAfterChange, setHasAttachmentsOnly]);

  const handleToggleTodayFilter = useCallback(() => {
    const next = toggleMailTodayFilter(
      filterDateFrom,
      filterDateTo,
      typeof now === 'function' ? now() : new Date(),
    );
    setFilterDateFrom(next.filterDateFrom);
    setFilterDateTo(next.filterDateTo);
    onAfterChange?.();
  }, [filterDateFrom, filterDateTo, now, onAfterChange, setFilterDateFrom, setFilterDateTo]);

  const handleToggleLast7DaysFilter = useCallback(() => {
    const next = toggleMailLast7DaysFilter(
      filterDateFrom,
      filterDateTo,
      typeof now === 'function' ? now() : new Date(),
    );
    setFilterDateFrom(next.filterDateFrom);
    setFilterDateTo(next.filterDateTo);
    onAfterChange?.();
  }, [filterDateFrom, filterDateTo, now, onAfterChange, setFilterDateFrom, setFilterDateTo]);

  return {
    handleUnreadToggle,
    handleToggleHasAttachmentsOnly,
    handleToggleTodayFilter,
    handleToggleLast7DaysFilter,
  };
}
