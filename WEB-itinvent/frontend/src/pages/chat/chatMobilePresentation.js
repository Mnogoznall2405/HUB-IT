import {
  CHAT_MOBILE_SCREEN_TRANSITION_EASE,
  CHAT_MOBILE_SCREEN_TRANSITION_MS,
} from './chatMobileModel';

export function resolveChatMobileView({
  isMobile,
  mobileView,
  activeConversationId,
  conversationBootstrapComplete,
  activeConversation,
  messagesLoading,
  requestedConversationId,
}) {
  if (
    isMobile
    && mobileView === 'thread'
    && !String(activeConversationId || '').trim()
  ) {
    return 'inbox';
  }
  if (
    isMobile
    && mobileView === 'thread'
    && conversationBootstrapComplete
    && !activeConversation
    && !messagesLoading
    && !requestedConversationId
  ) {
    return 'inbox';
  }
  return mobileView;
}

export function buildChatMobileScreenTransition(mobileMotionDisabled) {
  if (mobileMotionDisabled) {
    return { duration: 0.01 };
  }
  return {
    type: 'tween',
    duration: CHAT_MOBILE_SCREEN_TRANSITION_MS / 1000,
    ease: CHAT_MOBILE_SCREEN_TRANSITION_EASE,
  };
}
