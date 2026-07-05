import { useEffect, useMemo } from 'react';

export const loadChatDialogsModule = () => import('../../components/chat/ChatDialogs');

export function computeShouldRenderChatDialogs({
  threadMenuAnchor,
  messageMenuAnchor,
  composerMenuAnchor,
  emojiAnchorEl,
  groupOpen,
  shareOpen,
  forwardOpen,
  fileDialogOpen,
  attachmentPreview,
  documentPreview,
  messageReadsOpen,
  searchOpen,
  isMobile,
  infoOpen,
} = {}) {
  return Boolean(
    threadMenuAnchor
    || messageMenuAnchor
    || composerMenuAnchor
    || emojiAnchorEl
    || groupOpen
    || shareOpen
    || forwardOpen
    || fileDialogOpen
    || attachmentPreview
    || documentPreview
    || messageReadsOpen
    || searchOpen
    || (isMobile && infoOpen),
  );
}

export default function useChatDialogsController({
  threadMenuAnchor,
  messageMenuAnchor,
  composerMenuAnchor,
  emojiAnchorEl,
  groupOpen,
  shareOpen,
  forwardOpen,
  fileDialogOpen,
  attachmentPreview,
  documentPreview,
  messageReadsOpen,
  searchOpen,
  isMobile,
  infoOpen,
  preloadOnIdle = true,
}) {
  const shouldRenderChatDialogs = useMemo(
    () => computeShouldRenderChatDialogs({
      threadMenuAnchor,
      messageMenuAnchor,
      composerMenuAnchor,
      emojiAnchorEl,
      groupOpen,
      shareOpen,
      forwardOpen,
      fileDialogOpen,
      attachmentPreview,
      documentPreview,
      messageReadsOpen,
      searchOpen,
      isMobile,
      infoOpen,
    }),
    [
      attachmentPreview,
      composerMenuAnchor,
      documentPreview,
      emojiAnchorEl,
      fileDialogOpen,
      forwardOpen,
      groupOpen,
      infoOpen,
      isMobile,
      messageMenuAnchor,
      messageReadsOpen,
      searchOpen,
      shareOpen,
      threadMenuAnchor,
    ],
  );

  useEffect(() => {
    if (!shouldRenderChatDialogs) return undefined;
    void loadChatDialogsModule();
    return undefined;
  }, [shouldRenderChatDialogs]);

  useEffect(() => {
    if (!preloadOnIdle || typeof window === 'undefined') return undefined;
    const prefetchDialogs = () => {
      void loadChatDialogsModule();
    };
    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(prefetchDialogs, { timeout: 1500 });
      return () => window.cancelIdleCallback?.(idleId);
    }
    const timeoutId = window.setTimeout(prefetchDialogs, 900);
    return () => window.clearTimeout(timeoutId);
  }, [preloadOnIdle]);

  return {
    loadChatDialogsModule,
    shouldRenderChatDialogs,
  };
}
