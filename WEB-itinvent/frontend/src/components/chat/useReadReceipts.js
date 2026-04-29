import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const READ_RECEIPTS_DEBOUNCE_MS = 500;
const READ_RECEIPTS_THRESHOLD = 0.5;

const buildMessageOrderState = (messages) => {
  const list = Array.isArray(messages) ? messages : [];
  const messageById = new Map();
  const indexById = new Map();
  list.forEach((message, index) => {
    const messageId = String(message?.id || '').trim();
    if (!messageId) return;
    messageById.set(messageId, message);
    indexById.set(messageId, index);
  });
  return { list, messageById, indexById };
};

const resolveLatestMessageIdFromState = (state, ...messageIds) => {
  const normalizedIds = messageIds
    .flat()
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  let latestIndex = -1;
  let latestMessageId = '';
  normalizedIds.forEach((candidateId) => {
    const candidateIndex = Number(state?.indexById?.get(candidateId));
    if (Number.isFinite(candidateIndex) && candidateIndex > latestIndex) {
      latestIndex = candidateIndex;
      latestMessageId = candidateId;
    }
  });
  return latestMessageId || normalizedIds[0] || '';
};

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
  const messageOrderState = useMemo(() => buildMessageOrderState(messages), [messages]);
  const messageOrderStateRef = useRef(messageOrderState);
  messageOrderStateRef.current = messageOrderState;
  const observerRef = useRef(null);
  const pendingReadIdsRef = useRef(new Set());
  const optimisticReadIdsRef = useRef(new Set());
  const observedNodesRef = useRef(new Map());
  const callbackRefsRef = useRef(new Map());
  const debounceTimerRef = useRef(null);
  const lastSentMessageIdRef = useRef('');
  const inFlightMessageIdRef = useRef('');
  const flushPendingReadsRef = useRef(async () => {});
  const markReadRef = useRef(markRead);
  const onReadSyncErrorRef = useRef(onReadSyncError);
  const effectiveLastReadMessageIdRef = useRef('');
  const markMessageSeenOptimisticallyRef = useRef(() => {});
  const shouldTrackMessageRef = useRef(() => false);
  markReadRef.current = markRead;
  onReadSyncErrorRef.current = onReadSyncError;

  const effectiveLastReadMessageId = useMemo(
    () => resolveLatestMessageIdFromState(messageOrderState, viewerLastReadMessageId, optimisticLastReadMessageId),
    [messageOrderState, optimisticLastReadMessageId, viewerLastReadMessageId],
  );
  effectiveLastReadMessageIdRef.current = effectiveLastReadMessageId;

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
    lastSentMessageIdRef.current = resolveLatestMessageIdFromState(
      messageOrderStateRef.current,
      lastSentMessageIdRef.current,
      viewerLastReadMessageId,
    );
  }, [messageOrderState, viewerLastReadMessageId]);

  const flushPendingReads = useCallback(async () => {
    const currentConversationId = String(normalizedConversationId || '').trim();
    if (!currentConversationId || typeof markReadRef.current !== 'function') return;
    if (inFlightMessageIdRef.current) return;
    const pendingIds = [...pendingReadIdsRef.current];
    if (pendingIds.length === 0) return;

    pendingReadIdsRef.current.clear();
    const orderState = messageOrderStateRef.current;
    const nextMessageId = resolveLatestMessageIdFromState(orderState, pendingIds);
    if (!nextMessageId) return;

    const latestCompletedMessageId = resolveLatestMessageIdFromState(
      orderState,
      lastSentMessageIdRef.current,
      nextMessageId,
    );
    if (latestCompletedMessageId && latestCompletedMessageId === lastSentMessageIdRef.current) return;

    const latestInflightMessageId = resolveLatestMessageIdFromState(
      orderState,
      inFlightMessageIdRef.current,
      nextMessageId,
    );
    if (latestInflightMessageId && latestInflightMessageId === inFlightMessageIdRef.current) return;

    inFlightMessageIdRef.current = nextMessageId;
    try {
      await markReadRef.current(currentConversationId, nextMessageId);
      lastSentMessageIdRef.current = nextMessageId;
    } catch (error) {
      onReadSyncErrorRef.current?.(error);
    } finally {
      if (inFlightMessageIdRef.current === nextMessageId) {
        inFlightMessageIdRef.current = '';
      }
      if (pendingReadIdsRef.current.size > 0) {
        void flushPendingReadsRef.current();
      }
    }
  }, [normalizedConversationId]);

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
    const orderState = messageOrderStateRef.current;
    const nextMarker = resolveLatestMessageIdFromState(orderState, [...optimisticReadIdsRef.current]);
    if (!nextMarker) return;
    setOptimisticLastReadMessageId((current) => {
      const resolved = resolveLatestMessageIdFromState(orderState, current, nextMarker);
      return resolved === current ? current : resolved;
    });
    onOptimisticRead?.(nextMarker);
  }, [onOptimisticRead]);
  markMessageSeenOptimisticallyRef.current = markMessageSeenOptimistically;

  const shouldTrackMessage = useCallback((messageId) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId) return false;
    const orderState = messageOrderStateRef.current;
    const message = orderState.messageById.get(normalizedMessageId);
    if (!message || message?.is_own) return false;
    const latestReadId = resolveLatestMessageIdFromState(
      orderState,
      effectiveLastReadMessageIdRef.current,
      lastSentMessageIdRef.current,
    );
    const nextLatest = resolveLatestMessageIdFromState(orderState, latestReadId, normalizedMessageId);
    return nextLatest === normalizedMessageId;
  }, []);
  shouldTrackMessageRef.current = shouldTrackMessage;

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
        if (!shouldTrackMessageRef.current(messageId)) return;
        pendingReadIdsRef.current.add(messageId);
        markMessageSeenOptimisticallyRef.current(messageId);
      });
      if (pendingReadIdsRef.current.size > 0) scheduleFlush();
    }, {
      root: scrollRootRef?.current || null,
      threshold: READ_RECEIPTS_THRESHOLD,
    });

    observerRef.current = observer;
    observedNodesRef.current.forEach((node, messageId) => {
      if (node && shouldTrackMessageRef.current(messageId)) observer.observe(node);
    });

    return () => {
      observer.disconnect();
      if (observerRef.current === observer) observerRef.current = null;
    };
  }, [
    enabled,
    normalizedConversationId,
    scheduleFlush,
    scrollRootRef,
  ]);

  useEffect(() => {
    const observer = observerRef.current;
    if (!observer) return;
    observedNodesRef.current.forEach((node, messageId) => {
      if (!node) return;
      if (shouldTrackMessageRef.current(messageId)) {
        observer.observe(node);
      } else {
        observer.unobserve(node);
      }
    });
  }, [effectiveLastReadMessageId, messageOrderState]);

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
        if (observerRef.current && shouldTrackMessageRef.current(normalizedMessageId)) {
          observerRef.current.observe(node);
        }
      });
    }
    return callbackRefsRef.current.get(normalizedMessageId);
  }, []);

  return {
    effectiveLastReadMessageId,
    getReadTargetRef,
  };
}
