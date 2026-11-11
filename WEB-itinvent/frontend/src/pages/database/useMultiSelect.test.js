import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMultiSelect } from './useMultiSelect';

describe('useMultiSelect', () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy?.mockRestore();
  });

  it('toggles selection mode as ids are selected and deselected', () => {
    const { result } = renderHook(() => useMultiSelect());

    expect(result.current.selectedCount).toBe(0);
    expect(result.current.selectionMode).toBe(false);

    act(() => {
      result.current.toggleSelection('1001');
    });

    expect(result.current.selectedCount).toBe(1);
    expect(result.current.isSelected('1001')).toBe(true);
    expect(result.current.selectionMode).toBe(true);

    act(() => {
      result.current.toggleSelection('1001');
    });

    expect(result.current.selectedCount).toBe(0);
    expect(result.current.isSelected('1001')).toBe(false);
    expect(result.current.selectionMode).toBe(false);
  });

  it('selects all ids from rows and clears them explicitly', () => {
    const { result } = renderHook(() => useMultiSelect());

    act(() => {
      result.current.selectAll([{ id: '1001' }, '1002']);
    });

    expect(Array.from(result.current.selectedIds)).toEqual(['1001', '1002']);
    expect(result.current.selectedCount).toBe(2);
    expect(result.current.selectionMode).toBe(true);

    act(() => {
      result.current.clearSelection();
    });

    expect(result.current.selectedCount).toBe(0);
    expect(result.current.selectionMode).toBe(false);
  });

  it('can enter and exit selection mode without selecting rows', () => {
    const { result } = renderHook(() => useMultiSelect());

    act(() => {
      result.current.enterSelectionMode();
    });

    expect(result.current.selectionMode).toBe(true);

    act(() => {
      result.current.exitSelectionMode();
    });

    expect(result.current.selectedCount).toBe(0);
    expect(result.current.selectionMode).toBe(false);
  });
});
