import { useCallback, useEffect } from 'react';
import {
  getOrFetchSWR,
  peekSWRCache,
  setSWRCache,
} from '../../lib/swrCache';
import {
  buildMailRoute,
} from './mailViewStateModel';
import {
  buildMailDetailCacheKey,
  buildMailDetailContextKey,
  hasMailDetailBodyContent,
  mergeMessageDetailPreservingBody,
  resolveMailDetailInitialState,
  resolveMailDetailLoadErrorAction,
  shouldForceMailDetailFetch,
} from './mailDetailModel';

export default function useMailSelectedDetailLifecycle({
  activeMailboxId,
  advancedFiltersApplied,
  beginAutoReadGuard,
  clearSelection,
  folder,
  getMailErrorDetail,
  getRecentMessageDetailSnapshot,
  handleMailCredentialsRequired,
  invalidateMailClientCache,
  isMissingMailDetailError,
  isTransientMailRequestError,
  mailAPI,
  mailAccessReady,
  mailCacheScope,
  mailDetailStaleTimeMs,
  navigate,
  performMailReadMutation,
  persistRecentMessageDetailSnapshot,
  refreshList,
  refs = {},
  resolveConversationReadStateOverrides,
  resolveMessageReadStateOverrides,
  selectedId,
  setDetailLoading,
  setError,
  setSelectedConversation,
  setSelectedMessage,
  viewMode,
  withActiveMailboxParams,
} = {}) {
  const {
    detailContextRef,
    detailRequestAbortRef,
    selectedMessageRef,
    suppressNextAutoReadRef,
  } = refs;

  const revalidateSelectedMailDetail = useCallback(async ({ force = false } = {}) => {
    if (!mailAccessReady || !selectedId) return null;
    const folderScope = advancedFiltersApplied?.folder_scope || 'current';
    const currentSelectionKey = buildMailDetailContextKey({ viewMode, folder, selectedId });
    const detailCacheKey = buildMailDetailCacheKey({
      viewMode,
      scope: mailCacheScope,
      selectedId,
      folder,
      folderScope,
    });
    const cachedDetail = peekSWRCache(detailCacheKey, { staleTimeMs: mailDetailStaleTimeMs });
    if (!force && cachedDetail?.data && cachedDetail?.isFresh) {
      return cachedDetail.data;
    }
    const fetcher = () => (
      viewMode === 'conversations'
        ? mailAPI.getConversation(selectedId, withActiveMailboxParams({ folder, folder_scope: folderScope }))
        : mailAPI.getMessage(selectedId, { mailboxId: activeMailboxId })
    );
    const result = await getOrFetchSWR(
      detailCacheKey,
      fetcher,
      {
        staleTimeMs: mailDetailStaleTimeMs,
        force: shouldForceMailDetailFetch({ force, cachedDetail }),
        revalidateStale: false,
      }
    );
    if (!result?.data || detailContextRef.current !== currentSelectionKey) return result?.data || null;
    if (viewMode === 'conversations') {
      const nextConversation = resolveConversationReadStateOverrides(result.data);
      const items = Array.isArray(nextConversation?.items) ? nextConversation.items : [];
      setSelectedConversation(nextConversation || null);
      setSelectedMessage(items.length > 0 ? items[items.length - 1] : null);
      return nextConversation || result.data;
    }
    const nextMessage = resolveMessageReadStateOverrides(
      mergeMessageDetailPreservingBody({
        nextMessage: result.data,
        previousMessage: selectedMessageRef.current,
      })
    );
    setSWRCache(detailCacheKey, nextMessage);
    persistRecentMessageDetailSnapshot(nextMessage);
    setSelectedConversation(null);
    setSelectedMessage(nextMessage || null);
    return nextMessage || result.data;
  }, [
    activeMailboxId,
    advancedFiltersApplied?.folder_scope,
    detailContextRef,
    folder,
    mailAPI,
    mailAccessReady,
    mailCacheScope,
    mailDetailStaleTimeMs,
    persistRecentMessageDetailSnapshot,
    resolveConversationReadStateOverrides,
    resolveMessageReadStateOverrides,
    selectedId,
    selectedMessageRef,
    setSelectedConversation,
    setSelectedMessage,
    viewMode,
    withActiveMailboxParams,
  ]);

  useEffect(() => {
    if (!mailAccessReady || !selectedId) {
      if (detailRequestAbortRef.current) {
        detailRequestAbortRef.current.abort();
        detailRequestAbortRef.current = null;
      }
      detailContextRef.current = '';
      setDetailLoading(false);
      setSelectedMessage(null);
      setSelectedConversation(null);
      return;
    }
    const detailContextKey = buildMailDetailContextKey({ viewMode, folder, selectedId });
    const shouldShowSkeleton = detailContextRef.current !== detailContextKey;
    detailContextRef.current = detailContextKey;
    const controller = new AbortController();
    if (detailRequestAbortRef.current) {
      detailRequestAbortRef.current.abort();
    }
    detailRequestAbortRef.current = controller;
    let cancelled = false;
    const folderScope = advancedFiltersApplied?.folder_scope || 'current';
    const detailCacheKey = buildMailDetailCacheKey({
      viewMode,
      scope: mailCacheScope,
      selectedId,
      folder,
      folderScope,
    });
    const applyDetailPayload = (data, { suppressAutoRead = false } = {}) => {
      if (!data) return;
      if (viewMode === 'conversations') {
        const nextConversation = resolveConversationReadStateOverrides(data);
        const items = Array.isArray(nextConversation?.items) ? nextConversation.items : [];
        setSelectedConversation(nextConversation || null);
        setSelectedMessage(items.length > 0 ? items[items.length - 1] : null);
        const autoReadGuardKey = `${detailContextKey}:auto-read`;
        if (!suppressAutoRead && Number(nextConversation?.unread_count || 0) > 0 && beginAutoReadGuard(autoReadGuardKey)) {
          void performMailReadMutation({
            mode: 'conversations',
            targetId: String(nextConversation?.conversation_id || selectedId),
            nextIsRead: true,
            currentUnreadCount: Number(nextConversation?.unread_count || 0),
            currentMessageCount: Number(nextConversation?.messages_count || items.length || 1),
            errorMessage: 'Не удалось отметить диалог как прочитанный.',
            autoReadGuardKey,
          });
        }
      } else {
        const nextMessage = resolveMessageReadStateOverrides(
          mergeMessageDetailPreservingBody({
            nextMessage: data,
            previousMessage: selectedMessageRef.current,
          })
        );
        setSelectedConversation(null);
        setSelectedMessage(nextMessage || null);
        const autoReadGuardKey = `${detailContextKey}:auto-read`;
        if (!suppressAutoRead && nextMessage?.id && nextMessage?.is_read === false && beginAutoReadGuard(autoReadGuardKey)) {
          void performMailReadMutation({
            mode: 'messages',
            targetId: String(nextMessage.id),
            nextIsRead: true,
            currentUnreadCount: 1,
            currentMessageCount: 1,
            errorMessage: 'Не удалось отметить письмо как прочитанное.',
            autoReadGuardKey,
          });
        }
      }
    };
    const loadDetails = async () => {
      const cachedDetail = peekSWRCache(detailCacheKey, { staleTimeMs: mailDetailStaleTimeMs });
      const recentDetail = viewMode === 'messages'
        ? getRecentMessageDetailSnapshot(selectedId)
        : null;
      const initialDetailState = resolveMailDetailInitialState({
        viewMode,
        cachedDetail,
        recentDetail,
        shouldShowSkeleton,
        detailContextKey,
        suppressAutoReadKey: suppressNextAutoReadRef.current,
        hasBodyContent: hasMailDetailBodyContent,
      });
      if (initialDetailState.detail) {
        suppressNextAutoReadRef.current = initialDetailState.nextSuppressAutoReadKey;
        applyDetailPayload(initialDetailState.detail, { suppressAutoRead: initialDetailState.suppressAutoRead });
        setDetailLoading(false);
      } else if (initialDetailState.shouldShowLoading) {
        setDetailLoading(true);
      }
      try {
        const suppressAutoReadForSelection = suppressNextAutoReadRef.current === detailContextKey;
        if (suppressAutoReadForSelection) {
          suppressNextAutoReadRef.current = '';
        }
        const fetcher = () => (
          viewMode === 'conversations'
            ? mailAPI.getConversation(
                selectedId,
                withActiveMailboxParams({ folder, folder_scope: folderScope }),
                { signal: controller.signal }
              )
            : mailAPI.getMessage(selectedId, { signal: controller.signal, mailboxId: activeMailboxId })
        );
        const result = await getOrFetchSWR(
          detailCacheKey,
          fetcher,
          {
            staleTimeMs: mailDetailStaleTimeMs,
            revalidateStale: false,
          }
        );
        if (cancelled || controller.signal.aborted) return;
        if (result?.data && detailContextRef.current === detailContextKey) {
          const nextDetail = viewMode === 'messages'
            ? resolveMessageReadStateOverrides(
                mergeMessageDetailPreservingBody({
                  nextMessage: result.data,
                  previousMessage: selectedMessageRef.current,
                })
              )
            : resolveConversationReadStateOverrides(result.data);
          if (viewMode === 'messages') {
            setSWRCache(detailCacheKey, nextDetail);
            persistRecentMessageDetailSnapshot(nextDetail);
          }
          applyDetailPayload(nextDetail, { suppressAutoRead: suppressAutoReadForSelection });
        }
        if (result?.fromCache && !result?.isFresh) {
          void getOrFetchSWR(
            detailCacheKey,
            fetcher,
            {
              staleTimeMs: mailDetailStaleTimeMs,
              force: true,
              revalidateStale: false,
            }
          ).then((freshResult) => {
            if (cancelled || controller.signal.aborted || detailContextRef.current !== detailContextKey) return;
            if (freshResult?.data) {
              const nextDetail = viewMode === 'messages'
                ? resolveMessageReadStateOverrides(
                    mergeMessageDetailPreservingBody({
                      nextMessage: freshResult.data,
                      previousMessage: selectedMessageRef.current,
                    })
                  )
                : resolveConversationReadStateOverrides(freshResult.data);
              if (viewMode === 'messages') {
                setSWRCache(detailCacheKey, nextDetail);
                persistRecentMessageDetailSnapshot(nextDetail);
              }
              applyDetailPayload(nextDetail, { suppressAutoRead: suppressAutoReadForSelection });
            }
          }).catch(() => {});
        }
      } catch (requestError) {
        if (cancelled || controller.signal.aborted || requestError?.code === 'ERR_CANCELED') return;
        const errorDetail = getMailErrorDetail(requestError, 'Не удалось загрузить письмо.');
        const selectedMessageSnapshot = selectedMessageRef.current;
        const hasStableSelectedMessageBody = Boolean(
          selectedMessageSnapshot
          && !selectedMessageSnapshot?.__previewOnly
          && hasMailDetailBodyContent(selectedMessageSnapshot)
        );
        const errorAction = resolveMailDetailLoadErrorAction({
          viewMode,
          requestError,
          errorDetail,
          hasStableSelectedMessageBody,
          isMissingDetailError: isMissingMailDetailError,
          isTransientRequestError: isTransientMailRequestError,
        });
        if (errorAction.type === 'clear-conversation-selection') {
          clearSelection({ mode: 'conversations' });
          return;
        }
        if (errorAction.type === 'clear-missing-message-selection') {
          invalidateMailClientCache(['bootstrap', 'list', 'message-detail']);
          navigate(buildMailRoute({
            folder,
            mailboxId: activeMailboxId,
          }), { replace: true });
          clearSelection({ mode: 'messages' });
          void refreshList({ silent: true, force: true });
          setError(errorAction.userMessage);
          return;
        }
        if (await handleMailCredentialsRequired(requestError)) return;
        if (errorAction.type === 'suppress-transient-error') {
          return;
        }
        setError(errorAction.errorDetail);
      } finally {
        if (detailRequestAbortRef.current === controller) {
          detailRequestAbortRef.current = null;
        }
        if (!cancelled) setDetailLoading(false);
      }
    };
    loadDetails();
    return () => {
      cancelled = true;
      controller.abort();
      if (detailRequestAbortRef.current === controller) {
        detailRequestAbortRef.current = null;
      }
    };
  }, [
    activeMailboxId,
    advancedFiltersApplied,
    beginAutoReadGuard,
    clearSelection,
    detailContextRef,
    detailRequestAbortRef,
    folder,
    getMailErrorDetail,
    getRecentMessageDetailSnapshot,
    handleMailCredentialsRequired,
    invalidateMailClientCache,
    isMissingMailDetailError,
    isTransientMailRequestError,
    mailAPI,
    mailAccessReady,
    mailCacheScope,
    mailDetailStaleTimeMs,
    navigate,
    performMailReadMutation,
    persistRecentMessageDetailSnapshot,
    refreshList,
    resolveConversationReadStateOverrides,
    resolveMessageReadStateOverrides,
    selectedId,
    selectedMessageRef,
    setDetailLoading,
    setError,
    setSelectedConversation,
    setSelectedMessage,
    suppressNextAutoReadRef,
    viewMode,
    withActiveMailboxParams,
  ]);

  return {
    revalidateSelectedMailDetail,
  };
}
