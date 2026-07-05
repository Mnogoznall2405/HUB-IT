export const CHAT_THREAD_VIRTUAL_CONTENT_SELECTOR = '[data-testid="chat-thread-content-virtual"]';

export const isVirtualizedChatThreadScroll = (container) => (
  Boolean(container?.querySelector?.(CHAT_THREAD_VIRTUAL_CONTENT_SELECTOR))
);

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
  const messageNodes = Array.from(container.querySelectorAll('[data-chat-message-id]'));
  const anchorNode = messageNodes.find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.bottom >= containerRect.top + 1;
  }) || messageNodes[0] || null;

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
    anchorMessageId: String(anchorNode.getAttribute('data-chat-message-id') || '').trim(),
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
