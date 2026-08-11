import { useEffect } from 'react';

import { hasChatBlockingOverlay, resolveChatEscapeAction } from './chatEscapeClose';

export default function useChatEscapeClose({
  isMobile = false,
  mobileThreadOpen = false,
  hasActiveConversation = false,
  emojiPickerOpen = false,
  hasSelectedMessages = false,
  contextPanelOpen = false,
  taskPanelOpen = false,
  infoOpen = false,
  onCloseEmoji,
  onClearSelection,
  onClosePanels,
  onCloseMobileThread,
  onCloseDesktopThread,
} = {}) {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const action = resolveChatEscapeAction({
        hasBlockingOverlay: hasChatBlockingOverlay(document),
        emojiPickerOpen,
        hasSelectedMessages,
        contextPanelOpen,
        taskPanelOpen,
        infoOpen,
        hasActiveConversation,
        isMobile,
        mobileThreadOpen,
      });
      if (!action) return;

      event.preventDefault();

      if (action === 'close-emoji') {
        onCloseEmoji?.();
        return;
      }
      if (action === 'clear-selection') {
        onClearSelection?.();
        return;
      }
      if (action === 'close-panels') {
        onClosePanels?.();
        return;
      }
      if (action === 'close-mobile-thread') {
        onCloseMobileThread?.();
        return;
      }
      if (action === 'close-desktop-thread') {
        onCloseDesktopThread?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    contextPanelOpen,
    emojiPickerOpen,
    hasActiveConversation,
    hasSelectedMessages,
    infoOpen,
    isMobile,
    mobileThreadOpen,
    onClearSelection,
    onCloseDesktopThread,
    onCloseEmoji,
    onCloseMobileThread,
    onClosePanels,
    taskPanelOpen,
  ]);
}
