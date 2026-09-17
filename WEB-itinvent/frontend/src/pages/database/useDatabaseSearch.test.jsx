import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { equipmentAPI } from '../../api/client';
import { useDatabaseSearch } from './useDatabaseSearch';

vi.mock('../../api/client', () => ({
  equipmentAPI: {
    searchUniversal: vi.fn(),
  },
}));

const printer = {
  INV_NO: 'INV-1',
  MODEL_NAME: 'LaserJet 400',
  TYPE_NAME: 'Printer',
  OWNER_DISPLAY_NAME: 'Ivan Petrov',
  MAC_ADDRESS: 'AA:BB-CC 11',
};

const pc = {
  inv_no: 'INV-2',
  model_name: 'ThinkCentre',
  type_name: 'PC',
  employee_name: 'Anna Sidorova',
  ip_address: '10.0.0.6',
};

const stockPrinter = {
  INV_NO: 'INV-3',
  MODEL_NAME: 'DeskJet Stock',
  TYPE_NAME: 'Printer',
};

const groupedEquipment = {
  HQ: { Office: [printer], Lab: [pc] },
  Remote: { Stock: [stockPrinter] },
};

// Flat rows the server returns (search/universal shape).
const serverPrinterRow = {
  id: 11,
  inv_no: 'INV-1',
  model_name: 'LaserJet 400',
  type_name: 'Printer',
  branch_name: 'HQ',
  location: 'Office',
};

const serverRemoteRow = {
  id: 12,
  inv_no: 'INV-3',
  model_name: 'DeskJet Stock',
  type_name: 'Printer',
  branch_name: 'Remote',
  location: 'Stock',
};

const setExpandedBranches = vi.fn();
const setExpandedLocations = vi.fn();

const createProps = (overrides = {}) => ({
  allEquipment: groupedEquipment,
  selectedBranch: '',
  setExpandedBranches,
  setExpandedLocations,
  debounceMs: 50,
  ...overrides,
});

function renderSearchHook(overrides = {}) {
  const hookProps = createProps(overrides);
  return renderHook(() => {
    const [searchQuery, setSearchQuery] = useState('');
    const [filteredData, setFilteredData] = useState(null);
    const search = useDatabaseSearch({
      ...hookProps,
      searchQuery,
      setSearchQuery,
      filteredData,
      setFilteredData,
    });
    return search;
  });
}

