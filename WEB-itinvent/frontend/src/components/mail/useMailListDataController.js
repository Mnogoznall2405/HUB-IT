import { useCallback } from 'react';
import {
  getOrFetchSWR,
  peekSWRCache,
  setSWRCache,
} from '../../lib/swrCache';
import {
  getMailboxEntryId,
  mergeMailboxEntries,
} from './mailMailboxModel';
import {
  buildMailBootstrapCacheKey,
  buildMailFolderSummaryCacheKey,
  buildMailFolderTreeCacheKey,
  buildMailListCacheKey,
  buildMailListState,
  createEmptyListData,
  isExpandedMailListData,
  isListItemSame,
  normalizeMailListResponse,
} from './mailListModel';
import { normalizeMailViewMode } from './mailViewStateModel';

export default function useMailListDataController({
  activeMailboxId = '',
  advancedFiltersApplied = {},
  clearSelection,
  currentContextUsesBootstrapList = false,
  currentFolderScope = 'current',
  currentFolderSummaryCacheKey,
  currentFolderTreeCacheKey,
  currentListCacheKey,
  currentListContextKey = '',
  currentListParams = {},
  debouncedSearch = '',
  defaultMailPreferences = {},
  filterDateFrom = '',
  filterDateTo = '',
  folder = 'inbox',
  getMailErrorDetail,
  handleMailCredentialsRequired,
  hasAttachmentsOnly = false,
  isMobile = false,
  isTransientMailRequestError,
  listData,
  loadingMore = false,
  mailAccessReady = false,
  mailAPI,
  mailBootstrapLimit = 20,
  mailCacheScope = '',
  mailSwrStaleTimeMs = 45000,
  persistRecentBootstrapSnapshot,
  persistRecentListSnapshot,
  recentHydratedScope = '',
  refs = {},
  resolveListDataReadStateOverrides,
  setError,
  setFolderSummary,
  setFolderTree,
  setListData,
  setLoading,
  setLoadingMore,
  setMailBackgroundRefreshing,
  setMailConfigLoading,
  setMailPreferences,
  setMailPreferencesDraft,
  setMailboxInfo,
  setMailboxes,
  setSelectedByMode,
  setSelectedId,
  setSelectedMailboxId,
  unreadOnly = false,
  viewMode = 'messages',
  withActiveMailboxParams,
} = {}) {
  const {
    currentListKeyRef,
    folderSummaryRef,
    folderSummaryRefreshCompletedAtRef,
    folderTreeRef,
    listDataRef,
    mailboxesRef,
    recentHydratedListContextsRef,
    selectedConversationRef,
    selectedIdRef,
    selectedMessageRef,
    skipNextListRefreshRef,
    suppressNextAutoReadRef,
  } = refs;

  const applyBootstrapPayload = useCallback((payload, { applyList = true } = {}) => {
    const configPayload = payload?.selected_mailbox || payload?.mailboxInfo || null;
    const nextMailboxEntries = mergeMailboxEntries(payload?.mailboxes, configPayload, mailboxesRef?.current);
    const resolvedMailboxId = getMailboxEntryId(configPayload) || activeMailboxId;
    const resolvedScope = resolvedMailboxId || mailCacheScope;
    const resolvedFolderSummaryCacheKey = buildMailFolderSummaryCacheKey({ scope: resolvedScope });
    const resolvedFolderTreeCacheKey = buildMailFolderTreeCacheKey({ scope: resolvedScope });
    const resolvedListCacheKey = buildMailListCacheKey({
      scope: resolvedScope,
      folder,
      viewMode,
      q: debouncedSearch,
      unreadOnly,
      hasAttachmentsOnly,
      dateFrom: filterDateFrom,
      dateTo: filterDateTo,
      folderScope: currentFolderScope,
      fromFilter: advancedFiltersApplied?.from_filter,
      toFilter: advancedFiltersApplied?.to_filter,
      subjectFilter: advancedFiltersApplied?.subject_filter,
      bodyFilter: advancedFiltersApplied?.body_filter,
      importance: advancedFiltersApplied?.importance,
      limit: 50,
      offset: 0,
    });
    const resolvedListContextKey = JSON.stringify(resolvedListCacheKey);
    const preferencesPayload = payload?.preferences?.preferences || payload?.preferences || {};
    const folderSummaryPayload = payload?.folder_summary && typeof payload.folder_summary === 'object'
      ? payload.folder_summary
      : {};
    const folderTreePayload = Array.isArray(payload?.folder_tree?.items) ? payload.folder_tree.items : [];
    const messagesPayload = payload?.messages || {};
    const bootstrapState = String(payload?.state || '').trim().toLowerCase();
    const bootstrapListIsFresh = !bootstrapState || bootstrapState === 'ok';
    setMailboxInfo(configPayload);
    setMailboxes(nextMailboxEntries);
    if (resolvedMailboxId && (!activeMailboxId || resolvedMailboxId === activeMailboxId)) {
      setSelectedMailboxId(resolvedMailboxId);
    }
    const nextPreferences = { ...defaultMailPreferences, ...(preferencesPayload || {}) };
    setMailPreferences(nextPreferences);
    setMailPreferencesDraft(nextPreferences);
    setFolderSummary(folderSummaryPayload);
    if (folderSummaryRefreshCompletedAtRef) {
      folderSummaryRefreshCompletedAtRef.current = Date.now();
    }
    setFolderTree(folderTreePayload);
    setSWRCache(resolvedFolderSummaryCacheKey, { items: folderSummaryPayload });
    setSWRCache(resolvedFolderTreeCacheKey, { items: folderTreePayload });
    persistRecentBootstrapSnapshot(folderSummaryPayload, folderTreePayload, resolvedScope);
    if (applyList) {
      const previousListData = listDataRef?.current || createEmptyListData();
      const normalizedMessagesPayload = normalizeMailListResponse(messagesPayload);
      const bootstrapHasVisibleMessages = Array.isArray(normalizedMessagesPayload.items)
        && normalizedMessagesPayload.items.length > 0;
      if (skipNextListRefreshRef) {
        skipNextListRefreshRef.current = bootstrapHasVisibleMessages && bootstrapListIsFresh;
      }
      const resolvedListData = resolveListDataReadStateOverrides(buildMailListState({
        previousListData,
        nextListData: normalizedMessagesPayload,
        updateMode: currentListKeyRef?.current === resolvedListContextKey && isExpandedMailListData(previousListData)
          ? 'head-merge'
          : 'replace',
        selectionMode: viewMode,
      }), viewMode);
      if (listDataRef) {
        listDataRef.current = resolvedListData;
      }
      setListData((prev) => {
        const prevItems = Array.isArray(prev?.items) ? prev.items : [];
        const nextItems = Array.isArray(resolvedListData.items) ? resolvedListData.items : [];
        const sameItems = prevItems.length === nextItems.length
          && prevItems.every((item, index) => isListItemSame(item, nextItems[index], viewMode));
        const sameMeta = Number(prev?.total || 0) === Number(resolvedListData.total || 0)
          && Number(prev?.offset || 0) === Number(resolvedListData.offset || 0)
          && Number(prev?.limit || 0) === Number(resolvedListData.limit || 0)
          && Boolean(prev?.has_more) === Boolean(resolvedListData.has_more)
          && String(prev?.next_offset ?? '') === String(resolvedListData.next_offset ?? '')
          && String(prev?.append_offset ?? '') === String(resolvedListData.append_offset ?? '')
          && Number(prev?.loaded_pages || 0) === Number(resolvedListData.loaded_pages || 0)
          && Boolean(prev?.search_limited) === Boolean(resolvedListData.search_limited)
          && Number(prev?.searched_window || 0) === Number(resolvedListData.searched_window || 0);
        if (sameItems && sameMeta) return prev;
        return resolvedListData;
      });
      if (bootstrapHasVisibleMessages && bootstrapListIsFresh) {
        setSWRCache(resolvedListCacheKey, resolvedListData);
        persistRecentListSnapshot(resolvedListContextKey, resolvedListData, resolvedScope);
      }
    }
  }, [
    activeMailboxId,
    advancedFiltersApplied,
    currentFolderScope,
    debouncedSearch,
    defaultMailPreferences,
    filterDateFrom,
    filterDateTo,
    folder,
    hasAttachmentsOnly,
    mailCacheScope,
    mailboxesRef,
    persistRecentBootstrapSnapshot,
    persistRecentListSnapshot,
    resolveListDataReadStateOverrides,
    setFolderSummary,
    setFolderTree,
    setListData,
    setMailPreferences,
    setMailPreferencesDraft,
    setMailboxInfo,
    setMailboxes,
    setSelectedMailboxId,
    unreadOnly,
    viewMode,
  ]);

  const refreshBootstrap = useCallback(async ({ force = false, live = false } = {}) => {
    const bootstrapCacheKey = buildMailBootstrapCacheKey({ scope: mailCacheScope, limit: mailBootstrapLimit });
    const hasHydratedCurrentList = recentHydratedListContextsRef?.current?.has(currentListContextKey);
    const shouldApplyBootstrapList = currentContextUsesBootstrapList && !hasHydratedCurrentList;
    const cachedBootstrap = peekSWRCache(bootstrapCacheKey, { staleTimeMs: mailSwrStaleTimeMs });
    const cachedBootstrapState = String(cachedBootstrap?.data?.state || '').trim().toLowerCase();
    const forceBootstrapFetch = force || (cachedBootstrapState && cachedBootstrapState !== 'ok');
    const hasRecentHydration = recentHydratedScope === mailCacheScope;
    if (cachedBootstrap?.data) {
      applyBootstrapPayload(cachedBootstrap.data || {}, { applyList: shouldApplyBootstrapList });
      setMailConfigLoading(false);
    } else {
      setMailConfigLoading(true);
    }
    if (hasRecentHydration) {
      setMailBackgroundRefreshing(true);
    }
    try {
      const fetcher = () => mailAPI.getBootstrap({
        limit: mailBootstrapLimit,
        mailbox_id: activeMailboxId || undefined,
        refresh: live ? 'live' : 'auto',
      });
      const result = await getOrFetchSWR(
        bootstrapCacheKey,
        fetcher,
        {
          staleTimeMs: mailSwrStaleTimeMs,
          force: forceBootstrapFetch,
          revalidateStale: false,
        }
      );
      if (result?.data) {
        applyBootstrapPayload(result.data || {}, { applyList: shouldApplyBootstrapList });
      }
      if (result?.fromCache && !result?.isFresh) {
        void getOrFetchSWR(
          bootstrapCacheKey,
          fetcher,
          {
            staleTimeMs: mailSwrStaleTimeMs,
            force: true,
            revalidateStale: false,
          }
        ).then((freshResult) => {
          if (freshResult?.data) {
            applyBootstrapPayload(freshResult.data || {}, { applyList: shouldApplyBootstrapList });
          }
        }).catch(() => {});
      }
      return result?.data || null;
    } catch (requestError) {
      if (!cachedBootstrap?.data && !hasRecentHydration) {
        setMailboxInfo(null);
        setFolderSummary({});
        setFolderTree([]);
        setListData(createEmptyListData());
        setError(getMailErrorDetail(requestError, 'Не удалось загрузить почтовый экран.'));
      }
      return null;
    } finally {
      setMailConfigLoading(false);
      if (hasRecentHydration) {
        setMailBackgroundRefreshing(false);
      }
    }
  }, [
    activeMailboxId,
    applyBootstrapPayload,
    currentContextUsesBootstrapList,
    currentListContextKey,
    getMailErrorDetail,
    mailAPI,
    mailBootstrapLimit,
    mailCacheScope,
    mailSwrStaleTimeMs,
    recentHydratedListContextsRef,
    recentHydratedScope,
    setError,
    setFolderSummary,
    setFolderTree,
    setListData,
    setMailBackgroundRefreshing,
    setMailConfigLoading,
    setMailboxInfo,
  ]);

  const refreshFolderSummary = useCallback(async ({ force = false } = {}) => {
    if (!mailAccessReady) {
      setFolderSummary({});
      return {};
    }
    try {
      const result = await getOrFetchSWR(
        currentFolderSummaryCacheKey,
        () => mailAPI.getFolderSummary({ mailbox_id: activeMailboxId || undefined }),
        {
          staleTimeMs: mailSwrStaleTimeMs,
          force,
          revalidateStale: false,
        }
      );
      const data = result?.data || {};
      const nextItems = data?.items && typeof data.items === 'object' ? data.items : {};
      setFolderSummary(nextItems);
      if (folderSummaryRefreshCompletedAtRef) {
        folderSummaryRefreshCompletedAtRef.current = Date.now();
      }
      persistRecentBootstrapSnapshot(nextItems, folderTreeRef?.current, activeMailboxId || mailCacheScope);
      return nextItems;
    } catch (requestError) {
      if (await handleMailCredentialsRequired(requestError)) {
        setFolderSummary({});
        return {};
      }
      if (isTransientMailRequestError(requestError)) {
        return folderSummaryRef?.current || {};
      }
      setFolderSummary({});
      return {};
    }
  }, [
    activeMailboxId,
    currentFolderSummaryCacheKey,
    folderSummaryRefreshCompletedAtRef,
    folderSummaryRef,
    folderTreeRef,
    handleMailCredentialsRequired,
    isTransientMailRequestError,
    mailAPI,
    mailAccessReady,
    mailCacheScope,
    mailSwrStaleTimeMs,
    persistRecentBootstrapSnapshot,
    setFolderSummary,
  ]);

  const refreshFolderTree = useCallback(async ({ force = false } = {}) => {
    if (!mailAccessReady) {
      setFolderTree([]);
      return [];
    }
    try {
      const result = await getOrFetchSWR(
        currentFolderTreeCacheKey,
        () => mailAPI.getFolderTree({ mailbox_id: activeMailboxId || undefined }),
        {
          staleTimeMs: mailSwrStaleTimeMs,
          force,
          revalidateStale: false,
        }
      );
      const data = result?.data || {};
      const nextItems = Array.isArray(data?.items) ? data.items : [];
      setFolderTree(nextItems);
      persistRecentBootstrapSnapshot(folderSummaryRef?.current, nextItems, activeMailboxId || mailCacheScope);
      return nextItems;
    } catch (requestError) {
      if (await handleMailCredentialsRequired(requestError)) {
        setFolderTree([]);
        return [];
      }
      if (isTransientMailRequestError(requestError)) {
        return folderTreeRef?.current || [];
      }
      setFolderTree([]);
      return [];
    }
  }, [
    activeMailboxId,
    currentFolderTreeCacheKey,
    folderSummaryRef,
    folderTreeRef,
    handleMailCredentialsRequired,
    isTransientMailRequestError,
    mailAPI,
    mailAccessReady,
    mailCacheScope,
    mailSwrStaleTimeMs,
    persistRecentBootstrapSnapshot,
    setFolderTree,
  ]);

  const applyResolvedListData = useCallback((nextListData, {
    reset = true,
    selectionMode = viewMode,
    selectFirstIfSelectionMissing = false,
    updateMode = reset ? 'replace' : 'append',
  } = {}) => {
    const normalizedMode = normalizeMailViewMode(selectionMode);
    const previousListData = listDataRef?.current || createEmptyListData();
    const resolvedListData = resolveListDataReadStateOverrides(buildMailListState({
      previousListData,
      nextListData,
      updateMode,
      selectionMode: normalizedMode,
    }), normalizedMode);
    const incomingItems = Array.isArray(resolvedListData?.items) ? resolvedListData.items : [];
    if (listDataRef) {
      listDataRef.current = resolvedListData;
    }
    setListData((prev) => {
      const prevItems = Array.isArray(prev?.items) ? prev.items : [];
      const sameItems = prevItems.length === incomingItems.length
        && prevItems.every((item, index) => isListItemSame(item, incomingItems[index], normalizedMode));
      const sameMeta = Number(prev?.total || 0) === Number(resolvedListData.total || 0)
        && Number(prev?.offset || 0) === Number(resolvedListData.offset || 0)
        && Number(prev?.limit || 0) === Number(resolvedListData.limit || 0)
        && Boolean(prev?.has_more) === Boolean(resolvedListData.has_more)
        && String(prev?.next_offset ?? '') === String(resolvedListData.next_offset ?? '')
        && String(prev?.append_offset ?? '') === String(resolvedListData.append_offset ?? '')
        && Number(prev?.loaded_pages || 0) === Number(resolvedListData.loaded_pages || 0)
        && Boolean(prev?.search_limited) === Boolean(resolvedListData.search_limited)
        && Number(prev?.searched_window || 0) === Number(resolvedListData.searched_window || 0);
      if (sameItems && sameMeta) return prev;
      return resolvedListData;
    });
    setSWRCache(currentListCacheKey, resolvedListData);
    if (reset) {
      const currentSelectedId = String(selectedIdRef?.current || '');
      const exists = incomingItems.some((item) => String(normalizedMode === 'conversations' ? item.conversation_id : item.id) === currentSelectedId);
      if (currentSelectedId && !exists) {
        const firstItem = incomingItems[0] || null;
        const nextSelectedId = firstItem
          ? String(normalizedMode === 'conversations' ? (firstItem.conversation_id || firstItem.id || '') : (firstItem.id || ''))
          : '';
        if (selectFirstIfSelectionMissing && nextSelectedId) {
          if (suppressNextAutoReadRef) {
            suppressNextAutoReadRef.current = `${normalizedMode}:${folder}:${nextSelectedId}`;
          }
          if (selectedIdRef) {
            selectedIdRef.current = nextSelectedId;
          }
          setSelectedId(nextSelectedId);
          setSelectedByMode((prev) => ({ ...(prev || {}), [normalizedMode]: nextSelectedId }));
        } else {
          const selectedDetail = normalizedMode === 'conversations'
            ? selectedConversationRef?.current
            : selectedMessageRef?.current;
          const selectedDetailId = normalizedMode === 'conversations'
            ? String(selectedDetail?.conversation_id || selectedDetail?.id || '')
            : String(selectedDetail?.id || '');
          if (selectedDetailId !== currentSelectedId) {
            clearSelection({
              mode: normalizedMode,
              restoreListState: isMobile && normalizedMode === 'messages',
            });
          }
        }
      }
    }
    persistRecentListSnapshot(currentListContextKey, resolvedListData);
    return resolvedListData;
  }, [
    clearSelection,
    currentListCacheKey,
    currentListContextKey,
    folder,
    isMobile,
    listDataRef,
    persistRecentListSnapshot,
    resolveListDataReadStateOverrides,
    selectedConversationRef,
    selectedIdRef,
    selectedMessageRef,
    setListData,
    setSelectedByMode,
    setSelectedId,
    suppressNextAutoReadRef,
    viewMode,
  ]);

  const fetchList = useCallback(async ({
    reset = true,
    silent = false,
    selectFirstIfSelectionMissing = false,
    force = false,
  } = {}) => {
    if (!mailAccessReady) {
      if (reset) {
        setListData(createEmptyListData());
      }
      return null;
    }
    const currentListData = listDataRef?.current || {};
    const currentOffset = reset ? 0 : Number(currentListData.append_offset ?? currentListData.next_offset ?? currentListData.offset ?? 0);
    const cachedList = reset ? peekSWRCache(currentListCacheKey, { staleTimeMs: mailSwrStaleTimeMs }) : null;
    const nextContextKey = JSON.stringify(currentListCacheKey);
    const shouldForceHydratedRefresh = reset && recentHydratedListContextsRef?.current?.has(nextContextKey);
    const forceNetwork = force || shouldForceHydratedRefresh;
    const isContextSwitchWithoutCache = reset
      && String(currentListKeyRef?.current || '') !== nextContextKey
      && !cachedList?.data;
    if (reset) {
      if (currentListKeyRef) {
        currentListKeyRef.current = nextContextKey;
      }
    } else {
      setLoadingMore(true);
    }
    try {
      const fetcher = (params) => (
        viewMode === 'conversations'
          ? mailAPI.getConversations(withActiveMailboxParams(params))
          : mailAPI.getMessages(withActiveMailboxParams(params))
      );
      if (reset) {
        const contextKey = nextContextKey;
        if (cachedList?.data) {
          applyResolvedListData(cachedList.data, {
            reset: true,
            selectionMode: viewMode,
            selectFirstIfSelectionMissing,
          });
          setLoading(false);
        } else if (!silent) {
          if (isContextSwitchWithoutCache) {
            const emptyList = createEmptyListData();
            if (listDataRef) {
              listDataRef.current = emptyList;
            }
            setListData(emptyList);
          }
          setLoading(true);
        }

        const result = await getOrFetchSWR(
          currentListCacheKey,
          () => fetcher(currentListParams),
          {
            staleTimeMs: mailSwrStaleTimeMs,
            force: forceNetwork,
            revalidateStale: false,
          }
        );
        if (shouldForceHydratedRefresh) {
          recentHydratedListContextsRef.current.delete(contextKey);
        }
        if (currentListKeyRef?.current === contextKey && result?.data) {
          const nextUpdateMode = !shouldForceHydratedRefresh
            && !result?.fromCache
            && isExpandedMailListData(listDataRef?.current)
            ? 'head-merge'
            : 'replace';
          applyResolvedListData(result.data, {
            reset: true,
            selectionMode: viewMode,
            selectFirstIfSelectionMissing,
            updateMode: nextUpdateMode,
          });
        }
        if (result?.fromCache && !result?.isFresh) {
          void getOrFetchSWR(
            currentListCacheKey,
            () => fetcher(currentListParams),
            {
              staleTimeMs: mailSwrStaleTimeMs,
              force: true,
              revalidateStale: false,
            }
          ).then((freshResult) => {
            if (currentListKeyRef?.current !== contextKey || !freshResult?.data) return;
            applyResolvedListData(freshResult.data, {
              reset: true,
              selectionMode: viewMode,
              selectFirstIfSelectionMissing,
              updateMode: isExpandedMailListData(listDataRef?.current) ? 'head-merge' : 'replace',
            });
          }).catch(() => {});
        }
        return normalizeMailListResponse(result?.data);
      }

      const params = {
        ...currentListParams,
        offset: currentOffset,
      };
      const data = await fetcher(params);
      return applyResolvedListData(data, { reset: false, selectionMode: viewMode, updateMode: 'append' });
    } catch (requestError) {
      if (await handleMailCredentialsRequired(requestError)) {
        if (reset) setListData((prev) => ({ ...prev, items: [] }));
        return null;
      }
      const currentVisibleList = listDataRef?.current;
      const hasVisibleItems = Array.isArray(currentVisibleList?.items) && currentVisibleList.items.length > 0;
      if (silent && isTransientMailRequestError(requestError) && (hasVisibleItems || cachedList?.data)) {
        return normalizeMailListResponse(hasVisibleItems ? currentVisibleList : cachedList?.data);
      }
      setError(getMailErrorDetail(requestError, 'Не удалось загрузить список писем.'));
      if (reset && !cachedList?.data && recentHydratedScope !== mailCacheScope) {
        setListData((prev) => ({ ...prev, items: [] }));
      }
      return null;
    } finally {
      if (reset) setLoading(false); else setLoadingMore(false);
    }
  }, [
    applyResolvedListData,
    currentListCacheKey,
    currentListKeyRef,
    currentListParams,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    isTransientMailRequestError,
    listDataRef,
    mailAPI,
    mailAccessReady,
    mailCacheScope,
    mailSwrStaleTimeMs,
    recentHydratedListContextsRef,
    recentHydratedScope,
    setError,
    setListData,
    setLoading,
    setLoadingMore,
    viewMode,
    withActiveMailboxParams,
  ]);

  const refreshList = useCallback(async ({
    silent = false,
    selectFirstIfSelectionMissing = false,
    force = false,
  } = {}) => {
    return fetchList({ reset: true, silent, selectFirstIfSelectionMissing, force });
  }, [fetchList]);

  const loadMoreMessages = useCallback(async () => {
    if (loadingMore || !listData?.has_more || listData?.append_offset === null) return;
    await fetchList({ reset: false, silent: true });
  }, [fetchList, listData?.append_offset, listData?.has_more, loadingMore]);

  return {
    applyBootstrapPayload,
    applyResolvedListData,
    fetchList,
    loadMoreMessages,
    refreshBootstrap,
    refreshFolderSummary,
    refreshFolderTree,
    refreshList,
  };
}
