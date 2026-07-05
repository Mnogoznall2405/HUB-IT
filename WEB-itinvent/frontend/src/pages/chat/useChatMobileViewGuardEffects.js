import { useEffect } from 'react';

export function shouldResetMobileViewWithoutConversation({
  isMobile,
  mobileView,
  activeConversationId,
} = {}) {
  return Boolean(isMobile && mobileView === 'thread' && !String(activeConversationId || '').trim());
}

export function shouldResetMobileViewAfterFailedBootstrap({
  isMobile,
  mobileView,
  conversationBootstrapComplete,
  messagesLoading,
  activeConversation,
} = {}) {
  if (!isMobile || mobileView !== 'thread') return false;
  if (!conversationBootstrapComplete || messagesLoading) return false;
  return !activeConversation;
}

export function shouldCloseInfoPanelOnMobileInbox({
  isMobile,
  resolvedMobileView,
  infoOpen,
} = {}) {
  return Boolean(isMobile && resolvedMobileView !== 'thread' && infoOpen);
}

export default function useChatMobileViewGuardEffects({
  activeConversation,
  activeConversationId,
  conversationBootstrapComplete,
  infoOpen,
  isMobile,
  messagesLoading,
  mobileView,
  resolvedMobileView,
  setInfoOpen,
  setMobileView,
}) {
  useEffect(() => {
    if (!shouldResetMobileViewWithoutConversation({ isMobile, mobileView, activeConversationId })) return;
    setMobileView('inbox');
  }, [activeConversationId, isMobile, mobileView, setMobileView]);

  useEffect(() => {
    if (!shouldResetMobileViewAfterFailedBootstrap({
      isMobile,
      mobileView,
      conversationBootstrapComplete,
      messagesLoading,
      activeConversation,
    })) return;
    setMobileView('inbox');
  }, [
    activeConversation,
    conversationBootstrapComplete,
    isMobile,
    messagesLoading,
    mobileView,
    setMobileView,
  ]);

  useEffect(() => {
    if (!shouldCloseInfoPanelOnMobileInbox({ isMobile, resolvedMobileView, infoOpen })) return;
    setInfoOpen(false);
  }, [infoOpen, isMobile, resolvedMobileView, setInfoOpen]);
}
