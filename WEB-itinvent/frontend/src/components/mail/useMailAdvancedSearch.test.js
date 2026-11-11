import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADVANCED_FILTERS,
  buildRecentSearchEntry,
  hasAdvancedSearchFilters,
} from './useMailAdvancedSearch';

describe('useMailAdvancedSearch model helpers', () => {
  it('builds a readable recent search label', () => {
    expect(buildRecentSearchEntry({
      q: 'router',
      from_filter: 'ops@example.com',
      subject_filter: 'incident',
      folder_scope: 'all',
    })).toMatchObject({
      q: 'router',
      from_filter: 'ops@example.com',
      subject_filter: 'incident',
      label: 'router • от:ops@example.com • тема:incident',
    });
  });

  it('detects active filters beyond the default state', () => {
    expect(hasAdvancedSearchFilters(DEFAULT_ADVANCED_FILTERS)).toBe(false);
    expect(hasAdvancedSearchFilters({ folder_scope: 'all' })).toBe(true);
    expect(hasAdvancedSearchFilters({ q: 'router' })).toBe(true);
  });
});
