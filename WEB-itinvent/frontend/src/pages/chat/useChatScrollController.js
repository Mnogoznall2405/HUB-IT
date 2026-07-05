import { useCallback } from 'react';

import { emitAgentDebugLog } from '../../lib/debugClientLog';
import useChatThreadViewport from '../../components/chat/useChatThreadViewport';
import { getChatBottomInstantSettleFrames } from './chatKeyboardModel';
import {
  capturePrependScrollRestoreState,
  computePrependScrollRestoreTop,
  shouldRetryPrependRestore,
} from '../../lib/chat/chatThreadScrollModel';

/**
 * Scroll/viewport coordination for the chat thread pane.
 * ChatPageContent still owns anchor/guard orchestration; this hook centralizes viewport sync and scroll writes.
 */
export default function useChatScrollController({
  threadScrollRef,
  bottomRef,
  pinnedScrollRef,
  activeConversationIdRef,
  threadNearBottomRef,
  showJumpToLatestRef,
  setShowJumpToLatest,
  threadViewportSyncFrameRef,
  bottomInstantSettleFrameRef,
  mobileKeyboardSettleTimeoutsRef,
  suppressThreadScrollCancel,
  traceProgrammaticThreadScroll,
  isInitialViewportGuardActive,
}) {
  const {
    scheduleThreadViewportStateSync,
    syncThreadViewportState,
  } = useChatThreadViewport({
    setShowJumpToLatest,
    showJumpToLatestRef,
    threadNearBottomRef,
    threadViewportSyncFrameRef,
  });

  const setThreadScrollTop = useCallback((nextScrollTop, { source = 'unknown' } = {}) => {
    const container = threadScrollRef.current;
    if (!container) return false;
    const normalizedScrollTop = Math.max(0, Number.isFinite(Number(nextScrollTop)) ? Number(nextScrollTop) : 0);
    traceProgrammaticThreadScroll(source, {
      nextScrollTop: Math.round(normalizedScrollTop),
      currentScrollTop: Math.round(Number(container.scrollTop || 0)),
      scrollHeight: Math.round(Number(container.scrollHeight || 0)),
      clientHeight: Math.round(Number(container.clientHeight || 0)),
      guardActive: isInitialViewportGuardActive(),
    });
    suppressThreadScrollCancel();
    if (Math.abs(Number(container.scrollTop || 0) - normalizedScrollTop) < 1) {
      syncThreadViewportState(container);
      return true;
    }
    container.scrollTop = normalizedScrollTop;
    syncThreadViewportState(container);
    // #region agent log
    emitAgentDebugLog({
      location: 'Chat.jsx:setThreadScrollTop',
      message: 'scroll write',
      data: {
        source: String(source || ''),
        scrollTop: Math.round(normalizedScrollTop),
        scrollHeight: Math.round(Number(container.scrollHeight || 0)),
        clientHeight: Math.round(Number(container.clientHeight || 0)),
        distanceFromBottom: Math.round(Math.max(0, Number(container.scrollHeight || 0) - normalizedScrollTop - Number(container.clientHeight || 0))),
      },
      hypothesisId: 'H1',
    });
    // #endregion
    return true;
  }, [isInitialViewportGuardActive, suppressThreadScrollCancel, syncThreadViewportState, threadScrollRef, traceProgrammaticThreadScroll]);

  const bindPinnedScroll = useCallback((scrollFn) => {
    pinnedScrollRef.current = typeof scrollFn === 'function' ? scrollFn : null;
  }, [pinnedScrollRef]);

  const scrollThreadToBottomInstant = useCallback(({
    source = 'unknown',
    settleFrames = 0,
    userInitiated = false,
  } = {}) => {
    const pinnedScroll = pinnedScrollRef.current;
    const framesToSettle = Math.max(0, Math.floor(Number(settleFrames || 0)));
    if (typeof pinnedScroll === 'function') {
      threadNearBottomRef.current = true;
      showJumpToLatestRef.current = false;
      setShowJumpToLatest(false);
      pinnedScroll({
        settleFrames: Math.max(0, Math.floor(Number(settleFrames || 0))),
        forcePin: true,
      });
      return true;
    }

    const container = threadScrollRef.current;
    if (!container) return false;

    if (bottomInstantSettleFrameRef.current !== null) {
      window.cancelAnimationFrame(bottomInstantSettleFrameRef.current);
      bottomInstantSettleFrameRef.current = null;
    }

    const conversationId = String(activeConversationIdRef.current || '').trim();
    const scrollToCurrentBottom = (nextSource) => {
      const node = threadScrollRef.current;
      if (!node) return false;
      return setThreadScrollTop(
        Math.max(0, Number(node.scrollHeight || 0) - Number(node.clientHeight || 0)),
        { source: nextSource },
      );
    };

    scrollToCurrentBottom(source);

    if (framesToSettle <= 0) return true;

    let remainingFrames = framesToSettle;
    const settle = () => {
      bottomInstantSettleFrameRef.current = null;
      const node = threadScrollRef.current;
      if (!node) return;
      if (conversationId && conversationId !== String(activeConversationIdRef.current || '').trim()) return;

      const distanceFromBottom = Math.max(
        0,
        Number(node.scrollHeight || 0) - Number(node.scrollTop || 0) - Number(node.clientHeight || 0),
      );
      if (!userInitiated && distanceFromBottom > 160) return;

      scrollToCurrentBottom(`${source}:settle`);
      remainingFrames -= 1;
      if (remainingFrames <= 0) return;
      bottomInstantSettleFrameRef.current = window.requestAnimationFrame(settle);
    };

    bottomInstantSettleFrameRef.current = window.requestAnimationFrame(settle);
    return true;
  }, [
    activeConversationIdRef,
    bottomInstantSettleFrameRef,
    pinnedScrollRef,
    setShowJumpToLatest,
    setThreadScrollTop,
    showJumpToLatestRef,
    threadNearBottomRef,
    threadScrollRef,
  ]);

  const clearMobileKeyboardSettleTimeouts = useCallback(() => {
    mobileKeyboardSettleTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    mobileKeyboardSettleTimeoutsRef.current = [];
  }, [mobileKeyboardSettleTimeoutsRef]);

  const scheduleMobileKeyboardBottomSettle = useCallback(({
    conversationId,
    source,
    userInitiated = false,
  } = {}) => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) return;
    clearMobileKeyboardSettleTimeouts();
    [150, 320].forEach((delayMs) => {
      const timeoutId = window.setTimeout(() => {
        mobileKeyboardSettleTimeoutsRef.current = mobileKeyboardSettleTimeoutsRef.current
          .filter((id) => id !== timeoutId);
        if (String(activeConversationIdRef.current || '').trim() !== normalizedConversationId) return;
        scrollThreadToBottomInstant({
          source: `${source}:keyboard-settle-${delayMs}`,
          userInitiated,
          settleFrames: delayMs <= 150 ? 3 : 2,
        });
      }, delayMs);
      mobileKeyboardSettleTimeoutsRef.current.push(timeoutId);
    });
  }, [activeConversationIdRef, clearMobileKeyboardSettleTimeouts, mobileKeyboardSettleTimeoutsRef, scrollThreadToBottomInstant]);

  const scrollThreadBottomIntoView = useCallback(({ source = 'unknown', behavior = 'smooth' } = {}) => {
    const container = threadScrollRef.current;
    if (!container) return false;
    if (typeof bottomRef.current?.scrollIntoView === 'function') {
      traceProgrammaticThreadScroll(source, {
        behavior,
        target: 'bottomRef',
        scrollHeight: Math.round(Number(container.scrollHeight || 0)),
        clientHeight: Math.round(Number(container.clientHeight || 0)),
      });
      bottomRef.current.scrollIntoView({ behavior, block: 'end' });
      return true;
    }
    return setThreadScrollTop(container.scrollHeight - container.clientHeight, { source });
  }, [bottomRef, setThreadScrollTop, threadScrollRef, traceProgrammaticThreadScroll]);

  const capturePrependScrollRestore = useCallback(() => (
    capturePrependScrollRestoreState(threadScrollRef.current)
  ), [threadScrollRef]);

  const restorePrependScrollPosition = useCallback((restore, { source = 'prependRestore' } = {}) => {
    const container = threadScrollRef.current;
    if (!container || !restore) return false;
    const nextScrollTop = computePrependScrollRestoreTop(container, restore);
    if (nextScrollTop === null) return false;
    const sourceSuffix = restore.mode === 'anchor' ? 'anchor' : 'scrollHeight';
    return setThreadScrollTop(nextScrollTop, { source: `${source}:${sourceSuffix}` });
  }, [setThreadScrollTop, threadScrollRef]);

  const schedulePrependScrollRestore = useCallback((restore, { onSettled } = {}) => {
    if (!restore) return () => {};
    let frameIndex = 0;
    let frameId = null;
    let cancelled = false;

    const attempt = () => {
      if (cancelled) return;
      restorePrependScrollPosition(restore);
      const container = threadScrollRef.current;
      if (container && shouldRetryPrependRestore(container, restore, frameIndex)) {
        frameIndex += 1;
        frameId = window.requestAnimationFrame(attempt);
        return;
      }
      onSettled?.();
    };

    attempt();
    return () => {
      cancelled = true;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [restorePrependScrollPosition, threadScrollRef]);

  return {
    scheduleThreadViewportStateSync,
    syncThreadViewportState,
    setThreadScrollTop,
    bindPinnedScroll,
    scrollThreadToBottomInstant,
    clearMobileKeyboardSettleTimeouts,
    scheduleMobileKeyboardBottomSettle,
    scrollThreadBottomIntoView,
    capturePrependScrollRestore,
    restorePrependScrollPosition,
    schedulePrependScrollRestore,
    getChatBottomInstantSettleFrames,
    capturePrependScrollRestoreState,
    computePrependScrollRestoreTop,
  };
}
