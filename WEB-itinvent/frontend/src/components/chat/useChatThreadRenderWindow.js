import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  CHAT_RENDER_WINDOW_TAIL,
  buildRenderWindowIndex,
  centerRenderWindowOn,
  expandRenderWindowNewer,
  expandRenderWindowOlder,
  isSameRenderWindowState,
  pinRenderWindowToHead,
  registerChatThreadRenderWindow,
  resolveRenderWindow,
} from '../../lib/chat/chatThreadRenderWindow';
import { capturePrependScrollRestoreState } from '../../lib/chat/chatThreadScrollModel';
import { CHAT_THREAD_NEAR_BOTTOM_DISTANCE_PX } from './chatHelpers';

// Край окна, при подходе к которому монтируется следующая порция: не меньше
// полутора экранов, чтобы порция успевала появиться до того, как её увидят.
const RENDER_WINDOW_EDGE_MIN_PX = 900;
const RENDER_WINDOW_EDGE_VIEWPORTS = 1.5;

const findMessageNode = (container, messageId) => {
  const id = String(messageId || '').trim();
  if (!container || !id) return null;
  try {
    return container.querySelector(`[data-chat-message-id="${CSS.escape(id)}"]`)
      || container.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
  } catch {
    return null;
  }
};

/**
 * Держит в DOM ограниченное окно ленты (см. lib/chat/chatThreadRenderWindow).
 * Возвращает разрешённый срез и обработчики для сентинела старой истории.
 */
