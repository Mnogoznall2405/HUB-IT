import { useCallback } from 'react';

export default function useMailMobileHistorySelection({
  viewModeRef,
  setViewMode,
  restoreMobileHistorySelection,
} = {}) {
  return useCallback((nextState) => {
    if (!nextState?.selectedId) return;
    if (viewModeRef.current !== nextState.selectionMode) {
      setViewMode(nextState.selectionMode);
    }
    restoreMobileHistorySelection(nextState);
  }, [restoreMobileHistorySelection, setViewMode, viewModeRef]);
}
