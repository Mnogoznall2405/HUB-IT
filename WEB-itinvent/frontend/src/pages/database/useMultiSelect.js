import { useCallback, useMemo, useRef, useState } from 'react';

export function useMultiSelect() {
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  const selectedIdsRef = useRef(selectedIds);

  const toggleSelection = useCallback((id) => {
    // Compute from the ref and call the setters outside any state updater (updaters must be pure).
    const next = new Set(selectedIdsRef.current);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedIdsRef.current = next;
    setSelectedIds(next);
    setSelectionMode(next.size > 0);
  }, []);

  const selectAll = useCallback((items) => {
    const next = new Set(items.map((item) => item.id || item));
    selectedIdsRef.current = next;
    setSelectedIds(next);
    setSelectionMode(true);
  }, []);

  const clearSelection = useCallback(() => {
    selectedIdsRef.current = new Set();
    setSelectedIds(selectedIdsRef.current);
    setSelectionMode(false);
  }, []);

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
  }, []);

  const exitSelectionMode = useCallback(() => {
    selectedIdsRef.current = new Set();
    setSelectedIds(selectedIdsRef.current);
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
