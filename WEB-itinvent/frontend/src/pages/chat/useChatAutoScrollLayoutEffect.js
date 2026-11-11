import { useLayoutEffect } from 'react';

import { emitAgentDebugLog } from '../../lib/debugClientLog';
import { isChatLayoutKeyboardOpen, getChatBottomInstantSettleFrames } from './chatKeyboardModel';

export function shouldRunChatAutoScrollLayoutEffect({
  scrollMode,
  hasPendingInitialAnchor,
  container,
} = {}) {
  if (!container) return false;
  return Boolean(scrollMode) || Boolean(hasPendingInitialAnchor);
}

export function buildTracedAutoScrollSource(scrollMode, autoScrollSource) {
  const normalizedMode = String(scrollMode || '').trim();
  const normalizedSource = String(autoScrollSource || '').trim();
  if (!normalizedMode) return '';
  return normalizedSource
    ? `autoScroll:${normalizedMode}:${normalizedSource}`
    : `autoScroll:${normalizedMode}`;
}

export function resolveBottomInstantScrollPlan({
  isPhone,
  autoScrollSource,
  container,
} = {}) {
  const normalizedSource = String(autoScrollSource || '').trim();
  const isSocketSource = normalizedSource.startsWith('socket:');
  const layoutKeyboardNow = Boolean(isPhone) && isChatLayoutKeyboardOpen(container);
  const needsMobileKeyboardDefer = Boolean(isPhone) && (layoutKeyboardNow || isSocketSource);
  return {
    isSocketSource,
    layoutKeyboardNow,
    needsMobileKeyboardDefer,
    settleFrames: getChatBottomInstantSettleFrames({
      userInitiated: false,
      mobileKeyboardDeferred: needsMobileKeyboardDefer,
    }),
  };
}

