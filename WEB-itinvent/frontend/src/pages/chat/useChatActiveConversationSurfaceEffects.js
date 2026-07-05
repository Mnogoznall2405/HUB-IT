import { useEffect } from 'react';

import { chatAPI } from '../../api/client';
import { getMessagePreview } from '../../components/chat/chatHelpers';
import { mergeAiStatusPayload, shouldRequestConversationAiStatus } from './chatAiModel';
import {
  loadChatContextPanelModule,
  loadTaskWorkspacePanelModule,
} from './useChatPanelsController';

export function readLocalStorageJsonObject(storageKey) {
  const normalizedStorageKey = String(storageKey || '').trim();
  if (!normalizedStorageKey || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(normalizedStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function buildPinnedMessagePayloadFromMessage(message) {
  const normalizedMessageId = String(message?.id || '').trim();
  if (!normalizedMessageId) return null;
  return {
    id: normalizedMessageId,
    senderName: String(message?.sender?.full_name || message?.sender?.username || '').trim(),
    preview: String(getMessagePreview(message) || '').trim(),
    createdAt: String(message?.created_at || '').trim(),
  };
}

export function parseStoredPinnedMessage(storedPinnedMessage) {
  const normalizedMessageId = String(storedPinnedMessage?.id || '').trim();
  if (!normalizedMessageId) return null;
  return {
    id: normalizedMessageId,
    senderName: String(storedPinnedMessage?.senderName || '').trim(),
    preview: String(storedPinnedMessage?.preview || '').trim(),
    createdAt: String(storedPinnedMessage?.createdAt || '').trim(),
  };
}

export function shouldSkipPinnedMessageReconcile(pinnedMessage, nextPinnedMessage) {
  if (!nextPinnedMessage) return true;
  return (
    nextPinnedMessage.senderName === String(pinnedMessage?.senderName || '').trim()
    && nextPinnedMessage.preview === String(pinnedMessage?.preview || '').trim()
    && nextPinnedMessage.createdAt === String(pinnedMessage?.createdAt || '').trim()
  );
}

export function resolveHeavyChatSurfacePrefetchTargets({
  isMobile = false,
  showContextPanel = false,
  showTaskPanel = false,
} = {}) {
  if (isMobile) {
    return { prefetchContextPanel: false, prefetchTaskPanel: false };
  }
  return {
    prefetchContextPanel: Boolean(showContextPanel),
    prefetchTaskPanel: Boolean(showTaskPanel),
  };
}

export function scheduleHeavyChatSurfacePrefetch(callback, {
  requestIdleCallback = typeof window !== 'undefined' ? window.requestIdleCallback : undefined,
  cancelIdleCallback = typeof window !== 'undefined' ? window.cancelIdleCallback : undefined,
  setTimeoutFn = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
    ? window.setTimeout.bind(window)
    : undefined,
  clearTimeoutFn = typeof window !== 'undefined' && typeof window.clearTimeout === 'function'
    ? window.clearTimeout.bind(window)
    : undefined,
  idleTimeoutMs = 1500,
  fallbackDelayMs = 900,
} = {}) {
  if (typeof requestIdleCallback === 'function') {
    const idleId = requestIdleCallback(callback, { timeout: idleTimeoutMs });
    return () => {
      cancelIdleCallback?.(idleId);
    };
  }
  const timeoutId = setTimeoutFn?.(callback, fallbackDelayMs);
  return () => {
    clearTimeoutFn?.(timeoutId);
  };
}

export default function useChatActiveConversationSurfaceEffects({
  activeConversationId,
  activeConversationKind,
  canUseAiChat,
  isMobile,
  messages,
  persistPinnedMessage,
  pinnedMessage,
  pinnedMessageStorageKey,
  setAiStatusByConversation,
  setPinnedMessage,
  showContextPanel,
  showTaskPanel,
}) {
  useEffect(() => {
    const conversationId = String(activeConversationId || '').trim();
    if (!shouldRequestConversationAiStatus({
      conversationId,
      conversationKind: activeConversationKind,
      canUseAiChat,
    })) return undefined;
    let cancelled = false;
    void chatAPI.getConversationAiStatus(conversationId)
      .then((status) => {
        if (cancelled || !status?.conversation_id) return;
        setAiStatusByConversation((current) => mergeAiStatusPayload(current, status));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeConversationId, activeConversationKind, canUseAiChat, setAiStatusByConversation]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const { prefetchContextPanel, prefetchTaskPanel } = resolveHeavyChatSurfacePrefetchTargets({
      isMobile,
      showContextPanel,
      showTaskPanel,
    });
    return scheduleHeavyChatSurfacePrefetch(() => {
      if (prefetchContextPanel) {
        void loadChatContextPanelModule();
      }
      if (prefetchTaskPanel) {
        void loadTaskWorkspacePanelModule();
      }
    });
  }, [isMobile, showContextPanel, showTaskPanel]);

  useEffect(() => {
    if (!pinnedMessageStorageKey) {
      setPinnedMessage(null);
      return undefined;
    }
    const storedPinnedMessage = readLocalStorageJsonObject(pinnedMessageStorageKey);
    setPinnedMessage(parseStoredPinnedMessage(storedPinnedMessage));
    return undefined;
  }, [pinnedMessageStorageKey, setPinnedMessage]);

  useEffect(() => {
    const pinnedMessageId = String(pinnedMessage?.id || '').trim();
    if (!pinnedMessageId) return undefined;
    const latestPinnedMessage = messages.find(
      (item) => String(item?.id || '').trim() === pinnedMessageId,
    );
    if (!latestPinnedMessage) return undefined;
    const nextPinnedMessage = buildPinnedMessagePayloadFromMessage(latestPinnedMessage);
    if (!nextPinnedMessage || shouldSkipPinnedMessageReconcile(pinnedMessage, nextPinnedMessage)) {
      return undefined;
    }
    persistPinnedMessage(nextPinnedMessage);
    return undefined;
  }, [messages, persistPinnedMessage, pinnedMessage]);
}