export default function useChatThreadRenderWindow({
  messages,
  conversationId,
  threadScrollRef,
  prependScrollRestoreRef,
  onRenderWindowCommit,
  onLoadOlder,
}) {
  const normalizedConversationId = String(conversationId || '').trim();
  const [windowState, setWindowState] = useState(() => ({
    conversationId: normalizedConversationId,
    ...CHAT_RENDER_WINDOW_TAIL,
  }));
  const effectiveState = windowState.conversationId === normalizedConversationId
    ? windowState
    : { conversationId: normalizedConversationId, ...CHAT_RENDER_WINDOW_TAIL };

  const ids = useMemo(
    () => (Array.isArray(messages) ? messages : []).map((message) => String(message?.id || '').trim()),
    [messages],
  );
  const indexById = useMemo(() => buildRenderWindowIndex(ids), [ids]);
  const committedRangeRef = useRef({
    conversationId: '', start: 0, end: 0, firstId: '', lastId: '', atTail: true,
  });
  const fallback = committedRangeRef.current.conversationId === normalizedConversationId
    ? committedRangeRef.current
    : null;
  const range = useMemo(
    () => resolveRenderWindow({ ids, indexById, state: effectiveState, fallback }),
    [ids, indexById, effectiveState.startId, effectiveState.endId, effectiveState.keep],
  );
  const firstRenderedId = range.end > range.start ? ids[range.start] : '';
  const lastRenderedId = range.end > range.start ? ids[range.end - 1] : '';

  // Снимок якоря делается до коммита: в layout-эффекте DOM уже изменён.
  // Читается только когда меняется первый смонтированный элемент той же беседы.
  const anchorSnapshotRef = useRef(null);
  const committed = committedRangeRef.current;
  if (
    committed.conversationId === normalizedConversationId
    && committed.firstId
    && firstRenderedId
    && committed.firstId !== firstRenderedId
  ) {
    const container = threadScrollRef?.current;
    if (container && anchorSnapshotRef.current?.forFirstId !== firstRenderedId) {
      const distanceFromBottom = Number(container.scrollHeight || 0)
        - Number(container.scrollTop || 0)
        - Number(container.clientHeight || 0);
      anchorSnapshotRef.current = {
        forFirstId: firstRenderedId,
        // Лента прижата к хвосту — её удерживает закрепление к низу (ChatThread).
        pinnedToTail: committed.atTail && distanceFromBottom <= CHAT_THREAD_NEAR_BOTTOM_DISTANCE_PX,
        restore: capturePrependScrollRestoreState(container),
      };
    }
  }

  const pendingCommitActionsRef = useRef([]);
  const shiftPendingRef = useRef(false);
  const latestRef = useRef({});
  latestRef.current = {
    ids,
    indexById,
    range,
    conversationId: normalizedConversationId,
    onRenderWindowCommit,
    onLoadOlder,
  };

  const applyWindowState = useCallback((nextState, { action = null } = {}) => {
    const current = latestRef.current;
    if (action) pendingCommitActionsRef.current.push(action);
    setWindowState((previous) => {
      const previousState = previous.conversationId === current.conversationId
        ? previous
        : { conversationId: current.conversationId, ...CHAT_RENDER_WINDOW_TAIL };
      if (isSameRenderWindowState(previousState, nextState)) {
        return previous;
      }
      shiftPendingRef.current = true;
      return { conversationId: current.conversationId, ...nextState };
    });
  }, []);

  useLayoutEffect(() => {
    const container = threadScrollRef?.current;
    const previous = committedRangeRef.current;
    const changed = previous.conversationId !== normalizedConversationId
      || previous.firstId !== firstRenderedId
      || previous.lastId !== lastRenderedId;
    committedRangeRef.current = {
      conversationId: normalizedConversationId,
      start: range.start,
      end: range.end,
      firstId: firstRenderedId,
      lastId: lastRenderedId,
      atTail: range.end >= range.total,
    };
    shiftPendingRef.current = false;
    const snapshot = anchorSnapshotRef.current;
    anchorSnapshotRef.current = null;
    const actions = pendingCommitActionsRef.current;
    pendingCommitActionsRef.current = [];
    if (!container) return;

    let adjusted = false;
    if (actions.length) {
      actions.forEach((run) => {
        try {
          run(container);
        } catch {
          // Сбой одного действия не должен ломать коммит окна.
        }
      });
      adjusted = true;
    } else if (
      changed
      && snapshot?.forFirstId === firstRenderedId
      && !snapshot.pinnedToTail
      && snapshot.restore?.mode === 'anchor'
      && !prependScrollRestoreRef?.current
    ) {
      // Верх окна сдвинулся (порция над экраном смонтирована или срезана) —
      // возвращаем верхнее видимое сообщение на прежнее место.
      const anchorNode = findMessageNode(container, snapshot.restore.anchorMessageId);
      if (anchorNode) {
        const containerRect = container.getBoundingClientRect();
        const delta = (anchorNode.getBoundingClientRect().top - containerRect.top)
          - Number(snapshot.restore.anchorViewportOffset || 0);
        if (Math.abs(delta) > 0.5) {
          container.scrollTop = Math.max(0, Number(container.scrollTop || 0) + delta);
        }
        adjusted = true;
      }
    }
    if (adjusted) {
      latestRef.current.onRenderWindowCommit?.();
    }
  }, [firstRenderedId, lastRenderedId, normalizedConversationId, prependScrollRestoreRef, range.end, range.start, range.total, threadScrollRef]);

  const expandOlder = useCallback(() => {
    const { ids: currentIds, range: currentRange } = latestRef.current;
    if (currentRange.start <= 0) return false;
    applyWindowState(expandRenderWindowOlder(currentIds, currentRange));
    return true;
  }, [applyWindowState]);

  const expandNewer = useCallback(() => {
    const { ids: currentIds, range: currentRange } = latestRef.current;
    if (currentRange.end >= currentIds.length) return false;
    applyWindowState(expandRenderWindowNewer(currentIds, currentRange));
    return true;
  }, [applyWindowState]);

  // Сентинел над окном: скрытые уже загруженные сообщения монтируются
  // локально, сетевую догрузку получает только начало загруженной истории.
  const loadOlderFromSentinel = useCallback(() => {
    if (expandOlder()) return;
    const { ids: currentIds, range: currentRange } = latestRef.current;
    applyWindowState(pinRenderWindowToHead(currentIds, currentRange));
    latestRef.current.onLoadOlder?.();
  }, [applyWindowState, expandOlder]);

  useEffect(() => {
    const container = threadScrollRef?.current;
    if (!container) return undefined;
    let frameId = null;
    const evaluate = () => {
      frameId = null;
      if (shiftPendingRef.current) return;
      const { ids: currentIds, range: currentRange } = latestRef.current;
      if (currentRange.start <= 0 && currentRange.end >= currentIds.length) return;
      const clientHeight = Number(container.clientHeight || 0);
      const scrollTop = Number(container.scrollTop || 0);
      const distanceFromBottom = Number(container.scrollHeight || 0) - scrollTop - clientHeight;
      const edge = Math.max(RENDER_WINDOW_EDGE_MIN_PX, clientHeight * RENDER_WINDOW_EDGE_VIEWPORTS);
      if (scrollTop < edge && currentRange.start > 0) {
        expandOlder();
      } else if (distanceFromBottom < edge && currentRange.end < currentIds.length) {
        expandNewer();
      }
    };
    const handleScroll = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(evaluate);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [expandNewer, expandOlder, normalizedConversationId, threadScrollRef]);

  useEffect(() => {
    const container = threadScrollRef?.current;
    if (!container) return undefined;
    const controller = {
      hasHiddenNewer: () => {
        const { ids: currentIds, range: currentRange } = latestRef.current;
        return currentRange.end < currentIds.length;
      },
      hasHiddenOlder: () => latestRef.current.range.start > 0,
      isMessageRendered: (messageId) => {
        const { indexById: currentIndex, range: currentRange } = latestRef.current;
        const index = currentIndex.get(String(messageId || '').trim());
        return Number.isInteger(index) && index >= currentRange.start && index < currentRange.end;
      },
      // Сообщение загружено, но не смонтировано — окно центрируется на нём,
      // `onRendered(container)` вызывается после коммита. false — сообщения нет.
      ensureMessageRendered: (messageId, onRendered) => {
        const { ids: currentIds, indexById: currentIndex, range: currentRange } = latestRef.current;
        const index = currentIndex.get(String(messageId || '').trim());
        if (!Number.isInteger(index)) return false;
        // Уже смонтировано, но узла нет в DOM — окно тут ни при чём.
        if (index >= currentRange.start && index < currentRange.end) return false;
        const nextState = centerRenderWindowOn(currentIds, messageId, { indexById: currentIndex });
        if (!nextState) return false;
        applyWindowState(nextState, { action: onRendered || null });
        return true;
      },
      // Вернуть окно к хвосту; после коммита — к низу ленты.
      showLatest: () => {
        const { ids: currentIds, range: currentRange } = latestRef.current;
        if (currentRange.end >= currentIds.length) return false;
        applyWindowState(CHAT_RENDER_WINDOW_TAIL, {
          action: (node) => {
            node.scrollTop = Math.max(0, Number(node.scrollHeight || 0) - Number(node.clientHeight || 0));
          },
        });
        return true;
      },
    };
    return registerChatThreadRenderWindow(container, controller);
  }, [applyWindowState, normalizedConversationId, threadScrollRef]);

  return {
    range,
    hiddenOlderCount: range.start,
    hiddenNewerCount: Math.max(0, ids.length - range.end),
    loadOlderFromSentinel,
  };
}
