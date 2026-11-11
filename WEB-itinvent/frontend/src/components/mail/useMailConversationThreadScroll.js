import { useEffect } from 'react';

export default function useMailConversationThreadScroll({
  viewMode,
  selectedId,
  selectedConversationItemCount,
  conversationScrollRef,
} = {}) {
  useEffect(() => {
    if (viewMode !== 'conversations') return;
    const node = conversationScrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedId, selectedConversationItemCount]);
}
