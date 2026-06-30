import { useEffect } from 'react';

import { shouldDeferChatUrlSyncForRequestedConversation } from './chatConversationModel';

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
  navigate('/chat', { replace: true });
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
  writeMobileHistoryState,
}) {
  useEffect(() => {
    if (conversationsLoading) return;
    const requestedExists = requestedConversationId && conversations.some((item) => item.id === requestedConversationId);
    const restoredExists = restoredConversationId && conversations.some((item) => item.id === restoredConversationId);

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
        if (requestedConversationRetryRef.current !== requestedConversationId) {
          requestedConversationRetryRef.current = requestedConversationId;
          void loadConversations({ silent: true, force: true }).catch(() => {});
          return;
        }
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
        });
        return;
      }

      if (restoredConversationId) {
        if (restoredExists) {
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
      if (requestedConversationRetryRef.current !== requestedConversationId) {
        requestedConversationRetryRef.current = requestedConversationId;
        void loadConversations({ silent: true, force: true }).catch(() => {});
        return;
      }
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
        setMobileView,
      });
      return;
    }

    if (!requestedConversationId) {
      requestedConversationHandledRef.current = '';
      applyingRequestedConversationRef.current = '';
    }
    if (activeConversationId && conversations.some((item) => item.id === activeConversationId)) return;
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
    writeMobileHistoryState,
  ]);

  useEffect(() => {
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
  }, [activeConversationId, applyingRequestedConversationRef, conversationBootstrapComplete, isMobile, locationSearch, navigate]);
}
