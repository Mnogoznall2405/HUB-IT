import { useEffect } from 'react';

export default function useMailConversationSelectionGuard({
  viewMode,
  selectedId,
  listItems,
  clearSelection,
} = {}) {
  useEffect(() => {
    if (viewMode !== 'conversations' || !selectedId) return;
    const currentConversationIds = (Array.isArray(listItems) ? listItems : [])
      .map((item) => String(item?.conversation_id || item?.id || ''))
      .filter(Boolean);
    if (currentConversationIds.length > 0 && !currentConversationIds.includes(String(selectedId))) {
      clearSelection({ mode: 'conversations' });
    }
  }, [selectedId, viewMode, listItems, clearSelection]);
}