export default function useChatAutoScrollLayoutEffect({
  activeConversationId,
  activeConversationIdRef,
  applyPendingInitialAnchor,
  autoScrollMetaRef,
  autoScrollRef,
  cancelPendingInitialAnchor,
  isPhone,
  logChatDebug,
  messages,
  pendingInitialAnchorRef,
  scheduleMobileKeyboardBottomSettle,
  schedulePendingInitialAnchorRetry,
  schedulePendingInitialAnchorSettle,
  scrollThreadBottomIntoView,
  scrollThreadToBottomInstant,
  setShowJumpToLatest,
  showJumpToLatestRef,
  threadNearBottomRef,
  threadScrollRef,
}) {
  useLayoutEffect(() => {
    let cancelled = false;
    let retryFrameId = null;
    const scrollMode = autoScrollRef.current;
    const scrollMeta = autoScrollMetaRef.current;
    const hasPendingInitialAnchor = pendingInitialAnchorRef.current?.conversationId
      === activeConversationIdRef.current;
    const container = threadScrollRef.current;

    if (!shouldRunChatAutoScrollLayoutEffect({
      scrollMode,
      hasPendingInitialAnchor,
      container,
    })) {
      return undefined;
    }

    if (scrollMode) {
      autoScrollRef.current = false;
      autoScrollMetaRef.current = null;
      if (scrollMeta?.userInitiated) {
        cancelPendingInitialAnchor();
      }
      const autoScrollSource = String(scrollMeta?.source || '').trim();
      const tracedScrollSource = buildTracedAutoScrollSource(scrollMode, autoScrollSource);

      emitAgentDebugLog({
        location: 'Chat.jsx:autoScrollLayoutEffect',
        message: 'autoScroll prioritized over pendingAnchor',
        data: {
          mode: scrollMode,
          source: autoScrollSource || 'unknown',
          userInitiated: Boolean(scrollMeta?.userInitiated),
          hadPendingAnchor: hasPendingInitialAnchor,
        },
        hypothesisId: 'H5',
      });

      if (scrollMode === 'bottom_instant') {
        const userInitiated = Boolean(scrollMeta?.userInitiated);
        const conversationId = String(activeConversationIdRef.current || '').trim();
        const {
          isSocketSource,
          layoutKeyboardNow,
          needsMobileKeyboardDefer,
        } = resolveBottomInstantScrollPlan({
          isPhone,
          autoScrollSource,
          container,
        });

        const runInstantScroll = (sourceSuffix = '') => {
          scrollThreadToBottomInstant({
            source: sourceSuffix ? `${tracedScrollSource}${sourceSuffix}` : tracedScrollSource,
            userInitiated,
            settleFrames: getChatBottomInstantSettleFrames({
              userInitiated,
              mobileKeyboardDeferred: needsMobileKeyboardDefer,
            }),
          });
        };

        if (needsMobileKeyboardDefer) {
          emitAgentDebugLog({
            location: 'Chat.jsx:autoScrollLayoutEffect',
            message: isSocketSource && !userInitiated
              ? 'deferred socket/layout-keyboard autoScroll'
              : 'mobile keyboard follow-up autoScroll scheduled',
            data: {
              source: autoScrollSource,
              layoutKeyboardNow,
              userInitiated,
              clientHeight: Math.round(Number(container?.clientHeight || 0)),
            },
            hypothesisId: 'H-M9',
          });
          if (isSocketSource && !userInitiated) {
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => {
                if (String(activeConversationIdRef.current || '').trim() !== conversationId) return;
                runInstantScroll(':deferred-rAF');
                scheduleMobileKeyboardBottomSettle({
                  conversationId,
                  source: tracedScrollSource,
                  userInitiated,
                });
              });
            });
          } else {
            runInstantScroll();
            scheduleMobileKeyboardBottomSettle({
              conversationId,
              source: tracedScrollSource,
              userInitiated,
            });
          }
        } else {
          runInstantScroll();
        }
        logChatDebug('autoScroll:bottom_instant', {
          conversationId: activeConversationIdRef.current,
          source: autoScrollSource || 'unknown',
          userInitiated: Boolean(scrollMeta?.userInitiated),
        });
        return undefined;
      }

      if (scrollMode === 'bottom') {
        threadNearBottomRef.current = true;
        showJumpToLatestRef.current = false;
        setShowJumpToLatest(false);
      }
      logChatDebug('autoScroll:bottom', {
        conversationId: activeConversationIdRef.current,
        source: autoScrollSource || 'unknown',
        userInitiated: Boolean(scrollMeta?.userInitiated),
      });
      if (scrollThreadBottomIntoView({ source: tracedScrollSource, behavior: 'smooth' })) {
        return undefined;
      }
      return undefined;
    }

    if (pendingInitialAnchorRef.current?.conversationId === activeConversationIdRef.current) {
      queueMicrotask(() => {
        if (cancelled) return;
        const initialAnchorResult = applyPendingInitialAnchor({ source: 'layout_microtask' });
        if (initialAnchorResult === 'changed') {
          schedulePendingInitialAnchorSettle(true);
          return;
        }
        if (initialAnchorResult === 'unchanged') {
          schedulePendingInitialAnchorSettle(false);
          return;
        }
        retryFrameId = window.requestAnimationFrame(() => {
          queueMicrotask(() => {
            if (cancelled) return;
            const retryResult = applyPendingInitialAnchor({ source: 'layout_raf' });
            if (retryResult === 'changed') {
              schedulePendingInitialAnchorSettle(true);
              return;
            }
            if (retryResult === 'unchanged') {
              schedulePendingInitialAnchorSettle(false);
              return;
            }
            if (pendingInitialAnchorRef.current?.ready) {
              schedulePendingInitialAnchorRetry();
            }
          });
        });
      });
      return () => {
        cancelled = true;
        if (retryFrameId) window.cancelAnimationFrame(retryFrameId);
      };
    }

    return undefined;
  }, [
    activeConversationId,
    applyPendingInitialAnchor,
    cancelPendingInitialAnchor,
    isPhone,
    logChatDebug,
    messages,
    scheduleMobileKeyboardBottomSettle,
    schedulePendingInitialAnchorRetry,
    schedulePendingInitialAnchorSettle,
    scrollThreadBottomIntoView,
    scrollThreadToBottomInstant,
    setShowJumpToLatest,
  ]);
}
