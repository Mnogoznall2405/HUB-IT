import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { equipmentAPI } from '../../api/client';
import { buildCacheKey, getOrFetchSWR } from '../../lib/swrCache';
import { useDatabaseLookups } from './useDatabaseLookups';

vi.mock('../../api/client', () => ({
  equipmentAPI: {
    searchOwners: vi.fn(),
    getOwnerDepartments: vi.fn(),
    getLocations: vi.fn(),
    getModels: vi.fn(),
  },
}));

vi.mock('../../lib/swrCache', () => ({
  buildCacheKey: vi.fn((...parts) => parts.join('|')),
  getOrFetchSWR: vi.fn(async (_cacheKey, fetcher) => ({ data: await fetcher() })),
}));

describe('useDatabaseLookups', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('builds the cache scope from selected_database, dbName, then default', () => {
    const { result, rerender } = renderHook((props) => useDatabaseLookups(props), {
      initialProps: { dbName: ' fallback-db ' },
    });

    expect(result.current.getDbCacheScope()).toBe('fallback-db');

    localStorage.setItem('selected_database', ' selected-db ');
    expect(result.current.getDbCacheScope()).toBe('selected-db');

    localStorage.removeItem('selected_database');
    rerender({ dbName: '' });
    expect(result.current.getDbCacheScope()).toBe('default');
  });

  it('caches owner search by normalized query and delegates original API arguments', async () => {
    equipmentAPI.searchOwners.mockResolvedValueOnce([{ id: 1, name: 'Ivan' }]);
    const { result } = renderHook(() => useDatabaseLookups({ dbName: ' main ', staleTimeMs: 1234 }));

    await expect(result.current.searchOwnersCached(' Ivan ', '7')).resolves.toEqual([
      { id: 1, name: 'Ivan' },
    ]);

    expect(buildCacheKey).toHaveBeenCalledWith('owners-search', 'main', 'ivan', 7);
    expect(getOrFetchSWR).toHaveBeenCalledWith(
      'owners-search|main|ivan|7',
      expect.any(Function),
      { staleTimeMs: 1234 }
    );
    expect(equipmentAPI.searchOwners).toHaveBeenCalledWith(' Ivan ', '7');
  });

  it('caches owner departments by normalized limit and delegates the API call', async () => {
    equipmentAPI.getOwnerDepartments.mockResolvedValueOnce(['IT', 'HR']);
    const { result } = renderHook(() => useDatabaseLookups({ dbName: 'main' }));

    await expect(result.current.getOwnerDepartmentsCached('1000')).resolves.toEqual(['IT', 'HR']);

    expect(buildCacheKey).toHaveBeenCalledWith('owners-departments', 'main', 1000);
    expect(getOrFetchSWR).toHaveBeenCalledWith(
      'owners-departments|main|1000',
      expect.any(Function),
      { staleTimeMs: 30000 }
    );
    expect(equipmentAPI.getOwnerDepartments).toHaveBeenCalledWith('1000');
  });

  it('caches locations by trimmed branch number and delegates the original value', async () => {
    equipmentAPI.getLocations.mockResolvedValueOnce([{ loc_no: 10 }]);
    localStorage.setItem('selected_database', ' selected ');
    const { result } = renderHook(() => useDatabaseLookups({ dbName: 'main' }));

    await expect(result.current.getLocationsCached(' 17 ')).resolves.toEqual([{ loc_no: 10 }]);

    expect(buildCacheKey).toHaveBeenCalledWith('locations-priority', 'selected', '17');
    expect(getOrFetchSWR).toHaveBeenCalledWith(
      'locations-priority|selected|17',
      expect.any(Function),
      { staleTimeMs: 30000 }
    );
    expect(equipmentAPI.getLocations).toHaveBeenCalledWith(' 17 ');
  });

  it('caches models by numeric type and ci type and delegates safe ci type', async () => {
    equipmentAPI.getModels.mockResolvedValueOnce([{ model_no: 2 }]);
    const { result } = renderHook(() => useDatabaseLookups({ dbName: 'main' }));

    await expect(result.current.getModelsCached('5', '4')).resolves.toEqual([{ model_no: 2 }]);

    expect(buildCacheKey).toHaveBeenCalledWith('models-by-type', 'main', 5, 4);
    expect(getOrFetchSWR).toHaveBeenCalledWith(
      'models-by-type|main|5|4',
      expect.any(Function),
      { staleTimeMs: 30000 }
    );
    expect(equipmentAPI.getModels).toHaveBeenCalledWith('5', 4);
  });
});
