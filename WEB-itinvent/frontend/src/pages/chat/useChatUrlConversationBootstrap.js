import { useEffect, useRef } from 'react';

import {
  conversationExistsInList,
  getTaskConversationTaskId,
  shouldDeferChatUrlSyncForRequestedConversation,
} from './chatConversationModel';

function applyRequestedConversation({
  conversationId,
  applyingRequestedConversationRef,
  invalidConversationRef,
  isMobile,
  mobileHistoryReadyRef,
  requestedConversationHandledRef,
  requestedConversationRetryRef,
  setActiveConversationId,
  setConversationBootstrapComplete,
  setMobileView,
  writeMobileHistoryState,
}) {
  requestedConversationHandledRef.current = conversationId;
  requestedConversationRetryRef.current = '';
  invalidConversationRef.current = '';
  applyingRequestedConversationRef.current = conversationId;
  setActiveConversationId(conversationId);
  if (isMobile) {
    setMobileView('thread');
    if (mobileHistoryReadyRef.current) {
      writeMobileHistoryState({ view: 'thread', drawerOpen: false, infoOpen: false }, 'replace', conversationId);
    }
  }
  setConversationBootstrapComplete?.(true);
}

function handleMissingRequestedConversation({
  conversationId,
  applyingRequestedConversationRef,
  cancelPendingInitialAnchor,
  clearStoredConversationState,
  invalidConversationRef,
  isMobile,
  navigate,
  notifyInfo,
  requestedConversationHandledRef,
  requestedConversationRetryRef,
  setActiveConversationId,
  setConversationBootstrapComplete,
  setMobileView,
  syncConversationInUrl,
}) {
  requestedConversationHandledRef.current = conversationId;
  applyingRequestedConversationRef.current = '';
  if (invalidConversationRef.current !== conversationId) {
    invalidConversationRef.current = conversationId;
    notifyInfo?.('Чат из ссылки недоступен или вы больше не являетесь его участником.', { title: 'Чат недоступен' });
  }
  clearStoredConversationState({ conversationId, invalidateThread: true });
  cancelPendingInitialAnchor();
  setActiveConversationId('');
  if (isMobile) setMobileView('inbox');
  setConversationBootstrapComplete?.(true);
  if (syncConversationInUrl) {
    navigate('/chat', { replace: true });
  }
}

