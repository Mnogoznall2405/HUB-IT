import { useEffect, useRef } from 'react';

export default function useMailLastSyncedAt({
  mailBackgroundRefreshing,
  loading,
  listItems,
  mailLastSyncedAt,
  setMailLastSyncedAt,
} = {}) {
  const prevMailRefreshingRef = useRef(false);
  useEffect(() => {
    if (prevMailRefreshingRef.current && !mailBackgroundRefreshing) {
      setMailLastSyncedAt(Date.now());
    }
    prevMailRefreshingRef.current = mailBackgroundRefreshing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailBackgroundRefreshing]);
  useEffect(() => {
    if (!loading && mailLastSyncedAt == null && Array.isArray(listItems)) {
      setMailLastSyncedAt(Date.now());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listItems, loading, mailLastSyncedAt]);
}
