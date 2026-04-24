import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { resolveLatestMessageIdInOrder } from './chatHelpers';

const READ_RECEIPTS_DEBOUNCE_MS = 500;
const READ_RECEIPTS_THRESHOLD = 0.5;

export default function useReadReceipts({
  conversationId,
  messages,
  enabled = true,
  scrollRootRef,
  viewerLastReadMessageId = '',
  markRead,
  onOptimisticRead,
  onReadSyncError,
}) {
  const normalizedConversationId = String(conversationId || '').trim();
  const [optimisticLastReadMessageId, setOptimisticLastReadMessageId] = useState('');
  const observerRef = useRef(null);
  const pendingReadIdsRef = useRef(new Set());
  const optimisticReadIdsRef = useRef(new Set());
  const observedNodesRef = useRef(new Map());
  const callbackRefsRef = useRef(new Map());
  const debounceTimerRef = useRef(null);
  const lastSentMessageIdRef = useRef('');
  const inFlightMessageIdRef = useRef('');
  const flushPendingReadsRef = useRef(async () => {});

  const effectiveLastReadMessageId = useMemo(
    () => resolveLatestMessageIdInOrder(messages, viewerLastReadMessageId, optimisticLastReadMessageId),
    [messages, optimisticLastReadMessageId, viewerLastReadMessageId],
  );

  const clearPendingTimer = useCallback(() => {
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const resetTracking = useCallback(() => {
    clearPendingTimer();
    observerRef.current?.disconnect?.();
    observerRef.current = null;
    pendingReadIdsRef.current.clear();
    optimisticReadIdsRef.current.clear();
    lastSentMessageIdRef.current = '';
    inFlightMessageIdRef.current = '';
    setOptimisticLastReadMessageId('');
  }, [clearPendingTimer]);

  useEffect(() => {
    resetTracking();
  }, [normalizedConversationId, resetTracking]);

  useEffect(() => () => {
    clearPendingTimer();
    observerRef.current?.disconnect?.();
  }, [clearPendingTimer]);

  useEffect(() => {
    lastSentMessageIdRef.current = resolveLatestMessageIdInOrder(
      messages,
      lastSentMessageIdRef.current,
      viewerLastReadMessageId,
    );
  }, [messages, viewerLastReadMessageId]);

  const flushPendingReads = useCallback(async () => {
    const currentConversationId = String(normalizedConversationId || '').trim();
    if (!currentConversationId || typeof markRead !== 'function') return;
    if (inFlightMessageIdRef.current) return;
    const pendingIds = [...pendingReadIdsRef.current];
    if (pendingIds.length === 0) return;

    pendingReadIdsRef.current.clear();
    const nextMessageId = resolveLatestMessageIdInOrder(messages, pendingIds);
    if (!nextMessageId) return;

    const latestCompletedMessageId = resolveLatestMessageIdInOrder(
      messages,
      lastSentMessageIdRef.current,
      nextMessageId,
    );
    if (latestCompletedMessageId && latestCompletedMessageId === lastSentMessageIdRef.current) return;

    const latestInflightMessageId = resolveLatestMessageIdInOrder(
      messages,
      inFlightMessageIdRef.current,
      nextMessageId,
    );
    if (latestInflightMessageId && latestInflightMessageId === inFlightMessageIdRef.current) return;

    inFlightMessageIdRef.current = nextMessageId;
    try {
      await markRead(currentConversationId, nextMessageId);
      lastSentMessageIdRef.current = nextMessageId;
    } catch (error) {
      onReadSyncError?.(error);
    } finally {
      if (inFlightMessageIdRef.current === nextMessageId) {
        inFlightMessageIdRef.current = '';
      }
      if (pendingReadIdsRef.current.size > 0) {
        void flushPendingReadsRef.current();
      }
    }
  }, [markRead, messages, normalizedConversationId, onReadSyncError]);

  flushPendingReadsRef.current = flushPendingReads;

  const scheduleFlush = useCallback(() => {
    clearPendingTimer();
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void flushPendingReads();
    }, READ_RECEIPTS_DEBOUNCE_MS);
  }, [clearPendingTimer, flushPendingReads]);

  const markMessageSeenOptimistically = useCallback((messageId) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId) return;
    optimisticReadIdsRef.current.add(normalizedMessageId);
    const nextMarker = resolveLatestMessageIdInOrder(messages, [...optimisticReadIdsRef.current]);
    if (!nextMarker) return;
    setOptimisticLastReadMessageId((current) => {
      const resolved = resolveLatestMessageIdInOrder(messages, current, nextMarker);
      return resolved === current ? current : resolved;
    });
    onOptimisticRead?.(nextMarker);
  }, [messages, onOptimisticRead]);

  const shouldTrackMessage = useCallback((messageId) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId) return false;
    const message = (Array.isArray(messages) ? messages : []).find((item) => String(item?.id || '').trim() === normalizedMessageId);
    if (!message || message?.is_own) return false;
    const latestReadId = resolveLatestMessageIdInOrder(
      messages,
      effectiveLastReadMessageId,
      lastSentMessageIdRef.current,
    );
    const nextLatest = resolveLatestMessageIdInOrder(messages, latestReadId, normalizedMessageId);
    return nextLatest === normalizedMessageId;
  }, [effectiveLastReadMessageId, messages]);

  useEffect(() => {
    if (
      !enabled
      || !normalizedConversationId
      || typeof window === 'undefined'
      || typeof window.IntersectionObserver !== 'function'
    ) {
      observerRef.current?.disconnect?.();
      observerRef.current = null;
      return undefined;
    }

    const observer = new window.IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || entry.intersectionRatio < READ_RECEIPTS_THRESHOLD) return;
        const messageId = String(entry.target?.getAttribute?.('data-chat-message-id') || '').trim();
        if (!shouldTrackMessage(messageId)) return;
        pendingReadIdsRef.current.add(messageId);
        markMessageSeenOptimistically(messageId);
      });
      if (pendingReadIdsRef.current.size > 0) scheduleFlush();
    }, {
      root: scrollRootRef?.current || null,
      threshold: READ_RECEIPTS_THRESHOLD,
    });

    observerRef.current = observer;
    observedNodesRef.current.forEach((node, messageId) => {
      if (node && shouldTrackMessage(messageId)) observer.observe(node);
    });

    return () => {
      observer.disconnect();
      if (observerRef.current === observer) observerRef.current = null;
    };
  }, [
    enabled,
    markMessageSeenOptimistically,
    normalizedConversationId,
    scheduleFlush,
    scrollRootRef,
    shouldTrackMessage,
  ]);

  const getReadTargetRef = useCallback((messageId) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId) return undefined;
    if (!shouldTrackMessage(normalizedMessageId)) return undefined;
    if (!callbackRefsRef.current.has(normalizedMessageId)) {
      callbackRefsRef.current.set(normalizedMessageId, (node) => {
        const previousNode = observedNodesRef.current.get(normalizedMessageId);
        if (previousNode && observerRef.current) {
          observerRef.current.unobserve(previousNode);
        }
        if (!node) {
          observedNodesRef.current.delete(normalizedMessageId);
          return;
        }
        observedNodesRef.current.set(normalizedMessageId, node);
        if (observerRef.current && shouldTrackMessage(normalizedMessageId)) {
          observerRef.current.observe(node);
        }
      });
    }
    return callbackRefsRef.current.get(normalizedMessageId);
  }, [shouldTrackMessage]);

  return {
    effectiveLastReadMessageId,
    getReadTargetRef,
  };
}