export default function useChatUrlConversationBootstrap({
  activeConversationId,
  applyingRequestedConversationRef,
  cancelPendingInitialAnchor,
  clearStoredConversationState,
  composePrefillRequested,
  conversationBootstrapComplete,
  conversations,
  conversationsLoading,
  fetchConversationById,
  invalidConversationRef,
  isMobile,
  loadConversations,
  locationSearch,
  mobileHistoryReadyRef,
  navigate,
  notifyInfo,
  requestedConversationHandledRef,
  requestedConversationRetryRef,
  requestedConversationId,
  restoredConversationId,
  restoredMobileView,
  setActiveConversationId,
  setConversationBootstrapComplete,
  setMobileView,
  syncConversationInUrl = true,
  upsertConversation,
  writeMobileHistoryState,
}) {
  const requestedConversationRetryInFlightRef = useRef('');
  const requestedConversationFetchAttemptRef = useRef('');
  const requestedConversationFetchInFlightRef = useRef('');

  useEffect(() => {
    if (conversationsLoading) return;
    const requestedExists = conversationExistsInList(conversations, requestedConversationId);
    const restoredExists = conversationExistsInList(conversations, restoredConversationId);

    const runMissingRequestedConversation = () => {
      handleMissingRequestedConversation({
        conversationId: requestedConversationId,
        applyingRequestedConversationRef,
        cancelPendingInitialAnchor,
        clearStoredConversationState,
        invalidConversationRef,
        isMobile,
        navigate,
        notifyInfo,
        requestedConversationHandledRef,
        requestedConversationRetryRef,
        setActiveConversationId,
        setConversationBootstrapComplete,
        setMobileView,
        syncConversationInUrl,
      });
    };

    // The sidebar list only holds the first conversations page — a valid
    // conversation (e.g. a fresh task discussion without messages) can sort
    // below it. Verify by id before declaring it unavailable.
    const startRequestedConversationFetch = () => {
      if (
        typeof fetchConversationById !== 'function'
        || typeof upsertConversation !== 'function'
        || !requestedConversationId
        || requestedConversationFetchInFlightRef.current === requestedConversationId
        || requestedConversationFetchAttemptRef.current === requestedConversationId
      ) {
        return false;
      }
      requestedConversationFetchAttemptRef.current = requestedConversationId;
      requestedConversationFetchInFlightRef.current = requestedConversationId;
      void Promise.resolve()
        .then(() => fetchConversationById(requestedConversationId))
        .then((detail) => {
          if (conversationExistsInList([detail], requestedConversationId)) {
            upsertConversation(detail);
          } else {
            runMissingRequestedConversation();
          }
        })
        .catch(() => {
          runMissingRequestedConversation();
        })
        .finally(() => {
          if (requestedConversationFetchInFlightRef.current === requestedConversationId) {
            requestedConversationFetchInFlightRef.current = '';
          }
        });
      return true;
    };
    const restoredConversation = restoredExists
      ? (Array.isArray(conversations) ? conversations : []).find(
        (conversation) => String(conversation?.id || '').trim() === String(restoredConversationId || '').trim(),
      )
      : null;
    const requestedRetryInFlight = requestedConversationRetryInFlightRef.current
      && String(requestedConversationRetryInFlightRef.current) === String(requestedConversationId || '').trim();

    if (!conversationBootstrapComplete) {
      if (composePrefillRequested) {
        cancelPendingInitialAnchor();
        setActiveConversationId('');
        if (isMobile) setMobileView('inbox');
        setConversationBootstrapComplete(true);
        return;
      }
      if (requestedConversationId) {
        if (requestedExists) {
          applyRequestedConversation({
            conversationId: requestedConversationId,
            applyingRequestedConversationRef,
            invalidConversationRef,
            isMobile,
            mobileHistoryReadyRef,
            requestedConversationHandledRef,
            requestedConversationRetryRef,
            setActiveConversationId,
            setConversationBootstrapComplete,
            setMobileView,
            writeMobileHistoryState,
          });
          return;
        }
        if (requestedRetryInFlight) return;
        if (requestedConversationRetryRef.current !== requestedConversationId) {
          requestedConversationRetryRef.current = requestedConversationId;
          requestedConversationRetryInFlightRef.current = requestedConversationId;
          void loadConversations({ silent: false, force: true })
            .catch(() => {})
            .finally(() => {
              if (requestedConversationRetryInFlightRef.current === requestedConversationId) {
                requestedConversationRetryInFlightRef.current = '';
              }
            });
          return;
        }
        if (!startRequestedConversationFetch()) {
          runMissingRequestedConversation();
        }
        return;
      }

      if (restoredConversationId) {
        if (restoredExists) {
          if (getTaskConversationTaskId(restoredConversation)) {
            clearStoredConversationState({ conversationId: restoredConversationId });
            invalidConversationRef.current = '';
            applyingRequestedConversationRef.current = '';
            setActiveConversationId('');
            if (isMobile) setMobileView('inbox');
            setConversationBootstrapComplete(true);
            return;
          }
          invalidConversationRef.current = '';
          applyingRequestedConversationRef.current = '';
          setActiveConversationId(restoredConversationId);
          if (isMobile) setMobileView(restoredMobileView === 'thread' ? 'thread' : 'inbox');
          setConversationBootstrapComplete(true);
          return;
        }
        clearStoredConversationState({ conversationId: restoredConversationId, invalidateThread: true });
      }

      cancelPendingInitialAnchor();
      setActiveConversationId('');
      if (isMobile) setMobileView('inbox');
      setConversationBootstrapComplete(true);
      return;
    }

    if (requestedConversationId && requestedConversationId !== requestedConversationHandledRef.current) {
      if (requestedExists) {
        applyRequestedConversation({
          conversationId: requestedConversationId,
          applyingRequestedConversationRef,
          invalidConversationRef,
          isMobile,
          mobileHistoryReadyRef,
          requestedConversationHandledRef,
          requestedConversationRetryRef,
          setActiveConversationId,
          setMobileView,
          writeMobileHistoryState,
        });
        return;
      }
      if (requestedRetryInFlight) return;
      if (requestedConversationRetryRef.current !== requestedConversationId) {
        requestedConversationRetryRef.current = requestedConversationId;
        requestedConversationRetryInFlightRef.current = requestedConversationId;
        void loadConversations({ silent: false, force: true })
          .catch(() => {})
          .finally(() => {
            if (requestedConversationRetryInFlightRef.current === requestedConversationId) {
              requestedConversationRetryInFlightRef.current = '';
            }
          });
        return;
      }
      if (!startRequestedConversationFetch()) {
        runMissingRequestedConversation();
      }
      return;
    }

    if (!requestedConversationId) {
      requestedConversationHandledRef.current = '';
      applyingRequestedConversationRef.current = '';
    }
    if (activeConversationId && conversationExistsInList(conversations, activeConversationId)) return;
    if (activeConversationId) {
      clearStoredConversationState({ conversationId: activeConversationId, invalidateThread: true });
    }
    cancelPendingInitialAnchor();
    setActiveConversationId('');
    if (isMobile) setMobileView('inbox');
  }, [
    activeConversationId,
    applyingRequestedConversationRef,
    cancelPendingInitialAnchor,
    clearStoredConversationState,
    composePrefillRequested,
    conversationBootstrapComplete,
    conversations,
    conversationsLoading,
    fetchConversationById,
    invalidConversationRef,
    isMobile,
    loadConversations,
    mobileHistoryReadyRef,
    navigate,
    notifyInfo,
    requestedConversationHandledRef,
    requestedConversationRetryRef,
    requestedConversationId,
    restoredConversationId,
    restoredMobileView,
    setActiveConversationId,
    setConversationBootstrapComplete,
    setMobileView,
    syncConversationInUrl,
    upsertConversation,
    writeMobileHistoryState,
  ]);

  useEffect(() => {
    if (!syncConversationInUrl) return;
    if (!conversationBootstrapComplete) return;
    if (isMobile) return;
    const currentParams = new URLSearchParams(locationSearch || '');
    const currentConversation = String(currentParams.get('conversation') || '').trim();
    const nextConversation = String(activeConversationId || '').trim();
    const applyingRequestedConversationId = String(applyingRequestedConversationRef.current || '').trim();
    if (shouldDeferChatUrlSyncForRequestedConversation({
      applyingRequestedConversationId,
      activeConversationId: nextConversation,
    })) {
      return;
    }
    if (applyingRequestedConversationId && nextConversation === applyingRequestedConversationId) {
      applyingRequestedConversationRef.current = '';
    }
    if (currentConversation === nextConversation) return;
    if (nextConversation) currentParams.set('conversation', nextConversation);
    else currentParams.delete('conversation');
    const nextSearch = currentParams.toString();
    navigate({ pathname: '/chat', search: nextSearch ? `?${nextSearch}` : '' }, { replace: true });
  }, [activeConversationId, applyingRequestedConversationRef, conversationBootstrapComplete, isMobile, locationSearch, navigate, syncConversationInUrl]);
}