describe('useDatabaseSearch (server-primary)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    equipmentAPI.searchUniversal.mockResolvedValue({
      equipment: [serverPrinterRow],
      total: 1,
      page: 1,
      pages: 1,
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('debounces input and groups server rows into branch/location data', async () => {
    const { result } = renderSearchHook();

    act(() => {
      result.current.handleSearchChange({ target: { value: 'laser' } });
    });

    expect(result.current.searchQuery).toBe('laser');
    expect(result.current.appliedSearchQuery).toBe('');
    expect(equipmentAPI.searchUniversal).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    expect(equipmentAPI.searchUniversal).toHaveBeenCalledWith('laser', 1, 200);
    expect(result.current.appliedSearchQuery).toBe('laser');
    expect(result.current.filteredData).toEqual({ HQ: { Office: [serverPrinterRow] } });
    expect(setExpandedBranches).toHaveBeenLastCalledWith(new Set(['HQ']));
    expect(setExpandedLocations).toHaveBeenLastCalledWith(new Set(['HQ::Office']));
    expect(result.current.searchHasMore).toBe(false);
  });

  it('runs the server search immediately on Enter and cancels the debounce', async () => {
    const preventDefault = vi.fn();
    const { result } = renderSearchHook();

    act(() => {
      result.current.handleSearchChange({ target: { value: 'laser' } });
    });
    await act(async () => {
      result.current.handleSearchKeyDown({ key: 'Enter', preventDefault });
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(equipmentAPI.searchUniversal).toHaveBeenCalledTimes(1);
    expect(result.current.filteredData).toEqual({ HQ: { Office: [serverPrinterRow] } });
  });

  it('clears filtered data for queries shorter than two characters', async () => {
    const { result } = renderSearchHook();

    act(() => {
      result.current.handleSearchChange({ target: { value: 'laser' } });
    });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.filteredData).not.toBeNull();

    act(() => {
      result.current.handleSearchChange({ target: { value: 'l' } });
    });

    expect(result.current.filteredData).toBeNull();
    expect(result.current.appliedSearchQuery).toBe('');
  });

  it('re-runs the active server query when the branch filter changes', async () => {
    equipmentAPI.searchUniversal.mockResolvedValue({
      equipment: [serverPrinterRow, serverRemoteRow],
      total: 2,
      page: 1,
      pages: 1,
    });
    const { result, rerender } = renderHook((props) => {
      const [searchQuery, setSearchQuery] = useState('');
      const [filteredData, setFilteredData] = useState(null);
      const search = useDatabaseSearch({
        ...createProps({ selectedBranch: props.selectedBranch }),
        searchQuery,
        setSearchQuery,
        filteredData,
        setFilteredData,
      });
      return search;
    }, { initialProps: { selectedBranch: '' } });

    act(() => {
      result.current.handleSearchChange({ target: { value: 'printer' } });
    });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.filteredData).toEqual({
      HQ: { Office: [serverPrinterRow] },
      Remote: { Stock: [serverRemoteRow] },
    });

    rerender({ selectedBranch: 'Remote' });
    await act(async () => {
      await Promise.resolve();
    });

    expect(equipmentAPI.searchUniversal).toHaveBeenLastCalledWith('printer', 1, 200);
    expect(result.current.filteredData).toEqual({ Remote: { Stock: [serverRemoteRow] } });
    expect(setExpandedBranches).toHaveBeenLastCalledWith(new Set(['Remote']));
  });

  it('does not re-run the search when more list pages load', async () => {
    const { result, rerender } = renderHook((props) => {
      const [searchQuery, setSearchQuery] = useState('');
      const [filteredData, setFilteredData] = useState(null);
      const search = useDatabaseSearch({
        ...createProps({ allEquipment: props.allEquipment }),
        searchQuery,
        setSearchQuery,
        filteredData,
        setFilteredData,
      });
      return search;
    }, { initialProps: { allEquipment: groupedEquipment } });

    act(() => {
      result.current.handleSearchChange({ target: { value: 'laser' } });
    });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(equipmentAPI.searchUniversal).toHaveBeenCalledTimes(1);
    const calls = setExpandedBranches.mock.calls.length;

    // A second list page merged into allEquipment must not retrigger search.
    rerender({
      allEquipment: { ...groupedEquipment, Remote2: { Stock: [stockPrinter] } },
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(equipmentAPI.searchUniversal).toHaveBeenCalledTimes(1);
    expect(setExpandedBranches.mock.calls.length).toBe(calls);
    expect(result.current.filteredData).toEqual({ HQ: { Office: [serverPrinterRow] } });
  });

  it('falls back to the client index on server failure and flags degradation', async () => {
    equipmentAPI.searchUniversal.mockRejectedValue(new Error('offline'));
    const { result } = renderSearchHook();

    act(() => {
      result.current.handleSearchChange({ target: { value: 'laser' } });
    });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    expect(result.current.serverSearchDegraded).toBe(true);
    // Fallback index matched the locally loaded printer.
    expect(result.current.filteredData).toEqual({ HQ: { Office: [printer] } });
    expect(setExpandedBranches).toHaveBeenLastCalledWith(new Set(['HQ']));
  });

  it('paginates server results via loadMoreSearchResults', async () => {
    equipmentAPI.searchUniversal
      .mockResolvedValueOnce({
        equipment: [serverPrinterRow],
        total: 2,
        page: 1,
        pages: 2,
      })
      .mockResolvedValueOnce({
        equipment: [serverRemoteRow],
        total: 2,
        page: 2,
        pages: 2,
      });
    const { result } = renderSearchHook();

    act(() => {
      result.current.handleSearchChange({ target: { value: 'printer' } });
    });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.searchHasMore).toBe(true);
    expect(result.current.searchTotal).toBe(2);

    await act(async () => {
      result.current.loadMoreSearchResults();
    });

    expect(equipmentAPI.searchUniversal).toHaveBeenLastCalledWith('printer', 2, 200);
    expect(result.current.filteredData).toEqual({
      HQ: { Office: [serverPrinterRow] },
      Remote: { Stock: [serverRemoteRow] },
    });
    expect(result.current.searchHasMore).toBe(false);
    // load-more merges via functional updates — resolve them against the
    // previously expanded set.
    const lastUpdater = setExpandedBranches.mock.calls.at(-1)[0];
    const merged = typeof lastUpdater === 'function' ? lastUpdater(new Set(['HQ'])) : lastUpdater;
    expect(merged).toEqual(new Set(['HQ', 'Remote']));
  });

  it('cancels pending debounced search on clearSearch and unmount', async () => {
    const { result, unmount } = renderSearchHook();

    act(() => {
      result.current.handleSearchChange({ target: { value: 'laser' } });
      result.current.clearSearch();
    });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    expect(result.current.searchQuery).toBe('');
    expect(result.current.appliedSearchQuery).toBe('');
    expect(result.current.filteredData).toBeNull();
    expect(equipmentAPI.searchUniversal).not.toHaveBeenCalled();

    act(() => {
      result.current.handleSearchChange({ target: { value: 'laser' } });
    });
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(equipmentAPI.searchUniversal).not.toHaveBeenCalled();
  });
});
