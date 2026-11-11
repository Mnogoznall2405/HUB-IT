import { useCallback } from 'react';

export const CHAT_DEBUG_STORAGE_KEY = 'chat:debug';

export function isChatDebugEnabled({
  storageKey = CHAT_DEBUG_STORAGE_KEY,
  readStorageItem = typeof window !== 'undefined' && window.localStorage
    ? window.localStorage.getItem.bind(window.localStorage)
    : undefined,
} = {}) {
  try {
    const raw = String(readStorageItem?.(storageKey) || '').trim().toLowerCase();
    if (!raw) return false;
    return !['0', 'false', 'off', 'no', 'disabled'].includes(raw);
  } catch {
    return false;
  }
}

export function buildChatDebugLogPayload({
  event,
  details = {},
  activeConversationIdRef,
  autoScrollMetaRef,
  autoScrollRef,
  chatDebugSeqRef,
  degradedThreadRevalidateCountRef,
  initialViewportGuardRef,
  lastSocketActivityAtRef,
  pendingInitialAnchorRef,
  resolveActiveThreadTransportState,
  socketStatusRef,
  threadScrollRef,
} = {}) {
  const container = threadScrollRef?.current;
  const pendingAnchor = pendingInitialAnchorRef?.current;
  const initialViewportGuard = initialViewportGuardRef?.current;
  const nextSeq = Number(chatDebugSeqRef?.current || 0) + 1;
  if (chatDebugSeqRef) chatDebugSeqRef.current = nextSeq;

  return {
    label: `[chat-debug #${nextSeq}] ${event}`,
    payload: {
      activeConversationId: String(activeConversationIdRef?.current || '').trim(),
      autoScrollMode: autoScrollRef?.current || false,
      autoScrollMeta: autoScrollMetaRef?.current ? {
        source: String(autoScrollMetaRef.current.source || '').trim(),
        userInitiated: Boolean(autoScrollMetaRef.current.userInitiated),
      } : null,
      pendingAnchor: pendingAnchor ? {
        conversationId: pendingAnchor.conversationId,
        mode: pendingAnchor.mode,
        ready: Boolean(pendingAnchor.ready),
        anchorResolved: Boolean(pendingAnchor.anchorResolved),
        anchorMessageId: String(pendingAnchor.anchorMessageId || '').trim(),
        retryCount: Number(pendingAnchor.retryCount || 0),
        lastAppliedTarget: Number.isFinite(Number(pendingAnchor.lastAppliedTarget))
          ? Number(pendingAnchor.lastAppliedTarget)
          : null,
      } : null,
      scroll: container ? {
        top: Math.round(container.scrollTop),
        height: Math.round(container.scrollHeight),
        clientHeight: Math.round(container.clientHeight),
      } : null,
      transport: {
        socketStatus: String(socketStatusRef?.current || '').trim(),
        lastSocketActivityAt: Number(lastSocketActivityAtRef?.current || 0),
        state: resolveActiveThreadTransportState({
          activeConversationId: String(activeConversationIdRef?.current || '').trim(),
          socketStatus: socketStatusRef?.current,
          lastSocketActivityAt: lastSocketActivityAtRef?.current,
        }),
        degradedRevalidateCount: Number(degradedThreadRevalidateCountRef?.current || 0),
      },
      initialViewportGuard: initialViewportGuard ? {
        conversationId: initialViewportGuard.conversationId,
        mode: initialViewportGuard.mode,
        releaseAt: Number(initialViewportGuard.releaseAt || 0),
        correctionCount: Number(initialViewportGuard.correctionCount || 0),
        lastObservedScrollHeight: Number(initialViewportGuard.lastObservedScrollHeight || 0),
        scrollOpsWithin200ms: Number(initialViewportGuard.scrollOpsWithin200ms || 0),
      } : null,
      ...details,
    },
  };
}

export default function useChatDebugController({
  activeConversationIdRef,
  autoScrollMetaRef,
  autoScrollRef,
  chatDebugSeqRef,
  degradedThreadRevalidateCountRef,
  initialViewportGuardRef,
  lastSocketActivityAtRef,
  logChatDebugRef,
  pendingInitialAnchorRef,
  resolveActiveThreadTransportState,
  socketStatusRef,
  threadScrollRef,
}) {
  const logChatDebug = useCallback((event, details = {}) => {
    if (!isChatDebugEnabled()) return;
    const { label, payload } = buildChatDebugLogPayload({
      event,
      details,
      activeConversationIdRef,
      autoScrollMetaRef,
      autoScrollRef,
      chatDebugSeqRef,
      degradedThreadRevalidateCountRef,
      initialViewportGuardRef,
      lastSocketActivityAtRef,
      pendingInitialAnchorRef,
      resolveActiveThreadTransportState,
      socketStatusRef,
      threadScrollRef,
    });
    console.log(label, payload);
  }, [
    activeConversationIdRef,
    autoScrollMetaRef,
    autoScrollRef,
    chatDebugSeqRef,
    degradedThreadRevalidateCountRef,
    initialViewportGuardRef,
    lastSocketActivityAtRef,
    pendingInitialAnchorRef,
    resolveActiveThreadTransportState,
    socketStatusRef,
    threadScrollRef,
  ]);

  logChatDebugRef.current = logChatDebug;

  return { logChatDebug };
}
