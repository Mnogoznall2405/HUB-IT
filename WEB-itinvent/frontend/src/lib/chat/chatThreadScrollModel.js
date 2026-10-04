export const CHAT_THREAD_VIRTUAL_CONTENT_SELECTOR = '[data-testid="chat-thread-content-virtual"]';

export const isVirtualizedChatThreadScroll = (container) => (
  Boolean(container?.querySelector?.(CHAT_THREAD_VIRTUAL_CONTENT_SELECTOR))
);

// Д2-3: поиск первой видимой строки сообщения. Раньше это был линейный обход
// всех [data-chat-message-id] с getBoundingClientRect() на каждый узел выше
// вьюпорта — а вызывается он на каждом scroll-событии, пока лента не у дна, и
// на каждом prepend-restore, что давало O(сотни) layout-чтений на кадр.
// Быстрый путь — elementFromPoint у верхней кромки контейнера (один hit-test
// по уже построенному layout); если точка попала в чип даты/сентинел/оверлей,
// пробуем чуть ниже, затем — прежний линейный скан как fallback.
const CHAT_ANCHOR_PROBE_X_INSET_PX = 24;
const CHAT_ANCHOR_PROBE_Y_OFFSETS_PX = [1, 40];
const CHAT_MESSAGE_NODE_SELECTOR = '[data-message-id], [data-chat-message-id]';

const findTopVisibleMessageNode = (container, containerRect) => {
  try {
    const doc = container?.ownerDocument;
    const containerWidth = Number(containerRect?.width || 0);
    const probeX = Number(containerRect?.left || 0)
      + Math.min(CHAT_ANCHOR_PROBE_X_INSET_PX, Math.max(2, containerWidth / 4));
    if (typeof doc?.elementFromPoint === 'function' && Number.isFinite(probeX)) {
      for (const offsetPx of CHAT_ANCHOR_PROBE_Y_OFFSETS_PX) {
        const probeY = Number(containerRect?.top || 0) + offsetPx;
        if (!Number.isFinite(probeY)) continue;
        const hit = doc.elementFromPoint(probeX, probeY);
        const node = hit?.closest?.(CHAT_MESSAGE_NODE_SELECTOR) || null;
        if (node && container.contains(node)) return node;
      }
    }
  } catch {
    // Нестандартные DOM (jsdom, выкл. hit-test) — ниже линейный скан.
  }

  const messageNodes = Array.from(container.querySelectorAll('[data-chat-message-id]'));
  return messageNodes.find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.bottom >= containerRect.top + 1;
  }) || messageNodes[0] || null;
};

const readMessageNodeId = (node) => String(
  node?.getAttribute?.('data-chat-message-id')
    || node?.getAttribute?.('data-message-id')
    || '',
).trim();

export const capturePrependScrollRestoreState = (container) => {
  if (!container) return null;

  const scrollHeight = Number(container.scrollHeight || 0);
  const scrollTop = Number(container.scrollTop || 0);
  const virtual = isVirtualizedChatThreadScroll(container);

  if (virtual) {
    return {
      mode: 'scrollHeight',
      virtual: true,
      scrollHeight,
      scrollTop,
    };
  }

  const containerRect = container.getBoundingClientRect();
  let anchorNode = findTopVisibleMessageNode(container, containerRect);
  if (anchorNode && !anchorNode.hasAttribute?.('data-chat-message-id')) {
    anchorNode = anchorNode.querySelector?.('[data-chat-message-id]') || anchorNode;
  }
  // Первое смонтированное сообщение — граница prepend: над ним появятся более
  // ранние, и его шапка серии (имя отправителя, отступ) может исчезнуть.
  // Якорь на нём «уводит» ленту на высоту шапки — берём следующее сообщение.
  if (anchorNode && container.querySelector('[data-chat-message-id]') === anchorNode) {
    const nextNode = container.querySelectorAll('[data-chat-message-id]')[1];
    if (nextNode && nextNode.getBoundingClientRect().top < containerRect.bottom) {
      anchorNode = nextNode;
    }
  }

  if (!anchorNode) {
    return {
      mode: 'scrollHeight',
      virtual: false,
      scrollHeight,
      scrollTop,
    };
  }

  return {
    mode: 'anchor',
    virtual: false,
    scrollHeight,
    scrollTop,
    anchorMessageId: readMessageNodeId(anchorNode),
    anchorViewportOffset: anchorNode.getBoundingClientRect().top - containerRect.top,
  };
};

export const computePrependScrollRestoreTop = (container, restore) => {
  if (!container || !restore) return null;

  const scrollHeight = Number(container.scrollHeight || 0);
  const scrollTop = Number(container.scrollTop || 0);

  if (restore.virtual || restore.mode === 'scrollHeight') {
    return Math.max(0, scrollHeight - Number(restore.scrollHeight || 0) + Number(restore.scrollTop || 0));
  }

  const anchorMessageId = String(restore.anchorMessageId || '').trim();
  if (!anchorMessageId) {
    return Math.max(0, scrollHeight - Number(restore.scrollHeight || 0) + Number(restore.scrollTop || 0));
  }

  const anchorNode = container.querySelector(`[data-chat-message-id="${anchorMessageId}"]`);
  if (!anchorNode) {
    return Math.max(0, scrollHeight - Number(restore.scrollHeight || 0) + Number(restore.scrollTop || 0));
  }

  const containerRect = container.getBoundingClientRect();
  const anchorRect = anchorNode.getBoundingClientRect();
  const delta = (anchorRect.top - containerRect.top) - Number(restore.anchorViewportOffset || 0);
  return Math.max(0, scrollTop + delta);
};

export const VIRTUAL_PREPEND_RESTORE_MAX_FRAMES = 8;

export const shouldRetryPrependRestore = (
  container,
  restore,
  frameIndex,
  maxFrames = VIRTUAL_PREPEND_RESTORE_MAX_FRAMES,
) => {
  if (!container || !restore) return false;
  if (frameIndex >= maxFrames) return false;

  const heightGrowth = Number(container.scrollHeight || 0) - Number(restore.scrollHeight || 0);
  if (heightGrowth < 2) return true;

  const expectedTop = computePrependScrollRestoreTop(container, restore);
  if (expectedTop == null) return false;

  return Math.abs(Number(container.scrollTop || 0) - expectedTop) > 2;
};

export const shouldRetryVirtualPrependRestore = shouldRetryPrependRestore;

export const shouldDeferPinnedBottomScroll = ({
  loadingOlder = false,
  prependRestorePending = false,
} = {}) => Boolean(loadingOlder || prependRestorePending);

export const computeVirtualPinnedContentGrowthScrollTop = ({
  scrollTop = 0,
  previousHeight = 0,
  nextHeight = 0,
} = {}) => {
  const delta = Number(nextHeight || 0) - Number(previousHeight || 0);
  if (Math.abs(delta) <= 1) return null;
  return Math.max(0, Number(scrollTop || 0) + delta);
};
