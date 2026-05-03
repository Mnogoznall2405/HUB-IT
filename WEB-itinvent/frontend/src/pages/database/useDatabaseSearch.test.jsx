import { act, renderHook } from '@testing-library/react';
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

const createProps = (overrides = {}) => ({
  allEquipment: groupedEquipment,
  selectedBranch: '',
  setExpandedBranches: vi.fn(),
  setExpandedLocations: vi.fn(),
  debounceMs: 50,
  ...overrides,
});

describe('useDatabaseSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('builds branch-filtered source data and search index', () => {
    const props = createProps({ selectedBranch: ' hq ' });
    const { result } = renderHook(() => useDatabaseSearch(props));

    expect(result.current.searchSourceData).toEqual({
      HQ: { Office: [printer], Lab: [pc] },
    });
    expect(result.current.searchIndex).toHaveLength(2);
    expect(result.current.searchIndex.map((entry) => entry.item)).toEqual([printer, pc]);
  });

  it('debounces search changes and expands matched branches and locations', () => {
    const props = createProps();
    const { result } = renderHook(() => useDatabaseSearch(props));

    act(() => {
      result.current.handleSearchChange({ target: { value: 'laser' } });
    });

    expect(result.current.searchQuery).toBe('laser');
    expect(result.current.filteredData).toBeNull();
    expect(props.setExpandedBranches).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(49);
    });
    expect(result.current.filteredData).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.filteredData).toEqual({ HQ: { Office: [printer] } });
    expect(props.setExpandedBranches).toHaveBeenLastCalledWith(new Set(['HQ']));
    expect(props.setExpandedLocations).toHaveBeenLastCalledWith(new Set(['HQ::Office']));
  });

  it('runs search immediately on Enter and cancels the pending debounce', () => {
    const props = createProps();
    const preventDefault = vi.fn();
    const { result } = renderHook(() => useDatabaseSearch(props));

    act(() => {
      result.current.handleSearchChange({ target: { value: 'anna' } });
      result.current.handleSearchKeyDown({ key: 'Enter', preventDefault });
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(result.current.filteredData).toEqual({ HQ: { Lab: [pc] } });
    expect(props.setExpandedBranches).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(props.setExpandedBranches).toHaveBeenCalledTimes(1);
  });

  it('clears filtered data for queries shorter than two characters', () => {
    const props = createProps();
    const { result } = renderHook(() => useDatabaseSearch(props));

    act(() => {
      result.current.runSearchNow('laser');
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
    const props = createProps();
    const { result, rerender } = renderHook((hookProps) => useDatabaseSearch(hookProps), {
      initialProps: props,
    });

    act(() => {
      result.current.handleSearchChange({ target: { value: 'printer' } });
      vi.advanceTimersByTime(50);
    });

    expect(result.current.filteredData).toEqual({
      HQ: { Office: [printer] },
      Remote: { Stock: [stockPrinter] },
    });

    const nextProps = { ...props, selectedBranch: 'Remote' };
    rerender(nextProps);

    expect(result.current.filteredData).toEqual({
      Remote: { Stock: [stockPrinter] },
    });
    expect(nextProps.setExpandedBranches).toHaveBeenLastCalledWith(new Set(['Remote']));
    expect(nextProps.setExpandedLocations).toHaveBeenLastCalledWith(new Set(['Remote::Stock']));
  });

  it('cancels pending debounced search on clearSearch and unmount', () => {
    const props = createProps();
    const { result, unmount } = renderHook(() => useDatabaseSearch(props));

    act(() => {
      result.current.handleSearchChange({ target: { value: 'laser' } });
      result.current.clearSearch();
      vi.advanceTimersByTime(50);
    });

    expect(result.current.searchQuery).toBe('');
    expect(result.current.filteredData).toBeNull();
    expect(props.setExpandedBranches).not.toHaveBeenCalled();

    act(() => {
      result.current.handleSearchChange({ target: { value: 'anna' } });
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(props.setExpandedBranches).not.toHaveBeenCalled();
  });
});
