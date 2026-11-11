import { useEffect } from 'react';

export default function useMailListLoadMoreObserver({
  loadMoreSentinelRef,
  hasMore,
  loadMoreMessages,
} = {}) {
  useEffect(() => {
    if (!loadMoreSentinelRef.current || !hasMore) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMoreMessages();
    }, { threshold: 0.1 });
    observer.observe(loadMoreSentinelRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMoreMessages, hasMore]);
}
