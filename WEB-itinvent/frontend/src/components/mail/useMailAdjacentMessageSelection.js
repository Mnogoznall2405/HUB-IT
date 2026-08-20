import { useCallback } from 'react';

import { createSelectedMessagePreviewShell } from './mailDetailModel';
import { resolveAdjacentMailListItem } from './mailListSelection';

export default function useMailAdjacentMessageSelection({
  listData,
  selectedId,
  selectedIdRef,
  setSelectedId,
  setSelectedByMode,
  setSelectedConversation,
  setSelectedMessage,
  viewMode,
  folder,
} = {}) {
  return useCallback((delta) => {
    const resolved = resolveAdjacentMailListItem({
      items: listData?.items,
      selectedId,
      delta,
    });
    if (!resolved) return;
    selectedIdRef.current = resolved.nextId;
    setSelectedId(resolved.nextId);
    setSelectedByMode((prev) => ({ ...(prev || {}), [viewMode]: resolved.nextId }));
    if (viewMode === 'messages') {
      const previewShell = createSelectedMessagePreviewShell(resolved.next, folder);
      if (previewShell) {
        setSelectedConversation(null);
        setSelectedMessage(previewShell);
      }
    }
  }, [
    folder,
    listData?.items,
    selectedId,
    selectedIdRef,
    setSelectedByMode,
    setSelectedConversation,
    setSelectedId,
    setSelectedMessage,
    viewMode,
  ]);
}
