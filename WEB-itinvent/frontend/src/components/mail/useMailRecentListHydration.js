import { useCallback, useEffect } from 'react';

import { getMailRecentHydration } from '../../lib/mailRecentCache';
import { peekSWRCache, setSWRCache } from '../../lib/swrCache';
import { createEmptyListData, normalizeMailListResponse } from './mailListModel';

export default function useMailRecentListHydration({
  mailCacheScope,
  currentListContextKey,
  currentListCacheKey,
  recentHydratedScope,
  currentListKeyRef,
  listDataRef,
  recentHydratedListContextsRef,
  setListData,
  setFolderSummary,
  setFolderTree,
  setRecentHydratedScope,
  setLoading,
  staleTimeMs,
  getRecentHydration = getMailRecentHydration,
  peekListCache = peekSWRCache,
  writeListCache = setSWRCache,
} = {}) {
  const hydrateFromRecentCache = useCallback(() => {
    const hydration = getRecentHydration({
      scope: mailCacheScope,
      contextKey: currentListContextKey,
    });
    const cachedList = peekListCache(currentListCacheKey, { staleTimeMs });
    const applyPendingListContext = () => {
      // Context changed but no list cache yet — drop the previous folder's rows and show loading.
      // Keeping stale inbox items under Sent/Drafts looks like a broken empty folder.
      if (String(currentListKeyRef.current || '') === currentListContextKey) return;
      const emptyList = createEmptyListData();
      listDataRef.current = emptyList;
      setListData(emptyList);
      currentListKeyRef.current = currentListContextKey;
      setLoading(true);
    };
    if (!hydration) {
      recentHydratedListContextsRef.current.delete(currentListContextKey);
      if (recentHydratedScope === mailCacheScope) {
        setRecentHydratedScope('');
      }
      if (cachedList?.data) {
        const normalizedList = normalizeMailListResponse(cachedList.data);
        listDataRef.current = normalizedList;
        setListData(normalizedList);
        currentListKeyRef.current = currentListContextKey;
        return true;
      }
      applyPendingListContext();
      return false;
    }
    if (hydration.folderSummary && Object.keys(hydration.folderSummary).length > 0) {
      setFolderSummary(hydration.folderSummary);
    }
    if (Array.isArray(hydration.folderTree) && hydration.folderTree.length > 0) {
      setFolderTree(hydration.folderTree);
    }
    if (hydration.listData) {
      const normalizedList = normalizeMailListResponse(hydration.listData);
      listDataRef.current = normalizedList;
      setListData(normalizedList);
      writeListCache(currentListCacheKey, normalizedList);
      currentListKeyRef.current = currentListContextKey;
      recentHydratedListContextsRef.current.add(currentListContextKey);
    } else if (cachedList?.data) {
      const normalizedList = normalizeMailListResponse(cachedList.data);
      listDataRef.current = normalizedList;
      setListData(normalizedList);
      currentListKeyRef.current = currentListContextKey;
      recentHydratedListContextsRef.current.delete(currentListContextKey);
    } else {
      recentHydratedListContextsRef.current.delete(currentListContextKey);
      applyPendingListContext();
    }
    setRecentHydratedScope(mailCacheScope);
    return true;
    // Keep the original Mail.jsx identity: extra setter/ref churn must not rehydrate.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentListCacheKey,
    currentListContextKey,
    mailCacheScope,
    recentHydratedScope,
  ]);

  useEffect(() => {
    hydrateFromRecentCache();
  }, [hydrateFromRecentCache]);

  return hydrateFromRecentCache;
}
