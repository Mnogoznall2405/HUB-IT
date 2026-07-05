import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDatabaseSearch } from './useDatabaseSearch';

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

describe('useDatabaseSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('builds branch-filtered source data and search index', () => {
    const { result } = renderSearchHook({ selectedBranch: ' hq ' });

    expect(result.current.searchSourceData).toEqual({
      HQ: { Office: [printer], Lab: [pc] },
    });
    expect(result.current.searchIndex).toHaveLength(2);
    expect(result.current.searchIndex.map((entry) => entry.item)).toEqual([printer, pc]);
  });

  it('debounces search changes and expands matched branches and locations', () => {
    const { result } = renderSearchHook();

    act(() => {
      result.current.handleSearchChange({ target: { value: 'laser' } });
    });

    expect(result.current.searchQuery).toBe('laser');
    expect(result.current.filteredData).toBeNull();
    expect(setExpandedBranches).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(49);
    });
    expect(result.current.filteredData).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.filteredData).toEqual({ HQ: { Office: [printer] } });
    expect(setExpandedBranches).toHaveBeenLastCalledWith(new Set(['HQ']));
    expect(setExpandedLocations).toHaveBeenLastCalledWith(new Set(['HQ::Office']));
  });

  it('runs search immediately on Enter and cancels the pending debounce', () => {
    const preventDefault = vi.fn();
    const { result } = renderSearchHook();

    act(() => {
      result.current.handleSearchChange({ target: { value: 'anna' } });
      result.current.handleSearchKeyDown({ key: 'Enter', preventDefault });
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(result.current.filteredData).toEqual({ HQ: { Lab: [pc] } });
    expect(setExpandedBranches).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(setExpandedBranches).toHaveBeenCalledTimes(1);
  });

  it('clears filtered data for queries shorter than two characters', () => {
    const { result } = renderSearchHook();

    act(() => {
      result.current.handleSearchChange({ target: { value: 'laser' } });
      vi.advanceTimersByTime(50);
    });
    expect(result.current.filteredData).toEqual({ HQ: { Office: [printer] } });

    act(() => {
      result.current.handleSearchChange({ target: { value: 'l' } });
    });

    expect(result.current.searchQuery).toBe('l');
    expect(result.current.filteredData).toBeNull();

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(result.current.filteredData).toBeNull();
  });

  it('re-runs an active query when branch-filtered search data changes', () => {
    const { result, rerender } = renderHook(() => {
      const [searchQuery, setSearchQuery] = useState('');
      const [filteredData, setFilteredData] = useState(null);
      const [selectedBranch, setSelectedBranch] = useState('');
      const search = useDatabaseSearch({
        allEquipment: groupedEquipment,
        selectedBranch,
        setExpandedBranches,
        setExpandedLocations,
        debounceMs: 50,
        searchQuery,
        setSearchQuery,
        filteredData,
        setFilteredData,
      });
      return { ...search, setSelectedBranch };
    });

    act(() => {
      result.current.handleSearchChange({ target: { value: 'printer' } });
      vi.advanceTimersByTime(50);
    });

    expect(result.current.filteredData).toEqual({
      HQ: { Office: [printer] },
      Remote: { Stock: [stockPrinter] },
    });

    act(() => {
      result.current.setSelectedBranch('Remote');
    });

    expect(result.current.filteredData).toEqual({
      Remote: { Stock: [stockPrinter] },
    });
    expect(setExpandedBranches).toHaveBeenLastCalledWith(new Set(['Remote']));
    expect(setExpandedLocations).toHaveBeenLastCalledWith(new Set(['Remote::Stock']));
  });

  it('cancels pending debounced search on clearSearch and unmount', () => {
    const { result, unmount } = renderSearchHook();

    act(() => {
      result.current.handleSearchChange({ target: { value: 'laser' } });
      result.current.clearSearch();
      vi.advanceTimersByTime(50);
    });

    expect(result.current.searchQuery).toBe('');
    expect(result.current.filteredData).toBeNull();
    expect(setExpandedBranches).not.toHaveBeenCalled();

    act(() => {
      result.current.handleSearchChange({ target: { value: 'anna' } });
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(setExpandedBranches).not.toHaveBeenCalled();
  });
});
