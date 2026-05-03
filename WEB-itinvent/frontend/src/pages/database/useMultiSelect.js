import { useCallback, useMemo, useState } from 'react';

export function useMultiSelect() {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  const toggleSelection = useCallback((id) => {
    console.log('[MultiSelect] toggleSelection called for:', id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        console.log('[MultiSelect] Deselected:', id);
      } else {
        next.add(id);
        console.log('[MultiSelect] Selected:', id);
      }

      if (next.size === 0) {
        console.log('[MultiSelect] Exit selection mode, count:', next.size);
        setSelectionMode(false);
      } else {
        console.log('[MultiSelect] Enter selection mode, count:', next.size);
        setSelectionMode(true);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((items) => {
    setSelectedIds(new Set(items.map((item) => item.id || item)));
    setSelectionMode(true);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, []);

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectedIds(new Set());
    setSelectionMode(false);
  }, []);

  return useMemo(() => ({
    selectedIds,
    selectionMode,
    toggleSelection,
    selectAll,
    clearSelection,
    enterSelectionMode,
    exitSelectionMode,
    isSelected: (id) => selectedIds.has(id),
    selectedCount: selectedIds.size,
  }), [
    clearSelection,
    enterSelectionMode,
    exitSelectionMode,
    selectAll,
    selectedIds,
    selectionMode,
    toggleSelection,
  ]);
}
