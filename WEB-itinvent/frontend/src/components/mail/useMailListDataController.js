import { useCallback, useEffect, useRef } from 'react';
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
import { emitAgentDebugLog } from '../../lib/debugClientLog';

function isMailAppSnapshotPayload(payload) {
  return String(payload?.source || '').trim().toLowerCase() === 'app_snapshot';
}

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

  const refreshListFnRef = useRef(null);
  const lastSnapshotHeadRefreshAtRef = useRef(0);
  const pendingSnapshotHeadRefreshRef = useRef(false);
  const mailAccessReadyRef = useRef(mailAccessReady);
  mailAccessReadyRef.current = mailAccessReady;
  const mailCacheScopeRef = useRef(mailCacheScope);
  mailCacheScopeRef.current = mailCacheScope;
  const currentContextUsesBootstrapListRef = useRef(currentContextUsesBootstrapList);
  currentContextUsesBootstrapListRef.current = currentContextUsesBootstrapList;
  const currentListContextKeyRef = useRef(currentListContextKey);
  currentListContextKeyRef.current = currentListContextKey;
  const bootstrapGenerationRef = useRef(0);
  const listFetchGenerationRef = useRef(0);

  const flushPendingSnapshotHeadRefresh = useCallback(() => {
    if (!pendingSnapshotHeadRefreshRef.current) return false;
    if (!mailAccessReadyRef.current) return false;
    pendingSnapshotHeadRefreshRef.current = false;
    if (skipNextListRefreshRef) {
      skipNextListRefreshRef.current = true;
    }
    // #region agent log
    emitAgentDebugLog({
      runId: 'mail-freeze',
      hypothesisId: 'H1',
      location: 'useMailListDataController.js:flushPendingSnapshotHeadRefresh',
      message: 'flush pending snapshot head refresh',
      data: { scope: String(mailCacheScopeRef.current || '') },
    });
    // #endregion
    void refreshListFnRef.current?.({ silent: true, force: true });
    return true;
  }, [skipNextListRefreshRef]);

  const scheduleSilentHeadRefreshAfterSnapshot = useCallback((payload) => {
    if (!isMailAppSnapshotPayload(payload)) return;
    // Snapshot messages are inbox-only. After a folder switch, do not arm skip/refresh
    // as if the snapshot painted the current (Sent/Drafts/…) list.
    if (!currentContextUsesBootstrapListRef.current) return;
    const now = Date.now();
    // Bootstrap may apply cached + network snapshot back-to-back; one head pull is enough.
    if (now - Number(lastSnapshotHeadRefreshAtRef.current || 0) < 1500) return;
    lastSnapshotHeadRefreshAtRef.current = now;
    // Snapshot already painted the list; skip the default non-force effect and
    // pull a live head page once access is ready (head-merge keeps the rest).
    pendingSnapshotHeadRefreshRef.current = true;
    if (skipNextListRefreshRef) {
      skipNextListRefreshRef.current = true;
    }
    // #region agent log
    emitAgentDebugLog({
      runId: 'mail-freeze',
      hypothesisId: 'H1',
      location: 'useMailListDataController.js:scheduleSilentHeadRefreshAfterSnapshot',
      message: 'schedule silent head refresh + skip flag',
      data: {
        source: String(payload?.source || ''),
        state: String(payload?.state || ''),
        mailAccessReady: !!mailAccessReadyRef.current,
        as_of: String(payload?.as_of || '').slice(0, 40),
      },
    });
    // #endregion
    void Promise.resolve().then(() => {
      flushPendingSnapshotHeadRefresh();
    });
  }, [flushPendingSnapshotHeadRefresh, skipNextListRefreshRef]);

  useEffect(() => {
    if (!mailAccessReady) return;
    flushPendingSnapshotHeadRefresh();
  }, [flushPendingSnapshotHeadRefresh, mailAccessReady]);

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
      // Bootstrap.messages is always the inbox head. A late bootstrap completion must not
      // paint those rows over Sent/Drafts after the user already switched folders.
      const liveAllowsBootstrapList = currentContextUsesBootstrapListRef.current;
      const uiContextKey = String(currentListKeyRef?.current || currentListContextKeyRef.current || '');
      const bootstrapTargetsCurrentUi = !uiContextKey || uiContextKey === resolvedListContextKey;
      if (!liveAllowsBootstrapList || !bootstrapTargetsCurrentUi) {
        emitAgentDebugLog({
          runId: 'mail-folder-timing',
          hypothesisId: 'T1',
          location: 'useMailListDataController.js:applyBootstrapPayload',
          message: 'skip bootstrap list paint (folder/context changed)',
          data: {
            liveAllowsBootstrapList: !!liveAllowsBootstrapList,
            bootstrapTargetsCurrentUi: !!bootstrapTargetsCurrentUi,
            uiContextKey: uiContextKey.slice(0, 120),
            bootstrapContextKey: String(resolvedListContextKey || '').slice(0, 120),
            folder: String(folder || ''),
          },
        });
      } else {
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
    const requestScope = String(mailCacheScope || '');
    const requestGeneration = ++bootstrapGenerationRef.current;
    const isCurrentBootstrap = () => (
      requestGeneration === bootstrapGenerationRef.current
      && requestScope === String(mailCacheScopeRef.current || '')
    );
    const resolveShouldApplyBootstrapList = () => {
      const liveContextKey = String(currentListContextKeyRef.current || '');
      const hasHydratedCurrentList = liveContextKey
        ? recentHydratedListContextsRef?.current?.has(liveContextKey)
        : false;
      return currentContextUsesBootstrapListRef.current && !hasHydratedCurrentList;
    };
    const bootstrapCacheKey = buildMailBootstrapCacheKey({ scope: requestScope, limit: mailBootstrapLimit });
    const shouldApplyBootstrapList = resolveShouldApplyBootstrapList();
    const cachedBootstrap = peekSWRCache(bootstrapCacheKey, { staleTimeMs: mailSwrStaleTimeMs });
    const cachedBootstrapState = String(cachedBootstrap?.data?.state || '').trim().toLowerCase();
    const forceBootstrapFetch = force || (cachedBootstrapState && cachedBootstrapState !== 'ok');
    const hasRecentHydration = recentHydratedScope === requestScope;
    // #region agent log
    emitAgentDebugLog({
      runId: 'mail-freeze',
      hypothesisId: 'H6',
      location: 'useMailListDataController.js:refreshBootstrap',
      message: 'bootstrap start',
      data: {
        scope: requestScope,
        gen: requestGeneration,
        force: !!force,
        live: !!live,
        hasCache: !!cachedBootstrap?.data,
        mailAccessReady: !!mailAccessReady,
      },
    });
    // #endregion
    if (cachedBootstrap?.data) {
      if (isCurrentBootstrap()) {
        applyBootstrapPayload(cachedBootstrap.data || {}, { applyList: resolveShouldApplyBootstrapList() });
        scheduleSilentHeadRefreshAfterSnapshot(cachedBootstrap.data || {});
        setMailConfigLoading(false);
      }
    } else if (isCurrentBootstrap()) {
      setMailConfigLoading(true);
    }
    if (hasRecentHydration && isCurrentBootstrap()) {
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
          force: forceBootstrapFetch || live,
          revalidateStale: false,
        }
      );
      if (!isCurrentBootstrap()) {
        // #region agent log
        emitAgentDebugLog({
          runId: 'mail-freeze',
          hypothesisId: 'H6',
          location: 'useMailListDataController.js:refreshBootstrap',
          message: 'bootstrap stale drop after await',
          data: { scope: requestScope, gen: requestGeneration, currentScope: String(mailCacheScopeRef.current || '') },
        });
        // #endregion
        return null;
      }
      if (result?.data) {
        applyBootstrapPayload(result.data || {}, { applyList: resolveShouldApplyBootstrapList() });
        // Live Exchange bootstrap already carries a fresh head; only snapshot needs a follow-up list pull.
        if (!live) {
          scheduleSilentHeadRefreshAfterSnapshot(result.data || {});
        }
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
          if (!isCurrentBootstrap() || !freshResult?.data) return;
          applyBootstrapPayload(freshResult.data || {}, { applyList: resolveShouldApplyBootstrapList() });
          scheduleSilentHeadRefreshAfterSnapshot(freshResult.data || {});
        }).catch(async (requestError) => {
          if (!isCurrentBootstrap()) return;
          if (await handleMailCredentialsRequired(requestError, 'Не удалось загрузить почтовый экран.')) {
            setListData((prev) => ({ ...prev, items: [] }));
          }
        });
      }
      return result?.data || null;
    } catch (requestError) {
      if (!isCurrentBootstrap()) return null;
      if (await handleMailCredentialsRequired(requestError, 'Не удалось загрузить почтовый экран.')) {
        if (!cachedBootstrap?.data && !hasRecentHydration) {
          setMailboxInfo(null);
          setFolderSummary({});
          setFolderTree([]);
          setListData(createEmptyListData());
        } else {
          setListData((prev) => ({ ...prev, items: [] }));
        }
        return null;
      }
      if (!cachedBootstrap?.data && !hasRecentHydration) {
        setMailboxInfo(null);
        setFolderSummary({});
        setFolderTree([]);
        setListData(createEmptyListData());
        setError(getMailErrorDetail(requestError, 'Не удалось загрузить почтовый экран.'));
      }
      return null;
    } finally {
      if (isCurrentBootstrap()) {
        setMailConfigLoading(false);
        if (hasRecentHydration) {
          setMailBackgroundRefreshing(false);
        }
      }
      // #region agent log
      emitAgentDebugLog({
        runId: 'mail-freeze',
        hypothesisId: 'H6',
        location: 'useMailListDataController.js:refreshBootstrap',
        message: 'bootstrap finally',
        data: {
          scope: requestScope,
          gen: requestGeneration,
          current: isCurrentBootstrap(),
          skip: !!skipNextListRefreshRef?.current,
          applyList: shouldApplyBootstrapList,
        },
      });
      // #endregion
    }
  }, [
    activeMailboxId,
    applyBootstrapPayload,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    mailAPI,
    mailAccessReady,
    mailBootstrapLimit,
    mailCacheScope,
    mailSwrStaleTimeMs,
    recentHydratedListContextsRef,
    recentHydratedScope,
    scheduleSilentHeadRefreshAfterSnapshot,
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
    listCacheKey: listCacheKeyOverride = null,
    listContextKey: listContextKeyOverride = null,
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
    const resolvedListCacheKey = listCacheKeyOverride || currentListCacheKey;
    const resolvedListContextKey = listContextKeyOverride || currentListContextKey;
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
    setSWRCache(resolvedListCacheKey, resolvedListData);
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
    persistRecentListSnapshot(resolvedListContextKey, resolvedListData);
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
    listParams: listParamsOverride = null,
    listCacheKey: listCacheKeyOverride = null,
    listContextKey: listContextKeyOverride = null,
    reason = '',
    startedAt = 0,
  } = {}) => {
    const timingStartedAt = Number(startedAt || Date.now());
    const mark = (phase, extra = {}) => {
      const elapsedMs = Date.now() - timingStartedAt;
      const payload = {
        runId: 'mail-folder-timing',
        hypothesisId: 'T1',
        location: 'useMailListDataController.js:fetchList',
        message: phase,
        data: {
          reason: String(reason || ''),
          folder: String((listParamsOverride || currentListParams)?.folder || folder || ''),
          elapsedMs,
          reset: !!reset,
          silent: !!silent,
          force: !!force,
          ...extra,
        },
      };
      emitAgentDebugLog(payload);
      try {
        const key = '__mailFolderTimings';
        const ring = Array.isArray(window[key]) ? window[key] : [];
        ring.push({ t: Date.now(), phase, ...payload.data });
        window[key] = ring.slice(-100);
      } catch {
        // ignore
      }
    };
    if (!mailAccessReady) {
      mark('fetchList blocked: mailAccessReady=false', {
        skip: !!skipNextListRefreshRef?.current,
      });
      // Keep last painted list while bootstrap/config is still settling.
      // Never skeleton-block a painted inbox on silent/no-op races.
      if (reset && !silent) {
        const previousHadItems = Array.isArray(listDataRef?.current?.items)
          && listDataRef.current.items.length > 0;
        if (!previousHadItems) setLoading(true);
      }
      return null;
    }
    const requestScope = String(mailCacheScope || '');
    const requestGeneration = ++listFetchGenerationRef.current;
    const isCurrentListFetch = () => (
      requestGeneration === listFetchGenerationRef.current
      && requestScope === String(mailCacheScopeRef.current || '')
    );
    const effectiveListParams = listParamsOverride || currentListParams;
    const effectiveListCacheKey = listCacheKeyOverride || currentListCacheKey;
    const currentListData = listDataRef?.current || {};
    const currentOffset = reset ? 0 : Number(currentListData.append_offset ?? currentListData.next_offset ?? currentListData.offset ?? 0);
    const cachedList = reset ? peekSWRCache(effectiveListCacheKey, { staleTimeMs: mailSwrStaleTimeMs }) : null;
    const nextContextKey = listContextKeyOverride || JSON.stringify(effectiveListCacheKey);
    const shouldForceHydratedRefresh = reset && recentHydratedListContextsRef?.current?.has(nextContextKey);
    const forceNetwork = force || shouldForceHydratedRefresh;
    const previousHadItems = Array.isArray(currentListData?.items) && currentListData.items.length > 0;
    mark('fetchList start', {
      gen: requestGeneration,
      forceNetwork: !!forceNetwork,
      cacheHit: !!cachedList?.data,
      cacheFresh: !!cachedList?.isFresh,
      prevCount: Array.isArray(currentListData?.items) ? currentListData.items.length : 0,
    });
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
        const applyOptions = {
          reset: true,
          selectionMode: viewMode,
          selectFirstIfSelectionMissing,
          listCacheKey: effectiveListCacheKey,
          listContextKey: contextKey,
        };
        if (cachedList?.data) {
          applyResolvedListData(cachedList.data, applyOptions);
          setLoading(false);
          mark('fetchList cache paint', {
            count: Array.isArray(cachedList.data?.items) ? cachedList.data.items.length : 0,
            cacheFresh: !!cachedList.isFresh,
          });
        } else if (!silent) {
          // Keep previous items visible; show skeleton only when there is nothing to paint.
          if (!previousHadItems) setLoading(true);
          else setMailBackgroundRefreshing?.(true);
        }

        const networkStartedAt = Date.now();
        const result = await getOrFetchSWR(
          effectiveListCacheKey,
          () => fetcher(effectiveListParams),
          {
            staleTimeMs: mailSwrStaleTimeMs,
            force: forceNetwork,
            revalidateStale: false,
          }
        );
        mark('fetchList network/swr done', {
          networkMs: Date.now() - networkStartedAt,
          fromCache: !!result?.fromCache,
          isFresh: !!result?.isFresh,
          forceNetwork: !!forceNetwork,
          count: Array.isArray(result?.data?.items) ? result.data.items.length : 0,
          staleDrop: !isCurrentListFetch() || currentListKeyRef?.current !== contextKey,
        });
        if (shouldForceHydratedRefresh) {
          recentHydratedListContextsRef.current.delete(contextKey);
        }
        if (isCurrentListFetch() && currentListKeyRef?.current === contextKey && result?.data) {
          const nextItems = Array.isArray(result.data?.items) ? result.data.items : [];
          // Silent/head refresh must not wipe a painted inbox with a transient empty Exchange response.
          if (silent && previousHadItems && nextItems.length === 0) {
            mark('fetchList skip empty silent replace', {
              prevCount: currentListData.items.length,
            });
            return normalizeMailListResponse(currentListData);
          }
          const nextUpdateMode = !shouldForceHydratedRefresh
            && !result?.fromCache
            && isExpandedMailListData(listDataRef?.current)
            ? 'head-merge'
            : 'replace';
          applyResolvedListData(result.data, {
            ...applyOptions,
            updateMode: nextUpdateMode,
          });
          mark('fetchList applied', {
            updateMode: nextUpdateMode,
            count: nextItems.length,
          });
        }
        if (result?.fromCache && !result?.isFresh) {
          void getOrFetchSWR(
            effectiveListCacheKey,
            () => fetcher(effectiveListParams),
            {
              staleTimeMs: mailSwrStaleTimeMs,
              force: true,
              revalidateStale: false,
            }
          ).then((freshResult) => {
            if (!isCurrentListFetch() || currentListKeyRef?.current !== contextKey || !freshResult?.data) return;
            applyResolvedListData(freshResult.data, {
              ...applyOptions,
              updateMode: isExpandedMailListData(listDataRef?.current) ? 'head-merge' : 'replace',
            });
            mark('fetchList background revalidate applied', {
              count: Array.isArray(freshResult.data?.items) ? freshResult.data.items.length : 0,
            });
          }).catch(() => {});
        }
        return normalizeMailListResponse(result?.data);
      }

      const params = {
        ...effectiveListParams,
        offset: currentOffset,
      };
      const data = await fetcher(params);
      return applyResolvedListData(data, {
        reset: false,
        selectionMode: viewMode,
        updateMode: 'append',
        listCacheKey: effectiveListCacheKey,
        listContextKey: nextContextKey,
      });
    } catch (requestError) {
      mark('fetchList error', {
        status: Number(requestError?.response?.status || 0) || null,
        detail: String(requestError?.response?.data?.detail || requestError?.message || '').slice(0, 160),
      });
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
      if (reset && !cachedList?.data && recentHydratedScope !== mailCacheScope && !previousHadItems) {
        setListData((prev) => ({ ...prev, items: [] }));
      }
      return null;
    } finally {
      if (isCurrentListFetch()) {
        if (reset) {
          setLoading(false);
          setMailBackgroundRefreshing?.(false);
        } else {
          setLoadingMore(false);
        }
      }
      mark('fetchList finally', {
        gen: requestGeneration,
        current: isCurrentListFetch(),
        totalMs: Date.now() - timingStartedAt,
      });
    }
  }, [
    applyResolvedListData,
    currentListCacheKey,
    currentListKeyRef,
    currentListParams,
    folder,
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
    setMailBackgroundRefreshing,
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
    listParams = null,
    listCacheKey = null,
    listContextKey = null,
    reason = '',
    startedAt = 0,
  } = {}) => {
    return fetchList({
      reset: true,
      silent,
      selectFirstIfSelectionMissing,
      force,
      listParams,
      listCacheKey,
      listContextKey,
      reason,
      startedAt,
    });
  }, [fetchList]);
  refreshListFnRef.current = refreshList;

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
