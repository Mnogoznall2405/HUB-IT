import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDatabaseListNavigation } from './useDatabaseListNavigation';

const displayData = {
  HQ: {
    Office: [
      { INV_NO: 'printer-1', TYPE_NAME: 'Printer', MODEL_NAME: 'LaserJet' },
      { INV_NO: 'printer-2', TYPE_NAME: 'MFP', MODEL_NAME: 'WorkCentre' },
    ],
    Stock: [
      { INV_NO: 'pc-1', TYPE_NAME: 'PC', MODEL_NAME: 'ThinkCentre' },
    ],
  },
  Remote: {
    Warehouse: [
      { INV_NO: 'ups-1', TYPE_NAME: 'UPS APC' },
    ],
  },
};

const equipmentByInvNo = new Map(
  Object.values(displayData)
    .flatMap((locations) => Object.values(locations))
    .flatMap((items) => items)
    .map((item) => [item.INV_NO, item])
);

const createProps = (overrides = {}) => ({
  displayData,
  visibleBranchNames: ['HQ', 'Remote'],
  findEquipmentByInvNo: vi.fn((invNo) => equipmentByInvNo.get(invNo) || null),
  ...overrides,
});

describe('useDatabaseListNavigation', () => {
  it('toggles visible branches and removes collapsed branch locations', () => {
    const { result } = renderHook(() => useDatabaseListNavigation(createProps()));

    act(() => {
      result.current.toggleBranch('HQ');
      result.current.toggleLocation('HQ', 'Office');
      result.current.toggleLocation('Remote', 'Warehouse');
    });

    expect(result.current.expandedBranches).toEqual(new Set(['HQ']));
    expect(result.current.expandedLocations).toEqual(new Set(['HQ::Office', 'Remote::Warehouse']));
    expect(result.current.hasExpandedVisible).toBe(true);

    act(() => {
      result.current.toggleBranch('HQ');
    });

    expect(result.current.expandedBranches).toEqual(new Set());
    expect(result.current.expandedLocations).toEqual(new Set(['Remote::Warehouse']));
    expect(result.current.hasExpandedVisible).toBe(true);
  });

  it('toggles locations independently', () => {
    const { result } = renderHook(() => useDatabaseListNavigation(createProps()));

    act(() => {
      result.current.toggleLocation('HQ', 'Office');
    });

    expect(result.current.expandedLocations).toEqual(new Set(['HQ::Office']));
    expect(result.current.visibleLocationKeys).toEqual(['HQ::Office', 'HQ::Stock', 'Remote::Warehouse']);

    act(() => {
      result.current.toggleLocation('HQ', 'Office');
    });

    expect(result.current.expandedLocations).toEqual(new Set());
  });

  it('selects and deselects an item, and mobile card selection enables mobile selection mode', () => {
    const { result } = renderHook(() => useDatabaseListNavigation(createProps()));

    act(() => {
      result.current.handleCheckboxChange(' printer-1 ');
    });

    expect(result.current.selectedItems).toEqual(['printer-1']);
    expect(result.current.selectedItemsSet).toEqual(new Set(['printer-1']));
    expect(result.current.mobileSelectionMode).toBe(false);

    act(() => {
      result.current.handleMobileCardSelect('printer-2');
    });

    expect(result.current.selectedItems).toEqual(['printer-1', 'printer-2']);
    expect(result.current.mobileSelectionMode).toBe(true);

    act(() => {
      result.current.handleCheckboxChange('printer-1');
      result.current.handleCheckboxChange('printer-2');
    });

    expect(result.current.selectedItems).toEqual([]);
    expect(result.current.mobileSelectionMode).toBe(false);
  });

  it('selects all visible items from the provided list and can clear them', () => {
    const { result } = renderHook(() => useDatabaseListNavigation(createProps()));
    const visibleItems = displayData.HQ.Office;

    act(() => {
      result.current.handleSelectAll(visibleItems, { target: { checked: true } });
    });

    expect(result.current.selectedItems).toEqual(['printer-1', 'printer-2']);
    expect(result.current.selectedVisibleCount).toBe(2);
    expect(result.current.selectedHiddenCount).toBe(0);

    act(() => {
      result.current.handleSelectAll(visibleItems, { target: { checked: false } });
    });

    expect(result.current.selectedItems).toEqual([]);
  });

  it('derives hidden count and capabilities from the selected inventory numbers', () => {
    const { result } = renderHook(() => useDatabaseListNavigation(createProps()));

    act(() => {
      result.current.setSelectedItems(['printer-1', 'printer-2', 'missing']);
    });

    expect(result.current.selectedVisibleCount).toBe(2);
    expect(result.current.selectedHiddenCount).toBe(1);
    expect(result.current.selectedItemsCapabilities).toEqual({
      canCartridge: false,
      canBattery: false,
      canComponent: false,
      componentKind: null,
      canCleaning: false,
    });

    act(() => {
      result.current.setSelectedItems(['printer-1', 'printer-2']);
    });

    expect(result.current.selectedItemsCapabilities).toEqual({
      canCartridge: true,
      canBattery: false,
      canComponent: true,
      componentKind: 'printer',
      canCleaning: false,
    });
  });

  it('collapses all visible navigation state', () => {
    const { result } = renderHook(() => useDatabaseListNavigation(createProps()));

    act(() => {
      result.current.setExpandedBranches(new Set(['HQ']));
      result.current.setExpandedLocations(new Set(['HQ::Office']));
    });

    expect(result.current.hasExpandedVisible).toBe(true);

    act(() => {
      result.current.handleCollapseAll();
    });

    expect(result.current.expandedBranches).toEqual(new Set());
    expect(result.current.expandedLocations).toEqual(new Set());
    expect(result.current.hasExpandedVisible).toBe(false);
  });
});
