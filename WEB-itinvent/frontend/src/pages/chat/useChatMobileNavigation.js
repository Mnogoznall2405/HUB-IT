import { useCallback, useEffect } from 'react';

import {
  CHAT_MOBILE_HISTORY_DRAWER_KEY,
  CHAT_MOBILE_HISTORY_FLAG,
  CHAT_MOBILE_HISTORY_INFO_KEY,
  CHAT_MOBILE_HISTORY_VIEW_KEY,
  readChatMobileHistoryState,
} from './chatMobileModel';

const DEFAULT_CONVERSATIONS_STALE_MS = 30_000;

export default function useChatMobileNavigation({
  isMobile,
  activeConversationId,
  activeConversationIdRef,
  closeDrawer,
  conversationsStaleTimeMs = DEFAULT_CONVERSATIONS_STALE_MS,
  getCurrentBrowserConversationId,
  infoOpen,
  lastConversationsLoadAtRef,
  loadConversations,
  locationHash,
  locationPathname,
  locationSearch,
  mobileHistoryModeRef,
  mobileHistoryReadyRef,
  openMobileThreadViewRef,
  requestedConversationId,
  requestedMessageId,
  resolvedMobileView,
  setActiveConversationId,
  setInfoOpen,
  setMobileBottomNavHidden,
  setMobileTransitionDirection,
  setMobileView,
}) {
  const maybeRefreshStaleConversations = useCallback(() => {
    if (!loadConversations || !lastConversationsLoadAtRef) return;
    const staleMs = Math.max(0, Number(conversationsStaleTimeMs) || DEFAULT_CONVERSATIONS_STALE_MS);
    const lastLoadAt = Number(lastConversationsLoadAtRef.current || 0);
    if (!lastLoadAt || Date.now() - lastLoadAt > staleMs) {
      void loadConversations({ silent: true }).catch(() => {});
    }
  }, [conversationsStaleTimeMs, lastConversationsLoadAtRef, loadConversations]);

  const buildMobileHistoryUrl = useCallback((nextState, conversationId = activeConversationIdRef.current) => {
    const currentPathname = typeof window !== 'undefined' ? window.location.pathname : locationPathname;
    const currentSearch = typeof window !== 'undefined' ? window.location.search : locationSearch;
    const currentHash = typeof window !== 'undefined' ? window.location.hash : locationHash;
    const params = new URLSearchParams(currentSearch);
    const normalizedConversationId = String(conversationId || '').trim();
    const nextView = String(nextState?.view || '').trim() === 'thread' ? 'thread' : 'inbox';
    if (nextView === 'thread' && normalizedConversationId) {
      params.set('conversation', normalizedConversationId);
    } else {
      params.delete('conversation');
    }
    const shouldPreserveFocusedMessage = (
      nextView === 'thread'
      && normalizedConversationId
      && normalizedConversationId === requestedConversationId
      && Boolean(requestedMessageId)
    );
    if (!shouldPreserveFocusedMessage) {
      params.delete('message');
    }
    const nextSearch = params.toString();
    return `${currentPathname}${nextSearch ? `?${nextSearch}` : ''}${currentHash || ''}`;
  }, [activeConversationIdRef, locationHash, locationPathname, locationSearch, requestedConversationId, requestedMessageId]);

  const getMobileHistoryKey = useCallback((nextState, conversationId = activeConversationIdRef.current) => {
    const nextView = String(nextState?.view || '').trim() === 'thread' ? 'thread' : 'inbox';
    const drawerKey = 'closed';
    const infoKey = nextView === 'thread' && Boolean(nextState?.infoOpen) ? 'info' : 'main';
    const normalizedConversationId = nextView === 'thread'
      ? (String(conversationId || '').trim() || 'none')
      : 'none';
    return `${nextView}:${drawerKey}:${infoKey}:${normalizedConversationId}`;
  }, [activeConversationIdRef]);

  const readMobileHistoryState = useCallback((state = window.history.state) => (
    readChatMobileHistoryState(state)
  ), []);

  const writeMobileHistoryState = useCallback((nextState, strategy = 'push', conversationId = activeConversationIdRef.current) => {
    if (!isMobile || typeof window === 'undefined') return;
    const normalizedView = String(nextState?.view || '').trim() === 'thread' ? 'thread' : 'inbox';
    const normalizedDrawerOpen = false;
    const normalizedInfoOpen = normalizedView === 'thread' && Boolean(nextState?.infoOpen);
    const currentState = window.history.state && typeof window.history.state === 'object'
      ? window.history.state
      : {};
    const nextHistoryState = {
      ...currentState,
      [CHAT_MOBILE_HISTORY_FLAG]: true,
      [CHAT_MOBILE_HISTORY_VIEW_KEY]: normalizedView,
      [CHAT_MOBILE_HISTORY_DRAWER_KEY]: normalizedDrawerOpen,
      [CHAT_MOBILE_HISTORY_INFO_KEY]: normalizedInfoOpen,
    };
    const nextUrl = buildMobileHistoryUrl({ view: normalizedView, drawerOpen: normalizedDrawerOpen }, conversationId);
    if (strategy === 'replace') {
      window.history.replaceState(nextHistoryState, '', nextUrl);
    } else {
      window.history.pushState(nextHistoryState, '', nextUrl);
    }
    mobileHistoryModeRef.current = getMobileHistoryKey(
      { view: normalizedView, drawerOpen: normalizedDrawerOpen, infoOpen: normalizedInfoOpen },
      conversationId,
    );
  }, [buildMobileHistoryUrl, getMobileHistoryKey, isMobile, mobileHistoryModeRef]);

  const openMobileThreadView = useCallback((conversationId = activeConversationIdRef.current) => {
    if (!isMobile) return;
    const normalizedConversationId = String(conversationId || activeConversationIdRef.current).trim();
    closeDrawer?.();
    setInfoOpen(false);
    setMobileTransitionDirection(1);
    setMobileView('thread');
    if (!mobileHistoryReadyRef.current || typeof window === 'undefined' || !normalizedConversationId) return;
    const nextState = { view: 'thread', drawerOpen: false, infoOpen: false };
    const currentState = readMobileHistoryState();
    const currentConversationId = currentState?.view === 'thread' ? getCurrentBrowserConversationId() : '';
    const currentHistoryKey = currentState ? getMobileHistoryKey(currentState, currentConversationId) : '';
    const nextHistoryKey = getMobileHistoryKey(nextState, normalizedConversationId);
    if (currentHistoryKey === nextHistoryKey) return;
    writeMobileHistoryState(nextState, 'push', normalizedConversationId);
  }, [
    activeConversationIdRef,
    closeDrawer,
    getCurrentBrowserConversationId,
    getMobileHistoryKey,
    isMobile,
    mobileHistoryReadyRef,
    readMobileHistoryState,
    setInfoOpen,
    setMobileTransitionDirection,
    setMobileView,
    writeMobileHistoryState,
  ]);

  const openMobileInboxView = useCallback(() => {
    if (!isMobile) return;
    setMobileBottomNavHidden(false);
    const currentMobileHistoryState = typeof window !== 'undefined' && mobileHistoryReadyRef.current
      ? readMobileHistoryState()
      : null;
    if (currentMobileHistoryState?.view === 'thread' && currentMobileHistoryState?.infoOpen) {
      setInfoOpen(false);
      window.history.back();
      return;
    }
    if (currentMobileHistoryState?.view === 'thread' && !currentMobileHistoryState?.drawerOpen) {
      closeDrawer?.();
      setInfoOpen(false);
      setMobileTransitionDirection(-1);
      setMobileView('inbox');
      maybeRefreshStaleConversations();
      window.history.back();
      return;
    }
    closeDrawer?.();
    setInfoOpen(false);
    setMobileTransitionDirection(-1);
    setMobileView('inbox');
    maybeRefreshStaleConversations();
  }, [
    closeDrawer,
    isMobile,
    maybeRefreshStaleConversations,
    mobileHistoryReadyRef,
    readMobileHistoryState,
    setInfoOpen,
    setMobileBottomNavHidden,
    setMobileTransitionDirection,
    setMobileView,
  ]);

  useEffect(() => {
    if (!isMobile) {
      mobileHistoryReadyRef.current = false;
      mobileHistoryModeRef.current = 'inbox:closed:none';
      return;
    }
    if (mobileHistoryReadyRef.current || typeof window === 'undefined') return;

    const existingState = readMobileHistoryState();
    if (existingState) {
      mobileHistoryReadyRef.current = true;
      mobileHistoryModeRef.current = getMobileHistoryKey(
        existingState,
        existingState.view === 'thread' ? getCurrentBrowserConversationId() : '',
      );
      return;
    }

    writeMobileHistoryState({ view: 'inbox', drawerOpen: false, infoOpen: false }, 'replace');
    if (resolvedMobileView === 'thread') {
      writeMobileHistoryState({ view: 'thread', drawerOpen: false, infoOpen: false }, 'push', activeConversationId);
    }
    mobileHistoryReadyRef.current = true;
  }, [
    activeConversationId,
    getCurrentBrowserConversationId,
    getMobileHistoryKey,
    isMobile,
    mobileHistoryModeRef,
    mobileHistoryReadyRef,
    readMobileHistoryState,
    resolvedMobileView,
    writeMobileHistoryState,
  ]);

  useEffect(() => {
    if (!isMobile || !mobileHistoryReadyRef.current || typeof window === 'undefined') return undefined;
    const handlePopState = (event) => {
      const nextState = readMobileHistoryState(event.state);
      if (!nextState) return;
      const previousState = {
        view: resolvedMobileView === 'thread' ? 'thread' : 'inbox',
        drawerOpen: false,
        infoOpen,
      };
      const nextConversationId = nextState.view === 'thread'
        ? getCurrentBrowserConversationId()
        : '';
      mobileHistoryModeRef.current = getMobileHistoryKey(nextState, nextConversationId);

      if (previousState.view !== nextState.view) {
        setMobileTransitionDirection(nextState.view === 'thread' ? 1 : -1);
      }
      setInfoOpen(nextState.view === 'thread' && Boolean(nextState.infoOpen));
      if (nextState.view === 'thread') {
        if (!nextConversationId) {
          setActiveConversationId('');
          setMobileView('inbox');
          setInfoOpen(false);
          closeDrawer?.();
          return;
        }
        if (activeConversationIdRef.current !== nextConversationId) {
          setActiveConversationId(nextConversationId);
        }
      } else if (activeConversationIdRef.current) {
        setActiveConversationId('');
      }
      setMobileView(nextState.view);
      closeDrawer?.();
      if (nextState.view === 'inbox') {
        maybeRefreshStaleConversations();
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [
    activeConversationIdRef,
    closeDrawer,
    getCurrentBrowserConversationId,
    getMobileHistoryKey,
    infoOpen,
    isMobile,
    maybeRefreshStaleConversations,
    mobileHistoryModeRef,
    mobileHistoryReadyRef,
    readMobileHistoryState,
    resolvedMobileView,
    setActiveConversationId,
    setInfoOpen,
    setMobileTransitionDirection,
    setMobileView,
  ]);

  if (openMobileThreadViewRef) {
    openMobileThreadViewRef.current = openMobileThreadView;
  }

  return {
    buildMobileHistoryUrl,
    getCurrentBrowserConversationId,
    getMobileHistoryKey,
    openMobileInboxView,
    openMobileThreadView,
    readMobileHistoryState,
    writeMobileHistoryState,
  };
}
