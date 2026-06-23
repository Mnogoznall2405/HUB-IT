import { useEffect, useRef } from 'react';

export function useDatabaseEquipmentInfiniteScroll({
  enabled = false,
  hasMore = false,
  loading = false,
  onLoadMore,
  nextPage = null,
  loadedCount = 0,
  serverTotal = 0,
}) {
  const sentinelRef = useRef(null);
  const onLoadMoreRef = useRef(onLoadMore);
  const loadingRef = useRef(loading);

  onLoadMoreRef.current = onLoadMore;
  loadingRef.current = loading;

  useEffect(() => {
    if (!enabled || !hasMore || !sentinelRef.current || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      const isIntersecting = Boolean(entries[0]?.isIntersecting);
      const isLoading = loadingRef.current;

      if (!isIntersecting || isLoading) return;
      onLoadMoreRef.current?.();
    }, { threshold: 0.1, rootMargin: '240px' });

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [enabled, hasMore, loading, nextPage, loadedCount, serverTotal]);

  return sentinelRef;
}

export default useDatabaseEquipmentInfiniteScroll;
