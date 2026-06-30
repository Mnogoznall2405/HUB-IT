import { useEffect } from 'react';

import { CHAT_FEATURE_ENABLED, CHAT_WS_ENABLED } from '../../lib/chatFeature';

export const CHAT_PAGE_THREAD_POLL_MS = 6_000;

export function bootLoadConversationsAndFolders({ loadConversations, loadChatFolders } = {}) {
  void loadConversations?.();
  void loadChatFolders?.();
}

export function bootLoadAiBots({ loadAiBots } = {}) {
  void loadAiBots?.();
}

export function buildChatInitDebugPayload({
  chatFeatureEnabled = CHAT_FEATURE_ENABLED,
  chatWsEnabled = CHAT_WS_ENABLED,
  threadPollMs = CHAT_PAGE_THREAD_POLL_MS,
} = {}) {
  return {
    chatFeatureEnabled,
    chatWsEnabled,
    threadPollMs,
  };
}

export function logChatInitDebug(logChatDebug, payload = buildChatInitDebugPayload()) {
  logChatDebug?.('chat:init', payload);
}

export default function useChatPageBootEffects({
  loadConversations,
  loadChatFolders,
  loadAiBots,
  logChatDebug,
  threadPollMs = CHAT_PAGE_THREAD_POLL_MS,
}) {
  useEffect(() => {
    bootLoadConversationsAndFolders({ loadConversations, loadChatFolders });
  }, [loadChatFolders, loadConversations]);

  useEffect(() => {
    bootLoadAiBots({ loadAiBots });
  }, [loadAiBots]);

  useEffect(() => {
    logChatInitDebug(logChatDebug, buildChatInitDebugPayload({ threadPollMs }));
  }, [logChatDebug, threadPollMs]);
}
