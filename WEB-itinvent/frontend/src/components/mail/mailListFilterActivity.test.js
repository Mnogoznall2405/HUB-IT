import { describe, expect, it } from 'vitest';
import {
  getMailNoResultsHint,
  hasActiveMailListFilters,
  isMailAdvancedFiltersActive,
} from './mailListFilterActivity';

describe('mailListFilterActivity', () => {
  it('treats advanced filters as active without counting the toolbar query', () => {
    expect(isMailAdvancedFiltersActive({
      q: 'router',
      from_filter: '',
      to_filter: '',
      subject_filter: '',
      body_filter: '',
      importance: '',
      folder_scope: 'current',
    })).toBe(false);
    expect(isMailAdvancedFiltersActive({ from_filter: 'ops@example.com' })).toBe(true);
    expect(isMailAdvancedFiltersActive({ folder_scope: 'all' })).toBe(true);
    expect(isMailAdvancedFiltersActive({ body_filter: 'invoice' })).toBe(true);
  });

  it('marks the list as filtered from toolbar, date or advanced chips', () => {
    expect(hasActiveMailListFilters()).toBe(false);
    expect(hasActiveMailListFilters({ search: 'router' })).toBe(true);
    expect(hasActiveMailListFilters({ unreadOnly: true })).toBe(true);
    expect(hasActiveMailListFilters({ hasAttachmentsOnly: true })).toBe(true);
    expect(hasActiveMailListFilters({ filterDateFrom: '2026-08-20' })).toBe(true);
    expect(hasActiveMailListFilters({ advancedFiltersActive: true })).toBe(true);
  });

  it('returns empty-state copy for the current view and active filters', () => {
    expect(getMailNoResultsHint({ viewMode: 'messages' })).toBe('Нет писем');
    expect(getMailNoResultsHint({ viewMode: 'conversations' })).toBe('Нет цепочек');
    expect(getMailNoResultsHint({
      hasActiveFilters: true,
      viewMode: 'conversations',
    })).toBe('Ничего не найдено. Измените фильтры.');
  });
});
