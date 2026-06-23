import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DATABASE_BRANCH_FILTERS_CACHE_KEY,
  getBranchForDatabase,
  mergeServerBranchFilters,
  normalizeDatabaseBranchFilters,
  readCachedBranchFilters,
  resolveValidatedBranch,
  schedulePersistBranchFilters,
  setBranchForDatabase,
  flushPersistBranchFilters,
} from './databaseBranchPreferences';

describe('databaseBranchPreferences', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    flushPersistBranchFilters();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('normalizes and stores branch filters per database', () => {
    expect(normalizeDatabaseBranchFilters({
      main: ' HQ ',
      '': 'Ignored',
      remote: '',
      branch2: 'Remote',
    })).toEqual({
      main: 'HQ',
      remote: '',
      branch2: 'Remote',
    });

    const filters = setBranchForDatabase('main', 'HQ');
    expect(filters).toEqual({ main: 'HQ' });
    expect(localStorage.getItem(DATABASE_BRANCH_FILTERS_CACHE_KEY)).toBe(JSON.stringify({ main: 'HQ' }));
    expect(getBranchForDatabase('main')).toBe('HQ');
  });

  it('stores explicit all-branches choice as an empty value', () => {
    setBranchForDatabase('main', 'HQ');
    const filters = setBranchForDatabase('main', '');
    expect(filters).toEqual({ main: '' });
    expect(localStorage.getItem(DATABASE_BRANCH_FILTERS_CACHE_KEY)).toBe(JSON.stringify({ main: '' }));
    expect(getBranchForDatabase('main')).toBe('');
  });

  it('replaces cache from server payload', () => {
    setBranchForDatabase('main', 'HQ');
    const merged = mergeServerBranchFilters({ remote: 'Remote' });
    expect(merged).toEqual({ remote: 'Remote' });
    expect(readCachedBranchFilters()).toEqual({ remote: 'Remote' });
  });

  it('validates branch against available branches', () => {
    const branches = [{ BRANCH_NAME: 'HQ' }, { BRANCH_NAME: 'Remote' }];
    expect(resolveValidatedBranch('HQ', branches)).toBe('HQ');
    expect(resolveValidatedBranch('Missing', branches)).toBe('');
    expect(resolveValidatedBranch('', branches)).toBe('');
  });

  it('debounces server persistence', async () => {
    const patchFn = vi.fn().mockResolvedValue({});
    schedulePersistBranchFilters(patchFn, { main: 'HQ' });

    expect(patchFn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(399);
    expect(patchFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await Promise.resolve();

    expect(patchFn).toHaveBeenCalledTimes(1);
    expect(patchFn).toHaveBeenCalledWith({ database_branch_filters: { main: 'HQ' } });
  });

  it('persists explicit all-branches choice to the server', async () => {
    const patchFn = vi.fn().mockResolvedValue({});
    schedulePersistBranchFilters(patchFn, { main: '' });

    vi.advanceTimersByTime(400);
    await Promise.resolve();

    expect(patchFn).toHaveBeenCalledWith({ database_branch_filters: { main: '' } });
  });
});
